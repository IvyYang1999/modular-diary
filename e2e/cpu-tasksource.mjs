/** 事件和 rAF 都静。TaskDuration 3.6s/6s 但 ScriptDuration 只 0.048s——任务不在 JS 里。
    TaskOtherDuration 3.56s ≈ 全部。这是渲染管线内部任务。用 tracing 抓 5 秒看是哪个层。 */
import { chromium } from "playwright"
import { writeFileSync } from "node:fs"
const browser = await chromium.connectOverCDP("http://127.0.0.1:9333")
const page = browser.contexts()[0].pages()[0]
const session = await page.context().newCDPSession(page)
await session.send("Tracing.start", { transferMode: "ReturnAsStream" })
await new Promise((r) => setTimeout(r, 5000))
const endRes = await session.send("Tracing.end")
const stream = endRes.stream?.handle ?? endRes.stream
console.log("stream handle type:", typeof stream, JSON.stringify(endRes).slice(0,120))
// 收流
let data = ""
let pos = 0
while (true) {
  const chunk = await session.send("IO.read", { handle: stream })
  data += chunk.data ?? ""
  pos += chunk.data ? chunk.data.length : 0
  if (chunk.eof) break
}
await session.send("IO.close", { handle: stream })
writeFileSync("/tmp/modular-diary-trace.json", data)
// 粗统计：按 name 数事件
const events = JSON.parse(data).traceEvents
const byName = new Map()
for (const e of events) {
  if (e.ph !== "X" && e.ph !== "B") continue
  const key = e.name
  byName.set(key, (byName.get(key) ?? 0) + (e.dur || 1))
}
const top = [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
for (const [name, dur] of top) console.log((dur / 1000).toFixed(0).padStart(6) + "ms", name)
console.log("total events:", events.length)
await browser.close()
