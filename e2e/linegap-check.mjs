/** 本地复现：p(pre-wrap, "a\nb\n\nc") vs textarea(同文本) 的行距一致性 */
import { chromium } from "playwright"
import path from "node:path"
import fs from "node:fs"
import os from "os"
import { fileURLToPath } from "node:url"
const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(os.tmpdir(), "modular-diary-linegap")
fs.mkdirSync(out, { recursive: true })
const css = fs.readFileSync(path.join(here, "../styles.css"), "utf8")
const html = `<!doctype html><html><head><style>${css}
body { background: #fff; padding: 20px; }
</style></head><body>
<div class="modular-diary-text-pane"><div class="modular-diary-text-host"><p>OK。我决定每天只看1集。不太快看完。
今天这一集讲了11的旅程。很精彩。

感觉拍得很好。</p></div></div>
<textarea class="modular-diary-text-inline">OK。我决定每天只看1集。不太快看完。
今天这一集讲了11的旅程。很精彩。

感觉拍得很好。</textarea>
</body></html>`
fs.writeFileSync(path.join(out, "i.html"), html)
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto("file://" + path.join(out, "i.html"))
const m = await page.evaluate(() => {
  const p = document.querySelector(".modular-diary-text-host p")
  const ta = document.querySelector("textarea")
  const r1 = [...p.getClientRects()].map((r) => Math.round(r.height))
  const taCs = getComputedStyle(ta)
  return {
    pLineHeightsPx: r1,
    pLineHeight: getComputedStyle(p).lineHeight,
    pWhiteSpace: getComputedStyle(p).whiteSpace,
    taLineHeight: taCs.lineHeight,
    taScrollHeight: ta.scrollHeight,
    pHeight: Math.round(p.getBoundingClientRect().height),
  }
})
console.log(JSON.stringify(m, null, 1))
await browser.close()
