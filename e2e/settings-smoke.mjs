/** Product contracts for the focused category and habit settings editors. */
import esbuild from "esbuild"
import { chromium } from "playwright"
import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"
import os from "node:os"

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(os.tmpdir(), "oneday-settings-smoke")
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
  addDropdown(callback: (control: DropdownControl) => void): this { callback(new DropdownControl(this.controlEl)); return this }
  addButton(callback: (control: ButtonControl) => void): this { callback(new ButtonControl(this.controlEl)); return this }
  addExtraButton(callback: (control: ButtonControl) => void): this { callback(new ButtonControl(this.controlEl)); return this }
}
`)

fs.writeFileSync(path.join(out, "entry.ts"), `
import { renderCategorySettings, renderHabitSettings } from "${path.join(here, "../src/settings-editors")}" 
import { CategorySettingsModal, HabitSettingsModal } from "${path.join(here, "../src/settings-modals")}" 
import { OnedaySettingTab } from "${path.join(here, "../src/settings")}" 
import { configureI18n } from "${path.join(here, "../src/i18n")}" 

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
  ], weeklyTodos: [], hourHeight: 48, width: 200, rangeStartHour: 7, rangeEndHour: 23,
  dailyQuotes: [],
  dailyQuoteDefaults: {
    theme: "timeline", layout: "left", font: "interface", fontSize: 20,
    backgroundColor: "", textColor: "", accentColor: "", backgroundImage: "", overlay: 0.28,
  },
  dialogBackend: "api", provider: "openai-compatible", apiKey: "", baseUrl: "", model: "",
  timelineOnboardingSeen: true,
}
const host = { settings, saveSettings: async () => { window.__saves += 1 } }
window.__saves = 0
window.__settings = settings
renderCategorySettings(document.querySelector("#categories"), host)
renderHabitSettings(document.querySelector("#habits"), host)
configureI18n(() => "en")
renderHabitSettings(document.querySelector("#habits-en"), host)
configureI18n(() => "zh")
new CategorySettingsModal({} as any, host as any, "marker").open()
new HabitSettingsModal({} as any, host as any).open()
const globalTab = new OnedaySettingTab({} as any, host as any)
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
fs.writeFileSync(path.join(out, "index.html"), `<!doctype html><html><head><link rel="stylesheet" href="styles.css"><style>select:hover,select:focus{background:var(--background-modifier-hover)!important}</style></head><body><main class="oneday-focused-settings"><section id="categories"></section><section id="habits"></section><section id="habits-en"></section></main><script src="bundle.js"></script></body></html>`)

const browser = await chromium.launch()
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

const state = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("#habits .oneday-rule-editor")]
  const daily = rows[0]
  const weekly = rows[1]
  const labels = [...daily.querySelectorAll(".oneday-rule-field-label")].map((el) => el.textContent)
  const selectValues = [...daily.querySelectorAll("select")].map((el) => el.options[el.selectedIndex]?.textContent)
  const parent = daily.parentElement.getBoundingClientRect()
  const row = daily.getBoundingClientRect()
  const categoryColor = getComputedStyle(daily.querySelector(".oneday-category-picker-dot")).backgroundColor
  const categoryColorValue = daily.querySelector('[data-field="category"] select').value
  const duration = daily.querySelector(".oneday-duration-control")
  const durationInput = duration.querySelector('input[type="number"]')
  const durationUnit = duration.querySelector("select")
  const goalValue = daily.querySelector('[data-field="goal"] select')?.value
  const categoryList = document.querySelector("#categories .oneday-category-editor-list")
  const categorySwatch = document.querySelector("#categories .oneday-category-color-input")
  const globalSettings = document.querySelector("#global-settings")
  globalSettings.style.width = "610px"
  const currentSections = [...globalSettings.querySelectorAll(".oneday-settings-section")]
  const globalCategoryList = globalSettings.querySelector(".oneday-settings-section[data-settings-section='span-categories'] .oneday-category-editor-list") ?? currentSections[0]?.querySelector(".oneday-category-editor-list")
  const globalMarkerRows = globalSettings.querySelectorAll(".oneday-settings-section[data-settings-section='marker-categories'] .oneday-category-editor-row")
  const globalHabitRow = globalSettings.querySelector(".oneday-settings-section[data-settings-section='habits'] .oneday-rule-editor") ?? currentSections[2]?.querySelector(".oneday-rule-editor")
  const globalHabitRect = globalHabitRow.getBoundingClientRect()
  const globalHabitChildren = [...globalHabitRow.children].map((el) => el.getBoundingClientRect())
  const globalSections = [...globalSettings.querySelectorAll(".oneday-settings-section")]
  const todoRules = globalSettings.querySelector("[data-settings-section='todo-rules']")
  const timelineSettings = globalSettings.querySelector("[data-settings-section='timeline']")
  const addWeekly = todoRules?.querySelector(".oneday-settings-add-rule")
  const englishDaily = document.querySelector('#habits-en .oneday-rule-editor[data-habit-id="daily"]')
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
      actions: left('.oneday-settings-row-actions'),
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
    categoryRows: document.querySelectorAll("#categories .oneday-category-editor-row").length,
    modalTitles: [...document.querySelectorAll(".oneday-settings-modal > h2")].map((el) => el.textContent),
    focusedCategoryScope: document.querySelector(".oneday-settings-modal .oneday-category-scope-tabs button.is-active")?.dataset.scope,
    focusedCategoryRows: document.querySelectorAll(".oneday-settings-modal [data-category-scope='marker'] .oneday-category-editor-row").length,
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
        hasLibrary: Boolean(section?.querySelector("textarea.oneday-quote-library")),
        hasInkDots: (section?.querySelectorAll(".oneday-quote-ink-dot").length ?? 0) > 1,
        hasDesigner: Boolean(section?.querySelector(".oneday-quote-designer, .oneday-quote-settings-tabs, details")),
        sectionHeight: section?.getBoundingClientRect().height ?? 0,
      }
    })(),
    timelineTop: timelineSettings.getBoundingClientRect().top - globalSettings.getBoundingClientRect().top,
    timelineSettingNames: timelineSettings ? [...timelineSettings.querySelectorAll(".setting-item-name")].map((el) => el.textContent) : [],
    englishLabels: [...englishDaily.querySelectorAll(".oneday-rule-field-label")].map((el) => el.textContent),
    englishGoalOptions: [...englishDaily.querySelector('[data-field="goal"] select').options].map((option) => option.textContent),
    englishRepeatOptions: [...englishDaily.querySelector('[data-field="repeat"] select').options].map((option) => option.textContent),
    rowColumns,
  }
})

await page.locator("#habits").screenshot({ path: path.join(out, "habits-light.png") })
await page.locator("#habits-en").screenshot({ path: path.join(out, "habits-en-light.png") })
await page.locator("#categories").screenshot({ path: path.join(out, "categories-light.png") })
await page.locator(".oneday-settings-modal").first().screenshot({ path: path.join(out, "categories-modal-marker-light.png") })
await page.locator("#global-settings").screenshot({ path: path.join(out, "global-settings-610.png") })
await page.locator("#global-settings [data-settings-section='daily-quotes']").screenshot({ path: path.join(out, "global-settings-quote.png") })
await page.locator('#habits .oneday-rule-editor[data-habit-id="daily"] [data-field="category"] select').hover()
const categoryHoverBackground = await page.locator('#habits .oneday-rule-editor[data-habit-id="daily"] [data-field="category"] select').evaluate((el) => getComputedStyle(el).backgroundColor)
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
await page.locator("#categories").screenshot({ path: path.join(out, "categories-dark.png") })
await page.setViewportSize({ width: 460, height: 900 })
const narrowCategoryColumns = await page.locator("#categories .oneday-category-editor-list").evaluate((el) =>
  getComputedStyle(el).gridTemplateColumns.split(" ").length
)
await page.locator("#categories").screenshot({ path: path.join(out, "categories-narrow.png") })
await page.locator("#global-settings").evaluate((el) => { el.style.width = "440px" })
const globalNarrowState = await page.locator("#global-settings").evaluate((root) => {
  const sections = [...root.querySelectorAll(".oneday-settings-section")]
  const habitRow = root.querySelector("[data-settings-section='habits'] .oneday-rule-editor") ?? sections[2]?.querySelector(".oneday-rule-editor")
  const habitRect = habitRow.getBoundingClientRect()
  return {
    categoryColumns: getComputedStyle(root.querySelector("[data-settings-section='span-categories'] .oneday-category-editor-list") ?? sections[0]?.querySelector(".oneday-category-editor-list")).gridTemplateColumns.split(" ").length,
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
await page.locator('#habits .oneday-rule-editor[data-habit-id="daily"] [data-field="name"] input').fill("")
await page.locator('#habits .oneday-rule-editor[data-habit-id="daily"] [data-field="name"] input').dispatchEvent("change")
await page.locator('#habits .oneday-rule-editor[data-habit-id="daily"] .oneday-duration-control select').selectOption("hours")
await page.locator('#habits .oneday-rule-editor[data-habit-id="daily"] .oneday-duration-control input').fill("0.5")
await page.locator('#habits .oneday-rule-editor[data-habit-id="daily"] .oneday-duration-control input').dispatchEvent("change")
const repeatSelect = page.locator('#habits .oneday-rule-editor[data-habit-id="daily"] [data-field="repeat"] select')
await repeatSelect.selectOption("weekly")
await page.waitForSelector('#habits .oneday-rule-editor[data-habit-id="daily"] [data-field="weekdays"] button')
const weekdayButtons = page.locator('#habits .oneday-rule-editor[data-habit-id="daily"] [data-field="weekdays"] button')
const weekdayCount = await weekdayButtons.count()
await weekdayButtons.nth(2).click()

await repeatSelect.selectOption("interval")
await page.waitForSelector('#habits .oneday-rule-editor[data-habit-id="daily"] [data-field="interval"]')
await page.locator('#habits .oneday-rule-editor[data-habit-id="daily"] [data-field="interval"] input[type="number"]').fill("3")
await page.locator('#habits .oneday-rule-editor[data-habit-id="daily"] [data-field="interval"] input[type="number"]').dispatchEvent("change")
await page.locator('#habits .oneday-rule-editor[data-habit-id="daily"] [data-field="interval"] input[type="date"]').fill("2026-08-23")
await page.locator('#habits .oneday-rule-editor[data-habit-id="daily"] [data-field="interval"] input[type="date"]').dispatchEvent("change")
await page.locator('#habits .oneday-rule-editor[data-habit-id="daily"]').screenshot({ path: path.join(out, "habit-interval-light.png") })
const intervalState = await page.evaluate(() => structuredClone(window.__settings.habits[0].schedule))

await repeatSelect.selectOption("dates")
await page.waitForSelector('#habits .oneday-rule-editor[data-habit-id="daily"] [data-field="dates"] input[type="date"]')
await page.locator('#habits .oneday-rule-editor[data-habit-id="daily"] .oneday-date-add').click()
await page.waitForFunction(() => document.querySelectorAll('#habits .oneday-rule-editor[data-habit-id="daily"] [data-field="dates"] input[type="date"]').length === 2)
await page.locator('#habits .oneday-rule-editor[data-habit-id="daily"]').screenshot({ path: path.join(out, "habit-dates-light.png") })
const datePickerCount = await page.locator('#habits .oneday-rule-editor[data-habit-id="daily"] [data-field="dates"] input[type="date"]').count()

await page.locator('#habits .oneday-rule-editor[data-habit-id="daily"] [data-field="goal"] select').selectOption("daily-below")
await page.waitForSelector('#habits .oneday-rule-editor[data-habit-id="daily"] [data-field="target"] .oneday-duration-control')
await page.locator('#habits .oneday-rule-editor[data-habit-id="daily"] .oneday-duration-control select').selectOption("hours")
await page.locator('#habits .oneday-rule-editor[data-habit-id="daily"] .oneday-duration-control input').fill("0.5")
await page.locator('#habits .oneday-rule-editor[data-habit-id="daily"] .oneday-duration-control input').dispatchEvent("change")
await page.locator('#habits .oneday-rule-editor[data-habit-id="daily"]').screenshot({ path: path.join(out, "habit-daily-below-light.png") })
const belowState = await page.evaluate(() => ({
  comparison: window.__settings?.habits?.[0]?.durationComparison ?? null,
  targetMinutes: window.__settings?.habits?.[0]?.targetMinutes ?? null,
  targetPeriod: window.__settings?.habits?.[0]?.targetPeriod ?? null,
  targetMetric: window.__settings?.habits?.[0]?.targetMetric ?? null,
}))

await page.locator('#habits .oneday-rule-editor[data-habit-id="daily"] [data-field="goal"] select').selectOption("weekly-count")
await page.waitForSelector('#habits .oneday-rule-editor[data-habit-id="daily"] [data-field="target"] .oneday-count-control')
await page.locator('#habits .oneday-rule-editor[data-habit-id="daily"] [data-field="target"] input').fill("3")
await page.locator('#habits .oneday-rule-editor[data-habit-id="daily"] [data-field="target"] input').dispatchEvent("change")
await page.locator('#habits .oneday-rule-editor[data-habit-id="daily"]').screenshot({ path: path.join(out, "habit-weekly-count-light.png") })
const changedState = await page.evaluate(() => ({
  saves: window.__saves,
  storedMinutes: window.__settings?.habits?.[0]?.targetMinutes ?? null,
  storedCount: window.__settings?.habits?.[0]?.targetCount ?? null,
  storedMetric: window.__settings?.habits?.[0]?.targetMetric ?? null,
  storedPeriod: window.__settings?.habits?.[0]?.targetPeriod ?? null,
  storedName: window.__settings?.habits?.[0]?.name ?? null,
  dailyRepeatCount: document.querySelectorAll('#habits .oneday-rule-editor[data-habit-id="daily"] [data-field="repeat"]').length,
}))
await browser.close()

const errors = []
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
if (state.globalCategoryColumns !== 2 || state.globalHabitColumns !== 6) errors.push("typical-width global settings collapsed into the narrow layout too early")
if (!state.globalHabitWithinRow) errors.push("global habit controls overflow their editor row")
if (state.globalSectionGap < 20) errors.push("global settings sections have no stable vertical separation")
if (state.globalSectionKeys.join("|") !== "timeline|span-categories|marker-categories|habits|todo-rules|daily-quotes|natural-language") errors.push("global settings must run timeline → categories → habits → todo rules → daily quotes → natural-language capture")
if (state.timelineTop > 120) errors.push("timeline defaults must be the first thing on the global settings page")
if (!state.quoteSection.present || !state.quoteSection.hasLibrary || !state.quoteSection.hasInkDots || state.quoteSection.hasDesigner || state.quoteSection.sectionHeight > 420) errors.push("daily quote settings must be one textarea plus highlighter dots, no designer or disclosure")
if (state.todoRulesHeading !== "待办规则" || state.timelineHeading !== "时间轴") errors.push("global todo and timeline sections need clear concept-level headings")
if (state.weeklyLegacyHeadingCount !== 0) errors.push("weekly cumulative todos must not appear as a separate top-level product concept")
if (state.addWeeklyLabel !== "添加每周目标" || state.addWeeklyHeight > 36 || state.addWeeklyBackground !== "rgba(0, 0, 0, 0)" || state.addWeeklyBorderStyle !== "dashed") errors.push("empty recurring todo rules must use one compact shared dashed add action")
if (state.timelineSettingNames.join("|") !== "默认时间范围（起–止，小时）|每小时高度（px）") errors.push("timeline defaults escaped their own settings section")
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
