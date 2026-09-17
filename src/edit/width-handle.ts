/**
 * Track width handle: a tiny hot zone hugging the track's own right edge
 * (the track rect's visible right border, yyt: 不是 svg 外缘).
 * Drag shows a live vertical preview line; free width (no snap); release
 * commits the `width:` header. Pure DOM.
 */

export function attachWidthHandle(
  container: HTMLElement,
  baseWidth: number,
  onCommit: (baseWidth: number) => void
): void {
  const dom = container.ownerDocument
  const slot = container.querySelector<HTMLElement>(".modular-diary-slot-timeline")
  if (!slot) return
  const scrollPane = slot.querySelector<HTMLElement>(".modular-diary-svg-holder")
  if (!scrollPane) return
  const previous = slot.querySelector<WidthHandleElement>(".modular-diary-width-handle")
  previous?.modularDiaryCleanup?.()
  previous?.remove()
  // 清掉上次中断拖拽的预览残影（yyt：两条线之谜）
  dom.querySelectorAll(".modular-diary-width-preview").forEach((c) => c.remove())

  // The rendered track is the source of truth. Formula-based coordinates drift
  // when the slot is padded, scrolled, zoomed, or laid out differently.
  const track = slot.querySelector<SVGRectElement>("rect.modular-diary-track")
  if (!track) return
  let trackRight = 0
  let trackTop = 0
  let trackHeight = 0
  const handle = dom.createElement("div") as WidthHandleElement
  handle.className = "modular-diary-width-handle"
  handle.setAttribute("aria-hidden", "true")
  scrollPane.appendChild(handle)

  const syncGeometry = (): boolean => {
    if (!handle.isConnected || !track.isConnected) return false
    const paneRect = scrollPane.getBoundingClientRect()
    const trackRect = track.getBoundingClientRect()
    if (trackRect.width <= 0 || trackRect.height <= 0) return false
    trackRight = trackRect.right - paneRect.left + scrollPane.scrollLeft
    trackTop = trackRect.top - paneRect.top + scrollPane.scrollTop
    trackHeight = trackRect.height
    handle.style.left = `${trackRight}px` // CSS 3px + translateX(-50%) 骑线
    handle.style.top = `${trackTop}px`
    handle.style.height = `${trackHeight}px`
    return true
  }

  // Obsidian can mount the block before its preview pane has a measurable box.
  // ResizeObserver catches that 0 → rendered transition and later layout changes.
  const ResizeObserverCtor = dom.defaultView?.ResizeObserver
  const observer = ResizeObserverCtor ? new ResizeObserverCtor(() => {
    if (!handle.isConnected) {
      observer?.disconnect()
      return
    }
    syncGeometry()
  }) : null
  observer?.observe(slot)
  observer?.observe(scrollPane)
  observer?.observe(track)
  const frame = dom.defaultView?.requestAnimationFrame(syncGeometry)
  handle.modularDiaryCleanup = (): void => {
    observer?.disconnect()
    if (frame !== undefined) dom.defaultView?.cancelAnimationFrame(frame)
  }
  syncGeometry()

  handle.addEventListener("pointerdown", (e: PointerEvent) => {
    if (e.button !== 0) return
    if (!syncGeometry()) return
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = baseWidth
    handle.classList.add("is-active")

    // 竖线预览（不动 svg，listener 安全）
    const preview = dom.createElement("div")
    preview.className = "modular-diary-width-preview"
    preview.style.top = `${trackTop}px`
    preview.style.height = `${trackHeight}px`
    scrollPane.appendChild(preview)
    const place = (w: number): void => {
      const x = trackRight + (w - startW)
      preview.style.left = `${x}px`
      preview.textContent = `${Math.round(w)}px`
    }
    place(startW)

    const onMove = (ev: PointerEvent): void => {
      const w = Math.min(640, Math.max(140, startW + (ev.clientX - startX)))
      place(w)
    }
    const onUp = (ev: PointerEvent | null): void => {
      dom.removeEventListener("pointermove", onMove)
      dom.removeEventListener("pointerup", onUpNow)
      dom.removeEventListener("pointercancel", onCancel)
      handle.classList.remove("is-active")
      preview.remove()
      if (ev) {
        const w = Math.min(640, Math.max(140, Math.round(startW + (ev.clientX - startX))))
        if (Math.abs(w - startW) > 3) onCommit(w)
      }
    }
    const onUpNow = (ev: PointerEvent): void => onUp(ev)
    const onCancel = (): void => onUp(null)
    dom.addEventListener("pointermove", onMove)
    dom.addEventListener("pointerup", onUpNow)
    dom.addEventListener("pointercancel", onCancel)
  })
}

interface WidthHandleElement extends HTMLDivElement {
  modularDiaryCleanup?: () => void
}
