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
await page.waitForTimeout(2000)
console.log("A baseline:", await avg(8000))
// 把 modular-diary 宿主整体 visibility hidden（保留布局，不参与绘制）
await page.evaluate(() => {
  const st = document.createElement("style"); st.id = "x1"
  st.textContent = ".modular-diary-host { visibility: hidden !important }"
  document.head.appendChild(st)
})
console.log("B host-invisible:", await avg(8000))
await page.evaluate(() => document.getElementById("x1")?.remove())
// 隐藏 sync 状态图标（对照）
await page.evaluate(() => {
  const st = document.createElement("style"); st.id = "x2"
  st.textContent = ".sync-status-icon { display: none !important }"
  document.head.appendChild(st)
})
console.log("C sync-icon-hidden:", await avg(8000))
await page.evaluate(() => {
  const st = document.createElement("style"); st.id = "x3"
  st.textContent = ".sync-status-icon { display: none !important } .modular-diary-host { visibility: hidden !important }"
  document.head.appendChild(st)
})
console.log("D both:", await avg(8000))
await page.evaluate(() => { document.getElementById("x3")?.remove() })
console.log("E restored:", await avg(8000))
await browser.close()
