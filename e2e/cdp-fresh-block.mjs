/** Inspect a fresh (no-text) modular-diary block's host/width chain in Live Preview. */
import { chromium } from "playwright"
const browser = await chromium.connectOverCDP("http://127.0.0.1:9333")
for (const ctx of browser.contexts()) {
  for (const page of ctx.pages()) {
    const n = await page.evaluate(() => document.querySelectorAll(".modular-diary-host").length).catch(() => 0)
    if (n === 0) continue
    console.log("PAGE:", await page.title(), "| hosts:", n)
    const probe = await page.evaluate(() => {
      return [...document.querySelectorAll(".modular-diary-host")].map((host) => {
        const chain = []
        let el = host
        while (el && chain.length < 4) {
          const r = el.getBoundingClientRect()
          chain.push({
            cls: (el.className || "").toString().slice(0, 55),
            inlineW: el.style.width || null,
            w: Math.round(r.width),
          })
          el = el.parentElement
        }
        return chain
      })
    })
    console.log(JSON.stringify(probe, null, 1))
  }
}
await browser.close()
