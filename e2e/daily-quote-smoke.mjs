/** Product contracts for the Daily Quote slot (tinted line) and its library editor. */
import esbuild from "esbuild"
import { chromium } from "playwright"
import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"
import os from "node:os"

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(os.tmpdir(), "modular-diary-daily-quote-smoke")
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })

fs.writeFileSync(path.join(out, "obsidian-stub.ts"), `
export function setIcon(el: HTMLElement, name: string): void {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.dataset.icon = name
  svg.setAttribute("viewBox", "0 0 24 24")
  el.appendChild(svg)
}
`)

fs.writeFileSync(path.join(out, "entry.ts"), `
import { renderDailyQuoteInto } from "${path.join(here, "../src/render/daily-quote-view")}"
import { renderDailyQuoteSettings } from "${path.join(here, "../src/daily-quote-settings")}"
import { dailyQuoteForDate, resolveQuoteInk } from "${path.join(here, "../src/core/daily-quotes")}"
import { configureI18n } from "${path.join(here, "../src/i18n")}"

HTMLElement.prototype.empty = function () { this.replaceChildren() }
for (const [name, tag] of [["createDiv", "div"], ["createSpan", "span"]] as const) {
  HTMLElement.prototype[name] = function (opts: any = {}) { return this.createEl(tag, opts) }
}
HTMLElement.prototype.createEl = function (tag: string, opts: any = {}) {
  const el = document.createElement(tag)
  if (opts.cls) el.className = opts.cls
  if (opts.text !== undefined) el.textContent = opts.text
  if (opts.attr) for (const [key, value] of Object.entries(opts.attr)) el.setAttribute(key, String(value))
  this.appendChild(el); return el
}

configureI18n(() => "zh")
window.__events = []
window.__saves = 0
window.__failNextSave = false
const colors = { 阅读: "#9bd17b", 运动: "#c8b6e2", 开发: "#7fd4c1" }
const settings = {
  dailyQuotes: [
    { id: "one", text: "我们先塑造习惯，然后习惯塑造我们。", author: "John Dryden", order: 0, ink: "阅读" },
    { id: "two", text: "今天也要留一点时间给自己。", author: "", order: 1 },
  ],
  dailyQuoteInk: "运动",
  spanTypeColors: colors,
}
window.__settings = settings
const host = {
  settings,
  saveSettings: async () => {
    window.__saves += 1
    if (window.__failNextSave) { window.__failNextSave = false; throw new Error("fixture save failure") }
  },
}
const paint = (slotId: string, quote: any, globalInk = settings.dailyQuoteInk) => renderDailyQuoteInto(
  document.querySelector<HTMLElement>(slotId)!,
  quote,
  { inkColor: resolveQuoteInk(quote, globalInk, settings.spanTypeColors) },
  { onEdit: () => window.__events.push("edit:" + slotId) },
)
window.__paintAll = () => {
  paint("#own-ink", settings.dailyQuotes[0])
  paint("#global-ink", settings.dailyQuotes[1])
  paint("#empty", null)
  // Global ink "" (不着色): the slot stays on the block background.
  paint("#untinted", { id: "x", text: "无色的一句。", author: "", order: 0 }, "")
}
window.__paintAll()
window.__quoteForDate = (date: string) => dailyQuoteForDate(settings.dailyQuotes, date)?.id
window.__renderSettings = () => renderDailyQuoteSettings(document.querySelector<HTMLElement>("#settings")!, host)
window.__renderSettings()
`)

await esbuild.build({
  entryPoints: [path.join(out, "entry.ts")],
  bundle: true,
  format: "iife",
  outfile: path.join(out, "bundle.js"),
  logLevel: "silent",
  plugins: [{ name: "obsidian-stub", setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: path.join(out, "obsidian-stub.ts") }))
  } }],
})

fs.copyFileSync(path.join(here, "../styles.css"), path.join(out, "styles.css"))
fs.writeFileSync(path.join(out, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="styles.css"><style>
body{margin:0;background:var(--background-primary);color:var(--text-normal);font-family:-apple-system,"PingFang SC",sans-serif;font-size:14px}
#fixture{display:grid;gap:16px;width:320px;margin:24px}#settings{width:560px;margin:24px}
.modular-diary-slot-quote{position:relative;inset:auto;width:100%;height:auto;min-height:120px}
</style></head><body>
<div class="modular-diary-container"><main id="fixture">
  <section id="own-ink" class="modular-diary-slot modular-diary-slot-quote"></section>
  <section id="global-ink" class="modular-diary-slot modular-diary-slot-quote"></section>
  <section id="untinted" class="modular-diary-slot modular-diary-slot-quote"></section>
  <section id="empty" class="modular-diary-slot modular-diary-slot-quote"></section>
</main></div>
<section id="settings" class="modular-diary-settings-modal modular-diary-focused-settings"></section>
<script src="bundle.js"></script></body></html>`)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 1 })
page.on("pageerror", (error) => console.error("DAILY QUOTE PAGE ERROR", error))
const theme = (dark) => page.evaluate((dark) => {
  const root = document.documentElement.style
  document.body.classList.toggle("theme-dark", dark)
  root.setProperty("--background-primary", dark ? "#202020" : "#ffffff")
  root.setProperty("--background-secondary", dark ? "#292929" : "#f2f2f2")
  root.setProperty("--background-modifier-border", dark ? "#3a3a3a" : "#d9d9d9")
  root.setProperty("--interactive-accent", "#9567e8")
  root.setProperty("--text-normal", dark ? "#dcdcdc" : "#252525")
  root.setProperty("--text-muted", dark ? "#9a9a9a" : "#707070")
  root.setProperty("--button-radius", "7px")
}, dark)
await page.goto("file://" + path.join(out, "index.html"))
await theme(false)

const read = () => page.evaluate(() => {
  const slot = (id) => document.querySelector(id)
  const bg = (id) => getComputedStyle(slot(id)).backgroundColor
  const luminance = (rgb) => { const m = rgb.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0]; return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255 }
  return {
    ownInk: { hasInk: slot("#own-ink").classList.contains("has-ink"), ink: slot("#own-ink").style.getPropertyValue("--modular-diary-quote-ink"), bg: bg("#own-ink"), text: slot("#own-ink").querySelector(".modular-diary-daily-quote-text")?.textContent, author: slot("#own-ink").querySelector(".modular-diary-daily-quote-author")?.textContent, card: Boolean(slot("#own-ink").querySelector(".modular-diary-daily-quote-card")), textSize: getComputedStyle(slot("#own-ink").querySelector(".modular-diary-daily-quote-text")).fontSize, textLum: luminance(getComputedStyle(slot("#own-ink").querySelector(".modular-diary-daily-quote-text")).color), bgLum: luminance(bg("#own-ink")) },
    globalInk: { ink: slot("#global-ink").style.getPropertyValue("--modular-diary-quote-ink"), author: slot("#global-ink").querySelector(".modular-diary-daily-quote-author") },
    untinted: { hasInk: slot("#untinted").classList.contains("has-ink"), bg: bg("#untinted") },
    empty: { cta: slot("#empty").querySelector(".modular-diary-daily-quote-empty")?.textContent?.trim(), hasText: Boolean(slot("#empty").querySelector(".modular-diary-daily-quote-text")) },
    pencils: [...document.querySelectorAll("#fixture .modular-diary-component-icon-button")].map((b) => b.getAttribute("aria-label")),
    titleFont: getComputedStyle(document.querySelector("#own-ink .modular-diary-component-title")).fontSize,
    dateA: window.__quoteForDate("2026-09-10"), dateAAgain: window.__quoteForDate("2026-09-10"),
    library: document.querySelector("#settings textarea.modular-diary-quote-library")?.value,
    dots: [...document.querySelectorAll("#settings .modular-diary-quote-ink-dot")].map((d) => ({ label: d.querySelector(".modular-diary-quote-ink-name")?.textContent, checked: d.getAttribute("aria-checked"), mark: getComputedStyle(d.querySelector(".modular-diary-quote-ink-mark")).backgroundColor, chipBg: getComputedStyle(d).backgroundColor })),
    libraryTooltip: document.querySelector("#settings textarea.modular-diary-quote-library")?.getAttribute("aria-label"),
    designerLeftovers: document.querySelectorAll(".modular-diary-quote-theme-grid, .modular-diary-quote-designer, .modular-diary-quote-settings-tabs, input[type=range]").length,
  }
})
const light = await read()
await page.locator("#fixture").screenshot({ path: path.join(out, "daily-quote-light.png") })
await theme(true)
const dark = await read()
await page.locator("#fixture").screenshot({ path: path.join(out, "daily-quote-dark.png") })
await theme(false)

// The pencil and the empty CTA are the only actions; the slot itself is not a button.
await page.locator("#own-ink .modular-diary-component-icon-button").click()
await page.locator("#empty .modular-diary-daily-quote-empty").click()
await page.locator("#own-ink .modular-diary-daily-quote-text").click()
const events = await page.evaluate(() => window.__events)

// Library editing: type a line, leave the box → parsed, ids kept, one save, blocks repainted.
const textarea = page.locator("#settings textarea.modular-diary-quote-library")
await textarea.click()
await textarea.press("End")
await textarea.press("Control+End")
await textarea.type("\n成效的关键时刻：13 天，坚持下去。—— 自己 #开发")
await page.locator("#settings .modular-diary-quote-ink-dot").first().focus()
await page.waitForTimeout(30)
const afterEdit = await page.evaluate(() => ({
  saves: window.__saves,
  quotes: window.__settings.dailyQuotes.map((q) => ({ id: q.id, text: q.text, author: q.author, ink: q.ink })),
  status: document.querySelector("#settings .modular-diary-quote-status")?.textContent,
}))
// Picking a dot changes the global ink and saves.
await page.locator('#settings .modular-diary-quote-ink-dot', { hasText: "开发" }).click()
await page.waitForTimeout(30)
const afterDot = await page.evaluate(() => ({ ink: window.__settings.dailyQuoteInk, saves: window.__saves, checked: document.querySelector("#settings .modular-diary-quote-ink-dot[aria-checked=true] .modular-diary-quote-ink-name")?.textContent }))
await page.locator("#settings").screenshot({ path: path.join(out, "daily-quote-library.png") })
// Cmd/Ctrl+Enter saves; a failed save keeps the draft and says so.
await page.evaluate(() => { window.__failNextSave = true })
await textarea.click()
await textarea.type(" ")
await textarea.press("Control+Enter")
await page.waitForTimeout(30)
const afterFail = await page.evaluate(() => ({ status: document.querySelector("#settings .modular-diary-quote-status")?.textContent, value: document.querySelector("#settings textarea").value }))
await page.setViewportSize({ width: 360, height: 900 })
await page.locator("#fixture").screenshot({ path: path.join(out, "daily-quote-narrow.png") })

const errors = []
if (!light.ownInk.hasInk || light.ownInk.ink !== "#9bd17b" || light.ownInk.bg === "rgba(0, 0, 0, 0)") errors.push("a sentence with its own ink must tint the slot with that colour")
if (light.globalInk.ink !== "#c8b6e2" || light.globalInk.author !== null) errors.push("a sentence without ink must use the global ink and show no source line")
if (light.untinted.hasInk || light.untinted.bg !== "rgba(0, 0, 0, 0)") errors.push("no ink means an untinted slot")
if (light.ownInk.card || light.ownInk.text !== "我们先塑造习惯，然后习惯塑造我们。" || light.ownInk.author !== "John Dryden") errors.push("the sentence is a plain line with its source, not a card")
if (light.ownInk.textSize !== "13px" || light.titleFont !== light.titleFont) errors.push("the sentence uses the block's small UI size")
if (light.ownInk.textLum > 0.4 || dark.ownInk.textLum < 0.6) errors.push("sentence colour must follow the theme text colour")
if (dark.ownInk.bgLum > 0.5) errors.push("the dark-theme tint must stay dark")
if (light.empty.cta !== "添加第一句话" || light.empty.hasText) errors.push("empty state offers to add the first sentence")
if (light.pencils.length !== 4 || light.pencils.some((label) => label !== "编辑每日一句")) errors.push("every slot has one labelled pencil")
if (light.dateA !== light.dateAAgain) errors.push("the sentence of a date is deterministic")
if (light.library !== "我们先塑造习惯，然后习惯塑造我们。 —— John Dryden #阅读\n今天也要留一点时间给自己。") errors.push("the library serializes one sentence per line: " + JSON.stringify(light.library))
if (light.dots.map((d) => d.label).join() !== "不着色,阅读,运动,开发" || light.dots.find((d) => d.checked === "true")?.label !== "运动") errors.push("ink chips list the span palette by name with the global ink checked: " + JSON.stringify(light.dots))
// The colour must survive Obsidian's own `button:not(.clickable-icon)` rule: the mark carries the palette colour.
if (light.dots[1].mark !== "rgb(155, 209, 123)" || light.dots[0].mark !== "rgba(0, 0, 0, 0)") errors.push("ink marks must show the palette colour: " + JSON.stringify(light.dots.map((d) => d.mark)))
if (light.libraryTooltip) errors.push("the library box must not carry an aria-label tooltip")
if (light.designerLeftovers !== 0) errors.push("no designer controls remain")
if (events.join() !== "edit:#own-ink,edit:#empty") errors.push("only the pencil and the empty CTA open the editor: " + events.join())
if (afterEdit.saves !== 1 || afterEdit.quotes.length !== 3 || afterEdit.quotes[0].id !== "one" || afterEdit.quotes[1].id !== "two" || afterEdit.quotes[2].text !== "成效的关键时刻：13 天，坚持下去。" || afterEdit.quotes[2].author !== "自己" || afterEdit.quotes[2].ink !== "开发" || afterEdit.status !== "已保存") errors.push("leaving the box parses the library, keeps ids and saves once: " + JSON.stringify(afterEdit))
if (afterDot.ink !== "开发" || afterDot.saves !== 2 || afterDot.checked !== "开发") errors.push("picking a dot sets the global ink and saves: " + JSON.stringify(afterDot))
if (afterFail.status !== "保存失败，请重试" || !afterFail.value.endsWith("#开发 ")) errors.push("a failed save keeps the draft and reports it: " + JSON.stringify(afterFail))

if (errors.length) {
  console.error("DAILY QUOTE CONTRACT FAILED", { errors, light, dark, screenshots: out })
  process.exit(1)
}
console.log(JSON.stringify({ ok: true, screenshots: out }))
await browser.close()
