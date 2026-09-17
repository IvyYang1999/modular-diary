/** longtask 观察器 + 检查 will-change/合成层 */
import { chromium } from "playwright"
const browser = await chromium.connectOverCDP("http://127.0.0.1:9333")
const page = browser.contexts()[0].pages()[0]

const info = await page.evaluate(() => new Promise((resolve) => {
  const tasks = []
  const po = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) tasks.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) })
  })
  po.observe({ entryTypes: ["longtask"] })
  setTimeout(() => {
    // 找有 transform/will-change/filter 的元素（可能强制合成）
    const promoted = [...document.querySelectorAll(".modular-diary-container, .modular-diary-container *")]
      .filter((el) => {
        const cs = getComputedStyle(el)
        return cs.willChange !== "auto" || cs.filter !== "none" || cs.transform !== "none" || cs.backdropFilter !== "none" || cs.mixBlendMode !== "normal"
      })
      .slice(0, 10)
      .map((el) => ({ cls: (el.className || "").toString().slice(0, 40), willChange: getComputedStyle(el).willChange, filter: getComputedStyle(el).filter, mix: getComputedStyle(el).mixBlendMode }))
    resolve({ longtasks5s: tasks, promoted })
  }, 5000)
}))
console.log(JSON.stringify(info, null, 1))
await browser.close()
