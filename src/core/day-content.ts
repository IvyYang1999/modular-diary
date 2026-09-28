/**
 * Locate (or add) the timeline block that owns a given day inside a note's
 * content. Pure: the writer around it does the file I/O.
 */
import { timelineFences, type TimelineFenceLocation } from "../edit/block-identity"
import { dateFromBasename } from "./daily-notes"
import { parseTimeline } from "./parser"
import { timelineTemplate, type InsertTemplate } from "../insert"

export interface EnsuredBlock {
  content: string
  section: TimelineFenceLocation
  created: boolean
}

/** The block for `date`: an explicit `date:` wins; otherwise a dateless block in a note named after that day. */
export function findBlockForDate(content: string, date: string, basename: string): TimelineFenceLocation | null {
  let dateless: TimelineFenceLocation | null = null
  for (const fence of timelineFences(content)) {
    const doc = parseTimeline(fence.source)
    if (doc.date === date) return fence
    if (!doc.date && !dateless && dateFromBasename(basename) === date) dateless = fence
  }
  return dateless
}

export function ensureBlockForDate(content: string, date: string, basename: string, tpl: InsertTemplate = {}): EnsuredBlock {
  const existing = findBlockForDate(content, date, basename)
  if (existing) return { content, section: existing, created: false }
  const trimmed = content.replace(/\s+$/, "")
  const next = `${trimmed}${trimmed ? "\n\n" : ""}${timelineTemplate(date, tpl)}\n`
  const section = findBlockForDate(next, date, basename)
  if (!section) throw new Error("timeline block template did not parse")
  return { content: next, section, created: true }
}
