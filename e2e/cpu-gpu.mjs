/** CPU 都不降——那 56% 大概率是「别的窗口/别的 tab」或 GPU 合成在 renderer 进程里的占用。
    检查：1) 有多少 workspace 视图在渲染 modular-diary（隐藏 tab 也算 DOM）2) 任务管理器口径。 */
import { chromium } from "playwright"
const browser = await chromium.connectOverCDP("http://127.0.0.1:9333")
const page = browser.contexts()[0].pages()[0]
const info = await page.evaluate(() => {
  const hosts = [...document.querySelectorAll(".modular-diary-host")]
  const visible = hosts.filter((h) => h.offsetParent !== null)
  const hiddenTabs = hosts.length - visible.length
  return {
    totalHosts: hosts.length,
    visibleHosts: visible.length,
    hiddenTabHosts: hiddenTabs,
    bodyChildren: document.body.children.length,
  }
})
console.log(JSON.stringify(info))
// 统计隐藏 tab 里的 host：把隐藏的全部 display:none 再看
const { execSync } = await import("node:child_process")
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const avg = async (ms) => {
  const vals = []; const t0 = Date.now()
  while (Date.now() - t0 < ms) { vals.push(Number(execSync("ps -o %cpu= -p 93445").toString().trim())); await sleep(500) }
  return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)
}
console.log("baseline:", await avg(8000))
await page.evaluate(() => {
  const st = document.createElement("style"); st.id = "x9"
  st.textContent = ".modular-diary-host { display: none !important }"
  document.head.appendChild(st)
})
console.log("all-hosts-display-none:", await avg(8000))
await page.evaluate(() => document.getElementById("x9")?.remove())
await browser.close()
