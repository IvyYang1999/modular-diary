import type { ScrollTransactionKey } from "./scroll-transaction"

/** Holds the last stable snapshot and can freeze it before an external edit. */
export class RemountSnapshotLatch<Snapshot> {
  private snapshot: Snapshot | null = null
  private frozen = false

  get value(): Snapshot | null {
    return this.snapshot
  }

  update(snapshot: Snapshot): void {
    if (!this.frozen) this.snapshot = snapshot
  }

  freeze(snapshot: Snapshot): void {
    this.snapshot = snapshot
    this.frozen = true
  }

  release(): void {
    this.frozen = false
  }
}

interface RemountRecord<Owner extends object, Snapshot> {
  key: ScrollTransactionKey<Owner>
  source: string
  snapshot: Snapshot
  touchedAt: number
}

function sameBlock<Owner extends object>(
  a: ScrollTransactionKey<Owner>,
  b: ScrollTransactionKey<Owner>
): boolean {
  if (a.owner !== b.owner || a.path !== b.path) return false
  if (a.blockOrdinal >= 0 && b.blockOrdinal >= 0) return a.blockOrdinal === b.blockOrdinal
  return a.docId === b.docId && a.lineStart === b.lineStart
}

/**
 * Carries a visual snapshot across an Obsidian-owned processor remount.
 *
 * Unlike a plugin write transaction, an external editor change does not tell
 * Modular Diary what the next block source will be. The old host therefore records
 * its own source and the replacement consumes the record exactly once. A
 * changed source fails closed and is discarded so an undo cannot revive a
 * stale viewport later.
 */
export class RemountScrollRegistry<Owner extends object, Snapshot> {
  private records: Array<RemountRecord<Owner, Snapshot>> = []

  constructor(private readonly ttlMs = 3_000) {}

  get size(): number {
    return this.records.length
  }

  remember(
    key: ScrollTransactionKey<Owner>,
    source: string,
    snapshot: Snapshot,
    now = Date.now()
  ): void {
    this.prune(now)
    const existing = this.records.find((record) => sameBlock(record.key, key))
    if (existing) {
      existing.key = key
      existing.source = source
      existing.snapshot = snapshot
      existing.touchedAt = now
      return
    }
    this.records.push({ key, source, snapshot, touchedAt: now })
  }

  take(
    key: ScrollTransactionKey<Owner>,
    renderedSource: string,
    now = Date.now()
  ): Snapshot | null {
    this.prune(now)
    const matches = this.records.filter((record) => sameBlock(record.key, key))
    if (matches.length !== 1) return null
    const record = matches[0]
    this.records.splice(this.records.indexOf(record), 1)
    return record.source === renderedSource ? record.snapshot : null
  }

  clear(): void {
    this.records = []
  }

  private prune(now: number): void {
    this.records = this.records.filter((record) => now - record.touchedAt <= this.ttlMs)
  }
}
