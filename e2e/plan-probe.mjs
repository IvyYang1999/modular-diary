/** Product contract for the period block (`days:`): rail (goals, the day todo component, totals, resize) and the week calendar. */
import esbuild from "esbuild"
import { chromium } from "playwright"
import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"
import os from "node:os"

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(os.tmpdir(), "modular-diary-plan-probe")
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
import { rhythmBoard, scopeContaining, ensureRhythmSlots, sessionId } from "${path.join(here, "../src/core/rhythm-ledger")}"
import { parseRhythms } from "${path.join(here, "../src/core/rhythms")}"

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

const colors = { 开发: "#53a3f2", 写作: "#a0c849", 运动: "#ae7ee2", 吃饭: "#f47b74", 阅读: "#f4a437", 睡觉: "#cfccc4", 看剧: "#6b6b6b", 视频: "#f4a437", 家人: "#e0569a", 活动: "#3fb28a", 旅行: "#2bb3c0" }
const rhythms = parseRhythms(["- 每周 拍口播视频 @视频 整天", "- 每周 和爸妈出门 @家人 上午-下午", "- 每两周 周二 14:00-15:00 心理咨询 @家人 自2026-09-29", "- 每周 线下 AI 活动 @活动", "- 每周 3小时 学习 @阅读", "- 每天 30分钟 运动 @运动", "- 每天 八段锦", "- 每月 独立旅游 @旅行 2-3天", "- 每月 市内一人游 @旅行 整天"].join("\\n"))
const weekScope = scopeContaining("week", "2026-09-30"), monthScope = scopeContaining("month", "2026-09-30")
let weekSrc = ensureRhythmSlots([
  'days: 2026-09-28..2026-10-04', 'scope: week', 'rail: 262',
  'goal: type="运动" target=180', 'goal: tag="飞搜" target=120 note="投放前把内页做完"', 'goal: type="开发" target=1200', 'goal: text="把周视图第 3 轮改完" id="g1" note="节律面板、联动、月视图"', 'goal: text="给爸妈打一次电话" done=true',
  'todo: id="t8" done=false estimate=60 category="写作" group="" due=2026-10-04 title="写周报 #官网"',
  'todo: id="t9" done=false estimate=45 category="开发" group="" title="装 Obsidian 测一遍 #模块日记"',
  'todo: id="t10" done=false estimate=30 category="" group="" title="回邮件"',
  'todo: id="b1" done=false estimate=60 category="阅读" group="" under="学习" title="读第 3 章"',
  'todo: id="b2" done=true estimate=120 category="阅读" group="" under="学习" day=2026-10-02 zone=ev title="做题"',
  'todo: id="b3" done=false estimate=30 category="开发" group="" goal="g1" title="修拖拽"',
  'todo: id="t11" done=false estimate=90 category="开发" group="" day=2026-09-30 title="周视图重做 #模块日记"',
  'todo: id="t12" done=true estimate=60 category="运动" group="" day=2026-09-29 title="游泳"',
  'todo: id="t13" done=false estimate=60 category="开发" group="" day=2026-09-28 zone=am title="阶段 1：解决卡点"',
  ...[1,2,3,4,5,6].map((n) => 'todo: id="am' + n + '" done=false estimate=30 category="写作" group="" day=2026-09-29 zone=am title="上午的事 ' + n + '"'),
  'todo: id="r-owed-1" done=false estimate=0 category="活动" group="" rhythm="线下-ai-活动" owed=2026-W39 title="线下 AI 活动"',
  '---',
].join("\\n"), rhythms, weekScope)
weekSrc = weekSrc.replace(/(rhythm="拍口播视频")/, 'day=2026-10-01 zone=pm $1')
const monthSrc = ensureRhythmSlots([
  'days: 2026-09-01..2026-09-30', 'scope: month', 'rail: 262',
  'goal: type="开发" target=4800',
  'todo: id="m1" done=false estimate=0 category="开发" group="" day=2026-09-07 title="阶段 2：发布"',
  'todo: id="m2" done=false estimate=0 category="开发" group="" day=2026-09-14 title="阶段 3：推广"',
  '---',
].join("\\n"), rhythms, monthScope).replace(/(rhythm="独立旅游")/, 'day=2026-09-18 $1')
const today = "2026-09-30"
const day = (date: string, source: string, hasNote = true) => { const doc = parseTimeline(source); return { date, entries: doc.entries, spans: doc.spans, hasNote } }
const known = new Map([
  day("2026-09-28", "07:00-07:40 睡觉 赖床\\n08:00-08:30 阅读\\n09:00-10:00 运动 跑步\\n10:00-12:30 开发 #模块日记 周视图 parser\\n12:30-13:15 吃饭\\n14:00-16:00 看剧\\n16:00-19:00 开发 #飞搜 精品内页\\n19:30-20:30 写作 #官网 方案"),
  day("2026-09-29", "07:00-07:30 睡觉\\n08:00-09:00 开发\\nplan 10:00-11:00 运动 游泳 [todo:t12]\\n14:00-15:00 家人 心理咨询\\n14:00-16:00 开发 推荐栏"),
  day("2026-09-30", "plan 09:00-12:00 开发\\n09:15-11:40 开发 #模块日记 周视图重做\\n12:00-12:45 吃饭\\nplan 16:30-18:00 写作 官网文案\\nplan 19:00-19:30 运动\\nplan 20:00-21:00 阅读 学习 [todo:" + sessionId(rhythms.find((r) => r.id === "学习")!) + "]"),
  day("2026-10-02", "plan 10:00-10:45 开发 装 Obsidian 测一遍 [todo:t9]"), day("2026-10-04", "plan 10:00-12:00 写作 周记"),
].map((d) => [d.date, d]))
for (let n = 1; n <= 27; n++) {
  const date = "2026-09-" + String(n).padStart(2, "0")
  if (known.has(date)) continue
  const dev = 120 + (n * 37) % 240, rest = (n * 53) % 90
  known.set(date, day(date, "09:00-" + String(9 + Math.floor(dev / 60)).padStart(2, "0") + ":" + String(dev % 60).padStart(2, "0") + " 开发\\n13:00-13:45 吃饭\\n" + (n % 3 ? "17:00-17:" + String(30 + rest % 30) + " 运动\\n" : "") + (n % 4 ? "" : "20:00-22:00 看剧")))
}
window.__events = []
const host = document.querySelector<HTMLElement>("#host")!
const deps = {
  typeColors: colors, categories: Object.keys(colors),
  tagStyle: (tag) => tag === "模块日记" ? { background: "color-mix(in srgb, #53a3f2 22%, var(--background-primary))", color: "color-mix(in srgb, #53a3f2 70%, var(--text-normal))" } : null,
  onShift: (d) => window.__events.push("shift:" + d), onToday: () => window.__events.push("today"), onPin: () => window.__events.push("pin"),
  onOpenDay: (date) => window.__events.push("open:" + date),
  onAssign: (id, to) => window.__events.push("assign:" + id + ":" + to),
  onPlan: (id, date, startMin) => window.__events.push("plan:" + id + ":" + date + ":" + startMin),
  onAdd: () => {}, onEdit: () => {}, onToggle: () => {}, onDelete: () => {}, onMove: () => {}, onGroupMenu: () => {}, onSortMenu: () => {},
  onTodoMenu: (id) => window.__events.push("menu:" + id), onSaveGoal: () => {}, onDeleteGoal: () => {}, onRailWidth: () => {},
  onAddStatsWidget: () => {}, onRemoveStatsWidget: () => {},
  onSetFace: (face) => window.__events.push("face:" + face), onSwitchView: (view) => window.__events.push("view:" + view),
  onRhythmMenu: (id) => window.__events.push("rhythm-menu:" + id), onOpenRhythms: () => window.__events.push("rhythms"),
  onReorderRhythm: (id, before) => window.__events.push("reorder:" + id + ":" + before), onHeight: (px) => window.__events.push("height:" + px), onToggleShowTodos: () => window.__events.push("show-todos"),
  onSession: (id, date, zone) => window.__events.push("session:" + id + ":" + date + ":" + zone), onRemoveSession: (date, line) => window.__events.push("remove-session:" + date + ":" + line),
}
window.mount = (kind: "week" | "month", face: "plan" | "actual") => {
  host.replaceChildren()
  const block = parseTimeline(kind === "week" ? weekSrc : monthSrc)
  if (block.errors.length) throw new Error(JSON.stringify(block.errors))
  const scope = kind === "week" ? weekScope : monthScope
  const period = resolvePeriod(block.period!, today)
  const days = period.days.map((date) => known.get(date) ?? day(date, "", false))
  const planned = new Map(); const actual = new Map()
  for (const d of days) for (const e of d.entries) { if (!e.todoId) continue; if (e.plan) planned.set(e.todoId, { date: d.date, startMin: e.startMin }); else actual.set(e.todoId, (actual.get(e.todoId) ?? 0) + e.endMin - e.startMin) }
  const todos = block.todos.map((todo) => ({ ...todo, actualMinutes: actual.get(todo.id) ?? 0, placement: planned.get(todo.id) ?? (todo.day ? { date: todo.day } : undefined) }))
  // The other period kind's items: the month's placed rhythm in the week, a week's placed slots in the month.
  const otherSrc = kind === "week" ? monthSrc.replace("2026-09-18", "2026-10-02") : weekSrc
  const foreignTodos = parseTimeline(otherSrc).todos.filter((todo) => !todo.moved && todo.day).map((todo) => ({ ...todo, actualMinutes: 0, placement: { date: todo.day }, foreign: kind === "week" ? "来自本月协议" : "来自第 40 周" }))
  const facts = days.map((d) => ({ date: d.date, entries: d.entries, habitDone: d.date === "2026-09-28" ? ["八段锦"] : [] }))
  renderPeriodInto(host, {
    spec: block.period!, browsing: false, period, today, goals: goalProgress(block.goals, days), totals: periodTotals(days), todos, todoView: block.todoView, todoGroupOrder: block.todoGroupOrder,
    foreignTodos,
    days: days.map((d) => ({ ...d, allDay: todos.filter((t) => t.placement && t.placement.startMin === undefined && t.placement.date === d.date), foreign: foreignTodos.filter((t) => t.placement.date === d.date),
      upcoming: d.date === "2026-10-03" ? [{ line: 0, date: d.date, startMin: 840, endMin: 900, type: "运动", text: "爬山", done: false }, { line: 1, date: d.date, text: "交房租", done: false, zone: "ev" }] : d.date === "2026-09-25" ? [{ line: 2, date: d.date, text: "去某地", done: false, zone: "pm" }] : [] })),
    rangeStartMin: 7 * 60, rangeEndMin: 23 * 60, indexReady: true, railWidth: 262, statsWidgets: ["share", "days:运动"],
    scope, face, board: rhythmBoard(rhythms, scope, todos, facts, block.rhythmSkips, foreignTodos.map((t) => ({ ...t, foreignScope: scopeContaining("week", t.placement.date) }))), embeddedView: kind,
    height: face === "plan" ? 560 : undefined,
  }, deps)
}
window.mount("week", "plan")
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
const browser = await chromium.launch({ headless: true })
const outDir = process.argv[2] || out
for (const [name, vars] of Object.entries(themes)) {
  const page = await browser.newPage({ viewport: { width: 1220, height: 820 }, deviceScaleFactor: 2 })
  page.on("pageerror", (error) => { console.error("pageerror:", error.message); process.exit(1) })
  await page.goto("file://" + path.join(out, "index.html"))
  await page.evaluate((v) => { for (const [k, val] of Object.entries(v)) document.documentElement.style.setProperty(k, val); document.body.style.background = v["--background-primary"]; document.body.style.color = v["--text-normal"] }, vars)
  for (const [kind, face] of [["week", "plan"], ["week", "actual"], ["month", "plan"], ["month", "actual"]]) {
    if (name === "dark" && !(kind === "week" && face === "plan")) continue
    await page.evaluate(([k, f]) => window.mount(k, f), [kind, face])
    await page.waitForTimeout(120)
    await page.locator("#host").screenshot({ path: path.join(outDir, `impl-${kind}-${face}${name === "dark" ? "-dark" : ""}.png`) })
  }
  await page.close()
}
await browser.close()
console.log("done", outDir)
