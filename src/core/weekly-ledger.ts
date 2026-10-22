import { parseTimeline } from "./parser"
import type { Entry } from "./types"

export interface DatedTimelineEntries {
  date: string
  entries: Entry[]
  /** Habits checked off by hand that day. */
  habitDone?: string[]
}

const iso = (date: Date): string => {
  const part = (value: number): string => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}`
}

const parseIso = (value: string): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

function fallbackDate(name: string): string | null {
  const match = /(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/.exec(name)
  return match ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` : null
}

export function weekBounds(value: string): { start: string; end: string } | null {
  const date = parseIso(value)
  if (!date) return null
  const mondayOffset = (date.getDay() + 6) % 7
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - mondayOffset)
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)
  return { start: iso(start), end: iso(end) }
}

export function extractDatedTimelineEntries(content: string, fileBasename: string): DatedTimelineEntries[] {
  const lines = content.split(/\r?\n/)
  const out: DatedTimelineEntries[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const opening = /^(\s*(?:>\s*)*)(`{3,}|~{3,})\s*timeline\b/i.exec(lines[index])
    if (!opening) continue
    const body: string[] = []
    for (index += 1; index < lines.length; index += 1) {
      const raw = lines[index]
      const withoutPrefix = raw.startsWith(opening[1]) ? raw.slice(opening[1].length) : raw
      if (withoutPrefix.trim() === opening[2]) break
      body.push(withoutPrefix)
    }
    const doc = parseTimeline(body.join("\n"))
    const date = doc.date ?? fallbackDate(fileBasename)
    if (date) out.push({ date, entries: doc.entries })
  }
  return out
}

export function filterWeekEntries(items: DatedTimelineEntries[], date: string): DatedTimelineEntries[] {
  const bounds = weekBounds(date)
  return bounds ? items.filter((item) => item.date >= bounds.start && item.date <= bounds.end) : []
}
