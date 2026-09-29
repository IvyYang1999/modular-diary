/** Product contract for phase 4: todo layouts (ABC, quadrants) and titled text sections. */
import esbuild from "esbuild"
import { chromium } from "playwright"
import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"
import os from "node:os"

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(os.tmpdir(), "modular-diary-phase4-smoke")
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })
fs.writeFileSync(path.join(out, "obsidian-stub.ts"), `
export function setIcon(el: HTMLElement, name: string): void {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("class", "svg-icon"); svg.setAttribute("viewBox", "0 0 24 24"); svg.dataset.icon = name
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path")
  p.setAttribute("d", "M5 12h14M12 5v14"); p.setAttribute("fill", "none"); p.setAttribute("stroke", "currentColor"); p.setAttribute("stroke-width", "2")
  svg.appendChild(p); el.appendChild(svg)
}
`)
fs.writeFileSync(path.join(out, "entry.ts"), `
import { renderTodosInto } from "${path.join(here, "../src/render/todos-view")}"
import { renderTimelineInto } from "${path.join(here, "../src/render/timeline-view")}"
import { parseTimeline } from "${path.join(here, "../src/core/parser")}"
HTMLElement.prototype.createDiv = function (opts: any = {}) { return this.createEl("div", opts) }
HTMLElement.prototype.createEl = function (tag: string, opts: any = {}) {
  const el = document.createElement(tag)
  if (opts.cls) el.className = opts.cls
  if (opts.text) el.textContent = opts.text
  if (opts.attr) for (const [key, value] of Object.entries(opts.attr)) el.setAttribute(key, String(value))
  this.appendChild(el); return el
}
HTMLElement.prototype.empty = function () { this.replaceChildren() }
HTMLElement.prototype.addClass = function (c: string) { this.classList.add(c) }
HTMLElement.prototype.toggleClass = function (c: string, v: boolean) { this.classList.toggle(c, v) }
window.__events = []
const colors = { 开发: "#53a3f2", 写作: "#a0c849", 运动: "#ae7ee2" }
const items = [
  { id: "a1", title: "写周视图 parser", type: "开发", completed: false, weekly: false, estimateMinutes: 90, actualMinutes: 0, group: "", bucket: "A" },
  { id: "a2", title: "官网文案 #官网", type: "写作", completed: true, weekly: false, estimateMinutes: 60, actualMinutes: 30, group: "", bucket: "A" },
  { id: "b1", title: "整理截图", type: "开发", completed: false, weekly: false, estimateMinutes: 30, actualMinutes: 0, group: "", bucket: "B" },
  { id: "n1", title: "回邮件", type: "", completed: false, weekly: false, estimateMinutes: 15, actualMinutes: 0, group: "" },
  { id: "w1", title: "本周深度开发", type: "开发", completed: false, weekly: true, estimateMinutes: 300, actualMinutes: 120, group: "" },
]
const mount = (id: string, layout: string) => renderTodosInto(document.querySelector<HTMLElement>(id)!, items as any, {
  categories: Object.keys(colors), typeColors: colors,
  view: { groupBy: "none", sortBy: "manual", layout } as any,
  onAdd: () => {}, onEdit: () => {}, onToggle: () => {}, onMove: () => {},
  onGroupMenu: () => {}, onSortMenu: () => {},
  onMenu: (item) => window.__events.push("menu:" + item.id),
  onSetBucket: (id, bucket) => window.__events.push("bucket:" + layout + ":" + id + ":" + bucket),
  onLayoutMenu: () => window.__events.push("layout-menu:" + layout),
})
mount("#abc", "abc")
mount("#matrix", "matrix")
mount("#narrow", "abc")
const doc = parseTimeline(["date: 2026-09-30", "layout: timeline@6,0,6,24 text@0,0,6,6 text2@0,6,6,6", "---", "09:00-10:00 开发", "=== 感恩日记", "今天的阳光很好", "===", "随手记"].join("\\n"))
renderTimelineInto(document.querySelector<HTMLElement>("#block")!, doc, { typeColors: colors }, {
  renderMarkdown: (host, text) => { host.textContent = text },
  onSave: () => {},
  onRenameTitle: (index, title) => { window.__events.push("rename:" + index + ":" + title) },
})
`)
await esbuild.build({
  entryPoints: [path.join(out, "entry.ts")], bundle: true, format: "iife", outfile: path.join(out, "bundle.js"), logLevel: "silent",
  plugins: [{ name: "obsidian-stub", setup(build) { build.onResolve({ filter: /^obsidian$/ }, () => ({ path: path.join(out, "obsidian-stub.ts") })) } }],
})
const css = fs.readFileSync(path.join(here, "../styles.css"), "utf8")
const hostile = `button { background: rgb(226,226,226); border: 1px solid rgb(180,180,180); box-shadow: 0 1px 2px rgba(0,0,0,.2); border-radius: 6px; font: inherit; } body { font-family: -apple-system, "PingFang SC", sans-serif; font-size: 14px; }`
const slot = (id, w) => `<div class="modular-diary-container" style="width:${w}px;margin-bottom:16px"><div class="modular-diary-slot modular-diary-slot-todos" style="position:relative;width:100%;box-sizing:border-box;padding-block:8px"><div id="${id}"></div></div></div>`
fs.writeFileSync(path.join(out, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><style>${hostile}</style><style>${css}</style></head><body style="margin:16px">${slot("abc", 640)}${slot("matrix", 520)}${slot("narrow", 340)}<div id="block" style="width:640px"></div><script>${fs.readFileSync(path.join(out, "bundle.js"), "utf8")}</script></body></html>`)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 720, height: 1400 }, deviceScaleFactor: 2 })
page.on("pageerror", (error) => { console.error("pageerror:", error.message); process.exit(1) })
await page.goto("file://" + path.join(out, "index.html"))
await page.evaluate(() => {
  const vars = { "--background-primary": "#ffffff", "--background-secondary": "#f6f6f6", "--background-modifier-border": "#e0e0e0", "--background-modifier-hover": "rgba(0,0,0,0.05)", "--interactive-accent": "#8a5cf5", "--text-normal": "#222222", "--text-muted": "#6b6b6b", "--text-faint": "#a0a0a0", "--text-accent": "#7b4fe0", "--text-error": "#d04437", "--button-radius": "6px" }
  for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v)
})
await page.waitForTimeout(80)
const state = await page.evaluate(() => {
  const cells = (root) => [...document.querySelectorAll(root + " .modular-diary-todo-bucket")].map((c) => [c.dataset.bucket, [...c.querySelectorAll(".modular-diary-todo-row")].map((r) => r.dataset.todoId).join(",")])
  const cols = (root) => getComputedStyle(document.querySelector(root + " .modular-diary-todo-list")).gridTemplateColumns.split(" ").length
  return {
    abc: cells("#abc"), matrix: cells("#matrix"),
    abcCols: cols("#abc"), matrixCols: cols("#matrix"), narrowCols: cols("#narrow"),
    weeklyHasGrip: !!document.querySelector('#abc .modular-diary-todo-row[data-todo-id="w1"] .modular-diary-item-drag'),
    groupHidden: document.querySelector("#abc .modular-diary-component-actions button:nth-child(2)").hidden,
    titles: [...document.querySelectorAll("#block .modular-diary-text-title")].map((t) => t.textContent),
    untitledHasHeader: document.querySelectorAll("#block .modular-diary-slot:not(.has-title) .modular-diary-text-header").length,
  }
})
await page.screenshot({ path: path.join(out, "phase4.png"), fullPage: true })
// Drag "回邮件" from 未分组 into C.
const grip = page.locator('#abc .modular-diary-todo-row[data-todo-id="n1"] .modular-diary-item-drag')
await page.locator('#abc .modular-diary-todo-row[data-todo-id="n1"]').hover()
const g = await grip.boundingBox()
const c = await page.locator('#abc .modular-diary-todo-bucket[data-bucket="C"]').boundingBox()
await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await page.mouse.down()
await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2, { steps: 8 })
const overC = await page.evaluate(() => document.querySelector('#abc .modular-diary-todo-bucket[data-bucket="C"]').classList.contains("is-over"))
await page.mouse.up()
// Dropping back into its own cell writes nothing.
const g2 = await page.locator('#abc .modular-diary-todo-row[data-todo-id="b1"] .modular-diary-item-drag').boundingBox()
await page.mouse.move(g2.x + 4, g2.y + 4); await page.mouse.down(); await page.mouse.move(g2.x + 30, g2.y + 10, { steps: 4 }); await page.mouse.up()
// Rename a titled section.
await page.locator("#block .modular-diary-text-title").click()
await page.locator("#block .modular-diary-text-title-input").fill("感恩")
await page.keyboard.press("Enter")
await page.locator("#abc .modular-diary-component-actions button").first().click()
const events = await page.evaluate(() => window.__events)
await browser.close()

const errors = []
if (JSON.stringify(state.abc) !== JSON.stringify([["A", "a1,a2"], ["B", "b1"], ["C", ""], ["", "n1,w1"]])) errors.push("ABC cells: " + JSON.stringify(state.abc))
if (JSON.stringify(state.matrix.map(([k]) => k)) !== JSON.stringify(["q1", "q2", "q3", "q4", ""])) errors.push("quadrant cells in reading order plus unsorted: " + JSON.stringify(state.matrix))
if (state.abcCols !== 3 || state.matrixCols !== 2) errors.push(`columns: abc ${state.abcCols} matrix ${state.matrixCols}`)
if (state.narrowCols !== 1) errors.push("a narrow todo slot stacks its cells: " + state.narrowCols)
if (state.weeklyHasGrip) errors.push("weekly todos cannot be moved between cells")
if (!state.groupHidden) errors.push("grouping is hidden once cells are the groups")
if (JSON.stringify(state.titles) !== JSON.stringify(["感恩日记"]) || state.untitledHasHeader !== 0) errors.push("only titled sections get a header: " + JSON.stringify(state))
if (!overC) errors.push("the cell under the pointer lights up")
for (const e of ["bucket:abc:n1:C", "rename:0:感恩", "layout-menu:abc"]) if (!events.includes(e)) errors.push("missing " + e)
if (events.some((e) => e.startsWith("bucket:abc:b1"))) errors.push("dropping into the same cell writes nothing")
if (errors.length) { console.error("PHASE4 CONTRACT FAILED", { errors, events, state, shot: path.join(out, "phase4.png") }); process.exit(1) }
console.log("OK phase4 smoke passed", path.join(out, "phase4.png"))
