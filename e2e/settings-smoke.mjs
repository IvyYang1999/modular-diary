/** Product contracts for the focused category and habit settings editors. */
import esbuild from "esbuild"
import { chromium } from "playwright"
import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"
import os from "node:os"

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(os.tmpdir(), "modular-diary-settings-smoke")
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })

fs.writeFileSync(path.join(out, "obsidian-stub.ts"), `
export function setIcon(el: HTMLElement, name: string): void {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.dataset.icon = name
  el.appendChild(svg)
}
export class Modal {
  modalEl: HTMLElement
  contentEl: HTMLElement
  titleEl: HTMLElement
  constructor(_app: unknown) {
    this.modalEl = document.createElement("div")
    this.modalEl.className = "modal"
    this.titleEl = document.createElement("h2")
    this.contentEl = document.createElement("div")
    this.modalEl.append(this.titleEl, this.contentEl)
    document.body.appendChild(this.modalEl)
  }
  setTitle(value: string): this { this.titleEl.textContent = value; return this }
  open(): void { this.onOpen() }
  close(): void { this.onClose(); this.modalEl.remove() }
  onOpen(): void {}
  onClose(): void {}
}
export class App {}
export class TFile { path = ""; basename = ""; extension = "md"; constructor(path = "") { this.path = path; this.basename = path.split("/").pop()!.replace(/\\.md$/, "") } }
export class TFolder { path = ""; children: unknown[] = []; constructor(path = "") { this.path = path } }
export class Notice { constructor(public message: string) {} }
export class FuzzySuggestModal<T> { constructor(_app: unknown) {} setPlaceholder(_value: string): void {} open(): void {} }
export const moment = () => ({ isValid: () => false })
export function normalizePath(value: string): string { return value.replace(/\\/+/g, "/").replace(/^\\/|\\/$/g, "") }
class ToggleControl {
  toggleEl: HTMLElement
  value = false
  knob: HTMLElement
  constructor(parent: HTMLElement) {
    // Approximates Obsidian's switch so the harness can click and screenshot it.
    this.toggleEl = document.createElement("div"); this.toggleEl.className = "checkbox-container"
    this.toggleEl.style.cssText = "position:relative;display:inline-block;width:36px;height:20px;border-radius:10px;cursor:pointer;transition:background .15s"
    this.knob = document.createElement("span")
    this.knob.style.cssText = "position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:left .15s"
    this.toggleEl.appendChild(this.knob); parent.appendChild(this.toggleEl); this.setValue(false)
  }
  setValue(value: boolean): this {
    this.value = value; this.toggleEl.classList.toggle("is-enabled", value)
    this.toggleEl.style.background = value ? "var(--interactive-accent, #9567e8)" : "var(--background-modifier-border, #d9d9d9)"
    this.knob.style.left = value ? "18px" : "2px"
    return this
  }
  setTooltip(value: string): this { this.toggleEl.setAttribute("aria-label", value); return this }
  onChange(callback: (value: boolean) => void): this { this.toggleEl.addEventListener("click", () => { this.setValue(!this.value); callback(this.value) }); return this }
}
export class PluginSettingTab {
  containerEl: HTMLElement
  constructor(_app: unknown, _plugin: unknown) {
    this.containerEl = document.createElement("main")
    document.body.appendChild(this.containerEl)
  }
}

class TextControl {
  inputEl: HTMLInputElement
  constructor(parent: HTMLElement) { this.inputEl = document.createElement("input"); this.inputEl.type = "text"; parent.appendChild(this.inputEl) }
  setValue(value: string): this { this.inputEl.value = value; return this }
  setPlaceholder(value: string): this { this.inputEl.placeholder = value; return this }
  onChange(callback: (value: string) => void): this { this.inputEl.addEventListener("change", () => callback(this.inputEl.value)); return this }
}
class TextareaControl {
  inputEl: HTMLTextAreaElement
  constructor(parent: HTMLElement) { this.inputEl = document.createElement("textarea"); parent.appendChild(this.inputEl) }
  setValue(value: string): this { this.inputEl.value = value; return this }
  onChange(callback: (value: string) => void): this { this.inputEl.addEventListener("change", () => callback(this.inputEl.value)); return this }
}
class DropdownControl {
  selectEl: HTMLSelectElement
  constructor(parent: HTMLElement) { this.selectEl = document.createElement("select"); parent.appendChild(this.selectEl) }
  addOption(value: string, label: string): this { const option = document.createElement("option"); option.value = value; option.textContent = label; this.selectEl.appendChild(option); return this }
  setValue(value: string): this { this.selectEl.value = value; return this }
  onChange(callback: (value: string) => void): this { this.selectEl.addEventListener("change", () => callback(this.selectEl.value)); return this }
}
class ButtonControl {
  buttonEl: HTMLButtonElement
  constructor(parent: HTMLElement) { this.buttonEl = document.createElement("button"); parent.appendChild(this.buttonEl) }
  setButtonText(value: string): this { this.buttonEl.textContent = value; return this }
  setCta(): this { this.buttonEl.classList.add("mod-cta"); return this }
  setIcon(value: string): this { setIcon(this.buttonEl, value); return this }
  setTooltip(value: string): this { this.buttonEl.setAttribute("aria-label", value); return this }
  onClick(callback: () => void): this { this.buttonEl.addEventListener("click", callback); return this }
}
export class Setting {
  settingEl: HTMLElement
  infoEl: HTMLElement
  controlEl: HTMLElement
  constructor(parent: HTMLElement) {
    this.settingEl = document.createElement("div"); this.settingEl.className = "setting-item"
    this.infoEl = document.createElement("div"); this.infoEl.className = "setting-item-info"
    this.controlEl = document.createElement("div"); this.controlEl.className = "setting-item-control"
    this.settingEl.append(this.infoEl, this.controlEl); parent.appendChild(this.settingEl)
  }
  setName(value: string): this { const el = document.createElement("div"); el.className = "setting-item-name"; el.textContent = value; this.infoEl.appendChild(el); return this }
  setDesc(value: string): this { const el = document.createElement("div"); el.className = "setting-item-description"; el.textContent = value; this.infoEl.appendChild(el); return this }
  setClass(value: string): this { this.settingEl.classList.add(value); return this }
  addText(callback: (control: TextControl) => void): this { callback(new TextControl(this.controlEl)); return this }
  addTextArea(callback: (control: TextareaControl) => void): this { callback(new TextareaControl(this.controlEl)); return this }
  addToggle(callback: (control: ToggleControl) => void): this { callback(new ToggleControl(this.controlEl)); return this }
  addDropdown(callback: (control: DropdownControl) => void): this { callback(new DropdownControl(this.controlEl)); return this }
  addButton(callback: (control: ButtonControl) => void): this { callback(new ButtonControl(this.controlEl)); return this }
  addExtraButton(callback: (control: ButtonControl) => void): this { callback(new ButtonControl(this.controlEl)); return this }
  addToggle(callback: (control: ToggleControl) => void): this { callback(new ToggleControl(this.controlEl)); return this }
}
`)

fs.writeFileSync(path.join(out, "entry.ts"), `
import { renderCategorySettings, renderHabitSettings } from "${path.join(here, "../src/settings-editors")}" 
import { CategorySettingsModal, HabitSettingsModal } from "${path.join(here, "../src/settings-modals")}" 
import { ModularDiarySettingTab } from "${path.join(here, "../src/settings")}"
import { RhythmsNote } from "${path.join(here, "../src/rhythms-note")}"
import { parseRhythms } from "${path.join(here, "../src/core/rhythms")}"
import { configureI18n } from "${path.join(here, "../src/i18n")}"
import { TFile, TFolder } from "obsidian"

HTMLElement.prototype.createDiv = function (opts: any = {}) {
  const el = document.createElement("div")
  if (opts.cls) el.className = opts.cls
  if (opts.text) el.textContent = opts.text
  this.appendChild(el); return el
}
HTMLElement.prototype.createSpan = function (opts: any = {}) {
  const el = document.createElement("span")
  if (opts.cls) el.className = opts.cls
  if (opts.text) el.textContent = opts.text
  if (opts.attr) for (const [key, value] of Object.entries(opts.attr)) el.setAttribute(key, String(value))
  this.appendChild(el); return el
}
HTMLElement.prototype.createEl = function (tag: string, opts: any = {}) {
  const el = document.createElement(tag)
  if (opts.cls) el.className = opts.cls
  if (opts.text) el.textContent = opts.text
  if (opts.attr) for (const [key, value] of Object.entries(opts.attr)) el.setAttribute(key, String(value))
  this.appendChild(el); return el
}
HTMLElement.prototype.empty = function () { this.replaceChildren() }
HTMLElement.prototype.addClass = function (...values: string[]) { this.classList.add(...values) }

const settings = {
  spanTypeColors: { develop: "#55b8d8", sport: "#ffae32" }, markerTypeColors: { deadline: "#ef5b72" },
  spanRetiredTypeColors: {}, markerRetiredTypeColors: {},
  habits: [
    { id: "daily", name: "开发", type: "develop", targetMinutes: 30, targetPeriod: "day", schedule: { kind: "daily" }, order: 0 },
    { id: "weekly", name: "运动", type: "sport", targetMinutes: 180, targetPeriod: "week", schedule: { kind: "daily" }, repeatWeekly: false, weekAnchor: "2026-08-17", order: 1 },
    { id: "any", name: "发布", type: "develop", targetMinutes: 0, targetPeriod: "day", schedule: { kind: "weekdays" }, order: 2 },
    { id: "count", name: "复盘", type: "develop", targetMinutes: 0, targetPeriod: "week", targetMetric: "count", targetCount: 3, schedule: { kind: "daily" }, repeatWeekly: true, order: 3 },
  ], weeklyTodos: [], rhythmsFile: "节律.md", periodFolder: "周期", todoPriorities: ["P1", "P2", "P3"], hourHeight: 48, width: 200, rangeStartHour: 7, rangeEndHour: 23,
  dailyQuotes: [],
  dailyQuoteDefaults: {
    theme: "timeline", layout: "left", font: "interface", fontSize: 20,
    backgroundColor: "", textColor: "", accentColor: "", backgroundImage: "", overlay: 0.28,
  },
  dialogBackend: "api", provider: "openai-compatible", apiKey: "", baseUrl: "", model: "",
  timelineOnboardingSeen: true,
}
const checklistFolder = new TFolder("Checklists")
const checklistSources = {
  "Checklists/睡前.md": "---\\ndaily: true\\n---\\n- 刷牙\\n- 关电脑\\n- 写明天计划\\n",
  "Checklists/产品体验.md": "- 飞搜\\n- Long2Text\\n- OpenTrends\\n- Swob\\n",
}
checklistFolder.children = Object.keys(checklistSources).map((path) => new TFile(path))
window.__frontmatter = {}
const app = {
  vault: {
    getAbstractFileByPath: (path: string) => path === "Checklists" ? checklistFolder : null,
    cachedRead: async (file: any) => checklistSources[file.path],
  },
  fileManager: {
    processFrontMatter: async (file: any, edit: (fm: Record<string, unknown>) => void) => {
      const fm = window.__frontmatter[file.path] ?? {}; edit(fm); window.__frontmatter[file.path] = fm
    },
  },
  workspace: { getLeaf: () => ({ openFile: async () => undefined }) },
}
Object.assign(settings, { checklistFolder: "Checklists" })
const host = { app, settings, refreshHourlyNudge: () => undefined, effectiveTemplateSource: () => settings.templateSource ?? "---", saveSettings: async () => { window.__saves += 1 } }
host.rhythms = new RhythmsNote({ app: () => app, settings: () => settings, saveSettings: host.saveSettings, onChange: () => undefined })
host.rhythms.items = parseRhythms("- 每天 30分钟 开发 @develop\\n- 每周 3小时 运动 @sport\\n- 每月 1次 独立旅游 @sport 2-3天")
window.__saves = 0
window.__settings = settings
renderCategorySettings(document.querySelector("#categories"), host)
renderHabitSettings(document.querySelector("#habits"), host)
configureI18n(() => "en")
renderHabitSettings(document.querySelector("#habits-en"), host)
configureI18n(() => "zh")
new CategorySettingsModal({} as any, host as any, "marker").open()
new HabitSettingsModal({} as any, host as any).open()
const globalTab = new ModularDiarySettingTab(app as any, host as any)
globalTab.containerEl.id = "global-settings"
globalTab.display()
`)

await esbuild.build({
  entryPoints: [path.join(out, "entry.ts")], bundle: true, format: "iife", outfile: path.join(out, "bundle.js"), logLevel: "silent",
  plugins: [{ name: "obsidian-stub", setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: path.join(out, "obsidian-stub.ts") }))
  } }],
})

const css = fs.readFileSync(path.join(here, "../styles.css"), "utf8")
fs.writeFileSync(path.join(out, "styles.css"), css)
fs.writeFileSync(path.join(out, "index.html"), `<!doctype html><html><head><link rel="stylesheet" href="styles.css"><style>select:hover,select:focus{background:var(--background-modifier-hover)!important}[data-settings-section='checklists']{font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:var(--text-normal)}[data-settings-section='checklists'] .setting-item{display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid var(--background-modifier-border)}[data-settings-section='checklists'] .setting-item-info{flex:1 1 auto}[data-settings-section='checklists'] .setting-item-control{display:flex;align-items:center;justify-content:flex-end}[data-settings-section='checklists'] .setting-item-description{color:var(--text-muted);font-size:13px;padding-top:2px}[data-settings-section='checklists'] .setting-item-control>button{background:none;border:0;color:var(--text-muted);padding:4px}[data-settings-section='checklists'] svg[data-icon]{width:16px;height:16px}[data-settings-section='checklists'] input{background:var(--background-modifier-form-field);color:var(--text-normal);border:1px solid var(--background-modifier-border);border-radius:5px;padding:4px 8px}</style></head><body><main class="modular-diary-focused-settings"><section id="categories"></section><section id="habits"></section><section id="habits-en"></section></main><script src="bundle.js"></script></body></html>`)

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 820, height: 900 }, deviceScaleFactor: 1 })
page.on("pageerror", (error) => console.error("SETTINGS PAGE ERROR", error))
await page.goto("file://" + path.join(out, "index.html"))
await page.evaluate(() => {
  const root = document.documentElement.style
  root.setProperty("--background-primary", "#ffffff")
  root.setProperty("--background-secondary", "#f2f2f2")
  root.setProperty("--background-modifier-border", "#d9d9d9")
  root.setProperty("--background-modifier-hover", "#ececec")
  root.setProperty("--background-modifier-form-field", "#ffffff")
  root.setProperty("--interactive-accent", "#9567e8")
  root.setProperty("--text-normal", "#252525")
  root.setProperty("--text-muted", "#707070")
  root.setProperty("--text-faint", "#999999")
  root.setProperty("--button-radius", "7px")
})

await page.waitForFunction(() => document.querySelectorAll("#global-settings .modular-diary-checklist-setting").length === 2)
const checklistState = await page.evaluate(() => {
  const section = document.querySelector("#global-settings [data-settings-section='checklists']")
  const rows = [...section.querySelectorAll(".modular-diary-checklist-setting")].map((row) => ({
    name: row.querySelector(".setting-item-name")?.textContent,
    desc: row.querySelector(".setting-item-description")?.textContent,
    daily: row.querySelector(".checkbox-container")?.classList.contains("is-enabled"),
    label: row.querySelector(".modular-diary-checklist-daily-label")?.textContent,
  }))
  return {
    heading: section.querySelector("h3")?.textContent,
    folder: section.querySelector(".setting-item input")?.value,
    rows,
    addLabel: section.querySelector(".modular-diary-settings-add-rule")?.textContent?.trim(),
  }
})
await page.locator("#global-settings [data-settings-section='checklists']").screenshot({ path: path.join(out, "global-settings-checklists.png") })
await page.locator("#global-settings [data-settings-section='checklists'] .modular-diary-checklist-setting").filter({ hasText: "产品体验" }).locator(".checkbox-container").click()
const checklistFrontmatter = await page.evaluate(() => structuredClone(window.__frontmatter))

const state = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("#habits .modular-diary-rule-editor")]
  const daily = rows[0]
  const weekly = rows[1]
  const labels = [...daily.querySelectorAll(".modular-diary-rule-field-label")].map((el) => el.textContent)
  const selectValues = [...daily.querySelectorAll("select")].map((el) => el.options[el.selectedIndex]?.textContent)
  const parent = daily.parentElement.getBoundingClientRect()
  const row = daily.getBoundingClientRect()
  const categoryColor = getComputedStyle(daily.querySelector(".modular-diary-category-picker-dot")).backgroundColor
  const categoryColorValue = daily.querySelector('[data-field="category"] select').value
  const duration = daily.querySelector(".modular-diary-duration-control")
  const durationInput = duration.querySelector('input[type="number"]')
  const durationUnit = duration.querySelector("select")
  const goalValue = daily.querySelector('[data-field="goal"] select')?.value
  const categoryList = document.querySelector("#categories .modular-diary-category-editor-list")
  const categorySwatch = document.querySelector("#categories .modular-diary-category-color-input")
  const globalSettings = document.querySelector("#global-settings")
  globalSettings.style.width = "610px"
  const currentSections = [...globalSettings.querySelectorAll(".modular-diary-settings-section")]
  const globalCategoryList = globalSettings.querySelector(".modular-diary-settings-section[data-settings-section='span-categories'] .modular-diary-category-editor-list") ?? currentSections[0]?.querySelector(".modular-diary-category-editor-list")
  const globalMarkerRows = globalSettings.querySelectorAll(".modular-diary-settings-section[data-settings-section='marker-categories'] .modular-diary-category-editor-row")
  // The habits section lists the rhythms note now: one three-column row per rhythm.
  const globalHabitRow = globalSettings.querySelector(".modular-diary-settings-section[data-settings-section='habits'] .modular-diary-rhythm-row") ?? currentSections[2]?.querySelector(".modular-diary-rhythm-row")
  const globalHabitRect = globalHabitRow.getBoundingClientRect()
  const globalHabitChildren = [...globalHabitRow.children].map((el) => el.getBoundingClientRect())
  const globalSections = [...globalSettings.querySelectorAll(".modular-diary-settings-section")]
  const todoRules = globalSettings.querySelector("[data-settings-section='todo-rules']")
  const timelineSettings = globalSettings.querySelector("[data-settings-section='timeline']")
  const addWeekly = todoRules?.querySelector(".modular-diary-settings-add-rule")
  const englishDaily = document.querySelector('#habits-en .modular-diary-rule-editor[data-habit-id="daily"]')
  const rowColumns = rows.map((editor) => {
    const left = (selector) => {
      const node = editor.querySelector(selector)
      return node ? Math.round(node.getBoundingClientRect().left * 10) / 10 : null
    }
    return {
      name: left('[data-field="name"]'),
      category: left('[data-field="category"]'),
      goal: left('[data-field="goal"]'),
      target: left('[data-field="target"]'),
      repeat: left('[data-field="repeat"]'),
      actions: left('.modular-diary-settings-row-actions'),
    }
  })
  return {
    rows: rows.length,
    labels,
    selectValues,
    dailyRepeatCount: daily.querySelectorAll('[data-field="repeat"]').length,
    weeklyRepeatCount: weekly.querySelectorAll('[data-field="repeat"]').length,
    weeklyRepeatValue: weekly.querySelector('[data-field="repeat"] select')?.value,
    categoryColor,
    categoryColorValue,
    durationValue: durationInput?.value,
    durationUnit: durationUnit?.value,
    goalValue,
    categoryColumns: getComputedStyle(categoryList).gridTemplateColumns.split(" ").length,
    categorySwatchRadius: getComputedStyle(categorySwatch).borderRadius,
    categorySwatchWidth: categorySwatch.getBoundingClientRect().width,
    categorySwatchHeight: categorySwatch.getBoundingClientRect().height,
    leftInset: row.left - parent.left,
    categoryRows: document.querySelectorAll("#categories .modular-diary-category-editor-row").length,
    modalTitles: [...document.querySelectorAll(".modular-diary-settings-modal > h2")].map((el) => el.textContent),
    focusedCategoryScope: document.querySelector(".modular-diary-settings-modal .modular-diary-category-scope-tabs button.is-active")?.dataset.scope,
    focusedCategoryRows: document.querySelectorAll(".modular-diary-settings-modal [data-category-scope='marker'] .modular-diary-category-editor-row").length,
    globalCategoryColumns: getComputedStyle(globalCategoryList).gridTemplateColumns.split(" ").length,
    globalMarkerRows: globalMarkerRows.length,
    globalHabitColumns: getComputedStyle(globalHabitRow).gridTemplateColumns.split(" ").length,
    globalHabitWithinRow: globalHabitChildren.every((rect) => rect.left >= globalHabitRect.left - 0.5 && rect.right <= globalHabitRect.right + 0.5),
    globalSectionGap: parseFloat(getComputedStyle(globalSections[1]).marginTop),
    globalSectionKeys: globalSections.map((section) => section.getAttribute("data-settings-section")),
    todoRulesHeading: todoRules?.querySelector("h3")?.textContent ?? "",
    timelineHeading: timelineSettings?.querySelector("h3")?.textContent ?? "",
    weeklyLegacyHeadingCount: [...globalSettings.querySelectorAll("h3")].filter((heading) => heading.textContent === "每周累计待办").length,
    addWeeklyLabel: addWeekly?.textContent?.trim() ?? "",
    addWeeklyHeight: addWeekly?.getBoundingClientRect().height ?? 0,
    addWeeklyBackground: addWeekly ? getComputedStyle(addWeekly).backgroundColor : "",
    addWeeklyBorderStyle: addWeekly ? getComputedStyle(addWeekly).borderStyle : "",
    quoteSection: (() => {
      const section = globalSettings.querySelector("[data-settings-section='daily-quotes']")
      return {
        present: Boolean(section),
        hasLibrary: Boolean(section?.querySelector("textarea.modular-diary-quote-library")),
        hasInkDots: (section?.querySelectorAll(".modular-diary-quote-ink-dot").length ?? 0) > 1,
        hasDesigner: Boolean(section?.querySelector(".modular-diary-quote-designer, .modular-diary-quote-settings-tabs, details")),
        sectionHeight: section?.getBoundingClientRect().height ?? 0,
      }
    })(),
    timelineTop: timelineSettings.getBoundingClientRect().top - globalSettings.getBoundingClientRect().top,
    timelineSettingNames: timelineSettings ? [...timelineSettings.querySelectorAll(".setting-item-name")].map((el) => el.textContent) : [],
    englishLabels: [...englishDaily.querySelectorAll(".modular-diary-rule-field-label")].map((el) => el.textContent),
    englishGoalOptions: [...englishDaily.querySelector('[data-field="goal"] select').options].map((option) => option.textContent),
    englishRepeatOptions: [...englishDaily.querySelector('[data-field="repeat"] select').options].map((option) => option.textContent),
    rowColumns,
  }
})

await page.locator("#habits").screenshot({ path: path.join(out, "habits-light.png") })
await page.locator("#habits-en").screenshot({ path: path.join(out, "habits-en-light.png") })
await page.locator("#categories").screenshot({ path: path.join(out, "categories-light.png") })
await page.locator(".modular-diary-settings-modal").first().screenshot({ path: path.join(out, "categories-modal-marker-light.png") })
await page.locator("#global-settings").screenshot({ path: path.join(out, "global-settings-610.png") })
await page.locator("#global-settings [data-settings-section='daily-quotes']").screenshot({ path: path.join(out, "global-settings-quote.png") })
await page.locator('#habits .modular-diary-rule-editor[data-habit-id="daily"] [data-field="category"] select').hover()
const categoryHoverBackground = await page.locator('#habits .modular-diary-rule-editor[data-habit-id="daily"] [data-field="category"] select').evaluate((el) => getComputedStyle(el).backgroundColor)
await page.evaluate(() => {
  document.documentElement.style.setProperty("--background-primary", "#202020")
  document.documentElement.style.setProperty("--background-secondary", "#292929")
  document.documentElement.style.setProperty("--background-modifier-border", "#454545")
  document.documentElement.style.setProperty("--background-modifier-form-field", "#292929")
  document.documentElement.style.setProperty("--text-normal", "#e6e6e6")
  document.documentElement.style.setProperty("--text-muted", "#aaaaaa")
  document.body.style.background = "#202020"
})
await page.locator("#habits").screenshot({ path: path.join(out, "habits-dark.png") })
await page.locator("#global-settings [data-settings-section='checklists']").screenshot({ path: path.join(out, "global-settings-checklists-dark.png") })
await page.locator("#categories").screenshot({ path: path.join(out, "categories-dark.png") })
await page.setViewportSize({ width: 460, height: 900 })
const narrowCategoryColumns = await page.locator("#categories .modular-diary-category-editor-list").evaluate((el) =>
  getComputedStyle(el).gridTemplateColumns.split(" ").length
)
await page.locator("#categories").screenshot({ path: path.join(out, "categories-narrow.png") })
await page.locator("#global-settings").evaluate((el) => { el.style.width = "440px" })
const globalNarrowState = await page.locator("#global-settings").evaluate((root) => {
  const sections = [...root.querySelectorAll(".modular-diary-settings-section")]
  const habitRow = root.querySelector("[data-settings-section='habits'] .modular-diary-rhythm-row") ?? sections[2]?.querySelector(".modular-diary-rhythm-row")
  const habitRect = habitRow.getBoundingClientRect()
  return {
    categoryColumns: getComputedStyle(root.querySelector("[data-settings-section='span-categories'] .modular-diary-category-editor-list") ?? sections[0]?.querySelector(".modular-diary-category-editor-list")).gridTemplateColumns.split(" ").length,
    habitColumns: getComputedStyle(habitRow).gridTemplateColumns.split(" ").length,
    habitChildrenWithinRow: [...habitRow.children].every((el) => {
      const rect = el.getBoundingClientRect()
      return rect.left >= habitRect.left - 0.5 && rect.right <= habitRect.right + 0.5
    }),
  }
})
await page.locator("#global-settings").screenshot({ path: path.join(out, "global-settings-440.png") })
await page.locator("#global-settings").evaluate((el) => { el.style.width = "610px" })
await page.setViewportSize({ width: 820, height: 900 })
await page.evaluate(() => {
  const root = document.documentElement.style
  root.setProperty("--background-primary", "#ffffff")
  root.setProperty("--background-secondary", "#f2f2f2")
  root.setProperty("--background-modifier-border", "#d9d9d9")
  root.setProperty("--background-modifier-hover", "#ececec")
  root.setProperty("--background-modifier-form-field", "#ffffff")
  root.setProperty("--text-normal", "#252525")
  root.setProperty("--text-muted", "#707070")
  document.body.style.background = "#ffffff"
})
await page.locator('#habits .modular-diary-rule-editor[data-habit-id="daily"] [data-field="name"] input').fill("")
await page.locator('#habits .modular-diary-rule-editor[data-habit-id="daily"] [data-field="name"] input').dispatchEvent("change")
await page.locator('#habits .modular-diary-rule-editor[data-habit-id="daily"] .modular-diary-duration-control select').selectOption("hours")
await page.locator('#habits .modular-diary-rule-editor[data-habit-id="daily"] .modular-diary-duration-control input').fill("0.5")
await page.locator('#habits .modular-diary-rule-editor[data-habit-id="daily"] .modular-diary-duration-control input').dispatchEvent("change")
const repeatSelect = page.locator('#habits .modular-diary-rule-editor[data-habit-id="daily"] [data-field="repeat"] select')
await repeatSelect.selectOption("weekly")
await page.waitForSelector('#habits .modular-diary-rule-editor[data-habit-id="daily"] [data-field="weekdays"] button')
const weekdayButtons = page.locator('#habits .modular-diary-rule-editor[data-habit-id="daily"] [data-field="weekdays"] button')
const weekdayCount = await weekdayButtons.count()
await weekdayButtons.nth(2).click()

await repeatSelect.selectOption("interval")
await page.waitForSelector('#habits .modular-diary-rule-editor[data-habit-id="daily"] [data-field="interval"]')
await page.locator('#habits .modular-diary-rule-editor[data-habit-id="daily"] [data-field="interval"] input[type="number"]').fill("3")
await page.locator('#habits .modular-diary-rule-editor[data-habit-id="daily"] [data-field="interval"] input[type="number"]').dispatchEvent("change")
await page.locator('#habits .modular-diary-rule-editor[data-habit-id="daily"] [data-field="interval"] input[type="date"]').fill("2026-08-23")
await page.locator('#habits .modular-diary-rule-editor[data-habit-id="daily"] [data-field="interval"] input[type="date"]').dispatchEvent("change")
await page.locator('#habits .modular-diary-rule-editor[data-habit-id="daily"]').screenshot({ path: path.join(out, "habit-interval-light.png") })
const intervalState = await page.evaluate(() => structuredClone(window.__settings.habits[0].schedule))

await repeatSelect.selectOption("dates")
await page.waitForSelector('#habits .modular-diary-rule-editor[data-habit-id="daily"] [data-field="dates"] input[type="date"]')
await page.locator('#habits .modular-diary-rule-editor[data-habit-id="daily"] .modular-diary-date-add').click()
await page.waitForFunction(() => document.querySelectorAll('#habits .modular-diary-rule-editor[data-habit-id="daily"] [data-field="dates"] input[type="date"]').length === 2)
await page.locator('#habits .modular-diary-rule-editor[data-habit-id="daily"]').screenshot({ path: path.join(out, "habit-dates-light.png") })
const datePickerCount = await page.locator('#habits .modular-diary-rule-editor[data-habit-id="daily"] [data-field="dates"] input[type="date"]').count()

await page.locator('#habits .modular-diary-rule-editor[data-habit-id="daily"] [data-field="goal"] select').selectOption("daily-below")
await page.waitForSelector('#habits .modular-diary-rule-editor[data-habit-id="daily"] [data-field="target"] .modular-diary-duration-control')
await page.locator('#habits .modular-diary-rule-editor[data-habit-id="daily"] .modular-diary-duration-control select').selectOption("hours")
await page.locator('#habits .modular-diary-rule-editor[data-habit-id="daily"] .modular-diary-duration-control input').fill("0.5")
await page.locator('#habits .modular-diary-rule-editor[data-habit-id="daily"] .modular-diary-duration-control input').dispatchEvent("change")
await page.locator('#habits .modular-diary-rule-editor[data-habit-id="daily"]').screenshot({ path: path.join(out, "habit-daily-below-light.png") })
const belowState = await page.evaluate(() => ({
  comparison: window.__settings?.habits?.[0]?.durationComparison ?? null,
  targetMinutes: window.__settings?.habits?.[0]?.targetMinutes ?? null,
  targetPeriod: window.__settings?.habits?.[0]?.targetPeriod ?? null,
  targetMetric: window.__settings?.habits?.[0]?.targetMetric ?? null,
}))

await page.locator('#habits .modular-diary-rule-editor[data-habit-id="daily"] [data-field="goal"] select').selectOption("weekly-count")
await page.waitForSelector('#habits .modular-diary-rule-editor[data-habit-id="daily"] [data-field="target"] .modular-diary-count-control')
await page.locator('#habits .modular-diary-rule-editor[data-habit-id="daily"] [data-field="target"] input').fill("3")
await page.locator('#habits .modular-diary-rule-editor[data-habit-id="daily"] [data-field="target"] input').dispatchEvent("change")
await page.locator('#habits .modular-diary-rule-editor[data-habit-id="daily"]').screenshot({ path: path.join(out, "habit-weekly-count-light.png") })
const changedState = await page.evaluate(() => ({
  saves: window.__saves,
  storedMinutes: window.__settings?.habits?.[0]?.targetMinutes ?? null,
  storedCount: window.__settings?.habits?.[0]?.targetCount ?? null,
  storedMetric: window.__settings?.habits?.[0]?.targetMetric ?? null,
  storedPeriod: window.__settings?.habits?.[0]?.targetPeriod ?? null,
  storedName: window.__settings?.habits?.[0]?.name ?? null,
  dailyRepeatCount: document.querySelectorAll('#habits .modular-diary-rule-editor[data-habit-id="daily"] [data-field="repeat"]').length,
}))
const priorityTiers = page.locator("#global-settings [data-settings-section='todo-rules'] textarea[aria-label='优先级档位']")
await priorityTiers.fill("马上\n 随时 \n马上")
await priorityTiers.dispatchEvent("change")
const customPriorityTiers = await page.evaluate(() => window.__settings.todoPriorities)
await browser.close()

const errors = []
if (customPriorityTiers.join("|") !== "P0|马上|随时") errors.push("custom priority tiers must persist highest-first and deduplicate without editing Todos")
if (state.rows !== 4) errors.push("expected four habit editors covering duration, no-target, and count layouts")
for (const column of ["name", "category", "goal", "repeat", "actions"]) {
  const positions = state.rowColumns.map((row) => row[column]).filter((value) => value !== null)
  if (new Set(positions).size !== 1) errors.push(`habit editor ${column} column drifts when optional fields are absent`)
}
const targetPositions = state.rowColumns.map((row) => row.target).filter((value) => value !== null)
if (new Set(targetPositions).size !== 1) errors.push("habit editor target column drifts between duration and count controls")
for (const label of ["打卡名称", "统计分类", "完成条件", "目标时长", "重复规则"]) {
  if (!state.labels.includes(label)) errors.push(`missing field label: ${label}`)
}
if (new Set(state.selectValues).size !== state.selectValues.length) errors.push("habit editor exposes duplicate unlabeled option text")
if (state.dailyRepeatCount !== 1 || state.weeklyRepeatCount !== 1 || state.weeklyRepeatValue !== "once") errors.push("daily and weekly goals must expose distinct recurrence rules")
if (state.categoryColorValue !== "develop" || !state.categoryColor.includes("85, 184, 216")) errors.push("tracked category picker does not expose the selected category color")
if (categoryHoverBackground !== "rgba(0, 0, 0, 0)") errors.push("tracked category inner select paints a second hover surface")
if (state.durationValue !== "30" || state.durationUnit !== "minutes") errors.push("30-minute goals must initially use the compact minute unit")
if (state.goalValue !== "daily-duration") errors.push("legacy daily duration goal did not migrate to the explicit completion condition")
if (state.categoryColumns !== 2) errors.push("wide category editor must use a compact two-column layout")
if (narrowCategoryColumns !== 1) errors.push("narrow category editor must collapse to one column")
if (state.categorySwatchWidth !== state.categorySwatchHeight || state.categorySwatchRadius !== "50%") errors.push("category color marker must be circular")
if (state.leftInset > 16) errors.push("habit editor retained the empty Setting info column")
if (state.categoryRows !== 2) errors.push("category editor did not render the shared settings data")
if (state.modalTitles.join("|") !== "时间分类|打卡设置") errors.push("focused settings modals are not independently addressable")
if (state.focusedCategoryScope !== "marker" || state.focusedCategoryRows !== 1) errors.push("time-point category entry did not open its independent focused set")
if (state.globalMarkerRows !== 1) errors.push("global settings did not render the independent time-point category set")
if (state.globalCategoryColumns !== 2 || state.globalHabitColumns !== 3) errors.push("typical-width global settings collapsed into the narrow layout too early")
if (!state.globalHabitWithinRow) errors.push("global habit controls overflow their editor row")
if (state.globalSectionGap < 20) errors.push("global settings sections have no stable vertical separation")
if (state.globalSectionKeys.join("|") !== "timeline|span-categories|marker-categories|habits|todo-rules|daily-quotes|checklists|natural-language") errors.push("global settings must run timeline → categories → habits → todo rules → daily quotes → checklists → natural-language capture")
const checklistRows = Object.fromEntries(checklistState.rows.map((row) => [row.name, row]))
if (checklistState.heading !== "清单" || checklistState.folder !== "Checklists" || checklistState.addLabel !== "新建清单") errors.push("checklist settings need a heading, the template folder and a New checklist action")
if (checklistState.rows.length !== 2 || checklistRows["睡前"]?.desc !== "3 项" || checklistRows["产品体验"]?.desc !== "4 项") errors.push("checklist settings must list every template file with its item count")
if (checklistRows["睡前"]?.daily !== true || checklistRows["产品体验"]?.daily !== false || checklistRows["睡前"]?.label !== "每天自动加入") errors.push("checklist daily switch must reflect each template's frontmatter")
if (checklistFrontmatter["Checklists/产品体验.md"]?.daily !== true) errors.push("turning on Add every day must write daily: true into the template file")
if (state.timelineTop > 120) errors.push("timeline defaults must be the first thing on the global settings page")
if (!state.quoteSection.present || !state.quoteSection.hasLibrary || !state.quoteSection.hasInkDots || state.quoteSection.hasDesigner || state.quoteSection.sectionHeight > 420) errors.push("daily quote settings must be one textarea plus highlighter dots, no designer or disclosure")
if (state.todoRulesHeading !== "待办规则" || state.timelineHeading !== "时间轴") errors.push("global todo and timeline sections need clear concept-level headings")
if (state.weeklyLegacyHeadingCount !== 0) errors.push("weekly cumulative todos must not appear as a separate top-level product concept")
if (state.timelineSettingNames.join("|") !== "默认时间范围（起–止，小时）|每小时高度（px）|整点提醒写小时日记|提醒时段（起–止，小时）|新日记模板|同时发系统通知") errors.push("timeline defaults escaped their own settings section")
if (!["Habit name", "Tracked category", "Completion condition", "Target duration", "Repeat rule"].every((label) => state.englishLabels.includes(label))) errors.push("English habit fields are not locale-parity with Chinese")
if (!state.englishGoalOptions.includes("Daily total below") || !state.englishGoalOptions.includes("Weekly completion count") || !state.englishRepeatOptions.includes("Every N days") || !state.englishRepeatOptions.includes("Specific calendar dates")) errors.push("English recurrence and completion-condition options are incomplete")
if (globalNarrowState.categoryColumns !== 1 || globalNarrowState.habitColumns !== 3) errors.push("truly narrow global settings do not collapse into the compact two-field layout")
if (!globalNarrowState.habitChildrenWithinRow) errors.push("truly narrow global settings let a habit control escape its row")
if (weekdayCount !== 7) errors.push("selected weekly days must render seven direct manipulation buttons")
if (intervalState.kind !== "interval" || intervalState.everyDays !== 3 || intervalState.anchorDate !== "2026-08-23") errors.push("every-N-days schedule did not persist its interval and stable anchor date")
if (datePickerCount !== 2) errors.push("specific calendar dates must use an interactive multi-date picker")
if (belowState.comparison !== "below" || belowState.targetMinutes !== 30 || belowState.targetPeriod !== "day" || belowState.targetMetric !== "duration") errors.push("daily upper-bound duration goal did not persist its strict comparison and normalized duration")
if (changedState.saves < 9 || changedState.dailyRepeatCount !== 1 || changedState.storedMinutes !== 0 || changedState.storedCount !== 3 || changedState.storedMetric !== "count" || changedState.storedPeriod !== "week" || changedState.storedName !== "develop") errors.push("name fallback, recurrence, and weekly-count edits did not persist canonically through the shared settings host")
if (errors.length) {
  console.error("SETTINGS CONTRACT FAILED", { errors, state, screenshots: out })
  process.exit(1)
}
console.log(JSON.stringify({ ok: true, state, screenshots: out }, null, 2))
