export interface PointerRowSortOptions {
  list: HTMLElement
  row: HTMLElement
  handle: HTMLElement
  rowSelector: string
  onMove: (targetIndex: number) => void
}

/**
 * Pointer-driven row ordering with a full-row ghost and an in-list placeholder.
 * Native HTML drag uses the tiny handle as its drag image and is unreliable in
 * Electron when rows contain controls, so the interaction owns one pointer from
 * press through release instead.
 */
export function attachPointerRowSort(options: PointerRowSortOptions): void {
  const { list, row, handle, rowSelector, onMove } = options
  const dom = row.ownerDocument
  const domWindow = dom.defaultView
  const rows = (): HTMLElement[] => Array.from(list.children)
    .filter((child): child is HTMLElement => child instanceof HTMLElement && child.matches(rowSelector))

  handle.addEventListener("pointerdown", (event: PointerEvent) => {
    if (event.button !== 0 || row.parentElement !== list) return
    event.preventDefault()
    event.stopPropagation()

    const pointerId = event.pointerId
    const startY = event.clientY
    const originalIndex = rows().indexOf(row)
    const originalNext = row.nextSibling
    const rect = row.getBoundingClientRect()
    const style = domWindow?.getComputedStyle(row)
    const ghost = row.cloneNode(true) as HTMLElement
    ghost.classList.remove("is-dragging", "modular-diary-item-sort-placeholder")
    ghost.classList.add("modular-diary-item-sort-ghost")
    ghost.setAttribute("aria-hidden", "true")
    ghost.removeAttribute("tabindex")
    ghost.querySelectorAll<HTMLElement>("button, input, select, textarea, [tabindex]").forEach((element) => {
      element.tabIndex = -1
    })
    ghost.style.left = `${rect.left}px`
    ghost.style.top = `${rect.top}px`
    ghost.style.width = `${rect.width}px`
    ghost.style.height = `${rect.height}px`
    if (style) {
      ghost.style.borderRadius = style.borderRadius
      ghost.style.gridTemplateColumns = style.gridTemplateColumns
      // The fixed preview lives under <body>, outside the component root that
      // supplies compact typography. Preserve the row's computed text context
      // so pressing the grip never makes names jump to the page's default size.
      ghost.style.fontFamily = style.fontFamily
      ghost.style.fontSize = style.fontSize
      ghost.style.fontStyle = style.fontStyle
      ghost.style.fontWeight = style.fontWeight
      ghost.style.letterSpacing = style.letterSpacing
      ghost.style.lineHeight = style.lineHeight
    }
    dom.body.appendChild(ghost)
    list.classList.add("is-ordering")
    row.classList.add("modular-diary-item-sort-placeholder")

    let active = true
    const releaseCapture = (): void => {
      if (list.hasPointerCapture(pointerId)) list.releasePointerCapture(pointerId)
    }
    const cleanup = (): void => {
      dom.removeEventListener("pointermove", onPointerMove)
      dom.removeEventListener("pointerup", onPointerUp)
      dom.removeEventListener("pointercancel", onPointerCancel)
      list.removeEventListener("lostpointercapture", onLostPointerCapture)
      domWindow?.removeEventListener("blur", onWindowBlur)
      ghost.remove()
      list.classList.remove("is-ordering")
      row.classList.remove("modular-diary-item-sort-placeholder")
    }
    const restore = (): void => {
      if (originalNext?.parentNode === list) list.insertBefore(row, originalNext)
      else list.appendChild(row)
    }
    const onPointerMove = (moveEvent: PointerEvent): void => {
      if (!active || moveEvent.pointerId !== pointerId) return
      moveEvent.preventDefault()
      ghost.style.transform = `translate3d(0, ${moveEvent.clientY - startY}px, 0)`
      const peers = rows().filter((candidate) => candidate !== row)
      const before = peers.find((candidate) => {
        const candidateRect = candidate.getBoundingClientRect()
        return moveEvent.clientY < candidateRect.top + candidateRect.height / 2
      })
      if (before) list.insertBefore(row, before)
      else list.appendChild(row)
    }
    const commit = (): void => {
      if (!active) return
      active = false
      const targetIndex = rows().indexOf(row)
      cleanup()
      releaseCapture()
      if (targetIndex >= 0 && targetIndex !== originalIndex) onMove(targetIndex)
    }
    const cancel = (): void => {
      if (!active) return
      active = false
      restore()
      cleanup()
      releaseCapture()
    }
    const onPointerUp = (upEvent: PointerEvent): void => {
      if (upEvent.pointerId === pointerId) commit()
    }
    const onPointerCancel = (cancelEvent: PointerEvent): void => {
      if (cancelEvent.pointerId === pointerId) cancel()
    }
    const onLostPointerCapture = (lostEvent: PointerEvent): void => {
      if (lostEvent.pointerId === pointerId) cancel()
    }
    const onWindowBlur = (): void => cancel()

    // Capture belongs to the stable list, not the handle inside the moving row.
    // Re-inserting a captured row releases capture and ends the gesture midway.
    list.setPointerCapture(pointerId)
    dom.addEventListener("pointermove", onPointerMove)
    dom.addEventListener("pointerup", onPointerUp)
    dom.addEventListener("pointercancel", onPointerCancel)
    list.addEventListener("lostpointercapture", onLostPointerCapture)
    domWindow?.addEventListener("blur", onWindowBlur)
  })
}
