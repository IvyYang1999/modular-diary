import { isEditingSurfaceTarget } from "./undo-routing"

export interface PointerRedrawGate {
  run(container: HTMLElement, redraw: () => void): boolean
  clear(): void
}

const POINTER_IDLE_EVENT = "modular-diary-pointer-idle"

const externalEditors = new WeakMap<HTMLElement, Set<HTMLElement>>()

/** Body-mounted popovers still own their timeline's editing lifecycle. */
export function registerExternalEditor(container: HTMLElement, editor: HTMLElement): () => void {
  const editors = externalEditors.get(container) ?? new Set<HTMLElement>()
  externalEditors.set(container, editors)
  editors.add(editor)
  return () => {
    editors.delete(editor)
    if (editors.size === 0) externalEditors.delete(container)
    const EventCtor = container.ownerDocument.defaultView?.Event ?? Event
    container.dispatchEvent(new EventCtor(POINTER_IDLE_EVENT))
  }
}

function ownsActiveEditingSurface(container: HTMLElement): boolean {
  for (const editor of externalEditors.get(container) ?? []) {
    if (editor.isConnected) return true
  }
  const active = container.ownerDocument.activeElement as Element | null
  if (!active || !container.contains(active)) return false
  // A form closed with `hidden` can briefly remain document.activeElement;
  // it no longer owns an editing session and must not keep refresh pending.
  if (active.closest("[hidden]")) return false
  return isEditingSurfaceTarget(active)
}

export function setPointerInteractionActive(container: HTMLElement, active: boolean): void {
  if (active) {
    container.dataset.modularDiaryPointerActive = "1"
    return
  }
  if (container.dataset.modularDiaryPointerActive !== "1") return
  delete container.dataset.modularDiaryPointerActive
  const EventCtor = container.ownerDocument.defaultView?.Event ?? Event
  container.dispatchEvent(new EventCtor(POINTER_IDLE_EVENT))
}

/**
 * Coalesces background refreshes while a mounted timeline owns an interaction.
 * Pointer capture and focused native editors are both hard lifecycle
 * boundaries: replacing their DOM mid-gesture closes a drag/select/input even
 * when the draft value can later be reconstructed.
 */
export function createPointerRedrawGate(): PointerRedrawGate {
  let owner: HTMLElement | null = null
  let pending: (() => void) | null = null
  let onPointerIdle: (() => void) | null = null
  let onFocusOut: (() => void) | null = null
  let settleTimer = 0

  const clear = (): void => {
    if (owner && onPointerIdle) owner.removeEventListener(POINTER_IDLE_EVENT, onPointerIdle)
    if (owner && onFocusOut) owner.removeEventListener("focusout", onFocusOut)
    if (owner && settleTimer) owner.ownerDocument.defaultView?.clearTimeout(settleTimer)
    owner = null
    pending = null
    onPointerIdle = null
    onFocusOut = null
    settleTimer = 0
  }

  const isBlocked = (container: HTMLElement): boolean =>
    container.dataset.modularDiaryPointerActive === "1" || ownsActiveEditingSurface(container)

  const flushIfIdle = (): void => {
    if (!owner || isBlocked(owner)) return
    const redraw = pending
    clear()
    redraw?.()
  }

  const scheduleFocusSettle = (): void => {
    if (!owner || settleTimer) return
    const domWindow = owner.ownerDocument.defaultView
    if (!domWindow) {
      flushIfIdle()
      return
    }
    settleTimer = domWindow.setTimeout(() => {
      settleTimer = 0
      flushIfIdle()
    }, 0)
  }

  return {
    run: (container, redraw) => {
      if (!isBlocked(container)) {
        clear()
        redraw()
        return true
      }
      if (owner !== container) {
        clear()
        owner = container
        onPointerIdle = flushIfIdle
        onFocusOut = scheduleFocusSettle
        container.addEventListener(POINTER_IDLE_EVENT, onPointerIdle)
        container.addEventListener("focusout", onFocusOut)
      }
      // Latest state wins; any number of ledger/settings refreshes collapse to
      // one redraw after the user-owned interaction finishes.
      pending = redraw
      return false
    },
    clear,
  }
}
