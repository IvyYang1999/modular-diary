/** Product contract for the period block (`days:`): rail, columns, and pointer drags between pool, days and a day's axis. */
import esbuild from "esbuild"
import { chromium } from "playwright"
import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"
import os from "node:os"

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(os.tmpdir(), "modular-diary-period-smoke")
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })

fs.writeFileSync(path.join(out, "obsidian-stub.ts"), `
export function setIcon(el: HTMLElement, name: string): void {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("class", "svg-icon"); svg.dataset.icon = name; el.appendChild(svg)
}
`)

fs.writeFileSync(path.join(out, "entry.ts"), `
import { renderPeriodInto } from "${path.join(here, "../src/render/period-view")}"
import { goalProgress, periodTotals, resolvePeriod } from "${path.join(here, "../src/core/period")}"
import { parseTimeline } from "${path.join(here, "../src/core/parser")}"

HTMLElement.prototype.createDiv = function (opts: any = {}) { return this.createEl("div", opts) }
HTMLElement.prototype.createEl = function (tag: string, opts: any = {}) {
  const el = document.createElement(tag)
  if (opts.cls) el.className = opts.cls
  if (opts.text) el.textContent = opts.text
  if (opts.attr) for (const [key, value] of Object.entries(opts.attr)) el.setAttribute(key, String(value))
  this.appendChild(el); return el
}
HTMLElement.prototype.appendText = function (text: string) { this.appendChild(document.createTextNode(text)) }
HTMLElement.prototype.empty = function () { this.replaceChildren() }

const colors = { 开发: "#53a3f2", 写作: "#a0c849", 运动: "#ae7ee2", 吃饭: "#f47b74" }
const day = (date: string, source: string, hasNote = true) => { const doc = parseTimeline(source); return { date, entries: doc.entries, spans: doc.spans, todos: doc.todos, hasNote } }
const block = parseTimeline([
  'days: this-week',
  'goal: type="运动" target=180',
  'goal: tag="飞搜" target=120',
  'todo: id="t8" done=false estimate=60 category="写作" group="" due=2026-10-04 title="写周报 #官网"',
  'todo: id="t9" done=false estimate=45 category="开发" group="" title="装 Obsidian 测一遍 #模块日记"',
  'todo: id="t10" done=false estimate=30 category="" group="" title="回邮件"',
  '---',
].join("\\n"))
const today = "2026-09-30"
const period = resolvePeriod(block.period!, today)
const days = [
  day("2026-09-28", "09:00-10:00 运动 跑步\\n10:00-12:30 开发 #模块日记 周视图\\n@12:45-13:00 #飞搜"),
  day("2026-09-29", "09:00-09:30 运动\\n14:00-16:00 开发"),
  day("2026-09-30", 'todo: id="t2" done=false estimate=90 category="写作" group="" title="官网文案 #官网"\\n---\\nplan 16:30-18:00 写作 官网文案 [todo:t2]\\n09:15-11:40 开发 #模块日记'),
  day("2026-10-01", "", false), day("2026-10-02", "", false), day("2026-10-03", "", false), day("2026-10-04", "plan 10:00-12:00 写作 周记", true),
]
window.__events = []
const host = document.querySelector<HTMLElement>("#host")!
renderPeriodInto(host, {
  spec: block.period!, period, today, goals: goalProgress(block.goals, days), totals: periodTotals(days), pool: block.todos, days,
  rangeStartMin: 7 * 60, rangeEndMin: 23 * 60, indexReady: true,
}, {
  typeColors: colors,
  tagStyle: (tag) => tag === "模块日记" ? { background: "#dbeafe", color: "#1f78c8" } : null,
  onShift: (direction) => window.__events.push("shift:" + direction),
  onToday: () => window.__events.push("today"),
  onOpenDay: (date) => window.__events.push("open:" + date),
  onMoveTodo: (id, from, to) => window.__events.push("move:" + id + ":" + from + ":" + to),
  onPlanTodo: (id, from, date, startMin) => window.__events.push("plan:" + id + ":" + from + ":" + date + ":" + startMin),
})
`)

await esbuild.build({
  entryPoints: [path.join(out, "entry.ts")], bundle: true, format: "iife", outfile: path.join(out, "bundle.js"), logLevel: "silent",
  plugins: [{ name: "obsidian-stub", setup(build) { build.onResolve({ filter: /^obsidian$/ }, () => ({ path: path.join(out, "obsidian-stub.ts") })) } }],
})
const css = fs.readFileSync(path.join(here, "../styles.css"), "utf8")
fs.writeFileSync(path.join(out, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body style="margin:16px"><main id="host" class="modular-diary-container modular-diary-period-container" style="width:1100px"></main><script>${fs.readFileSync(path.join(out, "bundle.js"), "utf8")}</script></body></html>`)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 })
page.on("pageerror", (error) => { console.error("pageerror:", error.message); process.exit(1) })
await page.goto("file://" + path.join(out, "index.html"))
await page.evaluate(() => {
  const root = document.documentElement.style
  for (const [k, v] of Object.entries({ "--background-primary": "#ffffff", "--background-secondary": "#f2f2f2", "--background-modifier-border": "#d9d9d9", "--background-modifier-hover": "#ececec", "--interactive-accent": "#9567e8", "--text-normal": "#252525", "--text-muted": "#707070", "--text-faint": "#999999", "--text-accent": "#7e50dc", "--text-on-accent": "#ffffff", "--button-radius": "7px" })) root.setProperty(k, v)
  document.body.style.background = "#ffffff"
})
await page.waitForTimeout(50)

const state = await page.evaluate(() => {
  const q = (s) => [...document.querySelectorAll(s)]
  const goalText = q(".modular-diary-period-goal").map((g) => g.textContent.replace(/\s+/g, " ").trim())
  const heads = q(".modular-diary-period-day-head").map((h) => h.textContent)
  const poolChips = q(".modular-diary-period-pool .modular-diary-period-chip").map((c) => c.textContent)
  const poolTagBadges = q(".modular-diary-period-pool .modular-diary-tag").length
  const alldayTagBadgesVisible = q(".modular-diary-period-allday .modular-diary-tag").filter((b) => getComputedStyle(b).display !== "none").length
  const dueFlags = q(".modular-diary-period-due").map((d) => d.textContent)
  const blocks = q(".modular-diary-period-block").length
  const spans = q(".modular-diary-period-span").length
  const axisHeight = document.querySelector(".modular-diary-period-axis").getBoundingClientRect().height
  const title = document.querySelector(".modular-diary-period-title").textContent
  return { goalText, heads, poolChips, poolTagBadges, alldayTagBadgesVisible, dueFlags, blocks, spans, axisHeight, title }
})

// drag t9 from the pool onto Thursday's all-day list
const chipBox = await page.locator('.modular-diary-period-pool .modular-diary-period-chip[data-todo-id="t9"]').boundingBox()
const thuList = await page.locator('.modular-diary-period-allday[data-zone="2026-10-01"]').boundingBox()
await page.mouse.move(chipBox.x + 20, chipBox.y + chipBox.height / 2)
await page.mouse.down()
await page.mouse.move(thuList.x + thuList.width / 2, thuList.y + 12, { steps: 8 })
const overClass = await page.evaluate(() => document.querySelector('.modular-diary-period-allday[data-zone="2026-10-01"]').classList.contains("is-over"))
const ghosts = await page.evaluate(() => document.querySelectorAll(".modular-diary-period-chip.is-ghost").length)
await page.mouse.up()
// drag t8 onto Friday's axis at 10:00 (7..23 => 3h of 16h)
const chip8 = await page.locator('.modular-diary-period-pool .modular-diary-period-chip[data-todo-id="t8"]').boundingBox()
const friAxis = await page.locator('.modular-diary-period-axis[data-zone="2026-10-02"]').boundingBox()
await page.mouse.move(chip8.x + 20, chip8.y + chip8.height / 2)
await page.mouse.down()
await page.mouse.move(friAxis.x + friAxis.width / 2, friAxis.y + (3 / 16) * friAxis.height + 2, { steps: 8 })
const dropLine = await page.evaluate(() => document.querySelector(".modular-diary-period-drop-line")?.dataset.time ?? null)
await page.mouse.up()
// a click without movement must not fire a move
await page.locator('.modular-diary-period-pool .modular-diary-period-chip[data-todo-id="t10"]').click()
// same-zone drop is a no-op
await page.mouse.move(chip8.x + 20, chip8.y + chip8.height / 2)
await page.mouse.down(); await page.mouse.move(chip8.x + 30, chip8.y + 30, { steps: 4 }); await page.mouse.up()
await page.locator(".modular-diary-period-nav").nth(1).click()
await page.locator(".modular-diary-period-day-head").nth(2).click()
const ghostsAfter = await page.evaluate(() => document.querySelectorAll(".modular-diary-period-chip.is-ghost").length)
const events = await page.evaluate(() => window.__events)
await page.screenshot({ path: path.join(out, "period.png") })
await browser.close()

const errors = []
if (state.heads.length !== 7 || !state.heads[2].startsWith("周三")) errors.push("expected seven day columns Monday first")
if (state.title !== "09.28 – 10.04 · 7 天") errors.push("period title wrong: " + state.title)
if (!state.goalText[0].includes("运动") || !state.goalText[0].includes("1.5h / 3h") || !state.goalText[0].includes("还差 1.5h")) errors.push("category goal progress wrong: " + state.goalText[0])
if (!state.goalText[1].includes("#飞搜") || !state.goalText[1].includes("0.25h / 2h")) errors.push("tag goal must count diary spans: " + state.goalText[1])
if (state.poolChips.length !== 3 || !state.poolChips[0].includes("写周报") || !state.poolChips[0].includes("⚑")) errors.push("pool chips wrong: " + JSON.stringify(state.poolChips))
if (state.poolTagBadges < 2) errors.push("pool chips must show tag badges")
if (state.alldayTagBadgesVisible !== 0) errors.push("all-day chips must hide tag badges (text first)")
if (state.dueFlags.length !== 1 || !state.dueFlags[0].includes("写周报")) errors.push("due flag must appear on the due day only")
if (state.blocks !== 7 || state.spans !== 1) errors.push(`blocks/spans wrong: ${state.blocks}/${state.spans}`)
if (Math.abs(state.axisHeight - 16 * 18) > 3) errors.push("axis must be 18px per hour: " + state.axisHeight)
if (!overClass || ghosts !== 1) errors.push("drag must highlight the zone under the pointer with one ghost")
if (dropLine !== "10:00") errors.push("axis drop indicator must show the snapped time, got " + dropLine)
if (ghostsAfter !== 0) errors.push("ghost must be removed after drop")
for (const expected of ["move:t9:pool:2026-10-01", "plan:t8:pool:2026-10-02:600", "shift:1", "open:2026-09-30"]) if (!events.includes(expected)) errors.push("missing " + expected)
if (events.some((e) => e.startsWith("move:t10")) || events.some((e) => e.startsWith("move:t8:pool:pool"))) errors.push("click or same-zone drop must not move")
if (errors.length) { console.error("PERIOD CONTRACT FAILED", { errors, state, events, screenshot: path.join(out, "period.png") }); process.exit(1) }
console.log("OK period smoke passed", JSON.stringify({ events }), "screenshot:", path.join(out, "period.png"))
