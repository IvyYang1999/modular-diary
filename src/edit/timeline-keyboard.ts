/**
 * Keyboard reach for rendered timeline objects (blocks and time points).
 *
 * The SVG builder marks every block and marker with `tabindex="0"`, so Tab
 * reaches them in paint order. This module adds the shared arrow-key walk
 * between them (by time, then column) and the geometry helper that lets
 * Enter/Space open the same context menu a right-click would, anchored to
 * the object instead of the pointer. Activation itself stays with the owning
 * interaction module (draw-interaction for spans, marker-interaction for
 * time points) because that is where the menu callbacks live.
 */

export const TIMELINE_FOCUSABLE_SELECTOR = 'rect.oneday-block[tabindex="0"], g.oneday-marker[tabindex="0"]'

interface NavigationArmedSvg extends SVGSVGElement {
  __onedayKeyboardNavigation?: true
}

function focusOrder(node: Element): { y: number; x: number } {
  if (node.matches("g.oneday-marker")) {
    return { y: Number((node as HTMLElement).dataset.markerY), x: Number.NEGATIVE_INFINITY }
  }
  return { y: Number(node.getAttribute("y")), x: Number(node.getAttribute("x")) }
}

/** Blocks and time points in reading order: top to bottom, then left to right. */
export function timelineFocusables(svg: SVGSVGElement): SVGGraphicsElement[] {
  return Array.from(svg.querySelectorAll<SVGGraphicsElement>(TIMELINE_FOCUSABLE_SELECTOR))
    .filter((node) => !node.classList.contains("is-pending-delete"))
    .sort((a, b) => {
      const oa = focusOrder(a)
      const ob = focusOrder(b)
      return oa.y - ob.y || oa.x - ob.x
    })
}

/** Viewport point at the centre of a rendered object, for menu anchoring. */
export function timelineObjectCenter(node: Element): { x: number; y: number } {
  const rect = node.getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

/** The focusable timeline object owning a key event, if any. */
export function timelineObjectFromEvent(event: Event): SVGGraphicsElement | null {
  const target = event.target as Element | null
  return target?.closest<SVGGraphicsElement>(TIMELINE_FOCUSABLE_SELECTOR) ?? null
}

/**
 * Arrow keys walk between blocks and time points. Installed once per SVG so
 * the span and marker modules never both move the focus.
 */
export function attachTimelineKeyboardNavigation(svg: SVGSVGElement): void {
  const armed = svg as NavigationArmedSvg
  if (armed.__onedayKeyboardNavigation) return
  armed.__onedayKeyboardNavigation = true
  svg.addEventListener("keydown", (event: KeyboardEvent) => {
    const step = event.key === "ArrowDown" || event.key === "ArrowRight"
      ? 1
      : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0
    if (step === 0 || event.altKey || event.ctrlKey || event.metaKey) return
    const current = timelineObjectFromEvent(event)
    if (!current) return
    const order = timelineFocusables(svg)
    const index = order.indexOf(current)
    if (index === -1) return
    const next = order[index + step]
    if (!next) return
    event.preventDefault()
    event.stopPropagation()
    next.focus()
  })
}
