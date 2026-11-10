// 页面逻辑：读 api/report，渲染按模型汇总的剩余 token。
const qs = new URLSearchParams(location.search)
const theme = qs.get("theme")
if (theme === "dark" || theme === "light") document.documentElement.dataset.theme = theme

const KEY = document.querySelector('meta[name="magpie-quota-key"]')?.content || ""
const expanded = new Set()

const $ = (id) => document.getElementById(id)

function fmtTokens(n) {
  if (!Number.isFinite(n)) return "—"
  if (n >= 1e8) return (n / 1e8).toFixed(2) + " 亿"
  if (n >= 1e4) return (n / 1e4).toFixed(1) + " 万"
  return Math.round(n).toLocaleString("zh-CN")
}

function fmtDays(d) {
  if (d == null || !Number.isFinite(d)) return "—"
  if (d < 1) return (d * 24).toFixed(1) + " 小时"
  if (d < 1000) return d.toFixed(1) + " 天"
  return "> 1000 天"
}

function fmtTime(ts) {
  if (!ts) return ""
  const d = new Date(ts)
  return d.toLocaleString("zh-CN", { hour12: false })
}

function el(tag, cls, text) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}

function render(report) {
  $("total").textContent = fmtTokens(report.totalTokens)
  $("total-note").textContent = "覆盖 " + report.models.length + " 个模型"
  $("modelCount").textContent = String(report.models.length)
  $("poolCount").textContent = String(report.pools.length)
  $("stamp").textContent = "更新于 " + new Date(report.generatedAt).toLocaleTimeString("zh-CN", { hour12: false })

  const tbody = $("rows")
  tbody.innerHTML = ""
  const total = report.totalTokens || 1

  if (!report.models.length) {
    $("empty").hidden = false
    $("empty").textContent = "还没有可估算的额度窗口。先让 magpie 记录一些用量，或等额度读数攒够几个点。"
  } else {
    $("empty").hidden = true
  }

  for (const m of report.models) {
    const tr = el("tr", "model-row")
    tr.dataset.id = m.id

    const tdModel = el("td", "col-model")
    const name = el("div", "model-name")
    name.appendChild(el("span", "dot"))
    name.appendChild(el("span", "nm", m.name || m.id || "（未分模型）"))
    tdModel.appendChild(name)
    const bar = el("div", "bar")
    const fill = el("i")
    fill.style.width = Math.max(1, Math.min(100, (m.tokens / total) * 100)) + "%"
    bar.appendChild(fill)
    tdModel.appendChild(bar)
    tr.appendChild(tdModel)

    tr.appendChild(el("td", "num", fmtTokens(m.tokens)))
    tr.appendChild(el("td", "num", ((m.tokens / total) * 100).toFixed(1) + "%"))
    tr.appendChild(el("td", "num", m.dailyTokens > 0 ? fmtTokens(m.dailyTokens) : "—"))
    const tdDays = el("td", "num")
    tdDays.textContent = fmtDays(m.days)
    if (m.days != null && m.days < 1) tdDays.classList.add("warn")
    tr.appendChild(tdDays)
    tr.appendChild(el("td", "num", String((m.pools || []).length)))

    tr.addEventListener("click", () => {
      if (expanded.has(m.id)) expanded.delete(m.id)
      else expanded.add(m.id)
      render(report)
    })
    tbody.appendChild(tr)

    if (expanded.has(m.id)) {
      const det = el("tr", "detail-row")
      const cell = el("td")
      cell.colSpan = 6
      const box = el("div", "detail")
      const table = el("table")
      const head = el("tr")
      head.appendChild(el("th", null, "额度窗口"))
      head.appendChild(el("th", "num", "摊到本模型"))
      head.appendChild(el("th", "num", "本模型占比"))
      head.appendChild(el("th", "num", "窗口剩余"))
      const thead = el("thead")
      thead.appendChild(head)
      table.appendChild(thead)
      const tb = el("tbody")
      for (const p of m.pools || []) {
        const r = el("tr")
        r.appendChild(el("td", null, p.pool))
        r.appendChild(el("td", "num", fmtTokens(p.tokens)))
        r.appendChild(el("td", "num", p.share != null ? (p.share * 100).toFixed(1) + "%" : "—"))
        r.appendChild(el("td", "num", fmtTokens(p.poolTokens)))
        tb.appendChild(r)
      }
      table.appendChild(tb)
      box.appendChild(table)
      cell.appendChild(box)
      det.appendChild(cell)
      tbody.appendChild(det)
    }
  }

  const pbody = $("poolRows")
  pbody.innerHTML = ""
  const pools = (report.pools || []).slice().sort((a, b) => b.tokens - a.tokens)
  if (!pools.length) {
    $("poolEmpty").hidden = false
    $("poolEmpty").textContent = "没有可估算的额度窗口。"
  } else {
    $("poolEmpty").hidden = true
  }
  for (const p of pools) {
    const tr = el("tr")
    tr.appendChild(el("td", "col-model", p.pool))
    tr.appendChild(el("td", "num", Number(p.remaining).toFixed(1) + "%"))
    tr.appendChild(el("td", "num", p.tpp ? fmtTokens(p.tpp) : "—"))
    const tdToken = el("td", "num")
    if (p.blocked) tdToken.textContent = "已用完（" + (p.blockedBy || "") + "）"
    else if (p.lowConfidence) tdToken.textContent = fmtTokens(p.tokens) + "（按历史轮次估）"
    else tdToken.textContent = fmtTokens(p.tokens)
    if (p.blocked) tdToken.classList.add("warn")
    tr.appendChild(tdToken)
    tr.appendChild(el("td", "num", p.roundDrop != null ? p.roundDrop.toFixed(0) + "%" : "—"))
    tr.appendChild(el("td", "num", p.roundCalls != null ? p.roundCalls + " 条" : "—"))
    tr.appendChild(el("td", "num", p.resetsAt ? fmtTime(p.resetsAt) : "—"))
    pbody.appendChild(tr)
  }

  const s = report.skipped || {}
  const blocked = (report.pools || []).filter((p) => p.blocked).length
  const lowConf = (report.pools || []).filter((p) => p.lowConfidence).length
  const skipped = []
  if (blocked) skipped.push(blocked + " 个窗口已用完，所在账号不计入")
  if (lowConf) skipped.push(lowConf + " 个窗口记录不足，按历史轮次估算")
  if (s.noHistory) skipped.push(s.noHistory + " 个窗口没有历史读数")
  if (s.noUsage) skipped.push(s.noUsage + " 个窗口没有可对齐的用量记录")
  $("note").innerHTML =
    "口径：token = 输入 + 输出 + 缓存读 + 缓存写 + 推理。" +
    "每个窗口的“每 1% 值多少 token”由该账号历史上的百分比下降与实际 token 消耗推得；" +
    "剩余 token = 剩余百分比 × 每百分比 token，再按窗口内各模型的 token 占比摊到模型。" +
    (skipped.length ? " 未计入：" + skipped.join("；") + "。" : "") +
    (report.source === "file" ? " 当前额度取自本地快照（网关未应答）。" : "")
  $("note").appendChild(document.createElement("br"))
  $("note").appendChild(el("span", null, "数据源：magpie 的 usage.jsonl 与 quota-history.json，当前额度来自网关 /v1/magpie/quotas。"))
}

async function load(force, attempt = 0) {
  const btn = $("refresh")
  btn.disabled = true
  btn.textContent = "刷新中…"
  try {
    const query = force ? "?force=1" : ""
    const init = { method: force ? "POST" : "GET", headers: { "x-magpie-quota-key": KEY } }
    // 直接访问时两种写法等价；经 magpie 的 service 代理、页面挂在子路径下时，
    // 只有相对路径会带上代理前缀，所以先用相对路径，404 再退回根路径。
    let res
    try {
      res = await fetch("api/report" + query, init)
      if (res.status === 404) res = await fetch("/api/report" + query, init)
    } catch {
      res = await fetch("/api/report" + query, init)
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      const e = new Error(body.error || "HTTP " + res.status)
      e.http = true
      e.status = res.status
      throw e
    }
    render(await res.json())
    try { sessionStorage.removeItem("mq-reload") } catch {}
  } catch (err) {
    // 宿主重启后旧页面手里的口令会失效：重新载入一次拿新口令
    if (err.http && err.status === 401) {
      try {
        if (!sessionStorage.getItem("mq-reload")) {
          sessionStorage.setItem("mq-reload", "1")
          location.reload()
          return
        }
      } catch {}
    }
    // 只有网络错误才重试；HTTP 错误直接显示，避免一直停在“正在连接”
    if (!err.http && attempt < 20) {
      await new Promise((r) => setTimeout(r, 1000))
      if (attempt === 0) $("stamp").textContent = "正在连接服务…"
      return load(force, attempt + 1)
    }
    $("stamp").textContent = "加载失败：" + String(err.message || err)
  } finally {
    btn.disabled = false
    btn.textContent = "刷新"
  }
}

$("refresh").addEventListener("click", () => load(true))
load(false)
setInterval(() => load(false), 60000)
// 切回这个页签时立刻拉一次，避免看到切走之前的旧表
window.addEventListener("focus", () => load(false))
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(false) })
