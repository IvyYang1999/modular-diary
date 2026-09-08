import { TimelineDoc } from "../core/types"
import { formatMarkerLine } from "../core/format"
import { minutesFromY, snapMinutes, SNAP_MINUTES, yFromMinutes } from "../core/geometry"
import { setPointerInteractionActive } from "./pointer-interaction"
import { nativeControlOwnsTimelineDelete } from "./undo-routing"
import { attachTimelineKeyboardNavigation, timelineObjectCenter, timelineObjectFromEvent } from "./timeline-keyboard"

export interface MarkerInteractionDeps {
  hourHeight: number
  isMarkerTool: () => boolean
  getActiveType: () => string | null
  getMode: () => "actual" | "plan"
  /** A selected duration block owns the canvas until its dismiss gesture completes. */
  isInteractionLocked?: () => boolean
  typeColor: (type: string) => string
  getEditingLine: () => number | null
  setEditingLine: (line: number | null) => void
  onCreate: (sourceLine: string, timeMin: number) => void
  onMove: (line: number, timeMin: number) => void
  onMenu: (line: number, clientX: number, clientY: number) => void
  onEditNote: (line: number) => void
  onDelete: (line: number) => void
}

const SVGNS = "http://www.w3.org/2000/svg"
const MOVE_THRESHOLD = 4
const RANGE_EDGE_HIT_PX = 1

// Match duration-block keyboard ownership: the concrete marker renderer the
// user activated owns Delete/Escape, even when CodeMirror keeps DOM focus.
const activeMarkerOwnerByDocument = new WeakMap<Document, SVGSVGElement>()
const markerKeyRouterOwner = {}
type MarkerKeyRoutedDocument = Document & {
  __onedayMarkerKeyRouter?: {
    owner: object
    handler: (event: KeyboardEvent) => void
  }
}

function ensureDocumentMarkerKeyRouter(dom: Document): void {
  const routed = dom as MarkerKeyRoutedDocument
  if (routed.__onedayMarkerKeyRouter?.owner === markerKeyRouterOwner) return
  if (routed.__onedayMarkerKeyRouter) {
    dom.removeEventListener("keydown", routed.__onedayMarkerKeyRouter.handler, true)
  }
  const handler = (event: KeyboardEvent): void => {
    if (!["Escape", "Delete", "Backspace"].includes(event.key)) return
    const editingSvgs = Array.from(dom.querySelectorAll<SVGSVGElement>(".oneday-svg.is-editing-marker"))
    if (editingSvgs.length === 0) return
    const explicitOwners = editingSvgs.filter((candidate) => candidate.dataset.onedayMarkerOwnerActive === "1")
    const rememberedOwner = activeMarkerOwnerByDocument.get(dom)
    const editingSvg = explicitOwners.length === 1
      ? explicitOwners[0]
      : rememberedOwner?.isConnected && rememberedOwner.classList.contains("is-editing-marker")
        ? rememberedOwner
        : editingSvgs.length === 1 ? editingSvgs[0] : null
    if (!editingSvg || nativeControlOwnsTimelineDelete(event.target as Element | null)) return
    event.preventDefault()
    event.stopPropagation()
    const CustomEventCtor = dom.defaultView?.CustomEvent ?? CustomEvent
    editingSvg.dispatchEvent(new CustomEventCtor("oneday-marker-key", { detail: { key: event.key } }))
    editingSvgs.forEach((candidate) => {
      if (candidate !== editingSvg) candidate.dispatchEvent(new CustomEventCtor("oneday-marker-sync-visual"))
    })
  }
  dom.addEventListener("keydown", handler, true)
  routed.__onedayMarkerKeyRouter = { owner: markerKeyRouterOwner, handler }
}

export function attachMarkerInteraction(container: HTMLElement, doc: TimelineDoc, deps: MarkerInteractionDeps): void {
  const svg = container.querySelector<SVGSVGElement>("svg.oneday-svg")
  const track = svg?.querySelector<SVGRectElement>("rect.oneday-track")
  if (!svg || !track) return
  const dom = svg.ownerDocument
  const svgWidth = Number(svg.getAttribute("width"))
  const trackX = Number(track.getAttribute("x"))
  const trackW = Number(track.getAttribute("width"))
  let pointerId: number | null = null
  let startY = 0
  let currentMin = 0
  let startMin = 0
  let movingLine: number | null = null
  let moved = false
  let ghost: SVGGElement | null = null

  const activateMarkerOwner = (): void => {
    dom.querySelectorAll<SVGSVGElement>('.oneday-svg[data-oneday-marker-owner-active="1"]').forEach((candidate) => {
      if (candidate !== svg) delete candidate.dataset.onedayMarkerOwnerActive
    })
    svg.dataset.onedayMarkerOwnerActive = "1"
    activeMarkerOwnerByDocument.set(dom, svg)
  }
  const deactivateMarkerOwner = (): void => {
    delete svg.dataset.onedayMarkerOwnerActive
    if (activeMarkerOwnerByDocument.get(dom) === svg) activeMarkerOwnerByDocument.delete(dom)
  }

  const local = (e: PointerEvent): { x: number; y: number; scale: number } => {
    const rect = svg.getBoundingClientRect()
    const scale = svgWidth / rect.width
    return { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale, scale }
  }
  const snapped = (e: PointerEvent): number => {
    const raw = minutesFromY(local(e).y, doc.rangeStart, deps.hourHeight)
    return Math.min(doc.rangeEnd, Math.max(doc.rangeStart, snapMinutes(raw, e.altKey ? 1 : SNAP_MINUTES)))
  }
  const editingMarker = (): SVGGElement | null => {
    const line = deps.getEditingLine()
    return line === null ? null : svg.querySelector<SVGGElement>(`.oneday-marker[data-line="${line}"]`)
  }
  const markerFromTarget = (target: EventTarget | null): SVGGElement | null => {
    const element = target as Element | null
    const direct = element?.closest<SVGGElement>("g.oneday-marker") ?? null
    if (direct) return direct
    const line = Number(element?.closest<SVGElement>("[data-line]")?.dataset.line)
    if (!Number.isFinite(line) || !doc.annotations.some((item) => item.line === line && item.type)) return null
    return svg.querySelector<SVGGElement>(`g.oneday-marker[data-line="${line}"]`)
  }
  const markerFromPoint = (clientX: number, clientY: number): SVGGElement | null => {
    const direct = markerFromTarget(dom.elementFromPoint(clientX, clientY))
    if (direct) return direct
    // Marker labels live in the SVG side lane and can visually extend beyond
    // the track. Obsidian's WebView occasionally targets the enclosing embed
    // there, so use the rendered marker geometry as the final authority.
    for (const marker of doc.annotations) {
      if (!marker.type) continue
      const owned = svg.querySelectorAll<SVGGraphicsElement>(`[data-line="${marker.line}"]`)
      if (Array.from(owned).some((node) => {
        const rect = node.getBoundingClientRect()
        return clientX >= rect.left - 2 && clientX <= rect.right + 2
          && clientY >= rect.top - 2 && clientY <= rect.bottom + 2
      })) return svg.querySelector<SVGGElement>(`g.oneday-marker[data-line="${marker.line}"]`)
    }
    return null
  }
  const syncVisual = (): void => {
    let selected = editingMarker()
    if (deps.getEditingLine() !== null && !selected) {
      deps.setEditingLine(null)
      selected = null
    }
    svg.classList.toggle("is-editing-marker", Boolean(selected))
    svg.querySelectorAll<SVGElement>(".oneday-marker, rect.oneday-block, rect.oneday-plan-hatch").forEach((node) => {
      const mine = selected !== null && Number(node.dataset.line) === Number(selected.dataset.line)
      node.classList.toggle("is-edit-target", mine)
      node.classList.toggle("is-frozen", selected !== null && !mine)
    })
    svg.querySelectorAll<SVGElement>("[data-line]").forEach((node) => {
      const mine = selected !== null && Number(node.dataset.line) === Number(selected.dataset.line)
      node.classList.toggle("is-frozen", selected !== null && !mine)
    })
  }
  const exitEdit = (): void => {
    deps.setEditingLine(null)
    movingLine = null
    deactivateMarkerOwner()
    syncVisual()
  }
  const setMovePreview = (line: number, deltaY: number | null): void => {
    // A marker is rendered in two SVG regions: the line/dots live in a group
    // over the track, while its leader + note label live in the side lane.
    // Preview them as one object so dragging never leaves the note behind.
    svg.querySelectorAll<SVGElement>(`[data-line="${line}"]`).forEach((node) => {
      if (deltaY === null) node.removeAttribute("transform")
      else node.setAttribute("transform", `translate(0 ${deltaY})`)
    })
  }
  const updateGhost = (minute: number): void => {
    if (!ghost) return
    const yy = yFromMinutes(minute, doc.rangeStart, deps.hourHeight)
    ghost.querySelectorAll<SVGLineElement>("line").forEach((line) => { line.setAttribute("y1", String(yy)); line.setAttribute("y2", String(yy)) })
    ghost.querySelectorAll<SVGCircleElement>("circle").forEach((dot) => dot.setAttribute("cy", String(yy)))
  }
  const createGhost = (type: string): void => {
    const color = deps.typeColor(type)
    ghost = dom.createElementNS(SVGNS, "g")
    ghost.setAttribute("class", "oneday-marker-ghost")
    const line = dom.createElementNS(SVGNS, "line")
    line.setAttribute("x1", String(trackX)); line.setAttribute("x2", String(trackX + trackW)); line.setAttribute("stroke", color)
    ghost.appendChild(line)
    for (const cx of [trackX, trackX + trackW]) {
      const dot = dom.createElementNS(SVGNS, "circle")
      dot.setAttribute("cx", String(cx)); dot.setAttribute("r", "2.5"); dot.setAttribute("fill", color)
      ghost.appendChild(dot)
    }
    svg.appendChild(ghost)
  }

  svg.addEventListener("pointerdown", (e: PointerEvent) => {
    if (e.button !== 0 || pointerId !== null) return
    const hit = markerFromTarget(e.target)
    const selected = editingMarker()
    if (selected) {
      e.preventDefault()
      if (hit !== selected) { exitEdit(); return }
      activateMarkerOwner()
      movingLine = Number(selected.dataset.line)
      startMin = Number(selected.dataset.timeMin)
      currentMin = startMin
      startY = e.clientY
      pointerId = e.pointerId
      svg.setPointerCapture(e.pointerId)
      setPointerInteractionActive(container, true)
      return
    }
    if (hit) {
      e.preventDefault()
      deps.setEditingLine(Number(hit.dataset.line))
      activateMarkerOwner()
      syncVisual()
      return
    }
    if (deps.isInteractionLocked?.()) return
    const type = deps.getActiveType()
    if (!deps.isMarkerTool() || !type) return
    const point = local(e)
    const top = yFromMinutes(doc.rangeStart, doc.rangeStart, deps.hourHeight)
    const bottom = yFromMinutes(doc.rangeEnd, doc.rangeStart, deps.hourHeight)
    if (point.x < trackX || point.x > trackX + trackW || Math.abs(point.y - top) <= RANGE_EDGE_HIT_PX || Math.abs(point.y - bottom) <= RANGE_EDGE_HIT_PX) return
    e.preventDefault()
    currentMin = snapped(e)
    startY = e.clientY
    pointerId = e.pointerId
    svg.setPointerCapture(e.pointerId)
    setPointerInteractionActive(container, true)
    createGhost(type)
    updateGhost(currentMin)
  })

  svg.addEventListener("pointermove", (e: PointerEvent) => {
    if (pointerId === null) {
      const hit = markerFromTarget(e.target)
      svg.style.cursor = hit ? (editingMarker() === hit ? "grab" : "context-menu") : deps.isMarkerTool() && deps.getActiveType() ? "crosshair" : ""
      return
    }
    if (e.pointerId !== pointerId) return
    moved ||= Math.abs(e.clientY - startY) >= MOVE_THRESHOLD
    currentMin = snapped(e)
    if (movingLine !== null) {
      setMovePreview(
        movingLine,
        yFromMinutes(currentMin, doc.rangeStart, deps.hourHeight) - yFromMinutes(startMin, doc.rangeStart, deps.hourHeight)
      )
    } else updateGhost(currentMin)
  })

  const finish = (e: PointerEvent, cancelled: boolean): void => {
    if (e.pointerId !== pointerId) return
    if (movingLine !== null) {
      setMovePreview(movingLine, null)
      if (!cancelled && moved) deps.onMove(movingLine, currentMin)
    } else if (!cancelled && ghost) {
      const type = deps.getActiveType()
      if (type) deps.onCreate(formatMarkerLine({ plan: deps.getMode() === "plan", timeMin: currentMin, type }), currentMin)
    }
    ghost?.remove(); ghost = null
    movingLine = null; moved = false; pointerId = null
    setPointerInteractionActive(container, false)
  }
  svg.addEventListener("pointerup", (e) => finish(e, false))
  svg.addEventListener("pointercancel", (e) => finish(e, true))
  svg.addEventListener("dblclick", (e: MouseEvent) => {
    // Pointer capture can retarget the synthesized dblclick to the SVG root.
    // Resolve the visual object at the pointer, just like duration blocks do.
    const hit = markerFromTarget(e.target) ?? markerFromTarget(dom.elementFromPoint(e.clientX, e.clientY))
    if (!hit) return
    e.preventDefault()
    e.stopPropagation()
    deps.onEditNote(Number(hit.dataset.line))
  })
  // Side-lane marker labels may paint beyond `container`'s DOM box. Listen on
  // the same CodeMirror embed surface as the Block menu so retargeted events
  // still pass through the marker owner first.
  const contextSurface = (container.closest(".cm-embed-block") as HTMLElement | null) ?? container
  contextSurface.addEventListener("contextmenu", (e: MouseEvent) => {
    if (!container.isConnected) return
    // SVG contextmenu events can be retargeted to the root SVG (notably in
    // Obsidian's embedded WebView) or even the enclosing embed when a side
    // label extends beyond the track. Resolve pointer geometry as a fallback
    // so marker lines, endpoints, and labels retain ownership.
    const hit = markerFromTarget(e.target) ?? markerFromPoint(e.clientX, e.clientY)
    if (!hit) return
    e.preventDefault(); e.stopImmediatePropagation()
    deps.onMenu(Number(hit.dataset.line), e.clientX, e.clientY)
  })
  // Keyboard reach (P2-17): Enter/Space opens the marker menu at the marker,
  // Delete removes an unselected focused marker; arrows are shared.
  attachTimelineKeyboardNavigation(svg)
  svg.addEventListener("keydown", (e: KeyboardEvent) => {
    const hit = timelineObjectFromEvent(e)
    if (!hit?.matches("g.oneday-marker")) return
    const line = Number(hit.dataset.line)
    if (!Number.isInteger(line)) return
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      e.stopPropagation()
      const center = timelineObjectCenter(hit)
      deps.onMenu(line, center.x, center.y)
    } else if ((e.key === "Delete" || e.key === "Backspace") && deps.getEditingLine() === null) {
      e.preventDefault()
      e.stopPropagation()
      deps.onDelete(line)
    }
  })
  svg.addEventListener("oneday-marker-sync-edit", () => {
    activateMarkerOwner()
    syncVisual()
  })
  svg.addEventListener("oneday-marker-sync-visual", syncVisual)
  svg.addEventListener("oneday-marker-exit-edit", exitEdit)
  svg.addEventListener("oneday-marker-key", (event: Event) => {
    const key = (event as CustomEvent<{ key: string }>).detail?.key
    const line = deps.getEditingLine()
    if (line === null) return
    if (key === "Escape") exitEdit()
    else if (key === "Delete" || key === "Backspace") {
      exitEdit()
      deps.onDelete(line)
    }
  })
  if (!dom.body.dataset.onedayMarkerOutsideEditArmed) {
    dom.body.dataset.onedayMarkerOutsideEditArmed = "1"
    dom.addEventListener("pointerdown", (e: PointerEvent) => {
      const targets = Array.from(dom.querySelectorAll<SVGSVGElement>(".oneday-svg.is-editing-marker"))
      if (!targets.length || targets.some((target) => target.contains(e.target as Node))) return
      targets.forEach((target) => target.dispatchEvent(new (dom.defaultView?.Event ?? Event)("oneday-marker-exit-edit")))
    }, { capture: true })
  }
  ensureDocumentMarkerKeyRouter(dom)
}
