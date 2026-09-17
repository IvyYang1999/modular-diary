/**
 * Playwright smoke: bundle core parser + SVG builder, render the sample day
 * in a real Chromium page, screenshot as acceptance evidence (经验.md:
 * 「UI 功能可用 Playwright 全自动 GUI 验收」).
 */
import esbuild from "esbuild"
import { chromium } from "playwright"
import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(here, ".smoke")
fs.mkdirSync(out, { recursive: true })

const entry = `
import { parseTimeline } from "../../src/core/parser"
import { renderTimelineSvg } from "../../src/render/svg-builder"
import { DEFAULT_TYPE_COLORS } from "../../src/core/type-colors"

const source = \`date: 2026-08-18
range: 7-23
---
plan 09:00-12:00 math 线代第一章
plan 14:00-17:00 micro 微观
07:00-09:00 sleep 睡懒觉了
09:15-12:15 math 李林线代第一章·行列式
12:15-13:30 meal 午饭+午休
13:30-17:00 micro 微观 P358-369 + 课后题
14:00-15:00 english 并列：背单词（并行日程演示）
17:10-17:30 meal 晚饭吃太多，昏沉
19:00-20:00 english 复习 list 5
20:00-21:00 micro 微观收尾
21:00-22:00 math 整理笔记
00:30-01:30 sleep 熬夜刷手机
@21:40 头晕，脑力低，提前收工
\`
const doc = parseTimeline(source)
document.getElementById("app").innerHTML = renderTimelineSvg(doc, { typeColors: DEFAULT_TYPE_COLORS })
window.__errors = doc.errors
`

fs.writeFileSync(path.join(out, "entry.ts"), entry)
await esbuild.build({
  entryPoints: [path.join(out, "entry.ts")],
  bundle: true,
  format: "iife",
  outfile: path.join(out, "bundle.js"),
  logLevel: "silent",
})

const html = `<!doctype html><html><body style="margin:24px;background:#fafafa;font-family:-apple-system,sans-serif"><div id="app"></div><script>${fs.readFileSync(path.join(out, "bundle.js"), "utf8")}</script></body></html>`
fs.writeFileSync(path.join(out, "index.html"), html)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 480, height: 1100 } })
await page.goto("file://" + path.join(out, "index.html"))
await page.waitForSelector("svg.modular-diary-svg")

const errors = await page.evaluate(() => window.__errors)
if (errors.length > 0) {
  console.error("parse errors:", errors)
  process.exit(1)
}
const shot = path.join(out, "modular-diary-smoke.png")
await page.locator("#app").screenshot({ path: shot })
await browser.close()
console.log("OK screenshot:", shot)
