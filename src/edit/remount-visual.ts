import type { ScrollTransactionKey } from "./scroll-transaction"

interface VisualRecord<Owner extends object> {
  key: ScrollTransactionKey<Owner>
  overlay: HTMLElement
  source: HTMLElement
  sourceVisibility: string
  dispose: () => void
}

function sameBlock<Owner extends object>(a: ScrollTransactionKey<Owner>, b: ScrollTransactionKey<Owner>): boolean {
  if (a.owner !== b.owner || a.path !== b.path) return false
  if (a.blockOrdinal >= 0 && b.blockOrdinal >= 0) return a.blockOrdinal === b.blockOrdinal
  return a.docId === b.docId && a.lineStart === b.lineStart
}

function copyScrollOffsets(source: HTMLElement, clone: HTMLElement): void {
  const selector = ".modular-diary-block-scroll, .modular-diary-svg-holder, .modular-diary-text-pane"
  const sources = Array.from(source.querySelectorAll<HTMLElement>(selector))
  const clones = Array.from(clone.querySelectorAll<HTMLElement>(selector))
  sources.forEach((scroller, index) => {
    if (!clones[index]) return
    clones[index].scrollTop = scroller.scrollTop
    clones[index].scrollLeft = scroller.scrollLeft
  })
}

/** Bridges the visual gap while Obsidian replaces a code-block processor. */
export class RemountVisualRegistry<Owner extends object> {
  private records: Array<VisualRecord<Owner>> = []

  constructor(private readonly ttlMs = 2_000) {}

  get size(): number {
    return this.records.length
  }

  begin(key: ScrollTransactionKey<Owner>, source: HTMLElement): boolean {
    this.cancel(key)
    if (!source.isConnected) return false
    const rect = source.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return false

    const overlay = source.cloneNode(true) as HTMLElement
    overlay.classList.add("modular-diary-remount-overlay")
    overlay.setAttribute("aria-hidden", "true")
    overlay.setAttribute("inert", "")
    overlay.querySelectorAll<HTMLElement>("[id]").forEach((node) => node.removeAttribute("id"))
    Object.assign(overlay.style, {
      position: "fixed",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      margin: "0",
      overflow: "hidden",
      pointerEvents: "none",
      zIndex: "var(--layer-popover, 1000)",
    })
    source.ownerDocument.body.appendChild(overlay)
    copyScrollOffsets(source, overlay)
    // The clone now owns the visual continuity frame. Keeping the live source
    // visible as well would paint two complete Modular Diary trees until Obsidian
    // unmounts the old processor. `visibility` preserves geometry and scroll
    // state, and is restored if the write is cancelled or the bridge expires.
    const sourceVisibility = source.style.visibility
    source.style.visibility = "hidden"
    const dom = source.ownerDocument
    const domWindow = dom.defaultView
    let resizeObserver: ResizeObserver | null = null
    let expiryTimer = 0
    let record!: VisualRecord<Owner>
    const invalidate = (): void => this.remove(record)
    dom.addEventListener("scroll", invalidate, true)
    domWindow?.addEventListener("resize", invalidate)
    domWindow?.visualViewport?.addEventListener("scroll", invalidate)
    domWindow?.visualViewport?.addEventListener("resize", invalidate)
    if (domWindow?.ResizeObserver) {
      resizeObserver = new domWindow.ResizeObserver(() => {
        // Detaching the old processor host is the exact gap this overlay
        // bridges. Only invalidate for a live source whose geometry changed.
        if (!source.isConnected) return
        const next = source.getBoundingClientRect()
        if (Math.abs(next.width - rect.width) > 0.5 || Math.abs(next.height - rect.height) > 0.5) invalidate()
      })
      resizeObserver.observe(source)
    }
    record = {
      key,
      overlay,
      source,
      sourceVisibility,
      dispose: () => {
        dom.removeEventListener("scroll", invalidate, true)
        domWindow?.removeEventListener("resize", invalidate)
        domWindow?.visualViewport?.removeEventListener("scroll", invalidate)
        domWindow?.visualViewport?.removeEventListener("resize", invalidate)
        resizeObserver?.disconnect()
        if (expiryTimer) domWindow?.clearTimeout(expiryTimer)
        if (source.isConnected) source.style.visibility = sourceVisibility
      },
    }
    this.records.push(record)
    expiryTimer = domWindow?.setTimeout(() => {
      if (this.records.includes(record)) this.remove(record)
    }, this.ttlMs) ?? 0
    return true
  }

  complete(key: ScrollTransactionKey<Owner>): boolean {
    const matches = this.records.filter((record) => sameBlock(record.key, key))
    if (matches.length !== 1) return false
    const record = matches[0]
    // `complete` is called only after the replacement processor tree has been
    // mounted. Browsers do not paint in the middle of this synchronous task,
    // so retaining the fixed clone until the next animation frame cannot fill
    // any real visual gap. It only makes the old and new trees share a paint;
    // under Electron load that frame can linger as a whole-block ghost.
    this.remove(record)
    return true
  }

  cancel(key: ScrollTransactionKey<Owner>): void {
    this.records.filter((record) => sameBlock(record.key, key)).forEach((record) => this.remove(record))
  }

  clear(): void {
    this.records.slice().forEach((record) => this.remove(record))
  }

  private remove(record: VisualRecord<Owner>): void {
    const index = this.records.indexOf(record)
    if (index >= 0) this.records.splice(index, 1)
    record.dispose()
    record.overlay.remove()
  }
}

export type RemountVisualMode = "bridge" | "live-preview"

/**
 * A live final-state preview is already the sole visual owner for the write.
 * Starting the whole-block bridge as well would paint a second complete tree
 * until Obsidian finishes remounting the Markdown processor.
 */
export function resolveRemountVisualMode(
  requested: RemountVisualMode | undefined,
  hasLivePreview: boolean,
): RemountVisualMode {
  return requested ?? (hasLivePreview ? "live-preview" : "bridge")
}

/**
 * Starts a processor-remount bridge only when the interaction has no live
 * final-state preview of its own.
 *
 * Grid move/resize is different from source-only edits: pointermove has
 * already painted the exact committed geometry into the mounted slot. Cloning
 * that complete tree at pointerup creates a second visual owner and can linger
 * beside the replacement renderer as a whole-block ghost. Keep the live tree
 * as the handoff instead.
 */
export function beginRemountVisual<Owner extends object>(
  registry: RemountVisualRegistry<Owner>,
  key: ScrollTransactionKey<Owner>,
  source: HTMLElement,
  mode: RemountVisualMode = "bridge"
): boolean {
  if (mode === "live-preview") return false
  return registry.begin(key, source)
}
