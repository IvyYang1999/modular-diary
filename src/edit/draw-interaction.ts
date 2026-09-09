/**
 * Canvas-style drawing on the rendered SVG timeline (M3):
 * pick a highlighter (toolbar) -> drag on the track -> ghost preview with
 * live time/duration -> release writes a new entry line into the source.
 * Right-click a block -> context menu (handled by caller).
 *
 * Pure DOM (no Obsidian imports) so Playwright can smoke it headlessly.
 */
import { TimelineDoc } from "../core/types"
import { formatClock, formatHours } from "../core/duration"
import { formatEntryLine } from "../core/format"
import { AXIS_PAD_TOP, minutesFromY, snapMinutes, SNAP_MINUTES, yFromMinutes } from "../core/geometry"
import { darkThemeBlockFill, relatedTextColor } from "../core/contrast"
import { t } from "../i18n"
import { setPointerInteractionActive } from "./pointer-interaction"
import { nativeControlOwnsTimelineDelete } from "./undo-routing"
import { attachTimelineKeyboardNavigation, timelineObjectCenter, timelineObjectFromEvent } from "./timeline-keyboard"

export interface DrawDeps {
  hourHeight: number
  /** null/empty = 当前没有可用荧光笔；保留编辑与轴延展，但禁止创建新块。 */
  getActiveType: () => string | null
  /** "actual" | "plan" — 计划模式下画出的色块带 plan 前缀 */
  getMode: () => "actual" | "plan"
  getTool?: () => "span" | "marker"
  /** Another interaction family (currently a selected marker) owns the canvas. */
  isInteractionLocked?: () => boolean
  typeColor: (type: string) => string
  onCreate: (entryLine: string, startMin: number) => void | Promise<void>
  onBlockMenu: (line: number, clientX: number, clientY: number) => void
  /** 点击（未拖动）色块 -> focus 切换 */
  onBlockClick: (line: number) => void
  /** 时间轴空白处右键（可挂「添加文字区」等入口） */
  onTrackMenu: (clientX: number, clientY: number) => void
  /** 轴向延展：拖上/下边缘线延长当天范围（整小时吸附） */
  onExtendRange: (startMin: number, endMin: number) => void | Promise<void>
  /** 色块编辑态：当前正在编辑的源码行号（跨渲染保持），null=未编辑 */
  getEditingLine: () => number | null
  setEditingLine: (line: number | null) => void
  /** 编辑态提交新的起止（移动/边缘拖拽） */
  onUpdateSpan: (line: number, startMin: number, endMin: number) => void | Promise<void>
  /** Persistence failures must be visible; optimistic DOM is never success. */
  onMutationError?: (error: unknown) => void
  /** 选中块双击 -> 编辑备注（色块本质是文本框，yyt 2026-08-19） */
  onEditNote: (line: number) => void
  /** 选中块按 Delete -> 删除（yyt 2026-08-19） */
  onDeleteEntry: (line: number) => void | Promise<void>
}

const SVGNS = "http://www.w3.org/2000/svg"
const EDIT_DRAG_THRESHOLD_PX = 4
// Range changes use concrete buttons painted entirely outside the track. The
// visible boundary and every point inside it remain block-creation surfaces.
const RANGE_STEP_BUTTON_HEIGHT = 18
const RANGE_STEP_BUTTON_GAP = 4
const RANGE_STEP_BUTTON_WIDTH = 42
const SPAN_LABEL_HEIGHT = 14
const SPAN_LABEL_MIN_GAP = 16
let previewHatchUid = 0

// Keyboard ownership must follow the concrete renderer the user interacted
// with. A document can contain several mounted Oneday timelines (and the same
// source can be open in more than one pane), so "the first editing SVG" is not
// a valid owner for Delete/Escape.
const activeEditOwnerByDocument = new WeakMap<Document, SVGSVGElement>()
const editKeyRouterOwner = {}
type EditKeyRoutedDocument = Document & {
  __onedayEditKeyRouter?: {
    owner: object
    handler: (event: KeyboardEvent) => void
  }
}

function ensureDocumentEditKeyRouter(dom: Document): void {
  const routed = dom as EditKeyRoutedDocument
  if (routed.__onedayEditKeyRouter?.owner === editKeyRouterOwner) return
  if (routed.__onedayEditKeyRouter) {
    dom.removeEventListener("keydown", routed.__onedayEditKeyRouter.handler, true)
  }
  const handler = (event: KeyboardEvent): void => {
    if (!['Escape', 'Delete', 'Backspace'].includes(event.key)) return
    const editingSvgs = Array.from(dom.querySelectorAll<SVGSVGElement>(".oneday-svg.is-editing-block"))
    if (editingSvgs.length === 0) return
    const explicitOwners = editingSvgs.filter((candidate) => candidate.dataset.onedayEditOwnerActive === "1")
    const rememberedOwner = activeEditOwnerByDocument.get(dom)
    const editingSvg = explicitOwners.length === 1
      ? explicitOwners[0]
      : rememberedOwner?.isConnected && rememberedOwner.classList.contains("is-editing-block")
        ? rememberedOwner
        : editingSvgs.length === 1 ? editingSvgs[0] : null
    if (!editingSvg || nativeControlOwnsTimelineDelete(event.target as Element | null)) return
    // Capture before CodeMirror's contenteditable handler can consume Delete.
    event.preventDefault()
    event.stopPropagation()
    const CustomEventCtor = dom.defaultView?.CustomEvent ?? CustomEvent
    editingSvg.dispatchEvent(new CustomEventCtor("oneday-esc", { detail: { key: event.key } }))
    editingSvgs.forEach((candidate) => {
      if (candidate !== editingSvg) candidate.dispatchEvent(new CustomEventCtor("oneday-sync-edit-visual"))
    })
  }
  dom.addEventListener("keydown", handler, true)
  routed.__onedayEditKeyRouter = { owner: editKeyRouterOwner, handler }
}

export function requestTimelineEntryDelete(svg: SVGSVGElement, line: number): boolean {
  const CustomEventCtor = svg.ownerDocument.defaultView?.CustomEvent ?? CustomEvent
  const event = new CustomEventCtor("oneday-delete-entry-request", {
    bubbles: false,
    cancelable: true,
    detail: { line },
  })
  return !svg.dispatchEvent(event)
}

/**
 * Keep both resize edges and a moveable centre on short blocks. A fixed 8px
 * edge zone consumes a 20-minute block completely, while disabling edges
 * below a threshold makes exact spans impossible to resize. One quarter per
 * edge leaves the middle half for moving at every practical rendered height.
 */
function editEdgeZone(height: number): number {
  return Math.min(8, Math.max(1, height / 4))
}

export function attachDrawInteraction(container: HTMLElement, doc: TimelineDoc, deps: DrawDeps): void {
  const svg = container.querySelector<SVGSVGElement>("svg.oneday-svg")
  const track = container.querySelector<SVGRectElement>("rect.oneday-track")
  const statusEl = container.querySelector<HTMLElement>(".oneday-draw-status")
  if (!svg || !track) return
  const dom = svg.ownerDocument
  const domWindow = dom.defaultView

  // The timeline is an interaction canvas, not selectable document copy.
  // Prevent native selection at the source so a drag cannot leave hour labels
  // and block text highlighted when Chromium briefly loses pointer capture.
  svg.addEventListener("selectstart", (event) => event.preventDefault())
  // A mouse press must not move focus into the SVG: blocks are Tab-focusable,
  // but inside CodeMirror a focus change under the widget triggers the editor's
  // own scroll restoration (page jumped to the top on every create/edit,
  // yyt 2026-09-09). preventDefault on mousedown keeps focus where it was
  // while pointer capture, clicks and double-clicks keep working.
  svg.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    // preventDefault also cancels the blur a click would normally cause. The
    // block's own inputs (todo form, quick capture, text pane) rely on that
    // blur to commit drafts and to release the deferred refresh, so blur them
    // explicitly (any block in the note; the click would have blurred them
    // too). CodeMirror's own content element keeps focus, so the editor never
    // sees a focus change.
    const active = dom.activeElement as HTMLElement | null
    if (active && active !== dom.body && !active.classList.contains("cm-content") && !svg.contains(active)) active.blur()
  })

  const activateEditOwner = (): void => {
    dom.querySelectorAll<SVGSVGElement>('[data-oneday-edit-owner-active="1"]').forEach((candidate) => {
      if (candidate !== svg) delete candidate.dataset.onedayEditOwnerActive
    })
    activeEditOwnerByDocument.set(dom, svg)
    svg.dataset.onedayEditOwnerActive = "1"
  }

  const deactivateEditOwner = (): void => {
    delete svg.dataset.onedayEditOwnerActive
    if (activeEditOwnerByDocument.get(dom) === svg) activeEditOwnerByDocument.delete(dom)
  }

  const trackX = Number(track.getAttribute("x"))
  const trackW = Number(track.getAttribute("width"))
  // Read live: the annotation-lane fit rewrites width/viewBox after mount, and a
  // stale width turns the pointer→minutes scale away from 1 (blocks land below
  // the cursor, yyt 2026-09-09).
  const svgWidth = (): number => Number(svg.getAttribute("width")) || svg.viewBox.baseVal.width

  let dragOriginTop = 0
  let dragScale = 1
  const toLocalY = (clientY: number): number => (clientY - dragOriginTop) * dragScale
  const clampMin = (m: number): number => Math.min(doc.rangeEnd, Math.max(doc.rangeStart, m))
  let fineSnap = false // ⌥Option 按下时 1 分钟吸附（yyt：精确编辑入口）
  const snapInteractionMin = (m: number): number => snapMinutes(m, fineSnap ? 1 : SNAP_MINUTES)
  const precisionKey = /mac/i.test(domWindow?.navigator.platform ?? "") ? "⌥" : "Alt"

  let dragging = false
  // 色块编辑态：边缘拖拽改起止 / 中部拖动移动整块
  let editDrag: {
    line: number
    mode: "top" | "bottom" | "move"
    fromHandle: boolean
    startMin: number
    endMin: number
    grabOffsetMin: number
    pointerStartX: number
    pointerStartY: number
    moved: boolean
    originalY: number
    originalHeight: number
  } | null = null
  let dragStartMin = 0
  let dragStartRawMin = 0
  let dragPointerType = "mouse"
  let downBlockLine: number | null = null
  let downY = 0
  let ghost: SVGRectElement | null = null
  let ghostHatch: SVGRectElement | null = null
  let ghostDuration: SVGTextElement | null = null
  let ghostPattern: SVGDefsElement | null = null
  let spanPreview: SVGGElement | null = null
  let precisionHint: SVGGElement | null = null
  let activePointerId: number | null = null

  const beginPointerInteraction = (e: PointerEvent): void => {
    activePointerId = e.pointerId
    setPointerInteractionActive(container, true)
  }

  type EditPointerHit = {
    mode: "top" | "bottom" | "move"
    /** True only for the explicit transparent edge overlay. */
    fromHandle: boolean
  }

  /**
   * The cursor and pointerdown paths must classify the exact same surface.
   * Otherwise a stale resize cursor can advertise editing while pointerdown
   * falls through to block creation.
   */
  const resolveEditPointerHit = (e: PointerEvent, editing: SVGRectElement): EditPointerHit | null => {
    const eventTarget = e.target as Element | null
    const edge = eventTarget?.closest<SVGRectElement>("rect.oneday-edit-edge") ?? null
    if (edge && Number(edge.dataset.line) === Number(editing.dataset.line)) {
      return { mode: edge.dataset.edge === "top" ? "top" : "bottom", fromHandle: true }
    }

    const target = eventTarget?.closest("rect.oneday-block")
    if (target !== editing) return null
    const rect0 = svg.getBoundingClientRect()
    const localY = (e.clientY - rect0.top) * (svgWidth() / rect0.width)
    const top = Number(editing.getAttribute("y"))
    const height = Number(editing.getAttribute("height"))
    const bottom = top + height
    const edgeZone = editEdgeZone(height)
    const mode = Math.abs(localY - top) <= edgeZone
      ? "top"
      : Math.abs(localY - bottom) <= edgeZone ? "bottom" : "move"
    return { mode, fromHandle: false }
  }

  const startEditDrag = (
    e: PointerEvent,
    editing: SVGRectElement,
    forcedMode?: "top" | "bottom"
  ): boolean => {
    const rect0 = svg.getBoundingClientRect()
    dragOriginTop = rect0.top
    dragScale = svgWidth() / rect0.width
    const localY0 = toLocalY(e.clientY)
    const line = Number(editing.dataset.line)
    const entry = doc.entries.find((it) => it.line === line)
    if (!entry) return false

    const top = Number(editing.getAttribute("y"))
    const height = Number(editing.getAttribute("height"))
    const bottom = top + height
    const edgeZone = editEdgeZone(height)
    const mode = forcedMode
      ?? (Math.abs(localY0 - top) <= edgeZone
        ? "top"
        : Math.abs(localY0 - bottom) <= edgeZone ? "bottom" : "move")
    editing.style.cursor = mode === "move" ? "grabbing" : "ns-resize"
    editDrag = {
      line,
      mode,
      fromHandle: forcedMode !== undefined,
      startMin: entry.startMin,
      endMin: entry.endMin,
      grabOffsetMin: snapInteractionMin(minutesFromY(localY0, doc.rangeStart, deps.hourHeight)) - entry.startMin,
      pointerStartX: e.clientX,
      pointerStartY: e.clientY,
      moved: false,
      originalY: top,
      originalHeight: height,
    }
    svg.setPointerCapture(e.pointerId)
    beginPointerInteraction(e)
    return true
  }

  /**
   * A rendered entry is intentionally composed from several independent SVG
   * nodes (block, hatch, duration, wrapped note and optional side label). A
   * move preview must treat them as one visual object; moving only the rect
   * leaves its copy behind until the Markdown redraw catches up.
   */
  const setEntryMovePreview = (line: number, deltaY: number): void => {
    const transform = Math.abs(deltaY) < 0.01 ? null : `translate(0 ${deltaY})`
    svg.querySelectorAll<SVGElement>(`[data-line="${line}"]`).forEach((node) => {
      if (transform === null) node.removeAttribute("transform")
      else node.setAttribute("transform", transform)
    })
  }

  /** Resize every visual owned by a source line as one frame. */
  const setEntryResizePreview = (
    line: number,
    y: number,
    height: number,
    originalCenter: number,
    durationMin: number,
  ): void => {
    const centerDelta = y + height / 2 - originalCenter
    const duration = formatHours(durationMin)
    svg.querySelectorAll<SVGElement>(`[data-line="${line}"]`).forEach((node) => {
      if (node.classList.contains("oneday-edit-edge") || node.classList.contains("oneday-edit-edge-line")) return
      if (node.matches("rect.oneday-block")) {
        node.setAttribute("y", String(y))
        node.setAttribute("height", String(Math.max(2, height)))
        return
      }
      if (node.matches("rect.oneday-plan-hatch")) {
        node.setAttribute("y", String(y))
        node.setAttribute("height", String(Math.max(2, height)))
        return
      }
      node.setAttribute("transform", `translate(0 ${centerDelta})`)
      if (node.matches("text.oneday-duration")) {
        const current = node.textContent ?? ""
        const separator = current.indexOf(" · ")
        node.textContent = separator >= 0 ? `${duration}${current.slice(separator)}` : duration
      }
    })
  }

  const resetEntryResizePreview = (drag: NonNullable<typeof editDrag>): void => {
    const originalCenter = drag.originalY + drag.originalHeight / 2
    setEntryResizePreview(
      drag.line,
      drag.originalY,
      drag.originalHeight,
      originalCenter,
      drag.endMin - drag.startMin,
    )
    svg.querySelectorAll<SVGElement>(`[data-line="${drag.line}"]`).forEach((node) => {
      if (!node.matches("rect.oneday-block, rect.oneday-plan-hatch")) node.removeAttribute("transform")
    })
  }

  const setStatus = (text: string): void => {
    if (statusEl) statusEl.textContent = text
  }

  /**
   * SVG paints in document order, so a record being resized or moved over a
   * later record is covered by that record's duration/note copy. Once a
   * gesture really starts, lift the entry's in-track visuals to the top of
   * the paint order (below the transparent edge overlays). Plans stay behind
   * records by design and lane nodes stay in their group; the next Markdown
   * remount restores canonical order.
   */
  const raiseEntryVisuals = (line: number): void => {
    const rect = svg.querySelector<SVGRectElement>(`rect.oneday-block[data-line="${line}"]`)
    if (!rect || rect.classList.contains("oneday-plan")) return
    const firstEdge = svg.querySelector(".oneday-edit-edge")
    // Re-inserting the focused rect drops keyboard focus; hand it back so a
    // click-started gesture does not leave focus on the scroll pane.
    const hadFocus = dom.activeElement === rect
    svg.querySelectorAll<SVGElement>(`[data-line="${line}"]`).forEach((node) => {
      if (node.classList.contains("oneday-edit-edge") || node.closest("g.oneday-side-lane")) return
      svg.insertBefore(node, firstEdge)
    })
    if (hadFocus) rect.focus({ preventScroll: true })
  }

  const removeGhost = (): void => {
    ghost?.remove()
    ghostHatch?.remove()
    ghostDuration?.remove()
    ghostPattern?.remove()
    ghost = null
    ghostHatch = null
    ghostDuration = null
    ghostPattern = null
  }

  const removeSpanPreview = (): void => {
    spanPreview?.remove()
    spanPreview = null
  }

  const removePrecisionHint = (): void => {
    precisionHint?.remove()
    precisionHint = null
  }

  type RangeEdge = "top" | "bottom"
  type RangeAction = "contract" | "extend"

  const rangeAfterStep = (edge: RangeEdge, action: RangeAction): { startMin: number; endMin: number } | null => {
    let startMin = doc.rangeStart
    let endMin = doc.rangeEnd
    if (edge === "top") startMin += action === "extend" ? -60 : 60
    else endMin += action === "extend" ? 60 : -60
    if (startMin < 0 || endMin > 30 * 60 || endMin - startMin < 60) return null

    // Contracting the viewport must never hide authored data. Markers are
    // points and spans own both of their endpoints.
    const earliestContent = Math.min(
      ...doc.entries.map((entry) => entry.startMin),
      ...doc.annotations.map((annotation) => annotation.timeMin),
      Number.POSITIVE_INFINITY,
    )
    const latestContent = Math.max(
      ...doc.entries.map((entry) => entry.endMin),
      ...doc.annotations.map((annotation) => annotation.timeMin),
      Number.NEGATIVE_INFINITY,
    )
    if (action === "contract" && (startMin > earliestContent || endMin < latestContent)) return null
    return { startMin, endMin }
  }

  const stepRange = (edge: RangeEdge, action: RangeAction): void => {
    const next = rangeAfterStep(edge, action)
    if (next) void Promise.resolve(deps.onExtendRange(next.startMin, next.endMin)).catch((error) => {
      deps.onMutationError?.(error)
    })
  }

  const appendRangeStepControls = (edge: RangeEdge): void => {
    const controls = dom.createElementNS(SVGNS, "g")
    controls.setAttribute("class", `oneday-range-step-controls is-${edge}`)
    controls.dataset.edge = edge

    const pairWidth = RANGE_STEP_BUTTON_WIDTH * 2 + RANGE_STEP_BUTTON_GAP
    const startX = trackX + (trackW - pairWidth) / 2
    const edgeY = yFromMinutes(edge === "top" ? doc.rangeStart : doc.rangeEnd, doc.rangeStart, deps.hourHeight)
    const y = edge === "top"
      ? edgeY - RANGE_STEP_BUTTON_HEIGHT - RANGE_STEP_BUTTON_GAP
      : edgeY + RANGE_STEP_BUTTON_GAP

    ;(["contract", "extend"] as RangeAction[]).forEach((action, index) => {
      const button = dom.createElementNS(SVGNS, "g")
      button.setAttribute("class", "oneday-range-step-button")
      button.dataset.edge = edge
      button.dataset.action = action
      button.setAttribute("role", "button")
      const ariaLabel = action === "extend"
        ? t(edge === "top" ? "extendEarlierHour" : "extendLaterHour")
        : t(edge === "top" ? "contractFromStartHour" : "contractFromEndHour")
      button.setAttribute("aria-label", ariaLabel)
      const available = rangeAfterStep(edge, action) !== null
      button.setAttribute("aria-disabled", String(!available))
      button.setAttribute("tabindex", available ? "0" : "-1")

      const x = startX + index * (RANGE_STEP_BUTTON_WIDTH + RANGE_STEP_BUTTON_GAP)
      const backing = dom.createElementNS(SVGNS, "rect")
      backing.setAttribute("class", "oneday-range-step-button-bg")
      backing.setAttribute("x", String(x))
      backing.setAttribute("y", String(y))
      backing.setAttribute("width", String(RANGE_STEP_BUTTON_WIDTH))
      backing.setAttribute("height", String(RANGE_STEP_BUTTON_HEIGHT))
      backing.setAttribute("rx", "4")

      const text = dom.createElementNS(SVGNS, "text")
      text.setAttribute("class", "oneday-range-step-button-text")
      text.setAttribute("x", String(x + RANGE_STEP_BUTTON_WIDTH / 2))
      text.setAttribute("y", String(y + RANGE_STEP_BUTTON_HEIGHT / 2))
      text.setAttribute("text-anchor", "middle")
      text.setAttribute("dominant-baseline", "central")
      text.setAttribute("pointer-events", "none")
      text.textContent = t(action === "contract" ? "decreaseHour" : "increaseHour")
      button.append(backing, text)

      button.addEventListener("pointerdown", (event) => {
        // The button owns exactly its painted rectangle. Do not let the SVG's
        // creation handler reinterpret the same press as a new time block.
        event.preventDefault()
        event.stopPropagation()
      })
      button.addEventListener("click", (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (button.getAttribute("aria-disabled") !== "true") stepRange(edge, action)
      })
      button.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        event.stopPropagation()
        if (button.getAttribute("aria-disabled") !== "true") stepRange(edge, action)
      })
      controls.appendChild(button)
    })
    svg.appendChild(controls)
  }

  appendRangeStepControls("top")
  appendRangeStepControls("bottom")

  /**
   * A quiet, cursor-adjacent helper appears only during new-block creation.
   * It lives inside the SVG so it remains visible beside the active span
   * instead of forcing the user to look at the component footer.
   */
  const updatePrecisionHint = (pointerY: number): void => {
    if (!dragging || !ghost || dragPointerType === "touch") {
      removePrecisionHint()
      return
    }
    if (!precisionHint) {
      precisionHint = dom.createElementNS(SVGNS, "g")
      precisionHint.setAttribute("class", "oneday-precision-hint")
      precisionHint.setAttribute("aria-hidden", "true")
      const backing = dom.createElementNS(SVGNS, "rect")
      backing.setAttribute("class", "oneday-precision-hint-bg")
      backing.setAttribute("rx", "4")
      const text = dom.createElementNS(SVGNS, "text")
      text.setAttribute("class", "oneday-precision-hint-text")
      text.setAttribute("text-anchor", "middle")
      text.setAttribute("dominant-baseline", "central")
      precisionHint.append(backing, text)
      svg.appendChild(precisionHint)
    }

    precisionHint.classList.toggle("is-active", fineSnap)
    const text = precisionHint.querySelector<SVGTextElement>(".oneday-precision-hint-text")
    const backing = precisionHint.querySelector<SVGRectElement>(".oneday-precision-hint-bg")
    if (!text || !backing) return
    text.textContent = t(fineSnap ? "precisionActive" : "precisionHint", { key: precisionKey })

    const centerX = trackX + trackW / 2
    const svgHeight = Number(svg.getAttribute("height")) || pointerY + 20
    const centerY = Math.max(AXIS_PAD_TOP + 10, Math.min(svgHeight - 10, pointerY - 18))
    text.setAttribute("x", String(centerX))
    text.setAttribute("y", String(centerY))
    const measured = text.getComputedTextLength?.() || (text.textContent.length * 5)
    const width = Math.min(trackW - 12, Math.max(54, measured + 12))
    backing.setAttribute("x", String(centerX - width / 2))
    backing.setAttribute("y", String(centerY - 8))
    backing.setAttribute("width", String(width))
    backing.setAttribute("height", "16")
  }

  /**
   * Live start/end labels belong to the dragged span, so keep them beside its
   * two edges instead of in the component footer. Very short spans separate
   * the copy while their ticks/leaders continue to point at the exact edges.
   */
  const updateSpanPreview = (a: number, b: number): void => {
    const startMin = Math.min(a, b)
    const endMin = Math.max(a, b)
    if (endMin <= startMin) {
      removeSpanPreview()
      return
    }

    if (!spanPreview) {
      spanPreview = dom.createElementNS(SVGNS, "g")
      spanPreview.setAttribute("class", "oneday-span-preview-labels")
      spanPreview.setAttribute("aria-hidden", "true")
      svg.appendChild(spanPreview)
    }
    spanPreview.replaceChildren()

    const edgeYStart = yFromMinutes(startMin, doc.rangeStart, deps.hourHeight)
    const edgeYEnd = yFromMinutes(endMin, doc.rangeStart, deps.hourHeight)
    const svgHeight = Number(svg.getAttribute("height")) || edgeYEnd + SPAN_LABEL_HEIGHT
    const minY = SPAN_LABEL_HEIGHT / 2 + 1
    const maxY = Math.max(minY, svgHeight - SPAN_LABEL_HEIGHT / 2 - 1)
    let labelYStart = edgeYStart
    let labelYEnd = edgeYEnd

    if (labelYEnd - labelYStart < SPAN_LABEL_MIN_GAP) {
      const center = (edgeYStart + edgeYEnd) / 2
      labelYStart = center - SPAN_LABEL_MIN_GAP / 2
      labelYEnd = center + SPAN_LABEL_MIN_GAP / 2
    }
    if (labelYStart < minY) {
      const shift = minY - labelYStart
      labelYStart += shift
      labelYEnd += shift
    }
    if (labelYEnd > maxY) {
      const shift = labelYEnd - maxY
      labelYStart -= shift
      labelYEnd -= shift
    }
    labelYStart = Math.max(minY, labelYStart)
    labelYEnd = Math.min(maxY, labelYEnd)

    const addLabel = (kind: "start" | "end", minute: number, edgeY: number, labelY: number): void => {
      const label = dom.createElementNS(SVGNS, "g")
      label.setAttribute("class", `oneday-span-preview-label is-${kind}`)
      label.dataset.minute = String(minute)
      label.dataset.edgeY = String(edgeY)
      label.dataset.labelY = String(labelY)

      if (Math.abs(labelY - edgeY) > 0.5) {
        const leader = dom.createElementNS(SVGNS, "line")
        leader.setAttribute("class", "oneday-span-preview-leader")
        leader.setAttribute("x1", String(trackX - 3))
        leader.setAttribute("y1", String(edgeY))
        leader.setAttribute("x2", String(trackX - 3))
        leader.setAttribute("y2", String(labelY))
        label.appendChild(leader)
      }

      const tick = dom.createElementNS(SVGNS, "line")
      tick.setAttribute("class", "oneday-span-preview-tick")
      tick.setAttribute("x1", String(trackX - 4))
      tick.setAttribute("y1", String(edgeY))
      tick.setAttribute("x2", String(trackX + 3))
      tick.setAttribute("y2", String(edgeY))
      label.appendChild(tick)

      const backing = dom.createElementNS(SVGNS, "rect")
      backing.setAttribute("class", "oneday-span-preview-label-bg")
      backing.setAttribute("x", "1")
      backing.setAttribute("y", String(labelY - SPAN_LABEL_HEIGHT / 2))
      backing.setAttribute("width", String(Math.max(1, trackX - 6)))
      backing.setAttribute("height", String(SPAN_LABEL_HEIGHT))
      backing.setAttribute("rx", "2")
      label.appendChild(backing)

      const text = dom.createElementNS(SVGNS, "text")
      text.setAttribute("class", "oneday-span-preview-label-text")
      text.setAttribute("x", String(trackX - 6))
      text.setAttribute("y", String(labelY))
      text.setAttribute("text-anchor", "end")
      text.setAttribute("dominant-baseline", "central")
      text.textContent = formatClock(minute % (24 * 60))
      label.appendChild(text)
      spanPreview?.appendChild(label)
    }

    addLabel("start", startMin, edgeYStart, labelYStart)
    addLabel("end", endMin, edgeYEnd, labelYEnd)
  }

  svg.addEventListener("pointerdown", (e: PointerEvent) => {
    if (e.button !== 0 || e.defaultPrevented) return
    if (activePointerId !== null && activePointerId !== e.pointerId) return
    fineSnap = e.altKey
    dragPointerType = e.pointerType || "mouse"
    // 编辑态：目标块的边缘/中部手势优先
    const editing = editingRect()
    if (editing) {
      const editHit = resolveEditPointerHit(e, editing)
      if (editHit) {
        if (startEditDrag(e, editing, editHit.fromHandle ? editHit.mode as "top" | "bottom" : undefined)) return
      } else {
        // 点在别处 -> 退出编辑态（本次点击不触发其它操作）
        exitEdit()
        return
      }
    }
    if (deps.isInteractionLocked?.()) return

    const activeType = deps.getActiveType()

    // Marker gestures are owned by marker-interaction. Keeping this gate after
    // the outside extension lane prevents dual creation.
    if (deps.getTool?.() === "marker") return

    // 并列日程：允许从已有色块上起笔（yyt 2026-08-17）；右键菜单不受影响。
    const hit = (e.target as Element | null)?.closest("rect.oneday-block")
    downBlockLine = hit ? Number((hit as HTMLElement).dataset.line) : null
    downY = e.clientY

    // 没有可用荧光笔时，空轨道不能悄悄回退成 misc。已有块仍继续走
    // 下方的短按路径，以便进入编辑态。
    if (!activeType && !hit) return

    dragging = true
    const rect = svg.getBoundingClientRect()
    dragOriginTop = rect.top
    dragScale = svgWidth() / rect.width
    dragStartRawMin = minutesFromY(toLocalY(e.clientY), doc.rangeStart, deps.hourHeight)
    dragStartMin = clampMin(snapInteractionMin(dragStartRawMin))
    svg.setPointerCapture(e.pointerId)
    beginPointerInteraction(e)

    if (!activeType) return
    ghost = dom.createElementNS(SVGNS, "rect")
    ghost.setAttribute("class", "oneday-ghost")
    ghost.setAttribute("x", String(trackX + 2))
    ghost.setAttribute("width", String(trackW - 4))
    ghost.setAttribute("rx", "3")
    ghost.setAttribute("fill", deps.typeColor(activeType))
    ghost.style.setProperty("--oneday-block-color", deps.typeColor(activeType))
    svg.appendChild(ghost)
    const plan = deps.getMode() === "plan"
    if (plan) {
      const patternId = `oneday-preview-hatch-${++previewHatchUid}`
      ghostPattern = dom.createElementNS(SVGNS, "defs")
      ghostPattern.setAttribute("class", "oneday-preview-defs")
      const pattern = dom.createElementNS(SVGNS, "pattern")
      pattern.id = patternId
      pattern.setAttribute("width", "6")
      pattern.setAttribute("height", "6")
      pattern.setAttribute("patternUnits", "userSpaceOnUse")
      pattern.setAttribute("patternTransform", "rotate(45)")
      const line = dom.createElementNS(SVGNS, "line")
      line.setAttribute("x1", "0")
      line.setAttribute("y1", "0")
      line.setAttribute("x2", "0")
      line.setAttribute("y2", "6")
      line.setAttribute("stroke", deps.typeColor(activeType))
      line.setAttribute("stroke-width", "1.6")
      line.setAttribute("stroke-opacity", "0.8")
      pattern.appendChild(line)
      ghostPattern.appendChild(pattern)
      svg.appendChild(ghostPattern)
      ghostHatch = dom.createElementNS(SVGNS, "rect")
      ghostHatch.setAttribute("class", "oneday-preview-hatch")
      ghostHatch.setAttribute("x", String(trackX + 2))
      ghostHatch.setAttribute("width", String(trackW - 4))
      ghostHatch.setAttribute("rx", "3")
      ghostHatch.setAttribute("fill", `url(#${patternId})`)
      ghostHatch.setAttribute("pointer-events", "none")
      svg.appendChild(ghostHatch)
    }
    ghostDuration = dom.createElementNS(SVGNS, "text")
    ghostDuration.setAttribute("class", `oneday-preview-duration is-dragging${plan ? " is-plan" : ""}`)
    ghostDuration.setAttribute("x", String(trackX + trackW / 2))
    ghostDuration.setAttribute("text-anchor", "middle")
    ghostDuration.setAttribute("pointer-events", "none")
    // The optimistic block can remain on screen until Markdown remounts. Use
    // the same category-derived copy color as the canonical SVG builder now,
    // rather than briefly showing the generic muted/overlay-looking label.
    if (!plan) {
      const color = deps.typeColor(activeType)
      ghostDuration.style.setProperty("--oneday-block-text-light", relatedTextColor(color))
      ghostDuration.style.setProperty("--oneday-block-text-dark", relatedTextColor(darkThemeBlockFill(color)))
    }
    svg.appendChild(ghostDuration)
    updateGhost(dragStartMin, dragStartMin)
  })

  const updateGhost = (a: number, b: number): void => {
    if (!ghost) return
    const y1 = yFromMinutes(Math.min(a, b), doc.rangeStart, deps.hourHeight)
    const y2 = yFromMinutes(Math.max(a, b), doc.rangeStart, deps.hourHeight)
    ghost.setAttribute("y", String(y1))
    ghost.setAttribute("height", String(Math.max(2, y2 - y1)))
    if (ghostHatch) {
      ghostHatch.setAttribute("y", String(y1))
      ghostHatch.setAttribute("height", String(Math.max(2, y2 - y1)))
    }
    if (ghostDuration) {
      ghostDuration.setAttribute("y", String((y1 + y2) / 2 + 4))
      ghostDuration.textContent = formatHours(Math.max(0, Math.abs(b - a)))
    }
    updateSpanPreview(a, b)
    setStatus("")
  }

  svg.addEventListener("pointermove", (e: PointerEvent) => {
    if (activePointerId !== null && e.pointerId !== activePointerId) return
    if (editDrag) {
      const rect = editingRect()
      if (!rect) {
        editDrag = null
        removeSpanPreview()
        return
      }
      if (!editDrag.moved) {
        const dx = e.clientX - editDrag.pointerStartX
        const dy = e.clientY - editDrag.pointerStartY
        if (Math.hypot(dx, dy) < EDIT_DRAG_THRESHOLD_PX) return
        editDrag.moved = true
        raiseEntryVisuals(editDrag.line)
      }
      const cur = clampMin(snapInteractionMin(minutesFromY(toLocalY(e.clientY), doc.rangeStart, deps.hourHeight)))
      const { mode, grabOffsetMin } = editDrag
      let ns = editDrag.startMin
      let ne = editDrag.endMin
      if (mode === "top") ns = Math.min(cur, editDrag.endMin - SNAP_MINUTES)
      else if (mode === "bottom") ne = Math.max(cur, editDrag.startMin + SNAP_MINUTES)
      else {
        const dur = editDrag.endMin - editDrag.startMin
        ns = Math.min(30 * 60 - dur, Math.max(0, cur - grabOffsetMin))
        ne = ns + dur
      }
      const y1 = yFromMinutes(ns, doc.rangeStart, deps.hourHeight)
      const y2 = yFromMinutes(ne, doc.rangeStart, deps.hourHeight)
      if (mode === "move") {
        const originalY = yFromMinutes(editDrag.startMin, doc.rangeStart, deps.hourHeight)
        setEntryMovePreview(editDrag.line, y1 - originalY)
      } else {
        setEntryResizePreview(
          editDrag.line,
          y1,
          Math.max(2, y2 - y1),
          editDrag.originalY + editDrag.originalHeight / 2,
          ne - ns,
        )
        syncEditEdges(rect)
      }
      updateSpanPreview(ns, ne)
      setStatus("")
      return
    }
    if (!dragging) {
      // 编辑态光标：目标块边缘 ns-resize / 中部 grab；冻结块 default
      const editing = editingRect()
      if (editing) {
        const editHit = resolveEditPointerHit(e, editing)
        const cursor = editHit ? (editHit.mode === "move" ? "grab" : "ns-resize") : "default"
        // Explicit edge overlays inherit their own cursor; the selected block
        // needs an inline cursor because it otherwise overrides the SVG shell.
        editing.style.cursor = editHit && !editHit.fromHandle ? cursor : ""
        svg.style.cursor = cursor
        return
      }
      // The visible boundary and every inner point keep the create cursor.
      // Concrete range buttons own their own pointer cursor via CSS.
      const target = e.target as Element | null
      svg.querySelectorAll<SVGRectElement>("rect.oneday-block").forEach((block) => { block.style.cursor = "" })
      const hoveredBlock = target?.closest<SVGRectElement>("rect.oneday-block") ?? null
      let cursor = deps.getActiveType() ? "crosshair" : "default"
      const rect = svg.getBoundingClientRect()
      const scale = svgWidth() / rect.width
      const localY = (e.clientY - rect.top) * scale
      if (hoveredBlock) {
        const snapped = snapInteractionMin(minutesFromY(localY, doc.rangeStart, deps.hourHeight))
        const boundaryCreationLane = Boolean(deps.getActiveType())
          && (snapped === doc.rangeStart || snapped === doc.rangeEnd)
        cursor = boundaryCreationLane ? "crosshair" : "context-menu"
      }
      if (hoveredBlock) hoveredBlock.style.cursor = cursor
      svg.style.cursor = cursor
      return
    }
    // Option/Alt may be pressed after the drag begins. Re-snap both the raw
    // pointer-down position and the current edge so the whole span becomes
    // truly precise instead of leaving its start on the old five-minute grid.
    fineSnap = e.altKey
    dragStartMin = clampMin(snapInteractionMin(dragStartRawMin))
    const localY = toLocalY(e.clientY)
    const cur = clampMin(snapInteractionMin(minutesFromY(localY, doc.rangeStart, deps.hourHeight)))
    updateGhost(dragStartMin, cur)
    updatePrecisionHint(localY)
  })

  svg.addEventListener("pointercancel", (e: PointerEvent) => {
    if (activePointerId !== null && e.pointerId !== activePointerId) return
    // 中断拖拽也要清理临时元素（否则留下幽灵线）
    removeGhost()
    removeSpanPreview()
    removePrecisionHint()
    dragging = false
    if (editDrag) {
      if (editDrag.mode === "move") setEntryMovePreview(editDrag.line, 0)
      else resetEntryResizePreview(editDrag)
    }
    editDrag = null
    setStatus("")
  })

  svg.addEventListener("pointerup", (e: PointerEvent) => {
    if (activePointerId !== null && e.pointerId !== activePointerId) return
    if (editDrag) {
      const rect = editingRect()
      const drag = editDrag
      editDrag = null
      svg.releasePointerCapture(e.pointerId)
      svg.style.cursor = ""
      removeSpanPreview()
      setStatus("")
      if (rect) {
        const pointerDistance = Math.hypot(e.clientX - drag.pointerStartX, e.clientY - drag.pointerStartY)
        if (!drag.moved && pointerDistance < EDIT_DRAG_THRESHOLD_PX) {
          setEntryMovePreview(drag.line, 0)
          // pointerdown/pointerup also precede click and dblclick. A stationary
          // press must never quantize an exact non-grid-aligned span.
          if (!drag.fromHandle) exitEdit()
          return
        }
        const line = Number(rect.dataset.line)
        const cur = clampMin(snapInteractionMin(minutesFromY(toLocalY(e.clientY), doc.rangeStart, deps.hourHeight)))
        let ns = drag.startMin
        let ne = drag.endMin
        if (drag.mode === "top") ns = Math.min(cur, drag.endMin - SNAP_MINUTES)
        else if (drag.mode === "bottom") ne = Math.max(cur, drag.startMin + SNAP_MINUTES)
        else {
          const dur = drag.endMin - drag.startMin
          ns = Math.min(30 * 60 - dur, Math.max(0, cur - drag.grabOffsetMin))
          ne = ns + dur
        }
        if (ns !== drag.startMin || ne !== drag.endMin) {
          void Promise.resolve(deps.onUpdateSpan(line, ns, ne)).catch((error) => {
            if (drag.mode === "move") setEntryMovePreview(drag.line, 0)
            else resetEntryResizePreview(drag)
            deps.onMutationError?.(error)
          })
        } else {
          setEntryMovePreview(drag.line, 0)
        }
      }
      return
    }
    if (!dragging) return
    dragging = false
    fineSnap = e.altKey
    dragStartMin = clampMin(snapInteractionMin(dragStartRawMin))
    const end = clampMin(snapInteractionMin(minutesFromY(toLocalY(e.clientY), doc.rangeStart, deps.hourHeight)))
    const startMin = Math.min(dragStartMin, end)
    const endMin = Math.max(dragStartMin, end)
    svg.releasePointerCapture(e.pointerId)

    if (endMin - startMin < (fineSnap ? 1 : SNAP_MINUTES)) {
      removeGhost()
      removeSpanPreview()
      removePrecisionHint()
      setStatus("")
      // 未拖动的点击落在色块上 -> 选中即编辑（yyt 2026-08-19：选中态默认进入编辑态）
      if (downBlockLine !== null && Math.abs(e.clientY - downY) < 4) {
        deps.onBlockClick(downBlockLine)
        if (deps.getEditingLine() !== downBlockLine) {
          deps.setEditingLine(downBlockLine)
        }
        activateEditOwner()
        // Always re-synchronise the concrete SVG shell. The logical editing
        // line can survive a renderer replacement while its transparent edge
        // handles belong to the old SVG and no longer exist in this mount.
        syncEditVisual()
      }
      downBlockLine = null
      return
    }
    downBlockLine = null
    const activeType = deps.getActiveType()
    if (!activeType) {
      removeGhost()
      removeSpanPreview()
      removePrecisionHint()
      setStatus("")
      return
    }
    const line = formatEntryLine({ plan: deps.getMode() === "plan", startMin, endMin, type: activeType })
    removeSpanPreview()
    removePrecisionHint()
    setStatus("")
    // 乐观渲染：ghost 直接变成正式色块样式，写回+重渲染完成前用户无感知（yyt：创建有延迟）
    const optimisticNodes: Element[] = []
    if (ghost) {
      const plan = deps.getMode() === "plan"
      ghost.setAttribute("class", `oneday-block oneday-preview-block${plan ? " oneday-plan is-plan" : ""}`)
      ghost.setAttribute("fill-opacity", plan ? "0.12" : "0.95")
      if (plan) {
        ghost.setAttribute("stroke", deps.typeColor(activeType))
        ghost.setAttribute("stroke-opacity", "0.7")
        ghost.setAttribute("stroke-width", "1")
      }
      optimisticNodes.push(ghost)
    }
    if (ghostHatch) {
      ghostHatch.setAttribute("class", "oneday-plan-hatch oneday-preview-hatch")
      optimisticNodes.push(ghostHatch)
    }
    if (ghostDuration) {
      ghostDuration.setAttribute("class", `oneday-duration oneday-preview-duration${deps.getMode() === "plan" ? " oneday-plan-label is-plan" : ""}`)
      optimisticNodes.push(ghostDuration)
    }
    if (ghostPattern) optimisticNodes.push(ghostPattern)
    ghost = null
    ghostHatch = null
    ghostDuration = null
    ghostPattern = null
    void Promise.resolve(deps.onCreate(line, startMin)).catch((error) => {
      // applyBlockTransform normally replaces this provisional shell with a
      // canonical preview before saving. If ownership/section resolution
      // fails earlier, these nodes are otherwise left behind until restart.
      optimisticNodes.forEach((node) => node.remove())
      deps.onMutationError?.(error)
    })
  })

  const finishPointerInteraction = (e: PointerEvent): void => {
    if (activePointerId !== e.pointerId) return
    activePointerId = null
    setPointerInteractionActive(container, false)
  }
  // Registered after the gesture handlers so deferred redraws only resume
  // after their commit/cancel callbacks have consumed the final pointer.
  svg.addEventListener("pointerup", finishPointerInteraction)
  svg.addEventListener("pointercancel", finishPointerInteraction)

  const editingRect = (): SVGRectElement | null => {
    const line = deps.getEditingLine()
    if (line === null) return null
    return svg.querySelector<SVGRectElement>(`rect.oneday-block[data-line="${line}"]`)
  }

  const syncEditEdges = (rect: SVGRectElement | null): void => {
    if (!rect) {
      svg.querySelectorAll(".oneday-edit-edge, .oneday-edit-edge-line").forEach((edge) => edge.remove())
      return
    }
    const line = Number(rect.dataset.line)
    const x = Number(rect.getAttribute("x"))
    const y = Number(rect.getAttribute("y"))
    const width = Number(rect.getAttribute("width"))
    const height = Number(rect.getAttribute("height"))
    // Keep the centre half available for moving even on a very short block.
    const hotHeight = Math.min(8, Math.max(2, height / 4))

    for (const edgeName of ["top", "bottom"] as const) {
      let edge = svg.querySelector<SVGRectElement>(`rect.oneday-edit-edge[data-edge="${edgeName}"]`)
      if (!edge) {
        edge = dom.createElementNS(SVGNS, "rect")
        edge.setAttribute("class", "oneday-edit-edge")
        edge.dataset.edge = edgeName
        svg.appendChild(edge)
      }
      edge.dataset.line = String(line)
      edge.setAttribute("x", String(x))
      edge.setAttribute("y", String(edgeName === "top" ? y : y + height - hotHeight))
      edge.setAttribute("width", String(width))
      edge.setAttribute("height", String(hotHeight))
      edge.setAttribute("fill", "transparent")
    }
  }

  const syncEditVisual = (): void => {
    let editLine = deps.getEditingLine()
    const rect = editLine === null
      ? null
      : svg.querySelector<SVGRectElement>(`rect.oneday-block[data-line="${editLine}"]`)
    // Source edits can remove the selected line between renders. Never let a
    // dangling line number freeze every remaining label without a real target.
    if (editLine !== null && rect === null) {
      deps.setEditingLine(null)
      editLine = null
    }
    svg.classList.toggle("is-editing-block", rect !== null)
    svg.querySelectorAll("rect.oneday-block").forEach((r) => {
      r.classList.toggle("is-edit-target", rect !== null && r === rect)
      r.classList.toggle("is-frozen", rect !== null && r !== rect)
    })
    svg.querySelectorAll("rect.oneday-plan-hatch[data-line]").forEach((hatch) => {
      const mine = Number((hatch as HTMLElement).dataset.line) === editLine
      hatch.classList.toggle("is-frozen", editLine !== null && !mine)
    })
    // A selected span freezes every other timeline item, not only other
    // spans. Time-point lines, their label surfaces, and displaced leaders
    // belong to the same focus layer and must follow the same ownership rule.
    svg.querySelectorAll<SVGElement>(".oneday-marker, .oneday-marker-label-bg, .oneday-side-leader").forEach((node) => {
      const mine = Number(node.dataset.line) === editLine
      node.classList.toggle("is-frozen", editLine !== null && !mine)
    })
    // 文字也跟随冻结（yyt：只灰色块文字没变，看着懵）
    svg.querySelectorAll("text[data-line]").forEach((t) => {
      const mine = Number((t as HTMLElement).dataset.line) === editLine
      t.classList.toggle("is-frozen", editLine !== null && !mine)
    })
    syncEditEdges(rect)
  }

  const exitEdit = (): void => {
    const rect = editingRect()
    if (editDrag) setEntryMovePreview(editDrag.line, 0)
    if (rect) rect.style.cursor = ""
    svg.style.cursor = ""
    deps.setEditingLine(null)
    deactivateEditOwner()
    editDrag = null
    removeSpanPreview()
    syncEditVisual()
    container.querySelectorAll(".is-focus").forEach((el) => el.classList.remove("is-focus"))
  }

  const pendingDeleteLines = new Set<number>()
  const setPendingDeleteVisual = (line: number, pending: boolean): void => {
    container.querySelectorAll<SVGElement>(`[data-line="${line}"]`).forEach((element) => {
      element.classList.toggle("is-pending-delete", pending)
      if (pending) element.classList.remove("is-hover", "is-focus")
    })
    if (pending) {
      const tooltip = container.querySelector<HTMLElement>(".oneday-tooltip")
      if (tooltip) {
        tooltip.style.display = "none"
        tooltip.setAttribute("aria-hidden", "true")
      }
    }
  }
  const deleteEntry = async (line: number): Promise<void> => {
    if (pendingDeleteLines.has(line)) return
    pendingDeleteLines.add(line)
    const wasEditing = deps.getEditingLine() === line
    if (wasEditing) exitEdit()
    setPendingDeleteVisual(line, true)
    try {
      await deps.onDeleteEntry(line)
    } catch {
      // Persistence failed: restore exactly the visual the user acted on.
      pendingDeleteLines.delete(line)
      setPendingDeleteVisual(line, false)
      if (wasEditing) {
        deps.setEditingLine(line)
        activateEditOwner()
        syncEditVisual()
      }
    }
  }

  svg.addEventListener("oneday-delete-entry-request", (event: Event) => {
    const line = Number((event as CustomEvent<{ line?: number }>).detail?.line)
    if (!Number.isInteger(line) || !svg.querySelector(`[data-line="${line}"]`)) return
    event.preventDefault()
    void deleteEntry(line)
  })

  // External entry points (currently the block context menu) set the shared
  // editing line, then ask this renderer to build the exact same visual and
  // hit-test state as direct click selection. Keeping the edge construction
  // here prevents narrow/split blocks from becoming purple-looking shells
  // with no real resize targets.
  svg.addEventListener("oneday-sync-edit", () => {
    activateEditOwner()
    syncEditVisual()
  })

  // 选中态属于“这个色块”，不是“这个时间轴”。用 document 级捕获监听覆盖
  // 工具栏、文字组件、block 空白和页面正文；每个 Document 只安装一次，
  // 再把退出事件转发给当前仍挂载的编辑 SVG，避免每次重渲染堆积监听器。
  svg.addEventListener("oneday-exit-edit", exitEdit)
  if (!dom.body.dataset.onedayOutsideEditArmed) {
    dom.body.dataset.onedayOutsideEditArmed = "1"
    dom.addEventListener("pointerdown", (e: PointerEvent) => {
      const editingSvgs = Array.from(dom.querySelectorAll<SVGSVGElement>(".oneday-svg.is-editing-block"))
      if (editingSvgs.length === 0) return
      const target = e.target as Element | null
      // Let the owning SVG consume every press inside an active timeline. Its
      // local handler either starts an explicit edit gesture or dismisses edit
      // mode and returns. Clearing here during capture would make that same
      // press reach pointerdown as an unselected creation gesture.
      if (target && editingSvgs.some((editingSvg) => editingSvg.contains(target))) return
      const CustomEventCtor = dom.defaultView?.CustomEvent ?? CustomEvent
      editingSvgs.forEach((editingSvg) => {
        editingSvg.dispatchEvent(new CustomEventCtor("oneday-exit-edit"))
      })
    }, { capture: true })
  }

  // Esc 退出编辑：document 级监听只挂一份（每次渲染重复挂会泄漏+重复触发，性能审计 2026-08-19）
  const onEditKey = (e: Event): void => {
    const ke = e as KeyboardEvent
    const key = (e as CustomEvent).detail?.key ?? ke.key // 委托的自定义事件没有 .key（真机翻车点）
    const editing = deps.getEditingLine()
    if (editing === null) return
    if (key === "Escape") {
      e.preventDefault()
      exitEdit()
    } else if (key === "Delete" || key === "Backspace") {
      // 选中即删除（yyt 2026-08-19）；焦点可能不在输入框，文本框内不劫持
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return
      e.preventDefault()
      void deleteEntry(editing)
    }
  }
  ensureDocumentEditKeyRouter(dom)
  svg.addEventListener("oneday-esc", onEditKey as EventListener)
  svg.addEventListener("oneday-sync-edit-visual", syncEditVisual)

  // 进入编辑态的视觉同步（挂载时若已在编辑态则恢复）
  syncEditVisual()

  svg.addEventListener("dblclick", (e: MouseEvent) => {
    // dblclick 的 target 取自 pointerup——capture 期间被重定向成 svg；
    // 且第二击 pointerup 的 no-move 分支已退出编辑态。所以一律用 elementFromPoint 找真实色块
    const eventHit = (e.target as Element | null)?.closest<SVGElement>("rect.oneday-block, rect.oneday-edit-edge")
      ?? (dom.elementFromPoint(e.clientX, e.clientY)?.closest("rect.oneday-block, rect.oneday-edit-edge") as SVGElement | null)
    const hit = eventHit?.classList.contains("oneday-edit-edge")
      ? svg.querySelector<SVGRectElement>(`rect.oneday-block[data-line="${eventHit.dataset.line}"]`)
      : eventHit
    if (!hit) return
    const line = Number(hit.dataset.line)
    if (!Number.isInteger(line)) return
    e.preventDefault()
    e.stopPropagation()
    // 双击 = 选中并进编辑态 + 直接改备注（不要求先单击选中——单击 toggle 会吃掉预选）
    if (deps.getEditingLine() !== line) {
      deps.setEditingLine(line)
      deps.onBlockClick(line)
    }
    activateEditOwner()
    syncEditVisual()
    deps.onEditNote(line)
  })

  // Keyboard reach (P2-17): a focused block opens its context menu with
  // Enter/Space, anchored to the block instead of the pointer; Delete removes
  // it; arrows walk between blocks and time points. The document-level
  // Escape/Delete router keeps owning the selected (editing) state.
  attachTimelineKeyboardNavigation(svg)
  svg.addEventListener("keydown", (e: KeyboardEvent) => {
    const hit = timelineObjectFromEvent(e)
    if (!hit?.matches("rect.oneday-block")) return
    const line = Number(hit.dataset.line)
    if (!Number.isInteger(line)) return
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      e.stopPropagation()
      const center = timelineObjectCenter(hit)
      deps.onBlockMenu(line, center.x, center.y)
    } else if ((e.key === "Delete" || e.key === "Backspace") && deps.getEditingLine() === null) {
      e.preventDefault()
      e.stopPropagation()
      void deleteEntry(line)
    }
  })

  svg.addEventListener("contextmenu", (e: MouseEvent) => {
    const target = e.target as Element | null
    const eventHit = target?.closest<SVGElement>("rect.oneday-block, rect.oneday-edit-edge") ?? null
    const hitBlock = eventHit?.classList.contains("oneday-edit-edge")
      ? svg.querySelector<SVGRectElement>(`rect.oneday-block[data-line="${eventHit.dataset.line}"]`)
      : eventHit
    if (!hitBlock) {
      e.preventDefault()
      deps.onTrackMenu(e.clientX, e.clientY)
      return
    }
    e.preventDefault()
    const line = Number(hitBlock.dataset.line)
    if (Number.isInteger(line)) deps.onBlockMenu(line, e.clientX, e.clientY)
  })
}
