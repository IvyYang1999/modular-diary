/** 插件全关后还剩多少？如果还高就是 Obsidian 核心（同步/索引/已关插件的残留）。 */
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
const before = await page.evaluate(() => [...app.plugins.enabledPlugins])
console.log("还在启用:", before.length, "个")
console.log("部分关闭后:", await avg(6000))
// 全关
await page.evaluate(async (list) => {
  for (const id of list) { try { await app.plugins.disablePlugin(id) } catch {} }
}, before)
await sleep(2000)
console.log("全插件禁用:", await avg(8000))
// 再开 modular-diary 单独测！
await page.evaluate(async () => { await app.plugins.enablePlugin("modular-diary") })
await sleep(2500)
console.log("仅 modular-diary:", await avg(8000))
await browser.close()
