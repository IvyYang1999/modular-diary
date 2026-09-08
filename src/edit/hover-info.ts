/**
 * Hover info for blocks (yyt 2026-08-17: hover/点击看不到任何信息):
 * - custom tooltip (SVG <title> tooltips are unreliable in Electron)
 * - hover pairing: block <-> its side label in the lane (多列时找对应)
 * Pure DOM so Playwright can smoke it.
 */
import { TimelineDoc } from "../core/types"
import { clockDayOffset, durationMinutes, formatClock24, formatHours } from "../core/duration"
import { t } from "../i18n"

export function formatTimelineDisplayTime(minutes: number): string {
  const clock = formatClock24(minutes)
  return clockDayOffset(minutes) > 0 ? `${t("nextDay")} ${clock}` : clock
}

export function formatTimelineDisplayRange(startMin: number, endMin: number): string {
  const startDay = clockDayOffset(startMin)
  const endDay = clockDayOffset(endMin)
  const start = formatClock24(startMin)
  const end = formatClock24(endMin)
  if (startDay > 0 && startDay === endDay) return `${t("nextDay")} ${start} – ${end}`
  return `${startDay > 0 ? `${t("nextDay")} ` : ""}${start} – ${endDay > 0 ? `${t("nextDay")} ` : ""}${end}`
}

/** Toggle click-focus on a block: highlight it + its lane label + leader (yyt: 连线不用常驻). */
export function toggleBlockFocus(container: HTMLElement, line: number): void {
  const already = container.querySelector(`[data-line="${line}"]`)?.classList.contains("is-focus")
  container.querySelectorAll(".is-focus").forEach((el) => el.classList.remove("is-focus"))
  if (already) return
  container.querySelectorAll(`[data-line="${line}"]`).forEach((el) => el.classList.add("is-focus"))
}

export function attachHoverInfo(container: HTMLElement, doc: TimelineDoc): void {
  const svg = container.querySelector<SVGSVGElement>("svg.oneday-svg")
  if (!svg) return
  const dom = container.ownerDocument

  container.querySelector(".oneday-tooltip")?.remove() // 幂等：响应式重渲染会重复 attach
  const tooltip = dom.createElement("div")
  tooltip.className = "oneday-tooltip"
  tooltip.setAttribute("role", "tooltip")
  tooltip.setAttribute("aria-hidden", "true")
  tooltip.style.display = "none"
  container.appendChild(tooltip)

  const clearPairing = (): void => {
    container.querySelectorAll(".is-hover").forEach((el) => el.classList.remove("is-hover"))
  }

  const hideTooltip = (): void => {
    tooltip.style.display = "none"
    tooltip.setAttribute("aria-hidden", "true")
    clearPairing()
  }

  /** Show pairing + tooltip for the object under the pointer or with focus. */
  const showInfo = (target: Element | null): boolean => {
    const markerLine = Number(target?.closest<SVGElement>("[data-line]")?.dataset.line)
    const markerTarget = Number.isFinite(markerLine)
      ? svg.querySelector<SVGGElement>(`g.oneday-marker[data-line="${markerLine}"]`)
      : null
    if (markerTarget) {
      const marker = doc.annotations.find((item) => item.line === Number(markerTarget.dataset.line) && item.type)
      if (!marker?.type) return false
      clearPairing()
      container.querySelectorAll(`[data-line="${marker.line}"]`).forEach((el) => el.classList.add("is-hover"))
      tooltip.replaceChildren()
      const time = dom.createElement("div")
      time.className = "oneday-tooltip-time"
      time.textContent = formatTimelineDisplayTime(marker.timeMin)
      const type = dom.createElement("div")
      type.className = "oneday-tooltip-type"
      type.textContent = (marker.plan ? t("planPrefix") : "") + marker.type
      tooltip.append(time, type)
      if (marker.text) {
        const note = dom.createElement("div")
        note.className = "oneday-tooltip-note"
        note.textContent = marker.text
        tooltip.appendChild(note)
      }
      tooltip.style.display = "block"
      tooltip.setAttribute("aria-hidden", "false")
      return true
    }
    const block = target?.closest("rect.oneday-block") as SVGRectElement | null
    if (!block) return false
    const line = Number(block.dataset.line)
    const entry = doc.entries.find((it) => it.line === line)
    if (!entry) return false

    clearPairing()
    block.classList.add("is-hover")
    container
      .querySelectorAll(`.oneday-svg [data-line="${line}"]:not(rect)`)
      .forEach((el) => el.classList.add("is-hover"))

    const time = `${formatTimelineDisplayRange(entry.startMin, entry.endMin)} · ${formatHours(durationMinutes(entry.startMin, entry.endMin))}`
    tooltip.replaceChildren()
    const l1 = dom.createElement("div")
    l1.className = "oneday-tooltip-time"
    l1.textContent = time
    tooltip.appendChild(l1)
    // When the block already shows its note inline, the tooltip only adds
    // what the block cannot: the exact start/end. Everything else would
    // repeat copy that sits right under the pointer.
    const noteInline = Boolean(entry.note) && Boolean(
      svg.querySelector(`text.oneday-note[data-line="${line}"]:not(.oneday-side)`)
      ?? Array.from(svg.querySelectorAll<SVGTextElement>(`text.oneday-duration[data-line="${line}"]:not(.oneday-thin)`))
        .find((label) => (label.textContent ?? "").includes(" · "))
    )
    if (!noteInline) {
      const l2 = dom.createElement("div")
      l2.className = "oneday-tooltip-type"
      l2.textContent = (entry.plan ? t("planPrefix") : "") + entry.type
      tooltip.appendChild(l2)
      if (entry.note) {
        const l3 = dom.createElement("div")
        l3.className = "oneday-tooltip-note"
        l3.textContent = entry.note
        tooltip.appendChild(l3)
      }
    }
    tooltip.style.display = "block"
    tooltip.setAttribute("aria-hidden", "false")
    return true
  }

  /**
   * The tooltip sits above and to the left of the pointer so it never
   * covers the object's own lane label to the right; it flips below the
   * pointer only when there is no room above.
   */
  const placeAtPointer = (clientX: number, clientY: number): void => {
    const rect = container.getBoundingClientRect()
    const width = tooltip.offsetWidth
    const height = tooltip.offsetHeight
    const left = Math.max(4, clientX - rect.left - width - 12)
    let top = clientY - rect.top - height - 10
    if (top < 4) top = clientY - rect.top + 14
    tooltip.style.left = `${left}px`
    tooltip.style.top = `${top}px`
  }

  svg.addEventListener("pointerover", (e: PointerEvent) => {
    if (showInfo(e.target as Element | null)) placeAtPointer(e.clientX, e.clientY)
  })

  // Keyboard focus gets the same pairing and tooltip, docked under the
  // object's left edge (inside the track, clear of the lane) because there
  // is no pointer to follow.
  svg.addEventListener("focusin", (e: FocusEvent) => {
    const target = e.target as Element | null
    if (!showInfo(target)) return
    const rect = container.getBoundingClientRect()
    const box = (target as Element).getBoundingClientRect()
    tooltip.style.left = `${box.left - rect.left + 6}px`
    tooltip.style.top = `${box.bottom - rect.top + 6}px`
  })
  svg.addEventListener("focusout", (e: FocusEvent) => {
    if ((e.target as Element | null)?.closest("rect.oneday-block, g.oneday-marker")) hideTooltip()
  })

  svg.addEventListener("pointermove", (e: PointerEvent) => {
    if (tooltip.style.display === "none") return
    placeAtPointer(e.clientX, e.clientY)
  })

  svg.addEventListener("pointerout", (e: PointerEvent) => {
    const line = Number((e.target as Element | null)?.closest<SVGElement>("[data-line]")?.dataset.line)
    if ((e.target as Element | null)?.closest("rect.oneday-block, g.oneday-marker") || doc.annotations.some((item) => item.line === line && item.type)) {
      hideTooltip()
    }
  })
}
