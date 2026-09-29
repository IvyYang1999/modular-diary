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
}

export function hourlogItems(doc: Pick<TimelineDoc, "entries" | "spans">): HourlogItem[] {
  const items: HourlogItem[] = []
  for (const entry of doc.entries) {
    if (entry.plan || entry.body === undefined) continue
    items.push({ kind: "entry", line: entry.line, startMin: entry.startMin, endMin: entry.endMin, type: entry.type, note: entry.note, tags: entry.tags, body: entry.body })
  }
  for (const span of doc.spans) {
    items.push({ kind: "span", line: span.line, startMin: span.startMin, endMin: span.endMin, note: span.text || undefined, tags: span.tags, body: span.body ?? "" })
  }
  return items.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin || a.line - b.line)
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
