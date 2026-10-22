import { captureViewportAnchor, restoreViewportAnchor } from "./viewport-anchor"

/** Distance from the scroller's top/bottom edge where a drag starts to scroll. */
const EDGE = 40
/** Fastest edge scroll, in px per frame, reached at the very edge. */
const MAX_STEP = 14
/** Frames after a layout change in which a scroll is the editor re-anchoring, not the user. */
const SETTLE_FRAMES = 3

export interface GridViewportHold {
  /** Latest pointer position; drives edge scrolling. */
  pointer(clientY: number): void
  /** The grid was just re-laid out; the next scroll adjustments are not the user's. */
  changed(): void
  stop(): void
}

/**
 * While a component is moved or resized, the grid body changes height inside a
 * CodeMirror widget. CodeMirror then re-anchors its scroll position on a line
 * below the block, which slides the block under the pointer; the handle chases
 * the pointer and the page "scrolls by itself". For a few frames after each
 * layout change the block's on-screen top is pinned; any other scroll (wheel,
 * scrollIntoView) is accepted as the new position. The page also scrolls by
 * itself only while the pointer sits near the scroller's top or bottom edge;
 * `onScrolled` re-runs the layout for the unchanged pointer after that.
 */
export function holdGridViewport(body: HTMLElement, onScrolled: () => void): GridViewportHold {
  const anchor = captureViewportAnchor(body)
  const win = body.ownerDocument.defaultView
  if (!anchor || !win) return { pointer: () => {}, changed: () => {}, stop: () => {} }
  const scroller = anchor.scroller
  let pointerY: number | null = null
  let settle = 0
  let frame = 0
  let stopped = false
  const settleOrAccept = (): void => {
    if (stopped) return
    if (settle > 0) restoreViewportAnchor(anchor, body)
    else anchor.top = body.getBoundingClientRect().top
  }
  const edges = (): { top: number; bottom: number } => {
    if (scroller === body.ownerDocument.scrollingElement) return { top: 0, bottom: win.innerHeight }
    const rect = scroller.getBoundingClientRect()
    return { top: rect.top, bottom: rect.bottom }
  }
  const tick = (): void => {
    frame = 0
    if (stopped || !body.isConnected) return
    settleOrAccept()
    if (settle > 0) settle -= 1
    const { top, bottom } = edges()
    const y = pointerY
    const depth = y === null ? 0 : y > bottom - EDGE ? y - (bottom - EDGE) : y < top + EDGE ? y - (top + EDGE) : 0
    if (settle > 0 || depth) frame = win.requestAnimationFrame(tick)
    if (!depth) return
    const step = Math.sign(depth) * Math.ceil(Math.min(1, Math.abs(depth) / EDGE) * MAX_STEP)
    const before = scroller.scrollTop
    scroller.scrollTop = before + step
    const moved = scroller.scrollTop - before
    if (!moved) return
    // The block is meant to move by exactly the scrolled distance.
    anchor.top -= moved
    onScrolled()
  }
  const schedule = (): void => { if (!frame && !stopped) frame = win.requestAnimationFrame(tick) }
  // Scroll events land before the next paint: undo a re-anchor right away.
  const onScroll = (): void => { settleOrAccept(); schedule() }
  scroller.addEventListener("scroll", onScroll, { passive: true })
  return {
    pointer(clientY: number) {
      pointerY = clientY
      schedule()
    },
    changed() {
      settle = SETTLE_FRAMES
      schedule()
    },
    stop() {
      if (stopped) return
      if (settle > 0) restoreViewportAnchor(anchor, body)
      stopped = true
      if (frame) win.cancelAnimationFrame(frame)
      scroller.removeEventListener("scroll", onScroll)
    },
  }
}
