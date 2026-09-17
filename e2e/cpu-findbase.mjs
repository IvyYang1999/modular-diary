/** 结论坐实前的最后一查：modular-diary 完全不参与时，这 ~57% 是谁的。逐插件二分。 */
import { chromium } from "playwright"
import { execSync } from "node:child_process"
const browser = await chromium.connectOverCDP("http://127.0.0.1:9333")
const page = browser.contexts()[0].pages()[0]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const avg = async (ms) => {
  const vals = []; const t0 = Date.now()
  while (Date.now() - t0 < ms) { vals.push(Number(execSync("ps -o %cpu= -p 93445").toString().trim())); await sleep(400) }
  return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)
}
// 保持 modular-diary 禁用。先量，然后逐个关大户（omnisearch/copilot/excalidraw/widgets）
console.log("baseline(all on, modular-diary off):", await avg(6000))
const suspects = ["omnisearch", "copilot", "widgets", "obsidian-excalidraw-plugin", "easy-tracker", "realclaudian", "obsidian-local-rest-api"]
for (const p of suspects) {
  await page.evaluate(async (id) => { try { await app.plugins.disablePlugin(id) } catch {} }, p)
  await sleep(1500)
  const v = await avg(5000)
  console.log(`-${p}: ${v}`)
}
await browser.close()
