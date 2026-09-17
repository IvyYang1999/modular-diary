import { chromium } from "playwright"
import path from "node:path"
import { fileURLToPath } from "node:url"
const here = path.dirname(fileURLToPath(import.meta.url))
const browser = await chromium.connectOverCDP("http://127.0.0.1:9333")
for (const ctx of browser.contexts()) {
  for (const page of ctx.pages()) {
    if (!(await page.evaluate(() => [...document.querySelectorAll(".modular-diary-host")].some((h) => h.offsetParent !== null)).catch(() => false))) continue
    const el = page.locator(".modular-diary-host:visible").first()
    await el.scrollIntoViewIfNeeded()
    await page.waitForTimeout(500)
    await el.screenshot({ path: path.join(here, ".smoke", "modular-diary-live-cdp.png") })
    console.log("saved e2e/.smoke/modular-diary-live-cdp.png")
  }
}
await browser.close()
