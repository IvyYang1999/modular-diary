import { chromium } from "playwright"
import path from "node:path"
import fs from "node:fs"
import os from "os"
import { fileURLToPath } from "node:url"
const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(os.tmpdir(), "grip")
fs.mkdirSync(out, { recursive: true })
const css = fs.readFileSync(path.join(here, "../styles.css"), "utf8")
const html = `<!doctype html><html><head><style>${css}</style></head><body style="background:#fff;padding:40px">
<div class="modular-diary-slot" style="position:relative;width:300px;height:100px;background:#eee">
  <button class="modular-diary-slot-grip" style="opacity:1"><span></span><span></span><span></span><span></span><span></span><span></span></button>
</div></body></html>`
fs.writeFileSync(path.join(out, "i.html"), html)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 400, height: 200 }, deviceScaleFactor: 2 })
await page.goto("file://" + path.join(out, "i.html"))
const m = await page.evaluate(() => {
  const g = document.querySelector(".modular-diary-slot-grip")
  const cs = getComputedStyle(g)
  const r = g.getBoundingClientRect()
  return {
    size: `${Math.round(r.width)}x${Math.round(r.height)}`,
    display: cs.display,
    before: cs.content,
    dots: [...document.querySelectorAll(".modular-diary-slot-grip")].length,
  }
})
console.log(JSON.stringify(m))
await page.screenshot({ path: path.join(here, ".smoke", "grip-check.png") })
await browser.close()
console.log("shot saved")
