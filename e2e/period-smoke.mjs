/** Product contract for the period block (`days:`): rail (goals, the day todo component, totals, resize) and the week calendar. */
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
  svg.setAttribute("class", "svg-icon"); svg.setAttribute("viewBox", "0 0 24 24"); svg.dataset.icon = name
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path")
  const shapes: Record<string, string> = { "chevron-left": "M15 6l-6 6 6 6", "chevron-right": "M9 6l6 6-6 6", plus: "M12 5v14M5 12h14", check: "M5 12l5 5 9-10", x: "M6 6l12 12M18 6L6 18", "list-tree": "M4 6h16M8 12h12M8 18h12", "arrow-up-down": "M8 4v16M4 8l4-4 4 4M16 20V4M12 16l4 4 4-4", circle: "M12 4a8 8 0 1 0 0.01 0", "trash-2": "M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13" }
  p.setAttribute("d", shapes[name] ?? "M4 12h16"); p.setAttribute("fill", "none"); p.setAttribute("stroke", "currentColor"); p.setAttribute("stroke-width", "2"); p.setAttribute("stroke-linecap", "round"); p.setAttribute("stroke-linejoin", "round")
  svg.appendChild(p); el.appendChild(svg)
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

const colors = { 开发: "#53a3f2", 写作: "#a0c849", 运动: "#ae7ee2", 吃饭: "#f47b74", 阅读: "#f4a437", 睡觉: "#cfccc4", 看剧: "#6b6b6b" }
const block = parseTimeline([
  'days: this-week',
  'rail: 256',
  'goal: type="运动" target=180',
  'goal: tag="飞搜" target=120',
  'goal: type="开发" target=600',
  'todo: id="t8" done=false estimate=60 category="写作" group="" due=2026-10-04 title="写周报 #官网"',
  'todo: id="t9" done=false estimate=45 category="开发" group="" title="装 Obsidian 测一遍 #模块日记"',
  'todo: id="t10" done=false estimate=30 category="" group="" title="回邮件"',
  'todo: id="t11" done=false estimate=90 category="开发" group="" day=2026-09-30 title="周视图重做 #模块日记"',
  'todo: id="t12" done=true estimate=60 category="运动" group="" day=2026-09-29 title="游泳"',
  'todo: id="t13" done=false estimate=60 category="开发" group="" title="飞搜精品内页 #飞搜"',
  '---',
].join("\\n"))
const today = "2026-09-30"
const period = resolvePeriod(block.period!, today)
const day = (date: string, source: string, hasNote = true) => { const doc = parseTimeline(source); return { date, entries: doc.entries, spans: doc.spans, hasNote } }
const days = [
  day("2026-09-28", "07:00-07:40 睡觉 赖床\\n08:00-08:30 阅读\\n09:00-10:00 运动 跑步\\n10:00-12:30 开发 #模块日记 周视图 parser\\n12:30-13:15 吃饭\\n@12:45-13:00 #飞搜\\n14:00-16:00 看剧\\n16:00-19:00 开发 #飞搜 精品内页\\n19:30-20:30 写作 #官网 方案"),
  day("2026-09-29", "07:00-07:30 睡觉\\n08:00-09:00 开发\\nplan 10:00-11:00 运动 游泳 [todo:t12]\\n14:00-16:00 开发 推荐栏"),
  day("2026-09-30", "plan 09:00-12:00 开发\\n09:15-11:40 开发 #模块日记 周视图重做\\n12:00-12:45 吃饭\\nplan 16:30-18:00 写作 官网文案\\nplan 19:00-19:30 运动"),
  day("2026-10-01", "", false), day("2026-10-02", "plan 10:00-10:45 开发 装 Obsidian 测一遍 [todo:t9]"), day("2026-10-03", "", false), day("2026-10-04", "plan 10:00-12:00 写作 周记"),
]
const planned = new Map(); const actual = new Map()
for (const d of days) for (const e of d.entries) { if (!e.todoId) continue; if (e.plan) planned.set(e.todoId, { date: d.date, startMin: e.startMin }); else actual.set(e.todoId, (actual.get(e.todoId) ?? 0) + e.endMin - e.startMin) }
const todos = block.todos.map((todo) => ({ ...todo, actualMinutes: actual.get(todo.id) ?? 0, placement: planned.get(todo.id) ?? (todo.day ? { date: todo.day } : undefined) }))
window.__events = []
const host = document.querySelector<HTMLElement>("#host")!
renderPeriodInto(host, {
  spec: block.period!, browsing: true, period, today, goals: goalProgress(block.goals, days), totals: periodTotals(days), todos, todoView: block.todoView,
  days: days.map((d) => ({ ...d, allDay: todos.filter((t) => t.placement && t.placement.startMin === undefined && t.placement.date === d.date) })),
  rangeStartMin: 7 * 60, rangeEndMin: 23 * 60, indexReady: true, railWidth: block.railWidth ?? 248,
}, {
  typeColors: colors, categories: Object.keys(colors),
  tagStyle: (tag) => tag === "模块日记" ? { background: "color-mix(in srgb, #53a3f2 22%, var(--background-primary))", color: "color-mix(in srgb, #53a3f2 70%, var(--text-normal))" } : null,
  tagSuggest: { tags: () => ["官网", "模块日记", "飞搜"] },
  onShift: (d) => window.__events.push("shift:" + d), onToday: () => window.__events.push("today"), onPin: () => window.__events.push("pin"),
  onOpenDay: (date) => window.__events.push("open:" + date),
  onAssign: (id, to) => window.__events.push("assign:" + id + ":" + to),
  onPlan: (id, date, startMin) => window.__events.push("plan:" + id + ":" + date + ":" + startMin),
  onAdd: (input) => window.__events.push("add:" + input.title + ":" + input.estimateMinutes),
  onEdit: (id, input) => window.__events.push("edit:" + id + ":" + input.title),
  onToggle: (id, v) => { window.__events.push("toggle:" + id + ":" + v) },
  onDelete: (id) => window.__events.push("delete:" + id),
  onMove: (id, i) => window.__events.push("move:" + id + ":" + i),
  onGroupMenu: () => window.__events.push("group"), onSortMenu: () => window.__events.push("sort"),
  onTodoMenu: (id) => window.__events.push("menu:" + id),
  onSaveGoal: (line, goal) => window.__events.push("goal:" + line + ":" + goal.kind + ":" + goal.key + ":" + goal.targetMinutes),
  onDeleteGoal: (line) => window.__events.push("goal-delete:" + line),
  onRailWidth: (px) => window.__events.push("rail:" + px),
})
`)

await esbuild.build({
  entryPoints: [path.join(out, "entry.ts")], bundle: true, format: "iife", outfile: path.join(out, "bundle.js"), logLevel: "silent",
  plugins: [{ name: "obsidian-stub", setup(build) { build.onResolve({ filter: /^obsidian$/ }, () => ({ path: path.join(out, "obsidian-stub.ts") })) } }],
})
const css = fs.readFileSync(path.join(here, "../styles.css"), "utf8")
// Obsidian's default chrome for every <button>: the redesign must not depend on its absence.
const hostile = `button { background: rgb(226,226,226); border: 1px solid rgb(180,180,180); box-shadow: 0 1px 2px rgba(0,0,0,.2); border-radius: 6px; padding: 4px 12px; font: inherit; }
input, select { font: inherit; border: 1px solid #ccc; border-radius: 5px; background: var(--background-modifier-form-field); color: var(--text-normal); padding: 0 6px; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; font-size: 14px; }`
fs.writeFileSync(path.join(out, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><style>${hostile}</style><style>${css}</style></head><body style="margin:16px"><main id="host" class="modular-diary-container modular-diary-period-container" style="width:1180px"></main><script>${fs.readFileSync(path.join(out, "bundle.js"), "utf8")}</script></body></html>`)

const themes = {
  light: { "--background-primary": "#ffffff", "--background-secondary": "#f6f6f6", "--background-modifier-border": "#e0e0e0", "--background-modifier-border-hover": "#cfcfcf", "--background-modifier-hover": "rgba(0,0,0,0.05)", "--background-modifier-form-field": "#ffffff", "--interactive-accent": "#8a5cf5", "--text-normal": "#222222", "--text-muted": "#6b6b6b", "--text-faint": "#a0a0a0", "--text-accent": "#7b4fe0", "--text-on-accent": "#ffffff", "--text-error": "#d04437", "--text-success": "#3f8a2f", "--button-radius": "6px", "--modular-diary-font-body": "14px" },
  dark: { "--background-primary": "#1e1e1e", "--background-secondary": "#262626", "--background-modifier-border": "#363636", "--background-modifier-border-hover": "#4a4a4a", "--background-modifier-hover": "rgba(255,255,255,0.06)", "--background-modifier-form-field": "#2a2a2a", "--interactive-accent": "#8a5cf5", "--text-normal": "#dcddde", "--text-muted": "#9a9a9a", "--text-faint": "#6a6a6a", "--text-accent": "#a68af9", "--text-on-accent": "#ffffff", "--text-error": "#ff6b5e", "--text-success": "#7fc56b", "--button-radius": "6px", "--modular-diary-font-body": "14px" },
}
const browser = await chromium.launch()
const shots = []
const errors = []
let events = []
for (const [name, vars] of Object.entries(themes)) {
  const page = await browser.newPage({ viewport: { width: 1220, height: 820 }, deviceScaleFactor: 2 })
  page.on("pageerror", (error) => { console.error("pageerror:", error.message); process.exit(1) })
  await page.goto("file://" + path.join(out, "index.html"))
  await page.evaluate((v) => { for (const [k, val] of Object.entries(v)) document.documentElement.style.setProperty(k, val); document.body.style.background = v["--background-primary"]; document.body.style.color = v["--text-normal"] }, vars)
  await page.waitForTimeout(80)
  const shot = path.join(out, `period-${name}.png`)
  await page.locator("#host").screenshot({ path: shot }); shots.push(shot)
  if (name !== "light") { await page.close(); continue }

  const state = await page.evaluate(() => {
    const q = (s) => [...document.querySelectorAll(s)]
    const railWidth = document.querySelector(".modular-diary-period-rail").getBoundingClientRect().width
    const iconChrome = getComputedStyle(document.querySelector(".modular-diary-period-icon")).backgroundColor
    const todoRows = q(".modular-diary-period-rail .modular-diary-todo-row").map((r) => r.textContent)
    const flags = q(".modular-diary-todo-flag").map((f) => f.textContent)
    const pills = q(".modular-diary-period-pill").map((p) => [p.textContent, Math.round(p.getBoundingClientRect().height), getComputedStyle(p).fontSize])
    const heads = q(".modular-diary-period-head").map((h) => h.textContent)
    const goals = q(".modular-diary-period-goal").map((g) => g.textContent.replace(/\s+/g, " ").trim())
    const bars = q(".modular-diary-period-totals .modular-diary-period-meter-bar").map((b) => b.style.width)
    const colHeight = document.querySelector(".modular-diary-period-col").getBoundingClientRect().height
    const railBox = document.querySelector(".modular-diary-period-rail").getBoundingClientRect()
    const mainHeight = document.querySelector(".modular-diary-period-cal").getBoundingClientRect().height
    const flagsVisible = q(".modular-diary-period-rail .modular-diary-todo-flag").every((f) => f.getBoundingClientRect().right <= railBox.right + 0.5 && f.getBoundingClientRect().width > 0)
    const zeroActualShown = q(".modular-diary-period-rail .modular-diary-item-meta-numbers").some((m) => m.textContent.includes("实际 0h"))
    const namedBlocks = q(".modular-diary-period-block:not(.is-plan) .modular-diary-period-block-name").filter((n) => n.offsetParent && n.getBoundingClientRect().width > 8).length
    const blockFont = getComputedStyle(document.querySelector(".modular-diary-period-block")).fontSize
    const microFont = getComputedStyle(document.querySelector(".modular-diary-period-gutter span")).fontSize
    const ticks = q(".modular-diary-period-meter-tick").length
    const pinVisible = !!document.querySelector(".modular-diary-period-text-button.is-pin")
    const due = q(".modular-diary-period-due").map((d) => d.textContent)
    const toolbarRightPad = parseFloat(getComputedStyle(document.querySelector(".modular-diary-period-toolbar")).paddingRight)
    return { railWidth, iconChrome, todoRows, flags, pills, heads, goals, bars, colHeight, due, toolbarRightPad, railHeight: railBox.height, mainHeight, flagsVisible, zeroActualShown, namedBlocks, blockFont, microFont, ticks, pinVisible }
  })
  if (Math.round(state.railWidth) !== 256) errors.push("rail: header must set the rail width, got " + state.railWidth)
  if (state.iconChrome !== "rgba(0, 0, 0, 0)") errors.push("toolbar icons must not inherit host button chrome: " + state.iconChrome)
  if (state.todoRows.length !== 6) errors.push("the rail lists every period todo with the day todo component: " + state.todoRows.length)
  for (const expected of ["周三", "周五 10:00", "⚑ 周日截止", "周二 10:00"]) if (!state.flags.some((f) => f === expected)) errors.push("missing placement flag " + expected + " in " + JSON.stringify(state.flags))
  if (state.pills.length !== 1 || state.pills.some(([, h, fs]) => h > 21 || parseFloat(fs) > 12)) errors.push("all-day pills must be compact: " + JSON.stringify(state.pills))
  if (!state.pills[0][0].includes("周视图重做") || state.pills[0][0].includes("#")) errors.push("pills show the title without tag noise: " + JSON.stringify(state.pills))
  if (state.heads.length !== 7 || !state.heads[2].startsWith("周三")) errors.push("seven day heads, Monday first")
  if (!state.goals[0].includes("1h / 3h") || !state.goals[1].includes("3.3h / 2h")) errors.push("goal values wrong: " + JSON.stringify(state.goals))
  if (state.bars[0] !== "100%" || state.bars.length < 4) errors.push("totals are bars scaled to the largest: " + JSON.stringify(state.bars))
  if (state.colHeight / 16 < 22 || state.colHeight / 16 > 40) errors.push("hour height must adapt within 22–40px: " + state.colHeight / 16)
  if (state.colHeight / 16 < 40 && Math.abs(state.railHeight - state.mainHeight) > 48) errors.push(`calendar should end with the rail: rail ${state.railHeight} vs calendar ${state.mainHeight}`)
  if (!state.flagsVisible) errors.push("placement flags must be fully visible inside the rail")
  if (state.zeroActualShown) errors.push("a zero actual must not be spelled out in the rail")
  if (state.namedBlocks < 5) errors.push("one-hour blocks must show what they are, got " + state.namedBlocks + " named blocks")
  if (state.ticks !== 2) errors.push("category goals must show as ticks on their total bars: " + state.ticks)
  if (!state.pinVisible) errors.push("a browsed period must offer to pin itself")
  if (state.blockFont !== state.microFont) errors.push(`block text must use the micro token like the hour labels: ${state.blockFont} vs ${state.microFont}`)
  if (state.due.length !== 1 || !state.due[0].includes("写周报")) errors.push("due flag belongs to Sunday only: " + JSON.stringify(state.due))
  if (state.toolbarRightPad < 40) errors.push("toolbar must leave room for Obsidian's edit button")

  // Drag the pool row "回邮件" onto Thursday's all-day cell.
  const row = page.locator('.modular-diary-period-rail .modular-diary-todo-row[data-todo-id="t10"] .modular-diary-todo-body')
  const rb = await row.boundingBox()
  const thu = await page.locator('.modular-diary-period-allday[data-zone="2026-10-01"]').boundingBox()
  await page.mouse.move(rb.x + 30, rb.y + rb.height / 2); await page.mouse.down()
  await page.mouse.move(thu.x + thu.width / 2, thu.y + thu.height / 2, { steps: 8 })
  const cellOver = await page.evaluate(() => document.querySelector('.modular-diary-period-allday[data-zone="2026-10-01"]').classList.contains("is-over"))
  await page.mouse.up()
  // Drag "飞搜精品内页" (60min) onto Friday at about 14:00: the preview is its full length.
  const row13 = await page.locator('.modular-diary-period-rail .modular-diary-todo-row[data-todo-id="t13"] .modular-diary-todo-body').boundingBox()
  const fri = await page.locator('.modular-diary-period-col[data-zone="2026-10-02"]').boundingBox()
  const hourPx = fri.height / 16
  await page.mouse.move(row13.x + 30, row13.y + row13.height / 2); await page.mouse.down()
  await page.mouse.move(fri.x + fri.width / 2, fri.y + 7.5 * hourPx, { steps: 8 })
  const preview = await page.evaluate(() => { const p = document.querySelector(".modular-diary-period-drop-preview"); return p ? [p.querySelector(".modular-diary-period-drop-time").textContent, Math.round(p.getBoundingClientRect().height), p.querySelector(".modular-diary-period-drop-title").textContent] : null })
  await page.mouse.up()
  // A todo without a category cannot land on the hours: the preview says why and nothing is written.
  const row10b = await page.locator('.modular-diary-period-rail .modular-diary-todo-row[data-todo-id="t10"] .modular-diary-todo-body').boundingBox()
  await page.mouse.move(row10b.x + 30, row10b.y + row10b.height / 2); await page.mouse.down()
  await page.mouse.move(fri.x + fri.width / 2, fri.y + 4 * hourPx, { steps: 8 })
  const invalid = await page.evaluate(() => { const p = document.querySelector(".modular-diary-period-drop-preview"); return p ? [p.classList.contains("is-invalid"), p.textContent] : null })
  await page.mouse.up()
  // Right-click a pill → 编辑 opens that todo's editor in the rail.
  const eventsBeforeMenu = await page.evaluate(() => window.__events.length)
  await page.evaluate(() => { window.__openedEditor = false })
  await page.evaluate(() => { const pill = document.querySelector(".modular-diary-period-pill"); const row = document.querySelector('.modular-diary-period-rail .modular-diary-todo-row[data-todo-id="t11"]'); row.addEventListener("modular-diary-edit", () => { window.__openedEditor = true }); pill.focus() })
  await page.keyboard.press("Enter")
  const menuFromKeyboard = await page.evaluate((n) => window.__events.slice(n), eventsBeforeMenu)
  // Drag a pill from Wednesday back to the list.
  const pill = await page.locator('.modular-diary-period-pill').first().boundingBox()
  const list = await page.locator('.modular-diary-period-todos').boundingBox()
  await page.mouse.move(pill.x + 10, pill.y + 10); await page.mouse.down()
  await page.mouse.move(list.x + list.width / 2, list.y + 30, { steps: 8 }); await page.mouse.up()
  // Goals: edit the first one, switch to tag, then add a new one.
  await page.locator(".modular-diary-period-goal").first().click()
  const formOpen = await page.locator(".modular-diary-period-goal-form").count()
  await page.locator(".modular-diary-period-goal-form .modular-diary-period-goal-target input").fill("4")
  await page.locator(".modular-diary-period-goal-form").evaluate((f) => f.requestSubmit())
  await page.locator(".modular-diary-period-goals .modular-diary-component-actions button").click()
  await page.locator(".modular-diary-period-goal-form .modular-diary-period-seg button").nth(1).click()
  await page.locator(".modular-diary-period-goal-key input").fill("#long2text")
  await page.locator(".modular-diary-period-goal-target input").fill("1.5")
  await page.locator(".modular-diary-period-goal-form").evaluate((f) => f.requestSubmit())
  // Todo add form fits the rail.
  await page.locator(".modular-diary-period-todos .modular-diary-component-actions button").last().click()
  const estimateReadable = await page.evaluate(() => { const i = document.querySelector(".modular-diary-period-rail .modular-diary-todo-add-form .modular-diary-todo-estimate-input"); return i ? i.clientWidth >= 40 : false })
  const formBox = await page.evaluate(() => { const f = document.querySelector(".modular-diary-period-rail .modular-diary-todo-add-form"); const r = f.getBoundingClientRect(); const rail = document.querySelector(".modular-diary-period-rail").getBoundingClientRect(); return { right: r.right, railRight: rail.right, overflow: [...f.children].some((c) => c.getBoundingClientRect().right > rail.right + 0.5) } })
  await page.locator(".modular-diary-period-rail .modular-diary-todo-add-form .modular-diary-todo-title-input").fill("新的周待办")
  await page.locator(".modular-diary-period-rail .modular-diary-todo-add-form .modular-diary-todo-title-input").press("Enter")
  await page.locator("#host").screenshot({ path: path.join(out, "period-editing.png") }); shots.push(path.join(out, "period-editing.png"))
  // Rail resize.
  if (!estimateReadable) errors.push("the estimate input must be wide enough to read")
  const handle = await page.locator(".modular-diary-period-rail-handle").boundingBox()
  await page.mouse.move(handle.x + 1, handle.y + 200); await page.mouse.down(); await page.mouse.move(handle.x + 61, handle.y + 200, { steps: 6 }); await page.mouse.up()
  // Keyboard resizing writes once after the keys settle, not on every press.
  await page.locator(".modular-diary-period-rail-handle").focus()
  const railWritesBefore = await page.evaluate(() => window.__events.filter((e) => e.startsWith("rail:")).length)
  await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight")
  await page.waitForTimeout(700)
  const railWrites = await page.evaluate((n) => window.__events.filter((e) => e.startsWith("rail:")).slice(n), railWritesBefore)
  if (railWrites.length !== 1) errors.push("keyboard resize must commit once: " + JSON.stringify(railWrites))
  await page.locator(".modular-diary-period-text-button.is-pin").click()
  await page.locator('.modular-diary-period-rail .modular-diary-todo-row[data-todo-id="t9"]').focus()
  await page.keyboard.press("Alt+ArrowDown")
  // Narrow block: the week comes first and keeps a fixed hour height.
  await page.evaluate(() => { document.querySelector("#host").style.width = "600px" })
  await page.waitForTimeout(120)
  const narrow = await page.evaluate(() => ({ mainFirst: document.querySelector(".modular-diary-period-main").getBoundingClientRect().top < document.querySelector(".modular-diary-period-rail").getBoundingClientRect().top, hour: document.querySelector(".modular-diary-period").style.getPropertyValue("--modular-diary-period-hour") }))
  if (!narrow.mainFirst || narrow.hour !== "28px") errors.push("narrow blocks show the week first at the default hour: " + JSON.stringify(narrow))
  await page.locator("#host").screenshot({ path: path.join(out, "period-narrow.png") }); shots.push(path.join(out, "period-narrow.png"))
  await page.evaluate(() => { document.querySelector("#host").style.width = "1180px" })
  await page.locator(".modular-diary-period-icon").nth(1).click()
  await page.locator(".modular-diary-period-head").nth(3).click()
  events = await page.evaluate(() => window.__events)
  if (!cellOver) errors.push("the all-day cell under the pointer must highlight")
  if (!preview || preview[0] !== "14:00–15:00" || Math.abs(preview[1] - hourPx) > 3 || preview[2] !== "飞搜精品内页") errors.push("axis drop preview must show the title, the time and the todo's full length: " + JSON.stringify(preview))
  if (!invalid || !invalid[0] || !invalid[1].includes("先给它选个分类")) errors.push("an uncategorised todo must show a disabled preview over the hours: " + JSON.stringify(invalid))
  if (!menuFromKeyboard.includes("menu:t11")) errors.push("Enter on a focused pill must open its menu")
  if (formOpen !== 1) errors.push("clicking a goal opens its editor in place")
  if (formBox.overflow) errors.push("the todo add form must fit inside the rail: " + JSON.stringify(formBox))
  await page.close()
}
await browser.close()
for (const expected of ["assign:t10:2026-10-01", "plan:t13:2026-10-02:840", "assign:t11:pool", "goal:2:type:运动:240", "goal:null:tag:long2text:90", "add:新的周待办:30", "rail:316", "shift:1", "open:2026-10-01", "pin", "move:t9:2"]) if (!events.includes(expected)) errors.push("missing " + expected)
if (events.some((e) => e.startsWith("plan:t10"))) errors.push("an uncategorised todo must not be planned")
if (errors.length) { console.error("PERIOD CONTRACT FAILED", { errors, events, shots }); process.exit(1) }
console.log("OK period smoke passed", JSON.stringify(events), "\n" + shots.join("\n"))
