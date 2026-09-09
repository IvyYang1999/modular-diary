export type OuterViewportAuthority = "codemirror" | "dom"

export interface SnapshotWithViewport<TInternal, TViewport> {
  internal: TInternal
  viewport: TViewport | null
}

/**
 * The block's visible DOM anchor owns the outer scroll position by default,
 * also for CodeMirror-backed writes. Live Preview rebuilds the code block
 * widget after the transaction and, for one measure pass, CodeMirror's
 * height map sees the empty widget; its next pass then re-derives the scroll
 * anchor from that map, lands on a line *below* the block and scrolls the pane
 * by the block's full height once it is rendered again (真机取证 2026-09-09:
 * cm-scroller 131 → 1758). Callers may still hand the viewport to CodeMirror
 * explicitly when no widget remount follows the write.
 */
export function transactionScrollSnapshot<TInternal, TViewport>(
  snapshot: SnapshotWithViewport<TInternal, TViewport>,
  hasCodeMirrorWrite: boolean,
  authority: OuterViewportAuthority = "dom"
): SnapshotWithViewport<TInternal, TViewport> {
  if (!hasCodeMirrorWrite || authority === "dom") return snapshot
  return { ...snapshot, viewport: null }
}
