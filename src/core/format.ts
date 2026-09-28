/** Canonical entry line formatting — the single writer of timeline syntax. */

export interface EntryParts {
  plan: boolean
  startMin: number
  endMin: number
  type: string
  note?: string
  todoId?: string
}

export interface MarkerParts {
  plan?: boolean
  timeMin: number
  type: string
  text?: string
}

/** "09:15" / values >=24h wrap to plain 24h (D10: source stays ordinary clock time). */
export function formatClockPlain(minutes: number): string {
  const v = minutes >= 24 * 60 ? minutes - 24 * 60 : minutes
  return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`
}

/** plan 09:15-12:15 math 李林线代 */
export function formatEntryLine(p: EntryParts): string {
  const head = `${formatClockPlain(p.startMin)}-${formatClockPlain(p.endMin)} ${p.type}`
  const note = `${p.note ? " " + p.note : ""}${p.todoId ? ` [todo:${p.todoId}]` : ""}`
  return `${p.plan ? "plan " : ""}${head}${note}`
}

/** `@10:00 [起床] 正式起床` — categorized point-in-time marker. */
/** Diary body -> indented source lines (two spaces). Empty body -> no lines. */
export function formatBodyLines(body: string | undefined): string[] {
  if (body === undefined) return []
  const lines = body.replace(/\s+$/, "").split("\n")
  return lines.map((line) => (line.trim() === "" ? "" : `  ${line.replace(/\s+$/, "")}`)).filter((line, index, all) => line !== "" || index < all.length - 1)
}

/** `@HH:MM-HH:MM [text]` — a diary span with no category. */
export function formatSpanLine(p: { startMin: number; endMin: number; text?: string }): string {
  return `@${formatClockPlain(p.startMin)}-${formatClockPlain(p.endMin)}${p.text ? " " + p.text : ""}`
}

export function formatMarkerLine(p: MarkerParts): string {
  const note = p.text?.trim() ? ` ${p.text.trim()}` : ""
  return `${p.plan ? "plan " : ""}@${formatClockPlain(p.timeMin)} [${p.type}]${note}`
}

/** "2026-08-18" -> "周二"（无效输入返回空串） */
export function weekdayZh(dateStr: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!m) return ""
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (Number.isNaN(d.getTime())) return ""
  return "周" + "日一二三四五六"[d.getDay()]
}
