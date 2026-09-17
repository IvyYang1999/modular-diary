import { chromium } from "playwright"
import { execSync } from "node:child_process"
const browser = await chromium.connectOverCDP("http://127.0.0.1:9333")
const page = browser.contexts()[0].pages()[0]
await page.evaluate(async () => {
  const file = app.vault.getAbstractFileByPath("日记/2026.5毕业之前/2026.8.19.md")
  if (file) await app.workspace.getLeaf(false).openFile(file)
})
await page.waitForTimeout(3000)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const avg = async (ms) => {
  const vals = []
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    vals.push(Number(execSync("ps -o %cpu= -p 93445").toString().trim()))
    await sleep(500)
  }
  return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)
}

console.log("baseline(10s):", await avg(10000))
await page.evaluate(() => document.querySelectorAll(".modular-diary-plan-hatch").forEach((r) => (r.style.display = "none")))
console.log("no-hatch(10s):", await avg(10000))
await page.evaluate(() => document.querySelectorAll(".modular-diary-plan-hatch").forEach((r) => (r.style.display = "")))
console.log("hatch-back(10s):", await avg(10000))
// 再试：整个 svg overflow 改 hidden
await page.evaluate(() => document.querySelectorAll("svg.modular-diary-svg").forEach((s) => (s.style.overflow = "hidden")))
console.log("svg-overflow-hidden(10s):", await avg(10000))
await browser.close()
