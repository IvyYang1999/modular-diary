/**
 * Every day's data stays in its own note; anything that looks across days
 * (weekly goals, a period block, "push to tomorrow") reads this index. It is
 * incremental: vault events mark a path dirty and only that file is re-read.
 */
import { timelineFences } from "../edit/block-identity"
import { dateFromBasename } from "./daily-notes"
import { parseTimeline } from "./parser"
import type { Entry, SpanNote, TodoItem } from "./types"
import type { DatedTimelineEntries } from "./weekly-ledger"

export interface IndexedBlock {
  path: string
  basename: string
  date: string
  /** Position among the note's timeline fences. */
  ordinal: number
  entries: Entry[]
  spans: SpanNote[]
  todos: TodoItem[]
}

export function extractIndexedBlocks(path: string, basename: string, content: string): IndexedBlock[] {
  const out: IndexedBlock[] = []
  let ordinal = 0
  for (const fence of timelineFences(content)) {
    const doc = parseTimeline(fence.source)
    const date = doc.period ? null : (doc.date ?? dateFromBasename(basename))
    if (date) out.push({ path, basename, date, ordinal, entries: doc.entries, spans: doc.spans, todos: doc.todos })
    ordinal += 1
  }
  return out
}

export class DayIndex {
  private readonly files = new Map<string, IndexedBlock[]>()
  private readonly dirty = new Set<string>()

  /** Paths still to be read before the index is trustworthy. */
  get pending(): string[] {
    return [...this.dirty]
  }

  markDirty(path: string): void {
    this.dirty.add(path)
  }

  remove(path: string): void {
    this.files.delete(path)
    this.dirty.delete(path)
  }

  rename(oldPath: string, newPath: string): void {
    this.remove(oldPath)
    this.markDirty(newPath)
  }

  update(path: string, basename: string, content: string): void {
    const blocks = extractIndexedBlocks(path, basename, content)
    if (blocks.length > 0) this.files.set(path, blocks)
    else this.files.delete(path)
    this.dirty.delete(path)
  }

  blocksForDate(date: string): IndexedBlock[] {
    const out: IndexedBlock[] = []
    for (const blocks of this.files.values()) for (const block of blocks) if (block.date === date) out.push(block)
    return out
  }

  blocksInRange(start: string, end: string): IndexedBlock[] {
    const out: IndexedBlock[] = []
    for (const blocks of this.files.values()) for (const block of blocks) if (block.date >= start && block.date <= end) out.push(block)
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.path.localeCompare(b.path) || a.ordinal - b.ordinal)
  }

  /** The note a day lives in: a note named after the day wins over one that merely holds a block for it. */
  notePathForDate(date: string): string | null {
    const blocks = this.blocksForDate(date)
    if (blocks.length === 0) return null
    return (blocks.find((block) => dateFromBasename(block.basename) === date) ?? blocks[0]).path
  }

  /** Compatibility shape for the weekly habit ledger. */
  datedEntries(): DatedTimelineEntries[] {
    const out: DatedTimelineEntries[] = []
    for (const blocks of this.files.values()) for (const block of blocks) out.push({ date: block.date, entries: block.entries })
    return out
  }
}
