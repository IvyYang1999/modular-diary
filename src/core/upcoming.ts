/**
 * Future schedule kept in one note (`Upcoming.md` by default), one task line per
 * item:
 *
 *   - [ ] 2026-11-06 14:00-14:30 外出 去某地      → a plan block that day
 *   - [ ] 2026-11-06 交房租                      → a todo that day
 *
 * When that day's diary exists the item is copied into it and its box ticked
 * (`- [x]`), so it is copied once; editing the line later does not touch the
 * diary. Any other text in the note is left alone.
 */
export interface UpcomingItem {
  /** Line index in the note. */
  line: number
  date: string
  startMin?: number
  endMin?: number
  /** Category of a timed item (the first word after the time). */
  type?: string
  /** Part of the day for an untimed item (`2026-11-06 下午 去某地`). */
  zone?: "am" | "pm" | "ev"
  /** Note of a timed item, or the title of an untimed one. */
  text: string
  done: boolean
}

const LINE_RE = /^\s*- \[([ xX])\] (\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2}))?(?:\s+(上午|下午|晚上))?\s*(.*)$/
const ZONES: Record<string, "am" | "pm" | "ev"> = { 上午: "am", 下午: "pm", 晚上: "ev" }
const ZONE_WORDS: Record<"am" | "pm" | "ev", string> = { am: "上午", pm: "下午", ev: "晚上" }

export function parseUpcoming(content: string): UpcomingItem[] {
  const items: UpcomingItem[] = []
  content.split("\n").forEach((raw, line) => {
    const match = LINE_RE.exec(raw)
    if (!match) return
    const [, box, date, h1, m1, h2, m2, zoneWord, rest] = match
    const text = rest.trim()
    if (h1 === undefined) {
      if (!text) return
      items.push({ line, date, text, done: box !== " ", ...(zoneWord ? { zone: ZONES[zoneWord] } : {}) })
      return
    }
    const startMin = Number(h1) * 60 + Number(m1)
    let endMin = Number(h2) * 60 + Number(m2)
    if (endMin <= startMin) endMin += 24 * 60
    const [type = "", ...note] = text.split(/\s+/)
    if (!type) return
    items.push({ line, date, startMin, endMin, type, text: note.join(" "), done: box !== " " })
  })
  return items
}

function clock(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
}

export function formatUpcomingLine(item: Omit<UpcomingItem, "line">): string {
  const time = item.startMin !== undefined && item.endMin !== undefined ? ` ${clock(item.startMin)}-${clock(item.endMin)} ${item.type ?? ""}` : item.zone ? ` ${ZONE_WORDS[item.zone]}` : ""
  return `- [${item.done ? "x" : " "}] ${item.date}${time}${item.text ? ` ${item.text}` : ""}`.replace(/\s+$/, "")
}

/** Insert in date (then time) order among the existing items; a new note gets a short heading. */
export function addUpcoming(content: string, item: Omit<UpcomingItem, "line" | "done">, heading = "# Upcoming"): string {
  const line = formatUpcomingLine({ ...item, done: false })
  const items = parseUpcoming(content)
  const key = (value: { date: string; startMin?: number }): string => `${value.date} ${String(value.startMin ?? -1).padStart(5, "0")}`
  const after = items.filter((existing) => key(existing) <= key(item)).at(-1)
  const lines = content.split("\n")
  if (after) lines.splice(after.line + 1, 0, line)
  else if (items.length) lines.splice(items[0].line, 0, line)
  else if (!content.trim()) return `${heading}\n\n${line}\n`
  else lines.splice(content.endsWith("\n") ? lines.length - 1 : lines.length, 0, line)
  return lines.join("\n")
}

/** Tick the given items, re-checking each line still says the same thing. */
export function markUpcomingDone(content: string, done: UpcomingItem[]): string {
  const lines = content.split("\n")
  for (const item of done) {
    const current = parseUpcoming(lines[item.line] ?? "")[0]
    if (!current || current.done || current.date !== item.date || current.text !== item.text) continue
    lines[item.line] = lines[item.line].replace(/- \[ \]/, "- [x]")
  }
  return lines.join("\n")
}

export function pendingForDate(items: UpcomingItem[], date: string): UpcomingItem[] {
  return items.filter((item) => !item.done && item.date === date)
}

/** Not yet copied, from `today` on, in date and time order. */
export function upcomingFrom(items: UpcomingItem[], today: string): UpcomingItem[] {
  return items.filter((item) => !item.done && item.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.startMin ?? -1) - (b.startMin ?? -1))
}
