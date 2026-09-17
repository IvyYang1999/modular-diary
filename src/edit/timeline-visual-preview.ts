import type { TimelineDoc } from "../core/types"
import { renderTimelineSvg, type RenderOptions } from "../render/svg-builder"

const PREVIEW_SELECTOR = [
  ".modular-diary-preview-block",
  ".modular-diary-preview-hatch",
  ".modular-diary-preview-duration",
  ".modular-diary-preview-defs",
].join(",")

function copySvgFrame(source: SVGSVGElement, target: SVGSVGElement): void {
  for (const name of ["width", "height", "viewBox"]) {
    const value = source.getAttribute(name)
    if (value === null) target.removeAttribute(name)
    else target.setAttribute(name, value)
  }
}

/**
 * Paint the exact post-transform timeline into the already-mounted SVG.
 *
 * Keeping the outer SVG node preserves delegated pointer/hover listeners,
 * while replacing its children makes fill, hatch, border and copy enter the
 * same frame. The returned rollback is used when Markdown persistence fails.
 */
export function previewTimelineVisual(
  container: HTMLElement,
  nextDoc: TimelineDoc,
  options: RenderOptions,
): (() => void) | null {
  const live = container.querySelector<SVGSVGElement>("svg.modular-diary-svg")
  if (!live) return null
  const dom = live.ownerDocument
  const staging = dom.createElement("div")
  // A narrow slot may have fitted the annotation lane; the preview keeps it.
  const fittedLane = Number(live.getAttribute("data-side-lane"))
  const sideLaneWidth = options.sideLaneWidth ?? (Number.isFinite(fittedLane) && live.hasAttribute("data-side-lane") ? fittedLane : undefined)
  staging.innerHTML = renderTimelineSvg(nextDoc, { ...options, sideLaneWidth })
  const next = staging.querySelector<SVGSVGElement>("svg.modular-diary-svg")
  if (!next) return null

  // A create gesture may have promoted its ghost to a complete optimistic
  // visual. It is not source-backed, so it must not return after a failed
  // write; rollback means the last persisted SVG, not the temporary ghost.
  const rollbackShell = live.cloneNode(true) as SVGSVGElement
  rollbackShell.querySelectorAll(PREVIEW_SELECTOR).forEach((node) => node.remove())
  const rollbackMarkup = rollbackShell.innerHTML
  const rollbackFrame = {
    width: live.getAttribute("width"),
    height: live.getAttribute("height"),
    viewBox: live.getAttribute("viewBox"),
  }

  copySvgFrame(next, live)
  live.replaceChildren(...Array.from(next.childNodes, (node) => node.cloneNode(true)))
  live.dispatchEvent(new (dom.defaultView?.CustomEvent ?? CustomEvent)("modular-diary-sync-edit-visual"))

  return () => {
    live.innerHTML = rollbackMarkup
    for (const [name, value] of Object.entries(rollbackFrame)) {
      if (value === null) live.removeAttribute(name)
      else live.setAttribute(name, value)
    }
    live.dispatchEvent(new (dom.defaultView?.CustomEvent ?? CustomEvent)("modular-diary-sync-edit-visual"))
  }
}
