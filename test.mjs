// 单独跑一遍估算，用真实数据核对结果。不启动服务。
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { buildReport, indexUsage } from "./lib/report.mjs"

const dir = path.join(os.homedir(), ".config", "magpie")

async function quotas() {
  const res = await fetch("http://127.0.0.1:3425/v1/magpie/quotas?kept=1")
  if (!res.ok) throw new Error("gateway quotas HTTP " + res.status)
  return (await res.json()).data ?? []
}

function readUsage() {
  const rows = []
  for (const line of fs.readFileSync(path.join(dir, "usage.jsonl"), "utf8").split("\n")) {
    if (!line.trim()) continue
    try { rows.push(JSON.parse(line)) } catch {}
  }
  return rows
}

const now = Date.now()
const t0 = Date.now()
const usageRows = readUsage()
console.log(`读取 usage ${usageRows.length} 条，用时 ${Date.now() - t0} 毫秒`)
const hist = JSON.parse(fs.readFileSync(path.join(dir, "quota-history.json"), "utf8"))
const idx = indexUsage(usageRows, { now })

const quotaRecords = await quotas()
const t1 = Date.now()
const report = buildReport({ quotaRecords, history: hist, usage: idx, now })
console.log(`估算用时 ${Date.now() - t1} 毫秒；有数据的额度池 ${report.pools.length} 个；跳过 ${JSON.stringify(report.skipped)}`)
console.log(`\n合计剩余 ${(report.totalTokens / 1e6).toFixed(1)} M tokens\n`)
console.log("模型".padEnd(30), "剩余(M)".padStart(10), "日均(M)".padStart(10), "可用天数".padStart(10), "池数".padStart(4))
for (const m of report.models.slice(0, 25)) {
  console.log(
    String(m.name).padEnd(30),
    (m.tokens / 1e6).toFixed(2).padStart(10),
    (m.dailyTokens / 1e6).toFixed(2).padStart(10),
    (m.days == null ? "-" : m.days.toFixed(1)).padStart(10),
    String(m.pools.length).padStart(4),
  )
}
console.log("\n前 8 个额度池明细：")
for (const p of report.pools.sort((a, b) => b.tokens - a.tokens).slice(0, 8)) {
  console.log(`  ${p.pool}  余 ${p.remaining.toFixed(1)}%  ${(p.tokens / 1e6).toFixed(2)}M tokens  每百分比 ${(p.tpp / 1000).toFixed(0)}k  ${p.method} p=${p.points}  模型 ${p.models.map((m) => `${m.id}:${(m.tokens / 1e6).toFixed(2)}M`).join(", ")}`)
}
