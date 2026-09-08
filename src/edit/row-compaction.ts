/**
 * Progressive compaction for single-line control rows.
 *
 * Rows that must never wrap (the timeline topbar and the creation controls)
 * declare an ordered list of compaction levels.  Each level is a class that
 * removes secondary copy while every control keeps its accessible name, so a
 * narrow pane degrades to icon-only controls instead of clipping them.  The
 * row is re-measured at full width on every resize and receives the fewest
 * levels at which its children no longer overflow.
 */
/** Timeline topbar: layer toggles drop their copy and keep the eye icons. */
export const TIMELINE_TOPBAR_COMPACTION = ["is-compact-labels"] as const

/** Creation row: geometry buttons go icon-only first, then the Plan mode switch loses its label. */
export const CREATION_ROW_COMPACTION = ["is-compact-tools", "is-compact-plan"] as const

export function attachRowCompaction(row: HTMLElement, levels: readonly string[]): () => void {
  const apply = (): void => {
    for (const level of levels) row.classList.remove(level)
    let applied = 0
    // scrollWidth counts overflowing non-wrapping flex children even while
    // overflow stays visible, so the measurement needs no scroll container.
    while (applied < levels.length && row.scrollWidth > row.clientWidth) {
      row.classList.add(levels[applied])
      applied += 1
    }
    row.dataset.compaction = String(applied)
  }
  apply()
  const ResizeObserverCtor = row.ownerDocument.defaultView?.ResizeObserver
  if (!ResizeObserverCtor) return () => {}
  const observer = new ResizeObserverCtor(() => {
    if (!row.isConnected) {
      observer.disconnect()
      return
    }
    apply()
  })
  observer.observe(row)
  return () => observer.disconnect()
}
