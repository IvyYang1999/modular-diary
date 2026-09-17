/** Product contracts for the Habit and Todo element blocks. */
import esbuild from "esbuild"
import { chromium } from "playwright"
import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"
import os from "node:os"

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(os.tmpdir(), "modular-diary-components-smoke")
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })

fs.writeFileSync(path.join(out, "obsidian-stub.ts"), `
export function setIcon(el: HTMLElement, name: string): void {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("viewBox", "0 0 24 24")
  svg.dataset.icon = name
  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle")
  circle.setAttribute("cx", "12"); circle.setAttribute("cy", "12"); circle.setAttribute("r", "5")
  svg.appendChild(circle); el.appendChild(svg)
}
`)

fs.writeFileSync(path.join(out, "entry.ts"), `
import { renderHabitsInto } from "${path.join(here, "../src/render/habits-view")}" 
import { renderTodosInto } from "${path.join(here, "../src/render/todos-view")}" 
import { createPointerRedrawGate } from "${path.join(here, "../src/edit/pointer-interaction")}" 
import { attachTimelineScheduleDrag } from "${path.join(here, "../src/edit/timeline-schedule-drag")}" 
import { beginRemountVisual, RemountVisualRegistry, resolveRemountVisualMode } from "${path.join(here, "../src/edit/remount-visual")}" 

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

const host = document.querySelector<HTMLElement>("#host")!
const createSlot = (id: string, height: number): HTMLElement => {
  const slot = host.createDiv({ cls: "modular-diary-slot modular-diary-slot-" + id })
  slot.dataset.slot = id
  slot.style.cssText = "position:relative;width:430px;height:" + height + "px"
  return slot
}
window.__events = []
const visualOwner = {}
const visualKey = { owner: visualOwner, path: "visual.md", blockOrdinal: 0, docId: "visual", lineStart: 1 }
const visualRegistry = new RemountVisualRegistry()
const visualFixture = document.body.createDiv({ cls: "visual-handoff-fixture" })
const visualSource = visualFixture.createDiv({ cls: "modular-diary-container visual-source" })
visualSource.style.cssText = "width:320px;height:96px"
visualSource.createDiv({ cls: "modular-diary-todos", text: "visual continuity" })
window.__beginVisualHandoff = () => {
  const started = visualRegistry.begin(visualKey, visualSource)
  visualSource.remove()
  return started
}
window.__completeVisualHandoff = () => visualRegistry.complete(visualKey)
window.__verifyVisualHandoffHasOneVisibleTree = () => {
  const source = document.body.createDiv({ cls: "modular-diary-container visual-single-tree" })
  source.style.cssText = "width:320px;height:96px"
  source.createDiv({ cls: "modular-diary-stats", text: "one visible tree" })
  const key = { ...visualKey, blockOrdinal: 9, docId: "visual-single-tree" }
  const started = visualRegistry.begin(key, source)
  const hiddenDuringHandoff = getComputedStyle(source).visibility === "hidden"
  const overlaysDuringHandoff = document.querySelectorAll(".modular-diary-remount-overlay").length
  visualRegistry.cancel(key)
  const restoredAfterCancel = getComputedStyle(source).visibility !== "hidden"
  source.remove()
  return { started, hiddenDuringHandoff, overlaysDuringHandoff, restoredAfterCancel }
}
window.__verifyCompletedWriteNeverSharesAPaint = () => {
  return ["text-save", "source-mode-commit"].map((action, index) => {
    const source = document.body.createDiv({ cls: "modular-diary-container visual-" + action })
    source.style.cssText = "width:320px;height:96px"
    source.createDiv({ cls: "modular-diary-stats", text: action })
    const key = { ...visualKey, blockOrdinal: 10 + index, docId: "visual-" + action }
    const started = visualRegistry.begin(key, source)
    source.replaceWith(document.createElement("div"))
    const completed = visualRegistry.complete(key)
    const overlays = document.querySelectorAll(".modular-diary-remount-overlay").length
    return { action, started, completed, overlays }
  })
}
window.__verifyPreviewedTimelineWriteNeedsNoClone = () => {
  return ["block-create", "range-step", "entry-resize"].map((action, index) => {
    const source = document.body.createDiv({ cls: "modular-diary-container visual-live-" + action })
    source.style.cssText = "width:320px;height:96px"
    source.createDiv({ cls: "modular-diary-stats", text: "final state already painted: " + action })
    const key = { ...visualKey, blockOrdinal: 30 + index, docId: "visual-live-" + action }
    const mode = resolveRemountVisualMode(undefined, true)
    const started = beginRemountVisual(visualRegistry, key, source, mode)
    const overlays = document.querySelectorAll(".modular-diary-remount-overlay").length
    const sourceVisible = getComputedStyle(source).visibility !== "hidden"
    source.remove()
    return { action, mode, started, overlays, sourceVisible }
  })
}
window.__verifyLiveGridPreviewNeedsNoClone = () => {
  const source = document.body.createDiv({ cls: "modular-diary-container visual-live-grid-resize" })
  source.style.cssText = "width:320px;height:96px"
  source.createDiv({ cls: "modular-diary-stats", text: "already resized live preview" })
  const key = { ...visualKey, blockOrdinal: 19, docId: "visual-live-grid-resize" }
  const started = beginRemountVisual(visualRegistry, key, source, "live-preview")
  const overlays = document.querySelectorAll(".modular-diary-remount-overlay").length
  const sourceVisible = getComputedStyle(source).visibility !== "hidden"
  source.remove()
  return { started, overlays, sourceVisible }
}
window.__verifyVisualHandoffInvalidation = () => {
  const makeSource = (suffix) => {
    const source = document.body.createDiv({ cls: "modular-diary-container visual-invalidation-" + suffix })
    source.style.cssText = "width:320px;height:96px"
    source.createDiv({ cls: "modular-diary-stats", text: "must never become a stale fixed ghost" })
    return source
  }
  const scrollSource = makeSource("scroll")
  const scrollKey = { ...visualKey, blockOrdinal: 1, docId: "visual-scroll" }
  const scrollStarted = visualRegistry.begin(scrollKey, scrollSource)
  const beforeScroll = document.querySelectorAll(".modular-diary-remount-overlay").length
  scrollSource.dispatchEvent(new Event("scroll", { bubbles: false }))
  const afterScroll = document.querySelectorAll(".modular-diary-remount-overlay").length
  visualRegistry.cancel(scrollKey)
  scrollSource.remove()

  const resizeSource = makeSource("resize")
  const resizeKey = { ...visualKey, blockOrdinal: 2, docId: "visual-resize" }
  const resizeStarted = visualRegistry.begin(resizeKey, resizeSource)
  const beforeResize = document.querySelectorAll(".modular-diary-remount-overlay").length
  window.dispatchEvent(new Event("resize"))
  const afterResize = document.querySelectorAll(".modular-diary-remount-overlay").length
  visualRegistry.cancel(resizeKey)
  resizeSource.remove()
  return { scrollStarted, beforeScroll, afterScroll, resizeStarted, beforeResize, afterResize }
}
const colors = { develop: "#55b8d8", sport: "#ffae32", read: "#bd8f9c" }
renderHabitsInto(createSlot("habits", 190), [
  { habit: { id: "weekly", name: "开发练习", type: "develop", targetMinutes: 300, targetPeriod: "week", schedule: { kind: "daily" }, order: 0 }, progress: { minutes: 150, ratio: 0.5, complete: false } },
  { habit: { id: "daily", name: "运动", type: "sport", targetMinutes: 30, targetPeriod: "day", schedule: { kind: "daily" }, order: 1 }, progress: { minutes: 30, ratio: 1, complete: true } },
  { habit: { id: "publish", name: "维护 linuxdo 账号", type: "read", targetMinutes: 0, targetPeriod: "day", targetMetric: "duration", schedule: { kind: "daily" }, order: 2 }, progress: { minutes: 0, targetMinutes: 0, ratio: 0, complete: false } },
], {
  typeColors: colors,
  onEdit: () => window.__events.push("habit-edit"),
  onMenu: (habit) => window.__events.push("habit-menu:" + habit.id),
  onMove: (id, index) => window.__events.push("habit-move:" + id + ":" + index),
})
const badgeFixture = document.body.createDiv({ cls: "habit-badge-contract" })
badgeFixture.style.cssText = "position:absolute;left:480px;top:16px;width:360px"
renderHabitsInto(badgeFixture, [
  { habit: { id: "badge-complete", name: "完成态", type: "sport", targetMinutes: 30, targetPeriod: "day", schedule: { kind: "daily" }, order: 0 }, progress: { minutes: 30, ratio: 1, complete: true } },
  { habit: { id: "badge-incomplete", name: "未完成态", type: "sport", targetMinutes: 30, targetPeriod: "day", schedule: { kind: "daily" }, order: 1 }, progress: { minutes: 0, ratio: 0, complete: false } },
], {
  typeColors: colors,
  onEdit: () => {}, onMenu: () => {}, onMove: () => {},
})
renderTodosInto(createSlot("todos", 210), [
  { id: "local", title: "整理发布清单", group: "Modular Diary", type: "develop", completed: false, weekly: false, estimateMinutes: 60, actualMinutes: 30 },
  { id: "weekly", title: "本周深度开发", group: "Modular Diary", type: "develop", completed: false, weekly: true, estimateMinutes: 300, actualMinutes: 150 },
  { id: "read", title: "读完一章", group: "学习", type: "read", completed: true, weekly: false, estimateMinutes: 30, actualMinutes: 35 },
], {
  categories: Object.keys(colors), typeColors: colors,
  view: { groupBy: "none", sortBy: "manual" },
  onAdd: (input) => window.__events.push("todo-add:" + input.title + ":" + input.estimateMinutes),
  onGroupMenu: (x, y) => window.__events.push("todo-group:" + Math.round(x) + ":" + Math.round(y)),
  onSortMenu: (x, y) => window.__events.push("todo-sort:" + Math.round(x) + ":" + Math.round(y)),
  onToggle: (id, value) => window.__events.push("todo-toggle:" + id + ":" + value),
  onEdit: (id, input) => window.__events.push("todo-edit:" + id + ":" + input.title + ":" + input.estimateMinutes),
  onMenu: (item, _x, _y, edit) => { window.__events.push("todo-menu:" + item.id); edit() },
  onMove: (id, index) => window.__events.push("todo-move:" + id + ":" + index),
})
// Progress-track contract: a todo with no recorded time paints no track at
// all (a zero-width bar on a full-width rail reads as a divider), while a
// todo with progress keeps the quiet flat track.
const todoProgressFixture = document.body.createDiv({ cls: "todo-progress-contract" })
todoProgressFixture.style.cssText = "position:absolute;left:480px;top:140px;width:360px"
renderTodosInto(todoProgressFixture, [
  { id: "progress-none", title: "还没开始", group: "", type: "develop", completed: false, weekly: false, estimateMinutes: 60, actualMinutes: 0 },
  { id: "progress-half", title: "做了一半", group: "", type: "develop", completed: false, weekly: false, estimateMinutes: 60, actualMinutes: 30 },
  { id: "progress-open", title: "没有预估", group: "", type: "develop", completed: false, weekly: false, estimateMinutes: 0, actualMinutes: 30 },
], {
  categories: Object.keys(colors), typeColors: colors, view: { groupBy: "none", sortBy: "manual" },
  onAdd: () => {}, onEdit: () => {}, onGroupMenu: () => {}, onSortMenu: () => {}, onToggle: () => {}, onMenu: () => {}, onMove: () => {},
})
renderHabitsInto(createSlot("habits", 96), [], {
  typeColors: colors, onEdit: () => window.__events.push("empty-habit-edit"), onMenu: () => {}, onMove: () => {},
})
renderTodosInto(createSlot("todos", 112), [], {
  categories: Object.keys(colors), typeColors: colors, view: { groupBy: "none", sortBy: "manual" }, onAdd: (input) => window.__events.push("empty-todo-add:" + input.title), onEdit: () => {}, onGroupMenu: () => {}, onSortMenu: () => {}, onToggle: () => {}, onMenu: () => {}, onMove: () => {},
})
const draftFocusOwner = document.createElement("input")
draftFocusOwner.id = "draft-restore-focus-owner"
document.body.appendChild(draftFocusOwner)
draftFocusOwner.focus()
renderTodosInto(createSlot("todos-draft", 112), [], {
  categories: Object.keys(colors), typeColors: colors, view: { groupBy: "none", sortBy: "manual" },
  draft: { title: "未保存草稿", type: "sport", estimateMinutes: 30, estimateUnit: "hours" },
  onDraftChange: (draft) => window.__events.push("todo-draft:" + (draft?.title ?? "closed") + ":" + (draft?.estimateMinutes ?? 0) + ":" + (draft?.estimateUnit ?? "none")),
  onAdd: () => {}, onEdit: () => {}, onGroupMenu: () => {}, onSortMenu: () => {}, onToggle: () => {}, onMenu: () => {}, onMove: () => {},
})
window.__draftRestoreFocus = document.activeElement?.id ?? ""
renderTodosInto(createSlot("todos", 150), [
  { id: "group-local", title: "整理发布清单", group: "旧分组", type: "develop", completed: false, weekly: false, estimateMinutes: 60, actualMinutes: 30 },
  { id: "group-weekly", title: "本周深度开发", group: "旧分组", type: "develop", completed: false, weekly: true, estimateMinutes: 300, actualMinutes: 150 },
  { id: "group-read", title: "读完一章", group: "另一个旧分组", type: "read", completed: true, weekly: false, estimateMinutes: 30, actualMinutes: 35 },
], {
  categories: Object.keys(colors), typeColors: colors, view: { groupBy: "category", sortBy: "estimate" }, onAdd: () => {}, onEdit: () => {}, onGroupMenu: () => {}, onSortMenu: () => {}, onToggle: () => {}, onMenu: () => {}, onMove: () => {},
})

const persistentTodoSlot = createSlot("todos-edit-session", 150)
let persistentEditDraft: any = null
const persistentRefreshGate = createPointerRedrawGate()
persistentTodoSlot.addEventListener("contextmenu", () => window.__events.push("todo-component-menu"))
const renderPersistentTodo = (): void => {
  persistentTodoSlot.replaceChildren()
  renderTodosInto(persistentTodoSlot, [
    { id: "persistent", title: "持续编辑", group: "", type: "develop", completed: false, weekly: false, estimateMinutes: 60, actualMinutes: 15 },
  ], {
    categories: Object.keys(colors), typeColors: colors, view: { groupBy: "none", sortBy: "manual" },
    editDraft: persistentEditDraft,
    onEditDraftChange: (draft) => { persistentEditDraft = draft },
    onAdd: () => {}, onEdit: () => {}, onGroupMenu: () => {}, onSortMenu: () => {}, onToggle: () => {},
    onMenu: (_item, _x, _y, edit) => { window.__events.push("persistent-todo-menu"); edit() },
    onMove: () => {},
  })
}
renderPersistentTodo()
window.__rerenderPersistentTodo = renderPersistentTodo
window.__persistentTodoRefreshRuns = 0
window.__requestPersistentTodoRefresh = () => persistentRefreshGate.run(persistentTodoSlot, () => {
  window.__persistentTodoRefreshRuns += 1
  renderPersistentTodo()
})

const anyRecordScheduleFixture = host.createDiv({ cls: "modular-diary-schedule-source modular-diary-any-record-schedule-source", text: "维护 linuxdo 账号" })
anyRecordScheduleFixture.style.cssText = "width:220px;height:32px"
anyRecordScheduleFixture.dataset.scheduleSource = "habit"
anyRecordScheduleFixture.dataset.scheduleId = "publish"
anyRecordScheduleFixture.dataset.scheduleTitle = "维护 linuxdo 账号"
anyRecordScheduleFixture.dataset.scheduleType = "read"
anyRecordScheduleFixture.dataset.scheduleDuration = "0"
const scheduleHolder = host.createDiv({ cls: "modular-diary-svg-holder modular-diary-schedule-test" })
scheduleHolder.style.cssText = "position:relative;width:300px;height:820px;overflow:hidden"
scheduleHolder.innerHTML = '<svg class="modular-diary-svg" width="300" height="820" style="display:block;width:300px;height:820px"><rect class="modular-diary-track" x="36" y="26" width="250" height="768"></rect></svg>'
window.__scheduledPlans = []
attachTimelineScheduleDrag(host, {
  rangeStart: 420, rangeEnd: 1380, entries: [], annotations: [], errors: [], hiddenTypes: [],
  hiddenMarkerTypes: [], texts: [], hiddenSlots: [], habitSkips: [], todos: [],
  todoView: { groupBy: "none", sortBy: "manual" },
}, {
  hourHeight: 48,
  typeColor: (type) => colors[type] ?? "#999999",
  onCreate: (plan) => window.__scheduledPlans.push(plan),
})
`)

await esbuild.build({
  entryPoints: [path.join(out, "entry.ts")], bundle: true, format: "iife", outfile: path.join(out, "bundle.js"), logLevel: "silent",
  plugins: [{ name: "obsidian-stub", setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: path.join(out, "obsidian-stub.ts") }))
  } }],
})

const css = fs.readFileSync(path.join(here, "../styles.css"), "utf8")
const hostileThemeButtonChrome = `
  .modular-diary-habit-row:hover button,
  .modular-diary-todo-row:hover button {
    background: rgb(210, 210, 210);
    border: 1px solid rgb(150, 150, 150);
    box-shadow: 0 1px 3px rgba(0, 0, 0, .25);
  }
`
fs.writeFileSync(path.join(out, "index.html"), `<!doctype html><html><head><style>${css}</style><style>${hostileThemeButtonChrome}</style></head><body style="margin:16px"><main id="host" class="modular-diary-container" style="width:440px"></main><script>${fs.readFileSync(path.join(out, "bundle.js"), "utf8")}</script></body></html>`)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 960, height: 860 }, deviceScaleFactor: 1 })
page.on("pageerror", (error) => { console.error("pageerror:", error.message); process.exit(1) })
await page.goto("file://" + path.join(out, "index.html"))
await page.evaluate(() => {
  const root = document.documentElement.style
  root.setProperty("--background-primary", "#ffffff")
  root.setProperty("--background-secondary", "#f2f2f2")
  root.setProperty("--background-modifier-border", "#d9d9d9")
  root.setProperty("--background-modifier-hover", "#ececec")
  root.setProperty("--interactive-accent", "#9567e8")
  root.setProperty("--text-normal", "#252525")
  root.setProperty("--text-muted", "#707070")
  root.setProperty("--text-faint", "#999999")
  root.setProperty("--text-accent", "#7e50dc")
  root.setProperty("--button-radius", "7px")
  document.body.style.background = "#ffffff"
})
await page.waitForTimeout(50)

const pointerSortRow = async (handle, targetRow, expectedTitle, screenshotName) => {
  const sourceTypography = await handle.evaluate((control) => {
    const title = control.closest(".modular-diary-habit-row, .modular-diary-todo-row")?.querySelector(".modular-diary-item-title")
    const style = getComputedStyle(title)
    return { fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight, fontFamily: style.fontFamily }
  })
  const handleBox = await handle.boundingBox()
  const targetBox = await targetRow.boundingBox()
  if (!handleBox || !targetBox) throw new Error("row sort fixture has no measurable geometry")
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await page.waitForTimeout(20)
  const activeHandleBox = await handle.boundingBox()
  if (!activeHandleBox) throw new Error("row sort handle disappeared on hover")
  const hit = await page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y)
    return { tag: target?.tagName, cls: target?.getAttribute("class") ?? "" }
  }, { x: activeHandleBox.x + activeHandleBox.width / 2, y: activeHandleBox.y + activeHandleBox.height / 2 })
  await page.mouse.down()
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height - 2, { steps: 5 })
  const preview = await page.evaluate((title) => {
    const ghost = document.querySelector(".modular-diary-item-sort-ghost")
    const placeholder = document.querySelector(".modular-diary-item-sort-placeholder")
    const list = placeholder?.parentElement
    const ghostTitle = ghost?.querySelector(".modular-diary-item-title")
    const ghostHandle = ghost?.querySelector(".modular-diary-item-drag")
    const ghostStyle = ghostTitle ? getComputedStyle(ghostTitle) : null
    const visiblePeerHandles = list
      ? [...list.querySelectorAll(".modular-diary-habit-row:not(.modular-diary-item-sort-placeholder) .modular-diary-item-drag, .modular-diary-todo-row:not(.modular-diary-item-sort-placeholder) .modular-diary-item-drag")]
        .filter((control) => getComputedStyle(control).opacity !== "0")
      : []
    return {
      ghost: Boolean(ghost),
      fullRow: ghost?.textContent?.includes(title) ?? false,
      placeholder: Boolean(placeholder),
      ordering: list?.classList.contains("is-ordering") ?? false,
      ghostHandleVisible: ghostHandle ? getComputedStyle(ghostHandle).opacity === "1" : false,
      visiblePeerHandleCount: visiblePeerHandles.length,
      widthDelta: ghost && placeholder
        ? Math.abs(ghost.getBoundingClientRect().width - placeholder.getBoundingClientRect().width)
        : Infinity,
      typography: ghostStyle ? {
        fontSize: ghostStyle.fontSize,
        fontWeight: ghostStyle.fontWeight,
        lineHeight: ghostStyle.lineHeight,
        fontFamily: ghostStyle.fontFamily,
      } : null,
    }
  }, expectedTitle)
  if (!preview.ghost || !preview.fullRow || !preview.placeholder || preview.widthDelta > 1) {
    console.error("row sorting did not move a full-row preview", { preview, hit }); process.exit(1)
  }
  if (!preview.ordering || !preview.ghostHandleVisible || preview.visiblePeerHandleCount !== 0) {
    console.error("row sorting exposed a second hover grip instead of owning one source grip", { preview, hit }); process.exit(1)
  }
  if (JSON.stringify(preview.typography) !== JSON.stringify(sourceTypography)) {
    console.error("row sorting changed title typography", { sourceTypography, preview: preview.typography }); process.exit(1)
  }
  await page.screenshot({ path: path.join(out, screenshotName) })
  await page.mouse.up()
}

const state = await page.evaluate(() => {
  const slots = [...document.querySelectorAll(".modular-diary-slot")]
  const weeklyHabit = document.querySelector(".modular-diary-habit-row .modular-diary-item-progress-bar")
  const todoBars = [...document.querySelectorAll(".modular-diary-todo-row .modular-diary-item-progress-bar")]
  const row = document.querySelector(".modular-diary-habit-row")
  const slot = row.closest(".modular-diary-slot")
  const emptyButtons = [...document.querySelectorAll(".modular-diary-component-empty")]
  const headerButtons = [...document.querySelectorAll(".modular-diary-component-actions button")]
  const habitStatuses = [...slot.querySelectorAll(".modular-diary-habit-row .modular-diary-item-status")]
  const dailyBadgeStatuses = [...document.querySelectorAll(".habit-badge-contract .modular-diary-item-status")]
  const incompleteStatus = document.querySelector(".modular-diary-habit-row:not(.is-complete) .modular-diary-item-status")
  const completeStatus = document.querySelector(".modular-diary-habit-row.is-complete .modular-diary-item-status")
  const habitMoreCount = document.querySelectorAll(".modular-diary-habit-row .modular-diary-item-more").length
  const habitHandle = document.querySelector(".modular-diary-habit-drag")
  const habitDot = row.querySelector(".modular-diary-item-dot")
  const defaultTodoSlot = document.querySelectorAll(".modular-diary-slot-todos")[0]
  const groupedTodoSlot = document.querySelectorAll(".modular-diary-slot-todos")[2]
  const todoRows = [...defaultTodoSlot.querySelectorAll(".modular-diary-todo-row")]
  const manualTodoRow = todoRows[0]
  const todoHandle = defaultTodoSlot.querySelector(".modular-diary-todo-drag")
  const todoCheck = defaultTodoSlot.querySelector(".modular-diary-todo-check")
  const rowRect = row.getBoundingClientRect()
  const habitHandleRect = habitHandle.getBoundingClientRect()
  const habitDotRect = habitDot.getBoundingClientRect()
  const todoRowRect = manualTodoRow.getBoundingClientRect()
  const todoHandleRect = todoHandle.getBoundingClientRect()
  const todoCheckRect = todoCheck.getBoundingClientRect()
  const statusRect = incompleteStatus.getBoundingClientRect()
  const referenceToolbar = document.createElement("div")
  referenceToolbar.className = "modular-diary-toolbar"
  referenceToolbar.style.cssText = "position:absolute;visibility:hidden"
  const referenceSwatch = document.createElement("button")
  referenceSwatch.className = "modular-diary-swatch"
  referenceToolbar.appendChild(referenceSwatch)
  document.querySelector(".modular-diary-container").appendChild(referenceToolbar)
  const compactControlHeight = referenceSwatch.getBoundingClientRect().height
  referenceToolbar.remove()
  const gripMetrics = (handle) => {
    const style = getComputedStyle(handle)
    const dots = [...handle.children]
    return {
      borderWidth: style.borderWidth,
      background: style.backgroundColor,
      touchAction: style.touchAction,
      columns: style.gridTemplateColumns,
      rowGap: style.rowGap,
      columnGap: style.columnGap,
      dotCount: dots.length,
      dots: dots.map((dot) => {
        const dotStyle = getComputedStyle(dot)
        return [dot.getBoundingClientRect().width, dot.getBoundingClientRect().height, dotStyle.borderRadius]
      }),
    }
  }
  const ratio = (bar) => bar.getBoundingClientRect().width / bar.parentElement.getBoundingClientRect().width
  return {
    slotCount: slots.length,
    weeklyHabitRatio: ratio(weeklyHabit),
    todoRatios: todoBars.map(ratio),
    rowBorderRadius: getComputedStyle(row).borderRadius,
    rowBackground: getComputedStyle(row).backgroundColor,
    rowBorderStyle: getComputedStyle(row).borderStyle,
    rowBorderWidth: getComputedStyle(row).borderWidth,
    habitRowHeight: row.getBoundingClientRect().height,
    compactControlHeight,
    habitStatusHeights: habitStatuses.map((status) => status.getBoundingClientRect().height),
    dailyBadgeWidths: dailyBadgeStatuses.map((status) => status.getBoundingClientRect().width),
    dailyBadgeTexts: dailyBadgeStatuses.map((status) => status.textContent ?? ""),
    habitStatusTags: habitStatuses.map((status) => status.tagName),
    habitStatusPointerEvents: habitStatuses.map((status) => getComputedStyle(status).pointerEvents),
    habitMoreCount,
    habitHandleCount: slot.querySelectorAll(".modular-diary-habit-drag").length,
    habitHandleOpacity: getComputedStyle(habitHandle).opacity,
    habitHandleDraggable: habitHandle.draggable,
    habitHandleCursor: getComputedStyle(habitHandle).cursor,
    habitHandlePosition: getComputedStyle(habitHandle).position,
    habitContentInset: habitDotRect.left - rowRect.left,
    habitHandleGutterGap: rowRect.left - habitHandleRect.right,
    habitGrip: gripMetrics(habitHandle),
    todoMoreCount: defaultTodoSlot.querySelectorAll(".modular-diary-todo-row .modular-diary-item-more").length,
    todoGroupCount: defaultTodoSlot.querySelectorAll(".modular-diary-todo-group").length,
    todoRowsDraggable: todoRows.map((todo) => todo.draggable),
    // Slot-mounted todo rows only; the progress-contract fixture is not a slot.
    todoHandleCount: document.querySelectorAll(".modular-diary-slot .modular-diary-todo-drag").length,
    todoHandleOpacity: getComputedStyle(todoHandle).opacity,
    todoHandleDraggable: todoHandle.draggable,
    todoHandleCursor: getComputedStyle(todoHandle).cursor,
    todoHandlePosition: getComputedStyle(todoHandle).position,
    todoContentInset: todoCheckRect.left - todoRowRect.left,
    todoHandleGutterGap: todoRowRect.left - todoHandleRect.right,
    todoGrip: gripMetrics(todoHandle),
    todoCheckBackground: getComputedStyle(todoCheck).backgroundColor,
    todoCheckSize: [todoCheck.getBoundingClientRect().width, todoCheck.getBoundingClientRect().height],
    todoBorderTopWidths: todoRows.map((todo) => getComputedStyle(todo).borderTopWidth),
    groupedTodoLabels: [...groupedTodoSlot.querySelectorAll(".modular-diary-todo-group")].map((el) => el.textContent),
    groupedTodoTitles: [...groupedTodoSlot.querySelectorAll(".modular-diary-item-title")].map((el) => el.textContent),
    groupedTodoHandleCount: groupedTodoSlot.querySelectorAll(".modular-diary-todo-drag").length,
    groupedTodoSortLabel: groupedTodoSlot.querySelector('.modular-diary-component-actions button[aria-label*="排序"]')?.getAttribute("aria-label") ?? "",
    groupedScheduleSourceCount: groupedTodoSlot.querySelectorAll(".modular-diary-schedule-source").length,
    scheduleSourceCursor: getComputedStyle(defaultTodoSlot.querySelector(".modular-diary-schedule-source")).cursor,
    statusRightInset: rowRect.right - statusRect.right,
    incompleteStatusText: incompleteStatus?.textContent ?? "",
    incompleteStatusIcons: incompleteStatus?.querySelectorAll("svg").length ?? -1,
    completeStatusText: completeStatus?.textContent ?? "",
    completeStatusIcon: completeStatus?.querySelector("svg")?.dataset.icon ?? "",
    slotBorderWidth: getComputedStyle(slot).borderWidth,
    emptyStyles: emptyButtons.map((button) => {
      const style = getComputedStyle(button)
      return {
        borderWidth: style.borderWidth,
        borderStyle: style.borderStyle,
        background: style.backgroundColor,
        height: button.getBoundingClientRect().height,
        widthRatio: button.getBoundingClientRect().width / button.parentElement.getBoundingClientRect().width,
      }
    }),
    actionSizes: headerButtons.map((button) => [button.getBoundingClientRect().width, button.getBoundingClientRect().height]),
    todoHeaderActionLabels: [...defaultTodoSlot.querySelectorAll(".modular-diary-component-actions button")].map((button) => button.getAttribute("aria-label")),
    todoHeaderActionIcons: [...defaultTodoSlot.querySelectorAll(".modular-diary-component-actions button svg")].map((icon) => icon.dataset.icon),
    habitHeaderActionCount: document.querySelectorAll(".modular-diary-slot-habits:first-of-type .modular-diary-component-actions button").length,
    habitHeaderActionLabel: document.querySelector(".modular-diary-slot-habits:first-of-type .modular-diary-component-actions button")?.getAttribute("aria-label") ?? "",
    habitHeaderActionIcon: document.querySelector(".modular-diary-slot-habits:first-of-type .modular-diary-component-actions button svg")?.dataset.icon ?? "",
    weeklyCheckboxDisabled: defaultTodoSlot.querySelectorAll(".modular-diary-todo-check:disabled").length,
    todoGroupControls: document.querySelectorAll('.modular-diary-todo-form [aria-label="分组"], .modular-diary-todo-group-input').length,
    todoEstimateUnitOptions: [...document.querySelectorAll(".modular-diary-todo-estimate-unit-select")].map((element) => [...element.options].map((option) => option.textContent).join("|")),
    draftVisible: !document.querySelector('.modular-diary-slot[data-slot="todos-draft"] .modular-diary-todo-add-form')?.hidden,
    draftTitle: document.querySelector('.modular-diary-slot[data-slot="todos-draft"] .modular-diary-todo-title-input')?.value ?? "",
    draftEstimate: document.querySelector('.modular-diary-slot[data-slot="todos-draft"] .modular-diary-todo-estimate-input')?.value ?? "",
    draftEstimateUnit: document.querySelector('.modular-diary-slot[data-slot="todos-draft"] .modular-diary-todo-estimate-unit-select')?.value ?? "",
    draftRestoreFocus: window.__draftRestoreFocus,
  }
})

const remountVisualDuringGap = await page.evaluate(() => {
  const started = window.__beginVisualHandoff()
  const overlay = document.querySelector(".modular-diary-remount-overlay")
  const rect = overlay?.getBoundingClientRect()
  return {
    started,
    connected: Boolean(overlay?.isConnected),
    ariaHidden: overlay?.getAttribute("aria-hidden") ?? "",
    inert: overlay?.hasAttribute("inert") ?? false,
    width: rect?.width ?? 0,
    height: rect?.height ?? 0,
  }
})
const remountVisualCompletion = await page.evaluate(() => {
  const completed = window.__completeVisualHandoff()
  return {
    completed,
    overlaysInCompletionTask: document.querySelectorAll(".modular-diary-remount-overlay").length,
  }
})
const remountSingleVisibleTree = await page.evaluate(() => window.__verifyVisualHandoffHasOneVisibleTree())
const remountWriteCompletion = await page.evaluate(() => window.__verifyCompletedWriteNeverSharesAPaint())
const previewedTimelineWrite = await page.evaluate(() => window.__verifyPreviewedTimelineWriteNeedsNoClone())
const liveGridPreview = await page.evaluate(() => window.__verifyLiveGridPreviewNeedsNoClone())
// Once the replacement processor has mounted, keeping the fixed snapshot for
// even one more animation frame paints both trees together. On a busy Electron
// frame that becomes a very visible whole-block ghost after range writes and
// grid resize commits. Completion is therefore a synchronous handoff contract.
const remountVisualInvalidation = await page.evaluate(() => window.__verifyVisualHandoffInvalidation())

const populatedTodoSlot = page.locator(".modular-diary-slot-todos").first()
await page.locator(".modular-diary-slot-habits").first().locator(".modular-diary-component-actions button").click()
await populatedTodoSlot.locator(".modular-diary-component-actions button").nth(2).click()
const explicitAddFocusedTitle = await populatedTodoSlot.locator('.modular-diary-todo-add-form .modular-diary-todo-title-input').evaluate((input) => document.activeElement === input)
await populatedTodoSlot.locator('.modular-diary-todo-add-form input[type="text"]').fill("整理学习资料")
const estimateInput = populatedTodoSlot.locator('.modular-diary-todo-add-form .modular-diary-todo-estimate-input')
const estimateUnitSelect = populatedTodoSlot.locator('.modular-diary-todo-add-form .modular-diary-todo-estimate-unit-select')
const minuteValueBeforeUnitSwitch = await estimateInput.inputValue()
await estimateUnitSelect.selectOption("hours")
const hourValueAfterUnitSwitch = await estimateInput.inputValue()
await estimateInput.fill("0.5")
await estimateUnitSelect.selectOption("minutes")
const minuteValueAfterUnitSwitch = await estimateInput.inputValue()
await estimateUnitSelect.selectOption("hours")
const hourValueAfterRoundTrip = await estimateInput.inputValue()
await populatedTodoSlot.locator(".modular-diary-todo-add-form").screenshot({ path: path.join(out, "todo-unit-switch-light.png") })
await populatedTodoSlot.locator(".modular-diary-todo-add-form").dispatchEvent("submit")
await populatedTodoSlot.locator(".modular-diary-todo-add-form").evaluate((form) => { form.hidden = true })
// The authored duration is stored as integer minutes, so a small decimal hour
// such as 0.02h is a valid one-minute estimate. The Todo form must own that
// normalization instead of letting Chromium interrupt the flow with its
// native step-mismatch validation bubble.
await populatedTodoSlot.locator(".modular-diary-component-actions button").nth(2).click()
await populatedTodoSlot.locator('.modular-diary-todo-add-form .modular-diary-todo-title-input').fill("精确小时输入")
await populatedTodoSlot.locator('.modular-diary-todo-add-form .modular-diary-todo-estimate-unit-select').selectOption("hours")
await populatedTodoSlot.locator('.modular-diary-todo-add-form .modular-diary-todo-estimate-input').fill("0.02")
await populatedTodoSlot.locator('.modular-diary-todo-add-form .modular-diary-todo-save').click()
const preciseHourSubmit = await populatedTodoSlot.locator(".modular-diary-todo-add-form").evaluate((form) => ({
  hidden: form.hidden,
  noValidate: form.noValidate,
  errorCount: form.querySelectorAll('.modular-diary-todo-form-error:not([hidden])').length,
}))
// Keep the rest of this smoke deterministic even on the deliberately failing
// pre-fix candidate, where the browser prevents submit and leaves the form up.
await populatedTodoSlot.locator(".modular-diary-todo-add-form").evaluate((form) => { form.hidden = true })
await populatedTodoSlot.locator(".modular-diary-component-actions button").nth(2).click()
await populatedTodoSlot.locator('.modular-diary-todo-add-form .modular-diary-todo-title-input').fill("非法负数时长")
await populatedTodoSlot.locator('.modular-diary-todo-add-form .modular-diary-todo-estimate-unit-select').selectOption("hours")
await populatedTodoSlot.locator('.modular-diary-todo-add-form .modular-diary-todo-estimate-input').fill("-1")
await populatedTodoSlot.locator('.modular-diary-todo-add-form .modular-diary-todo-save').click()
const invalidDurationFeedback = await populatedTodoSlot.locator(".modular-diary-todo-add-form").evaluate((form) => ({
  hidden: form.hidden,
  noValidate: form.noValidate,
  error: form.querySelector('.modular-diary-todo-form-error:not([hidden])')?.textContent?.trim() ?? "",
  ariaInvalid: form.querySelector('.modular-diary-todo-estimate-input')?.getAttribute('aria-invalid') ?? "",
}))
await populatedTodoSlot.locator(".modular-diary-todo-add-form").screenshot({ path: path.join(out, "todo-validation-light.png") })
await populatedTodoSlot.locator(".modular-diary-todo-add-form").evaluate((form) => { form.hidden = true })
await populatedTodoSlot.locator(".modular-diary-component-actions button").nth(0).click()
await populatedTodoSlot.locator(".modular-diary-component-actions button").nth(1).click()
await populatedTodoSlot.locator(".modular-diary-todo-row").first().click({ button: "right" })
const todoEditForm = populatedTodoSlot.locator(".modular-diary-todo-row").first().locator(".modular-diary-todo-edit-form")
const todoEditWasVisible = await todoEditForm.isVisible()
const todoEditInitial = {
  title: await todoEditForm.locator('.modular-diary-todo-title-input').inputValue(),
  category: await todoEditForm.locator('.modular-diary-todo-category-select').inputValue(),
  estimate: await todoEditForm.locator('.modular-diary-todo-estimate-input').inputValue(),
  estimateUnit: await todoEditForm.locator('.modular-diary-todo-estimate-unit-select').inputValue(),
}
await populatedTodoSlot.screenshot({ path: path.join(out, "todo-edit-light.png") })
await todoEditForm.locator('.modular-diary-todo-estimate-input').fill("0.75")
await todoEditForm.dispatchEvent("submit")
await populatedTodoSlot.locator(".modular-diary-todo-drag").first().focus()
const todoHandleFocusOpacity = await populatedTodoSlot.locator(".modular-diary-todo-drag").first().evaluate((handle) => getComputedStyle(handle).opacity)
await populatedTodoSlot.locator(".modular-diary-todo-row").first().hover()
const todoHandleHoverOpacity = await populatedTodoSlot.locator(".modular-diary-todo-drag").first().evaluate((handle) => getComputedStyle(handle).opacity)
await populatedTodoSlot.locator(".modular-diary-todo-row").nth(1).hover()
const todoSequentialHoverOpacities = await populatedTodoSlot.locator(".modular-diary-todo-drag").evaluateAll((handles) => handles.map((handle) => getComputedStyle(handle).opacity))
await populatedTodoSlot.locator(".modular-diary-todo-list").evaluate((list) => list.classList.add("is-ordering"))
const todoOrderingHoverGrip = await populatedTodoSlot.locator(".modular-diary-todo-row").nth(1).locator(".modular-diary-todo-drag").evaluate((handle) => {
  const style = getComputedStyle(handle)
  return { opacity: style.opacity, pointerEvents: style.pointerEvents }
})
await populatedTodoSlot.locator(".modular-diary-todo-list").evaluate((list) => list.classList.remove("is-ordering"))
await populatedTodoSlot.screenshot({ path: path.join(out, "todo-sequential-hover-light.png") })
const todoHandleHoverChrome = await populatedTodoSlot.locator(".modular-diary-todo-drag").first().evaluate((handle) => {
  const style = getComputedStyle(handle)
  return { background: style.backgroundColor, borderWidth: style.borderWidth, boxShadow: style.boxShadow }
})
await populatedTodoSlot.locator(".modular-diary-todo-check").first().hover()
const todoCheckHoverBackground = await populatedTodoSlot.locator(".modular-diary-todo-check").first().evaluate((check) => getComputedStyle(check).backgroundColor)
await populatedTodoSlot.screenshot({ path: path.join(out, "todo-check-hover-light.png") })
await pointerSortRow(
  populatedTodoSlot.locator(".modular-diary-todo-drag").first(),
  populatedTodoSlot.locator(".modular-diary-todo-row").nth(2),
  "整理发布清单",
  "todo-row-drag-preview-light.png",
)
const todoOrderAfterSort = await populatedTodoSlot.locator(".modular-diary-todo-row .modular-diary-item-title").allTextContents()
const habitSlot = page.locator(".modular-diary-slot-habits").first()
await habitSlot.locator(".modular-diary-habit-row").first().hover()
const habitHandleHoverOpacity = await habitSlot.locator(".modular-diary-habit-drag").first().evaluate((handle) => getComputedStyle(handle).opacity)
const habitHandleHoverChrome = await habitSlot.locator(".modular-diary-habit-drag").first().evaluate((handle) => {
  const style = getComputedStyle(handle)
  return { background: style.backgroundColor, borderWidth: style.borderWidth, boxShadow: style.boxShadow }
})
await habitSlot.locator(".modular-diary-habit-list").evaluate((list) => list.classList.add("is-ordering"))
const habitOrderingHoverGrip = await habitSlot.locator(".modular-diary-habit-row").first().locator(".modular-diary-habit-drag").evaluate((handle) => {
  const style = getComputedStyle(handle)
  return { opacity: style.opacity, pointerEvents: style.pointerEvents }
})
await habitSlot.locator(".modular-diary-habit-list").evaluate((list) => list.classList.remove("is-ordering"))
await habitSlot.screenshot({ path: path.join(out, "habit-drag-hover-light.png") })
await pointerSortRow(
  habitSlot.locator(".modular-diary-habit-drag").first(),
  habitSlot.locator(".modular-diary-habit-row").nth(1),
  "开发练习",
  "habit-row-drag-preview-light.png",
)
const habitOrderAfterSort = await habitSlot.locator(".modular-diary-habit-row .modular-diary-item-title").allTextContents()

const scheduleSource = populatedTodoSlot.locator(".modular-diary-todo-row", { hasText: "整理发布清单" }).locator(".modular-diary-schedule-source")
const scheduleTrack = page.locator(".modular-diary-schedule-test .modular-diary-track")
const scheduleSourceBox = await scheduleSource.boundingBox()
const scheduleTrackBox = await scheduleTrack.boundingBox()
if (!scheduleSourceBox || !scheduleTrackBox) throw new Error("schedule drag fixture has no geometry")
await page.mouse.move(scheduleSourceBox.x + scheduleSourceBox.width / 2, scheduleSourceBox.y + scheduleSourceBox.height / 2)
await page.mouse.down()
// 09:03 snaps to 09:05; the Todo's authored 60-minute estimate remains exact.
await page.mouse.move(scheduleTrackBox.x + scheduleTrackBox.width / 2, scheduleTrackBox.y + (123 / 960) * scheduleTrackBox.height, { steps: 8 })
const schedulePreview = await page.evaluate(() => ({
  preview: Boolean(document.querySelector(".modular-diary-schedule-preview")),
  previewText: document.querySelector(".modular-diary-schedule-preview text")?.textContent ?? "",
  ghost: Boolean(document.querySelector(".modular-diary-schedule-drag-ghost.is-valid")),
  pointerActive: document.querySelector("#host")?.getAttribute("data-modular-diary-pointer-active") ?? "",
}))
await page.locator(".modular-diary-schedule-test").screenshot({ path: path.join(out, "todo-schedule-preview-light.png") })
await page.mouse.up()
const scheduledPlans = await page.evaluate(() => window.__scheduledPlans)
const scheduleCleanup = await page.evaluate(() => ({
  preview: document.querySelectorAll(".modular-diary-schedule-preview").length,
  ghost: document.querySelectorAll(".modular-diary-schedule-drag-ghost").length,
  pointerActive: document.querySelector("#host")?.hasAttribute("data-modular-diary-pointer-active") ?? false,
}))

const anyRecordScheduleSource = page.locator(".modular-diary-any-record-schedule-source")
const anyRecordScheduleAria = await anyRecordScheduleSource.getAttribute("aria-label")
await anyRecordScheduleSource.scrollIntoViewIfNeeded()
const anyRecordScheduleSourceBox = await anyRecordScheduleSource.boundingBox()
const anyRecordTrackBox = await scheduleTrack.boundingBox()
if (!anyRecordScheduleSourceBox || !anyRecordTrackBox) throw new Error("any-record habit has no scheduling geometry")
await page.mouse.move(anyRecordScheduleSourceBox.x + anyRecordScheduleSourceBox.width / 2, anyRecordScheduleSourceBox.y + anyRecordScheduleSourceBox.height / 2)
await page.mouse.down()
// 10:03 snaps to 10:05; an any-record rule gets one canonical five-minute span.
await page.mouse.move(anyRecordTrackBox.x + anyRecordTrackBox.width / 2, anyRecordTrackBox.y + (183 / 960) * anyRecordTrackBox.height, { steps: 8 })
await page.mouse.up()
const plansAfterAnyRecordDrop = await page.evaluate(() => window.__scheduledPlans)

// Leaving the track cancels scheduling and must not fall back to row sorting.
const sortEventsBeforeOutsideDrop = await page.evaluate(() => window.__events.filter((event) => event.startsWith("todo-move:local")).length)
await page.mouse.move(scheduleSourceBox.x + scheduleSourceBox.width / 2, scheduleSourceBox.y + scheduleSourceBox.height / 2)
await page.mouse.down()
await page.mouse.move(scheduleSourceBox.x + scheduleSourceBox.width + 40, scheduleSourceBox.y + 80, { steps: 5 })
await page.mouse.up()
const plansAfterOutsideDrop = await page.evaluate(() => window.__scheduledPlans.length)
const sortEventsAfterOutsideDrop = await page.evaluate(() => window.__events.filter((event) => event.startsWith("todo-move:local")).length)

const persistentTodoSlot = page.locator('.modular-diary-slot[data-slot="todos-edit-session"]')
await persistentTodoSlot.locator(".modular-diary-todo-row").click({ button: "right" })
const persistentEditForm = persistentTodoSlot.locator(".modular-diary-todo-edit-form")
await persistentEditForm.locator(".modular-diary-todo-title-input").fill("重绘后仍在编辑")
await page.evaluate(() => window.__requestPersistentTodoRefresh())
const persistentTitleRefresh = await page.evaluate(() => ({
  runs: window.__persistentTodoRefreshRuns,
  activeClass: document.activeElement?.className ?? "",
  value: document.querySelector('.modular-diary-slot[data-slot="todos-edit-session"] .modular-diary-todo-edit-form .modular-diary-todo-title-input')?.value ?? "",
}))
await persistentEditForm.locator(".modular-diary-todo-category-select").focus()
await page.evaluate(() => window.__requestPersistentTodoRefresh())
const persistentSelectRefresh = await page.evaluate(() => ({
  runs: window.__persistentTodoRefreshRuns,
  activeClass: document.activeElement?.className ?? "",
  connected: Boolean(document.querySelector('.modular-diary-slot[data-slot="todos-edit-session"] .modular-diary-todo-category-select')),
}))
await page.evaluate(() => {
  const owner = document.createElement("input")
  owner.id = "unrelated-active-editor"
  document.body.appendChild(owner)
  owner.focus()
})
await page.waitForTimeout(20)
const persistentDeferredRefresh = await page.evaluate(() => ({
  runs: window.__persistentTodoRefreshRuns,
  active: document.activeElement?.id ?? "",
  visible: !document.querySelector('.modular-diary-slot[data-slot="todos-edit-session"] .modular-diary-todo-edit-form')?.hidden,
  value: document.querySelector('.modular-diary-slot[data-slot="todos-edit-session"] .modular-diary-todo-edit-form .modular-diary-todo-title-input')?.value ?? "",
}))
const persistentFocusAfterRedraw = await page.evaluate(() => {
  const owner = document.querySelector("#unrelated-active-editor")
  owner?.focus()
  window.__rerenderPersistentTodo()
  return document.activeElement?.id ?? ""
})
const persistentEditAfterRedraw = {
  visible: await persistentTodoSlot.locator(".modular-diary-todo-edit-form").isVisible(),
  title: await persistentTodoSlot.locator(".modular-diary-todo-edit-form .modular-diary-todo-title-input").inputValue(),
}
await persistentTodoSlot.screenshot({ path: path.join(out, "todo-edit-persisted-light.png") })

await page.locator(".modular-diary-component-empty").first().hover()
const emptyHover = await page.locator(".modular-diary-component-empty").first().evaluate((button) => {
  const style = getComputedStyle(button)
  return { background: style.backgroundColor, borderStyle: style.borderStyle }
})
await page.locator(".modular-diary-slot-habits").last().screenshot({ path: path.join(out, "habit-empty-hover-light.png") })

await habitSlot.locator(".modular-diary-habit-row", { hasText: "开发练习" }).click({ button: "right" })
await populatedTodoSlot.locator(".modular-diary-todo-row", { hasText: "整理发布清单" }).locator(".modular-diary-todo-check").click()
const todoCompletionContinuity = await populatedTodoSlot.evaluate((slot) => {
  const root = slot.querySelector(".modular-diary-todos")
  const row = [...slot.querySelectorAll(".modular-diary-todo-row")].find((candidate) => candidate.textContent?.includes("整理发布清单"))
  return {
    rootConnected: Boolean(root?.isConnected),
    rootHeight: root?.getBoundingClientRect().height ?? 0,
    rowComplete: row?.classList.contains("is-complete") ?? false,
    pressed: row?.querySelector(".modular-diary-todo-check")?.getAttribute("aria-pressed") ?? "",
    count: slot.querySelector(".modular-diary-component-count")?.textContent ?? "",
  }
})
await page.locator(".modular-diary-component-empty").first().click()
const emptyTodoForm = page.locator(".modular-diary-slot-todos").nth(1).locator(".modular-diary-todo-form")
await page.locator(".modular-diary-slot-todos").nth(1).locator(".modular-diary-component-empty").click()
await emptyTodoForm.locator('.modular-diary-todo-title-input').fill("空状态新任务")
await emptyTodoForm.dispatchEvent("submit")
const events = await page.evaluate(() => window.__events)
await page.locator("#host").screenshot({ path: path.join(out, "components-light.png") })
await page.locator(".habit-badge-contract").screenshot({ path: path.join(out, "habit-status-badges-light.png") })
await page.evaluate(() => {
  document.documentElement.style.setProperty("--background-primary", "#202020")
  document.documentElement.style.setProperty("--background-secondary", "#292929")
  document.documentElement.style.setProperty("--background-modifier-border", "#454545")
  document.documentElement.style.setProperty("--text-normal", "#e6e6e6")
  document.documentElement.style.setProperty("--text-muted", "#aaaaaa")
  document.documentElement.style.setProperty("--text-faint", "#777777")
  document.body.style.background = "#202020"
})
await habitSlot.locator(".modular-diary-habit-row").first().hover()
const habitHandleDarkHoverChrome = await habitSlot.locator(".modular-diary-habit-drag").first().evaluate((handle) => {
  const style = getComputedStyle(handle)
  return { background: style.backgroundColor, borderWidth: style.borderWidth, boxShadow: style.boxShadow }
})
await habitSlot.screenshot({ path: path.join(out, "habit-drag-hover-dark.png") })
await populatedTodoSlot.locator(".modular-diary-todo-row").first().hover()
const todoHandleDarkHoverChrome = await populatedTodoSlot.locator(".modular-diary-todo-drag").first().evaluate((handle) => {
  const style = getComputedStyle(handle)
  return { background: style.backgroundColor, borderWidth: style.borderWidth, boxShadow: style.boxShadow }
})
await populatedTodoSlot.screenshot({ path: path.join(out, "todo-drag-hover-dark.png") })
await pointerSortRow(
  habitSlot.locator(".modular-diary-habit-drag").first(),
  habitSlot.locator(".modular-diary-habit-row").nth(1),
  "运动",
  "habit-row-drag-preview-dark.png",
)
await pointerSortRow(
  populatedTodoSlot.locator(".modular-diary-todo-drag").first(),
  populatedTodoSlot.locator(".modular-diary-todo-row").nth(1),
  "本周深度开发",
  "todo-row-drag-preview-dark.png",
)
await populatedTodoSlot.locator(".modular-diary-todo-row").first().click({ button: "right" })
await populatedTodoSlot.screenshot({ path: path.join(out, "todo-edit-dark.png") })
await page.locator("#host").screenshot({ path: path.join(out, "components-dark.png") })
await page.locator(".habit-badge-contract").screenshot({ path: path.join(out, "habit-status-badges-dark.png") })
// A narrow pane must keep every row title legible: the meta text yields
// before the title drops below 4em, and both truncate instead of wrapping.
const narrowRows = await page.evaluate(() => {
  const read = (slot) => {
    const previous = slot.style.width
    // Slots animate width changes; measure the settled 200px layout.
    slot.style.transition = "none"
    slot.style.width = "200px"
    // Rows replaced by an inline edit form earlier in the run have no box.
    const rows = [...slot.querySelectorAll(".modular-diary-habit-row, .modular-diary-todo-row")].filter((row) => (row.querySelector(".modular-diary-habit-body, .modular-diary-todo-body")?.getBoundingClientRect().width ?? 0) > 0)
    const result = rows.map((row) => {
      const title = row.querySelector(".modular-diary-item-title")
      const meta = row.querySelector(".modular-diary-item-meta")
      const body = row.querySelector(".modular-diary-habit-body, .modular-diary-todo-body")
      const titleRect = title.getBoundingClientRect()
      const bodyRect = body.getBoundingClientRect()
      return {
        text: title.textContent,
        titleWidth: titleRect.width,
        titleMinWidth: Math.min(parseFloat(getComputedStyle(title).fontSize) * 4, bodyRect.width),
        titleInsideBody: titleRect.left >= bodyRect.left - 0.5 && titleRect.right <= bodyRect.right + 0.5,
        titleOverflow: getComputedStyle(title).textOverflow,
        metaWidth: meta ? meta.getBoundingClientRect().width : 0,
        metaTruncated: meta ? meta.scrollWidth > meta.clientWidth + 0.5 : false,
        singleLine: titleRect.height <= parseFloat(getComputedStyle(title).fontSize) * 1.8,
        rowHeight: row.getBoundingClientRect().height,
      }
    })
    slot.style.width = previous
    slot.style.transition = ""
    return result
  }
  const progressRows = [...document.querySelectorAll(".todo-progress-contract .modular-diary-todo-row")].map((row) => ({
    title: row.querySelector(".modular-diary-item-title")?.textContent,
    tracks: row.querySelectorAll(".modular-diary-item-progress").length,
    barRatio: (() => { const bar = row.querySelector(".modular-diary-item-progress-bar"); return bar ? bar.getBoundingClientRect().width / bar.parentElement.getBoundingClientRect().width : null })(),
    height: row.getBoundingClientRect().height,
  }))
  return {
    habits: read(document.querySelector(".modular-diary-slot-habits")),
    todos: read(document.querySelector(".modular-diary-slot-todos")),
    wideHabitRowHeight: document.querySelector(".modular-diary-slot-habits .modular-diary-habit-row").getBoundingClientRect().height,
    progressRows,
  }
})
await browser.close()

const near = (value, target, tolerance = 0.03) => Math.abs(value - target) <= tolerance
const errors = []
for (const row of [...narrowRows.habits, ...narrowRows.todos]) {
  if (row.titleWidth < row.titleMinWidth - 0.5 || !row.titleInsideBody || row.titleOverflow !== "ellipsis" || !row.singleLine) {
    errors.push("narrow row squeezed its title: " + JSON.stringify(row))
  }
  if (row.metaWidth > 0 && row.titleWidth <= row.titleMinWidth + 0.5 && !row.metaTruncated) {
    errors.push("narrow row clipped the title before the meta text: " + JSON.stringify(row))
  }
}
if (narrowRows.habits.some((row) => Math.abs(row.rowHeight - narrowRows.wideHabitRowHeight) > 0.5)) errors.push("narrow habit rows changed height: " + JSON.stringify(narrowRows.habits))
const [noProgress, halfProgress, noEstimate] = narrowRows.progressRows
if (!noProgress || noProgress.tracks !== 0 || !halfProgress || halfProgress.tracks !== 1 || !near(halfProgress.barRatio, 0.5) || !noEstimate || noEstimate.tracks !== 0) {
  errors.push("todo progress track must appear only once there is progress: " + JSON.stringify(narrowRows.progressRows))
}
if (state.slotCount !== 7) errors.push("expected seven component slots")
if (!near(state.weeklyHabitRatio, 0.5)) errors.push("weekly habit progress must carry across days")
if (!near(state.todoRatios[0], 0.5) || !near(state.todoRatios[1], 0.5)) errors.push("todo actual/estimate progress is wrong")
if (state.rowBorderRadius !== "7px" || state.rowBackground !== "rgba(0, 0, 0, 0)" || state.rowBorderWidth !== "1px" || state.rowBorderStyle !== "solid") errors.push("habit rows must be compact outlined status rows")
if (state.habitRowHeight > state.compactControlHeight + 8 || state.habitRowHeight <= state.compactControlHeight) errors.push("habit rows are not compact around the shared control height")
if (state.habitStatusHeights.some((height) => Math.abs(height - (state.compactControlHeight - 2)) > 0.5)) errors.push("habit status badges must leave a small vertical inset inside the row")
if (state.habitMoreCount !== 0) errors.push("habit row actions must live in the row context menu, not an ellipsis button")
if (state.todoMoreCount !== 0) errors.push("todo row actions must live in the row context menu, not an ellipsis button")
if (state.todoGroupCount !== 0 || state.todoGroupControls !== 0) errors.push("todo grouping leaked back into item creation or the default flat view")
if (!state.todoEstimateUnitOptions.length || state.todoEstimateUnitOptions.some((options) => options !== "分钟|小时")) errors.push("todo estimate must offer both minute and hour units")
if (!state.draftVisible || state.draftTitle !== "未保存草稿" || state.draftEstimate !== "0.5" || state.draftEstimateUnit !== "hours") errors.push("todo draft must survive a renderer replacement with its chosen duration unit")
if (state.draftRestoreFocus !== "draft-restore-focus-owner") errors.push("restoring a todo creation draft stole focus from another active interaction")
if (state.todoRowsDraggable.some(Boolean) || state.todoHandleDraggable || state.todoHandleCount !== 4) errors.push("todo sorting must use one pointer-owned handle per row rather than native HTML drag")
if (state.todoHandleOpacity !== "0" || todoHandleHoverOpacity !== "1" || todoHandleFocusOpacity !== "1") errors.push("todo drag handles must reveal only on row hover or focus")
if (todoSequentialHoverOpacities.join("|") !== "0|1|0") errors.push("moving hover to another Todo row must hide the previously focused row grip")
if (todoOrderingHoverGrip.opacity !== "0" || todoOrderingHoverGrip.pointerEvents !== "none") errors.push("an ordering Todo list must suppress the hovered candidate row grip")
if (state.todoHandleCursor !== "grab") errors.push("todo drag handle does not advertise direct manipulation")
if (state.habitHandleCount !== 3 || state.habitHandleDraggable || state.habitHandleOpacity !== "0" || habitHandleHoverOpacity !== "1" || state.habitHandleCursor !== "grab") errors.push("habit ordering must use the same hover-only pointer handle as todos")
if (habitOrderingHoverGrip.opacity !== "0" || habitOrderingHoverGrip.pointerEvents !== "none") errors.push("an ordering Habit list must suppress the hovered candidate row grip")
if (state.habitHandlePosition !== "absolute" || state.todoHandlePosition !== "absolute") errors.push("row grips must float in the existing component gutter rather than reserve a grid column")
if (state.habitContentInset > 10 || state.todoContentInset > 8) errors.push("hidden row grips still reserve a visibly empty leading column")
if (state.habitHandleGutterGap < 0 || state.habitHandleGutterGap > 4 || state.todoHandleGutterGap < 0 || state.todoHandleGutterGap > 4) errors.push("row grips are not aligned inside the shared left gutter")
for (const [name, chrome] of [["habit", habitHandleHoverChrome], ["todo", todoHandleHoverChrome]]) {
  if (chrome.background !== "rgba(0, 0, 0, 0)" || chrome.borderWidth !== "0px" || chrome.boxShadow !== "none") errors.push(`${name} row grip must reveal only its six dots on hover`)
}
for (const [name, chrome] of [["habit-dark", habitHandleDarkHoverChrome], ["todo-dark", todoHandleDarkHoverChrome]]) {
  if (chrome.background !== "rgba(0, 0, 0, 0)" || chrome.borderWidth !== "0px" || chrome.boxShadow !== "none") errors.push(`${name} row grip must remain dot-only in the dark theme`)
}
for (const [name, grip] of [["habit", state.habitGrip], ["todo", state.todoGrip]]) {
  if (grip.borderWidth !== "0px" || grip.background !== "rgba(0, 0, 0, 0)") errors.push(`${name} row grip must have transparent borderless chrome`)
  if (grip.touchAction !== "none") errors.push(`${name} row grip must own the pointer gesture`)
  if (grip.dotCount !== 6 || grip.columns !== "1.5px 1.5px" || grip.rowGap !== "2px" || grip.columnGap !== "2px") errors.push(`${name} row grip lost the shared 2 × 3 layout`)
  if (grip.dots.some(([width, height, radius]) => width !== 1.5 || height !== 1.5 || radius !== "50%")) errors.push(`${name} row grip dots no longer match the element grip geometry`)
}
if (todoOrderAfterSort.join("|") !== "本周深度开发|读完一章|整理发布清单") errors.push("todo pointer drop did not reorder the full rows")
if (habitOrderAfterSort.join("|") !== "运动|开发练习|维护 linuxdo 账号") errors.push("habit pointer drop did not reorder the full rows")
if (state.todoCheckBackground !== "rgba(0, 0, 0, 0)" || todoCheckHoverBackground !== "rgba(0, 0, 0, 0)") errors.push("todo completion circle must not gain a persistent or hover fill")
if (state.todoCheckSize[0] !== 22 || state.todoCheckSize[1] !== 22) errors.push("todo completion circle lost its compact pointer target")
if (!todoCompletionContinuity.rootConnected || todoCompletionContinuity.rootHeight <= 0 || !todoCompletionContinuity.rowComplete || todoCompletionContinuity.pressed !== "true" || todoCompletionContinuity.count !== "2/3") errors.push("todo completion must paint in place without collapsing its element block")
if (!remountVisualDuringGap.started || !remountVisualDuringGap.connected || remountVisualDuringGap.ariaHidden !== "true" || !remountVisualDuringGap.inert || remountVisualDuringGap.width !== 320 || remountVisualDuringGap.height !== 96 || !remountVisualCompletion.completed || remountVisualCompletion.overlaysInCompletionTask !== 0) errors.push("processor remount must remove its old visual synchronously when the replacement is ready")
if (!remountSingleVisibleTree.started || !remountSingleVisibleTree.hiddenDuringHandoff || remountSingleVisibleTree.overlaysDuringHandoff !== 1 || !remountSingleVisibleTree.restoredAfterCancel) errors.push("processor remount must expose exactly one visible whole-block tree and restore the source on cancellation")
if (remountWriteCompletion.some(({ started, completed, overlays }) => !started || !completed || overlays !== 0)) errors.push("source-only writes must remove their continuity bridge in the replacement task")
if (previewedTimelineWrite.some(({ mode, started, overlays, sourceVisible }) => mode !== "live-preview" || started || overlays !== 0 || !sourceVisible)) errors.push("timeline writes with a synchronous final-state preview must never create a second whole-block visual owner")
if (liveGridPreview.started || liveGridPreview.overlays !== 0 || !liveGridPreview.sourceVisible) errors.push("a committed live grid preview must remain the only visible tree instead of spawning a whole-block remount clone")
if (!remountVisualInvalidation.scrollStarted || remountVisualInvalidation.beforeScroll !== 1 || remountVisualInvalidation.afterScroll !== 0) errors.push("a remount visual must be discarded before scroll can expose a stale fixed ghost")
if (!remountVisualInvalidation.resizeStarted || remountVisualInvalidation.beforeResize !== 1 || remountVisualInvalidation.afterResize !== 0) errors.push("a remount visual must be discarded when viewport geometry changes")
if (state.todoBorderTopWidths.some((width) => width !== "0px")) errors.push("todo rows must not use divider lines")
if (state.groupedTodoLabels.join("|") !== "develop|read" || state.groupedTodoTitles.join("|") !== "本周深度开发|整理发布清单|读完一章") errors.push("todo view rules do not group by category and sort by estimate")
if (state.groupedTodoHandleCount !== 0) errors.push("derived todo views must not advertise manual drag sorting")
if (!state.groupedTodoSortLabel.includes("切换为手动排序后可拖拽")) errors.push("derived todo views must explain how to restore manual drag sorting")
if (state.groupedScheduleSourceCount !== 3 || state.scheduleSourceCursor !== "grab") errors.push("estimated items must remain directly schedulable even in a derived Todo view")
if (!schedulePreview.preview || !schedulePreview.ghost || schedulePreview.pointerActive !== "1" || !schedulePreview.previewText.includes("整理发布清单")) errors.push("dragging an estimated Todo did not show a pointer-owned timeline preview")
if (scheduledPlans.length !== 1 || scheduledPlans[0].line !== "plan 09:05-10:05 develop 整理发布清单 [todo:local]") errors.push("timeline drop did not create exactly one bound plan with the Todo estimate")
if (plansAfterAnyRecordDrop.length !== 2 || plansAfterAnyRecordDrop[1].line !== "plan 10:05-10:10 read 维护 linuxdo 账号") errors.push("an any-record habit did not create one five-minute plan with its category and name")
if (scheduleCleanup.preview !== 0 || scheduleCleanup.ghost !== 0 || scheduleCleanup.pointerActive) errors.push("timeline scheduling left transient UI or pointer ownership behind")
if (plansAfterOutsideDrop !== 2 || sortEventsAfterOutsideDrop !== sortEventsBeforeOutsideDrop) errors.push("an outside schedule drop wrote data or leaked into row sorting")
if (state.statusRightInset > 5) errors.push("habit status badge is not aligned to the row end")
if (state.habitStatusTags.some((tag) => tag !== "SPAN") || state.habitStatusPointerEvents.some((value) => value !== "none")) errors.push("automatic habit status must remain visibly non-interactive")
if (state.incompleteStatusText !== "本周进行中" || state.incompleteStatusIcons !== 0) errors.push("incomplete weekly habit status must use weekly text, not a checkbox-like circle")
if (!state.completeStatusText.includes("已打卡") || state.completeStatusText.includes("今日") || state.completeStatusIcon !== "check") errors.push("complete habit status must use the compact checked badge")
if (state.dailyBadgeTexts.join("|") !== "已打卡|尚未打卡") errors.push("daily habit status copy lost its compact paired labels")
if (state.dailyBadgeWidths.length !== 2 || Math.abs(state.dailyBadgeWidths[0] - state.dailyBadgeWidths[1]) > 8) errors.push("daily complete and incomplete badges no longer have comparable visual widths")
if (state.slotBorderWidth !== "1px") errors.push("component shell border changed")
if (state.emptyStyles.some(({ borderWidth, borderStyle }) => borderWidth !== "1px" || borderStyle !== "dashed")) errors.push("component empty action must use the shared dashed language")
if (state.emptyStyles.some(({ background }) => background !== "rgba(0, 0, 0, 0)")) errors.push("component empty action must stay transparent")
if (state.emptyStyles.some(({ height }) => Math.abs(height - state.habitRowHeight) > 1)) errors.push("component empty action must preview one real item row")
if (state.emptyStyles.some(({ widthRatio }) => widthRatio < 0.98)) errors.push("empty action does not fill its component")
if (emptyHover.background !== "rgba(0, 0, 0, 0)" || emptyHover.borderStyle !== "dashed") errors.push("component empty hover must preserve the dashed transparent language")
if (state.actionSizes.some(([width, height]) => width !== 22 || height !== 22)) errors.push("component action controls are not compact")
if (state.todoHeaderActionLabels.join("|") !== "分组方式|排序方式|添加待办") errors.push("todo header must expose separate group, sort, and add actions")
if (state.todoHeaderActionIcons.join("|") !== "list-tree|arrow-up-down|plus") errors.push("todo header action icons do not match their separate destinations")
if (state.habitHeaderActionCount !== 1 || state.habitHeaderActionLabel !== "编辑打卡项目" || state.habitHeaderActionIcon !== "pencil") errors.push("habit header must expose one clearly named pencil edit action")
if (!todoEditWasVisible || todoEditInitial.title !== "整理发布清单" || todoEditInitial.category !== "develop" || todoEditInitial.estimate !== "1" || todoEditInitial.estimateUnit !== "hours") errors.push("todo edit form must open prefilled with an intelligible duration unit")
if (state.weeklyCheckboxDisabled !== 1) errors.push("weekly todo must remain automatic")
for (const expected of ["habit-edit", "habit-menu:weekly", "habit-move:weekly:1", "todo-menu:local", "todo-move:local:2", "todo-toggle:local:true", "empty-habit-edit", "empty-todo-add:空状态新任务"]) {
  if (!events.includes(expected)) errors.push("missing interaction " + expected)
}
if (!events.includes("todo-edit:local:整理发布清单:45")) errors.push("todo estimate edit did not reach the persistence contract")
if (!events.includes("todo-add:整理学习资料:30")) errors.push("hour-based todo creation did not convert to canonical minutes")
if (minuteValueBeforeUnitSwitch !== "30" || hourValueAfterUnitSwitch !== "30" || minuteValueAfterUnitSwitch !== "0.5" || hourValueAfterRoundTrip !== "0.5") errors.push("switching Todo duration units must reinterpret the authored number without rewriting it")
if (!events.includes("todo-add:精确小时输入:1") || !preciseHourSubmit.hidden || !preciseHourSubmit.noValidate || preciseHourSubmit.errorCount !== 0) errors.push("decimal-hour Todo creation leaked into native browser validation instead of saving one canonical minute")
if (events.some((event) => event.startsWith("todo-add:非法负数时长:")) || invalidDurationFeedback.hidden || !invalidDurationFeedback.noValidate || !invalidDurationFeedback.error || invalidDurationFeedback.ariaInvalid !== "true") errors.push("invalid Todo duration must stay in the editor with Modular Diary-owned inline feedback")
if (!explicitAddFocusedTitle) errors.push("an explicit add action must focus the todo title input")
if (persistentTitleRefresh.runs !== 0 || !String(persistentTitleRefresh.activeClass).includes("modular-diary-todo-title-input") || persistentTitleRefresh.value !== "重绘后仍在编辑") errors.push("background refresh replaced the active todo title editor")
if (persistentSelectRefresh.runs !== 0 || !String(persistentSelectRefresh.activeClass).includes("modular-diary-todo-category-select") || !persistentSelectRefresh.connected) errors.push("background refresh closed the active todo category selector")
if (persistentDeferredRefresh.runs !== 1 || persistentDeferredRefresh.active !== "unrelated-active-editor" || !persistentDeferredRefresh.visible || persistentDeferredRefresh.value !== "重绘后仍在编辑") errors.push("deferred todo refresh did not coalesce and restore the draft after editing ended")
if (persistentFocusAfterRedraw !== "unrelated-active-editor") errors.push("restoring a todo edit draft stole focus from another active interaction")
if (!events.some((event) => event.startsWith("todo-group:")) || !events.some((event) => event.startsWith("todo-sort:"))) errors.push("todo group and sort controls must be independently reachable")
if (!persistentEditAfterRedraw.visible || persistentEditAfterRedraw.title !== "重绘后仍在编辑") errors.push("todo edit session and typed draft must survive a renderer replacement")
if (events.includes("todo-component-menu")) errors.push("todo row context menu must own and stop the event before the component hide menu")
if (errors.length) {
  console.error("COMPONENT CONTRACT FAILED", { errors, anyRecordScheduleAria, scheduledPlans, plansAfterAnyRecordDrop, plansAfterOutsideDrop, persistentTitleRefresh, persistentSelectRefresh, persistentDeferredRefresh, state, events, screenshots: out })
  process.exit(1)
}
console.log(JSON.stringify({ ok: true, state, events, screenshots: out }, null, 2))
