import { chromium } from "playwright"
import { execSync } from "node:child_process"
const browser = await chromium.connectOverCDP("http://127.0.0.1:9333")
const page = browser.contexts()[0].pages()[0]
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

// 恢复 overflow，做逐组件二分：隐藏不同元素
await page.evaluate(() => {
  document.querySelectorAll("svg.modular-diary-svg").forEach((s) => (s.style.overflow = ""))
})
console.log("baseline(8s):", await avg(8000))

// 隐藏整个 modular-diary-host（对照组）
await page.evaluate(() => document.querySelectorAll(".modular-diary-host").forEach((h) => (h.style.display = "none")))
console.log("host-hidden(8s):", await avg(8000))
await page.evaluate(() => document.querySelectorAll(".modular-diary-host").forEach((h) => (h.style.display = "")))

// 隐藏所有 grid slot 的 transition（看是不是 transition 循环触发）
await page.evaluate(() => {
  const style = document.createElement("style")
  style.id = "modular-diary-no-trans"
  style.textContent = ".modular-diary-slot { transition: none !important }"
  document.head.appendChild(style)
})
console.log("no-transition(8s):", await avg(8000))
await page.evaluate(() => document.getElementById("modular-diary-no-trans")?.remove())

// 隐藏 slot hover outline 相关（outline-color transition）
await page.evaluate(() => {
  const style = document.createElement("style")
  style.id = "modular-diary-no-outl"
  style.textContent = ".modular-diary-slot { outline: none !important; transition: none !important } .modular-diary-handle { display: none !important }"
  document.head.appendChild(style)
})
console.log("no-outline-handle(8s):", await avg(8000))
await page.evaluate(() => document.getElementById("modular-diary-no-outl")?.remove())
await browser.close()
