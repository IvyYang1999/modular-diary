export interface ScrollOffset {
  top: number
  left: number
}

export interface TimelineInternalScrollSnapshot {
  block: ScrollOffset | null
  timeline: ScrollOffset | null
  texts: Record<string, ScrollOffset>
}

function readOffset(element: HTMLElement | null): ScrollOffset | null {
  return element ? { top: element.scrollTop, left: element.scrollLeft } : null
}

function applyOffset(element: HTMLElement | null, offset: ScrollOffset | null): void {
  if (!element || !offset) return
  element.scrollTop = offset.top
  element.scrollLeft = offset.left
}

/** Capture every nested scroll owner by stable component identity. */
export function captureInternalScroll(container: HTMLElement): TimelineInternalScrollSnapshot {
  const texts: Record<string, ScrollOffset> = {}
  container.querySelectorAll<HTMLElement>(".modular-diary-slot").forEach((slot) => {
    const slotId = slot.dataset.slot ?? ""
    if (!/^text\d*$/.test(slotId)) return
    const pane = slot.querySelector<HTMLElement>(".modular-diary-text-pane") ?? slot
    texts[slotId] = { top: pane.scrollTop, left: pane.scrollLeft }
  })
  return {
    block: readOffset(container.querySelector<HTMLElement>(".modular-diary-block-scroll")),
    timeline: readOffset(container.querySelector<HTMLElement>(".modular-diary-svg-holder")),
    texts,
  }
}

/** Restore nested scrollers after replacement or a cancelled resize preview. */
export function restoreInternalScroll(
  snapshot: TimelineInternalScrollSnapshot,
  container: HTMLElement
): void {
  applyOffset(container.querySelector<HTMLElement>(".modular-diary-block-scroll"), snapshot.block)
  applyOffset(container.querySelector<HTMLElement>(".modular-diary-svg-holder"), snapshot.timeline)
  for (const [slotId, offset] of Object.entries(snapshot.texts)) {
    const slot = Array.from(container.querySelectorAll<HTMLElement>(".modular-diary-slot"))
      .find((candidate) => candidate.dataset.slot === slotId)
    if (!slot) continue
    applyOffset(slot.querySelector<HTMLElement>(".modular-diary-text-pane") ?? slot, offset)
  }
}

/**
 * Restore nested scroll owners through the first layout passes of a remount.
 * A freshly inserted timeline can temporarily have no measurable overflow,
 * causing the browser to clamp a synchronous scrollTop assignment to zero.
 * Keep the same snapshot for a bounded number of frames, but immediately
 * yield ownership when the user starts another interaction.
 */
export function stabilizeInternalScroll(
  snapshot: TimelineInternalScrollSnapshot,
  container: HTMLElement,
  frameCount = 2
): () => void {
  restoreInternalScroll(snapshot, container)
  if (frameCount <= 0) return () => undefined

  const dom = container.ownerDocument
  const domWindow = dom?.defaultView
  if (!domWindow?.requestAnimationFrame) return () => undefined

  let cancelled = false
  let frame = 0
  let requestId = 0
  const stop = (): void => {
    if (cancelled) return
    cancelled = true
    if (requestId) domWindow.cancelAnimationFrame(requestId)
    container.removeEventListener("wheel", stop)
    container.removeEventListener("pointerdown", stop)
    container.removeEventListener("touchstart", stop)
    dom.removeEventListener("keydown", stop)
  }
  const tick = (): void => {
    if (cancelled || !container.isConnected) {
      stop()
      return
    }
    restoreInternalScroll(snapshot, container)
    frame += 1
    if (frame >= frameCount) stop()
    else requestId = domWindow.requestAnimationFrame(tick)
  }

  container.addEventListener("wheel", stop, { passive: true })
  container.addEventListener("pointerdown", stop, { passive: true })
  container.addEventListener("touchstart", stop, { passive: true })
  dom.addEventListener("keydown", stop)
  requestId = domWindow.requestAnimationFrame(tick)
  return stop
}
