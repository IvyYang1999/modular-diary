/** 当前页面 totalHosts=0——调试实例重启后笔记没打开！先弄清哪个页面有块，再量真实基线 */
import { chromium } from "playwright"
import { execSync } from "node:child_process"
const browser = await chromium.connectOverCDP("http://127.0.0.1:9333")
for (const ctx of browser.contexts()) {
  for (const page of ctx.pages()) {
    const t = await page.title().catch(() => "?")
    const n = await page.evaluate(() => document.querySelectorAll(".modular-diary-host").length).catch(() => -1)
    console.log(`page: ${t} | modular-diary hosts: ${n}`)
  }
}
const page = browser.contexts()[0].pages()[0]
// 打开笔记
await page.evaluate(async () => {
  const file = app.vault.getAbstractFileByPath("日记/2026.5毕业之前/2026.8.19.md")
  if (file) await app.workspace.getLeaf(false).openFile(file)
})
await new Promise((r) => setTimeout(r, 2500))
const n2 = await page.evaluate(() => document.querySelectorAll(".modular-diary-host").length)
console.log("after open:", n2, "hosts")
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const avg = async (ms) => {
  const vals = []; const t0 = Date.now()
  while (Date.now() - t0 < ms) { vals.push(Number(execSync("ps -o %cpu= -p 93445").toString().trim())); await sleep(500) }
  return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)
}
console.log("with-note-open:", await avg(8000))
await browser.close()
