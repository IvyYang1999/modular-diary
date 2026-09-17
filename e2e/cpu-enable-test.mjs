/** 关键对照：当前 modular-diary 被禁用，CPU 依然 57.6% —— 说明这 57% 根本不是 modular-diary！
 *  现场启用 modular-diary → 打开含块笔记 → 量 CPU，看增量。 */
import { chromium } from "playwright"
import { execSync } from "node:child_process"
const browser = await chromium.connectOverCDP("http://127.0.0.1:9333")
const page = browser.contexts()[0].pages()[0]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const avg = async (ms) => {
  const vals = []; const t0 = Date.now()
  while (Date.now() - t0 < ms) { vals.push(Number(execSync("ps -o %cpu= -p 93445").toString().trim())); await sleep(500) }
  return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)
}

console.log("1. 禁用态基线:", await avg(6000))
// 启用 modular-diary
await page.evaluate(async () => { await app.plugins.enablePlugin("modular-diary") })
await sleep(2500)
await page.evaluate(async () => {
  const file = app.vault.getAbstractFileByPath("日记/2026.5毕业之前/2026.8.19.md")
  if (file) await app.workspace.getLeaf(false).openFile(file)
})
await sleep(3000)
const hosts = await page.evaluate(() => document.querySelectorAll(".modular-diary-host").length)
console.log("2. hosts:", hosts)
console.log("2. 启用+笔记打开:", await avg(8000))
// 禁回去再量
await page.evaluate(async () => { await app.plugins.disablePlugin("modular-diary") })
await sleep(2000)
console.log("3. 再禁用:", await avg(6000))
await browser.close()
