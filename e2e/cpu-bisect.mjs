import { chromium } from "playwright"
const browser = await chromium.connectOverCDP("http://127.0.0.1:9333")
const page = browser.contexts()[0].pages()[0]
// 打开含块笔记
await page.evaluate(async () => {
  const file = app.vault.getAbstractFileByPath("日记/2026.5毕业之前/2026.8.19.md")
  if (file) await app.workspace.getLeaf(false).openFile(file)
})
await page.waitForTimeout(2000)

import { execSync } from "node:child_process"
const readCpu = async () => {
  const ps = execSync(
    `ps -o %cpu= -p 93445`).toString().trim()
  return Number(ps)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

console.log("baseline CPU:", await readCpu())
await sleep(3000); console.log("  +3s:", await readCpu())

// 1) 隐藏所有 modular-diary 宿主
await page.evaluate(() => {
  document.querySelectorAll(".modular-diary-host").forEach((h) => (h.style.display = "none"))
})
await sleep(3000); console.log("modular-diary hidden +3s:", await readCpu())
await sleep(3000); console.log("  +6s:", await readCpu())

// 2) 恢复，隐藏 plan 斜纹（pattern 填充矩形）
await page.evaluate(() => {
  document.querySelectorAll(".modular-diary-host").forEach((h) => (h.style.display = ""))
  document.querySelectorAll(".modular-diary-plan-hatch").forEach((r) => (r.style.display = "none"))
})
await sleep(3000); console.log("hatch hidden +3s:", await readCpu())
await sleep(3000); console.log("  +6s:", await readCpu())

// 3) 恢复斜纹，看 CPU 回升吗
await page.evaluate(() => {
  document.querySelectorAll(".modular-diary-plan-hatch").forEach((r) => (r.style.display = ""))
})
await sleep(4000); console.log("hatch restored +4s:", await readCpu())
await sleep(4000); console.log("              +8s:", await readCpu())
await browser.close()
