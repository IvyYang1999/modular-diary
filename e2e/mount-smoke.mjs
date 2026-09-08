/**
 * Full-mount smoke: polyfill the Obsidian DOM helpers our code uses,
 * run renderTimelineInto on a doc with text section, assert every slot
 * has visible content. (Blank-block-after-restart reproducer.)
 */
import esbuild from "esbuild"
import { chromium } from "playwright"
import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"
import os from "node:os"

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(os.tmpdir(), "oneday-mount-smoke")
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })

fs.writeFileSync(path.join(out, "entry.ts"), `
import { parseTimeline } from "${path.join(here, "../src/core/parser")}"
import { attachInlineTextEditor, flushInlineTextEditors, renderTimelineInto } from "${path.join(here, "../src/render/timeline-view")}"
import { attachGridInteract } from "${path.join(here, "../src/edit/grid-interact")}"
import { applyGridToBody } from "${path.join(here, "../src/edit/grid-interact")}"
import { compactGrid, GRID_ROW_H, gridRows } from "${path.join(here, "../src/core/grid-layout")}"
import { attachWidthHandle } from "${path.join(here, "../src/edit/width-handle")}"
import { attachBlockResize } from "${path.join(here, "../src/edit/block-resize")}"
import { openTimePopover } from "${path.join(here, "../src/edit/time-popover")}"
import { buildTimelineDateControl } from "${path.join(here, "../src/edit/date-control")}"
import { buildLayerToggles, buildToolbar } from "${path.join(here, "../src/edit/toolbar")}"
import { TIMELINE_SLOT_CHROME_H } from "${path.join(here, "../src/render/timeline-view")}"
import { defaultComponentSlot, HABITS_EMPTY_ROWS } from "${path.join(here, "../src/core/grid-layout")}"
import { captureViewportAnchor, restoreViewportAnchor } from "${path.join(here, "../src/edit/viewport-anchor")}"
import { captureInternalScroll, restoreInternalScroll, stabilizeInternalScroll } from "${path.join(here, "../src/edit/internal-scroll")}"

// minimal Obsidian DOM helper polyfills
HTMLElement.prototype.createDiv = function (opts = {}) {
  const d = document.createElement("div")
  if (opts.cls) d.className = opts.cls
  if (opts.text) d.textContent = opts.text
  this.appendChild(d)
  return d
}
HTMLElement.prototype.createEl = function (tag, opts = {}) {
  const d = document.createElement(tag)
  if (opts.cls) d.className = opts.cls
  if (opts.text) d.textContent = opts.text
  if (opts.attr) for (const [k, v] of Object.entries(opts.attr)) d.setAttribute(k, v)
  this.appendChild(d)
  return d
}
HTMLElement.prototype.addClass = function (c) { this.classList.add(c) }
HTMLElement.prototype.empty = function () { this.replaceChildren() }
window.createDiv = function (opts = {}) { return document.body.createDiv(opts) }
window.__stabilizeInternalScroll = stabilizeInternalScroll

const quickInput = document.createElement("textarea")
quickInput.className = "oneday-dialog-input"
quickInput.setAttribute("aria-label", "快速记录测试")
document.body.appendChild(quickInput)

const retryPane = document.createElement("div")
retryPane.id = "failed-save-retry-pane"
retryPane.className = "oneday-text-pane"
document.body.appendChild(retryPane)
window.__retryTextSaves = []
let rejectFirstTextSave = true
attachInlineTextEditor(retryPane, "第一句。\\n第二句。\\n第三句。\\n第四句。", {
  renderMarkdown: (host, text) => { host.textContent = text },
  onSave: (text) => {
    window.__retryTextSaves.push(text)
    if (rejectFirstTextSave) {
      rejectFirstTextSave = false
      return Promise.reject(new Error("intentional first-save failure"))
    }
  },
})

let remountPane = null
let remountDraft = null
let finishRemountSave
const remountSave = new Promise((resolve) => { finishRemountSave = resolve })
const mountRemountPane = () => {
  const pane = document.createElement("div")
  pane.id = "save-before-remount-pane"
  pane.className = "oneday-text-pane"
  document.body.appendChild(pane)
  attachInlineTextEditor(pane, "重绘前", {
    renderMarkdown: (host, text) => { host.textContent = text },
    onSave: () => remountSave,
    initialDraft: remountDraft,
    onDraftChange: (draft) => { remountDraft = draft },
  })
  remountPane = pane
  return pane
}
mountRemountPane()
window.__flushBeforeRemount = () => flushInlineTextEditors(remountPane)
window.__finishRemountSave = () => finishRemountSave()
window.__replaceRemountDraftPane = () => {
  remountPane.remove()
  return mountRemountPane()
}

const source = "date: 2026-08-18\\nrange: 7-23\\n---\\n09:15-12:15 math 李林线代\\n12:15-13:30 meal 午饭\\n===\\n" +
  Array.from({ length: 30 }, (_, i) => \`第\${i + 1}行 长文字滚动测试\`).join("\\n")
const doc = parseTimeline(source)
const el = document.getElementById("host")
window.__textSaves = []
// Reproduce Obsidian's mount timing: the block may be attached before the
// preview pane has a measurable layout box.
el.style.display = "none"
try {
  renderTimelineInto(el, doc, { typeColors: { math: "#7fd4c1", meal: "#f5a3b7" } }, {
    renderMarkdown: (host, text) => { host.textContent = text },
    onSave: (index, text) => window.__textSaves.push({ index, text }),
  })
  attachGridInteract(el.querySelector(".oneday-body"), () => {})
  attachWidthHandle(el.querySelector(".oneday-container"), doc.width ?? 200, () => {})
  window.__blockSizes = []
  window.__blockResizeEvents = []
  attachBlockResize(el.querySelector(".oneday-container"), el.querySelector(".oneday-body"), {
    initialSize: doc.blockSize,
    initialCanvasWidth: doc.canvasWidth,
    onStart: () => {
      const interaction = {
        id: "captured-before-preview",
        internal: captureInternalScroll(el.querySelector(".oneday-container")),
      }
      window.__blockResizeEvents.push("start")
      return interaction
    },
    onPreview: (interaction) => window.__blockResizeEvents.push("preview:" + interaction.id),
    onCommit: (size, canvasWidth, interaction) => {
      window.__blockResizeEvents.push("commit:" + (interaction?.id ?? ""))
      window.__blockSizes.push({ size, canvasWidth })
    },
    onCancel: (interaction) => {
      window.__blockResizeEvents.push("cancel:" + interaction.id)
      restoreInternalScroll(interaction.internal, el.querySelector(".oneday-container"))
    },
  })
  requestAnimationFrame(() => { el.style.display = "" })
  window.__timeSaved = []
  window.__openTimePopover = () => {
    const container = el.querySelector(".oneday-container")
    const anchor = container.querySelector("rect.oneday-block")
    openTimePopover(container, anchor, anchor.getBoundingClientRect(), {
      start: "09:15",
      end: "12:15",
    }, (start, end) => window.__timeSaved.push({ start, end }))
  }
  const dateTopbar = document.createElement("div")
  dateTopbar.id = "editable-date-fixture"
  dateTopbar.className = "oneday-timeline-topbar"
  dateTopbar.style.width = "320px"
  window.__dateSaved = []
  dateTopbar.appendChild(buildTimelineDateControl(
    el.querySelector(".oneday-container"),
    "2026-08-18",
    "周二",
    (date) => window.__dateSaved.push(date),
  ))
  const dateNeighbor = document.createElement("div")
  dateNeighbor.className = "oneday-date-neighbor-fixture"
  dateNeighbor.textContent = "记录 / 计划"
  dateTopbar.appendChild(dateNeighbor)
  document.body.prepend(dateTopbar)
  window.__ok = true
} catch (err) {
  window.__error = String(err && err.stack || err)
}

// Isolated cancel fixture: a live resize may clamp every nested scroller.
// pointercancel must restore their exact pre-gesture offsets.
const cancelHost = document.createElement("div")
cancelHost.id = "block-resize-cancel-fixture"
cancelHost.style.cssText = "position:fixed;left:-10000px;top:0;width:900px"
document.body.appendChild(cancelHost)
const cancelContainer = renderTimelineInto(cancelHost, doc, {
  typeColors: { math: "#7fd4c1", meal: "#f5a3b7" },
}, {
  renderMarkdown: (host, text) => { host.textContent = text },
  onSave: () => {},
})
const cancelBody = cancelContainer.querySelector(".oneday-body")
const cancelTimeline = cancelContainer.querySelector(".oneday-svg-holder")
const cancelOverflow = document.createElement("div")
cancelOverflow.style.cssText = "width:1400px;height:1400px;pointer-events:none"
cancelTimeline.appendChild(cancelOverflow)
window.__cancelResizeEvents = []
attachBlockResize(cancelContainer, cancelBody, {
  initialSize: { width: 360, height: 260 },
  initialCanvasWidth: 900,
  onStart: () => {
    window.__cancelResizeEvents.push("start")
    return captureInternalScroll(cancelContainer)
  },
  onCommit: () => {},
  onCancel: (snapshot) => {
    restoreInternalScroll(snapshot, cancelContainer)
    window.__cancelResizeEvents.push("cancel")
  },
})

window.__mountEmptyState = () => {
  const emptyHost = document.createElement("div")
  emptyHost.id = "empty-host"
  emptyHost.style.width = "700px"
  document.body.appendChild(emptyHost)
  const emptyDoc = parseTimeline("date: 2026-08-21\\n---")
  const emptyContainer = renderTimelineInto(emptyHost, emptyDoc, {
    typeColors: { math: "#7fd4c1" },
    showTimelineOnboarding: true,
  })
  attachGridInteract(emptyContainer.querySelector(".oneday-body"), () => {})
  const persistentHost = document.createElement("div")
  persistentHost.id = "persistent-empty-host"
  persistentHost.style.width = "700px"
  document.body.appendChild(persistentHost)
  renderTimelineInto(persistentHost, emptyDoc, { typeColors: { math: "#7fd4c1" } })
  const narrowGuideHost = document.createElement("div")
  narrowGuideHost.id = "narrow-guide-host"
  narrowGuideHost.style.width = "420px"
  document.body.appendChild(narrowGuideHost)
  renderTimelineInto(narrowGuideHost, emptyDoc, {
    typeColors: { math: "#7fd4c1" },
    width: 140,
    showTimelineOnboarding: true,
  })
  const noPaletteHost = document.createElement("div")
  noPaletteHost.id = "no-palette-timeline-host"
  noPaletteHost.style.width = "420px"
  document.body.appendChild(noPaletteHost)
  const noPaletteContainer = renderTimelineInto(noPaletteHost, emptyDoc, {
    typeColors: {},
    showTimelineOnboarding: true,
  })
  const emptyToolbar = buildToolbar({
    typeColors: {}, hiddenTypes: [], activeType: "", brushMode: "actual",
    onBrushModeChange: () => {}, onSelect: () => {}, onHide: () => {}, onShow: () => {},
    onAddNew: () => {},
  })
  const noPaletteToolbarSlot = noPaletteContainer.querySelector(".oneday-slot-toolbar")
  noPaletteToolbarSlot.classList.remove("is-empty-state")
  noPaletteToolbarSlot.appendChild(emptyToolbar.el)
  // Production runs fitSlotHeights after the toolbar is mounted. Mirror that
  // lifecycle here: the creation controls stay visible above the empty
  // category CTA, so the legacy three-row shell must grow before hit testing.
  const noPaletteBody = noPaletteContainer.querySelector(".oneday-body")
  const need = Math.ceil(noPaletteToolbarSlot.scrollHeight / GRID_ROW_H)
  if (need > Number(noPaletteToolbarSlot.dataset.h)) {
    noPaletteToolbarSlot.dataset.h = String(need)
    const items = compactGrid([...noPaletteBody.querySelectorAll(".oneday-slot")].map((slot) => ({
      id: slot.dataset.slot,
      x: Number(slot.dataset.x), y: Number(slot.dataset.y),
      w: Number(slot.dataset.w), h: Number(slot.dataset.h),
    })))
    applyGridToBody(noPaletteBody, items)
    noPaletteBody.style.height = String(gridRows(items) * GRID_ROW_H) + "px"
  }
  attachGridInteract(noPaletteBody, () => {})
}

// Production mounts a date/layer topbar above the SVG holder and the draw
// status line below it (main.ts). The default timeline slot height must
// reserve that chrome so the whole range is visible without internal scroll.
window.__mountDefaultTimelineFixture = (hostWidth) => {
  document.querySelector("#default-timeline-fixture")?.remove()
  // renderTimelineInto forces the host itself to 100%, so the viewport
  // width lives on a wrapper like Obsidian's editor pane.
  const pane = document.createElement("div")
  pane.id = "default-timeline-fixture"
  pane.style.width = hostWidth + "px"
  document.body.appendChild(pane)
  const host = document.createElement("div")
  pane.appendChild(host)
  const fixtureDoc = parseTimeline("date: 2026-08-18\\nrange: 7-23\\n---\\n09:15-12:15 math 李林线代\\n22:21-22:51 meal 健身\\n@21:40 [wake] 头晕，脑力低，提前收工\\n===\\n明日 to do")
  const container = renderTimelineInto(host, fixtureDoc, {
    typeColors: { math: "#7fd4c1", meal: "#f5a3b7" },
    markerTypeColors: { wake: "#6f8cff" },
    // The same optional components main.ts requests for a day with habits,
    // todos and a daily quote.
    extraSlots: [
      defaultComponentSlot("habits", Math.max(HABITS_EMPTY_ROWS, 3 * 2 + 2), fixtureDoc.side),
      defaultComponentSlot("todos", Math.max(5, 3 * 2 + 3), fixtureDoc.side),
      defaultComponentSlot("quote", 8, fixtureDoc.side),
    ],
  }, {
    renderMarkdown: (target, text) => { target.textContent = text },
    onSave: () => {},
  })
  const toolbar = buildToolbar({
    typeColors: { math: "#7fd4c1", meal: "#f5a3b7" }, hiddenTypes: [], activeType: "math", brushMode: "actual",
    onBrushModeChange: () => {}, onSelect: () => {}, onHide: () => {}, onShow: () => {}, onAddNew: () => {},
  })
  container.querySelector(".oneday-slot-toolbar").appendChild(toolbar.el)
  const timelineSlot = container.querySelector(".oneday-slot-timeline")
  timelineSlot.appendChild(toolbar.statusEl)
  const topbar = document.createElement("div")
  topbar.className = "oneday-timeline-topbar"
  topbar.appendChild(buildTimelineDateControl(container, "2026-08-18", "周二", () => {}))
  topbar.appendChild(buildLayerToggles({ actual: true, plan: true }, () => {}))
  timelineSlot.prepend(topbar)
  attachGridInteract(container.querySelector(".oneday-body"), () => {})
  const holder = timelineSlot.querySelector(".oneday-svg-holder")
  const hours = [...timelineSlot.querySelectorAll("text.oneday-hour")]
  const lastHour = hours[hours.length - 1]
  const holderRect = holder.getBoundingClientRect()
  const svg = timelineSlot.querySelector("svg.oneday-svg")
  const chrome = timelineSlot.getBoundingClientRect().height - holderRect.height
  const timelineRect = timelineSlot.getBoundingClientRect()
  const components = Object.fromEntries(["habits", "todos", "quote"].map((id) => {
    const rect = container.querySelector(".oneday-slot-" + id).getBoundingClientRect()
    return [id, { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }]
  }))
  return {
    timelineRect: { top: timelineRect.top, bottom: timelineRect.bottom, left: timelineRect.left, right: timelineRect.right },
    bodyBottom: container.querySelector(".oneday-body").getBoundingClientRect().bottom,
    hostWidth: host.getBoundingClientRect().width,
    components,
    slotRows: Number(timelineSlot.dataset.h),
    slotHeight: timelineSlot.getBoundingClientRect().height,
    svgHeight: Number(svg.getAttribute("height")),
    chrome,
    chromeAllowance: TIMELINE_SLOT_CHROME_H,
    holderClientHeight: holder.clientHeight,
    holderScrollHeight: holder.scrollHeight,
    holderScrollTop: holder.scrollTop,
    lastHourLabel: lastHour.textContent,
    lastHourBottom: lastHour.getBoundingClientRect().bottom,
    holderBottom: holderRect.bottom,
    lastHourVisible: lastHour.getBoundingClientRect().bottom <= holderRect.bottom + 0.5,
  }
}

window.__mountToolbarAlignmentFixtures = () => {
  document.querySelector("#toolbar-alignment-fixtures")?.remove()
  const fixture = document.createElement("div")
  fixture.id = "toolbar-alignment-fixtures"
  fixture.className = "oneday-container"
  fixture.style.cssText = "display:flex;gap:12px;width:1200px"
  const spanColors = { develop: "#55b8d8", media: "#ef777a", sport: "#ffb534" }
  const mount = (id, drawTool, markerTypeColors) => {
    const host = document.createElement("div")
    host.style.cssText = "position:relative;width:380px;height:240px"
    const slot = document.createElement("div")
    slot.id = id
    slot.className = "oneday-slot oneday-slot-toolbar"
    slot.style.cssText = "inset:0"
    const handle = buildToolbar({
      typeColors: spanColors,
      markerTypeColors,
      hiddenTypes: [],
      markerHiddenTypes: [],
      activeType: "develop",
      activeMarkerType: Object.keys(markerTypeColors)[0] ?? "",
      brushMode: "actual",
      drawTool,
      onBrushModeChange: () => {}, onSelect: () => {}, onHide: () => {}, onShow: () => {}, onAddNew: () => {},
    })
    slot.appendChild(handle.el)
    host.appendChild(slot)
    fixture.appendChild(host)
  }
  mount("toolbar-span-populated", "span", { deadline: "#ef5b72" })
  mount("toolbar-marker-empty", "marker", {})
  mount("toolbar-marker-single", "marker", { deadline: "#ef5b72" })
  document.body.appendChild(fixture)
}

window.__verifyViewportAnchor = () => {
  const outer = document.createElement("div")
  outer.style.cssText = "height:180px;width:320px;overflow:auto;position:fixed;left:-10000px;top:0"
  const before = document.createElement("div")
  before.style.height = "300px"
  const host = document.createElement("div")
  host.className = "oneday-host"
  host.style.height = "260px"
  const after = document.createElement("div")
  after.style.height = "300px"
  outer.append(before, host, after)
  document.body.appendChild(outer)
  outer.scrollTop = 260
  const top = host.getBoundingClientRect().top
  const anchor = captureViewportAnchor(host)
  const replacement = host.cloneNode(true)
  before.style.height = "420px"
  host.replaceWith(replacement)
  restoreViewportAnchor(anchor, replacement)
  const result = {
    beforeTop: top,
    afterTop: replacement.getBoundingClientRect().top,
    scrollTop: outer.scrollTop,
    overflowAnchor: getComputedStyle(replacement).overflowAnchor,
  }
  outer.remove()
  return result
}
`)
await esbuild.build({
  entryPoints: [path.join(out, "entry.ts")],
  bundle: true, format: "iife", logLevel: "silent",
  outfile: path.join(out, "bundle.js"),
})
const css = fs.readFileSync(path.join(here, "../styles.css"), "utf8")
const html = `<!doctype html><html><head><meta charset="utf-8"><style>.cm-embed-block{border:1px solid rgb(90,90,90);box-shadow:0 0 0 1px rgb(90,90,90)}</style><style>${css}</style></head><body><div class="cm-embed-block"><div id="host" style="width:700px"></div></div><script>${fs.readFileSync(path.join(out, "bundle.js"), "utf8")}</script></body></html>`
fs.writeFileSync(path.join(out, "index.html"), html)

const browser = await chromium.launch()
const page = await browser.newPage()
page.on("pageerror", (e) => console.error("[pageerror]", e.message))
page.on("console", (m) => { if (m.type() === "error") console.error("[console]", m.text()) })
await page.goto("file://" + path.join(out, "index.html"))
// ONEDAY_SMOKE_CLASSIC_SCROLLBARS=1 reproduces Linux CI on macOS: styling
// ::-webkit-scrollbar switches Chromium from overlay to classic scrollbars,
// which occupy a 15px gutter inside every overflow:auto box.
if (process.env.ONEDAY_SMOKE_CLASSIC_SCROLLBARS) await page.addStyleTag({ content: "::-webkit-scrollbar{width:15px;height:15px}::-webkit-scrollbar-thumb{background:#bbb}" })
await page.evaluate(() => {
  document.documentElement.style.setProperty("--background-modifier-hover", "rgb(224, 224, 224)")
  document.documentElement.style.setProperty("--background-modifier-border", "rgb(120, 120, 120)")
  document.documentElement.style.setProperty("--background-primary", "rgb(255, 255, 255)")
  document.documentElement.style.setProperty("--background-secondary", "rgb(238, 238, 238)")
  document.documentElement.style.setProperty("--button-radius", "7px")
  document.documentElement.style.setProperty("--interactive-accent", "rgb(148, 104, 230)")
  document.documentElement.style.setProperty("--text-on-accent", "rgb(255, 255, 255)")
  document.documentElement.style.setProperty("--text-normal", "rgb(32, 32, 32)")
  document.documentElement.style.setProperty("--text-accent", "rgb(128, 80, 220)")
  document.documentElement.style.setProperty("--text-muted", "rgb(96, 96, 96)")
})
await page.waitForTimeout(300)

const viewportAnchor = await page.evaluate(() => window.__verifyViewportAnchor())

// Shared vertical-rhythm contract: slots are quantized to 20px grid rows, so
// fitted content must split the leftover space evenly. Overflowing content
// remains top-aligned so the beginning is always reachable by scrolling.
await page.evaluate(() => {
  const fixture = document.createElement("section")
  fixture.id = "vertical-rhythm-fixture"
  fixture.className = "oneday-container"
  fixture.style.cssText = "width:680px;padding:12px;gap:10px"

  const addGrip = (slot) => {
    const anchor = document.createElement("div")
    anchor.className = "oneday-slot-grip-anchor"
    const grip = document.createElement("button")
    grip.className = "oneday-slot-grip"
    grip.style.opacity = "1"
    for (let i = 0; i < 6; i += 1) grip.appendChild(document.createElement("span"))
    anchor.appendChild(grip)
    slot.appendChild(anchor)
  }
  const addSlot = (id, height) => {
    const slot = document.createElement("div")
    slot.className = `oneday-slot oneday-slot-${id}`
    slot.dataset.fixtureSlot = id
    slot.style.cssText = `position:relative;width:100%;height:${height}px`
    addGrip(slot)
    fixture.appendChild(slot)
    return slot
  }

  const dialogSlot = addSlot("dialog", 100)
  const dialog = document.createElement("div")
  dialog.className = "oneday-dialog"
  const input = document.createElement("textarea")
  input.className = "oneday-dialog-input"
  input.rows = 1
  input.placeholder = "快速记录：刚健身半小时…"
  dialog.appendChild(input)
  dialogSlot.appendChild(dialog)

  const toolbarSlot = addSlot("toolbar", 190)
  const toolbar = document.createElement("div")
  toolbar.className = "oneday-toolbar"
  const toolbarLabel = document.createElement("span")
  toolbarLabel.className = "oneday-toggle-label"
  toolbarLabel.textContent = "新增为"
  toolbar.appendChild(toolbarLabel)
  const mode = document.createElement("span")
  mode.className = "oneday-mode oneday-brush-toggle"
  for (const [label, active] of [["记录", true], ["计划", false]]) {
    const button = document.createElement("button")
    button.className = `oneday-mode-btn oneday-brush-btn${active ? " is-active" : ""}`
    button.textContent = label
    mode.appendChild(button)
  }
  toolbar.appendChild(mode)
  for (const [index, label] of ["开发", "自媒体", "运动", "睡觉", "阅读", "生活", "wasted", "看剧", "画画", "写作", "游泳", "信息摄取", "战略思考", "环境搭建", "洗澡", "聊天", "发布产品", "复盘反思", "装修", "按摩", "出门"].entries()) {
    const button = document.createElement("button")
    button.className = `oneday-swatch${index === 0 ? " is-active" : ""}`
    const dot = document.createElement("span")
    dot.className = "oneday-swatch-dot"
    dot.style.setProperty("--c", `hsl(${index * 31} 65% 55%)`)
    button.append(dot, label)
    toolbar.appendChild(button)
  }
  toolbarSlot.appendChild(toolbar)

  const statsSlot = addSlot("stats", 220)
  const stats = document.createElement("div")
  stats.className = "oneday-stats"
  for (const [index, label] of ["出门", "开发", "装修", "睡觉", "生活", "wasted", "运动"].entries()) {
    const row = document.createElement("div")
    row.className = "oneday-stat-row"
    const type = document.createElement("span")
    type.className = "oneday-stat-type"
    type.textContent = label
    const track = document.createElement("div")
    track.className = "oneday-stat-bar-wrap"
    const bar = document.createElement("div")
    bar.className = "oneday-stat-bar"
    bar.style.width = `${95 - index * 11}%`
    bar.style.background = `hsl(${index * 49} 58% 60%)`
    track.appendChild(bar)
    row.append(type, track)
    stats.appendChild(row)
  }
  statsSlot.appendChild(stats)

  const overflowSlot = addSlot("toolbar", 58)
  overflowSlot.id = "vertical-overflow-slot"
  const overflowToolbar = toolbar.cloneNode(true)
  overflowSlot.appendChild(overflowToolbar)
  document.body.appendChild(fixture)
})
await page.waitForTimeout(50)

const verticalRhythm = await page.evaluate(() => {
  const visibleRects = (root, selector) => [...root.querySelectorAll(selector)]
    .map((node) => node.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0)
  const measure = (slotSelector, itemSelector) => {
    const slot = document.querySelector(slotSelector)
    const slotRect = slot.getBoundingClientRect()
    const style = getComputedStyle(slot)
    const rects = visibleRects(slot, itemSelector)
    const innerTop = slotRect.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop)
    const innerBottom = slotRect.bottom - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom)
    const contentTop = Math.min(...rects.map((rect) => rect.top))
    const contentBottom = Math.max(...rects.map((rect) => rect.bottom))
    const top = contentTop - innerTop
    const bottom = innerBottom - contentBottom
    return {
      top,
      bottom,
      delta: Math.abs(top - bottom),
      paddingTop: parseFloat(style.paddingTop),
      paddingBottom: parseFloat(style.paddingBottom),
    }
  }
  const overflowSlot = document.querySelector("#vertical-overflow-slot")
  const overflowStyle = getComputedStyle(overflowSlot)
  const overflowInnerTop = overflowSlot.getBoundingClientRect().top
    + parseFloat(overflowStyle.borderTopWidth) + parseFloat(overflowStyle.paddingTop)
  const overflowFirstTop = Math.min(...visibleRects(overflowSlot, ".oneday-toolbar > *").map((rect) => rect.top))
  return {
    dialog: measure("#vertical-rhythm-fixture .oneday-slot-dialog", ".oneday-dialog-input"),
    toolbar: measure("#vertical-rhythm-fixture .oneday-slot-toolbar:not(#vertical-overflow-slot)", ".oneday-toolbar > *"),
    stats: measure("#vertical-rhythm-fixture .oneday-slot-stats", ".oneday-stat-row"),
    overflow: {
      startsAtTop: Math.abs(overflowFirstTop - overflowInnerTop) <= 1,
      scrolls: overflowSlot.scrollHeight > overflowSlot.clientHeight,
    },
  }
})
await page.locator("#vertical-rhythm-fixture").screenshot({ path: path.join(out, "vertical-rhythm-light.png") })

const textSaveRetry = await page.evaluate(async () => {
  const pane = document.getElementById("failed-save-retry-pane")
  pane.click()
  const textarea = pane.querySelector("textarea")
  textarea.value += "\\n第五句。"
  textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "第五句。" }))
  window.dispatchEvent(new Event("blur"))
  await new Promise((resolve) => setTimeout(resolve, 0))
  const afterFailure = {
    textareaKept: pane.querySelector("textarea") === textarea,
    value: textarea.value,
    attempts: window.__retryTextSaves.length,
  }
  window.dispatchEvent(new Event("blur"))
  await new Promise((resolve) => setTimeout(resolve, 0))
  const result = { afterFailure, attempts: [...window.__retryTextSaves] }
  pane.remove()
  return result
})

const textSaveBeforeRemount = await page.evaluate(async () => {
  const pane = document.getElementById("save-before-remount-pane")
  pane.click()
  const textarea = pane.querySelector("textarea")
  textarea.value = "重绘期间也不能丢"
  textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "重绘期间也不能丢" }))
  const flush = window.__flushBeforeRemount()
  let settled = false
  Promise.resolve(flush).then(() => { settled = true })
  await Promise.resolve()
  const waitedForSave = !settled
  const replacement = window.__replaceRemountDraftPane()
  const restored = replacement.querySelector("textarea")
  const draftSurvived = restored?.value === "重绘期间也不能丢"
  window.__finishRemountSave()
  await Promise.resolve(flush)
  const valueAfterSave = restored?.value ?? null
  replacement.remove()
  return { returnedPromise: flush instanceof Promise, waitedForSave, draftSurvived, valueAfterSave }
})

// The edit-code button must stay hidden even if an Obsidian/theme rule loaded
// later reasserts display:flex, or a renderer version inserts a control wrapper.
const nestedEditButtonDisplay = await page.evaluate(() => {
  const sourceView = document.createElement("div")
  sourceView.className = "markdown-source-view mod-cm6"
  const block = document.createElement("div")
  block.className = "cm-embed-block"
  const content = document.createElement("div")
  const host = document.createElement("div")
  host.className = "oneday-host"
  content.appendChild(host)
  const controls = document.createElement("div")
  const button = document.createElement("div")
  button.className = "edit-block-button"
  controls.appendChild(button)
  block.append(content, controls)
  sourceView.appendChild(block)
  document.body.appendChild(sourceView)
  const appRule = document.createElement("style")
  appRule.textContent = ".markdown-source-view.mod-cm6 .edit-block-button { display: flex; }"
  document.head.appendChild(appRule)
  const display = getComputedStyle(button).display
  sourceView.remove()
  appRule.remove()
  return display
})

const state = await page.evaluate(() => ({
  ok: window.__ok ?? false,
  error: window.__error ?? null,
  timelineLabelStates: (() => {
    const ns = "http://www.w3.org/2000/svg"
    const svg = document.createElementNS(ns, "svg")
    svg.classList.add("oneday-svg")
    const actualBlock = document.createElementNS(ns, "rect")
    actualBlock.classList.add("oneday-block")
    const planBlock = document.createElementNS(ns, "rect")
    planBlock.classList.add("oneday-block")
    const actualLabel = document.createElementNS(ns, "text")
    actualLabel.classList.add("oneday-duration")
    actualLabel.style.fill = "rgb(32, 32, 32)"
    const planLabel = document.createElementNS(ns, "text")
    planLabel.classList.add("oneday-duration", "oneday-plan-label")
    svg.append(actualBlock, planBlock, actualLabel, planLabel)
    document.body.appendChild(svg)
    const read = () => ({
      actualText: getComputedStyle(actualLabel).fill,
      planText: getComputedStyle(planLabel).fill,
      actualStroke: getComputedStyle(actualBlock).stroke,
      planStroke: getComputedStyle(planBlock).stroke,
    })
    const rest = read()
    actualBlock.classList.add("is-hover")
    planBlock.classList.add("is-hover")
    actualLabel.classList.add("is-hover")
    planLabel.classList.add("is-hover")
    const hover = read()
    for (const node of [actualBlock, planBlock, actualLabel, planLabel]) {
      node.classList.remove("is-hover")
      node.classList.add("is-focus")
    }
    const focus = read()
    svg.remove()
    return { rest, hover, focus }
  })(),
  nativeTitleCount: document.querySelectorAll(".oneday-container [title]").length,
  gripAriaLabel: document.querySelector(".oneday-slot-grip")?.getAttribute("aria-label"),
  gripStyle: (() => {
    const style = getComputedStyle(document.querySelector(".oneday-slot-grip"))
    return { appearance: style.appearance, background: style.backgroundColor, shadow: style.boxShadow }
  })(),
  gripAlignment: (() => {
    const read = (slot) => {
      const grip = slot?.querySelector(":scope > .oneday-slot-grip-anchor > .oneday-slot-grip")
      if (!slot || !grip) return null
      const slotRect = slot.getBoundingClientRect()
      const gripRect = grip.getBoundingClientRect()
      return {
        top: gripRect.top - slotRect.top,
        left: gripRect.left - slotRect.left,
      }
    }
    return {
      dialog: read(document.querySelector("#host .oneday-slot-dialog")),
      timeline: read(document.querySelector("#host .oneday-slot-timeline")),
    }
  })(),
  toolbarNeutrals: (() => {
    const toolbar = document.createElement("div")
    toolbar.className = "oneday-toolbar"
    const toolToggle = document.createElement("span")
    toolToggle.className = "oneday-mode oneday-tool-toggle"
    const inactive = document.createElement("button")
    inactive.className = "oneday-mode-btn"
    const planToggle = document.createElement("button")
    planToggle.className = "oneday-plan-mode-toggle oneday-brush-toggle is-plan"
    const planTrack = document.createElement("span")
    planTrack.className = "oneday-plan-mode-track"
    const planThumb = document.createElement("span")
    planThumb.className = "oneday-plan-mode-thumb"
    planTrack.appendChild(planThumb)
    planToggle.appendChild(planTrack)
    const swatch = document.createElement("button")
    swatch.className = "oneday-swatch"
    const activeSwatch = document.createElement("button")
    activeSwatch.className = "oneday-swatch is-active"
    const viewGroup = document.createElement("span")
    viewGroup.className = "oneday-view-toggle oneday-mode"
    const viewButton = document.createElement("button")
    viewButton.className = "oneday-mode-btn"
    viewGroup.appendChild(viewButton)
    toolToggle.appendChild(inactive)
    toolbar.append(toolToggle, planToggle, swatch, activeSwatch, viewGroup)
    document.querySelector(".oneday-container").appendChild(toolbar)
    const result = {
      inactive: getComputedStyle(inactive).backgroundColor,
      swatch: getComputedStyle(swatch).backgroundColor,
      modeBorder: getComputedStyle(toolToggle).borderColor,
      swatchBorder: getComputedStyle(swatch).borderColor,
      activeSwatchBorder: getComputedStyle(activeSwatch).borderColor,
      inactiveHeight: inactive.getBoundingClientRect().height,
      toggleHeight: toolToggle.getBoundingClientRect().height,
      planHeight: planToggle.getBoundingClientRect().height,
      planTrackBackground: getComputedStyle(planTrack).backgroundColor,
      planThumbBackground: getComputedStyle(planThumb).backgroundColor,
      swatchHeight: swatch.getBoundingClientRect().height,
      viewButtonHeight: viewButton.getBoundingClientRect().height,
    }
    toolbar.remove()
    return result
  })(),
  designSystem: (() => {
    const container = document.querySelector(".oneday-container")
    const slot = container.querySelector(".oneday-slot")
    const grip = container.querySelector(".oneday-slot-grip")
    if (!slot || !grip) {
      return { missing: true }
    }
    const fixture = document.createElement("div")
    fixture.style.position = "fixed"
    fixture.style.left = "-10000px"
    const action = document.createElement("button")
    action.className = "oneday-more-actions"
    const toolbar = document.createElement("div")
    toolbar.className = "oneday-toolbar"
    const swatch = document.createElement("button")
    swatch.className = "oneday-swatch"
    toolbar.appendChild(swatch)
    const viewGroup = document.createElement("span")
    viewGroup.className = "oneday-view-toggle oneday-mode"
    const viewButton = document.createElement("button")
    viewButton.className = "oneday-mode-btn"
    viewGroup.appendChild(viewButton)
    const statTrack = document.createElement("div")
    statTrack.className = "oneday-stat-bar-wrap"
    fixture.append(action, toolbar, viewGroup, statTrack)
    container.appendChild(fixture)
    const style = (el) => getComputedStyle(el)
    const result = {
      missing: false,
      radii: {
        container: style(container).borderRadius,
        slot: style(slot).borderRadius,
        grip: style(grip).borderRadius,
        swatch: style(swatch).borderRadius,
        action: style(action).borderRadius,
        viewGroup: style(viewGroup).borderRadius,
        viewButton: style(viewButton).borderRadius,
        statTrack: style(statTrack).borderRadius,
      },
      surfaces: {
        grip: style(grip).backgroundColor,
        swatch: style(swatch).backgroundColor,
        action: style(action).backgroundColor,
        viewGroup: style(viewGroup).backgroundColor,
        statTrack: style(statTrack).backgroundColor,
      },
      actionOpacity: style(action).opacity,
    }
    fixture.remove()
    return result
  })(),
  contentInsets: (() => {
    const container = document.querySelector(".oneday-container")
    const fixture = document.createElement("div")
    fixture.style.cssText = "position:fixed;left:-10000px;top:0"
    container.appendChild(fixture)
    const specs = [
      ["dialog", "oneday-dialog"],
      ["toolbar", "oneday-toolbar"],
      ["stats", "oneday-stats"],
      ["text", "oneday-text-pane"],
    ]
    const offsets = {}
    let toolbarGripGap = null
    for (const [id, childClass] of specs) {
      const slot = document.createElement("div")
      slot.className = `oneday-slot oneday-slot-${id}`
      slot.dataset.slot = id
      slot.style.cssText = "position:relative;width:320px;height:48px"
      const child = document.createElement("div")
      child.className = childClass
      slot.appendChild(child)
      let grip = null
      if (id === "toolbar") {
        const anchor = document.createElement("div")
        anchor.className = "oneday-slot-grip-anchor"
        grip = document.createElement("button")
        grip.className = "oneday-slot-grip"
        grip.style.opacity = "1"
        anchor.appendChild(grip)
        slot.prepend(anchor)
      }
      fixture.appendChild(slot)
      const slotRect = slot.getBoundingClientRect()
      const childRect = child.getBoundingClientRect()
      offsets[id] = { left: childRect.left - slotRect.left, right: slotRect.right - childRect.right }
      if (grip) toolbarGripGap = childRect.left - grip.getBoundingClientRect().right
    }
    fixture.remove()
    return { offsets, toolbarGripGap }
  })(),
  eHandles: [...document.querySelectorAll(".oneday-handle-e")].map((h) => {
        const cs = getComputedStyle(h)
        const r = h.getBoundingClientRect()
        return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), opacity: cs.opacity, display: cs.display, parent: h.parentElement?.className?.slice(0,30) }
      }),
      slots: [...document.querySelectorAll("#host .oneday-slot")].map((s) => ({
    id: s.dataset.slot, html: s.innerHTML.length, display: getComputedStyle(s).display,
    w: s.getBoundingClientRect().width, h: s.getBoundingClientRect().height,
  })),
  bodyH: document.querySelector(".oneday-body")?.style.height,
  outerInsets: (() => {
    const containerEl = document.querySelector(".oneday-container")
    const scrollEl = containerEl.querySelector(".oneday-block-scroll")
    const container = containerEl.getBoundingClientRect()
    const body = document.querySelector(".oneday-body").getBoundingClientRect()
    // Classic (non-overlay) scrollbars — Linux CI, or macOS with "always show
    // scroll bars" — reserve a gutter inside .oneday-block-scroll. That gutter
    // is browser chrome, not block padding, so it is excluded from the inset.
    const scrollRect = scrollEl ? scrollEl.getBoundingClientRect() : null
    const gutterX = scrollRect ? scrollRect.width - scrollEl.clientWidth : 0
    const gutterY = scrollRect ? scrollRect.height - scrollEl.clientHeight : 0
    return {
      top: body.top - container.top,
      right: container.right - body.right - gutterX,
      bottom: container.bottom - body.bottom - gutterY,
      left: body.left - container.left,
      containerWidth: container.width - gutterX,
      bodyWidth: body.width,
      scrollbarGutter: { x: gutterX, y: gutterY },
    }
  })(),
  widthHandle: (() => {
    const handle = document.querySelector(".oneday-width-handle")
    const track = document.querySelector("rect.oneday-track")
    const hr = handle.getBoundingClientRect()
    const tr = track.getBoundingClientRect()
    const cs = getComputedStyle(handle)
    return {
      centerDelta: Math.abs(hr.left + hr.width / 2 - tr.right),
      topDelta: Math.abs(hr.top - tr.top),
      bottomDelta: Math.abs(hr.bottom - tr.bottom),
      opacity: cs.opacity,
      background: cs.backgroundColor,
      width: hr.width,
    }
  })(),
}))
await page.evaluate(() => {
  const fixture = document.createElement("div")
  fixture.id = "control-visual-fixture"
  fixture.className = "oneday-container"
  fixture.style.width = "max-content"
  fixture.style.padding = "12px"
  const toolbar = document.createElement("div")
  toolbar.className = "oneday-toolbar"
  const label = document.createElement("span")
  label.className = "oneday-toggle-label"
  label.textContent = "新增为"
  const mode = document.createElement("span")
  mode.className = "oneday-mode oneday-brush-toggle"
  for (const [text, active] of [["记录", true], ["计划", false]]) {
    const button = document.createElement("button")
    button.className = `oneday-mode-btn${active ? " is-active" : ""}`
    button.textContent = text
    mode.appendChild(button)
  }
  const addSwatch = (text, active, color) => {
    const button = document.createElement("button")
    button.className = `oneday-swatch${active ? " is-active" : ""}`
    const dot = document.createElement("span")
    dot.className = "oneday-swatch-dot"
    dot.style.setProperty("--c", color)
    button.append(dot, text)
    toolbar.appendChild(button)
  }
  toolbar.append(label, mode)
  addSwatch("开发", true, "#55b8d8")
  addSwatch("自媒体", false, "#f47f82")
  for (const cls of ["oneday-open-settings", "oneday-more-actions"]) {
    const action = document.createElement("button")
    action.className = cls
    action.style.position = "static"
    action.textContent = "·"
    toolbar.appendChild(action)
  }
  fixture.appendChild(toolbar)
  document.body.appendChild(fixture)
})
await page.locator("#control-visual-fixture").screenshot({ path: path.join(out, "controls-light.png") })
await page.locator("#host").screenshot({ path: path.join(out, "main-light.png") })

// Block actions must win hit testing over a hovered slot and its resize area.
await page.evaluate(() => {
  const container = document.createElement("div")
  container.id = "block-action-hit-fixture"
  container.className = "oneday-container"
  container.style.cssText = "position:fixed;right:12px;bottom:12px;width:100px;height:72px;z-index:9999"
  const slot = document.createElement("div")
  slot.className = "oneday-slot"
  slot.style.cssText = "left:0;top:0;width:100%;height:100%;z-index:20"
  const resize = document.createElement("div")
  resize.className = "oneday-handle oneday-handle-e"
  resize.style.cssText = "opacity:1;width:100%;height:100%;top:0;right:0"
  slot.appendChild(resize)
  const settings = document.createElement("button")
  settings.className = "oneday-open-settings"
  settings.setAttribute("aria-label", "打开 Oneday 设置")
  const more = document.createElement("button")
  more.className = "oneday-more-actions"
  more.setAttribute("aria-label", "更多操作")
  window.__blockActionClicks = []
  settings.addEventListener("click", () => window.__blockActionClicks.push("settings"))
  more.addEventListener("click", () => window.__blockActionClicks.push("more"))
  container.append(slot, settings, more)
  document.body.appendChild(container)
})
const blockActionHit = await page.evaluate(() => {
  const hit = (selector) => {
    const button = document.querySelector(selector)
    const rect = button.getBoundingClientRect()
    const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return {
      targetClass: target?.className,
      cursor: getComputedStyle(button).cursor,
      zIndex: getComputedStyle(button).zIndex,
    }
  }
  return {
    settings: hit("#block-action-hit-fixture .oneday-open-settings"),
    more: hit("#block-action-hit-fixture .oneday-more-actions"),
  }
})
await page.locator("#block-action-hit-fixture .oneday-open-settings").click()
await page.locator("#block-action-hit-fixture .oneday-more-actions").click()
const blockActionClicks = await page.evaluate(() => [...window.__blockActionClicks])
await page.evaluate(() => document.getElementById("block-action-hit-fixture")?.remove())

// Native wheel chaining must progress through all three scroll owners:
// timeline content -> Oneday block viewport -> Markdown/page viewport.
await page.evaluate(() => {
  document.body.style.minHeight = "2400px"
  const container = document.createElement("div")
  container.id = "nested-scroll-fixture"
  container.className = "oneday-container"
  container.style.cssText = "position:fixed;left:12px;top:12px;width:260px;height:180px;z-index:9999"
  const block = document.createElement("div")
  block.className = "oneday-block-scroll"
  const inner = document.createElement("div")
  inner.className = "oneday-svg-holder"
  inner.style.cssText = "width:220px;height:90px;flex:none"
  const innerContent = document.createElement("div")
  innerContent.style.height = "320px"
  inner.appendChild(innerContent)
  const blockTail = document.createElement("div")
  blockTail.style.height = "420px"
  block.append(inner, blockTail)
  container.appendChild(block)
  document.body.appendChild(container)
  window.scrollTo(0, 0)
})
const nestedScrollBox = await page.locator("#nested-scroll-fixture .oneday-svg-holder").boundingBox()
if (!nestedScrollBox) { console.error("NESTED SCROLL FIXTURE HAS NO BOX"); process.exit(1) }
await page.mouse.move(nestedScrollBox.x + nestedScrollBox.width / 2, nestedScrollBox.y + nestedScrollBox.height / 2)
await page.mouse.wheel(0, 80)
await page.waitForTimeout(50)
const innerScrollOwned = await page.evaluate(() => ({
  inner: document.querySelector("#nested-scroll-fixture .oneday-svg-holder").scrollTop,
  block: document.querySelector("#nested-scroll-fixture .oneday-block-scroll").scrollTop,
  page: window.scrollY,
}))
await page.evaluate(() => {
  const inner = document.querySelector("#nested-scroll-fixture .oneday-svg-holder")
  const block = document.querySelector("#nested-scroll-fixture .oneday-block-scroll")
  inner.scrollTop = inner.scrollHeight
  block.scrollTop = 0
  window.scrollTo(0, 0)
})
await page.mouse.wheel(0, 80)
await page.waitForTimeout(50)
const blockScrollOwned = await page.evaluate(() => ({
  inner: document.querySelector("#nested-scroll-fixture .oneday-svg-holder").scrollTop,
  block: document.querySelector("#nested-scroll-fixture .oneday-block-scroll").scrollTop,
  page: window.scrollY,
}))
await page.evaluate(() => {
  const inner = document.querySelector("#nested-scroll-fixture .oneday-svg-holder")
  const block = document.querySelector("#nested-scroll-fixture .oneday-block-scroll")
  inner.scrollTop = inner.scrollHeight
  block.scrollTop = block.scrollHeight
  window.scrollTo(0, 0)
})
await page.mouse.wheel(0, 80)
await page.waitForTimeout(50)
const pageScrollOwned = await page.evaluate(() => ({
  inner: document.querySelector("#nested-scroll-fixture .oneday-svg-holder").scrollTop,
  block: document.querySelector("#nested-scroll-fixture .oneday-block-scroll").scrollTop,
  page: window.scrollY,
}))
await page.evaluate(() => {
  document.getElementById("nested-scroll-fixture")?.remove()
  document.body.style.minHeight = ""
  window.scrollTo(0, 0)
})

if (nestedEditButtonDisplay !== "none") {
  console.error("NESTED OBSIDIAN EDIT BUTTON IS VISIBLE", nestedEditButtonDisplay)
  process.exit(1)
}

const blockResizeCancel = await page.evaluate(async () => {
  const container = document.querySelector("#block-resize-cancel-fixture .oneday-container")
  const block = container.querySelector(".oneday-block-scroll")
  const timeline = container.querySelector(".oneday-svg-holder")
  const text = container.querySelector(".oneday-text-pane")
  const handle = container.querySelector(".oneday-block-resize-se")
  block.scrollTop = block.scrollHeight
  block.scrollLeft = block.scrollWidth
  timeline.scrollTop = timeline.scrollHeight
  timeline.scrollLeft = timeline.scrollWidth
  text.scrollTop = text.scrollHeight
  const before = {
    blockTop: block.scrollTop, blockLeft: block.scrollLeft,
    timelineTop: timeline.scrollTop, timelineLeft: timeline.scrollLeft,
    textTop: text.scrollTop,
  }
  const rect = handle.getBoundingClientRect()
  const init = { bubbles: true, button: 0, clientX: rect.left + 2, clientY: rect.top + 2 }
  handle.dispatchEvent(new PointerEvent("pointerdown", init))
  document.dispatchEvent(new PointerEvent("pointermove", {
    ...init, clientX: init.clientX + 400, clientY: init.clientY + 400,
  }))
  // Model the browser clamping nested owners during the expanded preview.
  block.scrollTop = 0
  block.scrollLeft = 0
  timeline.scrollTop = 0
  timeline.scrollLeft = 0
  text.scrollTop = 0
  document.dispatchEvent(new PointerEvent("pointercancel", init))
  await new Promise(requestAnimationFrame)
  const result = {
    before,
    after: {
      blockTop: block.scrollTop, blockLeft: block.scrollLeft,
      timelineTop: timeline.scrollTop, timelineLeft: timeline.scrollLeft,
      textTop: text.scrollTop,
    },
    events: window.__cancelResizeEvents,
  }
  document.getElementById("block-resize-cancel-fixture")?.remove()
  return result
})

// Range-step buttons replace the timeline source and remount its SVG holder.
// The holder has no overflow during the synchronous render pass, so the first
// scrollTop assignment is clamped to zero; the bounded layout stabilizer must
// restore it once the new SVG becomes measurable.
const remountedTimelineScroll = await page.evaluate(async () => {
  const container = document.createElement("div")
  container.className = "oneday-container"
  const holder = document.createElement("div")
  holder.className = "oneday-svg-holder"
  holder.style.cssText = "height:50px;overflow:auto"
  container.appendChild(holder)
  document.body.appendChild(container)
  window.__stabilizeInternalScroll({
    block: null,
    timeline: { top: 120, left: 0 },
    texts: {},
  }, container, 2)
  const content = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  content.setAttribute("width", "100")
  content.setAttribute("height", "320")
  holder.appendChild(content)
  await new Promise(requestAnimationFrame)
  await new Promise(requestAnimationFrame)
  const result = { top: holder.scrollTop, scrollHeight: holder.scrollHeight, clientHeight: holder.clientHeight }
  container.remove()
  return result
})
if (Math.abs(remountedTimelineScroll.top - 120) > 1) {
  console.error("REMOUNTED TIMELINE SCROLL RESET", remountedTimelineScroll)
  process.exit(1)
}

// The outer Oneday viewport resizes independently from the internal grid.
// Shrinking from the south-east corner must preserve every slot's geometry
// and move overflow into the dedicated inner scroller.
const blockResizeHandle = page.locator("#host .oneday-block-resize-se")
await blockResizeHandle.scrollIntoViewIfNeeded()
const blockResizeHandleBox = await blockResizeHandle.boundingBox()
if (!blockResizeHandleBox) { console.error("BLOCK RESIZE HANDLE HAS NO BOX"); process.exit(1) }
const blockGeometryBefore = await page.evaluate(() => {
  const container = document.querySelector(".oneday-container")
  const embed = container.closest(".cm-embed-block")
  const body = document.querySelector(".oneday-body")
  const timeline = document.querySelector(".oneday-slot-timeline")
  const cr = container.getBoundingClientRect()
  const br = body.getBoundingClientRect()
  const tr = timeline.getBoundingClientRect()
  return {
    containerW: cr.width,
    containerH: cr.height,
    containerRight: cr.right,
    embedRight: embed.getBoundingClientRect().right,
    embedBorderRight: parseFloat(getComputedStyle(embed).borderRightWidth),
    embedShadow: getComputedStyle(embed).boxShadow,
    containerShadow: getComputedStyle(container).boxShadow,
    bodyW: br.width,
    timelineW: tr.width,
    timelineH: tr.height,
  }
})
await page.mouse.move(blockResizeHandleBox.x + blockResizeHandleBox.width / 2, blockResizeHandleBox.y + blockResizeHandleBox.height / 2)
await page.mouse.down()
await page.mouse.move(blockResizeHandleBox.x + blockResizeHandleBox.width / 2 - 180, blockResizeHandleBox.y + blockResizeHandleBox.height / 2 - 260, { steps: 5 })
await page.mouse.up()
const blockResize = await page.evaluate(async () => {
  await new Promise(requestAnimationFrame)
  const container = document.querySelector(".oneday-container")
  const embed = container.closest(".cm-embed-block")
  const scroller = document.querySelector(".oneday-block-scroll")
  const body = document.querySelector(".oneday-body")
  const timeline = document.querySelector(".oneday-slot-timeline")
  const handle = document.querySelector(".oneday-block-resize-se")
  const cr = container.getBoundingClientRect()
  const br = body.getBoundingClientRect()
  const tr = timeline.getBoundingClientRect()
  const hr0 = handle.getBoundingClientRect()
  scroller.scrollLeft = scroller.scrollWidth
  scroller.scrollTop = scroller.scrollHeight
  await new Promise(requestAnimationFrame)
  const hr1 = handle.getBoundingClientRect()
  return {
    containerW: cr.width,
    containerH: cr.height,
    containerRight: cr.right,
    embedRight: embed.getBoundingClientRect().right,
    bodyW: br.width,
    timelineW: tr.width,
    timelineH: tr.height,
    scrollLeft: scroller.scrollLeft,
    scrollTop: scroller.scrollTop,
    outerScrollLeft: container.scrollLeft,
    outerScrollTop: container.scrollTop,
    handleDelta: Math.max(Math.abs(hr0.left - hr1.left), Math.abs(hr0.top - hr1.top)),
    handleOpacity: getComputedStyle(handle).opacity,
    commits: window.__blockSizes,
    events: window.__blockResizeEvents,
  }
})

// At both horizontal scroll extremes, the outermost slot keeps the same 4px
// block inset. The component edge is a real 1px border inside the slot bounds,
// so the scroller cannot clip the right edge as it did with CSS outline.
const scrolledEdgeChrome = await page.evaluate(async () => {
  const container = document.querySelector(".oneday-container")
  const scroller = document.querySelector(".oneday-block-scroll")
  const slots = [...document.querySelectorAll(".oneday-slot")]
  const leftmost = slots.reduce((best, slot) => Number(slot.dataset.x) < Number(best.dataset.x) ? slot : best)
  const rightmost = slots.reduce((best, slot) => {
    const edge = Number(slot.dataset.x) + Number(slot.dataset.w)
    const bestEdge = Number(best.dataset.x) + Number(best.dataset.w)
    return edge > bestEdge ? slot : best
  })
  scroller.scrollLeft = 0
  await new Promise(requestAnimationFrame)
  const containerRect = container.getBoundingClientRect()
  const leftGap = leftmost.getBoundingClientRect().left - containerRect.left
  scroller.scrollLeft = scroller.scrollWidth
  await new Promise(requestAnimationFrame)
  const rightGap = containerRect.right - rightmost.getBoundingClientRect().right
  const result = {
    leftGap,
    rightGap,
    rightmostId: rightmost.dataset.slot,
    leftBorderWidth: parseFloat(getComputedStyle(leftmost).borderLeftWidth),
    rightBorderWidth: parseFloat(getComputedStyle(rightmost).borderRightWidth),
  }
  return result
})
const rightmostSlot = page.locator(`.oneday-slot[data-slot="${scrolledEdgeChrome.rightmostId}"]`)
await rightmostSlot.hover()
const rightEdgeBorder = await rightmostSlot.evaluate((slot) => {
  const style = getComputedStyle(slot)
  return { color: style.borderRightColor, style: style.borderRightStyle, width: parseFloat(style.borderRightWidth) }
})
await page.evaluate(async () => {
  document.querySelector(".oneday-block-scroll").scrollLeft = 0
  await new Promise(requestAnimationFrame)
})

const widthHandle = page.locator(".oneday-width-handle")
await widthHandle.hover()
const widthHandleHover = await widthHandle.evaluate((handle) => {
  const cs = getComputedStyle(handle)
  return { opacity: cs.opacity, background: cs.backgroundColor }
})
const widthHandleBox = await widthHandle.boundingBox()
if (!widthHandleBox) { console.error("WIDTH HANDLE HAS NO BOX"); process.exit(1) }
await page.mouse.move(widthHandleBox.x + widthHandleBox.width / 2, widthHandleBox.y + widthHandleBox.height / 2)
await page.mouse.down()
await page.mouse.move(widthHandleBox.x + widthHandleBox.width / 2 + 30, widthHandleBox.y + widthHandleBox.height / 2)
const widthDrag = await page.evaluate(() => {
  const handle = document.querySelector(".oneday-width-handle")
  const preview = document.querySelector(".oneday-width-preview")
  const track = document.querySelector("rect.oneday-track")
  if (!preview) return null
  const pr = preview.getBoundingClientRect()
  const tr = track.getBoundingClientRect()
  return {
    topDelta: Math.abs(pr.top - tr.top),
    bottomDelta: Math.abs(pr.bottom - tr.bottom),
    handleOpacity: getComputedStyle(handle).opacity,
  }
})
await page.mouse.up()

// Timeline scrolling must belong to the SVG content pane. The outer grid slot
// owns the eight resize handles, so neither horizontal edge may scroll away.
const timelineInternalScroll = await page.evaluate(async () => {
  const slot = document.querySelector(".oneday-slot-timeline")
  const pane = slot?.querySelector(".oneday-svg-holder")
  const widthHandle = slot?.querySelector(".oneday-width-handle")
  const track = slot?.querySelector("rect.oneday-track")
  if (!slot || !pane || !widthHandle || !track) return { missing: true }
  const originalHeight = slot.style.height
  const originalWidth = slot.style.width
  slot.style.height = "240px"
  slot.style.width = "160px"
  await new Promise(requestAnimationFrame)
  const west = slot.querySelector(".oneday-handle-w")
  const east = slot.querySelector(".oneday-handle-e")
  const handles = [...slot.querySelectorAll(".oneday-handle")]
  const before = handles.map((handle) => handle.getBoundingClientRect())
  pane.scrollTop = pane.scrollHeight
  pane.scrollLeft = pane.scrollWidth
  await new Promise(requestAnimationFrame)
  const after = handles.map((handle) => handle.getBoundingClientRect())
  const slotRect = slot.getBoundingClientRect()
  const westRect = west.getBoundingClientRect()
  const eastRect = east.getBoundingClientRect()
  const widthRect = widthHandle.getBoundingClientRect()
  const trackRect = track.getBoundingClientRect()
  const result = {
    paneScrollTop: pane.scrollTop,
    paneScrollLeft: pane.scrollLeft,
    slotScrollTop: slot.scrollTop,
    slotScrollLeft: slot.scrollLeft,
    slotOverflowY: getComputedStyle(slot).overflowY,
    paneOverflowY: getComputedStyle(pane).overflowY,
    westDelta: Math.abs(westRect.left - slotRect.left),
    eastDelta: Math.abs(eastRect.right - slotRect.right),
    handleDelta: Math.max(0, ...before.flatMap((rect, index) => [
      Math.abs(rect.left - after[index].left),
      Math.abs(rect.top - after[index].top),
      Math.abs(rect.right - after[index].right),
      Math.abs(rect.bottom - after[index].bottom),
    ])),
    handleBackgrounds: handles.map((handle) => getComputedStyle(handle).backgroundColor),
    widthHandleParent: widthHandle.parentElement?.className,
    widthHandleTrackDelta: Math.abs(widthRect.left + widthRect.width / 2 - trackRect.right),
  }
  pane.scrollTop = 0
  pane.scrollLeft = 0
  slot.style.height = originalHeight
  slot.style.width = originalWidth
  await new Promise(requestAnimationFrame)
  return result
})

// Every grid slot may become smaller than its content. Its move grip belongs
// to the viewport chrome, so it must remain fully visible and clickable even
// for the ordinary slots that still use their outer element as the scroller.
await page.locator("#host .oneday-slot-toolbar").scrollIntoViewIfNeeded()
const genericGripScroll = await page.evaluate(async () => {
  const slot = document.querySelector("#host .oneday-slot-toolbar")
  const grip = slot?.querySelector(".oneday-slot-grip")
  if (!slot || !grip) return { missing: true }
  const originalWidth = slot.style.width
  const originalHeight = slot.style.height
  slot.style.width = "160px"
  slot.style.height = "80px"
  const filler = document.createElement("div")
  filler.className = "grip-scroll-fixture"
  filler.style.width = "520px"
  filler.style.height = "240px"
  const anchor = slot.querySelector(".oneday-slot-grip-anchor")
  if (anchor) anchor.after(filler)
  else slot.prepend(filler)
  await new Promise(requestAnimationFrame)
  const slotRect = slot.getBoundingClientRect()
  const before = grip.getBoundingClientRect()
  slot.scrollLeft = slot.scrollWidth
  slot.scrollTop = slot.scrollHeight
  await new Promise(requestAnimationFrame)
  const after = grip.getBoundingClientRect()
  const visibleWidth = Math.max(0, Math.min(after.right, slotRect.right) - Math.max(after.left, slotRect.left))
  const visibleHeight = Math.max(0, Math.min(after.bottom, slotRect.bottom) - Math.max(after.top, slotRect.top))
  const hitTarget = document.elementFromPoint(after.left + after.width / 2, after.top + after.height / 2)
  const hit = hitTarget?.closest(".oneday-slot-grip") === grip
  const result = {
    scrollLeft: slot.scrollLeft,
    scrollTop: slot.scrollTop,
    beforeX: before.left - slotRect.left,
    beforeY: before.top - slotRect.top,
    afterX: after.left - slotRect.left,
    afterY: after.top - slotRect.top,
    width: after.width,
    height: after.height,
    visibleWidth,
    visibleHeight,
    hit,
    hitTarget: hitTarget?.className,
    anchor: grip.parentElement?.className,
  }
  slot.scrollLeft = 0
  slot.scrollTop = 0
  filler.remove()
  slot.style.width = originalWidth
  slot.style.height = originalHeight
  await new Promise(requestAnimationFrame)
  return result
})

await page.evaluate(() => document.body.classList.add("is-mobile"))
const mobileDefault = await page.evaluate(() => ({
  grip: getComputedStyle(document.querySelector(".oneday-slot-grip")).display,
  handle: getComputedStyle(document.querySelector(".oneday-handle-e")).display,
  width: getComputedStyle(document.querySelector(".oneday-width-handle")).display,
  block: getComputedStyle(document.querySelector(".oneday-block-resize-e")).display,
}))
await page.evaluate(() => document.querySelector(".oneday-container")?.classList.add("is-layout-editing"))
const mobileEditing = await page.evaluate(() => {
  const grip = document.querySelector(".oneday-slot-grip").getBoundingClientRect()
  const handle = document.querySelector(".oneday-handle-e").getBoundingClientRect()
  const width = document.querySelector(".oneday-width-handle").getBoundingClientRect()
  const block = document.querySelector(".oneday-block-resize-e").getBoundingClientRect()
  const blockCorner = document.querySelector(".oneday-block-resize-se").getBoundingClientRect()
  return {
    grip: { display: getComputedStyle(document.querySelector(".oneday-slot-grip")).display, w: grip.width, h: grip.height },
    handle: { display: getComputedStyle(document.querySelector(".oneday-handle-e")).display, w: handle.width },
    width: { display: getComputedStyle(document.querySelector(".oneday-width-handle")).display, w: width.width },
    block: { display: getComputedStyle(document.querySelector(".oneday-block-resize-e")).display, w: block.width },
    blockCorner: { w: blockCorner.width, h: blockCorner.height },
  }
})

// Precise-time popover: moving focus from start to end must not save/close.
await page.evaluate(() => {
  document.body.classList.remove("is-mobile")
  document.querySelector(".oneday-container")?.classList.remove("is-layout-editing")
  window.__openTimePopover()
})
await page.waitForTimeout(20)
await page.locator('input[aria-label="结束时间"]').click()
const timeEndFocus = await page.evaluate(() => ({
  popover: Boolean(document.querySelector(".oneday-time-popover")),
  activeLabel: document.activeElement?.getAttribute("aria-label"),
  saved: window.__timeSaved.length,
}))
await page.locator('input[aria-label="结束时间"]').fill("12:45")
await page.locator('input[aria-label="结束时间"]').press("Enter")
const timeCommitted = await page.evaluate(() => ({
  popover: Boolean(document.querySelector(".oneday-time-popover")),
  saved: window.__timeSaved,
}))

// Timeline date is an explicit, keyboard-accessible control. Editing it must
// commit one ISO date and must not leak a native title/second tooltip.
const dateControl = page.locator("#editable-date-fixture .oneday-timeline-date-control")
await page.mouse.move(1, 1)
const dateRestStyle = await page.evaluate(() => {
  const topbar = document.querySelector("#editable-date-fixture")
  const control = topbar?.querySelector(".oneday-timeline-date-control")
  if (!topbar || !control) return { missing: true }
  const style = getComputedStyle(control)
  const topbarStyle = getComputedStyle(topbar)
  return {
    missing: false,
    background: style.backgroundColor,
    controlWidth: control.getBoundingClientRect().width,
    topbarWidth: topbar.getBoundingClientRect().width,
    gap: Number.parseFloat(topbarStyle.columnGap || topbarStyle.gap || "0"),
  }
})
await dateControl.hover()
const dateHoverBackground = await dateControl.evaluate((control) => getComputedStyle(control).backgroundColor)
await dateControl.click()
await page.waitForTimeout(20)
const dateOpened = await page.evaluate(() => {
  const control = document.querySelector("#editable-date-fixture .oneday-timeline-date-control")
  const popover = document.querySelector(".oneday-date-popover")
  return {
    text: control?.textContent ?? "",
    title: control?.getAttribute("title"),
    expanded: control?.getAttribute("aria-expanded"),
    monthTitle: popover?.querySelector(".oneday-date-picker-title")?.textContent ?? "",
    dayCount: popover?.querySelectorAll(".oneday-date-picker-day").length ?? 0,
    selectedDate: popover?.querySelector(".oneday-date-picker-day.is-selected")?.getAttribute("data-date"),
    focusedDate: document.activeElement?.getAttribute("data-date"),
    hasSegmentedInput: Boolean(popover?.querySelector('input[type="date"]')),
  }
})
await page.evaluate(() => document.querySelector(".oneday-date-picker-day.is-selected")?.blur())
await page.waitForTimeout(20)
const dateTransientBlur = await page.evaluate(() => ({
  popover: Boolean(document.querySelector(".oneday-date-popover")),
  saved: [...window.__dateSaved],
}))
await page.locator(".oneday-date-popover").screenshot({ path: path.join(out, "date-popover-light.png") })
await page.locator('.oneday-date-popover .oneday-date-picker-day[data-date="2026-08-24"]').click()
const dateCommitted = await page.evaluate(() => ({
  popover: Boolean(document.querySelector(".oneday-date-popover")),
  expanded: document.querySelector("#editable-date-fixture .oneday-timeline-date-control")?.getAttribute("aria-expanded"),
  saved: [...window.__dateSaved],
  cursor: getComputedStyle(document.querySelector("#editable-date-fixture .oneday-timeline-date-control")).cursor,
}))
await page.locator("#editable-date-fixture").screenshot({ path: path.join(out, "editable-date-light.png") })

// Text editor: a real click in the lower empty interior must still hit the
// pane, not only the placeholder/text line near its top. Keep clear of the
// 8px edge resize zone, whose interaction intentionally takes precedence.
const textSlot = page.locator(".oneday-slot-text")
await textSlot.scrollIntoViewIfNeeded()
const textSlotBox = await textSlot.boundingBox()
if (!textSlotBox) { console.error("TEXT SLOT HAS NO BOX"); process.exit(1) }
const textReadScroll = await page.evaluate(async () => {
  const slot = document.querySelector(".oneday-slot-text")
  const pane = slot?.querySelector(".oneday-text-pane")
  if (!slot || !pane) return { scrollTop: 0, handleDelta: 0, missing: true }
  const handles = [...slot.querySelectorAll(".oneday-handle")]
  const before = handles.map((handle) => handle.getBoundingClientRect())
  pane.scrollTop = pane.scrollHeight
  await new Promise(requestAnimationFrame)
  const after = handles.map((handle) => handle.getBoundingClientRect())
  const handleDelta = Math.max(0, ...before.flatMap((rect, index) => [
    Math.abs(rect.left - after[index].left),
    Math.abs(rect.top - after[index].top),
    Math.abs(rect.right - after[index].right),
    Math.abs(rect.bottom - after[index].bottom),
  ]))
  const scrollTop = pane.scrollTop
  pane.scrollTop = 0
  return { scrollTop, handleDelta, slotScrollTop: slot.scrollTop }
})
const textClickPoint = { x: textSlotBox.x + textSlotBox.width / 2, y: textSlotBox.y + textSlotBox.height * 0.75 }
const textMarkdownSemantics = await page.evaluate(() => {
  const host = document.querySelector(".oneday-slot-text .oneday-text-host")
  return {
    exists: Boolean(host),
    nativeMarkdownContainer: Boolean(host?.classList.contains("markdown-rendered")),
  }
})
const textClickTarget = await page.evaluate(({ x, y }) => {
  const target = document.elementFromPoint(x, y)
  return { tag: target?.tagName, cls: target?.className, slot: target?.closest(".oneday-slot")?.dataset.slot }
}, textClickPoint)
const textClickViewportBefore = await page.evaluate(() => {
  const pane = document.querySelector(".oneday-slot-text .oneday-text-pane")
  const scrolling = document.scrollingElement
  return {
    paneTop: pane?.getBoundingClientRect().top ?? 0,
    pageTop: scrolling?.scrollTop ?? 0,
    paneScrollTop: pane?.scrollTop ?? 0,
  }
})
await page.mouse.click(textClickPoint.x, textClickPoint.y)
await page.waitForTimeout(50)
const textPaneEditing = await page.evaluate(() => ({
  textarea: Boolean(document.querySelector(".oneday-text-pane textarea.oneday-text-inline")),
  slotEditing: Boolean(document.querySelector(".oneday-slot-text.is-editing")),
  paneFillsSlot: (() => {
    const pane = document.querySelector(".oneday-text-pane").getBoundingClientRect()
    const slot = document.querySelector(".oneday-slot-text").getBoundingClientRect()
    const style = getComputedStyle(document.querySelector(".oneday-slot-text"))
    const expected = slot.height
      - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth)
      - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
    return Math.abs(pane.height - expected) <= 1
  })(),
  textareaFillsBlankInterior: (() => {
    const pane = document.querySelector(".oneday-text-pane").getBoundingClientRect()
    const textarea = document.querySelector(".oneday-text-inline")?.getBoundingClientRect()
    return Boolean(textarea && textarea.bottom >= pane.bottom - 1)
  })(),
  viewportStable: (() => {
    const pane = document.querySelector(".oneday-slot-text .oneday-text-pane")
    const scrolling = document.scrollingElement
    return {
      paneTop: pane?.getBoundingClientRect().top ?? 0,
      pageTop: scrolling?.scrollTop ?? 0,
      paneScrollTop: pane?.scrollTop ?? 0,
    }
  })(),
}))
const textResizeHandle = page.locator(".oneday-slot-text .oneday-handle-e")
const textResizeDisplay = await textResizeHandle.evaluate((handle) => getComputedStyle(handle).display)
await page.evaluate(() => {
  window.__textResizeEvents = []
  const slot = document.querySelector(".oneday-slot-text")
  const pane = document.querySelector(".oneday-text-pane")
  slot?.addEventListener("pointerdown", (e) => window.__textResizeEvents.push(`down:${e.target.className}`), true)
  pane?.addEventListener("focusout", () => window.__textResizeEvents.push("focusout"), true)
  document.addEventListener("pointerup", () => window.__textResizeEvents.push("up"), { capture: true, once: true })
})
let textResizeWhileEditing = { display: textResizeDisplay, resized: false, textarea: false, focused: false, events: [] }
if (textResizeDisplay !== "none") {
  const handleBox = await textResizeHandle.boundingBox()
  const beforeWidth = await textSlot.evaluate((slot) => slot.getBoundingClientRect().width)
  if (handleBox) {
    const point = { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 }
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    // A real pointer can blur the textarea; the resize gesture must remain part
    // of the same edit session until pointerup restores focus.
    await page.locator(".oneday-text-inline").evaluate((textarea) => textarea.blur())
    await page.waitForTimeout(10)
    await page.mouse.move(point.x + 110, point.y, { steps: 4 })
    await page.mouse.up()
  }
  textResizeWhileEditing = await page.evaluate((before) => {
    const slot = document.querySelector(".oneday-slot-text")
    const textarea = document.querySelector(".oneday-text-inline")
    return {
      display: getComputedStyle(document.querySelector(".oneday-slot-text .oneday-handle-e")).display,
      resized: slot.getBoundingClientRect().width > before + 20,
      textarea: Boolean(textarea),
      focused: document.activeElement === textarea,
      events: window.__textResizeEvents,
    }
  }, beforeWidth)
}
const textEditScroll = await page.evaluate(async () => {
  const slot = document.querySelector(".oneday-slot-text")
  const pane = document.querySelector(".oneday-text-pane")
  const textarea = document.querySelector(".oneday-text-inline")
  if (!slot || !pane || !textarea) return { before: 0, after: 0, max: 0, missing: true }
  textarea.value += "\\n末尾继续编辑"
  textarea.setSelectionRange(textarea.value.length, textarea.value.length)
  const handles = [...slot.querySelectorAll(".oneday-handle")]
  const beforeRects = handles.map((handle) => handle.getBoundingClientRect())
  pane.scrollTop = pane.scrollHeight
  const before = pane.scrollTop
  textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "末尾继续编辑" }))
  // Wait past the slot's delayed layout-settle pass: the bug was perceived
  // after typing stopped, not only during the input event itself.
  await new Promise((resolve) => setTimeout(resolve, 400))
  const afterRects = handles.map((handle) => handle.getBoundingClientRect())
  const handleDelta = Math.max(0, ...beforeRects.flatMap((rect, index) => [
    Math.abs(rect.left - afterRects[index].left),
    Math.abs(rect.top - afterRects[index].top),
    Math.abs(rect.right - afterRects[index].right),
    Math.abs(rect.bottom - afterRects[index].bottom),
  ]))
  return {
    before,
    after: pane.scrollTop,
    max: pane.scrollHeight - pane.clientHeight,
    slotScrollTop: slot.scrollTop,
    slotOverflowY: getComputedStyle(slot).overflowY,
    paneOverflowY: getComputedStyle(pane).overflowY,
    handleDelta,
    handleBackgrounds: handles.map((handle) => getComputedStyle(handle).backgroundColor),
  }
})
// Switching away from a macOS window does not reliably move activeElement and
// therefore may not emit focusout. Window blur itself must flush the fifth line.
const textWindowBlurSave = await page.evaluate(async () => {
  const textarea = document.querySelector(".oneday-text-inline")
  const expected = textarea?.value ?? ""
  window.dispatchEvent(new Event("blur"))
  await new Promise((resolve) => setTimeout(resolve, 0))
  return { expected, saves: window.__textSaves }
})
const quickInputStyle = await page.evaluate(() => {
  document.documentElement.style.setProperty("--input-shadow", "inset 0 0 0 4px rgb(255, 0, 0)")
  document.documentElement.style.setProperty("--background-modifier-border", "rgb(120, 120, 120)")
  document.documentElement.style.setProperty("--background-modifier-border-focus", "rgb(90, 80, 220)")
  const input = document.querySelector('[aria-label="快速记录测试"]')
  input.focus()
  const style = getComputedStyle(input)
  return { shadow: style.boxShadow, borderColor: style.borderColor }
})
const toolbarAlignment = await page.evaluate(() => {
  window.__mountToolbarAlignmentFixtures()
  const read = (id) => {
    const slot = document.getElementById(id)
    const slotRect = slot.getBoundingClientRect()
    const slotStyle = getComputedStyle(slot)
    const controls = slot.querySelector(".oneday-creation-controls").getBoundingClientRect()
    const categories = slot.querySelector(".oneday-category-list").getBoundingClientRect()
    const firstCategory = slot.querySelector(".oneday-swatch, .oneday-toolbar-empty")?.getBoundingClientRect()
    return {
      topInset: controls.top - slotRect.top - parseFloat(slotStyle.borderTopWidth),
      expectedTopInset: parseFloat(slotStyle.paddingTop),
      controlsBottom: controls.bottom,
      categoriesTop: categories.top,
      firstCategoryTop: firstCategory?.top ?? 0,
    }
  }
  return {
    populated: read("toolbar-span-populated"),
    empty: read("toolbar-marker-empty"),
    single: read("toolbar-marker-single"),
  }
})
await page.locator("#toolbar-alignment-fixtures").screenshot({ path: path.join(out, "toolbar-alignment-states-light.png") })
const emptyState = await page.evaluate(() => {
  window.__mountEmptyState()
  const host = document.getElementById("empty-host")
  const timeline = host.querySelector(".oneday-slot-timeline")
  const stats = host.querySelector(".oneday-slot-stats")
  const hint = timeline.querySelector(".oneday-timeline-onboarding")
  const track = timeline.querySelector("rect.oneday-track")
  const statsEmpty = stats.querySelector(".oneday-stats-empty")
  const statsStyle = getComputedStyle(stats)
  const statsEmptyStyle = statsEmpty ? getComputedStyle(statsEmpty) : null
  const hintRect = hint?.getBoundingClientRect()
  const trackRect = track?.getBoundingClientRect()
  const statsRect = statsEmpty?.getBoundingClientRect()
  const statsSlotRect = stats.getBoundingClientRect()
  const statsGrip = stats.querySelector(".oneday-slot-grip")
  const statsGripAnchor = stats.querySelector(".oneday-slot-grip-anchor")
  const statsGripNotch = statsGripAnchor ? getComputedStyle(statsGripAnchor, "::before") : null
  const narrowGuide = document.querySelector("#narrow-guide-host .oneday-timeline-onboarding")
  const narrowTrack = document.querySelector("#narrow-guide-host rect.oneday-track")
  const narrowGuideRect = narrowGuide?.getBoundingClientRect()
  const narrowTrackRect = narrowTrack?.getBoundingClientRect()
  const zeroToolbarSlot = document.querySelector("#no-palette-timeline-host .oneday-slot-toolbar")
  const zeroToolbar = zeroToolbarSlot?.querySelector(".oneday-toolbar")
  const zeroToolbarButton = zeroToolbarSlot?.querySelector(".oneday-toolbar-empty")
  const zeroSouthHandle = zeroToolbarSlot?.querySelector(".oneday-handle-s")
  const zeroSlotStyle = zeroToolbarSlot ? getComputedStyle(zeroToolbarSlot) : null
  const zeroToolbarShellRect = zeroToolbar?.getBoundingClientRect()
  const zeroToolbarRect = zeroToolbarButton?.getBoundingClientRect()
  const zeroSouthHandleRect = zeroSouthHandle?.getBoundingClientRect()
  const slots = [...host.querySelectorAll(".oneday-slot")].map((slot) => ({
    id: slot.dataset.slot,
    x: Number(slot.dataset.x),
    y: Number(slot.dataset.y),
    w: Number(slot.dataset.w),
    h: Number(slot.dataset.h),
  }))
  const result = {
    timelineStart: hint?.querySelector(".oneday-timeline-onboarding-label.is-start")?.textContent,
    timelineEnd: hint?.querySelector(".oneday-timeline-onboarding-label.is-end")?.textContent,
    timelineCopy: hint?.querySelector(".oneday-timeline-onboarding-copy")?.textContent,
    timelinePointerEvents: hint ? getComputedStyle(hint).pointerEvents : null,
    timelineInsideTrack: Boolean(hintRect && trackRect && hintRect.left >= trackRect.left + 2 && hintRect.right <= trackRect.right - 2),
    timelineNearStart: Boolean(hintRect && trackRect && hintRect.top > trackRect.top && hintRect.top - trackRect.top < trackRect.height / 4),
    persistentTimelineGuideCount: document.querySelectorAll("#persistent-empty-host .oneday-timeline-onboarding").length,
    noPaletteTimelineGuideCount: document.querySelectorAll("#no-palette-timeline-host .oneday-timeline-onboarding").length,
    zeroToolbarFillsSlot: Boolean(zeroToolbarShellRect && zeroToolbarSlot && (() => {
      const style = getComputedStyle(zeroToolbarSlot)
      const width = zeroToolbarSlot.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      const height = zeroToolbarSlot.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
      return Math.abs(zeroToolbarShellRect.height - height) <= 1 && Math.abs(zeroToolbarShellRect.width - width) <= 1
    })()),
    zeroToolbarButtonClearsSouthHandle: Boolean(zeroToolbarRect && zeroSouthHandleRect && zeroToolbarRect.bottom <= zeroSouthHandleRect.top - 1),
    zeroToolbarKeepsNormalShell: Boolean(!zeroToolbarSlot?.classList.contains("is-empty-state") && zeroSlotStyle?.borderStyle === "solid" && getComputedStyle(zeroToolbarButton).borderStyle === "none"),
    zeroToolbarSlotRows: Number(zeroToolbarSlot?.dataset.h),
    narrowGuideInsideTrack: Boolean(narrowGuideRect && narrowTrackRect && narrowGuideRect.left >= narrowTrackRect.left && narrowGuideRect.right <= narrowTrackRect.right),
    statsLabel: statsEmpty?.querySelector(".oneday-stats-empty-label")?.textContent,
    statsSlotBorderStyle: statsStyle.borderStyle,
    statsInnerBorderStyle: statsEmptyStyle?.borderStyle ?? null,
    statsFits: statsEmpty ? statsEmpty.getBoundingClientRect().height <= stats.getBoundingClientRect().height : false,
    statsFillsSlot: Boolean(statsRect && Math.abs(statsRect.height - stats.clientHeight) <= 1 && Math.abs(statsRect.width - stats.clientWidth) <= 1 && Math.abs(statsRect.left - (statsSlotRect.left + stats.clientLeft)) <= 1 && Math.abs(statsRect.top - (statsSlotRect.top + stats.clientTop)) <= 1),
    statsSlotOwnsBorder: stats.classList.contains("is-empty-state"),
    statsGripNotch: statsGrip && statsGripNotch ? {
      content: statsGripNotch.content,
      width: parseFloat(statsGripNotch.width),
      height: parseFloat(statsGripNotch.height),
      gripWidth: statsGrip.getBoundingClientRect().width,
      gripHeight: statsGrip.getBoundingClientRect().height,
      background: statsGripNotch.backgroundColor,
      opacity: statsGripNotch.opacity,
    } : null,
    legacyStatsChildren: statsEmpty?.querySelectorAll(".oneday-stats-empty-mark, .oneday-stats-empty-detail").length ?? 0,
    slots,
  }
  return result
})
await page.locator("#empty-host").screenshot({ path: path.join(out, "empty-light.png") })
await page.locator("#no-palette-timeline-host").screenshot({ path: path.join(out, "zero-palette-light.png") })
await page.locator("#empty-host .oneday-slot-stats").hover()
await page.locator("#empty-host .oneday-slot-stats").screenshot({ path: path.join(out, "stats-empty-hover-light.png") })
await page.locator("#no-palette-timeline-host .oneday-slot-toolbar").hover()
await page.locator("#no-palette-timeline-host .oneday-slot-toolbar").screenshot({ path: path.join(out, "zero-toolbar-hover-light.png") })
await page.mouse.move(1, 1)
await page.evaluate(() => {
  document.body.classList.add("theme-dark")
  document.body.style.background = "rgb(32, 32, 32)"
  document.documentElement.style.setProperty("--background-primary", "rgb(32, 32, 32)")
  document.documentElement.style.setProperty("--background-secondary", "rgb(42, 42, 42)")
  document.documentElement.style.setProperty("--background-modifier-hover", "rgb(55, 55, 55)")
  document.documentElement.style.setProperty("--background-modifier-border", "rgb(72, 72, 72)")
  document.documentElement.style.setProperty("--text-normal", "rgb(220, 220, 220)")
  document.documentElement.style.setProperty("--text-muted", "rgb(150, 150, 150)")
})
await page.locator("#host").screenshot({ path: path.join(out, "main-dark.png") })
await page.locator("#editable-date-fixture").screenshot({ path: path.join(out, "editable-date-dark.png") })
await dateControl.click()
await page.locator(".oneday-date-popover").screenshot({ path: path.join(out, "date-popover-dark.png") })
await page.keyboard.press("Escape")
await page.locator("#control-visual-fixture").screenshot({ path: path.join(out, "controls-dark.png") })
await page.locator("#vertical-rhythm-fixture").screenshot({ path: path.join(out, "vertical-rhythm-dark.png") })
await page.locator("#toolbar-alignment-fixtures").screenshot({ path: path.join(out, "toolbar-alignment-states-dark.png") })
await page.locator("#empty-host").screenshot({ path: path.join(out, "empty-dark.png") })
const statsEmptySlot = page.locator("#empty-host .oneday-slot-stats")
const zeroToolbarEmptySlot = page.locator("#no-palette-timeline-host .oneday-slot-toolbar")
await page.mouse.move(1, 1)
await statsEmptySlot.screenshot({ path: path.join(out, "stats-empty-default-dark.png") })
await statsEmptySlot.hover()
const statsEmptyHover = await statsEmptySlot.evaluate((slot) => ({
  slotBorderStyle: getComputedStyle(slot).borderStyle,
  innerBorderStyle: getComputedStyle(slot.querySelector(".oneday-stats-empty")).borderStyle,
  notchOpacity: getComputedStyle(slot.querySelector(".oneday-slot-grip-anchor"), "::before").opacity,
}))
await statsEmptySlot.screenshot({ path: path.join(out, "stats-empty-hover-dark.png") })
await page.mouse.move(1, 1)
await zeroToolbarEmptySlot.screenshot({ path: path.join(out, "zero-toolbar-default-dark.png") })
await zeroToolbarEmptySlot.locator(".oneday-toolbar-empty").hover()
const zeroToolbarEmptyHover = await zeroToolbarEmptySlot.evaluate((slot) => ({
  slotBorderStyle: getComputedStyle(slot).borderStyle,
  buttonBorderStyle: getComputedStyle(slot.querySelector(".oneday-toolbar-empty")).borderStyle,
}))
await zeroToolbarEmptySlot.screenshot({ path: path.join(out, "zero-toolbar-hover-dark.png") })
const emptyResponsive = await page.evaluate(async () => {
  const host = document.getElementById("empty-host")
  host.style.width = "480px"
  await new Promise(requestAnimationFrame)
  const stats = host.querySelector(".oneday-slot-stats")
  const timelinePane = host.querySelector(".oneday-svg-holder")
  return {
    statsFits: stats.scrollHeight <= stats.clientHeight,
    statsScrollHeight: stats.scrollHeight,
    statsClientHeight: stats.clientHeight,
    statsLabelNoWrap: getComputedStyle(stats.querySelector(".oneday-stats-empty-label")).whiteSpace,
    timelineScrollsInternally: timelinePane.scrollWidth > timelinePane.clientWidth && getComputedStyle(timelinePane).overflowX === "auto",
    bodyOverflowsViewport: host.querySelector(".oneday-body").scrollWidth > host.getBoundingClientRect().width + 1,
  }
})
await page.locator("#empty-host").screenshot({ path: path.join(out, "empty-narrow-dark.png") })
const defaultTimeline = {}
for (const hostWidth of [900, 480]) {
  defaultTimeline[hostWidth] = await page.evaluate((width) => window.__mountDefaultTimelineFixture(width), hostWidth)
  await page.locator("#default-timeline-fixture .oneday-slot-timeline").screenshot({ path: path.join(out, `default-timeline-${hostWidth}.png`) })
}
await browser.close()
console.log(JSON.stringify({ ...state, verticalRhythm, viewportAnchor }, null, 2))
if (!state.ok) { console.error("MOUNT THREW"); process.exit(1) }
if (
  Math.abs(viewportAnchor.afterTop - viewportAnchor.beforeTop) > 0.5
  || Math.abs(viewportAnchor.scrollTop - 380) > 1
  || viewportAnchor.overflowAnchor !== "none"
) {
  console.error("VIEWPORT ANCHOR JUMPED ACROSS RERENDER", viewportAnchor)
  process.exit(1)
}
const toolbarTopInsets = Object.values(toolbarAlignment).map((state) => state.topInset)
if (
  Math.max(...toolbarTopInsets) - Math.min(...toolbarTopInsets) > 0.5
  || Object.values(toolbarAlignment).some((state) => Math.abs(state.topInset - state.expectedTopInset) > 0.5)
  || Object.values(toolbarAlignment).some((state) => state.categoriesTop <= state.controlsBottom)
  || Math.abs(toolbarAlignment.single.firstCategoryTop - toolbarAlignment.single.categoriesTop) > 0.5
) {
  console.error("CATEGORY COUNT OR TOOL MOVED THE TOP-ANCHORED TOOLBAR", toolbarAlignment)
  process.exit(1)
}
if (
  verticalRhythm.dialog.delta > 1
  || verticalRhythm.toolbar.delta > 1
  || verticalRhythm.stats.delta > 1
  || Math.min(verticalRhythm.dialog.paddingTop, verticalRhythm.toolbar.paddingTop, verticalRhythm.stats.paddingTop) < 7.5
  || Math.max(verticalRhythm.dialog.paddingTop, verticalRhythm.toolbar.paddingTop, verticalRhythm.stats.paddingTop)
    - Math.min(verticalRhythm.dialog.paddingTop, verticalRhythm.toolbar.paddingTop, verticalRhythm.stats.paddingTop) > 0.5
  || Math.max(verticalRhythm.dialog.paddingBottom, verticalRhythm.toolbar.paddingBottom, verticalRhythm.stats.paddingBottom)
    - Math.min(verticalRhythm.dialog.paddingBottom, verticalRhythm.toolbar.paddingBottom, verticalRhythm.stats.paddingBottom) > 0.5
  || !verticalRhythm.overflow.startsAtTop
  || !verticalRhythm.overflow.scrolls
) {
  console.error("SHARED SLOT VERTICAL RHYTHM REGRESSED", verticalRhythm)
  process.exit(1)
}
if (emptyState.timelineStart !== "起点" || emptyState.timelineEnd !== "终点" || emptyState.timelineCopy !== "从起点拖到终点" || emptyState.timelinePointerEvents !== "none" || !emptyState.timelineInsideTrack || !emptyState.timelineNearStart || emptyState.persistentTimelineGuideCount !== 0 || emptyState.noPaletteTimelineGuideCount !== 0 || !emptyState.narrowGuideInsideTrack || !emptyState.zeroToolbarFillsSlot || !emptyState.zeroToolbarButtonClearsSouthHandle || !emptyState.zeroToolbarKeepsNormalShell || emptyState.zeroToolbarSlotRows < 4) { console.error("TIMELINE/FIRST-CATEGORY EMPTY STATE REGRESSED", emptyState); process.exit(1) }
if (emptyState.statsLabel !== "创建记录后，这里会显示用时分布" || emptyState.statsSlotBorderStyle !== "dashed" || emptyState.statsInnerBorderStyle !== "none" || !emptyState.statsFits || !emptyState.statsFillsSlot || !emptyState.statsSlotOwnsBorder || emptyState.legacyStatsChildren !== 0) { console.error("STATS EMPTY STATE REGRESSED", emptyState); process.exit(1) }
if (!emptyState.statsGripNotch || emptyState.statsGripNotch.content === "none" || emptyState.statsGripNotch.width < emptyState.statsGripNotch.gripWidth + 6 || emptyState.statsGripNotch.height < emptyState.statsGripNotch.gripHeight + 6 || emptyState.statsGripNotch.background === "rgba(0, 0, 0, 0)" || emptyState.statsGripNotch.opacity !== "0") { console.error("EMPTY STATE GRIP LOST ITS BORDER CLEARANCE", emptyState.statsGripNotch); process.exit(1) }
if (statsEmptyHover.slotBorderStyle !== "dashed" || statsEmptyHover.innerBorderStyle !== "none" || statsEmptyHover.notchOpacity !== "1" || zeroToolbarEmptyHover.slotBorderStyle !== "solid" || zeroToolbarEmptyHover.buttonBorderStyle !== "none") { console.error("EMPTY STATE HOVER CREATED A SECOND BORDER", { statsEmptyHover, zeroToolbarEmptyHover }); process.exit(1) }
if (!emptyResponsive.statsFits || emptyResponsive.statsLabelNoWrap !== "nowrap" || !emptyResponsive.timelineScrollsInternally || emptyResponsive.bodyOverflowsViewport) { console.error("BLANK BLOCK NARROW LAYOUT REGRESSED", emptyResponsive); process.exit(1) }
const emptySlots = Object.fromEntries(emptyState.slots.map((slot) => [slot.id, slot]))
if (
  emptyState.slots.length !== 4 ||
  emptySlots.dialog?.x !== 0 || emptySlots.dialog?.y !== 0 || emptySlots.dialog?.w !== 7 ||
  emptySlots.toolbar?.x !== 0 || emptySlots.toolbar?.y !== 4 || emptySlots.toolbar?.w !== 7 ||
  emptySlots.stats?.x !== 0 || emptySlots.stats?.y !== 7 || emptySlots.stats?.w !== 7 || emptySlots.stats?.h !== 2 ||
  emptySlots.timeline?.x !== 7 || emptySlots.timeline?.y !== 0 || emptySlots.timeline?.w !== 5
) { console.error("BLANK BLOCK DEFAULT LAYOUT REGRESSED", emptyState); process.exit(1) }
if (!textSaveRetry.afterFailure.textareaKept || !textSaveRetry.afterFailure.value.endsWith("第五句。") || textSaveRetry.afterFailure.attempts !== 1 || textSaveRetry.attempts.length !== 2 || textSaveRetry.attempts[1] !== textSaveRetry.afterFailure.value) { console.error("FAILED TEXT SAVE DID NOT KEEP/RETRY DRAFT", textSaveRetry); process.exit(1) }
if (!textSaveBeforeRemount.returnedPromise || !textSaveBeforeRemount.waitedForSave || !textSaveBeforeRemount.draftSurvived || textSaveBeforeRemount.valueAfterSave !== "重绘期间也不能丢") { console.error("TEXT SAVE/REMOUNT CONTRACT REGRESSED", textSaveBeforeRemount); process.exit(1) }
if (state.nativeTitleCount !== 0 || state.gripAriaLabel !== "拖拽移动此组件") { console.error("GRID TOOLTIP CONTRACT REGRESSED", state); process.exit(1) }
if (
  state.timelineLabelStates.hover.actualText !== state.timelineLabelStates.rest.actualText ||
  state.timelineLabelStates.hover.planText !== state.timelineLabelStates.rest.planText ||
  state.timelineLabelStates.focus.actualText !== state.timelineLabelStates.rest.actualText ||
  state.timelineLabelStates.focus.planText !== state.timelineLabelStates.rest.planText ||
  state.timelineLabelStates.hover.actualStroke !== "rgb(128, 80, 220)" ||
  state.timelineLabelStates.hover.planStroke !== "rgb(128, 80, 220)" ||
  state.timelineLabelStates.focus.actualStroke !== "rgb(128, 80, 220)" ||
  state.timelineLabelStates.focus.planStroke !== "rgb(128, 80, 220)"
) { console.error("TIMELINE LABEL COLOR CHANGED WITH HOVER/FOCUS", state.timelineLabelStates); process.exit(1) }
if (state.gripStyle.appearance !== "none" || state.gripStyle.background === "rgba(0, 0, 0, 0)" || state.gripStyle.shadow !== "none") { console.error("GRID GRIP BUTTON CHROME REGRESSED", state.gripStyle); process.exit(1) }
if (
  !state.gripAlignment.dialog || !state.gripAlignment.timeline ||
  Math.abs(state.gripAlignment.timeline.top - state.gripAlignment.dialog.top) > 0.5 ||
  Math.abs(state.gripAlignment.timeline.left - state.gripAlignment.dialog.left) > 0.5
) { console.error("TIMELINE MOVE GRIP DRIFTED FROM THE SHARED SLOT ANCHOR", state.gripAlignment); process.exit(1) }
if (!state.toolbarNeutrals.inactive || state.toolbarNeutrals.inactive !== state.toolbarNeutrals.swatch) { console.error("BRUSH/SWATCH NEUTRAL BACKGROUNDS DIVERGED", state.toolbarNeutrals); process.exit(1) }
if (state.toolbarNeutrals.modeBorder !== "rgba(0, 0, 0, 0)" || state.toolbarNeutrals.swatchBorder !== "rgba(0, 0, 0, 0)" || state.toolbarNeutrals.activeSwatchBorder !== "rgb(128, 80, 220)") { console.error("BRUSH/SWATCH BORDER STATES DIVERGED", state.toolbarNeutrals); process.exit(1) }
if (state.toolbarNeutrals.planTrackBackground === "rgba(0, 0, 0, 0)" || state.toolbarNeutrals.planThumbBackground === "rgba(0, 0, 0, 0)") { console.error("PLAN MODE SWITCH LOST ITS VISIBLE STATE", state.toolbarNeutrals); process.exit(1) }
if (!blockActionHit.settings.targetClass?.includes("oneday-open-settings") || !blockActionHit.more.targetClass?.includes("oneday-more-actions") || blockActionHit.settings.cursor !== "pointer" || blockActionHit.more.cursor !== "pointer" || blockActionHit.settings.zIndex !== "200" || blockActionHit.more.zIndex !== "200" || blockActionClicks.join(",") !== "settings,more") { console.error("BLOCK ACTIONS LOST POINTER HIT TESTING", { blockActionHit, blockActionClicks }); process.exit(1) }
if (innerScrollOwned.inner <= 0 || innerScrollOwned.block !== 0 || innerScrollOwned.page !== 0) { console.error("INNER SCROLLER DID NOT OWN AVAILABLE WHEEL DELTA", innerScrollOwned); process.exit(1) }
if (blockScrollOwned.block <= 0 || blockScrollOwned.page !== 0) { console.error("WHEEL DID NOT CHAIN FROM INNER SCROLLER TO BLOCK", blockScrollOwned); process.exit(1) }
if (pageScrollOwned.page <= 0) { console.error("WHEEL DID NOT CHAIN FROM BLOCK TO PAGE", pageScrollOwned); process.exit(1) }
if (
  state.designSystem.missing ||
  ["container", "slot", "grip", "swatch", "action", "viewButton"].some((key) => state.designSystem.radii[key] !== "7px") ||
  state.designSystem.radii.viewGroup !== "9px" ||
  state.designSystem.radii.statTrack !== "4px" ||
  state.designSystem.surfaces.grip !== state.designSystem.surfaces.swatch ||
  state.designSystem.surfaces.swatch !== state.designSystem.surfaces.action ||
  state.designSystem.surfaces.viewGroup !== state.designSystem.surfaces.statTrack ||
  state.designSystem.actionOpacity !== "1"
) { console.error("ONEDAY DESIGN TOKEN CONTRACT REGRESSED", state.designSystem); process.exit(1) }
if (
  Math.abs(state.toolbarNeutrals.inactiveHeight - state.toolbarNeutrals.swatchHeight) > 0.5
  || Math.abs(state.toolbarNeutrals.toggleHeight - state.toolbarNeutrals.swatchHeight) > 0.5
  || Math.abs(state.toolbarNeutrals.planHeight - state.toolbarNeutrals.swatchHeight) > 0.5
  || Math.abs(state.toolbarNeutrals.viewButtonHeight - state.toolbarNeutrals.swatchHeight) > 0.5
) { console.error("COMPACT CONTROL HEIGHTS DIVERGED", state.toolbarNeutrals); process.exit(1) }
const contentInsetValues = Object.values(state.contentInsets.offsets).flatMap(({ left, right }) => [left, right])
if (contentInsetValues.some((value) => Math.abs(value - contentInsetValues[0]) > 0.5) || state.contentInsets.toolbarGripGap < -0.5) { console.error("ONEDAY CONTENT INSET CONTRACT REGRESSED", state.contentInsets); process.exit(1) }
if (
  Object.values(blockResizeCancel.before).some((value) => value <= 0) ||
  JSON.stringify(blockResizeCancel.after) !== JSON.stringify(blockResizeCancel.before) ||
  blockResizeCancel.events.join(",") !== "start,cancel"
) { console.error("BLOCK RESIZE CANCEL LOST INTERNAL SCROLL", blockResizeCancel); process.exit(1) }
if (blockResize.containerW >= blockGeometryBefore.containerW - 100 || blockResize.containerH >= blockGeometryBefore.containerH - 100) { console.error("BLOCK VIEWPORT DID NOT RESIZE", { blockGeometryBefore, blockResize }); process.exit(1) }
if (Math.abs(blockResize.bodyW - blockGeometryBefore.bodyW) > 1 || Math.abs(blockResize.timelineW - blockGeometryBefore.timelineW) > 1 || Math.abs(blockResize.timelineH - blockGeometryBefore.timelineH) > 1) { console.error("INNER GRID CHANGED WITH BLOCK VIEWPORT", { blockGeometryBefore, blockResize }); process.exit(1) }
if (blockResize.scrollLeft <= 0 || blockResize.scrollTop <= 0 || blockResize.outerScrollLeft !== 0 || blockResize.outerScrollTop !== 0) { console.error("BLOCK OVERFLOW IS NOT INTERNAL", blockResize); process.exit(1) }
if (
  blockGeometryBefore.embedBorderRight !== 0 ||
  blockGeometryBefore.embedShadow !== "none" ||
  blockGeometryBefore.containerShadow === "none" ||
  Math.abs(blockResize.embedRight - blockGeometryBefore.embedRight) > 1 ||
  blockGeometryBefore.containerRight - blockResize.containerRight < 170 ||
  blockResize.handleDelta > 1 ||
  blockResize.handleOpacity !== "0" ||
  blockResize.commits.length !== 1 ||
  Math.abs(blockResize.commits[0].canvasWidth - blockGeometryBefore.bodyW) > 1 ||
  blockResize.events[0] !== "start" ||
  !blockResize.events.slice(1, -1).every((event) => event === "preview:captured-before-preview") ||
  blockResize.events.at(-1) !== "commit:captured-before-preview"
) { console.error("BLOCK RESIZE CHROME/PERSISTENCE REGRESSED", { blockGeometryBefore, blockResize }); process.exit(1) }
if (Math.abs(scrolledEdgeChrome.leftGap - 4) > 0.5 || Math.abs(scrolledEdgeChrome.rightGap - 4) > 0.5 || scrolledEdgeChrome.leftBorderWidth !== 1 || scrolledEdgeChrome.rightBorderWidth !== 1) { console.error("SCROLLED SLOT EDGE/GUTTER REGRESSED", scrolledEdgeChrome); process.exit(1) }
if (rightEdgeBorder.width !== 1 || rightEdgeBorder.style !== "solid" || rightEdgeBorder.color !== "rgb(120, 120, 120)") { console.error("RIGHTMOST SLOT BORDER IS NOT VISIBLE", rightEdgeBorder); process.exit(1) }
if (state.slots.length === 0 || state.slots.some((s) => s.html === 0)) { console.error("EMPTY SLOT"); process.exit(1) }
if (state.slots.some((s) => s.w === 0 || s.h === 0)) { console.error("COLLAPSED SLOT (zero size)"); process.exit(1) }
if (process.env.ONEDAY_SMOKE_CLASSIC_SCROLLBARS) console.log("outerInsets", JSON.stringify(state.outerInsets))
if (Object.values(state.outerInsets).slice(0, 4).some((gap) => Math.abs(gap - 4) > 0.5)) { console.error("BLOCK OUTER INSETS ARE NOT UNIFORM", state.outerInsets); process.exit(1) }
if (Math.abs(state.outerInsets.containerWidth - state.outerInsets.bodyWidth - 8) > 1) { console.error("BLOCK HORIZONTAL INSET CHANGED TOTAL WIDTH", state.outerInsets); process.exit(1) }
if (state.widthHandle.centerDelta > 1 || state.widthHandle.topDelta > 1 || state.widthHandle.bottomDelta > 1 || state.widthHandle.width > 3.1) { console.error("WIDTH HANDLE MISALIGNED", state.widthHandle); process.exit(1) }
if (state.widthHandle.opacity !== "0" || state.widthHandle.background !== "rgba(0, 0, 0, 0)") { console.error("WIDTH HANDLE VISIBLE AT REST", state.widthHandle); process.exit(1) }
if (widthHandleHover.opacity !== "0" || widthHandleHover.background !== "rgba(0, 0, 0, 0)") { console.error("WIDTH HANDLE VISIBLE ON HOVER", widthHandleHover); process.exit(1) }
if (!widthDrag || widthDrag.topDelta > 1 || widthDrag.bottomDelta > 1 || widthDrag.handleOpacity !== "0") { console.error("WIDTH PREVIEW MISALIGNED", widthDrag); process.exit(1) }
if (timelineInternalScroll.missing || timelineInternalScroll.paneScrollTop <= 0 || timelineInternalScroll.paneScrollLeft <= 0 || timelineInternalScroll.slotScrollTop !== 0 || timelineInternalScroll.slotScrollLeft !== 0 || timelineInternalScroll.slotOverflowY !== "hidden" || timelineInternalScroll.paneOverflowY !== "auto") { console.error("TIMELINE CONTENT IS NOT THE SCROLLER", timelineInternalScroll); process.exit(1) }
if (timelineInternalScroll.westDelta > 1 || timelineInternalScroll.eastDelta > 1 || timelineInternalScroll.handleDelta > 1) { console.error("TIMELINE GRID HANDLES MOVED WITH CONTENT", timelineInternalScroll); process.exit(1) }
if (timelineInternalScroll.handleBackgrounds.some((color) => color !== "rgba(0, 0, 0, 0)")) { console.error("TIMELINE GRID HANDLE BECAME VISIBLE", timelineInternalScroll); process.exit(1) }
if (timelineInternalScroll.widthHandleParent !== "oneday-svg-holder" || timelineInternalScroll.widthHandleTrackDelta > 1) { console.error("TIMELINE WIDTH HANDLE DETACHED FROM TRACK", timelineInternalScroll); process.exit(1) }
if (genericGripScroll.missing || genericGripScroll.scrollLeft <= 0 || genericGripScroll.scrollTop <= 0 || Math.abs(genericGripScroll.beforeX - 3) > 1 || Math.abs(genericGripScroll.beforeY - 3) > 1 || Math.abs(genericGripScroll.afterX - 3) > 1 || Math.abs(genericGripScroll.afterY - 3) > 1) { console.error("SLOT MOVE GRIP SCROLLED WITH CONTENT", genericGripScroll); process.exit(1) }
if (genericGripScroll.visibleWidth < genericGripScroll.width - 1 || genericGripScroll.visibleHeight < genericGripScroll.height - 1 || !genericGripScroll.hit || genericGripScroll.anchor !== "oneday-slot-grip-anchor") { console.error("SLOT MOVE GRIP IS CLIPPED OR NOT CLICKABLE", genericGripScroll); process.exit(1) }
if (Object.values(mobileDefault).some((display) => display !== "none")) { console.error("MOBILE HANDLES LEAKED", mobileDefault); process.exit(1) }
if (mobileEditing.grip.display === "none" || mobileEditing.grip.w < 44 || mobileEditing.grip.h < 44) { console.error("MOBILE GRIP TOO SMALL", mobileEditing); process.exit(1) }
if (mobileEditing.handle.display === "none" || mobileEditing.handle.w < 20) { console.error("MOBILE RESIZE HANDLE TOO SMALL", mobileEditing); process.exit(1) }
if (mobileEditing.width.display === "none" || mobileEditing.width.w < 20) { console.error("MOBILE WIDTH HANDLE TOO SMALL", mobileEditing); process.exit(1) }
if (mobileEditing.block.display === "none" || mobileEditing.block.w < 20 || mobileEditing.blockCorner.w < 32 || mobileEditing.blockCorner.h < 32) { console.error("MOBILE BLOCK RESIZE HANDLE TOO SMALL", mobileEditing); process.exit(1) }
if (!timeEndFocus.popover || timeEndFocus.activeLabel !== "结束时间" || timeEndFocus.saved !== 0) { console.error("TIME END INPUT DISMISSED", timeEndFocus); process.exit(1) }
if (timeCommitted.popover || timeCommitted.saved.length !== 1 || timeCommitted.saved[0].end !== "12:45") { console.error("TIME EDIT DID NOT COMMIT", timeCommitted); process.exit(1) }
if (dateRestStyle.missing || dateRestStyle.background !== "rgba(0, 0, 0, 0)" || dateRestStyle.controlWidth >= dateRestStyle.topbarWidth * 0.75 || dateRestStyle.gap < 6) { console.error("DATE CONTROL REST LAYOUT REGRESSED", dateRestStyle); process.exit(1) }
if (dateHoverBackground === dateRestStyle.background) { console.error("DATE CONTROL HAS NO HOVER AFFORDANCE", { dateRestStyle, dateHoverBackground }); process.exit(1) }
if (dateOpened.text !== "2026-08-18 周二" || dateOpened.title !== null || dateOpened.expanded !== "true" || dateOpened.monthTitle !== "2026年8月" || dateOpened.dayCount !== 42 || dateOpened.selectedDate !== "2026-08-18" || dateOpened.focusedDate !== "2026-08-18" || dateOpened.hasSegmentedInput) { console.error("DATE CALENDAR DID NOT OPEN ACCESSIBLY", dateOpened); process.exit(1) }
if (!dateTransientBlur.popover || dateTransientBlur.saved.length !== 0) { console.error("DATE PICKER CLOSED OR COMMITTED ON TRANSIENT BLUR", dateTransientBlur); process.exit(1) }
if (dateCommitted.popover || dateCommitted.expanded !== "false" || dateCommitted.saved.join(",") !== "2026-08-24" || dateCommitted.cursor !== "pointer") { console.error("DATE EDIT DID NOT COMMIT", dateCommitted); process.exit(1) }
if (textReadScroll.scrollTop <= 0 || textReadScroll.slotScrollTop !== 0 || textReadScroll.handleDelta > 1) { console.error("TEXT HANDLES MOVED IN READING MODE", textReadScroll); process.exit(1) }
if (!textMarkdownSemantics.exists || !textMarkdownSemantics.nativeMarkdownContainer) { console.error("TEXT MARKDOWN DOES NOT USE OBSIDIAN NATIVE CONTAINER", textMarkdownSemantics); process.exit(1) }
if (!textPaneEditing.textarea || !textPaneEditing.slotEditing || !textPaneEditing.paneFillsSlot || !textPaneEditing.textareaFillsBlankInterior) { console.error("TEXT PANE BLANK CLICK DID NOT EDIT", { ...textPaneEditing, textSlotBox, textClickPoint, textClickTarget }); process.exit(1) }
if (Math.abs(textPaneEditing.viewportStable.paneTop - textClickViewportBefore.paneTop) > 0.5 || Math.abs(textPaneEditing.viewportStable.pageTop - textClickViewportBefore.pageTop) > 0.5 || Math.abs(textPaneEditing.viewportStable.paneScrollTop - textClickViewportBefore.paneScrollTop) > 1) { console.error("TEXT BLANK CLICK MOVED THE VIEWPORT", { before: textClickViewportBefore, after: textPaneEditing.viewportStable }); process.exit(1) }
if (textResizeWhileEditing.display === "none" || !textResizeWhileEditing.resized || !textResizeWhileEditing.textarea || !textResizeWhileEditing.focused) { console.error("TEXT RESIZE UNAVAILABLE WHILE EDITING", textResizeWhileEditing); process.exit(1) }
if (textEditScroll.before <= 0 || textEditScroll.after < textEditScroll.before - 2) { console.error("TEXT EDIT SCROLL JUMPED TO TOP", textEditScroll); process.exit(1) }
if (textEditScroll.slotOverflowY !== "hidden" || textEditScroll.paneOverflowY !== "auto" || textEditScroll.slotScrollTop !== 0 || textEditScroll.handleDelta > 1) { console.error("TEXT HANDLES SCROLLED WITH CONTENT", textEditScroll); process.exit(1) }
if (textEditScroll.handleBackgrounds.some((color) => color !== "rgba(0, 0, 0, 0)")) { console.error("TEXT HANDLE BECAME VISIBLE", textEditScroll); process.exit(1) }
if (textWindowBlurSave.saves.length !== 1 || textWindowBlurSave.saves[0].index !== 0 || textWindowBlurSave.saves[0].text !== textWindowBlurSave.expected || !textWindowBlurSave.expected.endsWith("末尾继续编辑")) { console.error("TEXT WINDOW BLUR DID NOT FLUSH LATEST CONTENT", textWindowBlurSave); process.exit(1) }
if (quickInputStyle.shadow !== "none" || quickInputStyle.borderColor !== "rgb(90, 80, 220)") { console.error("QUICK INPUT SHADOW/FOCUS REGRESSED", quickInputStyle); process.exit(1) }
for (const [hostWidth, state] of Object.entries(defaultTimeline)) {
  if (
    state.lastHourLabel !== "23"
    || !state.lastHourVisible
    || state.holderScrollHeight > state.holderClientHeight + 0.5
    || state.holderScrollTop !== 0
    || Math.abs(state.chrome - state.chromeAllowance) > 0.5
    || state.slotRows * 20 < state.svgHeight + state.chrome
  ) { console.error("DEFAULT TIMELINE SLOT CLIPS THE END OF THE RANGE @" + hostWidth, state); process.exit(1) }
  // Newly requested components belong beside the timeline in the text
  // column, never stacked under the whole timeline.
  for (const [id, rect] of Object.entries(state.components)) {
    if (rect.top >= state.timelineRect.bottom - 1 || rect.right > state.timelineRect.left + 1 || rect.bottom > state.timelineRect.bottom + 1) {
      console.error("DEFAULT COMPONENT " + id + " LANDED BELOW THE TIMELINE @" + hostWidth, state); process.exit(1)
    }
  }
  if (state.bodyBottom > state.timelineRect.bottom + 1 || Math.abs(state.hostWidth - Number(hostWidth)) > 1) { console.error("DEFAULT COMPONENTS GREW THE BLOCK PAST THE TIMELINE @" + hostWidth, state); process.exit(1) }
}
console.log("OK mount smoke passed")
