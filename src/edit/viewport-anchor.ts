export interface ViewportAnchor {
  scroller: HTMLElement
  top: number
  left: number
}

function scrollableAncestor(container: HTMLElement): HTMLElement | null {
  const dom = container.ownerDocument
  const domWindow = dom.defaultView
  for (let parent = container.parentElement; parent; parent = parent.parentElement) {
    const style = domWindow?.getComputedStyle(parent)
    const overflowY = style?.overflowY ?? ""
    if (/(auto|scroll|overlay)/.test(overflowY) && parent.scrollHeight > parent.clientHeight + 1) {
      return parent
    }
  }
  return dom.scrollingElement as HTMLElement | null
}

/** Capture what the user actually sees, not an absolute editor scrollTop. */
export function captureViewportAnchor(container: HTMLElement): ViewportAnchor | null {
  const scroller = scrollableAncestor(container)
  if (!scroller) return null
  const rect = container.getBoundingClientRect()
  return { scroller, top: rect.top, left: rect.left }
}

/**
 * Keep the replacement block at the same viewport coordinate. The browser or
 * CodeMirror may adjust scrollTop while replacing a large widget; compensating
 * the measured delta is stable even when the block's final height changes.
 */
export function restoreViewportAnchor(anchor: ViewportAnchor | null, container: HTMLElement): void {
  if (!anchor || !anchor.scroller.isConnected || !container.isConnected) return
  const rect = container.getBoundingClientRect()
  const deltaY = rect.top - anchor.top
  const deltaX = rect.left - anchor.left
  if (Math.abs(deltaY) > 0.25) anchor.scroller.scrollTop += deltaY
  if (Math.abs(deltaX) > 0.25) anchor.scroller.scrollLeft += deltaX
}

/**
 * Keep one visual anchor through CodeMirror's next layout passes. CM6 applies
 * its own scroll anchoring in requestAnimationFrame after a document change,
 * so a synchronous scrollTo can be overwritten. This bounded stabilizer owns
 * the same actual scroller for the whole transaction and cancels immediately
 * if the user starts another interaction.
 */
export function stabilizeViewportAnchor(
  anchor: ViewportAnchor | null,
  container: HTMLElement,
  frameCount = 2
): () => void {
  restoreViewportAnchor(anchor, container)
  if (!anchor || frameCount <= 0) return () => {}

  const dom = container.ownerDocument
  const domWindow = dom.defaultView
  if (!domWindow?.requestAnimationFrame) return () => {}

  let cancelled = false
  let frame = 0
  let requestId = 0
  const stop = (): void => {
    if (cancelled) return
    cancelled = true
    if (requestId) domWindow.cancelAnimationFrame(requestId)
    anchor.scroller.removeEventListener("wheel", stop)
    anchor.scroller.removeEventListener("pointerdown", stop)
    anchor.scroller.removeEventListener("touchstart", stop)
    dom.removeEventListener("keydown", stop)
  }
  const tick = (): void => {
    if (cancelled || !anchor.scroller.isConnected || !container.isConnected) {
      stop()
      return
    }
    restoreViewportAnchor(anchor, container)
    frame += 1
    if (frame >= frameCount) stop()
    else requestId = domWindow.requestAnimationFrame(tick)
  }

  anchor.scroller.addEventListener("wheel", stop, { passive: true })
  anchor.scroller.addEventListener("pointerdown", stop, { passive: true })
  anchor.scroller.addEventListener("touchstart", stop, { passive: true })
  dom.addEventListener("keydown", stop)
  // Order matters: CodeMirror schedules its measure from a MutationObserver
  // on the editor content, which fires in the microtask after this render
  // task. A frame requested right here would run *before* that measure and
  // see nothing to correct, leaving the wrong scroll position to paint for a
  // frame. Registering our frame from a MutationObserver created now (so it
  // is notified after CodeMirror's) puts the correction after the measure in
  // the same frame, before paint. Falls back to a plain frame elsewhere.
  const MutationObserverCtor = domWindow.MutationObserver
  if (MutationObserverCtor && container.isConnected) {
    const observer = new MutationObserverCtor(() => {
      observer.disconnect()
      if (!cancelled) requestId = domWindow.requestAnimationFrame(tick)
    })
    observer.observe(container, { attributes: true, attributeFilter: ["data-modular-diary-anchor"] })
    container.dataset.modularDiaryAnchor = String(Date.now())
  } else {
    requestId = domWindow.requestAnimationFrame(tick)
  }
  return stop
}
