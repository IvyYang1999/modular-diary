export interface TimelineVisualRegistration<Owner extends object> {
  path: string
  owner: Owner
  blockOrdinal: number
  source: string
  preview: (nextSource: string, previousSource: string) => (() => void) | null
}

interface TimelineVisualRecord<Owner extends object> extends TimelineVisualRegistration<Owner> {
  pendingSource: string | null
  generation: number
}

/**
 * Owns the single visible representation of a mounted timeline block while a
 * markdown write is crossing Obsidian's asynchronous post-processor boundary.
 *
 * The coordinator deliberately knows nothing about SVG or DOM structure. Its
 * contract is smaller: optimistic preview becomes the sole visual owner, stale
 * renderer output is rejected, and rollback is valid only for the generation
 * which created it.
 */
export class TimelineVisualCoordinator<Host extends object, Owner extends object> {
  private readonly records = new Map<Host, TimelineVisualRecord<Owner>>()

  /**
   * Resolve the one currently mounted host for a concrete pane and timeline
   * fence. A path alone is never sufficient: one note may be open in several
   * panes and may contain several Modular Diary blocks.
   */
  findHost(path: string, owner: Owner, blockOrdinal: number): Host | null {
    const matches: Host[] = []
    for (const [host, record] of this.records) {
      if (record.path === path && record.owner === owner && record.blockOrdinal === blockOrdinal) {
        matches.push(host)
      }
    }
    return matches.length === 1 ? matches[0] : null
  }

  register(host: Host, registration: TimelineVisualRegistration<Owner>): () => void {
    const record: TimelineVisualRecord<Owner> = {
      ...registration,
      pendingSource: null,
      generation: 0,
    }
    this.records.set(host, record)
    return () => {
      if (this.records.get(host) === record) this.records.delete(host)
    }
  }

  preview(host: Host, nextSource: string): (() => void) | null {
    const record = this.records.get(host)
    if (!record || nextSource === record.source) return null

    const previousSource = record.source
    const generation = record.generation + 1
    const rollbackPreview = record.preview(nextSource, previousSource)
    if (!rollbackPreview) return null

    record.source = nextSource
    record.pendingSource = nextSource
    record.generation = generation

    return () => {
      const current = this.records.get(host)
      if (current !== record || current.generation !== generation || current.pendingSource !== nextSource) return
      rollbackPreview()
      record.source = previousSource
      record.pendingSource = null
      record.generation += 1
    }
  }

  /**
   * Advance source ownership without invoking the registered whole-block
   * preview. Small self-contained components (for example Daily Quote) can
   * repaint only their own slot while still rejecting stale processor output.
   */
  advance(host: Host, nextSource: string): (() => void) | null {
    const record = this.records.get(host)
    if (!record || nextSource === record.source) return null

    const previousSource = record.source
    const generation = record.generation + 1
    record.source = nextSource
    record.pendingSource = nextSource
    record.generation = generation

    return () => {
      const current = this.records.get(host)
      if (current !== record || current.generation !== generation || current.pendingSource !== nextSource) return
      record.source = previousSource
      record.pendingSource = null
      record.generation += 1
    }
  }

  shouldRender(host: Host, source: string): boolean {
    const record = this.records.get(host)
    // A mounted host has exactly one authoritative source, even after the
    // persistence round-trip has completed. Obsidian may deliver an older
    // post-processor callback late; allowing it merely because `pendingSource`
    // was cleared would briefly resurrect the previous DOM and cause ghosting.
    return !record || record.source === source
  }

  accept(host: Host, source: string): void {
    const record = this.records.get(host)
    if (!record) return
    record.source = source
    record.pendingSource = null
    record.generation += 1
  }

  clear(): void {
    this.records.clear()
  }

  syncFromContent(
    path: string,
    owner: Owner,
    content: string,
    sourceAtOrdinal: (content: string, ordinal: number) => string | null
  ): number {
    let synced = 0
    for (const [host, record] of this.records) {
      if (record.path !== path || record.owner !== owner) continue
      const nextSource = sourceAtOrdinal(content, record.blockOrdinal)
      if (nextSource === null) continue
      if (nextSource === record.source) {
        this.accept(host, nextSource)
        synced += 1
        continue
      }
      if (this.preview(host, nextSource)) synced += 1
    }
    return synced
  }
}
