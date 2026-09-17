export interface ScrollTransactionKey<Owner extends object> {
  owner: Owner
  path: string
  docId: string
  lineStart: number
  /** Zero-based ordinal of this timeline fence in the current file. */
  blockOrdinal: number
}

interface ScrollTransaction<Owner extends object, Snapshot> {
  key: ScrollTransactionKey<Owner>
  expectedSource: string
  snapshot: Snapshot
  touchedAt: number
}

function sameOwner<Owner extends object>(
  a: ScrollTransactionKey<Owner>,
  b: ScrollTransactionKey<Owner>
): boolean {
  return a.owner === b.owner && a.path === b.path
}

function sameBlock<Owner extends object>(
  a: ScrollTransactionKey<Owner>,
  b: ScrollTransactionKey<Owner>
): boolean {
  if (!sameOwner(a, b)) return false
  if (a.blockOrdinal >= 0 && b.blockOrdinal >= 0) return a.blockOrdinal === b.blockOrdinal
  return a.docId === b.docId && a.lineStart === b.lineStart
}

/**
 * Owns viewport snapshots across an Obsidian code-block replacement.
 *
 * A file path is not an identity: the same note may be open in two panes and
 * may contain several Modular Diary blocks. Records are therefore scoped to the
 * concrete MarkdownView plus the rendered block. Repeated writes to the same
 * block keep the first snapshot and merely advance the expected source.
 */
export class ScrollTransactionRegistry<Owner extends object, Snapshot> {
  private records: Array<ScrollTransaction<Owner, Snapshot>> = []

  constructor(private readonly ttlMs = 10_000) {}

  get size(): number {
    return this.records.length
  }

  begin(
    key: ScrollTransactionKey<Owner>,
    expectedSource: string,
    snapshot: Snapshot,
    now = Date.now()
  ): void {
    this.prune(now)
    const existing = this.records.find((record) => sameBlock(record.key, key))
    if (existing) {
      // First-capture-wins: a redraw or a second write can happen after CM has
      // already moved. Preserve the user's original visual position.
      existing.expectedSource = expectedSource
      existing.touchedAt = now
      return
    }
    this.records.push({ key, expectedSource, snapshot, touchedAt: now })
  }

  claim(
    key: ScrollTransactionKey<Owner>,
    renderedSource: string,
    now = Date.now()
  ): Snapshot | null {
    this.prune(now)

    const exact = this.records.filter((record) =>
      sameBlock(record.key, key) && record.expectedSource === renderedSource
    )
    if (exact.length === 1) return this.consume(exact[0])
    return null
  }

  cancel(key: ScrollTransactionKey<Owner>): void {
    this.records = this.records.filter((record) => !sameBlock(record.key, key))
  }

  clear(): void {
    this.records = []
  }

  prune(now = Date.now()): void {
    this.records = this.records.filter((record) => now - record.touchedAt <= this.ttlMs)
  }

  private consume(record: ScrollTransaction<Owner, Snapshot>): Snapshot {
    const index = this.records.indexOf(record)
    if (index >= 0) this.records.splice(index, 1)
    return record.snapshot
  }
}
