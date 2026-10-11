/**
 * Visual options for second-level todo groups (DCC: 待办二级分组样式重做).
 * Renders the production todo renderer (category → tag grouping, sub-todos,
 * completed rows) headless, then layers each candidate stylesheet on top.
 * Group counts and collapse chevrons are injected by this script only: they
 * preview what the chosen option would add to the renderer.
 *
 *   node prototypes/todo-subgroup-options.mjs <output-dir>
 */
import esbuild from "esbuild"
import { chromium } from "playwright"
import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"
import os from "node:os"

const here = path.dirname(fileURLToPath(import.meta.url))
const shots = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), "todo-subgroup-options"))
const out = fs.mkdtempSync(path.join(os.tmpdir(), "todo-subgroup-build-"))
fs.mkdirSync(shots, { recursive: true })

fs.writeFileSync(path.join(out, "obsidian-stub.ts"), `
const paths: Record<string, string> = {
  "list-tree": "M3 5h4M3 12h4M3 19h4M11 5h10M11 12h10M11 19h10",
  "arrow-up-down": "M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4",
  "plus": "M12 5v14M5 12h14",
  "check": "M5 12l5 5 9-10",
  "chevron-down": "M6 9l6 6 6-6",
  "chevron-right": "M9 6l6 6-6 6",
  "layout-grid": "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
}
export function setIcon(el: HTMLElement, name: string): void {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("viewBox", "0 0 24 24")
  svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "2")
  svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round")
  svg.setAttribute("width", "14"); svg.setAttribute("height", "14")
  svg.dataset.icon = name
  if (name === "circle") {
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle")
    c.setAttribute("cx", "12"); c.setAttribute("cy", "12"); c.setAttribute("r", "8")
    svg.appendChild(c)
  } else {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path")
    p.setAttribute("d", paths[name] ?? "M8 12h8")
    svg.appendChild(p)
  }
  el.appendChild(svg)
}
`)

fs.writeFileSync(path.join(out, "entry.ts"), `
import { renderTodosInto } from "${path.join(here, "../src/render/todos-view")}"
HTMLElement.prototype.createDiv = function (opts: any = {}) {
  const el = document.createElement("div")
  if (opts.cls) el.className = opts.cls
  if (opts.text) el.textContent = opts.text
  this.appendChild(el); return el
}
HTMLElement.prototype.createEl = function (tag: string, opts: any = {}) {
  const el = document.createElement(tag)
  if (opts.cls) el.className = opts.cls
  if (opts.text) el.textContent = opts.text
  if (opts.attr) for (const [key, value] of Object.entries(opts.attr)) el.setAttribute(key, String(value))
  this.appendChild(el); return el
}
const colors: Record<string, string> = { 开发: "#55b8d8", 自媒体: "#e07a9a", 运动: "#ffae32" }
const slot = document.querySelector<HTMLElement>("#host")!.createDiv({ cls: "modular-diary-slot modular-diary-slot-todos" })
slot.style.cssText = "position:relative;width:440px"
const item = (id: string, title: string, type: string, extra: any = {}) => ({ id, title, group: "", type, completed: false, weekly: false, estimateMinutes: 30, actualMinutes: 0, tags: (title.match(/#[^\\s#]+/g) ?? []).map((t) => t.slice(1)), ...extra })
renderTodosInto(slot, [
  item("a1", "DCC 每日视图出方案 #DCC", "开发", { estimateMinutes: 60, actualMinutes: 40 }),
  item("a2", "修复周视图色块重叠 #日记插件", "开发", { estimateMinutes: 90 }),
  item("a3", "二级分组样式 #日记插件", "开发", { completed: true, actualMinutes: 35 }),
  item("a4", "拖拽体验调研 #日记插件", "开发", { parent: "a2", estimateMinutes: 20 }),
  item("a5", "合并 checklist PR #DCC", "开发", { completed: true, estimateMinutes: 15, actualMinutes: 10 }),
  item("b1", "小红书选题三条 #小红书", "自媒体", { note: "参考上周数据，避开重复话题" }),
  item("b2", "剪辑周末 vlog #视频号", "自媒体", { estimateMinutes: 120 }),
  item("b3", "回复评论 #小红书", "自媒体", { completed: true, estimateMinutes: 15, actualMinutes: 15 }),
  item("c1", "晨跑 5km #跑步", "运动", { completed: true, actualMinutes: 32 }),
  item("c2", "拉伸 #拉伸", "运动", { estimateMinutes: 15 }),
], {
  categories: Object.keys(colors), typeColors: colors,
  view: { groupBy: "category", sortBy: "manual", group2: "tag" },
  onAdd: () => {}, onEdit: () => {}, onGroupMenu: () => {}, onSortMenu: () => {}, onToggle: () => {}, onMenu: () => {}, onMove: () => {},
  onMoveGroup: () => {},
})
;(window as any).__colors = colors
`)

await esbuild.build({
  entryPoints: [path.join(out, "entry.ts")], bundle: true, format: "iife", outfile: path.join(out, "bundle.js"), logLevel: "silent",
  plugins: [{ name: "obsidian-stub", setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: path.join(out, "obsidian-stub.ts") }))
  } }],
})

const css = fs.readFileSync(path.join(here, "../styles.css"), "utf8")
const page0 = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:20px;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;font-size:14px}
${css}</style><style id="option"></style></head><body><main id="host" class="modular-diary-container" style="width:440px"></main>
<script>${fs.readFileSync(path.join(out, "bundle.js"), "utf8")}</script></body></html>`
fs.writeFileSync(path.join(out, "index.html"), page0)

/* Preview-only additions: a count and a collapse chevron on every group header. */
const decorate = () => {
  const colors = window.__colors
  for (const section of document.querySelectorAll(".modular-diary-todo-group-section")) {
    const header = section.querySelector(":scope > .modular-diary-todo-group")
    const rows = Array.from(section.querySelectorAll(".modular-diary-todo-row"))
    const done = rows.filter((row) => row.classList.contains("is-complete")).length
    const name = header.querySelector(".modular-diary-todo-group-name")
    if (!section.classList.contains("is-sub")) section.style.setProperty("--group-color", colors[name.textContent] ?? "var(--text-faint)")
    const chev = document.createElement("span")
    chev.className = "preview-chevron"
    chev.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>'
    header.insertBefore(chev, name)
    const count = document.createElement("span")
    count.className = "preview-count"
    count.textContent = `${done}/${rows.length}`
    header.appendChild(count)
  }
  // Show one collapsed sub-group so the folded state is visible too.
  const folded = Array.from(document.querySelectorAll(".modular-diary-todo-group-section.is-sub")).find((s) => s.textContent.includes("视频号"))
  folded?.classList.add("preview-collapsed")
}

const shared = `
.preview-chevron{display:none}
.preview-count{display:none}
.preview-collapsed > .modular-diary-todo-group-rows{display:none}
`

/* All options: the group grip hangs in the left gutter like row grips, so it never pushes the title. */
const gutterGrip = `
.modular-diary-todo-group{position:relative}
.modular-diary-todo-group > .modular-diary-todo-group-drag{position:absolute;left:-22px;top:50%;transform:translateY(-50%)}
`

const options = {
  current: "",
  /* A — refined outline: color dot + hairline for level 1, quiet small label for level 2, no rail. */
  "A-quiet-outline": `
.modular-diary-todo-group-section:not(.is-sub){margin-top:12px}
.modular-diary-todo-group-section:not(.is-sub):first-child{margin-top:4px}
.modular-diary-todo-group-section:not(.is-sub) > .modular-diary-todo-group{
  gap:6px;padding:4px 2px 6px;color:var(--text-muted);font-size:12px;font-weight:600;
  border-bottom:1px solid var(--background-modifier-border);margin-bottom:2px}
.modular-diary-todo-group-section:not(.is-sub) > .modular-diary-todo-group::before{
  content:"";order:-2;width:7px;height:7px;border-radius:50%;background:var(--group-color);flex:none}
.modular-diary-todo-group-section.is-sub{margin:0;padding:0;border:0}
.modular-diary-todo-group-section.is-sub > .modular-diary-todo-group{
  gap:4px;padding:8px 2px 2px 13px;color:var(--text-faint);font-size:11px;font-weight:500}
.modular-diary-todo-group-section.is-sub > .modular-diary-todo-group-rows{padding-left:13px}
.preview-chevron{display:inline-flex;order:3;color:var(--text-faint);opacity:0}
.modular-diary-todo-group:hover .preview-chevron{opacity:1}
.preview-collapsed .preview-chevron{opacity:1;transform:rotate(-90deg)}
.preview-count{display:inline;margin-left:auto;color:var(--text-faint);font-weight:400;font-variant-numeric:tabular-nums}
`,
  /* B — level-1 cards: each category is a soft surface; level 2 are plain dividers inside. */
  "B-group-cards": `
.modular-diary-todo-group-section:not(.is-sub){
  margin-top:10px;padding:4px 8px 6px;border-radius:10px;
  background:color-mix(in srgb,var(--background-secondary) 75%,transparent)}
.modular-diary-todo-group-section:not(.is-sub):first-child{margin-top:4px}
.modular-diary-todo-group-section:not(.is-sub) > .modular-diary-todo-group{
  gap:6px;padding:6px 0 4px;color:var(--text-normal);font-size:13px;font-weight:600}
.modular-diary-todo-group-section:not(.is-sub) > .modular-diary-todo-group::before{
  content:"";order:-2;width:3px;height:12px;border-radius:2px;background:var(--group-color);flex:none}
.modular-diary-todo-group-section.is-sub{margin:0;padding:0;border:0}
.modular-diary-todo-group-section.is-sub + .modular-diary-todo-group-section.is-sub{border-top:1px solid var(--background-modifier-border);margin-top:4px}
.modular-diary-todo-group-section.is-sub > .modular-diary-todo-group{
  gap:4px;padding:7px 0 1px;color:var(--text-muted);font-size:11px;font-weight:500}
.preview-chevron{display:inline-flex;order:-1;color:var(--text-faint)}
.modular-diary-todo-group-section:not(.is-sub) > .modular-diary-todo-group > .preview-chevron{display:none}
.preview-collapsed .preview-chevron{transform:rotate(-90deg)}
.preview-count{display:inline;margin-left:auto;color:var(--text-faint);font-weight:400;font-size:11px;font-variant-numeric:tabular-nums}
`,
  /* C — level-2 pills: level 1 is a colored title bar, level 2 a small tag-like chip carrying its count. */
  "C-sub-pills": `
.modular-diary-todo-group-section:not(.is-sub){margin-top:14px}
.modular-diary-todo-group-section:not(.is-sub):first-child{margin-top:4px}
.modular-diary-todo-group-section:not(.is-sub) > .modular-diary-todo-group{
  gap:6px;padding:2px 0 4px 8px;color:var(--text-normal);font-size:13px;font-weight:600;
  border-left:3px solid var(--group-color);margin-bottom:2px}
.modular-diary-todo-group-section.is-sub{margin:6px 0 0;padding:0;border:0}
.modular-diary-todo-group-section.is-sub > .modular-diary-todo-group{padding:2px 0}
.modular-diary-todo-group-section.is-sub > .modular-diary-todo-group > .modular-diary-todo-group-name,
.modular-diary-todo-group-section.is-sub > .modular-diary-todo-group > .preview-count{
  font-size:11px;font-weight:500;line-height:18px}
.modular-diary-todo-group-section.is-sub > .modular-diary-todo-group{gap:0}
.modular-diary-todo-group-section.is-sub > .modular-diary-todo-group > .modular-diary-todo-group-name{
  padding:0 4px 0 8px;border-radius:9px 0 0 9px;color:var(--text-muted);
  background:var(--background-modifier-hover,var(--background-secondary))}
.modular-diary-todo-group-section.is-sub > .modular-diary-todo-group > .preview-count{
  display:inline;padding:0 8px 0 2px;border-radius:0 9px 9px 0;color:var(--text-faint);
  background:var(--background-modifier-hover,var(--background-secondary));font-variant-numeric:tabular-nums}
.modular-diary-todo-group-section:not(.is-sub) > .modular-diary-todo-group > .preview-count{
  display:inline;margin-left:auto;color:var(--text-faint);font-weight:400;font-size:11px}
.preview-chevron{display:none}
.preview-collapsed > .modular-diary-todo-group > .modular-diary-todo-group-name::before{content:"▸ ";color:var(--text-faint)}
`,
}

const themes = {
  light: { "--background-primary": "#ffffff", "--background-secondary": "#f4f4f5", "--background-modifier-border": "#e3e3e3", "--background-modifier-hover": "#ececee", "--interactive-accent": "#9567e8", "--text-normal": "#252525", "--text-muted": "#6b6b6b", "--text-faint": "#9a9a9a", "--text-accent": "#7e50dc" },
  dark: { "--background-primary": "#1e1e1e", "--background-secondary": "#262626", "--background-modifier-border": "#3a3a3a", "--background-modifier-hover": "#303030", "--interactive-accent": "#9567e8", "--text-normal": "#dadada", "--text-muted": "#a3a3a3", "--text-faint": "#717171", "--text-accent": "#a88bfa" },
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 520, height: 900 }, deviceScaleFactor: 2 })
page.on("pageerror", (error) => { console.error("pageerror:", error.message); process.exit(1) })
const written = []
for (const [name, optionCss] of Object.entries(options)) {
  for (const [theme, vars] of Object.entries(themes)) {
    if (name === "current" && theme === "dark") continue
    await page.goto("file://" + path.join(out, "index.html"))
    if (name !== "current") await page.evaluate(decorate)
    await page.evaluate(({ vars, cssText }) => {
      for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v)
      document.body.style.background = vars["--background-primary"]
      document.body.style.color = vars["--text-normal"]
      document.querySelector("#option").textContent = cssText
    }, { vars, cssText: shared + (name === "current" ? "" : gutterGrip) + optionCss })
    await page.waitForTimeout(80)
    const file = path.join(shots, `${name}-${theme}.png`)
    await page.locator(".modular-diary-slot-todos").screenshot({ path: file })
    written.push(file)
  }
}
await browser.close()
console.log(JSON.stringify({ ok: true, written }, null, 2))
