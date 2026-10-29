/**
 * One line → a dated todo: "11月15日 下午3点 参加演出 @出门 2小时".
 *
 * Pulls the date, the clock time (or the part of the day), the duration and the
 * category out of the text in that order; whatever is left is the title. Dates
 * may be absolute (2026-11-15, 11月15日, 11/15), relative (今天 / 明天 / 后天 /
 * 大后天 / 3天后) or a weekday (周三 = the next Wednesday, 下周三 = next week's).
 * Without a date the item is for today (the caller may substitute a default).
 */
import { shiftDate } from "./daily-notes"

export type ScheduleZone = "am" | "pm" | "ev"

export interface ParsedSchedule {
  date: string
  /** A date was written; otherwise `date` is the fallback the caller passed. */
  dateExplicit: boolean
  /** Minutes from midnight when a clock time was written. */
  at?: number
  /** Part of the day when only a word like 下午 was written. */
  zone?: ScheduleZone
  estimateMin?: number
  type?: string
  title: string
}

const WEEKDAY_CHARS: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 }
const WEEKDAY_EN = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]
const ZONE_WORDS: Record<string, ScheduleZone> = { 凌晨: "am", 早上: "am", 早晨: "am", 上午: "am", 中午: "pm", 下午: "pm", 傍晚: "pm", 晚上: "ev", 夜里: "ev", 晚: "ev" }
const ZONE_WORD_RE = "凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里"

const pad = (n: number): string => String(n).padStart(2, "0")

function isoDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1 || day > 31) return null
  const value = new Date(Date.UTC(year, month - 1, day))
  if (value.getUTCMonth() !== month - 1) return null
  return `${year}-${pad(month)}-${pad(day)}`
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** Monday of the week that holds `date`. */
function mondayOf(date: string): string {
  return shiftDate(date, -((weekdayOf(date) + 6) % 7))
}

/** The hour read with the Chinese prefix / am-pm suffix applied; a bare 1–6 means the afternoon. */
function resolveHour(hour: number, prefix: string | undefined, suffix: string | undefined): number {
  if (suffix) {
    const pm = suffix.toLowerCase() === "pm"
    if (pm && hour < 12) return hour + 12
    if (!pm && hour === 12) return 0
    return hour
  }
  if (prefix) {
    if ((prefix === "中午" && hour < 11) || (["下午", "傍晚", "晚上", "夜里", "晚"].includes(prefix) && hour < 12)) return hour + 12
    if (prefix === "凌晨" && hour === 12) return 0
    return hour
  }
  return hour >= 1 && hour <= 6 ? hour + 12 : hour
}

export function parseScheduleLine(input: string, today: string): ParsedSchedule | null {
  let text = input.replace(/\s+/g, " ").trim()
  if (!text) return null
  const out: ParsedSchedule = { date: today, dateExplicit: false, title: "" }
  const take = (re: RegExp, use: (m: RegExpExecArray) => void): boolean => {
    const m = re.exec(text)
    if (!m) return false
    use(m)
    text = `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}`.replace(/\s+/g, " ").trim()
    return true
  }
  const setDate = (date: string | null): void => { if (date) { out.date = date; out.dateExplicit = true } }
  const setMonthDay = (month: number, day: number): void => {
    const year = Number(today.slice(0, 4))
    const thisYear = isoDate(year, month, day)
    // A month-day already more than a month behind means next year's.
    setDate(thisYear && thisYear < shiftDate(today, -31) ? isoDate(year + 1, month, day) : thisYear)
  }
  const setWeekday = (target: number, weeksAhead: number): void => {
    if (weeksAhead === 0) setDate(shiftDate(today, (target - weekdayOf(today) + 7) % 7))
    else setDate(shiftDate(mondayOf(today), 7 * weeksAhead + ((target + 6) % 7)))
  }

  // Category: @出门
  take(/(?:^|\s)@(\S+)/, (m) => { out.type = m[1] })

  // Date
  const dated = take(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})[日号]?/, (m) => setDate(isoDate(Number(m[1]), Number(m[2]), Number(m[3]))))
    || take(/(\d{1,2})月(\d{1,2})[日号]?/, (m) => setMonthDay(Number(m[1]), Number(m[2])))
    || take(/(?<![\d:：])(\d{1,2})[/.](\d{1,2})(?![\d:：]|\s*(?:小时|h\b|hr))/i, (m) => setMonthDay(Number(m[1]), Number(m[2])))
    || take(/大后天/, () => setDate(shiftDate(today, 3)))
    || take(/后天/, () => setDate(shiftDate(today, 2)))
    || take(/明天|明日/, () => setDate(shiftDate(today, 1)))
    || take(/今天|今日/, () => setDate(today))
    || take(/(下下|下)?(?:周|星期|礼拜)([一二三四五六日天])/, (m) => setWeekday(WEEKDAY_CHARS[m[2]], m[1] === "下下" ? 2 : m[1] === "下" ? 1 : 0))
    || take(/(\d+)\s*天后/, (m) => setDate(shiftDate(today, Number(m[1]))))
    || take(/\b(today|tomorrow)\b/i, (m) => setDate(m[1].toLowerCase() === "today" ? today : shiftDate(today, 1)))
    || take(/\b(next\s+)?(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/i, (m) => setWeekday(WEEKDAY_EN.indexOf(m[2].toLowerCase()), m[1] ? 1 : 0))
  void dated

  // Duration (before the time, so 2小时 is never read as 2点)
  take(/(\d+)\s*个半小时/, (m) => { out.estimateMin = Number(m[1]) * 60 + 30 })
    || take(/半\s*(?:个)?小时/, () => { out.estimateMin = 30 })
    || take(/(\d+(?:\.\d+)?)\s*(?:个)?\s*(?:小时|hours?|hrs?|h)(?![a-z])(?:\s*(\d+)\s*(?:分钟|分|min))?/i, (m) => { out.estimateMin = Math.round(Number(m[1]) * 60) + (m[2] ? Number(m[2]) : 0) })
    || take(/(\d+)\s*(?:分钟|分|mins?|m)(?![a-z])/i, (m) => { out.estimateMin = Number(m[1]) })

  // Time: a range, a clock time with an optional 上午/下午 prefix or am/pm suffix, or a prefix with a bare hour.
  take(new RegExp(`(${ZONE_WORD_RE})?\\s*(\\d{1,2})[:：](\\d{2})\\s*[-–~到至]\\s*(${ZONE_WORD_RE})?\\s*(\\d{1,2})[:：](\\d{2})`), (m) => {
    const start = resolveHour(Number(m[2]), m[1], undefined) * 60 + Number(m[3])
    let end = resolveHour(Number(m[5]), m[4] ?? m[1], undefined) * 60 + Number(m[6])
    if (end <= start) end += 24 * 60
    out.at = start
    out.estimateMin = end - start
  })
    || take(new RegExp(`(${ZONE_WORD_RE})?\\s*(\\d{1,2})(?:[:：](\\d{2})|点半|点(\\d{1,2})分?|点)\\s*(am|pm)?`, "i"), (m) => {
      const minutes = m[3] !== undefined ? Number(m[3]) : m[4] !== undefined ? Number(m[4]) : m[0].includes("点半") ? 30 : 0
      out.at = resolveHour(Number(m[2]), m[1], m[5]) * 60 + minutes
    })
    || take(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i, (m) => { out.at = resolveHour(Number(m[1]), undefined, m[3]) * 60 + (m[2] ? Number(m[2]) : 0) })
    || take(new RegExp(`(${ZONE_WORD_RE})\\s*(\\d{1,2})(?![\\d:：点月日号/.])`), (m) => { out.at = resolveHour(Number(m[2]), m[1], undefined) * 60 })

  // A part of the day on its own
  take(new RegExp(`(${ZONE_WORD_RE})`), (m) => { if (out.at === undefined) out.zone = ZONE_WORDS[m[1]] })

  const title = text.replace(/^[,，、:：;；\-–\s]+|[,，、:：;；\-–\s]+$/g, "").trim()
  if (!title) return null
  out.title = title
  if (out.at !== undefined && out.estimateMin === undefined) out.estimateMin = 60
  return out
}
