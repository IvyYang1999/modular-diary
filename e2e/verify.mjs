import { chromium } from "playwright"
import path from "node:path"
import { fileURLToPath } from "node:url"
const here = path.dirname(fileURLToPath(import.meta.url))
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto("file://" + path.join(here, ".smoke", "index.html"))
await page.waitForSelector("svg.modular-diary-svg")
const counts = await page.evaluate(() => ({
  blocks: document.querySelectorAll("rect.modular-diary-block").length,
  plans: document.querySelectorAll("rect.modular-diary-plan").length,
  durations: [...document.querySelectorAll("text.modular-diary-duration")].map((t) => t.textContent),
  thin: document.querySelectorAll("text.modular-diary-thin").length,
  annos: [...document.querySelectorAll("text.modular-diary-anno")].map((t) => t.textContent),
  hours: [...document.querySelectorAll("text.modular-diary-hour")].map((t) => t.textContent).join(","),
}))
console.log(JSON.stringify(counts, null, 2))
await browser.close()
