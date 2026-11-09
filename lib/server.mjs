// 页面服务：给窗口里的“模型剩余额度”页提供 /api/report，并托管 ui/。
//
// 数据全部来自本机 magpie 的配置目录：
//   usage.jsonl        逐条请求的 token
//   quota-history.json 每个账号每个窗口的剩余百分比读数
//   quotas.json        当前额度快照（网关不可用时的兜底）
// 当前额度优先问网关 GET /v1/magpie/quotas?kept=1，那里带 remaining 与 holds。

import { createServer } from "node:http"
import { randomBytes, timingSafeEqual } from "node:crypto"
import { readFile, stat } from "node:fs/promises"
import { existsSync } from "node:fs"
import { readFileSync, openSync, readSync, closeSync, statSync } from "node:fs"
import { join, extname } from "node:path"
import { fileURLToPath } from "node:url"
import { buildReport, indexUsage } from "./report.mjs"

const here = fileURLToPath(new URL(".", import.meta.url))
const UI_ROOT = join(here, "..", "ui")

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
}

export function configDir() {
  return process.env.MAGPIE_CONFIG_DIR || join(process.env.USERPROFILE || process.env.HOME || ".", ".config", "magpie")
}

const gatewayBase = () => {
  let a = process.env.MAGPIE_ADDR || process.env.MAGPIE_GATEWAY || "127.0.0.1:3425"
  if (!/^https?:\/\//i.test(a)) a = "http://" + a
  try {
    return new URL(a).origin
  } catch {
    return "http://127.0.0.1:3425"
  }
}
const GATEWAY = gatewayBase

// ---- 数据装载 ---------------------------------------------------------------

function readJsonSafe(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, "utf8"))
  } catch {
    return fallback
  }
}

// 一次读完整份 usage.jsonl，并把字节偏移记下来，之后只读追加的部分。
function openUsage(file) {
  const state = { file, offset: 0, rows: [], shrank: false }
  reloadUsage(state)
  return state
}

function reloadUsage(state) {
  state.rows = []
  state.offset = 0
  if (!existsSync(state.file)) return
  const size = statSync(state.file).size
  const fd = openSync(state.file, "r")
  try {
    const buf = Buffer.alloc(size)
    readSync(fd, buf, 0, size, 0)
    state.offset = size
    for (const line of buf.toString("utf8").split("\n")) {
      if (!line.trim()) continue
      try { state.rows.push(JSON.parse(line)) } catch { /* 尾行未写完时跳过 */ }
    }
  } finally {
    closeSync(fd)
  }
}

function appendUsage(state) {
  if (!existsSync(state.file)) return
  const size = statSync(state.file).size
  if (size < state.offset) { reloadUsage(state); return }
  if (size === state.offset) return
  const fd = openSync(state.file, "r")
  try {
    const len = size - state.offset
    const buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, state.offset)
    const text = buf.toString("utf8")
    const lastNl = text.lastIndexOf("\n")
    // 只吸收已经完整成行的部分，剩下的半行下次再读
    const usable = lastNl >= 0 ? text.slice(0, lastNl) : ""
    if (usable) {
      for (const line of usable.split("\n")) {
        if (!line.trim()) continue
        try { state.rows.push(JSON.parse(line)) } catch { /* 理论上不会发生 */ }
      }
      state.offset += Buffer.byteLength(usable, "utf8") + 1
    }
  } finally {
    closeSync(fd)
  }
}

async function gatewayQuotas() {
  const res = await fetch(`${GATEWAY()}/v1/magpie/quotas?kept=1`, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error("网关额度接口 HTTP " + res.status)
  const body = await res.json()
  return body.data ?? []
}

// quotas.json 兜底：它只有 used，没有 remaining / holds，但足够算百分比。
function fileQuotas() {
  const raw = readJsonSafe(join(configDir(), "quotas.json"), {})
  const out = []
  for (const rec of Object.values(raw)) {
    const q = rec?.quota
    if (!q || !Array.isArray(q.windows)) continue
    out.push({
      provider: q.provider,
      name: q.name,
      plan: q.plan,
      user: q.user,
      windows: q.windows.map((w) => ({
        ...w,
        remaining: typeof w.remaining === "number" ? w.remaining : Math.max(0, 100 - Number(w.used || 0)),
      })),
    })
  }
  return out
}

// ---- 报告缓存 ---------------------------------------------------------------

export function createEngine() {
  const dir = configDir()
  const usage = openUsage(join(dir, "usage.jsonl"))
  let cache = null
  let building = null
  let lastBuild = 0
  const MAX_AGE = 30 * 1000

  async function build(force) {
    if (!force && cache && Date.now() - lastBuild < MAX_AGE) return cache
    if (building) return building
    building = (async () => {
      appendUsage(usage)
      let quotaRecords
      let source = "gateway"
      let sourceError = ""
      try {
        quotaRecords = await gatewayQuotas()
      } catch (e) {
        quotaRecords = fileQuotas()
        source = "file"
        sourceError = String(e?.message || e)
      }
      const history = readJsonSafe(join(dir, "quota-history.json"), {})
      const idx = indexUsage(usage.rows, { now: Date.now() })
      const report = buildReport({ quotaRecords, history, usage: idx, now: Date.now() })
      report.source = source
      report.sourceError = sourceError
      report.usageRows = usage.rows.length
      cache = report
      lastBuild = Date.now()
      return report
    })().finally(() => { building = null })
    return building
  }

  return { build, usage }
}

// ---- HTTP -------------------------------------------------------------------

export async function startServer({ options = {} } = {}) {
  const engine = createEngine()
  let OWN = new Set()
  let HOSTS = new Set()
  let actualPort = 0

  // 只服务本机这个端口：Host 必须是它自己，挡掉 DNS 重新绑定的页面。
  const originAllowed = (req) => {
    const o = req.headers.origin
    return o === undefined || o === "null" || OWN.has(o)
  }
  const hostAllowed = (req) => HOSTS.has(String(req.headers.host || "").toLowerCase())
  const cors = (req) => {
    const o = req.headers?.origin
    const allow = o === "null" ? "null" : o && OWN.has(o) ? o : "null"
    return {
      "access-control-allow-origin": allow,
      "access-control-allow-headers": "content-type, x-magpie-quota-token",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      vary: "Origin",
    }
  }
  const send = (res, status, body, type = "application/json; charset=utf-8", withCors = true) => {
    const data = typeof body === "string" || body instanceof Uint8Array ? body : JSON.stringify(body)
    res.writeHead(status, {
      "content-type": type,
      "cache-control": "no-store",
      ...(withCors ? cors(res.req) : {}),
      "x-content-type-options": "nosniff",
    })
    res.end(data)
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1:" + (actualPort || 3491))
    const pathname = url.pathname
    if (!hostAllowed(req)) return send(res, 403, { error: "只服务于 magpie 窗口里的页面" }, undefined, false)
    if (!originAllowed(req)) return send(res, 403, { error: "来源不允许" })
    if (req.method === "OPTIONS") { res.writeHead(204, cors(req)); return res.end() }
    try {
      if (pathname === "/api/ping") return send(res, 200, { ok: true, port: actualPort })
      if (pathname === "/api/report") {
        const report = await engine.build(req.method === "POST")
        return send(res, 200, report)
      }
      if (pathname.startsWith("/api/")) return send(res, 404, { error: "没有这个接口" })

      // 静态资源
      const rel = pathname === "/" ? "index.html" : pathname.replace(/^\//, "")
      const file = join(UI_ROOT, rel)
      if (!file.startsWith(UI_ROOT)) return send(res, 403, { error: "forbidden" }, undefined, false)
      const data = await readFile(file).catch(() => null)
      if (!data) return send(res, 404, "没有这个文件", "text/plain; charset=utf-8", false)
      const type = MIME[extname(file).toLowerCase()] || "application/octet-stream"
      return send(res, 200, data, type, false)
    } catch (err) {
      if (res.headersSent) { try { res.end() } catch {} return }
      return send(res, 500, { error: String(err?.message || err) })
    }
  })

  const want = options.port ?? process.env.MAGPIE_QUOTA_PORT
  const port = want !== undefined && want !== "" && Number.isFinite(Number(want)) ? Number(want) : 3491

  const own = (p) => {
    actualPort = p
    OWN = new Set([`http://127.0.0.1:${p}`, `http://localhost:${p}`])
    HOSTS = new Set([`127.0.0.1:${p}`, `localhost:${p}`])
  }

  const bind = (p) => new Promise((resolve, reject) => {
    const onErr = (e) => { server.removeListener("listening", onOk); reject(e) }
    const onOk = () => { server.removeListener("error", onErr); resolve() }
    server.once("error", onErr)
    server.once("listening", onOk)
    server.listen(p, "127.0.0.1")
  })
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  // 端口固定为选项里的值（页面写死了它，无法先探测再决定），
  // 被上一次的宿主占着就等它松手，每秒重试，直到绑上为止。
  own(port)
  let listening = false
  let ready = null
  try {
    await bind(port)
    listening = true
    own(server.address().port)
    ready = Promise.resolve(actualPort)
  } catch (err) {
    if (err?.code !== "EADDRINUSE") throw err
    console.log(`[model-quota] ${port} 被上一次的宿主占着，等它松手`)
    ready = (async () => {
      for (;;) {
        await sleep(1000)
        try {
          await bind(port)
          own(server.address().port)
          listening = true
          console.log(`[model-quota] listening on http://127.0.0.1:${actualPort}`)
          return actualPort
        } catch (e) {
          if (e?.code !== "EADDRINUSE") throw e
        }
      }
    })()
    ready.catch(() => {})
  }
  if (listening) console.log(`[model-quota] listening on http://127.0.0.1:${actualPort}`)
  return { port: actualPort, listening, waiting: !listening, ready, server, close: async () => { if (server.listening) server.close() } }
}
