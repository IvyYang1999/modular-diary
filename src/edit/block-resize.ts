import {
  BlockSize,
  MAX_BLOCK_SIZE,
  MIN_BLOCK_HEIGHT,
  MIN_BLOCK_WIDTH,
} from "../core/block-size"
import { GRID_COLS, GridItem } from "../core/grid-layout"
import { applyGridToBody } from "./grid-interact"

export interface BlockResizeDeps<Interaction = void> {
  initialSize?: BlockSize
  initialCanvasWidth?: number
  /** Capture viewport ownership before the first live geometry change. */
  onStart?: () => Interaction
  /** Keep the captured visual anchor fixed while previewing the new size. */
  onPreview?: (interaction: Interaction) => void
  onCommit: (size: BlockSize, canvasWidth: number, interaction: Interaction | undefined) => void
  onCancel?: (interaction: Interaction) => void
}

type ResizeDirection = "e" | "s" | "se"

function itemsFromBody(body: HTMLElement): GridItem[] {
  return Array.from(body.querySelectorAll<HTMLElement>(".modular-diary-slot")).map((slot) => ({
    id: slot.dataset.slot ?? "",
    x: Number(slot.dataset.x),
    y: Number(slot.dataset.y),
    w: Number(slot.dataset.w),
    h: Number(slot.dataset.h),
  }))
}

function applyViewportSize(container: HTMLElement, size: BlockSize | undefined): void {
  container.classList.toggle("has-custom-size", size !== undefined)
  container.style.width = size ? `${size.width}px` : ""
  container.style.height = size ? `${size.height}px` : ""
}

/** Resize the outer Modular Diary viewport without changing the internal grid geometry. */
export function attachBlockResize<Interaction = void>(
  container: HTMLElement,
  body: HTMLElement,
  deps: BlockResizeDeps<Interaction>
): void {
  const dom = container.ownerDocument
  const initialCanvasWidth = deps.initialCanvasWidth
  if (initialCanvasWidth !== undefined) {
    body.dataset.gridBaseWidth = String(initialCanvasWidth)
    applyGridToBody(body, itemsFromBody(body))
  }
  applyViewportSize(container, deps.initialSize)

  for (const direction of ["e", "s", "se"] as const) {
    const handle = dom.createElement("div")
    handle.className = `modular-diary-block-resize-handle modular-diary-block-resize-${direction}`
    handle.setAttribute("aria-hidden", "true")
    container.appendChild(handle)

    handle.addEventListener("pointerdown", (event: PointerEvent) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()

      const interaction = deps.onStart?.()
      const startRect = container.getBoundingClientRect()
      const columns = Number(body.dataset.gridCols) || GRID_COLS
      const oldBaseWidth = body.dataset.gridBaseWidth
      const baseCanvasWidth = Number(oldBaseWidth) || (body.getBoundingClientRect().width * GRID_COLS) / columns
      const originalSize = deps.initialSize
      let latest: BlockSize = { width: startRect.width, height: startRect.height }
      let moved = false

      body.dataset.gridBaseWidth = String(baseCanvasWidth)
      applyGridToBody(body, itemsFromBody(body))
      container.classList.add("is-resizing")

      const maxWidth = Math.min(MAX_BLOCK_SIZE, Math.max(MIN_BLOCK_WIDTH, container.parentElement?.clientWidth ?? MAX_BLOCK_SIZE))
      const onMove = (moveEvent: PointerEvent): void => {
        const dx = moveEvent.clientX - event.clientX
        const dy = moveEvent.clientY - event.clientY
        const width = direction.includes("e")
          ? Math.min(maxWidth, Math.max(MIN_BLOCK_WIDTH, Math.round(startRect.width + dx)))
          : Math.round(startRect.width)
        const height = direction.includes("s")
          ? Math.min(MAX_BLOCK_SIZE, Math.max(MIN_BLOCK_HEIGHT, Math.round(startRect.height + dy)))
          : Math.round(startRect.height)
        latest = { width, height }
        moved = moved || width !== Math.round(startRect.width) || height !== Math.round(startRect.height)
        applyViewportSize(container, latest)
        if (interaction !== undefined) deps.onPreview?.(interaction)
      }

      const cleanup = (): void => {
        dom.removeEventListener("pointermove", onMove)
        dom.removeEventListener("pointerup", onUp)
        dom.removeEventListener("pointercancel", onCancel)
        container.classList.remove("is-resizing")
      }
      const restoreCanvas = (): void => {
        if (oldBaseWidth === undefined) delete body.dataset.gridBaseWidth
        else body.dataset.gridBaseWidth = oldBaseWidth
        applyGridToBody(body, itemsFromBody(body))
      }
      const onUp = (): void => {
        cleanup()
        if (!moved) {
          applyViewportSize(container, originalSize)
          restoreCanvas()
          return
        }
        if (interaction !== undefined) deps.onPreview?.(interaction)
        deps.onCommit(latest, Math.round(baseCanvasWidth), interaction)
      }
      const onCancel = (): void => {
        cleanup()
        applyViewportSize(container, originalSize)
        restoreCanvas()
        if (interaction !== undefined) {
          deps.onPreview?.(interaction)
          deps.onCancel?.(interaction)
        }
      }

      dom.addEventListener("pointermove", onMove)
      dom.addEventListener("pointerup", onUp)
      dom.addEventListener("pointercancel", onCancel)
    })
  }
}
