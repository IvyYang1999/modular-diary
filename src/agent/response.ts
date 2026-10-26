/** Extract & validate the agent's structured entry (D7 插件统一校验). */
import { normalizeSpan } from "../core/parser"
import { TimelineDoc } from "../core/types"
import { formatEntryLine } from "../core/format"
import { t } from "../i18n"

export interface AgentEntry {
  start: string
  end: string
  type: string
  note?: string
  plan?: boolean
}

export interface ValidatedEntry {
  startMin: number
  endMin: number
  type: string
  note?: string
  plan: boolean
  /** Canonical source line to insert, e.g. "09:15-12:15 math 李林线代" */
  sourceLine: string
}

export type ResponseResult =
  | { ok: true; entry: ValidatedEntry }
  | { ok: false; reason: string }

/** Find the first {...} or [...] JSON value in arbitrary text (tolerates code fences). */
export function extractJson(text: string): unknown | null {
  const fence = /```(?:json)?\s*(\{[\s\S]*?\}|\[[\s\S]*?\])\s*```/.exec(text)
  const candidate = fence ? fence[1] : /(\[[\s\S]*\]|\{[\s\S]*\})/.exec(text)?.[1]
  if (!candidate) return null
  try {
    return JSON.parse(candidate)
  } catch {
    return null
  }
}

const TIME_RE = /^(\d{1,2}):(\d{2})$/

function parseClock(s: unknown): number | null {
  if (typeof s !== "string") return null
  const m = TIME_RE.exec(s.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 30 || min < 0 || min > 59) return null
  return h * 60 + min
}

const CLOCK_RANGE_RE = /(\d{1,2})\s*[:：]\s*(\d{2})\s*(?:~|～|—|–|-|到|至)\s*(\d{1,2})\s*[:：]\s*(\d{2})/
const EARLY_DAY_RE = /(?:凌晨|半夜|清晨|早上|早晨|上午|\ba\.?m\.?\b)/i
const LATE_DAY_RE = /(?:中午|下午|傍晚|晚上|晚间|\bp\.?m\.?\b)/i

/**
 * Preserve an explicit range from the user's sentence instead of trusting the
 * model to choose AM/PM. For an unqualified 02:30 on a 07:00–23:00 timeline,
 * 14:30 is the only same-day candidate inside the visible range.
 */
function explicitUserSpan(userText: string | undefined, doc: TimelineDoc): [number, number] | null {
  if (!userText) return null
  const match = CLOCK_RANGE_RE.exec(userText)
  if (!match) return null
  const startHour = Number(match[1])
  const startMinute = Number(match[2])
  const endHour = Number(match[3])
  const endMinute = Number(match[4])
  if (startHour > 24 || endHour > 24 || startMinute > 59 || endMinute > 59) return null
  let start = startHour * 60 + startMinute
  let end = endHour * 60 + endMinute

  const explicitlyEarly = EARLY_DAY_RE.test(userText)
  const explicitlyLate = LATE_DAY_RE.test(userText)
  if (explicitlyLate) {
    if (start < 12 * 60) start += 12 * 60
    if (end < 12 * 60) end += 12 * 60
  } else if (!explicitlyEarly) {
    const sameDayEnd = Math.min(doc.rangeEnd, 24 * 60)
    const afternoonStart = start + 12 * 60
    const afternoonEnd = end + 12 * 60
    if (start < doc.rangeStart && afternoonStart >= doc.rangeStart && afternoonEnd <= sameDayEnd) {
      start = afternoonStart
      end = afternoonEnd
    }
  }
  return normalizeSpan(start, end, doc.rangeStart)
}

export function validateEntry(raw: unknown, doc: TimelineDoc, userText?: string): ResponseResult {
  if (raw === null || typeof raw !== "object") {
    return { ok: false, reason: t("returnedNotObject") }
  }
  const obj = raw as Record<string, unknown>
  if (typeof obj.error === "string") {
    return { ok: false, reason: obj.error }
  }
  const rawStart = parseClock(obj.start)
  const rawEnd = parseClock(obj.end)
  if (rawStart === null || rawEnd === null) {
    return { ok: false, reason: t("invalidStartEnd") }
  }
  const type = typeof obj.type === "string" ? obj.type.trim() : ""
  if (!/^\S+$/.test(type)) {
    return { ok: false, reason: t("categoryNoWhitespace") }
  }
  const [startMin, endMin] = explicitUserSpan(userText, doc) ?? normalizeSpan(rawStart, rawEnd, doc.rangeStart)
  if (endMin - startMin < 5) {
    return { ok: false, reason: t("durationTooShort") }
  }
  const plan = obj.plan === true
  const note = typeof obj.note === "string" && obj.note.trim() ? obj.note.trim() : undefined
  const sourceLine = formatEntryLine({ plan, startMin, endMin, type, note })
  return { ok: true, entry: { startMin, endMin, type, note, plan, sourceLine } }
}

/** Full pipeline: raw agent text -> validated entry. */
export function interpretResponse(text: string, doc: TimelineDoc, userText?: string): ResponseResult {
  const json = extractJson(text)
  if (json === null) {
    return { ok: false, reason: t("responseMissingJson") }
  }
  return validateEntry(json, doc, userText)
}

export type ResponsesResult =
  | { ok: true; entries: ValidatedEntry[] }
  | { ok: false; reason: string }

/** target = 提示词里「已有色块」列表的编号（1 起，按开始时间排序，plan 除外） */
export type AgentAction =
  | { kind: "create"; entry: ValidatedEntry }
  | { kind: "update"; targetIndex: number; patch: { startMin?: number; endMin?: number; type?: string; note?: string } }
  | { kind: "delete"; targetIndex: number }
  /** A future item for the schedule note (Upcoming.md): a date, optionally a time span or a part of the day. */
  | { kind: "schedule"; date: string; startMin?: number; endMin?: number; zone?: "am" | "pm" | "ev"; type?: string; text: string }

const ZONE_WORDS: Record<string, "am" | "pm" | "ev"> = { am: "am", pm: "pm", ev: "ev", 上午: "am", 早上: "am", 早晨: "am", morning: "am", 下午: "pm", 中午: "pm", afternoon: "pm", 晚上: "ev", 傍晚: "ev", 晚间: "ev", evening: "ev", night: "ev" }

function validDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const d = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : value
}

export type ActionsResult =
  | { ok: true; actions: AgentAction[] }
  | { ok: false; reason: string }

/** 多段描述：一句话多个色块（JSON 数组）；单对象也接受（yyt 2026-08-19）。 */
export function interpretResponses(text: string, doc: TimelineDoc, userText?: string): ResponsesResult {
  const json = extractJson(text)
  if (json === null) {
    const firstLine = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0)
    return { ok: false, reason: firstLine ? t("modelDidNotReturnJson", { detail: firstLine.slice(0, 60) }) : t("responseMissingJson") }
  }
  const list = Array.isArray(json) ? json : [json]
  const entries: ValidatedEntry[] = []
  for (const item of list) {
    const r = validateEntry(item, doc, list.length === 1 ? userText : undefined)
    if (!r.ok) return { ok: false, reason: r.reason }
    entries.push(r.entry)
  }
  return { ok: true, entries: entries.sort((a, b) => a.startMin - b.startMin) }
}

/** 编辑动作管道：create（裸对象）/ update / delete / error，数组混合。 */
export function interpretActions(text: string, doc: TimelineDoc, userText?: string): ActionsResult {
  const json = extractJson(text)
  if (json === null) {
    const firstLine = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0)
    return { ok: false, reason: firstLine ? t("modelDidNotReturnJson", { detail: firstLine.slice(0, 60) }) : t("responseMissingJson") }
  }
  const list = Array.isArray(json) ? json : [json]
  const actions: AgentAction[] = []
  for (const raw of list) {
    if (raw === null || typeof raw !== "object") return { ok: false, reason: t("returnedNotObject") }
    const obj = raw as Record<string, unknown>
    if (typeof obj.error === "string") return { ok: false, reason: obj.error }
    const action = typeof obj.action === "string" ? obj.action : "create"

    if (action === "create") {
      const r = validateEntry(obj, doc, list.length === 1 ? userText : undefined)
      if (!r.ok) return { ok: false, reason: r.reason }
      actions.push({ kind: "create", entry: r.entry })
      continue
    }

    if (action === "schedule") {
      const date = validDate(obj.date)
      if (!date) return { ok: false, reason: t("invalidScheduleDate") }
      const text = typeof obj.text === "string" ? obj.text.trim() : typeof obj.note === "string" ? obj.note.trim() : ""
      const type = typeof obj.type === "string" && obj.type.trim() ? obj.type.trim() : undefined
      if (type && !/^\S+$/.test(type)) return { ok: false, reason: t("categoryNoWhitespace") }
      const zone = typeof obj.zone === "string" ? ZONE_WORDS[obj.zone.trim().toLowerCase()] ?? ZONE_WORDS[obj.zone.trim()] : undefined
      if (obj.start !== undefined || obj.end !== undefined) {
        const startMin = parseClock(obj.start), endMin = parseClock(obj.end)
        if (startMin === null || endMin === null || endMin <= startMin) return { ok: false, reason: t("invalidStartEnd") }
        if (!type) return { ok: false, reason: t("scheduleNeedsType") }
        actions.push({ kind: "schedule", date, startMin, endMin, type, text })
        continue
      }
      if (!text && !type) return { ok: false, reason: t("scheduleNeedsText") }
      actions.push({ kind: "schedule", date, text: text || type!, ...(type ? { type } : {}), ...(zone ? { zone } : {}) })
      continue
    }

    // update / delete 需要 target
    const target = typeof obj.target === "number" ? obj.target : NaN
    const actualCount = doc.entries.filter((e) => !e.plan).length
    if (!Number.isInteger(target) || target < 1 || target > actualCount) {
      return { ok: false, reason: t("targetOutOfRange", { count: actualCount }) }
    }
    if (action === "delete") {
      actions.push({ kind: "delete", targetIndex: target - 1 })
      continue
    }
    if (action === "update") {
      const patch: { startMin?: number; endMin?: number; type?: string; note?: string } = {}
      if (obj.start !== undefined) {
        const v = parseClock(obj.start)
        if (v === null) return { ok: false, reason: t("invalidStart") }
        patch.startMin = v
      }
      if (obj.end !== undefined) {
        const v = parseClock(obj.end)
        if (v === null) return { ok: false, reason: t("invalidEnd") }
        patch.endMin = v
      }
      if (obj.type !== undefined) {
        const category = String(obj.type).trim()
        if (!/^\S+$/.test(category)) return { ok: false, reason: t("categoryNoWhitespace") }
        patch.type = category
      }
      if (obj.note !== undefined) patch.note = String(obj.note).trim()
      if (Object.keys(patch).length === 0) return { ok: false, reason: t("emptyUpdate") }
      actions.push({ kind: "update", targetIndex: target - 1, patch })
      continue
    }
    return { ok: false, reason: t("unknownAction", { action }) }
  }
  return { ok: true, actions }
}
