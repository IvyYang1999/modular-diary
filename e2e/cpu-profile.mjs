/** 空闲态 CPU 取证：先开一篇含 modular-diary 块的笔记，录 8s Performance，统计热点函数 */
import { chromium } from "playwright"
const browser = await chromium.connectOverCDP("http://127.0.0.1:9333")
const page = browser.contexts()[0].pages()[0]

await page.evaluate(async () => {
  const file = app.vault.getAbstractFileByPath("日记/2026.5毕业之前/2026.8.19.md")
  if (file) await app.workspace.getLeaf(false).openFile(file)
})
await page.waitForTimeout(3000)

// CDP 性能录制（Chromium Tracing 简化版：用 Profiler）
const session = await page.context().newCDPSession(page)
await session.send("Profiler.enable")
await session.send("Profiler.setSamplingInterval", { interval: 1000 }) // 1ms
await session.send("Profiler.start")
await page.waitForTimeout(8000) // 空闲 8 秒
const { profile } = await session.send("Profiler.stop")

// 聚合自采样
const nodes = new Map()
for (const n of profile.nodes) nodes.set(n.id, n)
const hitCount = new Map()
let total = 0
const selfTime = new Map()
for (const s of profile.samples) {
  total++
  selfTime.set(s, (selfTime.get(s) ?? 0) + 1)
}
// hit 按函数聚合，含插件 URL 的单独列出
const fnHits = new Map()
for (const [id, c] of selfTime) {
  const n = nodes.get(id)
  if (!n) continue
  const cf = n.callFrame
  const url = cf.url || ""
  const key = `${cf.functionName || "(anon)"} @ ${url.split("/").slice(-1)[0] || "native"}:${cf.lineNumber}`
  fnHits.set(key, (fnHits.get(key) ?? 0) + c)
}
const top = [...fnHits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
console.log("total samples:", total, "(1ms each ≈", total, "ms CPU)")
for (const [fn, c] of top) {
  console.log(String((c / total * 100).toFixed(1)).padStart(5) + "%", fn)
}
// modular-diary 相关
const modularDiaryHits = [...fnHits.entries()].filter(([k]) => k.includes("modular-diary") || k.includes("main.js"))
const modularDiaryTotal = modularDiaryHits.reduce((s, [, c]) => s + c, 0)
console.log("\nmodular-diary(main.js) 合计:", (modularDiaryTotal / total * 100).toFixed(1) + "%")
for (const [fn, c] of modularDiaryHits.sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log("  ", (c / total * 100).toFixed(1) + "%", fn)
}
await browser.close()
