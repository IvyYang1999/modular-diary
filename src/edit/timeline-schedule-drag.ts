import { formatHours, MIN_TIMELINE_SPAN_MINUTES } from "../core/duration"
import { formatEntryLine } from "../core/format"
import { AXIS_PAD_TOP, SNAP_MINUTES, minutesFromY, snapMinutes, yFromMinutes } from "../core/geometry"
import type { TimelineDoc } from "../core/types"
import { t } from "../i18n"
import { setPointerInteractionActive } from "./pointer-interaction"

export interface TimelineScheduleItem {
  source: "habit" | "todo"
  id: string
  title: string
  type: string
  durationMin: number
}

export interface ScheduledPlan {
  startMin: number
  endMin: number
  line: string
}

/** `0` is intentional for an "any record" habit; malformed/negative data stays invalid. */
export function scheduledDurationMinutes(durationMin: number): number | null {
  const duration = Math.round(Number(durationMin))
  if (!Number.isFinite(duration) || duration < 0) return null
  return duration === 0 ? MIN_TIMELINE_SPAN_MINUTES : duration
}

export function schedulePlacement(
  rawStartMin: number,
  durationMin: number,
  rangeStart: number,
  rangeEnd: number,
): { startMin: number; endMin: number } | null {
  const duration = scheduledDurationMinutes(durationMin)
  const span = rangeEnd - rangeStart
  if (duration === null || span <= 0 || duration > span) return null
  const snapped = snapMinutes(rawStartMin, SNAP_MINUTES)
  const startMin = Math.max(rangeStart, Math.min(snapped, rangeEnd - duration))
  return { startMin, endMin: startMin + duration }
}

export function buildScheduledPlan(item: TimelineScheduleItem, startMin: number): ScheduledPlan {
  const durationMin = scheduledDurationMinutes(item.durationMin)
  if (durationMin === null) throw new Error("Invalid scheduled duration")
  const endMin = startMin + durationMin
  return {
    startMin,
    endMin,
    line: formatEntryLine({
      plan: true,
      startMin,
      endMin,
      type: item.type,
      note: item.title,
      todoId: item.source === "todo" ? item.id : undefined,
    }),
  }
}

export interface TimelineScheduleDragDeps {
  hourHeight: number
  typeColor: (type: string) => string
  onCreate: (plan: ScheduledPlan) => void
}

const SVGNS = "http://www.w3.org/2000/svg"
const START_THRESHOLD_PX = 4

function itemFromSource(source: HTMLElement): TimelineScheduleItem | null {
  const durationMin = Number(source.dataset.scheduleDuration)
  const kind = source.dataset.scheduleSource
  const item = {
    source: kind === "habit" ? "habit" as const : kind === "todo" ? "todo" as const : null,
    id: source.dataset.scheduleId?.trim() ?? "",
    title: source.dataset.scheduleTitle?.trim() ?? "",
    type: source.dataset.scheduleType?.trim() ?? "",
    durationMin,
  }
  return item.source && item.id && item.title && item.type && scheduledDurationMinutes(durationMin) !== null
    ? { ...item, source: item.source }
    : null
}

/**
 * Direct scheduling is intentionally separate from the left reorder grip.
 * Drag a row's content to the timeline; the stable outer container owns the
 * pointer until release so Electron cannot terminate the gesture mid-flight.
 */
export function attachTimelineScheduleDrag(
  container: HTMLElement,
  doc: TimelineDoc,
  deps: TimelineScheduleDragDeps,
): void {
  const svg = container.querySelector<SVGSVGElement>("svg.modular-diary-svg")
  const track = container.querySelector<SVGRectElement>("rect.modular-diary-track")
  const holder = container.querySelector<HTMLElement>(".modular-diary-svg-holder")
  if (!svg || !track || !holder) return
  const dom = container.ownerDocument
  const domWindow = dom.defaultView
  const svgWidth = Number(svg.getAttribute("width"))
  const trackX = Number(track.getAttribute("x"))
  const trackW = Number(track.getAttribute("width"))

  container.querySelectorAll<HTMLElement>(".modular-diary-schedule-source").forEach((source) => {
    const item = itemFromSource(source)
    if (!item) return
    source.setAttribute("aria-label", t("dragToTimeline", { name: item.title }))

    source.addEventListener("pointerdown", (event: PointerEvent) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const pointerId = event.pointerId
      const origin = { x: event.clientX, y: event.clientY }
      let active = true
      let started = false
      let placement: { startMin: number; endMin: number } | null = null
      let ghost: HTMLElement | null = null
      let preview: SVGGElement | null = null

      const releaseCapture = (): void => {
        if (container.hasPointerCapture(pointerId)) container.releasePointerCapture(pointerId)
      }
      const removePreview = (): void => {
        preview?.remove()
        preview = null
      }
      const cleanup = (): void => {
        dom.removeEventListener("pointermove", onMove)
        dom.removeEventListener("pointerup", onUp)
        dom.removeEventListener("pointercancel", onCancel)
        container.removeEventListener("lostpointercapture", onLostCapture)
        domWindow?.removeEventListener("blur", cancel)
        dom.removeEventListener("keydown", onKeyDown, true)
        ghost?.remove()
        removePreview()
        source.classList.remove("is-scheduling")
        setPointerInteractionActive(container, false)
      }
      const insideTrack = (x: number, y: number): boolean => {
        const a = track.getBoundingClientRect()
        const b = holder.getBoundingClientRect()
        return x >= Math.max(a.left, b.left) && x <= Math.min(a.right, b.right)
          && y >= Math.max(a.top, b.top) && y <= Math.min(a.bottom, b.bottom)
      }
      const paintPreview = (): void => {
        removePreview()
        if (!placement) return
        preview = dom.createElementNS(SVGNS, "g")
        preview.setAttribute("class", "modular-diary-schedule-preview")
        preview.setAttribute("aria-hidden", "true")
        const rect = dom.createElementNS(SVGNS, "rect")
        const y = yFromMinutes(placement.startMin, doc.rangeStart, deps.hourHeight)
        const height = yFromMinutes(placement.endMin, doc.rangeStart, deps.hourHeight) - y
        rect.setAttribute("x", String(trackX + 2))
        rect.setAttribute("y", String(y))
        rect.setAttribute("width", String(Math.max(1, trackW - 4)))
        rect.setAttribute("height", String(Math.max(2, height)))
        rect.setAttribute("rx", "3")
        rect.setAttribute("fill", deps.typeColor(item.type))
        preview.appendChild(rect)
        if (height >= 14) {
          const label = dom.createElementNS(SVGNS, "text")
          label.setAttribute("x", String(trackX + trackW / 2))
          label.setAttribute("y", String(y + height / 2 + 4))
          label.setAttribute("text-anchor", "middle")
          label.textContent = `${item.title} · ${formatHours(scheduledDurationMinutes(item.durationMin) ?? 0)}`
          preview.appendChild(label)
        }
        svg.appendChild(preview)
      }
      const start = (): void => {
        if (started) return
        started = true
        setPointerInteractionActive(container, true)
        source.classList.add("is-scheduling")
        ghost = dom.createElement("div")
        ghost.className = "modular-diary-schedule-drag-ghost"
        ghost.textContent = `${item.title} · ${formatHours(scheduledDurationMinutes(item.durationMin) ?? 0)}`
        dom.body.appendChild(ghost)
      }
      const update = (moveEvent: PointerEvent): void => {
        ghost?.style.setProperty("transform", `translate3d(${moveEvent.clientX + 12}px, ${moveEvent.clientY + 12}px, 0)`)
        if (!insideTrack(moveEvent.clientX, moveEvent.clientY)) {
          placement = null
          ghost?.classList.remove("is-valid")
          removePreview()
          return
        }
        const svgRect = svg.getBoundingClientRect()
        const localY = (moveEvent.clientY - svgRect.top) * (svgWidth / svgRect.width)
        placement = schedulePlacement(
          minutesFromY(localY, doc.rangeStart, deps.hourHeight),
          item.durationMin,
          doc.rangeStart,
          doc.rangeEnd,
        )
        ghost?.classList.toggle("is-valid", Boolean(placement))
        paintPreview()
      }
      const onMove = (moveEvent: PointerEvent): void => {
        if (!active || moveEvent.pointerId !== pointerId) return
        moveEvent.preventDefault()
        if (!started && Math.hypot(moveEvent.clientX - origin.x, moveEvent.clientY - origin.y) < START_THRESHOLD_PX) return
        start()
        update(moveEvent)
      }
      const finish = (): void => {
        if (!active) return
        active = false
        const plan = started && placement ? buildScheduledPlan(item, placement.startMin) : null
        cleanup()
        releaseCapture()
        if (plan) deps.onCreate(plan)
      }
      const cancel = (): void => {
        if (!active) return
        active = false
        cleanup()
        releaseCapture()
      }
      const onUp = (upEvent: PointerEvent): void => { if (upEvent.pointerId === pointerId) finish() }
      const onCancel = (cancelEvent: PointerEvent): void => { if (cancelEvent.pointerId === pointerId) cancel() }
      const onLostCapture = (lostEvent: PointerEvent): void => { if (lostEvent.pointerId === pointerId) cancel() }
      const onKeyDown = (keyEvent: KeyboardEvent): void => {
        if (keyEvent.key !== "Escape") return
        keyEvent.preventDefault()
        cancel()
      }

      container.setPointerCapture(pointerId)
      dom.addEventListener("pointermove", onMove)
      dom.addEventListener("pointerup", onUp)
      dom.addEventListener("pointercancel", onCancel)
      container.addEventListener("lostpointercapture", onLostCapture)
      domWindow?.addEventListener("blur", cancel)
      dom.addEventListener("keydown", onKeyDown, true)
    })
  })
}
