/**
 * Rhythms (节律): recurring commitments kept in one note (`节律.md`), one line
 * each, in a small natural-language grammar:
 *
 *   - 每周 1次 拍口播视频 @视频 整天
 *   - 每天 30分钟 运动 @运动 下午
 *   - 每两周 周二 14:00-15:00 心理咨询 @家人 自2026-10-27
 *   - 每月 1次 独立旅游 @旅行 2-3天
 *
 * Order after the cadence is free. A rhythm is the "commitment" face; the
 * existing habit rules are its "record" face, so daily and weekly rhythms are
 * also expressed as HabitDefinition for the day block's 打卡 component.
 */
import type { HabitDefinition } from "./habits"
import type { WeeklyTodoDefinition } from "./todos"

export type RhythmCadence = "daily" | "weekdays" | "weekly" | "biweekly" | "monthly"
export type RhythmZone = "am" | "pm" | "ev"
/** A duration remembers the unit it was written in, so "60分钟" never reopens as "1小时". */
export type RhythmQuota = { kind: "count"; count: number } | { kind: "duration"; minutes: number; unit?: "minutes" | "hours" }
export type RhythmSpan = { kind: "slot" } | { kind: "allDay" } | { kind: "days"; min: number; max: number }

export interface Rhythm {
  /** Stable id derived from the name; used in `rhythm=` fields and skip headers. */
  id: string
  name: string
  cadence: RhythmCadence
  /** Fixed weekday (0 = Sunday) for weekly / biweekly rhythms. */
  weekday?: number
  /** Biweekly anchor (`自2026-10-27`); without it even ISO weeks are "on". */
  anchor?: string
  startMin?: number
  endMin?: number
  quota: RhythmQuota
  /** Timeline category (`@运动`): colour, and a record of it completes a slot. */
  type?: string
  span: RhythmSpan
  /** Part of the day; with `zoneEnd` a contiguous range (上午 到 下午). */
  zone?: RhythmZone
  zoneEnd?: RhythmZone
  tags: string[]
  note?: string
  line: number
}

export const RHYTHM_ZONES: readonly RhythmZone[] = ["am", "pm", "ev"]
export const ZONE_LABELS: Record<RhythmZone, string> = { am: "上午", pm: "下午", ev: "晚上" }
const ZONE_BY_LABEL: Record<string, RhythmZone> = { 上午: "am", 下午: "pm", 晚上: "ev" }
const CADENCE_BY_WORD: Record<string, RhythmCadence> = { 每天: "daily", 每日: "daily", 工作日: "weekdays", 每周: "weekly", 每两周: "biweekly", 每月: "monthly" }
const CADENCE_WORD: Record<RhythmCadence, string> = { daily: "每天", weekdays: "工作日", weekly: "每周", biweekly: "每两周", monthly: "每月" }
const WEEKDAY_CHARS = "日一二三四五六"

export function rhythmId(name: string): string {
  return name.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "rhythm"
}

function parseTime(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text)
  if (!match) return null
  const minutes = Number(match[1]) * 60 + Number(match[2])
  return minutes <= 24 * 60 ? minutes : null
}

/** One rhythm line (without the leading `- `); null when it does not start with a cadence. */
export function parseRhythmLine(text: string, line = 0): Rhythm | null {
  const tokens = text.trim().split(/\s+/).filter(Boolean)
  const cadence = tokens.length ? CADENCE_BY_WORD[tokens[0]] : undefined
  if (!cadence) return null
  const rhythm: Rhythm = { id: "", name: "", cadence, quota: { kind: "count", count: 1 }, span: { kind: "slot" }, tags: [], line }
  const words: string[] = []
  let quotaSeen = false
  for (const token of tokens.slice(1)) {
    let match: RegExpExecArray | null
    if ((match = /^周([日一二三四五六天])$/.exec(token)) && (cadence === "weekly" || cadence === "biweekly")) {
      rhythm.weekday = match[1] === "天" ? 0 : WEEKDAY_CHARS.indexOf(match[1])
    } else if ((match = /^(\d{1,2}:\d{2})\s*[-–~]\s*(\d{1,2}:\d{2})$/.exec(token))) {
      const start = parseTime(match[1]), end = parseTime(match[2])
      if (start !== null && end !== null && end > start) { rhythm.startMin = start; rhythm.endMin = end }
    } else if (!quotaSeen && (match = /^(\d+)次$/.exec(token))) {
      rhythm.quota = { kind: "count", count: Math.max(1, Number(match[1])) }; quotaSeen = true
    } else if (!quotaSeen && (match = /^(\d+(?:\.\d+)?)(小时|h)$/i.exec(token))) {
      rhythm.quota = { kind: "duration", minutes: Math.round(Number(match[1]) * 60), unit: "hours" }; quotaSeen = true
    } else if (!quotaSeen && (match = /^(\d+)(分钟|分|m|min)$/i.exec(token))) {
      rhythm.quota = { kind: "duration", minutes: Number(match[1]), unit: "minutes" }; quotaSeen = true
    } else if (token.startsWith("@") && token.length > 1) {
      rhythm.type = token.slice(1)
    } else if (token.startsWith("#") && token.length > 1) {
      rhythm.tags.push(token.slice(1))
    } else if (token === "整天" || token === "全天") {
      rhythm.span = { kind: "allDay" }
    } else if ((match = /^(\d+)(?:-(\d+))?天$/.exec(token))) {
      const min = Number(match[1]), max = match[2] ? Number(match[2]) : min
      rhythm.span = { kind: "days", min: Math.max(1, Math.min(min, max)), max: Math.max(1, max, min) }
    } else if ((match = /^(上午|下午|晚上)\s*(?:-|–|~|到|至)\s*(上午|下午|晚上)$/.exec(token))) {
      rhythm.zone = ZONE_BY_LABEL[match[1]]; rhythm.zoneEnd = ZONE_BY_LABEL[match[2]]
    } else if (ZONE_BY_LABEL[token]) {
      // A second part of the day extends the first into a range (上午 下午, or 上午-下午).
      if (rhythm.zone === undefined) rhythm.zone = ZONE_BY_LABEL[token]
      else rhythm.zoneEnd = ZONE_BY_LABEL[token]
    } else if ((match = /^自(\d{4}-\d{2}-\d{2})$/.exec(token))) {
      rhythm.anchor = match[1]
    } else {
      words.push(token)
    }
  }
  rhythm.name = words.join(" ")
  if (rhythm.zoneEnd !== undefined && rhythm.zone !== undefined) {
    const [a, b] = [RHYTHM_ZONES.indexOf(rhythm.zone), RHYTHM_ZONES.indexOf(rhythm.zoneEnd)].sort()
    rhythm.zone = RHYTHM_ZONES[a]
    if (a === b) delete rhythm.zoneEnd
    else rhythm.zoneEnd = RHYTHM_ZONES[b]
  }
  if (!rhythm.name) return null
  rhythm.id = rhythmId(rhythm.name)
  return rhythm
}

/** Every rhythm in the note; other lines (headings, prose) are left alone. Indented lines under an item are its note. */
export function parseRhythms(content: string): Rhythm[] {
  const out: Rhythm[] = []
  const lines = content.split("\n")
  lines.forEach((raw, index) => {
    const item = /^- (?!\[)(.*)$/.exec(raw)
    if (item) {
      const rhythm = parseRhythmLine(item[1], index)
      if (rhythm) out.push(rhythm)
      return
    }
    const last = out[out.length - 1]
    if (last && /^\s{2,}\S/.test(raw) && index === last.line + 1 + (last.note ? last.note.split("\n").length : 0)) {
      last.note = last.note ? `${last.note}\n${raw.trim()}` : raw.trim()
    }
  })
  // Later duplicates of a name get a numbered id so slots never collide.
  const seen = new Map<string, number>()
  for (const rhythm of out) {
    const count = (seen.get(rhythm.id) ?? 0) + 1
    seen.set(rhythm.id, count)
    if (count > 1) rhythm.id = `${rhythm.id}-${count}`
  }
  return out
}

function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
}

export function formatRhythmLine(rhythm: Omit<Rhythm, "id" | "line">): string {
  const parts = [CADENCE_WORD[rhythm.cadence]]
  if (rhythm.weekday !== undefined) parts.push(`周${WEEKDAY_CHARS[rhythm.weekday] ?? "日"}`)
  if (rhythm.startMin !== undefined && rhythm.endMin !== undefined) parts.push(`${clock(rhythm.startMin)}-${clock(rhythm.endMin)}`)
  if (rhythm.quota.kind === "duration") {
    const hours = rhythm.quota.unit === "hours" || (rhythm.quota.unit === undefined && rhythm.quota.minutes % 60 === 0)
    parts.push(hours ? `${+(rhythm.quota.minutes / 60).toFixed(2)}小时` : `${rhythm.quota.minutes}分钟`)
  }
  else if (rhythm.quota.count !== 1) parts.push(`${rhythm.quota.count}次`)
  parts.push(rhythm.name)
  if (rhythm.type) parts.push(`@${rhythm.type}`)
  if (rhythm.span.kind === "allDay") parts.push("整天")
  else if (rhythm.span.kind === "days") parts.push(rhythm.span.min === rhythm.span.max ? `${rhythm.span.min}天` : `${rhythm.span.min}-${rhythm.span.max}天`)
  if (rhythm.zone) parts.push(rhythm.zoneEnd && rhythm.zoneEnd !== rhythm.zone ? `${ZONE_LABELS[rhythm.zone]}-${ZONE_LABELS[rhythm.zoneEnd]}` : ZONE_LABELS[rhythm.zone])
  if (rhythm.anchor) parts.push(`自${rhythm.anchor}`)
  for (const tag of rhythm.tags) parts.push(`#${tag}`)
  return `- ${parts.join(" ")}${rhythm.note ? "\n" + rhythm.note.split("\n").map((text) => `  ${text}`).join("\n") : ""}`
}

function isoWeekParity(date: string): number {
  const d = new Date(`${date}T00:00:00Z`)
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1)
  return Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7) % 2
}

function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

/** Whether a weekly / biweekly rhythm is on in the week containing `date`. */
export function rhythmWeekOn(rhythm: Rhythm, date: string): boolean {
  if (rhythm.cadence !== "biweekly") return true
  if (!rhythm.anchor) return isoWeekParity(date) === 0
  const diff = (Date.parse(`${mondayOf(date)}T00:00:00Z`) - Date.parse(`${mondayOf(rhythm.anchor)}T00:00:00Z`)) / 86400000
  return diff >= 0 && Math.round(diff / 7) % 2 === 0
}

/**
 * The record face of a daily / weekly rhythm: the habit rule the day block
 * measures against (duration or count, per day or per week). Monthly rhythms
 * are not habits; the month plan view owns them.
 */
export function rhythmToHabit(rhythm: Rhythm, order: number): HabitDefinition | null {
  if (rhythm.cadence === "monthly") return null
  const weekly = rhythm.cadence === "weekly" || rhythm.cadence === "biweekly"
  const base = { id: rhythm.id, name: rhythm.name, type: rhythm.type ?? "", order, repeatWeekly: true }
  const schedule: HabitDefinition["schedule"] = rhythm.cadence === "weekdays"
    ? { kind: "weekdays" }
    : rhythm.cadence === "biweekly" && rhythm.anchor
      ? { kind: "interval", everyDays: 14, anchorDate: rhythm.anchor }
      : rhythm.weekday !== undefined && !weekly
        ? { kind: "weekly", weekdays: [rhythm.weekday] }
        : { kind: "daily" }
  if (rhythm.quota.kind === "duration") {
    return { ...base, schedule, targetMinutes: rhythm.quota.minutes, targetPeriod: weekly ? "week" : "day", targetMetric: "duration" }
  }
  return weekly
    ? { ...base, schedule, targetMinutes: 0, targetPeriod: "week", targetMetric: "count", targetCount: rhythm.quota.count }
    : { ...base, schedule, targetMinutes: 0, targetPeriod: "day", targetMetric: "duration" }
}

/** Lines for the rhythms note from the settings they replace (one-time migration). */
export function rhythmLinesFromSettings(habits: HabitDefinition[], weeklyTodos: WeeklyTodoDefinition[]): string {
  const lines: string[] = []
  for (const habit of [...habits].sort((a, b) => a.order - b.order)) {
    const weekly = habit.targetPeriod === "week"
    const cadence: RhythmCadence = weekly ? "weekly" : habit.schedule.kind === "weekdays" ? "weekdays" : habit.schedule.kind === "interval" && habit.schedule.everyDays === 14 ? "biweekly" : "daily"
    const quota: RhythmQuota = habit.targetMetric === "count"
      ? { kind: "count", count: Math.max(1, habit.targetCount ?? 1) }
      : habit.targetMinutes > 0 ? { kind: "duration", minutes: habit.targetMinutes } : { kind: "count", count: 1 }
    lines.push(formatRhythmLine({
      name: habit.name, cadence, quota, type: habit.type || undefined, span: { kind: "slot" }, tags: [],
      ...(habit.schedule.kind === "weekly" && habit.schedule.weekdays.length === 1 && !weekly ? { weekday: habit.schedule.weekdays[0] } : {}),
      ...(cadence === "biweekly" && habit.schedule.kind === "interval" ? { anchor: habit.schedule.anchorDate } : {}),
    }))
  }
  for (const todo of [...weeklyTodos].sort((a, b) => a.order - b.order)) {
    lines.push(formatRhythmLine({
      name: todo.title, cadence: "weekly", type: todo.type || undefined, span: { kind: "slot" }, tags: [],
      quota: todo.targetMinutes > 0 ? { kind: "duration", minutes: todo.targetMinutes } : { kind: "count", count: 1 },
    }))
  }
  return `# 节律\n\n${lines.join("\n")}\n`
}

/** A rhythm as the editor holds it: everything but the derived id and the note line. */
export type RhythmDraft = Omit<Rhythm, "id" | "line">

/** Line indices a rhythm occupies in the note: its own line and its indented note lines. */
function rhythmLineSpans(content: string): Array<{ start: number; end: number }> {
  const lines = content.split("\n")
  return parseRhythms(content).map((rhythm) => ({ start: rhythm.line, end: rhythm.line + (rhythm.note ? rhythm.note.split("\n").length : 0) }))
    .filter((span) => span.end < lines.length)
}

/**
 * Rewrite the note with these rhythms, in this order. Headings and prose stay
 * where they are; the rhythm lines go where the first one was, or at the end.
 */
export function writeRhythms(content: string, rhythms: RhythmDraft[]): string {
  const lines = content.split("\n")
  const spans = rhythmLineSpans(content)
  const removed = new Set<number>()
  for (const span of spans) for (let index = span.start; index <= span.end; index++) removed.add(index)
  const block = rhythms.filter((rhythm) => rhythm.name.trim()).map((rhythm) => formatRhythmLine({ ...rhythm, name: rhythm.name.trim() }))
  const at = spans[0]?.start ?? -1
  const out: string[] = []
  lines.forEach((line, index) => {
    if (index === at) out.push(...block)
    if (!removed.has(index)) out.push(line)
  })
  if (at < 0) {
    while (out.length && out[out.length - 1].trim() === "") out.pop()
    if (out.length) out.push("")
    out.push(...block)
  }
  const text = out.join("\n")
  return text.endsWith("\n") ? text : `${text}\n`
}

/** Move the rhythm `id` so it sits before `beforeId` (or last when null). */
export function reorderRhythms(rhythms: Rhythm[], id: string, beforeId: string | null): Rhythm[] {
  const moving = rhythms.find((rhythm) => rhythm.id === id)
  if (!moving || id === beforeId) return rhythms
  const rest = rhythms.filter((rhythm) => rhythm.id !== id)
  const index = beforeId === null ? rest.length : rest.findIndex((rhythm) => rhythm.id === beforeId)
  if (index < 0) return rhythms
  return [...rest.slice(0, index), moving, ...rest.slice(index)]
}

/** "上午" or "上午–下午": the part of the day a rhythm asks for. */
export function zoneRangeLabel(rhythm: Pick<Rhythm, "zone" | "zoneEnd">, label: (zone: RhythmZone) => string = (zone) => ZONE_LABELS[zone]): string {
  if (!rhythm.zone) return ""
  return rhythm.zoneEnd && rhythm.zoneEnd !== rhythm.zone ? `${label(rhythm.zone)}–${label(rhythm.zoneEnd)}` : label(rhythm.zone)
}
