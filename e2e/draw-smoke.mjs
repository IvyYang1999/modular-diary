/**
 * M3 draw-interaction smoke in real Chromium: render timeline, drag on the
 * track with real mouse events, assert the entry line produced; right-click
 * a block, assert the menu callback fires. Run: npm run e2e:draw
 */
import esbuild from "esbuild"
import { chromium } from "playwright"
import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"
import os from "node:os"

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(os.tmpdir(), "modular-diary-draw-smoke")
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })

fs.writeFileSync(path.join(out, "entry.ts"), `
import { parseTimeline } from "${path.join(here, "../src/core/parser")}"
import { renderTimelineSvg } from "${path.join(here, "../src/render/svg-builder")}"
import { buildLayerToggles, buildToolbar } from "${path.join(here, "../src/edit/toolbar")}"
import { attachDrawInteraction } from "${path.join(here, "../src/edit/draw-interaction")}"
import { attachMarkerInteraction } from "${path.join(here, "../src/edit/marker-interaction")}"
import { createPointerRedrawGate } from "${path.join(here, "../src/edit/pointer-interaction")}"
import { routeMarkdownUndo } from "${path.join(here, "../src/edit/undo-routing")}"
import { attachHoverInfo } from "${path.join(here, "../src/edit/hover-info")}"
import { openNotePopover } from "${path.join(here, "../src/edit/note-popover")}"
import { previewTimelineVisual } from "${path.join(here, "../src/edit/timeline-visual-preview")}"
import { showActionMenuAtPoint } from "${path.join(here, "../src/edit/custom-menu")}"
import { attachCascadeMenu } from "${path.join(here, "../src/edit/cascade-menu")}"
import { configureI18n } from "${path.join(here, "../src/i18n")}"

const COLORS = { math: "#7fd4c1", sleep: "#d9d9d9", fitness: "#f6c667" }
const MARKER_COLORS = { deadline: "#ef5b72", wake: "#6f8cff" }
const source = "07:00-08:00 sleep\\n15:30-15:55 sleep\\nplan 07:00-09:00 math\\n13:15-13:35 math\\n@12:00 [deadline] ddl\\n"
const doc = parseTimeline(source)
const container = document.getElementById("app")
const toolbar = buildToolbar({
  typeColors: COLORS,
  markerTypeColors: MARKER_COLORS,
  hiddenTypes: ["fitness"],
  markerHiddenTypes: ["wake"],
  activeType: "math",
  activeMarkerType: "deadline",
  brushMode: "actual",
  drawTool: "span",
  onDrawToolChange: (tool) => { window.__tool = tool },
  onBrushModeChange: (m) => { window.__mode = m },
  onSelect: (t) => { window.__active = t },
  onHide: (t) => window.__hidden.push(t),
  onShow: (t) => window.__shown.push(t),
  onAddNew: () => { window.__addNew += 1 },
})
window.__setToolbarState = (mode, tool) => {
  toolbar.setBrushMode(mode)
  toolbar.setDrawTool(tool)
}
container.appendChild(toolbar.el)
const holder = document.createElement("div")
holder.innerHTML = renderTimelineSvg(doc, { typeColors: COLORS })
container.appendChild(holder)
container.appendChild(toolbar.statusEl)
const layerToggles = buildLayerToggles({ actual: true, plan: true }, () => {})
layerToggles.id = "layer-toggle-size-check"
container.appendChild(layerToggles)

window.__active = "math"
window.__mode = "actual"
window.__tool = "span"
window.__created = []
window.__mutationErrors = []
window.__rejectNextCreate = false
window.__menu = []
window.__focus = []
window.__hidden = []
window.__shown = []
window.__addNew = 0
window.__noteSaves = []
window.__noteFailures = 0
window.__exerciseTimelineVisualPreview = () => {
  document.querySelector("#timeline-visual-preview-fixture")?.remove()
  const host = document.createElement("div")
  host.id = "timeline-visual-preview-fixture"
  const initial = parseTimeline("range: 7-11\\n---\\n08:00-09:00 math 旧备注\\n")
  host.innerHTML = renderTimelineSvg(initial, { typeColors: COLORS, width: 220 })
  document.body.appendChild(host)
  const line = initial.entries[0].line
  const options = { typeColors: COLORS, width: 220 }

  const rollbackNote = previewTimelineVisual(
    host,
    parseTimeline("range: 7-11\\n---\\n08:00-09:00 math 新备注立刻出现\\n"),
    options,
  )
  const noteImmediate = Array.from(host.querySelectorAll('.modular-diary-note[data-line="' + line + '"]'))
    .map((node) => node.textContent).join("")
  rollbackNote?.()
  const noteRollback = Array.from(host.querySelectorAll('.modular-diary-note[data-line="' + line + '"]'))
    .map((node) => node.textContent).join("")

  previewTimelineVisual(
    host,
    parseTimeline("range: 7-11\\n---\\n08:00-09:00 math 旧备注\\nplan 09:00-10:00 sleep\\n"),
    options,
  )
  const plan = host.querySelector('rect.modular-diary-plan[data-type="sleep"]')
  const planLine = plan?.dataset.line
  const created = {
    block: Boolean(plan),
    hatch: Boolean(planLine && host.querySelector('rect.modular-diary-plan-hatch[data-line="' + planLine + '"]')),
    duration: planLine ? host.querySelector('text.modular-diary-duration[data-line="' + planLine + '"]')?.textContent : "",
  }

  previewTimelineVisual(host, parseTimeline("range: 7-11\\n---\\n"), options)
  const deletedTogether = host.querySelectorAll('[data-line="' + line + '"]').length === 0
  const result = { noteImmediate, noteRollback, created, deletedTogether }
  host.remove()
  return result
}
window.__mountNotePopover = (initial = "", kind = "span") => {
  document.querySelector("#note-anchor")?.remove()
  const anchor = document.createElement("div")
  anchor.id = "note-anchor"
  anchor.style.cssText = "position:fixed;left:120px;top:120px;width:80px;height:30px"
  document.body.appendChild(anchor)
  openNotePopover(container, anchor, anchor.getBoundingClientRect(), initial, (note) => window.__noteSaves.push(note), { kind })
}
window.__mountFailingNotePopover = (initial = "") => {
  document.querySelector("#note-anchor")?.remove()
  const anchor = document.createElement("div")
  anchor.id = "note-anchor"
  anchor.style.cssText = "position:fixed;left:120px;top:120px;width:80px;height:30px"
  document.body.appendChild(anchor)
  openNotePopover(container, anchor, anchor.getBoundingClientRect(), initial, async (note) => {
    window.__noteFailures += 1
    if (window.__noteFailures === 1) throw new Error("synthetic save failure")
    window.__noteSaves.push(note)
  })
}
window.__mountNoHiddenToolbar = () => {
  const noHidden = buildToolbar({
    typeColors: COLORS,
    hiddenTypes: [],
    activeType: "math",
    brushMode: "actual",
    onBrushModeChange: () => {},
    onSelect: () => {},
    onHide: () => {},
    onShow: () => {},
    onAddNew: () => { window.__addNew += 1 },
  })
  noHidden.el.id = "no-hidden-toolbar"
  container.appendChild(noHidden.el)
}
window.__mountEmptyToolbars = () => {
  const zero = buildToolbar({
    typeColors: { math: COLORS.math },
    markerTypeColors: {},
    hiddenTypes: [],
    markerHiddenTypes: [],
    activeType: "math",
    activeMarkerType: "",
    brushMode: "actual",
    drawTool: "marker",
    onBrushModeChange: () => {},
    onSelect: () => {},
    onHide: () => {},
    onShow: () => {},
    onAddNew: () => { window.__addNew += 1 },
  })
  zero.el.id = "zero-toolbar"
  container.appendChild(zero.el)
  const allHidden = buildToolbar({
    typeColors: { math: COLORS.math },
    hiddenTypes: ["math"],
    activeType: "",
    brushMode: "actual",
    onBrushModeChange: () => {},
    onSelect: () => {},
    onHide: () => {},
    onShow: (type) => window.__shown.push(type),
    onAddNew: () => { window.__addNew += 1 },
  })
  allHidden.el.id = "all-hidden-toolbar"
  container.appendChild(allHidden.el)
}
window.__mountEnglishToolbar = () => {
  configureI18n(() => "en")
  const english = buildToolbar({
    typeColors: {},
    hiddenTypes: [],
    activeType: "",
    brushMode: "actual",
    onBrushModeChange: () => {},
    onSelect: () => {},
    onHide: () => {},
    onShow: () => {},
    onAddNew: () => {},
  })
  english.el.id = "english-toolbar"
  container.appendChild(english.el)
  const layers = buildLayerToggles({ actual: true, plan: true }, () => {})
  layers.id = "english-layers"
  container.appendChild(layers)
  configureI18n(() => "zh")
}
window.__mountManyCategories = (width) => {
  document.querySelector("#many-categories-slot")?.remove()
  const slot = document.createElement("div")
  slot.id = "many-categories-slot"
  slot.className = "modular-diary-slot modular-diary-slot-toolbar"
  slot.style.cssText = "position:relative;inset:auto;width:" + width + "px;height:auto"
  container.appendChild(slot)
  const names = ["开发", "自媒体", "运动", "睡觉", "阅读", "生活", "wasted", "看剧", "画画", "写作", "游泳", "信息摄取", "战略思考", "环境搭建", "洗澡", "聊天", "发布产品", "复盘反思", "装修", "按摩", "出门"]
  window.__manySelected = []
  const many = buildToolbar({
    typeColors: Object.fromEntries(names.map((name, index) => [name, "hsl(" + (index * 17) + " 60% 60%)"])),
    hiddenTypes: [],
    activeType: names[0],
    brushMode: "actual",
    onBrushModeChange: () => {},
    onSelect: (type) => window.__manySelected.push(type),
    onHide: () => {},
    onShow: () => {},
    onAddNew: () => {},
    categoriesCollapsed: window.__manyCollapsed ?? false,
    onCategoriesCollapsedChange: (collapsed) => { window.__manyCollapsed = collapsed },
  })
  slot.appendChild(many.el)
  return many
}
window.__mountAfterMidnightHover = () => {
  document.querySelector("#after-midnight-hover")?.remove()
  const host = document.createElement("div")
  host.id = "after-midnight-hover"
  host.style.cssText = "position:fixed;left:620px;top:20px;width:300px;height:300px"
  const overnight = parseTimeline("range: 23-28\\n---\\n02:30-03:15 renovation 安装吹风机支架")
  host.innerHTML = renderTimelineSvg(overnight, { typeColors: { renovation: "#bdbdbd" } })
  document.body.appendChild(host)
  attachHoverInfo(host, overnight)
}
window.__componentHidden = 0
window.__showComponentMenu = (x, y) => showActionMenuAtPoint(
  document, x, y, "统计组件操作", "隐藏", () => { window.__componentHidden += 1 }
)
window.__cascadeSelected = []
window.__mountCascadeFixture = (left = 80) => {
  document.querySelector("#cascade-fixture")?.remove()
  const primary = document.createElement("div")
  primary.id = "cascade-fixture"
  primary.className = "menu"
  primary.style.cssText = "position:fixed;left:" + left + "px;top:180px;width:150px;padding:4px"
  const trigger = document.createElement("button")
  trigger.type = "button"
  trigger.className = "menu-item"
  trigger.textContent = "更改分类…"
  const sibling = document.createElement("button")
  sibling.type = "button"
  sibling.className = "menu-item"
  sibling.textContent = "删除时间段"
  primary.append(trigger, sibling)
  document.body.appendChild(primary)
  attachCascadeMenu(primary, trigger, [
    { title: "开发", checked: true },
    { title: "运动", checked: false },
    { title: "睡觉", checked: false },
  ], "选择时间分类", (index) => {
    window.__cascadeSelected.push(index)
    primary.remove()
  })
}
window.__mountCascadeSwitchFixture = () => {
  document.querySelector("#cascade-switch-fixture")?.remove()
  const primary = document.createElement("div")
  primary.id = "cascade-switch-fixture"
  primary.className = "menu"
  primary.style.cssText = "position:fixed;left:80px;top:180px;width:170px;padding:4px"
  const scroll = document.createElement("div")
  scroll.className = "menu-scroll"
  const todoTrigger = document.createElement("button")
  todoTrigger.type = "button"
  todoTrigger.className = "menu-item"
  todoTrigger.textContent = "绑定待办…"
  const typeTrigger = document.createElement("button")
  typeTrigger.type = "button"
  typeTrigger.className = "menu-item"
  typeTrigger.textContent = "更改分类…"
  scroll.append(todoTrigger, typeTrigger)
  primary.appendChild(scroll)
  document.body.appendChild(primary)
  attachCascadeMenu(primary, typeTrigger, [
    { title: "开发", checked: true },
    { title: "运动", checked: false },
  ], "选择时间分类", () => {})
  attachCascadeMenu(primary, todoTrigger, [
    { title: "任务 A", checked: false },
    { title: "任务 B", checked: false },
  ], "选择待办", () => {})
}
window.__trackmenu = []
window.__extend = []
window.__editing = null
window.__editnotes = []
window.__span = []
window.__deleted = []

attachHoverInfo(container, doc)
attachDrawInteraction(container, doc, {
  hourHeight: 48,
  getActiveType: () => window.__active,
  getMode: () => window.__mode,
  typeColor: (t) => COLORS[t] ?? "#bdbdbd",
  onBlockClick: (line) => window.__focus.push(line),
  onTrackMenu: (x, y) => window.__trackmenu.push({ x, y }),
  onExtendRange: (startMin, endMin) => window.__extend.push({ startMin, endMin }),
  onEditNote: (line) => window.__editnotes.push(line),
  getEditingLine: () => window.__editing,
  setEditingLine: (l) => { window.__editing = l },
  onUpdateSpan: (line, startMin, endMin) => window.__span.push({ line, startMin, endMin }),
  onCreate: async (line, startMin) => {
    if (window.__rejectNextCreate) {
      window.__rejectNextCreate = false
      throw new Error("synthetic persistence failure")
    }
    window.__created.push({ line, startMin })
  },
  onMutationError: (error) => window.__mutationErrors.push(String(error)),
  onBlockMenu: (line, x, y) => window.__menu.push({ line, x, y }),
  onDeleteEntry: (line) => window.__deleted.push({
    line,
    editingAtMutation: window.__editing,
    editingSvgCount: document.querySelectorAll(".modular-diary-svg.is-editing-block").length,
    frozenCount: document.querySelectorAll(".is-frozen").length,
    focusCount: document.querySelectorAll(".is-focus").length,
  }),
})

window.__mountRangeEdgeFixture = () => {
  const host = document.createElement("div")
  host.id = "range-edge-fixture"
  host.className = "modular-diary-container"
  host.style.cssText = "width:200px;position:relative;margin-top:12px"
  const rangeDoc = parseTimeline("range: 7-23\\n---\\n09:00-10:00 math\\n")
  const rangeHolder = document.createElement("div")
  rangeHolder.innerHTML = renderTimelineSvg(rangeDoc, { typeColors: COLORS })
  host.appendChild(rangeHolder)
  document.body.appendChild(host)
  window.__rangeActive = "math"
  window.__rangeExtend = []
  window.__rangeCreated = []
  attachDrawInteraction(host, rangeDoc, {
    hourHeight: 48,
    getActiveType: () => window.__rangeActive,
    getMode: () => "actual",
    typeColor: (type) => COLORS[type] ?? "#bdbdbd",
    onBlockClick: () => {},
    onTrackMenu: () => {},
    onExtendRange: (startMin, endMin) => window.__rangeExtend.push({ startMin, endMin }),
    onEditNote: () => {},
    getEditingLine: () => null,
    setEditingLine: () => {},
    onUpdateSpan: () => {},
    onCreate: (line, startMin) => window.__rangeCreated.push({ line, startMin }),
    onBlockMenu: () => {},
    onDeleteEntry: () => {},
  })
}
window.__mountDeleteTransactionFixture = () => {
  document.querySelector("#delete-transaction-fixture")?.remove()
  const host = document.createElement("div")
  host.id = "delete-transaction-fixture"
  host.className = "modular-diary-container"
  host.style.cssText = "width:220px;position:relative;margin-top:12px"
  const deleteDoc = parseTimeline("range: 7-10\\n---\\n08:00-09:00 math 删除事务\\n")
  const deleteHolder = document.createElement("div")
  deleteHolder.innerHTML = renderTimelineSvg(deleteDoc, { typeColors: COLORS, width: 200 })
  host.appendChild(deleteHolder)
  document.body.appendChild(host)
  window.__deleteTransactionMenus = []
  window.__deleteTransactionCommits = []
  attachDrawInteraction(host, deleteDoc, {
    hourHeight: 48,
    getActiveType: () => "math",
    getMode: () => "actual",
    typeColor: (type) => COLORS[type] ?? "#bdbdbd",
    onBlockClick: () => {},
    onTrackMenu: () => {},
    onExtendRange: () => {},
    onEditNote: () => {},
    getEditingLine: () => null,
    setEditingLine: () => {},
    onUpdateSpan: () => {},
    onCreate: () => {},
    onBlockMenu: (line, x, y) => window.__deleteTransactionMenus.push({ line, x, y }),
    onDeleteEntry: (line) => window.__deleteTransactionCommits.push({
      line,
      pendingAtMutation: Array.from(host.querySelectorAll('[data-line="' + line + '"]'))
        .every((element) => element.classList.contains("is-pending-delete")),
    }),
  })
  window.__deleteFromContextMenu = (line) => {
    const event = new CustomEvent("modular-diary-delete-entry-request", {
      bubbles: false,
      cancelable: true,
      detail: { line },
    })
    const handled = !host.querySelector("svg.modular-diary-svg").dispatchEvent(event)
    return {
      handled,
      hidden: Array.from(host.querySelectorAll('[data-line="' + line + '"]'))
        .every((element) => getComputedStyle(element).visibility === "hidden"),
    }
  }
}
window.__mountInterruptedDragFixture = () => {
  document.querySelector("#interrupted-drag-fixture")?.remove()
  const host = document.createElement("div")
  host.id = "interrupted-drag-fixture"
  host.className = "modular-diary-container"
  host.style.cssText = "width:220px;position:relative;margin-top:12px"
  const interruptedDoc = parseTimeline("range: 7-10\\n---\\n")
  const interruptedHolder = document.createElement("div")
  interruptedHolder.innerHTML = renderTimelineSvg(interruptedDoc, { typeColors: COLORS, width: 200 })
  host.appendChild(interruptedHolder)
  document.body.appendChild(host)
  const redrawGate = createPointerRedrawGate()
  window.__interruptedCreated = []
  window.__interruptedRefreshRuns = 0
  window.__interruptedRefreshSideEffects = 0
  window.__requestInterruptedRefresh = () => {
    const redraw = () => {
      window.__interruptedRefreshSideEffects += 1
      window.__interruptedRefreshRuns += 1
      interruptedHolder.innerHTML = renderTimelineSvg(interruptedDoc, { typeColors: COLORS, width: 200 })
    }
    redrawGate.run(host, redraw)
  }
  attachDrawInteraction(host, interruptedDoc, {
    hourHeight: 48,
    getActiveType: () => "math",
    getMode: () => "actual",
    typeColor: (type) => COLORS[type] ?? "#bdbdbd",
    onBlockClick: () => {}, onTrackMenu: () => {}, onExtendRange: () => {}, onEditNote: () => {},
    getEditingLine: () => null, setEditingLine: () => {}, onUpdateSpan: () => {},
    onCreate: (line, startMin) => window.__interruptedCreated.push({ line, startMin }),
    onBlockMenu: () => {}, onDeleteEntry: () => {},
  })
}
window.__mountFocusedRefreshFixture = () => {
  document.querySelector("#focused-refresh-fixture")?.remove()
  const host = document.createElement("div")
  host.id = "focused-refresh-fixture"
  host.className = "modular-diary-container"
  const title = document.createElement("input")
  title.id = "focused-refresh-title"
  title.value = "输入到一半"
  const category = document.createElement("select")
  category.id = "focused-refresh-category"
  category.append(new Option("开发", "develop"), new Option("运动", "sport"))
  host.append(title, category)
  document.body.appendChild(host)
  const redrawGate = createPointerRedrawGate()
  window.__focusedRefreshRuns = 0
  window.__requestFocusedRefresh = () => redrawGate.run(host, () => {
    window.__focusedRefreshRuns += 1
    host.replaceChildren(document.createTextNode("refreshed"))
  })
}
window.__mountImmediateUndoFixture = () => {
  document.querySelector("#immediate-undo-cm")?.remove()
  const cm = document.createElement("div")
  cm.id = "immediate-undo-cm"
  cm.className = "cm-content"
  const host = document.createElement("div")
  host.className = "modular-diary-container"
  const control = document.createElement("button")
  control.id = "immediate-undo-control"
  control.textContent = "create"
  host.appendChild(control)
  cm.appendChild(host)
  document.body.appendChild(cm)
  window.__immediateUndoCreated = false
  window.__immediateUndoCalls = 0
  control.addEventListener("click", () => { window.__immediateUndoCreated = true })
  const controller = new AbortController()
  document.addEventListener("keydown", (event) => {
    routeMarkdownUndo(event, () => ({
      undo: () => {
        window.__immediateUndoCalls += 1
        window.__immediateUndoCreated = false
      },
      redo: () => {},
    }))
  }, { capture: true, signal: controller.signal })
  window.__clearImmediateUndoFixture = () => controller.abort()
}
window.__mountOverlapEditFixture = () => {
  document.querySelector("#overlap-edit-fixture")?.remove()
  const host = document.createElement("div")
  host.id = "overlap-edit-fixture"
  host.className = "modular-diary-container"
  host.style.cssText = "width:240px;position:relative;margin-top:12px"
  const overlapDoc = parseTimeline("range: 13-16\\n---\\n13:15-14:45 sleep 看怪奇物语看到一半\\n13:30-14:10 math\\n")
  const overlapHolder = document.createElement("div")
  overlapHolder.innerHTML = renderTimelineSvg(overlapDoc, { typeColors: COLORS, width: 220 })
  host.appendChild(overlapHolder)
  container.appendChild(host)
  window.__overlapEditing = null
  window.__overlapSpans = []
  attachDrawInteraction(host, overlapDoc, {
    hourHeight: 48,
    getActiveType: () => "math",
    getMode: () => "actual",
    typeColor: (type) => COLORS[type] ?? "#bdbdbd",
    onCreate: () => {},
    onBlockMenu: () => {},
    onBlockClick: () => {},
    onTrackMenu: () => {},
    onExtendRange: () => {},
    getEditingLine: () => window.__overlapEditing,
    setEditingLine: (line) => { window.__overlapEditing = line },
    onUpdateSpan: (line, startMin, endMin) => window.__overlapSpans.push({ line, startMin, endMin }),
    onEditNote: () => {},
    onDeleteEntry: () => {},
  })
  window.__enterOverlapEditFromMenu = (line) => {
    window.__overlapEditing = line
    host.querySelector("svg.modular-diary-svg")?.dispatchEvent(new CustomEvent("modular-diary-sync-edit"))
  }
}

window.__mountDuplicateEditingFixture = () => {
  document.querySelectorAll(".modular-diary-svg.is-editing-block").forEach((svg) => {
    svg.dispatchEvent(new CustomEvent("modular-diary-exit-edit"))
  })
  const duplicateDoc = parseTimeline("range: 23-25\\n---\\n23:30-24:00 math\\n")
  const selectedLine = duplicateDoc.entries[0].line
  window.__duplicateEditing = selectedLine
  window.__duplicateCreated = []
  window.__duplicateSpans = []
  window.__duplicateDeleted = []
  for (const owner of ["first", "second"]) {
    const host = document.createElement("div")
    host.id = "duplicate-editing-" + owner
    host.className = "modular-diary-container"
    host.style.cssText = "width:200px;position:relative;margin-top:12px"
    const holder = document.createElement("div")
    holder.innerHTML = renderTimelineSvg(duplicateDoc, { typeColors: COLORS })
    host.appendChild(holder)
    document.body.appendChild(host)
    attachDrawInteraction(host, duplicateDoc, {
      hourHeight: 48,
      getActiveType: () => "math",
      getMode: () => "actual",
      typeColor: (type) => COLORS[type] ?? "#bdbdbd",
      onBlockClick: () => {},
      onTrackMenu: () => {},
      onExtendRange: () => {},
      onEditNote: () => {},
      getEditingLine: () => window.__duplicateEditing,
      setEditingLine: (line) => { window.__duplicateEditing = line },
      onUpdateSpan: (line, startMin, endMin) => window.__duplicateSpans.push({ owner, line, startMin, endMin }),
      onCreate: (line, startMin) => window.__duplicateCreated.push({ owner, line, startMin }),
      onBlockMenu: () => {},
      onDeleteEntry: (line) => window.__duplicateDeleted.push({ owner, line }),
    })
  }
  window.__syncDuplicateOwner = (owner) => {
    window.__duplicateEditing = selectedLine
    document.querySelector("#duplicate-editing-" + owner + " svg.modular-diary-svg")
      ?.dispatchEvent(new CustomEvent("modular-diary-sync-edit"))
  }
}
window.__mountMarkerFixture = () => {
  document.querySelector("#marker-cm-fixture")?.remove()
  const cm = document.createElement("div")
  cm.id = "marker-cm-fixture"
  cm.className = "cm-content"
  cm.contentEditable = "true"
  const embed = document.createElement("div")
  embed.id = "marker-embed-fixture"
  embed.className = "cm-embed-block"
  const host = document.createElement("div")
  host.id = "marker-fixture"
  host.className = "modular-diary-container"
  host.style.cssText = "width:240px;position:relative;margin-top:12px"
  const markerDoc = parseTimeline("range: 7-12\\n---\\n@10:00 [math] 起床\\n@10:00 [fitness] 拉伸\\n")
  const holder = document.createElement("div")
  holder.innerHTML = renderTimelineSvg(markerDoc, { typeColors: COLORS, width: 220 })
  host.appendChild(holder)
  embed.appendChild(host)
  cm.appendChild(embed)
  document.body.appendChild(cm)
  window.__markerEditing = null
  window.__markerTool = "marker"
  window.__markerCreated = []
  window.__markerBlockCreated = []
  window.__markerMoved = []
  window.__markerMenus = []
  window.__markerBlockMenus = []
  window.__markerNotes = []
  window.__markerDeleted = []
  attachMarkerInteraction(host, markerDoc, {
    hourHeight: 48,
    isMarkerTool: () => window.__markerTool === "marker",
    getActiveType: () => "math",
    getMode: () => "actual",
    typeColor: (type) => COLORS[type] ?? "#bdbdbd",
    getEditingLine: () => window.__markerEditing,
    setEditingLine: (line) => { window.__markerEditing = line },
    onCreate: (line, timeMin) => window.__markerCreated.push({ line, timeMin }),
    onMove: (line, timeMin) => window.__markerMoved.push({ line, timeMin }),
    onMenu: (line, x, y) => window.__markerMenus.push({ line, x, y }),
    onEditNote: (line) => window.__markerNotes.push(line),
    onDelete: (line) => window.__markerDeleted.push(line),
  })
  attachDrawInteraction(host, markerDoc, {
    hourHeight: 48,
    getActiveType: () => "math",
    getMode: () => "actual",
    getTool: () => window.__markerTool,
    isInteractionLocked: () => window.__markerEditing !== null,
    typeColor: (type) => COLORS[type] ?? "#bdbdbd",
    onBlockClick: () => {}, onTrackMenu: () => {}, onExtendRange: () => {}, onEditNote: () => {},
    getEditingLine: () => null, setEditingLine: () => {}, onUpdateSpan: () => {},
    onCreate: (line, startMin) => window.__markerBlockCreated.push({ line, startMin }),
    onBlockMenu: () => {}, onDeleteEntry: () => {},
  })
  embed.addEventListener("contextmenu", (event) => {
    const target = event.target
    if (target instanceof Element && !target.closest("button, input, textarea, a, rect, .modular-diary-text-host, .modular-diary-add-menu")) {
      window.__markerBlockMenus.push(target.className?.baseVal ?? target.className ?? target.tagName)
    }
  })
}
`)
await esbuild.build({
  entryPoints: [path.join(out, "entry.ts")],
  bundle: true, format: "iife", logLevel: "silent",
  outfile: path.join(out, "bundle.js"),
})
const css = fs.readFileSync(path.join(here, "../styles.css"), "utf8")
const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body style="margin:0"><div id="app" class="modular-diary-container" style="width:200px;position:relative"></div><script>${fs.readFileSync(path.join(out, "bundle.js"), "utf8")}</script></body></html>`
fs.writeFileSync(path.join(out, "index.html"), html)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 400, height: 1000 } })
page.on("pageerror", (e) => { console.error("pageerror:", e.message); process.exit(1) })
await page.goto("file://" + path.join(out, "index.html"))
const setTheme = async (dark) => page.evaluate((isDark) => {
  const root = document.documentElement.style
  root.setProperty("--background-primary", isDark ? "rgb(30, 30, 30)" : "rgb(245, 245, 245)")
  root.setProperty("--background-secondary", isDark ? "rgb(38, 38, 38)" : "rgb(238, 238, 238)")
  root.setProperty("--background-modifier-hover", isDark ? "rgb(52, 52, 52)" : "rgb(224, 224, 224)")
  root.setProperty("--background-modifier-border", isDark ? "rgb(70, 70, 70)" : "rgb(205, 205, 205)")
  root.setProperty("--text-normal", isDark ? "rgb(225, 225, 225)" : "rgb(32, 32, 32)")
  root.setProperty("--text-muted", isDark ? "rgb(170, 170, 170)" : "rgb(100, 100, 100)")
  root.setProperty("--text-faint", isDark ? "rgb(125, 125, 125)" : "rgb(145, 145, 145)")
  root.setProperty("--text-accent", isDark ? "rgb(166, 126, 255)" : "rgb(127, 85, 255)")
  root.setProperty("--interactive-accent", isDark ? "rgb(166, 126, 255)" : "rgb(127, 85, 255)")
  document.body.style.background = isDark ? "rgb(30, 30, 30)" : "rgb(245, 245, 245)"
  // Obsidian scopes its dark theme with this body class; theme-aware rules
  // (frozen alphas, record fill blending) key off it.
  document.body.classList.toggle("theme-dark", isDark)
}, dark)
await setTheme(false)
await page.waitForSelector("svg.modular-diary-svg")
// Timeline gestures own this surface. Creating, moving, and resizing blocks
// must never leak into Chromium's native text selection (the purple highlight
// that otherwise catches hour labels and block copy mid-drag).
const timelineSelectionContract = await page.evaluate(() => {
  const svg = document.querySelector("svg.modular-diary-svg")
  const target = svg?.querySelector(".modular-diary-duration") ?? svg
  if (!svg || !target) return null
  const selectionStart = new Event("selectstart", { bubbles: true, cancelable: true })
  target.dispatchEvent(selectionStart)
  return {
    userSelect: getComputedStyle(svg).userSelect,
    selectionStartPrevented: selectionStart.defaultPrevented,
  }
})
if (!timelineSelectionContract
    || timelineSelectionContract.userSelect !== "none"
    || !timelineSelectionContract.selectionStartPrevented) {
  console.error("timeline still exposes native text selection during gestures", timelineSelectionContract); process.exit(1)
}
const visualPreviewContract = await page.evaluate(() => window.__exerciseTimelineVisualPreview())
if (
  !visualPreviewContract.noteImmediate.includes("新备注立刻出现")
  || !visualPreviewContract.noteRollback.includes("旧备注")
  || !visualPreviewContract.created.block
  || !visualPreviewContract.created.hatch
  || visualPreviewContract.created.duration !== "1h"
  || !visualPreviewContract.deletedTogether
) {
  console.error("timeline optimistic visual transaction is incomplete", visualPreviewContract); process.exit(1)
}

// Candidate confirmation in a Chinese IME must not be mistaken for the
// normal Enter-to-save command.
await page.evaluate(() => window.__mountNotePopover("", "marker"))
const markerNoteCopy = await page.locator('.modular-diary-note-popover').evaluate((popover) => ({
  ariaLabel: popover.getAttribute("aria-label"),
  placeholder: popover.querySelector("input")?.getAttribute("placeholder"),
}))
await page.locator('.modular-diary-note-popover').screenshot({ path: path.join(out, "marker-note-popover.png") })
await page.locator('.modular-diary-note-popover input').press("Escape")
if (markerNoteCopy.ariaLabel !== "编辑时间点备注" || markerNoteCopy.placeholder !== "这个时间点有什么要记录？") {
  console.error("time-point note editor reused time-span copy", markerNoteCopy); process.exit(1)
}

await page.evaluate(() => window.__mountNotePopover(""))
const composingNote = page.locator('.modular-diary-note-popover input')
await composingNote.evaluate((input) => {
  input.value = "和春枝聊天、看《我的nv"
  input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "nv" }))
  input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "nv", inputType: "insertCompositionText", isComposing: true }))
  input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter", code: "Enter", isComposing: true, keyCode: 229 }))
})
const imeCandidateState = await page.evaluate(() => ({
  open: Boolean(document.querySelector('.modular-diary-note-popover')),
  saves: [...window.__noteSaves],
}))
if (!imeCandidateState.open || imeCandidateState.saves.length !== 0) {
  console.error("IME candidate Enter prematurely finished the note", imeCandidateState); process.exit(1)
}
await composingNote.evaluate((input) => {
  input.value = "和春枝聊天、看《我的女孩》"
  input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "女孩" }))
  input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "女孩", inputType: "insertText" }))
})
await composingNote.press("Enter")
const imeCommitted = await page.evaluate(() => ({ open: Boolean(document.querySelector('.modular-diary-note-popover')), saves: [...window.__noteSaves] }))
if (imeCommitted.open || imeCommitted.saves.at(-1) !== "和春枝聊天、看《我的女孩》") {
  console.error("normal Enter did not save the complete composed note", imeCommitted); process.exit(1)
}

// A Markdown redraw can detach the SVG anchor while the body-mounted editor
// remains active. The next scroll must commit the complete draft rather than
// removing the editor behind the save lifecycle.
await page.evaluate(() => window.__mountNotePopover("旧备注"))
await page.locator('.modular-diary-note-popover input').fill("重渲染前已经输入完整的第五句")
await page.evaluate(() => {
  document.querySelector("#note-anchor")?.remove()
  window.dispatchEvent(new Event("scroll"))
})
await page.waitForTimeout(40)
const detachedAnchorState = await page.evaluate(() => ({
  open: Boolean(document.querySelector('.modular-diary-note-popover')),
  saves: [...window.__noteSaves],
}))
if (detachedAnchorState.open || detachedAnchorState.saves.at(-1) !== "重渲染前已经输入完整的第五句") {
  console.error("detached note anchor discarded the active draft", detachedAnchorState); process.exit(1)
}

// A failed Markdown write must not dismiss the only copy of the draft. The
// same editor remains retryable and closes only after persistence succeeds.
await page.evaluate(() => window.__mountFailingNotePopover("旧值"))
const retryingNote = page.locator('.modular-diary-note-popover input')
await retryingNote.fill("不能丢失的备注")
await retryingNote.press("Enter")
await page.waitForTimeout(20)
const failedSaveState = await page.evaluate(() => {
  const input = document.querySelector('.modular-diary-note-popover input')
  return { open: Boolean(input), disabled: input?.disabled, value: input?.value, failures: window.__noteFailures }
})
if (!failedSaveState.open || failedSaveState.disabled || failedSaveState.value !== "不能丢失的备注" || failedSaveState.failures !== 1) {
  console.error("failed note persistence dismissed or damaged its draft", failedSaveState); process.exit(1)
}
await retryingNote.press("Enter")
await page.waitForTimeout(20)
const retriedSaveState = await page.evaluate(() => ({
  open: Boolean(document.querySelector('.modular-diary-note-popover')),
  saved: window.__noteSaves.at(-1),
  failures: window.__noteFailures,
}))
if (retriedSaveState.open || retriedSaveState.saved !== "不能丢失的备注" || retriedSaveState.failures !== 2) {
  console.error("retrying note persistence did not complete cleanly", retriedSaveState); process.exit(1)
}

await page.locator(".modular-diary-toolbar").first().screenshot({ path: path.join(out, "toolbar-with-marker-tool.png") })

const box = await page.locator("svg.modular-diary-svg").boundingBox()
// geometry: hourHeight 48, rangeStart 420 (7:00), PAD_TOP 26, LABEL_W 36, TRACK_PAD 6
const yFor = (min) => box.y + 26 + ((min - 420) / 60) * 48
const trackCX = box.x + 36 + (200 - 36 - 6) / 2
const cursorAt = (x, y) => page.evaluate(({ x: px, y: py }) => {
  const target = document.elementFromPoint(px, py)
  return target ? getComputedStyle(target).cursor : ""
}, { x, y })

const snap5 = (min) => Math.round(min / 5) * 5
const clock = (min) => {
  const wrapped = ((min % (24 * 60)) + 24 * 60) % (24 * 60)
  return String(Math.floor(wrapped / 60)).padStart(2, "0") + ":" + String(wrapped % 60).padStart(2, "0")
}

async function assertLiveSpan(fromMin, toMin, { short = false, screenshot = "", creation = false } = {}) {
  const expectedMinutes = [snap5(fromMin), snap5(toMin)].sort((a, b) => a - b)
  const state = await page.evaluate(() => {
    const labels = [...document.querySelectorAll(".modular-diary-span-preview-label")].map((label) => ({
      text: label.querySelector(".modular-diary-span-preview-label-text")?.textContent,
      minute: Number(label.dataset.minute),
      edgeY: Number(label.dataset.edgeY),
      labelY: Number(label.dataset.labelY),
      leaderCount: label.querySelectorAll(".modular-diary-span-preview-leader").length,
    }))
    return {
      labels,
      status: document.querySelector(".modular-diary-draw-status")?.textContent ?? "",
      liveDuration: (() => {
        const node = Array.from(document.querySelectorAll(".modular-diary-preview-duration.is-dragging")).at(-1)
        return node ? {
          copy: node.textContent ?? "",
          visibility: getComputedStyle(node).visibility,
        } : null
      })(),
    }
  })
  const expectedText = expectedMinutes.map(clock)
  if (JSON.stringify(state.labels.map((label) => label.text)) !== JSON.stringify(expectedText) ||
      JSON.stringify(state.labels.map((label) => label.minute)) !== JSON.stringify(expectedMinutes) ||
      state.status.trim() !== "") {
    console.error("live boundary labels mismatch", { state, expectedText, expectedMinutes }); process.exit(1)
  }
  if (creation && (!state.liveDuration || state.liveDuration.visibility !== "hidden")) {
    console.error("creation drag exposed fixed-size duration copy inside its provisional block", state); process.exit(1)
  }
  const edgeGap = state.labels[1].edgeY - state.labels[0].edgeY
  const labelGap = state.labels[1].labelY - state.labels[0].labelY
  if (short) {
    if (edgeGap >= 8 || labelGap < 15 || state.labels.every((label) => label.leaderCount === 0)) {
      console.error("short-span labels did not separate while preserving true edges", { state, edgeGap, labelGap }); process.exit(1)
    }
  } else if (state.labels.some((label) => Math.abs(label.labelY - label.edgeY) > 0.5 || label.leaderCount !== 0)) {
    console.error("normal-span labels drifted from their edges", state); process.exit(1)
  }
  if (screenshot) await page.locator("svg.modular-diary-svg").screenshot({ path: path.join(out, screenshot) })
}

async function drag(fromMin, toMin, preview = null) {
  await page.evaluate(() => window.getSelection()?.removeAllRanges())
  await page.mouse.move(trackCX, yFor(fromMin))
  await page.mouse.down()
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(trackCX, yFor(fromMin + ((toMin - fromMin) * i) / 6))
  }
  if (preview) await assertLiveSpan(fromMin, toMin, { ...preview, creation: true })
  await page.mouse.up()
  if (await page.locator(".modular-diary-span-preview-labels").count() !== 0) {
    console.error("live boundary labels survived pointerup"); process.exit(1)
  }
  const nativeSelection = await page.evaluate(() => ({
    collapsed: window.getSelection()?.isCollapsed ?? true,
    copy: window.getSelection()?.toString() ?? "",
  }))
  if (!nativeSelection.collapsed || nativeSelection.copy !== "") {
    console.error("timeline drag leaked into native text selection", nativeSelection); process.exit(1)
  }
}

// 1. creation snaps independently to a 5-minute grid (10:07 -> 11:32 becomes 10:05 -> 11:30)
await drag(607, 692, { screenshot: "live-span-normal.png" })
const optimisticActualVisual = await page.evaluate(() => ({
  blocks: document.querySelectorAll(".modular-diary-preview-block").length,
  durations: [...document.querySelectorAll(".modular-diary-preview-duration")].map((node) => node.textContent),
}))
if (optimisticActualVisual.blocks < 1 || optimisticActualVisual.durations.at(-1) !== "1.42h") {
  console.error("optimistic actual block was only a rectangle instead of a complete visual", optimisticActualVisual); process.exit(1)
}
// 1a. The precision hint stays quiet and close to the drag. Option/Alt can be
// pressed after pointer-down and re-snaps both edges to exact minutes.
await page.mouse.move(trackCX, yFor(617))
await page.mouse.down()
await page.mouse.move(trackCX, yFor(622), { steps: 3 })
const quietHint = await page.evaluate(() => {
  const group = document.querySelector(".modular-diary-precision-hint")
  const text = group?.querySelector(".modular-diary-precision-hint-text")
  return {
    count: document.querySelectorAll(".modular-diary-precision-hint").length,
    copy: text?.textContent ?? "",
    opacity: text ? Number(getComputedStyle(text).opacity) : 1,
    fill: text ? getComputedStyle(text).fill : "",
  }
})
if (quietHint.count !== 1 || !quietHint.copy.includes("精确创建") || quietHint.opacity > 0.65 || quietHint.fill !== "rgb(100, 100, 100)") {
  console.error("precision hint is missing or visually too loud", quietHint); process.exit(1)
}
await page.locator("svg.modular-diary-svg").screenshot({ path: path.join(out, "precision-hint-light.png") })
await setTheme(true)
await page.keyboard.down("Alt")
await page.mouse.move(trackCX, yFor(623), { steps: 2 })
const preciseDrag = await page.evaluate(() => ({
  active: document.querySelector(".modular-diary-precision-hint")?.classList.contains("is-active") ?? false,
  copy: document.querySelector(".modular-diary-precision-hint-text")?.textContent ?? "",
  opacity: Number(getComputedStyle(document.querySelector(".modular-diary-precision-hint-text")).opacity),
  minutes: [...document.querySelectorAll(".modular-diary-span-preview-label")].map((label) => Number(label.dataset.minute)),
}))
if (!preciseDrag.active || !preciseDrag.copy.includes("1 分钟") || preciseDrag.opacity > 0.8 || JSON.stringify(preciseDrag.minutes) !== JSON.stringify([617, 623])) {
  console.error("mid-drag precision mode did not re-snap the whole span", preciseDrag); process.exit(1)
}
await page.locator("svg.modular-diary-svg").screenshot({ path: path.join(out, "precision-hint-dark-active.png") })
await page.mouse.up()
await page.keyboard.up("Alt")
await setTheme(false)
if (await page.locator(".modular-diary-precision-hint").count() !== 0) {
  console.error("precision hint survived pointerup"); process.exit(1)
}
// 2. drag up 14:00 -> 12:30 also works
await drag(840, 750)
const optimistic = await page.evaluate(() => document.querySelectorAll(".modular-diary-preview-block").length)
if (optimistic < 2) { console.error("no optimistic preview blocks", optimistic); process.exit(1) }
// A newly committed block remains optimistic until the Markdown renderer
// remounts. Its copy must already use the exact canonical text treatment;
// otherwise users see a muted/overlay label that changes only after redraw.
const optimisticTextStyle = await page.evaluate(() => {
  const preview = Array.from(document.querySelectorAll("text.modular-diary-preview-duration")).at(-1)
  const canonical = document.querySelector('text.modular-diary-duration[data-line="3"]')
  if (!preview || !canonical) return null
  const previewStyle = getComputedStyle(preview)
  const canonicalStyle = getComputedStyle(canonical)
  return {
    preview: {
      fill: previewStyle.fill,
      opacity: previewStyle.opacity,
      fontWeight: previewStyle.fontWeight,
      frozen: preview.classList.contains("is-frozen"),
    },
    canonical: {
      fill: canonicalStyle.fill,
      opacity: canonicalStyle.opacity,
      fontWeight: canonicalStyle.fontWeight,
    },
  }
})
if (!optimisticTextStyle
  || JSON.stringify(optimisticTextStyle.preview) !== JSON.stringify({
    ...optimisticTextStyle.canonical,
    frozen: false,
  })) {
  console.error("new block copy did not match its canonical visual", optimisticTextStyle); process.exit(1)
}
// 3. overlapping the sleep block (07:00-08:00) is now allowed (并列日程)
await drag(450, 510)
// 3a. The exact 07:00 line belongs to block creation. Range extension is only
// available in the separate outside click lane.
await page.mouse.move(trackCX, yFor(420))
const topBoundaryCursor = await cursorAt(trackCX, yFor(420))
if (topBoundaryCursor !== "crosshair") {
  console.error("top boundary did not keep the creation cursor", topBoundaryCursor); process.exit(1)
}
await page.mouse.down()
await page.mouse.move(trackCX, yFor(450), { steps: 5 })
await assertLiveSpan(420, 450, { screenshot: "exact-top-boundary-create.png", creation: true })
await page.mouse.up()
// 3b. A five-minute block keeps both exact labels readable. Their copy may
// separate, but the ticks remain on the true four-pixel-apart boundaries.
await setTheme(true)
await drag(1140, 1147, { short: true, screenshot: "live-span-five-minute.png" })
await setTheme(false)
// 4. right-click the sleep block fires menu with line 0
await page.mouse.click(trackCX, yFor(450), { button: "right" })

// 5. plan mode: drag creates a plan-prefixed entry
const initialPlanMode = await page.evaluate(() => ({
  label: document.querySelector('.modular-diary-plan-mode-label')?.textContent,
  checked: document.querySelector('.modular-diary-plan-mode-toggle')?.getAttribute("aria-checked"),
}))
if (initialPlanMode.label !== "计划模式" || initialPlanMode.checked !== "false") {
  console.error("plan mode did not keep a fixed label in its default off state", initialPlanMode); process.exit(1)
}
await page.locator('.modular-diary-plan-mode-toggle').click()
await drag(900, 960) // 15:00-16:00 in plan mode
const optimisticPlanVisual = await page.evaluate(() => ({
  blocks: document.querySelectorAll(".modular-diary-preview-block.is-plan").length,
  hatches: document.querySelectorAll(".modular-diary-preview-hatch").length,
  durations: [...document.querySelectorAll(".modular-diary-preview-duration.is-plan")].map((node) => node.textContent),
}))
if (optimisticPlanVisual.blocks < 1 || optimisticPlanVisual.hatches < 1 || optimisticPlanVisual.durations.at(-1) !== "1h") {
  console.error("optimistic plan block did not paint fill, hatch and duration together", optimisticPlanVisual); process.exit(1)
}
// A plan span is one visual object during edge resize too: translucent fill,
// hatch, border and copy must share the new geometry before pointerup.
await page.evaluate(() => {
  window.__editing = 2
  document.querySelector("#app svg.modular-diary-svg")?.dispatchEvent(new CustomEvent("modular-diary-sync-edit"))
})
const planBottomEdge = page.locator('#app rect.modular-diary-edit-edge[data-edge="bottom"]')
await planBottomEdge.scrollIntoViewIfNeeded()
const planBottomBox = await planBottomEdge.boundingBox()
if (!planBottomBox) { console.error("plan resize handle missing"); process.exit(1) }
const planVisualState = () => page.evaluate(() => {
  const host = document.querySelector("#app")
  const block = host.querySelector('rect.modular-diary-plan[data-line="2"]')
  const hatch = host.querySelector('rect.modular-diary-plan-hatch[data-line="2"]')
  const labels = Array.from(host.querySelectorAll('text[data-line="2"]'))
  const blockBox = block.getBoundingClientRect()
  const labelBoxes = labels.map((label) => label.getBoundingClientRect())
  return {
    blockY: Number(block.getAttribute("y")),
    blockH: Number(block.getAttribute("height")),
    hatchY: Number(hatch.getAttribute("y")),
    hatchH: Number(hatch.getAttribute("height")),
    blockCenter: blockBox.top + blockBox.height / 2,
    labelCenter: (Math.min(...labelBoxes.map((box) => box.top)) + Math.max(...labelBoxes.map((box) => box.bottom))) / 2,
    duration: host.querySelector('text.modular-diary-duration[data-line="2"]')?.textContent,
  }
})
const planBeforeResize = await planVisualState()
await page.mouse.move(planBottomBox.x + planBottomBox.width / 2, planBottomBox.y + planBottomBox.height / 2)
await page.mouse.down()
await page.mouse.move(planBottomBox.x + planBottomBox.width / 2, planBottomBox.y + planBottomBox.height / 2 + 24, { steps: 4 })
const planDuringResize = await planVisualState()
await page.locator("#app svg.modular-diary-svg").screenshot({ path: path.join(out, "plan-live-resize.png") })
const planBeforeInset = planBeforeResize.labelCenter - planBeforeResize.blockCenter
const planDuringInset = planDuringResize.labelCenter - planDuringResize.blockCenter
if (
  planDuringResize.blockH <= planBeforeResize.blockH
  || planDuringResize.hatchY !== planDuringResize.blockY
  || planDuringResize.hatchH !== planDuringResize.blockH
  || Math.abs(planDuringInset - planBeforeInset) > 0.5
  || planDuringResize.duration === planBeforeResize.duration
) {
  const planResizeDebug = await page.evaluate(({ x, y }) => ({
    editing: window.__editing,
    spans: window.__span,
    hit: document.elementFromPoint(x, y)?.outerHTML,
    edges: Array.from(document.querySelectorAll("#app rect.modular-diary-edit-edge"), (edge) => edge.outerHTML),
  }), { x: planBottomBox.x + planBottomBox.width / 2, y: planBottomBox.y + planBottomBox.height / 2 })
  console.error("plan resize painted fill, hatch, border or copy in different frames", {
    planBeforeResize, planDuringResize, planBeforeInset, planDuringInset, planResizeDebug,
  }); process.exit(1)
}
await setTheme(true)
const darkPlanSelection = await page.evaluate(() => {
  const block = document.querySelector('rect.modular-diary-plan[data-line="2"]')
  const style = getComputedStyle(block)
  return {
    accentStroke: getComputedStyle(document.documentElement).getPropertyValue("--text-accent").trim(),
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
    strokeOpacity: style.strokeOpacity,
    visibleEdgeLines: document.querySelectorAll("line.modular-diary-edit-edge-line").length,
  }
})
await page.locator("#app svg.modular-diary-svg").screenshot({ path: path.join(out, "plan-selected-border-dark.png") })
if (
  darkPlanSelection.stroke !== darkPlanSelection.accentStroke
  || darkPlanSelection.strokeWidth !== "2px"
  || darkPlanSelection.strokeOpacity !== "1"
  || darkPlanSelection.visibleEdgeLines !== 0
) {
  console.error("dark plan selection did not own one uniform four-sided frame", darkPlanSelection); process.exit(1)
}
await setTheme(false)
await page.mouse.up()
await page.evaluate(() => {
  window.__editing = null
  document.querySelector("#app svg.modular-diary-svg")?.dispatchEvent(new CustomEvent("modular-diary-sync-edit-visual"))
})

// 5-tool. Shape is an explicit tool state; the pressed affordance must match
// the callback instead of relying on an ambiguous icon.
await page.locator('.modular-diary-tool-toggle .modular-diary-mode-btn[data-tool="marker"]').click()
const toolState = await page.evaluate(() => ({
  tool: window.__tool,
  labels: [...document.querySelectorAll('.modular-diary-tool-toggle .modular-diary-mode-btn')].map((button) => button.textContent?.trim()),
  ariaLabels: [...document.querySelectorAll('.modular-diary-tool-toggle .modular-diary-mode-btn')].map((button) => button.getAttribute("aria-label")),
  planSwitchRole: document.querySelector('.modular-diary-plan-mode-toggle')?.getAttribute("role"),
  planSwitchChecked: document.querySelector('.modular-diary-plan-mode-toggle')?.getAttribute("aria-checked"),
  visibleMode: document.querySelector('.modular-diary-plan-mode-label')?.textContent,
  redundantCurrentCopy: document.querySelectorAll('.modular-diary-plan-mode-current').length,
  duplicateModeButtons: document.querySelectorAll('.modular-diary-brush-toggle .modular-diary-mode-btn').length,
  markerPressed: document.querySelector('.modular-diary-tool-toggle [data-tool="marker"]')?.getAttribute("aria-pressed"),
  spanPressed: document.querySelector('.modular-diary-tool-toggle [data-tool="span"]')?.getAttribute("aria-pressed"),
  categoryMarks: [...document.querySelectorAll('.modular-diary-toolbar:first-of-type .modular-diary-swatch[data-type] .modular-diary-swatch-dot')].map((mark) => ({
    type: mark.closest('.modular-diary-swatch')?.dataset.type,
    marker: mark.classList.contains("is-marker"),
    plan: mark.classList.contains("is-plan"),
    tool: mark.dataset.tool,
    mode: mark.dataset.mode,
    backgroundImage: getComputedStyle(mark).backgroundImage,
  })),
}))
if (
  toolState.tool !== "marker" ||
  JSON.stringify(toolState.labels) !== JSON.stringify(["时间段", "时间点"]) ||
  JSON.stringify(toolState.ariaLabels) !== JSON.stringify(["使用时间段工具", "使用时间点工具"]) ||
  toolState.planSwitchRole !== "switch" ||
  toolState.planSwitchChecked !== "true" ||
  toolState.visibleMode !== "计划模式" ||
  toolState.redundantCurrentCopy !== 0 ||
  toolState.duplicateModeButtons !== 0 ||
  toolState.markerPressed !== "true" ||
  toolState.spanPressed !== "false" ||
  toolState.categoryMarks.length !== 1 || toolState.categoryMarks[0]?.type !== "deadline" ||
  toolState.categoryMarks.some((mark) => !mark.marker || !mark.plan || mark.tool !== "marker" || mark.mode !== "plan" || !mark.backgroundImage.includes("repeating-linear-gradient"))
) {
  console.error("timeline draw tool toggle regressed", toolState); process.exit(1)
}
await setTheme(false)
await page.locator(".modular-diary-toolbar").first().screenshot({ path: path.join(out, "toolbar-marker-plan-light.png") })
await setTheme(true)
await page.locator(".modular-diary-toolbar").first().screenshot({ path: path.join(out, "toolbar-marker-plan-dark.png") })
await setTheme(false)

// Programmatic state synchronization is used when another view changes the
// active tool. It must update the category symbols just like a direct click.
const syncedActualMarker = await page.evaluate(() => {
  window.__setToolbarState("actual", "marker")
  return [...document.querySelectorAll('.modular-diary-toolbar:first-of-type .modular-diary-swatch[data-type] .modular-diary-swatch-dot')].map((mark) => ({
    marker: mark.classList.contains("is-marker"),
    plan: mark.classList.contains("is-plan"),
    tool: mark.dataset.tool,
    mode: mark.dataset.mode,
    backgroundImage: getComputedStyle(mark).backgroundImage,
  }))
})
if (syncedActualMarker.some((mark) => !mark.marker || mark.plan || mark.tool !== "marker" || mark.mode !== "actual" || mark.backgroundImage.includes("repeating-linear-gradient"))) {
  console.error("programmatic actual-marker symbol sync regressed", syncedActualMarker); process.exit(1)
}
await page.locator(".modular-diary-toolbar").first().screenshot({ path: path.join(out, "toolbar-marker-actual-light.png") })

// The restoration menu is rendered outside the toolbar, so its symbols must
// be stamped with the current semantic state instead of relying on ancestry.
await page.locator(".modular-diary-add").click()
const hiddenMarker = await page.locator('.modular-diary-add-menu .modular-diary-add-item:has-text("wake") .modular-diary-swatch-dot').evaluate((mark) => ({
  marker: mark.classList.contains("is-marker"),
  plan: mark.classList.contains("is-plan"),
  tool: mark.dataset.tool,
  mode: mark.dataset.mode,
}))
if (!hiddenMarker.marker || hiddenMarker.plan || hiddenMarker.tool !== "marker" || hiddenMarker.mode !== "actual") {
  console.error("hidden-category marker symbol did not inherit current state", hiddenMarker); process.exit(1)
}
await page.keyboard.press("Escape")
await page.locator('.modular-diary-tool-toggle .modular-diary-mode-btn[data-tool="span"]').click()

// 5a. no visible highlighter: blank track cannot invent a hidden "misc" block.
const createdBeforeDisabledDraw = await page.evaluate(() => {
  window.__active = ""
  return window.__created.length
})
await drag(1200, 1260)
const disabledDrawState = await page.evaluate(() => ({
  created: window.__created.length,
  cursor: document.querySelector("svg.modular-diary-svg").style.cursor,
}))
if (disabledDrawState.created !== createdBeforeDisabledDraw || disabledDrawState.cursor !== "default") {
  console.error("drawing without a visible highlighter was not disabled", disabledDrawState); process.exit(1)
}
await page.evaluate(() => { window.__active = "math" })

// 5b. A rejected source mutation must remove the provisional shell. The
// renderer may optimistically promote the ghost while the editor/save path is
// pending, but a failed commit must never leave a block that only exists on
// screen and disappears after restart.
const failedCreateBefore = await page.evaluate(() => ({
  previewCount: document.querySelectorAll(".modular-diary-preview-block").length,
  errorCount: window.__mutationErrors.length,
  createdCount: window.__created.length,
}))
await page.evaluate(() => { window.__rejectNextCreate = true })
await drag(1320, 1350)
await page.waitForTimeout(20)
const failedCreateAfter = await page.evaluate(() => ({
  previewCount: document.querySelectorAll(".modular-diary-preview-block").length,
  errorCount: window.__mutationErrors.length,
  createdCount: window.__created.length,
  lastError: window.__mutationErrors.at(-1),
}))
if (
  failedCreateAfter.previewCount !== failedCreateBefore.previewCount
  || failedCreateAfter.createdCount !== failedCreateBefore.createdCount
  || failedCreateAfter.errorCount !== failedCreateBefore.errorCount + 1
  || !failedCreateAfter.lastError?.includes("synthetic persistence failure")
) {
  console.error("failed timeline mutation left a source-less optimistic block", {
    failedCreateBefore, failedCreateAfter,
  }); process.exit(1)
}

await page.mouse.move(trackCX, yFor(455))
await page.waitForSelector(".modular-diary-tooltip", { state: "visible" })
const tooltipText = await page.locator(".modular-diary-tooltip").innerText()
if (!tooltipText.includes("07:00") || !tooltipText.includes("1h") || !tooltipText.includes("sleep")) {
  console.error("tooltip mismatch:", tooltipText); process.exit(1)
}
// The tooltip sits above-left of the pointer so it never covers the lane
// label to the right of the hovered object.
const tooltipPlacement = await page.evaluate(() => {
  const tooltip = document.querySelector(".modular-diary-tooltip").getBoundingClientRect()
  const lane = document.querySelector("svg.modular-diary-svg g.modular-diary-side-lane").getBoundingClientRect()
  return { tooltipRight: tooltip.right, laneLeft: lane.left, tooltipBottom: tooltip.bottom }
})
if (tooltipPlacement.tooltipRight > tooltipPlacement.laneLeft || tooltipPlacement.tooltipBottom > yFor(455)) {
  console.error("tooltip covered the lane or the pointer", tooltipPlacement); process.exit(1)
}
await page.evaluate(() => window.__mountAfterMidnightHover())
const overnightBlock = page.locator("#after-midnight-hover rect.modular-diary-block")
const overnightBox = await overnightBlock.boundingBox()
if (!overnightBox) { console.error("after-midnight block missing"); process.exit(1) }
await overnightBlock.dispatchEvent("pointerover", { pointerType: "mouse" })
await page.waitForSelector("#after-midnight-hover .modular-diary-tooltip", { state: "visible" })
const overnightTooltip = await page.locator("#after-midnight-hover .modular-diary-tooltip").innerText()
if (!overnightTooltip.includes("次日 02:30 – 03:15") || overnightTooltip.includes("26:30") || overnightTooltip.includes("27:15")) {
  console.error("after-midnight tooltip leaked monotonic coordinates:", overnightTooltip); process.exit(1)
}
// A block that already shows its note inline gets only the exact times and
// duration; the type and note are not repeated under the pointer.
const inlineNoteTooltip = await page.evaluate(() => {
  const lines = [...document.querySelector("#after-midnight-hover .modular-diary-tooltip").children].map((node) => node.textContent)
  const inline = Boolean(document.querySelector('#after-midnight-hover text.modular-diary-note:not(.modular-diary-side), #after-midnight-hover text.modular-diary-duration:not(.modular-diary-thin)'))
  return { lines, inline }
})
if (!inlineNoteTooltip.inline || inlineNoteTooltip.lines.length !== 1 || inlineNoteTooltip.lines[0] !== overnightTooltip.trim()) {
  console.error("tooltip repeated copy that is already inside the block", inlineNoteTooltip); process.exit(1)
}
await page.locator("#after-midnight-hover .modular-diary-tooltip").screenshot({ path: path.join(out, "after-midnight-tooltip.png") })
await page.locator("#after-midnight-hover").evaluate((element) => element.remove())
const hoverCount = await page.evaluate(() => document.querySelectorAll(".is-hover").length)
if (hoverCount < 1) { console.error("no hover pairing"); process.exit(1) }

// 5d. The visible boundary belongs to creation. The painted controls outside
// the track are the only one-hour range targets: their visible boxes, pointer
// cursor and hit areas must coincide.
{
  const yBottom = yFor(23 * 60)
  await page.mouse.move(trackCX, yBottom)
  const bottomBoundaryCursor = await page.evaluate(() => document.querySelector("svg.modular-diary-svg").style.cursor)
  if (bottomBoundaryCursor !== "crosshair") {
    console.error("bottom boundary did not keep the creation cursor", bottomBoundaryCursor); process.exit(1)
  }
  const bottomPlus = page.locator('svg.modular-diary-svg .modular-diary-range-step-button[data-edge="bottom"][data-action="extend"]')
  await bottomPlus.hover()
  const outsideState = await bottomPlus.evaluate((button) => {
    const controls = button.closest(".modular-diary-range-step-controls")
    const background = button.querySelector(".modular-diary-range-step-button-bg")
    const text = button.querySelector(".modular-diary-range-step-button-text")
    const box = button.getBBox()
    const svg = button.closest("svg")
    const point = svg.createSVGPoint()
    point.x = box.x + box.width / 2
    point.y = box.y + box.height / 2
    const screenPoint = point.matrixTransform(svg.getScreenCTM())
    return {
      cursor: getComputedStyle(button).cursor,
      hint: text?.textContent ?? "",
      aria: button.getAttribute("aria-label"),
      controlsOpacity: getComputedStyle(controls).opacity,
      hitMatches: button.contains(document.elementFromPoint(screenPoint.x, screenPoint.y)),
      bbox: { x: box.x, y: box.y, width: box.width, height: box.height },
      background: background ? {
        x: background.getAttribute("x"), y: background.getAttribute("y"),
        width: background.getAttribute("width"), height: background.getAttribute("height"),
        fill: getComputedStyle(background).fill,
      } : null,
      text: text ? { x: text.getAttribute("x"), y: text.getAttribute("y"), fill: getComputedStyle(text).fill } : null,
    }
  })
  if (outsideState.cursor !== "pointer" || outsideState.hint !== "＋1 小时"
    || outsideState.aria !== "点击向后延长 1 小时" || outsideState.controlsOpacity !== "1"
    || !outsideState.hitMatches || outsideState.bbox?.height !== 18 || (outsideState.bbox?.width ?? 0) < 40
    || outsideState.background?.fill === "none" || outsideState.background?.fill === "rgba(0, 0, 0, 0)"
    || outsideState.text?.fill === "none" || outsideState.text?.fill === "rgba(0, 0, 0, 0)") {
    console.error("outer extension button was not a concrete hit target", outsideState); process.exit(1)
  }
  const protectedTopContract = await page.locator('svg.modular-diary-svg .modular-diary-range-step-button[data-edge="top"][data-action="contract"]').first().getAttribute("aria-disabled")
  if (protectedTopContract !== "true") {
    console.error("range contraction could hide an entry at the first visible hour", protectedTopContract); process.exit(1)
  }
  await page.screenshot({
    path: path.join(out, "one-hour-extension-context.png"),
    clip: { x: box.x, y: box.y, width: box.width, height: box.height },
  })
}

// 5e. Selecting an actual record must not reveal the lower plan hatch. Then
// prove resize and move share the same canonical 5-minute grid as creation.
await page.mouse.click(trackCX, yFor(450))
const editLayerState = await page.evaluate(() => {
  const frozenActual = document.querySelector('rect.modular-diary-block[data-line="1"]')
  const planHatch = document.querySelector('rect.modular-diary-plan-hatch[data-line="2"]')
  const frozenMarker = document.querySelector('g.modular-diary-marker[data-line="4"]')
  const frozenMarkerLabel = document.querySelector('text.modular-diary-marker-label[data-line="4"]')
  const frozenMarkerLabelBg = document.querySelector('rect.modular-diary-marker-label-bg[data-line="4"]')
  const selectedActual = document.querySelector('rect.modular-diary-block[data-line="0"]')
  const selectedStyle = getComputedStyle(selectedActual)
  return {
    accentStroke: getComputedStyle(document.documentElement).getPropertyValue("--text-accent").trim(),
    selectedFillOpacity: getComputedStyle(selectedActual).fillOpacity,
    selectedStroke: selectedStyle.stroke,
    selectedStrokeWidth: selectedStyle.strokeWidth,
    visibleEdgeLines: document.querySelectorAll("line.modular-diary-edit-edge-line").length,
    frozenActualOpacity: getComputedStyle(frozenActual).opacity,
    planHatchOpacity: getComputedStyle(planHatch).opacity,
    frozenMarker: frozenMarker?.classList.contains("is-frozen") ?? false,
    frozenMarkerOpacity: frozenMarker ? getComputedStyle(frozenMarker).opacity : "missing",
    frozenMarkerFilter: frozenMarker ? getComputedStyle(frozenMarker).filter : "missing",
    frozenMarkerLabelOpacity: frozenMarkerLabel ? getComputedStyle(frozenMarkerLabel).opacity : "missing",
    frozenMarkerLabelBgOpacity: frozenMarkerLabelBg ? getComputedStyle(frozenMarkerLabelBg).opacity : "missing",
    edgeHandles: Array.from(document.querySelectorAll("rect.modular-diary-edit-edge"), (edge) => ({
      edge: edge.dataset.edge,
      line: Number(edge.dataset.line),
      cursor: getComputedStyle(edge).cursor,
      pointerEvents: getComputedStyle(edge).pointerEvents,
    })),
  }
})
if (
  editLayerState.selectedFillOpacity !== "0.95"
  || editLayerState.selectedStroke !== editLayerState.accentStroke
  || editLayerState.selectedStrokeWidth !== "2px"
  || editLayerState.visibleEdgeLines !== 0
  || editLayerState.frozenActualOpacity !== "0.3"
  || editLayerState.planHatchOpacity !== "0.3"
  || !editLayerState.frozenMarker
  || editLayerState.frozenMarkerOpacity !== "0.16"
  || editLayerState.frozenMarkerFilter !== "grayscale(0.65)"
  || editLayerState.frozenMarkerLabelOpacity !== "0.6"
  || editLayerState.frozenMarkerLabelBgOpacity !== "0.3"
  || JSON.stringify(editLayerState.edgeHandles) !== JSON.stringify([
    { edge: "top", line: 0, cursor: "ns-resize", pointerEvents: "all" },
    { edge: "bottom", line: 0, cursor: "ns-resize", pointerEvents: "all" },
  ])
) {
  console.error("edit compositing exposed the plan above records", editLayerState); process.exit(1)
}
await page.locator("svg.modular-diary-svg").screenshot({ path: path.join(out, "record-above-plan-edit-state.png") })
await setTheme(true)
const darkFrozenMarkerState = await page.evaluate(() => ({
  marker: getComputedStyle(document.querySelector('g.modular-diary-marker[data-line="4"]')).opacity,
  markerFilter: getComputedStyle(document.querySelector('g.modular-diary-marker[data-line="4"]')).filter,
  label: getComputedStyle(document.querySelector('text.modular-diary-marker-label[data-line="4"]')).opacity,
  labelBg: getComputedStyle(document.querySelector('rect.modular-diary-marker-label-bg[data-line="4"]')).opacity,
}))
// Dark pages freeze fills at 45% and copy at 80%; strokes keep their alpha.
if (JSON.stringify(darkFrozenMarkerState) !== JSON.stringify({ marker: "0.16", markerFilter: "grayscale(0.65)", label: "0.8", labelBg: "0.45" })) {
  console.error("dark-theme time point did not share the selected-span freeze layer", darkFrozenMarkerState); process.exit(1)
}
await page.locator("svg.modular-diary-svg").screenshot({ path: path.join(out, "record-focus-freezes-time-point-dark.png") })
await setTheme(false)
await page.mouse.move(trackCX, yFor(480) - 2) // 底沿
await page.mouse.down()
await page.mouse.move(trackCX, yFor(547), { steps: 4 }) // 09:07 -> 09:05
await assertLiveSpan(420, 545)
await page.mouse.up()
if (await page.locator(".modular-diary-span-preview-labels").count() !== 0) {
  console.error("resize labels survived pointerup"); process.exit(1)
}
await page.mouse.move(trackCX, yFor(450)) // 中部
await page.mouse.down()
await page.mouse.move(trackCX, yFor(637), { steps: 4 }) // 10:37 -> start 10:05
await assertLiveSpan(605, 665)
await page.mouse.up()
if (await page.locator(".modular-diary-span-preview-labels").count() !== 0) {
  console.error("move labels survived pointerup"); process.exit(1)
}
await page.mouse.move(trackCX, yFor(1200)) // 空白处 -> 退出编辑
await page.mouse.down()
await page.mouse.up()

// 5f. A selected 20-minute block is only ~14 SVG px high. It must retain
// top/bottom resize zones and a distinct move zone instead of falling back to
// move-only behaviour.
const shortEditBlock = page.locator('rect.modular-diary-block[data-line="3"]')
const shortEditBox = await shortEditBlock.boundingBox()
if (!shortEditBox) { console.error("short edit fixture missing"); process.exit(1) }
await page.mouse.click(shortEditBox.x + shortEditBox.width / 2, shortEditBox.y + shortEditBox.height / 2)
const shortCursorAt = async (y) => {
  await page.mouse.move(shortEditBox.x + shortEditBox.width / 2, y)
  return page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y)
    return target ? getComputedStyle(target).cursor : ""
  }, { x: shortEditBox.x + shortEditBox.width / 2, y })
}
const shortTopCursor = await shortCursorAt(shortEditBox.y + 1)
const shortMiddleCursor = await shortCursorAt(shortEditBox.y + shortEditBox.height / 2)
const shortBottomCursor = await shortCursorAt(shortEditBox.y + shortEditBox.height - 1)
if (shortTopCursor !== "ns-resize" || shortMiddleCursor !== "grab" || shortBottomCursor !== "ns-resize") {
  console.error("short block edit zones regressed", { shortTopCursor, shortMiddleCursor, shortBottomCursor, shortEditBox }); process.exit(1)
}
await page.mouse.move(shortEditBox.x + shortEditBox.width / 2, shortEditBox.y + shortEditBox.height - 1)
await page.mouse.down()
await page.mouse.move(trackCX, yFor(830), { steps: 4 }) // 13:50, canonical 5-minute grid
await assertLiveSpan(795, 830)
await page.mouse.up()
await page.locator("svg.modular-diary-svg").screenshot({ path: path.join(out, "short-block-resize-state.png") })
// Selection is scoped to the block, not the timeline. A pointer press anywhere
// outside the selected rect—including outside the whole Modular Diary component—exits.
await page.mouse.click(320, 500)
const outsideExitState = await page.evaluate(() => ({
  editing: window.__editing,
  editingSvgCount: document.querySelectorAll(".modular-diary-svg.is-editing-block").length,
  focusedCount: document.querySelectorAll(".is-focus").length,
}))
if (outsideExitState.editing !== null || outsideExitState.editingSvgCount !== 0 || outsideExitState.focusedCount !== 0) {
  console.error("outside pointer did not clear block focus", outsideExitState); process.exit(1)
}
await page.locator("svg.modular-diary-svg").screenshot({ path: path.join(out, "outside-focus-cleared.png") })

// Deleting the selected block must end focus before the source mutation. In
// Obsidian that mutation can synchronously replace the renderer, so checking
// the callback-time snapshot catches the real stale-focus race.
await page.mouse.click(shortEditBox.x + shortEditBox.width / 2, shortEditBox.y + shortEditBox.height / 2)
const inlineDeleteState = await page.evaluate(() => {
  const input = document.createElement("textarea")
  input.id = "timeline-inline-delete-owner"
  input.value = "abc"
  document.querySelector("#app")?.appendChild(input)
  input.focus()
  input.setSelectionRange(1, 1)
  return { before: input.value, deleted: window.__deleted.length }
})
await page.keyboard.press("Delete")
const inlineDeleteAfter = await page.evaluate(() => ({
  value: document.querySelector("#timeline-inline-delete-owner")?.value ?? "",
  active: document.activeElement?.id ?? "",
  deleted: window.__deleted.length,
  editing: window.__editing,
}))
if (
  inlineDeleteState.before !== "abc"
  || inlineDeleteAfter.value !== "ac"
  || inlineDeleteAfter.active !== "timeline-inline-delete-owner"
  || inlineDeleteAfter.deleted !== 0
  || inlineDeleteAfter.editing !== 3
) {
  console.error("Delete inside an editor was captured by the selected timeline block", { inlineDeleteState, inlineDeleteAfter }); process.exit(1)
}
await page.evaluate(() => document.querySelector("#timeline-inline-delete-owner")?.remove())
// A click on rendered Live Preview chrome leaves focus on CodeMirror's real
// contenteditable root. CodeMirror handles keydown below document capture and
// stops bubbling, so the selected block must own Delete before that handler.
await page.evaluate(() => {
  const cm = document.createElement("div")
  cm.id = "timeline-cm-focus-owner"
  cm.className = "cm-content"
  cm.contentEditable = "true"
  cm.tabIndex = 0
  cm.addEventListener("keydown", (event) => event.stopPropagation())
  document.querySelector("#app")?.appendChild(cm)
  cm.focus()
})
await page.keyboard.press("Delete")
const deleteFocusState = await page.evaluate(() => ({
  deleted: window.__deleted,
  editing: window.__editing,
  editingSvgCount: document.querySelectorAll(".modular-diary-svg.is-editing-block").length,
  frozenCount: document.querySelectorAll(".is-frozen").length,
  focusCount: document.querySelectorAll(".is-focus").length,
}))
if (JSON.stringify(deleteFocusState.deleted) !== JSON.stringify([{
  line: 3,
  editingAtMutation: null,
  editingSvgCount: 0,
  frozenCount: 0,
  focusCount: 0,
}]) || deleteFocusState.editing !== null || deleteFocusState.editingSvgCount !== 0 || deleteFocusState.frozenCount !== 0 || deleteFocusState.focusCount !== 0) {
  console.error("deleting selected block left a dangling focus state", deleteFocusState); process.exit(1)
}
await page.evaluate(() => document.querySelector("#timeline-cm-focus-owner")?.remove())
await page.mouse.move(320, 900)
const deleteRestOpacity = await page.evaluate(() => ({
  blocks: Array.from(document.querySelectorAll(".modular-diary-svg .modular-diary-block"), (el) => getComputedStyle(el).opacity),
  labels: Array.from(document.querySelectorAll(".modular-diary-svg text[data-line]"), (el) => getComputedStyle(el).opacity),
  tooltipVisible: getComputedStyle(document.querySelector(".modular-diary-tooltip")).display !== "none",
}))
if (deleteRestOpacity.blocks.some((value) => value !== "1") || deleteRestOpacity.labels.some((value) => value !== "1") || deleteRestOpacity.tooltipVisible) {
  console.error("deleting selected block left dimmed content", deleteRestOpacity); process.exit(1)
}
await page.locator("svg.modular-diary-svg").screenshot({ path: path.join(out, "delete-focus-cleared.png") })

// 5g. Overlapping actual entries are rendered as narrow side-by-side columns.
// Selection must still create real top/bottom handles matching the selected
// column—not a full-track overlay—and both click and context-menu entry paths
// must activate the exact same edit state.
await page.evaluate(() => window.__mountOverlapEditFixture())
const overlapBlock = page.locator('#overlap-edit-fixture rect.modular-diary-block[data-line="2"]')
await overlapBlock.scrollIntoViewIfNeeded()
const overlapBlockBox = await overlapBlock.boundingBox()
if (!overlapBlockBox) { console.error("overlap edit fixture missing selected column"); process.exit(1) }
const overlapLabelInset = await page.evaluate(() => {
  const host = document.querySelector("#overlap-edit-fixture")
  const block = host.querySelector('rect.modular-diary-block[data-line="2"]')
  const blockBox = block.getBBox()
  const labels = Array.from(host.querySelectorAll('text[data-line="2"]:not(.modular-diary-side)'))
  const boxes = labels.map((label) => label.getBBox())
  return {
    noteLines: labels.filter((label) => label.classList.contains("modular-diary-note")).length,
    leftInset: Math.min(...boxes.map((box) => box.x)) - blockBox.x,
    rightInset: blockBox.x + blockBox.width - Math.max(...boxes.map((box) => box.x + box.width)),
  }
})
if (overlapLabelInset.noteLines < 2 || overlapLabelInset.leftInset < 4 || overlapLabelInset.rightInset < 4) {
  console.error("split-column note did not wrap inside the block padding", overlapLabelInset); process.exit(1)
}
await page.mouse.click(overlapBlockBox.x + overlapBlockBox.width / 2, overlapBlockBox.y + overlapBlockBox.height / 2)
const overlapGeometry = await page.evaluate(() => {
  const host = document.querySelector("#overlap-edit-fixture")
  const block = host.querySelector('rect.modular-diary-block[data-line="2"]')
  const edges = Array.from(host.querySelectorAll("rect.modular-diary-edit-edge"))
  return {
    blockX: Number(block.getAttribute("x")),
    blockWidth: Number(block.getAttribute("width")),
    edges: edges.map((edge) => ({
      edge: edge.dataset.edge,
      x: Number(edge.getAttribute("x")),
      width: Number(edge.getAttribute("width")),
    })),
  }
})
if (
  overlapGeometry.edges.length !== 2
  || overlapGeometry.edges.some((edge) => edge.x !== overlapGeometry.blockX || edge.width !== overlapGeometry.blockWidth)
) {
  console.error("split-column edit handles do not match the selected block", overlapGeometry); process.exit(1)
}
const overlapBottom = page.locator('#overlap-edit-fixture rect.modular-diary-edit-edge[data-edge="bottom"]')
await overlapBottom.scrollIntoViewIfNeeded()
const overlapBottomBox = await overlapBottom.boundingBox()
if (!overlapBottomBox) { console.error("overlap bottom resize handle missing"); process.exit(1) }
const overlapHitBeforeDrag = await page.evaluate(({ x, y }) => {
  const target = document.elementFromPoint(x, y)
  return target ? { tag: target.tagName, cls: target.getAttribute("class"), edge: target.getAttribute("data-edge") } : null
}, { x: overlapBottomBox.x + overlapBottomBox.width / 2, y: overlapBottomBox.y + overlapBottomBox.height / 2 })
if (overlapHitBeforeDrag?.cls !== "modular-diary-edit-edge" || overlapHitBeforeDrag.edge !== "bottom") {
  console.error("split-column bottom handle is not the top hit target", { overlapBottomBox, overlapHitBeforeDrag }); process.exit(1)
}
await page.mouse.move(overlapBottomBox.x + overlapBottomBox.width / 2, overlapBottomBox.y + overlapBottomBox.height / 2)
const overlapResizeVisualBefore = await page.evaluate(() => {
  const host = document.querySelector("#overlap-edit-fixture")
  const block = host.querySelector('rect.modular-diary-block[data-line="2"]')
  const labels = Array.from(host.querySelectorAll('text[data-line="2"]'))
  const blockBox = block.getBoundingClientRect()
  const labelBoxes = labels.map((label) => label.getBoundingClientRect())
  return {
    blockCenter: blockBox.top + blockBox.height / 2,
    labelCenter: (Math.min(...labelBoxes.map((box) => box.top)) + Math.max(...labelBoxes.map((box) => box.bottom))) / 2,
  }
})
await page.mouse.down()
await page.mouse.move(overlapBottomBox.x + overlapBottomBox.width / 2, overlapBottomBox.y + overlapBottomBox.height / 2 + 12, { steps: 3 })
const overlapResizeVisualDuring = await page.evaluate(() => {
  const host = document.querySelector("#overlap-edit-fixture")
  const block = host.querySelector('rect.modular-diary-block[data-line="2"]')
  const labels = Array.from(host.querySelectorAll('text[data-line="2"]'))
  const blockBox = block.getBoundingClientRect()
  const labelBoxes = labels.map((label) => label.getBoundingClientRect())
  return {
    blockCenter: blockBox.top + blockBox.height / 2,
    labelCenter: (Math.min(...labelBoxes.map((box) => box.top)) + Math.max(...labelBoxes.map((box) => box.bottom))) / 2,
  }
})
const beforeCenterInset = overlapResizeVisualBefore.labelCenter - overlapResizeVisualBefore.blockCenter
const duringCenterInset = overlapResizeVisualDuring.labelCenter - overlapResizeVisualDuring.blockCenter
if (Math.abs(duringCenterInset - beforeCenterInset) > 0.5) {
  console.error("resizing a block left its duration/note at the old center", {
    overlapResizeVisualBefore, overlapResizeVisualDuring, beforeCenterInset, duringCenterInset,
  }); process.exit(1)
}
await page.mouse.up()
const overlapResize = await page.evaluate(() => window.__overlapSpans.at(-1))
if (JSON.stringify(overlapResize) !== JSON.stringify({ line: 2, startMin: 795, endMin: 895 })) {
  const overlapDebug = await page.evaluate(({ x, y }) => ({
    editing: window.__overlapEditing,
    hit: document.elementFromPoint(x, y)?.outerHTML,
    handles: Array.from(document.querySelectorAll("#overlap-edit-fixture rect.modular-diary-edit-edge"), (edge) => edge.outerHTML),
  }), { x: overlapBottomBox.x + overlapBottomBox.width / 2, y: overlapBottomBox.y + overlapBottomBox.height / 2 })
  console.error("split-column bottom edge did not resize the selected block", { overlapResize, overlapDebug }); process.exit(1)
}
await page.evaluate(() => {
  const host = document.querySelector("#overlap-edit-fixture")
  host.querySelectorAll(".modular-diary-edit-edge, .modular-diary-edit-edge-line").forEach((edge) => edge.remove())
  window.__enterOverlapEditFromMenu(2)
})
const menuEnteredEdges = await page.locator("#overlap-edit-fixture rect.modular-diary-edit-edge").count()
if (menuEnteredEdges !== 2) {
  console.error("context-menu edit path did not enter the complete resize state", menuEnteredEdges); process.exit(1)
}
await page.locator("#overlap-edit-fixture svg.modular-diary-svg").screenshot({ path: path.join(out, "split-column-edit-handles.png") })

// Moving a selected block is one live visual gesture: its rect, duration and
// every wrapped note line must follow the pointer before pointerup. Waiting for
// the source rewrite/remount makes the label visibly lag behind the block.
// Re-mount the source fixture first: the preceding callback intentionally only
// records its mutation and therefore cannot stand in for Obsidian's redraw.
await page.evaluate(() => window.__mountOverlapEditFixture())
await page.evaluate(() => window.__enterOverlapEditFromMenu(2))
const moveWholeBlock = page.locator('#overlap-edit-fixture rect.modular-diary-block[data-line="2"]')
const moveWholeBlockBox = await moveWholeBlock.boundingBox()
if (!moveWholeBlockBox) { console.error("whole-block move fixture missing"); process.exit(1) }
const moveVisualBefore = await page.evaluate(() => {
  const host = document.querySelector("#overlap-edit-fixture")
  const top = (el) => el.getBoundingClientRect().top
  return {
    block: top(host.querySelector('rect.modular-diary-block[data-line="2"]')),
    labels: Array.from(host.querySelectorAll('text[data-line="2"]'), top),
  }
})
await page.mouse.move(moveWholeBlockBox.x + moveWholeBlockBox.width / 2, moveWholeBlockBox.y + moveWholeBlockBox.height / 2)
await page.mouse.down()
await page.mouse.move(moveWholeBlockBox.x + moveWholeBlockBox.width / 2, moveWholeBlockBox.y + moveWholeBlockBox.height / 2 + 24, { steps: 3 })
const moveVisualDuring = await page.evaluate(() => {
  const host = document.querySelector("#overlap-edit-fixture")
  const top = (el) => el.getBoundingClientRect().top
  return {
    block: top(host.querySelector('rect.modular-diary-block[data-line="2"]')),
    labels: Array.from(host.querySelectorAll('text[data-line="2"]'), top),
  }
})
const blockMoveDelta = moveVisualDuring.block - moveVisualBefore.block
const labelMoveDeltas = moveVisualDuring.labels.map((top, index) => top - moveVisualBefore.labels[index])
if (Math.abs(blockMoveDelta) < 10 || labelMoveDeltas.length < 2 || labelMoveDeltas.some((delta) => Math.abs(delta - blockMoveDelta) > 0.5)) {
  console.error("moving a block left its duration or note behind", { blockMoveDelta, labelMoveDeltas }); process.exit(1)
}
await page.locator("#overlap-edit-fixture svg.modular-diary-svg").screenshot({ path: path.join(out, "whole-block-live-move.png") })
await page.mouse.up()

await page.locator('.modular-diary-plan-mode-toggle').click()
await page.mouse.click(trackCX, yFor(635)) // sleep 块已被移到 10:05-11:05
// 7. toolbar: right-click a swatch hides it; "+" menu shows hidden ones back
const mathSwatch = page.locator('.modular-diary-swatch[data-type="math"]')
await mathSwatch.click({ button: "right" })
await page.waitForSelector(".modular-diary-ctx-menu")
const swatchBox = await mathSwatch.boundingBox()
const contextBox = await page.locator(".modular-diary-ctx-menu").boundingBox()
const expectedContextX = swatchBox ? Math.max(8, swatchBox.x) : 0
if (!swatchBox || !contextBox || Math.abs(contextBox.x - expectedContextX) > 2 || contextBox.y < swatchBox.y + swatchBox.height || contextBox.y - (swatchBox.y + swatchBox.height) > 8) {
  console.error("swatch menu is not anchored", { swatchBox, contextBox }); process.exit(1)
}
const contextStyle = await page.locator(".modular-diary-ctx-menu").evaluate((menu) => {
  const item = menu.querySelector(".modular-diary-add-item")
  const menuStyle = getComputedStyle(menu)
  const itemStyle = getComputedStyle(item)
  return {
    radius: parseFloat(menuStyle.borderTopLeftRadius),
    itemRadius: parseFloat(itemStyle.borderTopLeftRadius),
    itemPaddingLeft: parseFloat(itemStyle.paddingLeft),
    labelledBy: menu.getAttribute("aria-labelledby"),
    ariaLabel: menu.getAttribute("aria-label"),
    // Same skin as Obsidian's `.menu-item`: font-ui-small (13px fallback),
    // normal weight, content-driven height instead of the 30px button height.
    itemFontSize: itemStyle.fontSize,
    itemFontWeight: itemStyle.fontWeight,
    itemHeight: item.getBoundingClientRect().height,
    menuFontSize: menuStyle.fontSize,
    menuPadding: parseFloat(menuStyle.paddingTop),
  }
})
if (contextStyle.radius < 6 || contextStyle.itemRadius < 4 || contextStyle.itemPaddingLeft < 8 || !contextStyle.labelledBy || contextStyle.ariaLabel !== null) {
  console.error("swatch menu visual/accessibility contract regressed", contextStyle); process.exit(1)
}
if (contextStyle.itemFontSize !== "13px" || contextStyle.menuFontSize !== "13px" || contextStyle.itemFontWeight !== "400" || contextStyle.itemHeight >= 30 || contextStyle.menuPadding < 6) {
  console.error("custom menu does not share Obsidian's native menu skin", contextStyle); process.exit(1)
}
// Keyboard parity with Obsidian's Menu: the first arrow enters the menu, Escape closes it.
await page.keyboard.press("ArrowDown")
const contextKeyboard = await page.evaluate(() => ({
  focused: document.activeElement?.closest(".modular-diary-ctx-menu") !== null && document.activeElement?.getAttribute("role") === "menuitem",
}))
if (!contextKeyboard.focused) {
  console.error("ArrowDown did not move focus into the custom menu", contextKeyboard); process.exit(1)
}
await page.locator('.modular-diary-ctx-menu .modular-diary-add-item:has-text("隐藏")').click()
await page.locator(".modular-diary-add").click()
if (await page.locator('.modular-diary-add-menu .modular-diary-add-new:has-text("添加分类")').count() !== 1) {
  console.error("add-new option missing from hidden menu"); process.exit(1)
}
const addNewStyle = await page.locator('.modular-diary-add-menu .modular-diary-add-new').evaluate((item) => {
  const style = getComputedStyle(item)
  const separator = getComputedStyle(item, "::before")
  return {
    topLeft: parseFloat(style.borderTopLeftRadius),
    topRight: parseFloat(style.borderTopRightRadius),
    bottomRight: parseFloat(style.borderBottomRightRadius),
    bottomLeft: parseFloat(style.borderBottomLeftRadius),
    borderTopWidth: parseFloat(style.borderTopWidth),
    separatorHeight: parseFloat(separator.height),
  }
})
if (
  Math.min(addNewStyle.topLeft, addNewStyle.topRight, addNewStyle.bottomRight, addNewStyle.bottomLeft) < 4 ||
  addNewStyle.borderTopWidth !== 0 ||
  addNewStyle.separatorHeight < 1
) {
  console.error("add-new menu item rounding regressed", addNewStyle); process.exit(1)
}
await page.locator('.modular-diary-add-menu .modular-diary-add-new:has-text("添加分类")').click()
await page.locator(".modular-diary-add").click()
await page.locator('.modular-diary-add-item:has-text("fitness")').click()

// 7a. Grid component hide uses the exact same custom menu and short action copy.
await page.evaluate(() => window.__showComponentMenu(180, 240))
const componentMenu = page.locator('.modular-diary-ctx-menu[aria-labelledby]')
const componentMenuBox = await componentMenu.boundingBox()
if (!componentMenuBox || Math.abs(componentMenuBox.x - 180) > 2 || componentMenuBox.y < 240 || componentMenuBox.y > 250) {
  console.error("component menu is not cursor-anchored", componentMenuBox); process.exit(1)
}
await componentMenu.locator('.modular-diary-add-item:has-text("隐藏")').click()
if (await page.evaluate(() => window.__componentHidden) !== 1) {
  console.error("component custom hide action did not route"); process.exit(1)
}

// 7b. no hidden swatches: tail "+" opens settings directly and never opens an empty menu.
await page.evaluate(() => window.__mountNoHiddenToolbar())
await page.locator("#no-hidden-toolbar .modular-diary-add").click()
if (await page.locator(".modular-diary-add-menu").count() !== 0) {
  console.error("empty hidden menu should not open"); process.exit(1)
}

// 7b2. Twenty-one categories fold behind "More (n)" after two rows instead
// of stacking eight rows in a narrow pane; folded categories stay reachable
// (and selectable) through the menu, and a wide pane shows them all.
const readManyCategories = () => page.evaluate(() => {
  const slot = document.querySelector("#many-categories-slot")
  const list = slot.querySelector(".modular-diary-category-list")
  const visible = [...list.children].filter((child) => !child.hidden && child.getBoundingClientRect().width > 0)
  const more = list.querySelector(".modular-diary-category-more")
  return {
    rows: new Set(visible.map((child) => child.offsetTop)).size,
    folded: Number(list.dataset.foldedCategories),
    visibleSwatches: visible.filter((child) => child.dataset.type).map((child) => child.dataset.type),
    moreVisible: !more.hidden && more.getBoundingClientRect().width > 0,
    moreLabel: more.querySelector(".modular-diary-category-more-label")?.textContent,
    moreAria: more.getAttribute("aria-label"),
    moreFocusable: more.tabIndex >= 0,
    moreLast: visible.at(-1)?.classList.contains("modular-diary-add") && visible.at(-2) === more,
    active: list.querySelector(".modular-diary-swatch[data-type].is-active")?.dataset.type,
    listHeight: list.getBoundingClientRect().height,
    foldVisible: (() => { const fold = list.querySelector(".modular-diary-category-fold"); return Boolean(fold) && !fold.hidden && fold.getBoundingClientRect().width > 0 })(),
    collapsed: list.dataset.categoriesCollapsed,
  }
})
// Folding is opt-in (yyt 2026-09-09): by default every category is shown, and
// a narrow pane merely offers a "collapse" button after the "+".
await page.evaluate(() => { window.__manyCollapsed = false; window.__mountManyCategories(300) })
await page.waitForTimeout(80)
const manyExpanded = await readManyCategories()
if (manyExpanded.rows <= 2 || manyExpanded.folded !== 0 || manyExpanded.moreVisible || !manyExpanded.foldVisible || manyExpanded.visibleSwatches.length !== 21 || manyExpanded.collapsed !== "0") {
  console.error("categories must stay expanded until the user folds them", manyExpanded); process.exit(1)
}
await page.locator("#many-categories-slot").screenshot({ path: path.join(out, "toolbar-many-categories-expanded.png") })
await page.locator("#many-categories-slot .modular-diary-category-fold").click()
await page.waitForTimeout(80)
if (await page.evaluate(() => window.__manyCollapsed) !== true) { console.error("fold button did not persist the preference"); process.exit(1) }
const manyNarrow = await readManyCategories()
if (manyNarrow.rows !== 2 || manyNarrow.folded < 5 || !manyNarrow.moreVisible || !manyNarrow.moreLast || !manyNarrow.moreFocusable
  || manyNarrow.moreLabel !== `更多 (${manyNarrow.folded})` || manyNarrow.moreAria !== `显示其余 ${manyNarrow.folded} 个分类`
  || manyNarrow.visibleSwatches.length + manyNarrow.folded !== 21 || manyNarrow.visibleSwatches[0] !== "开发") {
  console.error("many categories did not fold after two rows", manyNarrow); process.exit(1)
}
await page.locator("#many-categories-slot").screenshot({ path: path.join(out, "toolbar-many-categories-folded.png") })
await page.locator("#many-categories-slot .modular-diary-category-more").click()
const foldedMenu = await page.evaluate(() => {
  const menu = document.querySelector(".modular-diary-add-menu")
  return {
    open: Boolean(menu),
    items: [...(menu?.querySelectorAll('.modular-diary-add-item[role="menuitem"]:not(.modular-diary-category-expand)') ?? [])].map((item) => item.textContent),
    expandItem: menu?.querySelector(".modular-diary-category-expand")?.textContent ?? null,
    focusedInMenu: menu?.contains(document.activeElement) ?? false,
    expanded: document.querySelector("#many-categories-slot .modular-diary-category-more").getAttribute("aria-expanded"),
  }
})
const lastName = "出门"
if (!foldedMenu.open || foldedMenu.items.length !== manyNarrow.folded || foldedMenu.items.at(-1) !== lastName || !foldedMenu.focusedInMenu || foldedMenu.expanded !== "true" || foldedMenu.expandItem !== "展开全部分类") {
  console.error("More menu did not list the folded categories", foldedMenu); process.exit(1)
}
await page.locator('.modular-diary-add-menu .modular-diary-add-item:has-text("出门")').click()
const manyAfterPick = await readManyCategories()
const pickedSelected = await page.evaluate(() => window.__manySelected)
if (manyAfterPick.rows !== 2 || manyAfterPick.active !== lastName || !manyAfterPick.visibleSwatches.includes(lastName) || pickedSelected.join() !== lastName
  || manyAfterPick.folded !== manyNarrow.folded || await page.locator(".modular-diary-add-menu").count() !== 0) {
  console.error("picking a folded category did not surface it as the active swatch", { manyAfterPick, pickedSelected }); process.exit(1)
}
// The More menu's last entry expands the palette again and clears the preference.
await page.locator("#many-categories-slot .modular-diary-category-more").click()
await page.locator(".modular-diary-add-menu .modular-diary-category-expand").click()
await page.waitForTimeout(80)
const manyReexpanded = await readManyCategories()
if (manyReexpanded.folded !== 0 || manyReexpanded.moreVisible || manyReexpanded.visibleSwatches.length !== 21 || await page.evaluate(() => window.__manyCollapsed) !== false) {
  console.error("expand-all did not restore the full palette", manyReexpanded); process.exit(1)
}
// Fold once more so widening is checked against the collapsed preference.
await page.locator("#many-categories-slot .modular-diary-category-fold").click()
await page.waitForTimeout(80)
await page.evaluate(() => { document.querySelector("#many-categories-slot").style.width = "1400px" })
await page.waitForTimeout(80)
const manyWide = await readManyCategories()
if (manyWide.folded !== 0 || manyWide.moreVisible || manyWide.visibleSwatches.length !== 21 || manyWide.rows > 2) {
  console.error("widening did not unfold the categories", manyWide); process.exit(1)
}
await page.evaluate(() => { document.querySelector("#many-categories-slot").remove() })

// 7c. A zero palette keeps the geometry selector reachable so users can switch
// to the other independent set; its category row is one full-size creation entry.
await page.evaluate(() => window.__mountEmptyToolbars())
const zeroToolbarState = await page.locator("#zero-toolbar").evaluate((toolbar) => {
  const button = toolbar.querySelector(".modular-diary-toolbar-empty")
  const toolbarRect = button.parentElement.getBoundingClientRect()
  const buttonRect = button.getBoundingClientRect()
  const style = getComputedStyle(button)
  const parentStyle = getComputedStyle(button.parentElement)
  const contentWidth = toolbarRect.width - parseFloat(parentStyle.paddingLeft) - parseFloat(parentStyle.paddingRight)
  const contentHeight = toolbarRect.height - parseFloat(parentStyle.paddingTop) - parseFloat(parentStyle.paddingBottom)
  return {
    label: toolbar.querySelector(".modular-diary-toolbar-empty-label")?.textContent,
    borderStyle: style.borderStyle,
    fillsWidth: Math.abs(contentWidth - buttonRect.width) <= 1,
    fillsHeight: Math.abs(contentHeight - buttonRect.height) <= 1,
    modeCount: toolbar.querySelectorAll(".modular-diary-plan-mode-toggle").length,
    swatchCount: toolbar.querySelectorAll(".modular-diary-swatch").length,
    markerPressed: toolbar.querySelector('[data-tool="marker"]')?.getAttribute("aria-pressed"),
  }
})
if (zeroToolbarState.label !== "添加第一个分类" || zeroToolbarState.borderStyle !== "none" || !zeroToolbarState.fillsWidth || !zeroToolbarState.fillsHeight || zeroToolbarState.modeCount !== 1 || zeroToolbarState.swatchCount !== 0 || zeroToolbarState.markerPressed !== "true") {
  console.error("zero-highlighter empty state regressed", zeroToolbarState); process.exit(1)
}
await page.locator("#zero-toolbar .modular-diary-toolbar-empty").click()
await page.locator("#zero-toolbar").screenshot({ path: path.join(out, "zero-toolbar.png") })
await page.locator('#zero-toolbar [data-tool="span"]').click()
if (await page.locator('#zero-toolbar .modular-diary-swatch[data-type="math"]').count() !== 1) {
  console.error("switching away from an empty point set did not restore the independent span set"); process.exit(1)
}
if (await page.locator("#all-hidden-toolbar .modular-diary-toolbar-empty").count() !== 0 || await page.locator("#all-hidden-toolbar .modular-diary-add").count() !== 1) {
  console.error("all-hidden toolbar was mistaken for a zero palette"); process.exit(1)
}

await page.locator("#all-hidden-toolbar .modular-diary-add").click()
await page.locator('.modular-diary-add-menu .modular-diary-add-item:has-text("math")').click()

// 7d. English copy is rendered from the same components when Obsidian's
// language provider reports English; category data itself is not translated.
await page.evaluate(() => window.__mountEnglishToolbar())
const englishCopy = await page.evaluate(() => ({
  empty: document.querySelector("#english-toolbar .modular-diary-toolbar-empty-label")?.textContent,
  actual: document.querySelector('#english-layers [data-layer="actual"]')?.getAttribute("aria-label"),
  plan: document.querySelector('#english-layers [data-layer="plan"]')?.getAttribute("aria-label"),
}))
if (englishCopy.empty !== "Add first category" || englishCopy.actual !== "Hide Record layer" || englishCopy.plan !== "Hide Plan layer") {
  console.error("English toolbar localization regressed", englishCopy); process.exit(1)
}
await page.locator("#english-toolbar").screenshot({ path: path.join(out, "english-toolbar.png") })

// 7e. Type cascade opens on hover, stays attached to the primary menu while
// crossing into it, and keeps click/keyboard fallbacks.
await page.evaluate(() => window.__mountCascadeFixture(80))
const cascadeTrigger = page.locator("#cascade-fixture > .menu-item").first()
await cascadeTrigger.hover()
const cascade = page.locator("#cascade-fixture > .modular-diary-cascade-menu")
await cascade.waitFor({ state: "visible" })
const cascadeTriggerBox = await cascadeTrigger.boundingBox()
const cascadeBox = await cascade.boundingBox()
if (!cascadeTriggerBox || !cascadeBox || cascadeBox.x < cascadeTriggerBox.x + cascadeTriggerBox.width || await page.locator("#cascade-fixture").count() !== 1) {
  console.error("cascade did not open beside its live primary menu", { cascadeTriggerBox, cascadeBox }); process.exit(1)
}
await page.mouse.move(cascadeBox.x + cascadeBox.width / 2, cascadeBox.y + cascadeBox.height / 2)
if (await page.locator("#cascade-fixture").count() !== 1 || await cascade.count() !== 1) {
  console.error("crossing into cascade closed the primary menu"); process.exit(1)
}
await cascade.locator('[role="menuitemradio"]:has-text("运动")').click()
if (JSON.stringify(await page.evaluate(() => window.__cascadeSelected)) !== JSON.stringify([1])) {
  console.error("cascade selection did not route"); process.exit(1)
}

await page.evaluate(() => window.__mountCascadeFixture(80))
const keyboardCascadeTrigger = page.locator("#cascade-fixture > .menu-item").first()
await keyboardCascadeTrigger.focus()
await page.keyboard.press("ArrowRight")
const keyboardCascadeItemFocused = await page.locator('[role="menuitemradio"]:has-text("运动")')
  .evaluate((item) => item === document.activeElement)
if (await page.locator("#cascade-fixture > .modular-diary-cascade-menu").count() !== 1 || !keyboardCascadeItemFocused) {
  console.error("cascade keyboard fallback regressed"); process.exit(1)
}
await page.keyboard.press("ArrowLeft")
const keyboardCascadeTriggerFocused = await keyboardCascadeTrigger.evaluate((item) => item === document.activeElement)
if (await page.locator("#cascade-fixture > .modular-diary-cascade-menu").count() !== 0 || !keyboardCascadeTriggerFocused) {
  console.error("cascade keyboard return regressed"); process.exit(1)
}

await page.evaluate(() => window.__mountCascadeFixture(244))
const edgeCascadeTrigger = page.locator("#cascade-fixture > .menu-item").first()
await edgeCascadeTrigger.hover()
const edgeTriggerBox = await edgeCascadeTrigger.boundingBox()
const edgeCascadeBox = await page.locator("#cascade-fixture > .modular-diary-cascade-menu").boundingBox()
if (!edgeTriggerBox || !edgeCascadeBox || edgeCascadeBox.x + edgeCascadeBox.width > edgeTriggerBox.x + 0.5) {
  console.error("cascade did not flip left near the viewport edge", { edgeTriggerBox, edgeCascadeBox }); process.exit(1)
}
await page.locator("#cascade-fixture").evaluate((el) => el.remove())

// 7f. Obsidian wraps menu items in a scroll container. Moving between two
// cascade triggers must replace the submenu instead of leaving the previous
// category submenu layered above the todo submenu.
await page.evaluate(() => window.__mountCascadeSwitchFixture())
const switchFixture = page.locator("#cascade-switch-fixture")
await switchFixture.getByRole("button", { name: "更改分类…" }).hover()
await switchFixture.getByRole("button", { name: "绑定待办…" }).hover()
let switchMenus = switchFixture.locator(":scope > .modular-diary-cascade-menu")
if (await switchMenus.count() !== 1 || !await switchMenus.getByText("任务 A", { exact: true }).isVisible()) {
  console.error("cascade did not switch from category to todo", {
    count: await switchMenus.count(), text: await switchMenus.allTextContents(),
  }); process.exit(1)
}
await switchFixture.getByRole("button", { name: "更改分类…" }).dispatchEvent("pointerover")
switchMenus = switchFixture.locator(":scope > .modular-diary-cascade-menu")
if (await switchMenus.count() !== 1 || !await switchMenus.getByText("开发", { exact: true }).isVisible()) {
  console.error("cascade did not switch back from todo to category", {
    count: await switchMenus.count(), text: await switchMenus.allTextContents(),
  }); process.exit(1)
}
await switchFixture.evaluate((el) => el.remove())

const created = await page.evaluate(() => window.__created)
const menu = await page.evaluate(() => window.__menu)
console.log("created:", JSON.stringify(created))
console.log("menu:", JSON.stringify(menu))

const expectCreated = [
  { line: "10:05-11:30 math", startMin: 605 },
  { line: "10:17-10:23 math", startMin: 617 },
  { line: "12:30-14:00 math", startMin: 750 },
  { line: "07:30-08:30 math", startMin: 450 },
  { line: "07:00-07:30 math", startMin: 420 },
  { line: "19:00-19:05 math", startMin: 1140 },
  { line: "plan 15:00-16:00 math", startMin: 900 },
]
if (JSON.stringify(created) !== JSON.stringify(expectCreated)) { console.error("created mismatch"); process.exit(1) }
if (menu.length !== 1 || menu[0].line !== 0) { console.error("menu mismatch"); process.exit(1) }
const spans = await page.evaluate(() => window.__span)
const expectedSpans = [
  { line: 2, startMin: 420, endMin: 565 },   // 计划色块底沿实时调整；斜纹与文字同步
  { line: 0, startMin: 420, endMin: 545 },   // 底沿 09:07 -> 09:05
  { line: 0, startMin: 605, endMin: 665 },   // 移动也吸附到 5 分钟网格
  { line: 3, startMin: 795, endMin: 830 },   // 20 分钟短块底沿仍可调整
]
if (JSON.stringify(spans) !== JSON.stringify(expectedSpans)) { console.error("span mismatch", JSON.stringify(spans)); process.exit(1) }
const extend = await page.evaluate(() => window.__extend)
if (extend.length !== 0) {
  console.error("extend mismatch", JSON.stringify(extend)); process.exit(1)
}
// 5g. A pure double-click on a short, non-grid-aligned block must never snap
// its exact span. 15:30-15:55 is 0.42h; the lower text area overlaps the
// visual edge hot zone on this 18px-high block.
await page.keyboard.press("Escape")
const exactBlock = page.locator('rect.modular-diary-block[data-line="1"]')
// Toolbar rows above the timeline compact instead of widening the page, so
// the block's viewport position depends on wrapping; bring it into view first.
await exactBlock.scrollIntoViewIfNeeded()
const exactBlockBox = await exactBlock.boundingBox()
await page.mouse.click(exactBlockBox.x + 5, exactBlockBox.y + exactBlockBox.height / 2)
const spansBeforeDblclick = await page.evaluate(() => window.__span.length)
await page.mouse.dblclick(exactBlockBox.x + 5, exactBlockBox.y + exactBlockBox.height * 0.67, { delay: 40 })
const spansAfterDblclick = await page.evaluate(() => window.__span.length)
if (spansAfterDblclick !== spansBeforeDblclick) {
  console.error("double-click changed an exact 25-minute span", await page.evaluate(() => window.__span)); process.exit(1)
}
if (JSON.stringify(await page.evaluate(() => window.__editnotes)) !== JSON.stringify([1])) {
  console.error("double-click did not edit the 25-minute block note", JSON.stringify(await page.evaluate(() => window.__editnotes))); process.exit(1)
}
await page.keyboard.press("Escape")
await page.evaluate(() => { window.__editnotes = []; window.__focus = [] })
// 5g. dblclick on a block -> edit its note
await page.locator('rect.modular-diary-block[data-line="0"]').dispatchEvent("dblclick")

const editnotes = await page.evaluate(() => window.__editnotes)
if (editnotes.length !== 1 || editnotes[0] !== 0) { console.error("editnote mismatch", JSON.stringify(editnotes)); process.exit(1) }
const focus = await page.evaluate(() => window.__focus)
if (focus.length !== 1 || focus[0] !== 0) { console.error("focus mismatch", JSON.stringify(focus)); process.exit(1) }
const editingNow = await page.evaluate(() => window.__editing)
if (editingNow !== 0) { console.error("click did not enter edit mode", editingNow); process.exit(1) }
const hidden = await page.evaluate(() => window.__hidden)
const shown = await page.evaluate(() => window.__shown)
const addNew = await page.evaluate(() => window.__addNew)
const toolbarControlSize = await page.evaluate(() => {
  const toolbar = document.querySelector(".modular-diary-toolbar")
  const label = document.querySelector(".modular-diary-creation-title").getBoundingClientRect()
  const mode = document.querySelector(".modular-diary-tool-toggle").getBoundingClientRect()
  const planMode = document.querySelector(".modular-diary-plan-mode-toggle").getBoundingClientRect()
  const swatch = document.querySelector('.modular-diary-swatch[data-type="math"]').getBoundingClientRect()
  return {
    labelModeGap: mode.left - label.right,
    toolbarGap: parseFloat(getComputedStyle(toolbar).columnGap),
    modeHeight: mode.height,
    planModeHeight: planMode.height,
    dividerCount: document.querySelectorAll(".modular-diary-create-divider").length,
    swatchHeight: swatch.height,
    topDelta: mode.top - swatch.top,
    bottomDelta: mode.bottom - swatch.bottom,
  }
})
const toolbarCornerRadius = await page.evaluate(() => {
  const radii = (selector) => {
    const style = getComputedStyle(document.querySelector(selector))
    return [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius]
      .map((value) => parseFloat(value))
  }
  const mode = document.querySelector(".modular-diary-tool-toggle")
  return {
    mode: radii(".modular-diary-tool-toggle"),
    swatch: radii('.modular-diary-swatch[data-type="math"]'),
    add: radii(".modular-diary-add"),
    overflow: getComputedStyle(mode).overflow,
  }
})
const layerToggleSize = await page.evaluate(() => {
  const wrap = document.querySelector("#layer-toggle-size-check")
  const button = wrap.querySelector(".modular-diary-mode-btn")
  const wr = wrap.getBoundingClientRect()
  const br = button.getBoundingClientRect()
  return { wrapHeight: wr.height, buttonHeight: br.height }
})
const tooltipContract = await page.evaluate(() => ({
  nativeTitleCount: document.querySelectorAll(".modular-diary-toolbar [title], .modular-diary-view-toggle [title]").length,
  unlabelledButtonCount: [...document.querySelectorAll(".modular-diary-toolbar button, .modular-diary-view-toggle button")]
    .filter((button) => !button.getAttribute("aria-label")).length,
  swatchStyle: (() => {
    const style = getComputedStyle(document.querySelector('.modular-diary-swatch[data-type="math"]'))
    return { appearance: style.appearance, background: style.backgroundColor, shadow: style.boxShadow }
  })(),
}))
if (hidden.length !== 1 || hidden[0] !== "math") { console.error("hide mismatch", JSON.stringify(hidden)); process.exit(1) }
if (JSON.stringify(shown) !== JSON.stringify(["fitness", "math"])) { console.error("show mismatch", JSON.stringify(shown)); process.exit(1) }
if (addNew !== 3) { console.error("add-new routing mismatch", addNew); process.exit(1) }
const toolbarControlsShareRow = Math.abs(toolbarControlSize.topDelta) < Math.max(toolbarControlSize.modeHeight, toolbarControlSize.swatchHeight) / 2
if (Math.abs(toolbarControlSize.modeHeight - toolbarControlSize.swatchHeight) > 0.25 || Math.abs(toolbarControlSize.planModeHeight - toolbarControlSize.swatchHeight) > 0.25 || (toolbarControlsShareRow && (Math.abs(toolbarControlSize.topDelta) > 0.25 || Math.abs(toolbarControlSize.bottomDelta) > 0.25))) {
  console.error("brush mode/highlighter height drifted", toolbarControlSize); process.exit(1)
}
if (Math.abs(toolbarControlSize.labelModeGap - toolbarControlSize.toolbarGap) > 0.25) {
  console.error("add-as label/mode gap drifted", toolbarControlSize); process.exit(1)
}
if (toolbarControlSize.dividerCount !== 0) {
  console.error("creation controls must not reintroduce a decorative divider", toolbarControlSize); process.exit(1)
}
const referenceRadius = toolbarCornerRadius.swatch[0]
if (toolbarCornerRadius.overflow !== "hidden" || [...toolbarCornerRadius.mode, ...toolbarCornerRadius.swatch, ...toolbarCornerRadius.add].some((radius) => Math.abs(radius - referenceRadius) > 0.1)) {
  console.error("toolbar control corner radius drifted", toolbarCornerRadius); process.exit(1)
}
if (layerToggleSize.wrapHeight < 30 || layerToggleSize.wrapHeight > 34 || layerToggleSize.buttonHeight > 28) {
  console.error("layer toggle size drifted", layerToggleSize); process.exit(1)
}
if (tooltipContract.nativeTitleCount !== 0 || tooltipContract.unlabelledButtonCount !== 0) {
  console.error("toolbar tooltip contract regressed", tooltipContract); process.exit(1)
}
if (tooltipContract.swatchStyle.appearance !== "none" || tooltipContract.swatchStyle.background === "rgba(0, 0, 0, 0)" || tooltipContract.swatchStyle.shadow !== "none") {
  console.error("highlighter button chrome regressed", tooltipContract.swatchStyle); process.exit(1)
}

// 8. Creation and range adjustment are separate tools. The visible boundary
// and every point inside the track create blocks with a crosshair. Each outer
// edge owns two real buttons: −1 hour contracts inward and +1 hour extends
// outward. Their boxes are fully outside the track and the buttons—not an
// unrelated invisible lane—own pointer hit testing.
await page.evaluate(() => window.__mountRangeEdgeFixture())
const rangeSvg = page.locator("#range-edge-fixture svg.modular-diary-svg")
await rangeSvg.scrollIntoViewIfNeeded()
const rangeBox = await rangeSvg.boundingBox()
if (!rangeBox) { console.error("range edge fixture has no box"); process.exit(1) }
const rangeYFor = (min) => rangeBox.y + 26 + ((min - 420) / 60) * 48
const rangeTrackCX = rangeBox.x + 36 + (200 - 36 - 6) / 2
const rangeSvgHeight = await rangeSvg.evaluate((svg) => Number(svg.getAttribute("height")))
const rangeCssPerSvgY = rangeBox.height / rangeSvgHeight
const rangePointerY = (min, outwardOffset = 0) => rangeYFor(min) + outwardOffset * rangeCssPerSvgY
const dragRangeBoundary = async (fromMin, toMin) => {
  const fromY = rangePointerY(fromMin)
  const cursor = await cursorAt(rangeTrackCX, fromY)
  if (cursor !== "crosshair") {
    console.error("visible range boundary lost creation cursor", { fromMin, cursor }); process.exit(1)
  }
  await page.mouse.move(rangeTrackCX, fromY)
  await page.mouse.down()
  await page.mouse.move(rangeTrackCX, rangeYFor(toMin), { steps: 5 })
  await page.mouse.up()
}
const rangeButtons = page.locator("#range-edge-fixture .modular-diary-range-step-button")
if (await rangeButtons.count() !== 4) {
  console.error("range step controls must expose four concrete buttons", await rangeButtons.count()); process.exit(1)
}
const rangeControlGeometry = await page.locator("#range-edge-fixture svg.modular-diary-svg").evaluate((svg) => {
  const track = svg.querySelector("rect.modular-diary-track").getBBox()
  const buttons = Array.from(svg.querySelectorAll(".modular-diary-range-step-button")).map((button) => {
    const box = button.getBBox()
    return {
      edge: button.dataset.edge,
      action: button.dataset.action,
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      cursor: getComputedStyle(button).cursor,
      aria: button.getAttribute("aria-label"),
    }
  })
  return { track, buttons }
})
const topButtons = rangeControlGeometry.buttons.filter((button) => button.edge === "top")
const bottomButtons = rangeControlGeometry.buttons.filter((button) => button.edge === "bottom")
if (topButtons.some((button) => button.box.y + button.box.height > rangeControlGeometry.track.y)
  || bottomButtons.some((button) => button.box.y < rangeControlGeometry.track.y + rangeControlGeometry.track.height)
  || rangeControlGeometry.buttons.some((button) => button.cursor !== "pointer" || button.box.height !== 18)) {
  console.error("range step buttons overlapped the creation track", rangeControlGeometry); process.exit(1)
}
await page.locator('#range-edge-fixture .modular-diary-range-step-button[data-edge="top"][data-action="extend"]').hover()
await page.locator("#range-edge-fixture").screenshot({ path: path.join(out, "range-step-controls-top.png") })
await page.mouse.move(rangeTrackCX, rangePointerY(1380, -4))
const bottomInnerCursor = await cursorAt(rangeTrackCX, rangePointerY(1380, -4))
await page.mouse.move(rangeTrackCX, rangePointerY(420))
const rangeTopBoundaryCursor = await cursorAt(rangeTrackCX, rangePointerY(420))
await page.mouse.move(rangeTrackCX, rangePointerY(1380))
const rangeBottomBoundaryCursor = await cursorAt(rangeTrackCX, rangePointerY(1380))
if (bottomInnerCursor !== "crosshair" || rangeTopBoundaryCursor !== "crosshair" || rangeBottomBoundaryCursor !== "crosshair") {
  console.error("creation and one-hour adjustment controls overlapped", {
    bottomInnerCursor, rangeTopBoundaryCursor, rangeBottomBoundaryCursor,
  }); process.exit(1)
}

await dragRangeBoundary(420, 480)   // exact top line creates 07:00 -> 08:00
await dragRangeBoundary(1380, 1320) // exact bottom line creates 22:00 -> 23:00
await page.locator('#range-edge-fixture .modular-diary-range-step-button[data-edge="top"][data-action="contract"]').click()
await page.locator('#range-edge-fixture .modular-diary-range-step-button[data-edge="top"][data-action="extend"]').click()
await page.locator('#range-edge-fixture .modular-diary-range-step-button[data-edge="bottom"][data-action="contract"]').click()
await page.locator('#range-edge-fixture .modular-diary-range-step-button[data-edge="bottom"][data-action="extend"]').click()

await page.evaluate(() => { window.__rangeActive = "" })
await page.mouse.move(rangeTrackCX, rangePointerY(420))
const noCategoryBoundaryCursor = await cursorAt(rangeTrackCX, rangePointerY(420))
const createdBeforeDisabledBoundary = await page.evaluate(() => window.__rangeCreated.length)
await page.mouse.move(rangeTrackCX, rangePointerY(420))
await page.mouse.down()
await page.mouse.move(rangeTrackCX, rangeYFor(480), { steps: 4 })
await page.mouse.up()
const createdAfterDisabledBoundary = await page.evaluate(() => window.__rangeCreated.length)
if (noCategoryBoundaryCursor !== "default" || createdAfterDisabledBoundary !== createdBeforeDisabledBoundary) {
  console.error("no-category boundary unexpectedly created a block", {
    noCategoryBoundaryCursor, createdBeforeDisabledBoundary, createdAfterDisabledBoundary,
  }); process.exit(1)
}
await page.locator('#range-edge-fixture .modular-diary-range-step-button[data-edge="top"][data-action="extend"]').click()
// Range adjustment remains available without categories.
const rangeEdgeState = await page.evaluate(() => ({
  ranges: window.__rangeExtend,
  created: window.__rangeCreated,
}))
const expectedRangeEdges = [
  { startMin: 480, endMin: 1380 },
  { startMin: 360, endMin: 1380 },
  { startMin: 420, endMin: 1320 },
  { startMin: 420, endMin: 1440 },
  { startMin: 360, endMin: 1380 },
]
const expectedBoundaryCreates = [
  { line: "07:00-08:00 math", startMin: 420 },
  { line: "22:00-23:00 math", startMin: 1320 },
]
if (JSON.stringify(rangeEdgeState.ranges) !== JSON.stringify(expectedRangeEdges) || JSON.stringify(rangeEdgeState.created) !== JSON.stringify(expectedBoundaryCreates)) {
  console.error("separate creation/one-hour-extension contract regressed", rangeEdgeState); process.exit(1)
}

// 9. The document-level outside-click coordinator must not clear edit state
// when the selected block belongs to a second renderer of the same document.
// Hover and pointerdown must agree: a resize cursor can only start a resize,
// never fall through to drawing a new block.
await page.evaluate(() => window.__mountDuplicateEditingFixture())
const duplicateBottomEdge = page.locator('#duplicate-editing-second rect.modular-diary-edit-edge[data-edge="bottom"]')
await duplicateBottomEdge.scrollIntoViewIfNeeded()
const duplicateEdgeBox = await duplicateBottomEdge.boundingBox()
if (!duplicateEdgeBox) { console.error("duplicate selected edge fixture missing"); process.exit(1) }
const duplicateX = duplicateEdgeBox.x + duplicateEdgeBox.width / 2
const duplicateY = duplicateEdgeBox.y + duplicateEdgeBox.height / 2
await page.mouse.move(duplicateX, duplicateY)
const duplicateCursor = await cursorAt(duplicateX, duplicateY)
if (duplicateCursor !== "ns-resize") {
  console.error("duplicate selected edge lost resize cursor", duplicateCursor); process.exit(1)
}
await page.mouse.down()
await page.mouse.move(duplicateX, duplicateY + 24, { steps: 5 })
await page.mouse.up()
const duplicateGesture = await page.evaluate(() => ({
  editing: window.__duplicateEditing,
  spans: window.__duplicateSpans,
  created: window.__duplicateCreated,
}))
const duplicateSpan = duplicateGesture.spans[0]
if (
  duplicateGesture.editing === null
  || duplicateGesture.created.length !== 0
  || duplicateGesture.spans.length !== 1
  || duplicateSpan.owner !== "second"
  || duplicateSpan.startMin !== 1410
  || duplicateSpan.endMin <= 1440
) {
  console.error("second renderer edge resize fell through to creation", duplicateGesture); process.exit(1)
}
await page.locator("#duplicate-editing-second svg.modular-diary-svg").screenshot({ path: path.join(out, "duplicate-renderer-edge-resized.png") })
// Once a block is selected, a press anywhere outside its explicit block/edge
// target belongs to the same edit-dismiss gesture. It must neither inherit the
// previous resize cursor nor fall through to creating a new block.
const duplicateEdgeAfterResize = await duplicateBottomEdge.boundingBox()
if (!duplicateEdgeAfterResize) { console.error("duplicate edge disappeared after resize"); process.exit(1) }
const duplicateBlankX = duplicateEdgeAfterResize.x + duplicateEdgeAfterResize.width / 2
const duplicateBlankY = duplicateEdgeAfterResize.y + duplicateEdgeAfterResize.height + 12
await page.mouse.move(duplicateX, duplicateEdgeAfterResize.y + duplicateEdgeAfterResize.height / 2)
await page.mouse.move(duplicateBlankX, duplicateBlankY)
const duplicateBlankCursor = await cursorAt(duplicateBlankX, duplicateBlankY)
if (duplicateBlankCursor !== "default") {
  console.error("selected-block blank area kept a resize/create cursor", duplicateBlankCursor); process.exit(1)
}
await page.mouse.down()
await page.mouse.move(duplicateBlankX, duplicateBlankY + 24, { steps: 5 })
await page.mouse.up()
const duplicateDismissGesture = await page.evaluate(() => ({
  editing: window.__duplicateEditing,
  spans: window.__duplicateSpans,
  created: window.__duplicateCreated,
}))
if (
  duplicateDismissGesture.editing !== null
  || duplicateDismissGesture.created.length !== 0
  || duplicateDismissGesture.spans.length !== 1
) {
  console.error("selected-block dismiss gesture fell through to edit/create", duplicateDismissGesture); process.exit(1)
}
await page.mouse.click(10, 10)
const duplicateOutsideExit = await page.evaluate(() => ({
  editing: window.__duplicateEditing,
  editingSvgCount: document.querySelectorAll('#duplicate-editing-first .modular-diary-svg.is-editing-block, #duplicate-editing-second .modular-diary-svg.is-editing-block').length,
}))
if (duplicateOutsideExit.editing !== null || duplicateOutsideExit.editingSvgCount !== 0) {
  console.error("outside click did not clear every duplicate renderer", duplicateOutsideExit); process.exit(1)
}

// The document listener is installed by the first timeline on the page, but
// Delete belongs to the concrete renderer most recently activated by the
// user. A single-renderer test cannot catch this production routing bug.
await page.evaluate(() => window.__syncDuplicateOwner("second"))
await page.evaluate(() => {
  const cm = document.createElement("div")
  cm.id = "duplicate-delete-cm-owner"
  cm.className = "cm-content"
  cm.tabIndex = 0
  document.body.appendChild(cm)
  cm.focus()
})
await page.keyboard.press("Delete")
const duplicateDelete = await page.evaluate(() => ({
  deleted: window.__duplicateDeleted,
  editing: window.__duplicateEditing,
  activeOwners: document.querySelectorAll('[data-modular-diary-edit-owner-active="1"]').length,
  editingSvgCount: document.querySelectorAll('#duplicate-editing-first .modular-diary-svg.is-editing-block, #duplicate-editing-second .modular-diary-svg.is-editing-block').length,
}))
if (
  JSON.stringify(duplicateDelete.deleted) !== JSON.stringify([{ owner: "second", line: 2 }])
  || duplicateDelete.editing !== null
  || duplicateDelete.activeOwners !== 0
  || duplicateDelete.editingSvgCount !== 0
) {
  console.error("Delete was not routed exclusively to the active renderer", duplicateDelete); process.exit(1)
}
await page.evaluate(() => document.querySelector("#duplicate-delete-cm-owner")?.remove())

// Context-menu deletion uses the same transaction as keyboard deletion. The
// visual row disappears synchronously, before Markdown persistence/remount,
// so a slow processor cannot leave a stale block visible after menu click.
await page.evaluate(() => window.__mountDeleteTransactionFixture())
const deleteTransactionBlock = page.locator('#delete-transaction-fixture rect.modular-diary-block[data-line="2"]')
await deleteTransactionBlock.scrollIntoViewIfNeeded()
await deleteTransactionBlock.click({ button: "right" })
const deleteMenuState = await page.evaluate(() => window.__deleteTransactionMenus)
if (deleteMenuState.length !== 1 || deleteMenuState[0].line !== 2) {
  console.error("context-menu delete fixture did not target the clicked block", deleteMenuState); process.exit(1)
}
const deleteTransactionState = await page.evaluate(() => ({
  request: window.__deleteFromContextMenu(2),
  commits: window.__deleteTransactionCommits,
}))
if (
  !deleteTransactionState.request.handled
  || !deleteTransactionState.request.hidden
  || JSON.stringify(deleteTransactionState.commits) !== JSON.stringify([{ line: 2, pendingAtMutation: true }])
) {
  console.error("context-menu deletion was not optimistic and immediate", deleteTransactionState); process.exit(1)
}

// 10. An async ledger/settings refresh may arrive while the pointer is still
// down. It must wait for the gesture to finish instead of replacing the SVG
// that owns pointer capture and silently aborting block creation.
await page.evaluate(() => window.__mountInterruptedDragFixture())
const interruptedSvg = page.locator("#interrupted-drag-fixture svg.modular-diary-svg")
await interruptedSvg.scrollIntoViewIfNeeded()
const interruptedBox = await interruptedSvg.boundingBox()
if (!interruptedBox) { console.error("interrupted drag fixture has no box"); process.exit(1) }
const interruptedYFor = (min) => interruptedBox.y + 26 + ((min - 420) / 60) * 48
const interruptedX = interruptedBox.x + 36 + (200 - 36 - 6) / 2
await page.mouse.move(interruptedX, interruptedYFor(480))
await page.mouse.down()
await page.mouse.move(interruptedX, interruptedYFor(500), { steps: 3 })
await page.evaluate(() => window.__requestInterruptedRefresh())
const interruptedMidGesture = await page.evaluate(() => ({
  active: document.querySelector("#interrupted-drag-fixture")?.dataset.modularDiaryPointerActive ?? "",
  refreshRuns: window.__interruptedRefreshRuns,
  sideEffects: window.__interruptedRefreshSideEffects,
  ghostCount: document.querySelectorAll("#interrupted-drag-fixture .modular-diary-ghost").length,
}))
await page.mouse.move(interruptedX, interruptedYFor(540), { steps: 4 })
await page.mouse.up()
const interruptedFinished = await page.evaluate(() => ({
  active: document.querySelector("#interrupted-drag-fixture")?.dataset.modularDiaryPointerActive ?? "",
  refreshRuns: window.__interruptedRefreshRuns,
  created: window.__interruptedCreated,
}))
if (
  interruptedMidGesture.active !== "1"
  || interruptedMidGesture.refreshRuns !== 0
  || interruptedMidGesture.sideEffects !== 0
  || interruptedMidGesture.ghostCount !== 1
  || interruptedFinished.active !== ""
  || interruptedFinished.refreshRuns !== 1
  || interruptedFinished.created.length !== 1
  || interruptedFinished.created[0].startMin !== 480
  || !interruptedFinished.created[0].line.startsWith("08:00-09:00 math")
) {
  console.error("mid-gesture redraw aborted block creation", { interruptedMidGesture, interruptedFinished }); process.exit(1)
}

// 10b. The same async refresh must defer while a user is typing or choosing a
// todo category. Replacing either focused control closes the edit session and
// a native select popup even though the draft value itself can be restored.
await page.evaluate(() => window.__mountFocusedRefreshFixture())
const focusedTitle = page.locator("#focused-refresh-title")
await focusedTitle.focus()
await page.evaluate(() => window.__requestFocusedRefresh())
const titleRefreshState = await page.evaluate(() => ({
  runs: window.__focusedRefreshRuns,
  active: document.activeElement?.id ?? "",
  value: document.querySelector("#focused-refresh-title")?.value ?? "",
}))
const focusedCategory = page.locator("#focused-refresh-category")
await focusedCategory.focus()
await page.evaluate(() => window.__requestFocusedRefresh())
const categoryRefreshState = await page.evaluate(() => ({
  runs: window.__focusedRefreshRuns,
  active: document.activeElement?.id ?? "",
  connected: Boolean(document.querySelector("#focused-refresh-category")),
}))
await page.mouse.click(5, 5)
await page.waitForTimeout(20)
const focusedRefreshFinished = await page.evaluate(() => window.__focusedRefreshRuns)
if (
  titleRefreshState.runs !== 0
  || titleRefreshState.active !== "focused-refresh-title"
  || titleRefreshState.value !== "输入到一半"
  || categoryRefreshState.runs !== 0
  || categoryRefreshState.active !== "focused-refresh-category"
  || !categoryRefreshState.connected
  || focusedRefreshFinished !== 1
) {
  console.error("focused edit/select session was replaced by background refresh", { titleRefreshState, categoryRefreshState, focusedRefreshFinished }); process.exit(1)
}

// 10c. In Live Preview, rendered Modular Diary chrome is nested inside `.cm-content`.
// Ctrl/Cmd+Z immediately after a component write must still reach Markdown
// undo instead of being mistaken for a CodeMirror text-editing target.
await page.evaluate(() => window.__mountImmediateUndoFixture())
await page.locator("#immediate-undo-control").click()
await page.keyboard.press("Meta+z")
const immediateUndoState = await page.evaluate(() => ({
  created: window.__immediateUndoCreated,
  calls: window.__immediateUndoCalls,
  active: document.activeElement?.id ?? "",
}))
await page.evaluate(() => window.__clearImmediateUndoFixture())
if (immediateUndoState.created || immediateUndoState.calls !== 1 || immediateUndoState.active !== "immediate-undo-control") {
  console.error("immediate timeline undo was lost inside CodeMirror widget chrome", immediateUndoState); process.exit(1)
}

// 11. Time markers are point gestures, remain separate at the same minute,
// and an already selected marker moves instead of creating another marker.
await page.evaluate(() => window.__mountMarkerFixture())
const markerSvg = page.locator("#marker-fixture svg.modular-diary-svg")
await markerSvg.scrollIntoViewIfNeeded()
const markerBox = await markerSvg.boundingBox()
if (!markerBox) { console.error("marker fixture has no box"); process.exit(1) }
const markerX = markerBox.x + 36 + (220 - 36 - 6) / 2
const markerYFor = (min) => markerBox.y + 26 + ((min - 420) / 60) * 48
const sameTimeLines = await page.locator('#marker-fixture .modular-diary-marker[data-time-min="600"]').evaluateAll((nodes) => nodes.map((node) => Number(node.dataset.markerY)))
if (sameTimeLines.length !== 2 || new Set(sameTimeLines).size !== 2) {
  console.error("same-time marker stack collapsed", sameTimeLines); process.exit(1)
}
await page.mouse.move(markerX, markerYFor(547))
await page.mouse.down()
await page.keyboard.down("Alt")
await page.mouse.move(markerX, markerYFor(553), { steps: 3 })
await page.mouse.up()
await page.keyboard.up("Alt")
const createdMarker = await page.evaluate(() => window.__markerCreated)
if (createdMarker.length !== 1 || createdMarker[0].timeMin !== 553 || createdMarker[0].line !== "@09:13 [math]") {
  console.error("precise marker creation regressed", createdMarker); process.exit(1)
}
const firstMarker = page.locator('#marker-fixture .modular-diary-marker[data-line="2"]')
await firstMarker.click()
const markerFocus = await page.evaluate(() => ({
  editing: window.__markerEditing,
  target: document.querySelector('#marker-fixture .modular-diary-marker[data-line="2"]')?.classList.contains("is-edit-target"),
  frozen: document.querySelector('#marker-fixture .modular-diary-marker[data-line="3"]')?.classList.contains("is-frozen"),
}))
if (markerFocus.editing !== 2 || !markerFocus.target || !markerFocus.frozen) {
  console.error("marker focus/freeze regressed", markerFocus); process.exit(1)
}
await page.locator("#marker-fixture").screenshot({ path: path.join(out, "marker-same-time-focus.png") })
await page.evaluate(() => { window.__markerTool = "span" })
await page.mouse.move(markerX, markerYFor(690))
await page.mouse.down()
await page.mouse.move(markerX, markerYFor(720), { steps: 3 })
await page.mouse.up()
const markerDismiss = await page.evaluate(() => ({ editing: window.__markerEditing, blocks: window.__markerBlockCreated }))
if (markerDismiss.editing !== null || markerDismiss.blocks.length !== 0) {
  console.error("selected marker dismiss gesture created a duration block", markerDismiss); process.exit(1)
}
await firstMarker.click()
const firstMarkerBox = await firstMarker.boundingBox()
const markerMoveBox = await markerSvg.boundingBox()
if (!firstMarkerBox || !markerMoveBox) { console.error("marker target has no box"); process.exit(1) }
const markerMoveYFor = (min) => markerMoveBox.y + 26 + ((min - 420) / 60) * 48
await page.mouse.move(firstMarkerBox.x + firstMarkerBox.width / 2, firstMarkerBox.y + firstMarkerBox.height / 2)
await page.mouse.down()
await page.mouse.move(markerX, markerMoveYFor(630), { steps: 4 })
const movePreview = await page.evaluate(() => {
  const group = document.querySelector('#marker-fixture .modular-diary-marker[data-line="2"]')
  const label = document.querySelector('#marker-fixture .modular-diary-marker-label-bg[data-line="2"]')
  return { group: group?.getAttribute("transform"), label: label?.getAttribute("transform") }
})
if (!movePreview.group || movePreview.group !== movePreview.label) {
  console.error("marker line and note preview moved apart", movePreview); process.exit(1)
}
await page.mouse.up()
const movedMarker = await page.evaluate(() => ({ moved: window.__markerMoved, created: window.__markerCreated }))
if (movedMarker.moved.length !== 1 || movedMarker.moved[0].line !== 2 || movedMarker.moved[0].timeMin !== 630 || movedMarker.created.length !== 1) {
  console.error("selected marker drag fell through to creation", movedMarker); process.exit(1)
}
await firstMarker.click()
await firstMarker.locator(".modular-diary-marker-hit").dblclick({ force: true })
const markerLabel = page.locator('#marker-fixture .modular-diary-marker-label-bg[data-line="2"]')
const markerLabelBox = await markerLabel.boundingBox()
if (!markerLabelBox) { console.error("marker label has no box"); process.exit(1) }
// Obsidian/WebKit can retarget a side-lane SVG contextmenu to the enclosing
// CodeMirror embed, bypassing the inner Modular Diary container entirely.
// The pointer coordinates must still resolve ownership to the marker label,
// otherwise the enclosing Modular Diary Block menu steals the gesture.
await page.locator("#marker-embed-fixture").evaluate((embed, point) => {
  embed.dispatchEvent(new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: point.x,
    clientY: point.y,
  }))
}, { x: markerLabelBox.x + markerLabelBox.width / 2, y: markerLabelBox.y + markerLabelBox.height / 2 })
const markerSecondaryActions = await page.evaluate(() => ({
  notes: window.__markerNotes,
  menus: window.__markerMenus,
  blockMenus: window.__markerBlockMenus,
}))
if (markerSecondaryActions.notes.at(-1) !== 2 || markerSecondaryActions.menus.at(-1)?.line !== 2 || markerSecondaryActions.blockMenus.length !== 0) {
  console.error("marker note/context actions regressed", markerSecondaryActions); process.exit(1)
}
await page.keyboard.press("Escape")
await firstMarker.click()
// In Live Preview the CodeMirror contenteditable keeps DOM focus after a
// rendered SVG marker is selected. That retained focus is widget chrome, not
// an active text editor: the selected marker must still own Delete.
await page.evaluate(() => document.querySelector("#marker-cm-fixture")?.focus())
await page.keyboard.press("Delete")
const markerDeleted = await page.evaluate(() => ({
  editing: window.__markerEditing,
  deleted: window.__markerDeleted,
  active: document.activeElement?.id,
}))
if (markerDeleted.active !== "marker-cm-fixture" || markerDeleted.editing !== null || markerDeleted.deleted.at(-1) !== 2) {
  console.error("marker delete/focus cleanup regressed", markerDeleted); process.exit(1)
}
await firstMarker.click()
await page.evaluate(() => document.querySelector("#marker-cm-fixture")?.focus())
await page.keyboard.press("Backspace")
const markerBackspaceDeleted = await page.evaluate(() => ({
  editing: window.__markerEditing,
  deleted: window.__markerDeleted,
}))
if (markerBackspaceDeleted.editing !== null || markerBackspaceDeleted.deleted.filter((line) => line === 2).length !== 2) {
  console.error("marker Backspace did not share the selected-marker delete contract", markerBackspaceDeleted); process.exit(1)
}
await page.evaluate(() => { document.querySelector("#app").style.width = "780px" })
await setTheme(false)
const wideCreationControls = await page.evaluate(() => {
  const controls = document.querySelector(".modular-diary-creation-controls")
  const categories = document.querySelector(".modular-diary-category-list")
  const tool = document.querySelector(".modular-diary-tool-toggle").getBoundingClientRect()
  const plan = document.querySelector(".modular-diary-plan-mode-toggle").getBoundingClientRect()
  const planTrackEl = document.querySelector(".modular-diary-plan-mode-track")
  const planThumbEl = document.querySelector(".modular-diary-plan-mode-thumb")
  const planTrack = planTrackEl.getBoundingClientRect()
  const planThumb = planThumbEl.getBoundingClientRect()
  const firstCategory = document.querySelector(".modular-diary-swatch[data-type]").getBoundingClientRect()
  const toolbar = document.querySelector(".modular-diary-toolbar").getBoundingClientRect()
  const controlsRect = controls?.getBoundingClientRect()
  const categoriesRect = categories?.getBoundingClientRect()
  const title = document.querySelector(".modular-diary-creation-title")
  const titleRect = title?.getBoundingClientRect()
  const titleStyle = title ? getComputedStyle(title) : null
  return {
    structuredRows: Boolean(controls && categories),
    titleText: title?.textContent?.trim() ?? "",
    titleWeight: Number(titleStyle?.fontWeight ?? 0),
    titleSize: Number.parseFloat(titleStyle?.fontSize ?? "0"),
    componentTitleSize: Number.parseFloat(titleStyle?.getPropertyValue("--modular-diary-component-title-font-size") ?? "0"),
    titleCenter: titleRect ? titleRect.top + titleRect.height / 2 : 0,
    toolTop: tool.top,
    toolCenter: tool.top + tool.height / 2,
    planTop: plan.top,
    categoryTop: firstCategory.top,
    categoryLeft: firstCategory.left,
    toolbarLeft: toolbar.left,
    controlsBottom: controlsRect?.bottom ?? 0,
    controlsRight: controlsRect?.right ?? 0,
    planRight: plan.right,
    categoriesTop: categoriesRect?.top ?? 0,
    planHeight: plan.height,
    categoryHeight: firstCategory.height,
    planTrackWidth: planTrack.width,
    planTrackHeight: planTrack.height,
    planTrackBackground: getComputedStyle(planTrackEl).backgroundColor,
    planThumbWidth: planThumb.width,
    planThumbHeight: planThumb.height,
    planThumbBackground: getComputedStyle(planThumbEl).backgroundColor,
  }
})
if (
  !wideCreationControls.structuredRows ||
  wideCreationControls.titleText !== "添加到时间轴" ||
  wideCreationControls.titleWeight < 500 ||
  Math.abs(wideCreationControls.titleSize - wideCreationControls.componentTitleSize) > 0.1 ||
  Math.abs(wideCreationControls.titleCenter - wideCreationControls.toolCenter) > 0.5 ||
  Math.abs(wideCreationControls.toolTop - wideCreationControls.planTop) > 0.5 ||
  wideCreationControls.categoriesTop <= wideCreationControls.controlsBottom ||
  Math.abs(wideCreationControls.categoryTop - wideCreationControls.categoriesTop) > 0.5 ||
  Math.abs(wideCreationControls.categoryLeft - wideCreationControls.toolbarLeft) > 0.5 ||
  Math.abs(wideCreationControls.planHeight - wideCreationControls.categoryHeight) > 0.5 ||
  Math.abs(wideCreationControls.controlsRight - wideCreationControls.planRight) > 0.5
) {
  console.error("creation tools and categories must occupy two intentional rows", wideCreationControls); process.exit(1)
}
if (
  wideCreationControls.planTrackWidth < 20 ||
  wideCreationControls.planTrackHeight < 12 ||
  wideCreationControls.planThumbWidth < 8 ||
  wideCreationControls.planThumbHeight < 8 ||
  wideCreationControls.planTrackBackground === "rgba(0, 0, 0, 0)" ||
  wideCreationControls.planThumbBackground === "rgba(0, 0, 0, 0)"
) {
  console.error("plan mode switch lost its visible track or thumb", wideCreationControls); process.exit(1)
}
await page.locator(".modular-diary-toolbar").first().screenshot({ path: path.join(out, "toolbar-tool-mode-wide-light.png") })
await setTheme(true)
await page.locator(".modular-diary-toolbar").first().screenshot({ path: path.join(out, "toolbar-tool-mode-wide-dark.png") })
await setTheme(false)
await page.evaluate(() => { document.querySelector("#app").style.width = "360px" })
const narrowCreationControls = await page.evaluate(() => {
  const controls = document.querySelector(".modular-diary-creation-controls").getBoundingClientRect()
  const title = document.querySelector(".modular-diary-creation-title").getBoundingClientRect()
  const tool = document.querySelector(".modular-diary-tool-toggle").getBoundingClientRect()
  const plan = document.querySelector(".modular-diary-plan-mode-toggle").getBoundingClientRect()
  const categories = document.querySelector(".modular-diary-category-list").getBoundingClientRect()
  return {
    sameRow: Math.abs((title.top + title.height / 2) - (tool.top + tool.height / 2)) <= 0.5 && Math.abs(tool.top - plan.top) <= 0.5,
    orderedWithoutOverlap: title.right <= tool.left && tool.right <= plan.left,
    planRightInset: controls.right - plan.right,
    categoriesBelow: categories.top > controls.bottom,
  }
})
if (!narrowCreationControls.sameRow || !narrowCreationControls.orderedWithoutOverlap || Math.abs(narrowCreationControls.planRightInset) > 0.5 || !narrowCreationControls.categoriesBelow) {
  console.error("narrow creation toolbar lost its approved hierarchy", narrowCreationControls); process.exit(1)
}
await page.locator(".modular-diary-toolbar").first().screenshot({ path: path.join(out, "toolbar-tool-mode-narrow-light.png") })
// A split pane too narrow for the copy keeps the whole first row visible:
// geometry buttons go icon-only, then Plan mode keeps only its switch. Every
// control keeps its accessible name, and widening restores the copy.
const readCompaction = () => page.evaluate(() => {
  const toolbar = document.querySelector(".modular-diary-toolbar")
  const controls = toolbar.querySelector(".modular-diary-creation-controls")
  const rect = controls.getBoundingClientRect()
  const plan = toolbar.querySelector(".modular-diary-plan-mode-toggle").getBoundingClientRect()
  const toolButtons = [...toolbar.querySelectorAll(".modular-diary-tool-toggle .modular-diary-mode-btn")]
  return {
    compaction: controls.dataset.compaction,
    overflows: controls.scrollWidth > controls.clientWidth,
    planRightInset: rect.right - plan.right,
    toolCopyVisible: toolButtons.map((button) => button.querySelector(".modular-diary-tool-copy").getBoundingClientRect().width > 0),
    toolSymbolVisible: toolButtons.map((button) => button.querySelector(".modular-diary-tool-symbol").getBoundingClientRect().width > 0),
    toolLabels: toolButtons.map((button) => button.getAttribute("aria-label")),
    planLabelVisible: toolbar.querySelector(".modular-diary-plan-mode-label").getBoundingClientRect().width > 0,
    planLabel: toolbar.querySelector(".modular-diary-plan-mode-toggle").getAttribute("aria-label"),
    categoriesBelow: toolbar.querySelector(".modular-diary-category-list").getBoundingClientRect().top > rect.bottom,
  }
})
await page.evaluate(() => { document.querySelector("#app").style.width = "250px" })
await page.waitForTimeout(80)
const compactTools = await readCompaction()
await page.evaluate(() => { document.querySelector("#app").style.width = "205px" })
await page.waitForTimeout(80)
const compactPlan = await readCompaction()
await page.locator(".modular-diary-toolbar").first().screenshot({ path: path.join(out, "toolbar-tool-mode-compact-light.png") })
await page.evaluate(() => { document.querySelector("#app").style.width = "780px" })
await page.waitForTimeout(80)
const restoredControls = await readCompaction()
if (
  compactTools.compaction !== "1" || compactTools.overflows || Math.abs(compactTools.planRightInset) > 0.5
  || compactTools.toolCopyVisible.some(Boolean) || compactTools.toolSymbolVisible.some((visible) => !visible) || !compactTools.planLabelVisible
  || compactTools.toolLabels.some((label) => !label?.startsWith("使用")) || compactTools.planLabel !== "计划模式" || !compactTools.categoriesBelow
) { console.error("narrow creation row did not compact its geometry copy", compactTools); process.exit(1) }
if (
  compactPlan.compaction !== "2" || compactPlan.overflows || Math.abs(compactPlan.planRightInset) > 0.5
  || compactPlan.toolCopyVisible.some(Boolean) || compactPlan.planLabelVisible || compactPlan.planLabel !== "计划模式" || !compactPlan.categoriesBelow
) { console.error("very narrow creation row did not compact Plan mode", compactPlan); process.exit(1) }
if (restoredControls.compaction !== "0" || restoredControls.toolCopyVisible.some((visible) => !visible) || !restoredControls.planLabelVisible) {
  console.error("widening did not restore the creation row copy", restoredControls); process.exit(1)
}
await browser.close()
console.log("OK draw smoke passed")
