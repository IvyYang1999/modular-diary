/**
 * Hour diary (小时日记): text written against a stretch of time. A piece of
 * diary is either the indented body of a colour block, or a categoryless
 * `@HH:MM-HH:MM` span with a body. Nothing is stored apart from the block.
 */
import type { Entry, TimelineDoc } from "./types"

export interface HourlogItem {
  kind: "entry" | "span"
  line: number
  startMin: number
  endMin: number
  /** Category of a colour block; spans have none. */
  type?: string
  /** The block's note, or the span's inline text (usually tags). */
  note?: string
  tags: string[]
  body: string
  /** Which of the pieces with this exact identity it is (0 for the first). */
  ordinal: number
}

/** A colour block a new piece hangs on, named by what it is rather than by its line. */
export interface HourlogLink {
  startMin: number
  endMin: number
  type: string
  note?: string
}

export function hourlogItems(doc: Pick<TimelineDoc, "entries" | "spans">): HourlogItem[] {
  const items: HourlogItem[] = []
  for (const entry of doc.entries) {
    if (entry.plan || entry.body === undefined) continue
    items.push({ kind: "entry", line: entry.line, startMin: entry.startMin, endMin: entry.endMin, type: entry.type, note: entry.note, tags: entry.tags, body: entry.body, ordinal: 0 })
  }
  for (const span of doc.spans) {
    items.push({ kind: "span", line: span.line, startMin: span.startMin, endMin: span.endMin, note: span.text || undefined, tags: span.tags, body: span.body ?? "", ordinal: 0 })
  }
  items.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin || a.line - b.line)
  const seen = new Map<string, number>()
  for (const item of items) {
    const key = identityKey(item)
    item.ordinal = seen.get(key) ?? 0
    seen.set(key, item.ordinal + 1)
  }
  return items
}

function identityKey(item: { kind: "entry" | "span"; startMin: number; endMin: number; type?: string }): string {
  return `${item.kind}|${item.startMin}|${item.endMin}|${item.type ?? ""}`
}

/**
 * The line of a piece in the current source: same identity, same ordinal,
 * and the text it had when it was shown. Anything else returns null so the
 * write is refused instead of landing somewhere else (review A2).
 */
export function locateHourlogItem(doc: Pick<TimelineDoc, "entries" | "spans">, item: HourlogItem): number | null {
  const found = hourlogItems(doc).filter((candidate) => identityKey(candidate) === identityKey(item))[item.ordinal]
  if (!found || found.body !== item.body) return null
  return found.line
}

/** The block a link names, only while it still has no diary of its own (review A3). */
export function findLinkable(doc: Pick<TimelineDoc, "entries">, link: HourlogLink): Entry | undefined {
  return doc.entries.find((entry) => !entry.plan && entry.body === undefined
    && entry.startMin === link.startMin && entry.endMin === link.endMin && entry.type === link.type
    && (entry.note ?? "") === (link.note ?? ""))
}

export function linkOf(entry: Entry): HourlogLink {
  return { startMin: entry.startMin, endMin: entry.endMin, type: entry.type, ...(entry.note ? { note: entry.note } : {}) }
}

/** Actual colour blocks without a diary yet: what a new piece can hang on. */
export function linkableEntries(doc: Pick<TimelineDoc, "entries">): Entry[] {
  return doc.entries.filter((entry) => !entry.plan && entry.body === undefined).sort((a, b) => a.startMin - b.startMin)
}

/**
 * Where a new piece starts and ends: from the end of the last piece written
 * today up to now, rounded to five minutes. With nothing written yet it
 * covers the current hour (or the previous one in its first quarter).
 */
export function composerDefaults(items: HourlogItem[], nowMin: number): { startMin: number; endMin: number } {
  const end = Math.max(5, Math.round(nowMin / 5) * 5)
  const lastEnd = items.map((item) => item.endMin).filter((value) => value <= end).reduce((max, value) => Math.max(max, value), -1)
  let start = lastEnd >= 0 && end - lastEnd <= 6 * 60 ? lastEnd : Math.floor(nowMin / 60) * 60 - (nowMin % 60 < 15 ? 60 : 0)
  if (start >= end) start = end - 30
  return { startMin: Math.max(0, start), endMin: end }
}

export function parseClock(value: string): number | null {
  const match = /^\s*(\d{1,2})\s*[:：]\s*(\d{2})\s*$/.exec(value)
  if (!match) return null
  const h = Number(match[1]), m = Number(match[2])
  return h <= 30 && m < 60 ? h * 60 + m : null
}
