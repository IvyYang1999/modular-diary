/** Product contract for the hour diary: pieces edit in place, the composer writes a new piece, brackets on the timeline mark each piece. */
import esbuild from "esbuild"
import { chromium } from "playwright"
import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"
import os from "node:os"

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(os.tmpdir(), "modular-diary-hourlog-smoke")
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })
fs.writeFileSync(path.join(out, "obsidian-stub.ts"), `
export function setIcon(el: HTMLElement, name: string): void {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("class", "svg-icon"); svg.setAttribute("viewBox", "0 0 24 24"); svg.dataset.icon = name
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path")
  p.setAttribute("d", name === "plus" ? "M12 5v14M5 12h14" : "M4 12h16"); p.setAttribute("fill", "none"); p.setAttribute("stroke", "currentColor"); p.setAttribute("stroke-width", "2"); p.setAttribute("stroke-linecap", "round")
  svg.appendChild(p); el.appendChild(svg)
}
`)
fs.writeFileSync(path.join(out, "entry.ts"), `
import { renderHourlogInto } from "${path.join(here, "../src/render/hourlog-view")}"
import { hourlogItems, linkableEntries } from "${path.join(here, "../src/core/hourlog")}"
import { parseTimeline } from "${path.join(here, "../src/core/parser")}"
import { renderTimelineSvg } from "${path.join(here, "../src/render/svg-builder")}"
HTMLElement.prototype.createDiv = function (opts: any = {}) { return this.createEl("div", opts) }
HTMLElement.prototype.createEl = function (tag: string, opts: any = {}) {
  const el = document.createElement(tag)
  if (opts.cls) el.className = opts.cls
  if (opts.text) el.textContent = opts.text
  if (opts.attr) for (const [key, value] of Object.entries(opts.attr)) el.setAttribute(key, String(value))
  this.appendChild(el); return el
}
const colors = { 开发: "#53a3f2", 写作: "#a0c849", 运动: "#ae7ee2", 吃饭: "#f47b74", 睡觉: "#cfccc4" }
const doc = parseTimeline([
  "date: 2026-09-30", "range: 7-19", "---",
  "07:00-07:40 睡觉 赖床",
  "plan 09:00-12:00 开发",
  "09:15-11:40 开发 #模块日记 周视图 parser",
  "  days 头解析 + 列渲染。发现 days 头和 layout 头得互斥，先按块级判断。",
  "  列渲染复用 axis()，压缩之后文字全靠 hover。",
  "12:00-12:45 吃饭",
  "@12:45-13:00 #飞搜",
  "  午饭后回了两个 issue，一个是接口改了参数。",
  "14:00-16:00 开发 跨天拖放",
  "16:00-16:30 运动 跑步",
].join("\\n"))
const items = hourlogItems(doc)
window.__events = []
const svgHost = document.querySelector<HTMLElement>("#svg")!
svgHost.innerHTML = renderTimelineSvg(doc, { typeColors: colors, width: 250, hourHeight: 34 })
const slot = document.querySelector<HTMLElement>("#slot")!
renderHourlogInto(slot, items, {
  typeColors: colors,
  tagStyle: (tag) => tag === "模块日记" ? { background: "color-mix(in srgb, #53a3f2 22%, var(--background-primary))", color: "color-mix(in srgb, #53a3f2 70%, var(--text-normal))" } : null,
  tagSuggest: { tags: () => ["模块日记", "飞搜", "官网"] },
  linkable: linkableEntries(doc),
  composer: { startMin: 16 * 60 + 30, endMin: 17 * 60 + 10, link: null, body: "" },
  onComposerChange: (d) => window.__events.push("draft:" + (d ? d.body + "@" + d.link : "null")),
  onCreate: (d) => { window.__events.push("create:" + d.link + ":" + d.startMin + "-" + d.endMin + ":" + d.body) },
  onSaveBody: (item, body) => { window.__events.push("save:" + item.kind + ":" + item.startMin + ":" + body) },
  onMenu: (item) => window.__events.push("menu:" + item.line),
  onLocate: (item) => window.__events.push("locate:" + item.line),
})
`)
await esbuild.build({
  entryPoints: [path.join(out, "entry.ts")], bundle: true, format: "iife", outfile: path.join(out, "bundle.js"), logLevel: "silent",
  plugins: [{ name: "obsidian-stub", setup(build) { build.onResolve({ filter: /^obsidian$/ }, () => ({ path: path.join(out, "obsidian-stub.ts") })) } }],
})
const css = fs.readFileSync(path.join(here, "../styles.css"), "utf8")
const hostile = `button { background: rgb(226,226,226); border: 1px solid rgb(180,180,180); box-shadow: 0 1px 2px rgba(0,0,0,.2); border-radius: 6px; padding: 4px 12px; font: inherit; }
input, select, textarea { font: inherit; border: 1px solid #ccc; border-radius: 5px; background: var(--background-modifier-form-field); color: var(--text-normal); }
body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; font-size: 14px; }`
fs.writeFileSync(path.join(out, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><style>${hostile}</style><style>${css}</style></head><body style="margin:16px"><main style="display:flex;gap:20px;align-items:flex-start;width:780px"><div class="modular-diary-container" style="width:430px"><div class="modular-diary-slot modular-diary-slot-hourlog" id="slot" style="position:relative;width:100%;padding:8px 8px 10px 22px;box-sizing:border-box"></div></div><div class="modular-diary-container" style="width:300px"><div id="svg" class="modular-diary-svg-holder" style="position:relative;width:100%;height:470px;overflow:hidden"></div></div></main><script>${fs.readFileSync(path.join(out, "bundle.js"), "utf8")}</script></body></html>`)

const themes = {
  light: { "--background-primary": "#ffffff", "--background-secondary": "#f6f6f6", "--background-modifier-border": "#e0e0e0", "--background-modifier-border-hover": "#cfcfcf", "--background-modifier-hover": "rgba(0,0,0,0.05)", "--background-modifier-form-field": "#ffffff", "--interactive-accent": "#8a5cf5", "--text-normal": "#222222", "--text-muted": "#6b6b6b", "--text-faint": "#a0a0a0", "--text-accent": "#7b4fe0", "--text-on-accent": "#ffffff", "--text-error": "#d04437", "--button-radius": "6px", "--modular-diary-font-body": "14px" },
  dark: { "--background-primary": "#1e1e1e", "--background-secondary": "#262626", "--background-modifier-border": "#363636", "--background-modifier-border-hover": "#4a4a4a", "--background-modifier-hover": "rgba(255,255,255,0.06)", "--background-modifier-form-field": "#2a2a2a", "--interactive-accent": "#8a5cf5", "--text-normal": "#dcddde", "--text-muted": "#9a9a9a", "--text-faint": "#6a6a6a", "--text-accent": "#a68af9", "--text-on-accent": "#ffffff", "--text-error": "#ff6b5e", "--button-radius": "6px", "--modular-diary-font-body": "14px" },
}
const browser = await chromium.launch()
const errors = []
const shots = []
let events = []
for (const [name, vars] of Object.entries(themes)) {
  const page = await browser.newPage({ viewport: { width: 820, height: 720 }, deviceScaleFactor: 2 })
  page.on("pageerror", (error) => { console.error("pageerror:", error.message); process.exit(1) })
  await page.goto("file://" + path.join(out, "index.html"))
  await page.evaluate((v) => { for (const [k, val] of Object.entries(v)) document.documentElement.style.setProperty(k, val); document.body.style.background = v["--background-primary"]; document.body.style.color = v["--text-normal"]; if (v["--background-primary"] === "#1e1e1e") document.body.classList.add("theme-dark") }, vars)
  await page.waitForTimeout(80)
  const shot = path.join(out, `hourlog-${name}.png`)
  await page.locator("main").screenshot({ path: shot }); shots.push(shot)
  if (name !== "light") { await page.close(); continue }

  const state = await page.evaluate(() => {
    const q = (s) => [...document.querySelectorAll(s)]
    return {
      cards: q(".modular-diary-hourlog-item").map((c) => [c.className.includes("is-span") ? "span" : "entry", c.querySelector(".modular-diary-hourlog-time").textContent]),
      bodyHeights: q(".modular-diary-hourlog-item textarea").map((a) => a.scrollHeight <= a.clientHeight + 1),
      headChrome: getComputedStyle(document.querySelector(".modular-diary-hourlog-head")).backgroundColor,
      brackets: q(".modular-diary-diary-mark").map((m) => [m.classList.contains("is-span") ? "span" : "entry", m.dataset.line]),
      corners: q(".modular-diary-diary-corner").length,
      bracketLeftOfTrack: (() => { const b = document.querySelector(".modular-diary-diary-bracket").getBoundingClientRect(); const t = document.querySelector(".modular-diary-track").getBoundingClientRect(); return b.right <= t.left + 1 })(),
      metaHidden: getComputedStyle(document.querySelector(".modular-diary-hourlog-composer-meta")).display === "none",
      count: document.querySelector(".modular-diary-hourlog .modular-diary-component-count")?.textContent,
    }
  })
  if (JSON.stringify(state.cards) !== JSON.stringify([["entry", "09:15–11:40"], ["span", "12:45–13:00"]])) errors.push("cards: " + JSON.stringify(state.cards))
  if (state.bodyHeights.some((fits) => !fits)) errors.push("bodies must grow to their text, not scroll")
  if (state.headChrome !== "rgba(0, 0, 0, 0)") errors.push("card heads must not carry host button chrome: " + state.headChrome)
  if (state.brackets.length !== 2 || state.corners !== 1) errors.push("brackets for both pieces and one corner mark: " + JSON.stringify(state))
  if (!state.bracketLeftOfTrack) errors.push("brackets sit left of the track")
  if (!state.metaHidden) errors.push("the composer stays one quiet line until used")
  if (state.count !== "2 · 2h40m") errors.push("header count: " + state.count)

  // Edit the first piece; blur saves.
  const first = page.locator(".modular-diary-hourlog-item").first().locator("textarea")
  await first.click(); await first.evaluate((a) => a.setSelectionRange(a.value.length, a.value.length)); await page.keyboard.type(" 明天做分列。")
  await page.locator(".modular-diary-hourlog-head").first().click()
  // Esc on the second piece puts the text back and saves nothing.
  const second = page.locator(".modular-diary-hourlog-item").nth(1).locator("textarea")
  await second.click(); await page.keyboard.type("不要的字"); await page.keyboard.press("Escape")
  const reverted = await second.inputValue()
  // Composer: focus shows the meta row; link a block; type with a tag; Mod+Enter writes.
  await page.locator(".modular-diary-hourlog-composer textarea").click()
  const metaShown = await page.evaluate(() => getComputedStyle(document.querySelector(".modular-diary-hourlog-composer-meta")).display !== "none")
  await page.locator(".modular-diary-hourlog-link").selectOption({ index: 3 })
  const linkedTimes = await page.evaluate(() => [...document.querySelectorAll(".modular-diary-hourlog-clock")].map((i) => [i.value, i.disabled]))
  await page.locator(".modular-diary-hourlog-composer textarea").click()
  await page.keyboard.type("拖放终于顺了 #模")
  const suggest = await page.evaluate(() => [...document.querySelectorAll(".modular-diary-tag-suggest-item")].map((i) => i.textContent))
  await page.keyboard.press("Enter")
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter")
  await page.locator(".modular-diary-hourlog-item").first().click({ button: "right", position: { x: 200, y: 8 } })
  await page.locator("main").screenshot({ path: path.join(out, "hourlog-composing.png") }); shots.push(path.join(out, "hourlog-composing.png"))
  events = await page.evaluate(() => window.__events)
  if (reverted !== "午饭后回了两个 issue，一个是接口改了参数。") errors.push("Esc must restore the text: " + reverted)
  if (!metaShown) errors.push("focusing the composer reveals times and the link picker")
  if (JSON.stringify(linkedTimes) !== JSON.stringify([["14:00", true], ["16:00", true]])) errors.push("linking a block locks the composer to its times: " + JSON.stringify(linkedTimes))
  if (!suggest.includes("#模块日记")) errors.push("# completion works in the composer: " + JSON.stringify(suggest))
  await page.close()
}
await browser.close()
const expected = [
  "save:entry:555:days 头解析 + 列渲染。发现 days 头和 layout 头得互斥，先按块级判断。\n列渲染复用 axis()，压缩之后文字全靠 hover。 明天做分列。",
  "locate:5",
  "create:11:840-960:拖放终于顺了 #模块日记",
  "menu:5",
]
for (const e of expected) if (!events.includes(e)) errors.push("missing " + JSON.stringify(e))
if (events.some((e) => e.startsWith("save:span"))) errors.push("Esc must not save")
if (errors.length) { console.error("HOURLOG CONTRACT FAILED", { errors, events, shots }); process.exit(1) }
console.log("OK hourlog smoke passed\n" + shots.join("\n"))
