/**
 * Rhythm slots and the protocol board of a period (week or month).
 *
 * A count rhythm due in a period gets one todo "slot" per count in the period
 * block (`rhythm="<id>"`); dragging a slot to a day is the usual `day=` /
 * plan placement. A slot is done when its box is ticked or the day it sits on
 * has an actual record of the rhythm's category. Slots left open at the end
 * of a period are carried into the next one (`owed="<period key>"`) and the
 * old ones become shadows (`moved=`), so a commitment never silently lapses.
 * Daily rhythms and duration rhythms do not get slots; the board shows their
 * day count or minutes against the quota.
 */
import { isHabitDue } from "./habits"
import { insertTodo, setHeaderValue, updateTodo } from "../edit/source-rewriter"
import { parseTimeline } from "./parser"
import { rhythmToHabit, rhythmWeekOn, type Rhythm } from "./rhythms"
import { shiftDate } from "./daily-notes"
import type { Entry, TodoItem } from "./types"

export type PeriodScopeKind = "week" | "month"
export interface PeriodScope { kind: PeriodScopeKind; start: string; end: string }

export interface PeriodDayFacts {
  date: string
  entries: Entry[]
  habitDone?: string[]
}

export interface RhythmSlotView extends TodoItem {
  placement?: { date: string; startMin?: number }
  /** Done by its box, or by a record of the category on its day. */
  done: boolean
}

export interface RhythmBoardRow {
  rhythm: Rhythm
  /** Count rhythms: one entry per slot. Daily / duration rhythms: empty. */
  slots: RhythmSlotView[]
  /** Count rhythms: slots due this period (quota + carried). Daily: due days. Duration: 0. */
  due: number
  /** Count: placed slots. Daily: days done. */
  placed: number
  /** Count: done slots. Daily: days done. */
  done: number
  /** Duration rhythms: minutes recorded against the quota. */
  minutes: number
  /** Slots carried over from earlier periods. */
  owed: number
  skipped: boolean
}

export function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

export function scopeContaining(kind: PeriodScopeKind, date: string): PeriodScope {
  if (kind === "week") {
    const start = mondayOf(date)
    return { kind, start, end: shiftDate(start, 6) }
  }
  const start = `${date.slice(0, 7)}-01`
  const next = new Date(`${start}T00:00:00Z`)
  next.setUTCMonth(next.getUTCMonth() + 1)
  return { kind, start, end: shiftDate(next.toISOString().slice(0, 10), -1) }
}

export function shiftScope(scope: PeriodScope, direction: 1 | -1): PeriodScope {
  return scopeContaining(scope.kind, direction > 0 ? shiftDate(scope.end, 1) : shiftDate(scope.start, -1))
}

/** `2026-W44` / `2026-10`: the key a carried slot names, and the period file's basename. */
export function periodKey(scope: PeriodScope): string {
  if (scope.kind === "month") return scope.start.slice(0, 7)
  const d = new Date(`${scope.start}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 3)
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1)
  const week = Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`
}

/** Week or month when a range is exactly one; null for anything else. */
export function scopeOfRange(start: string, end: string): PeriodScope | null {
  const week = scopeContaining("week", start)
  if (week.start === start && week.end === end) return week
  const month = scopeContaining("month", start)
  if (month.start === start && month.end === end) return month
  return null
}

function daysOf(scope: PeriodScope): string[] {
  const out: string[] = []
  for (let date = scope.start; date <= scope.end; date = shiftDate(date, 1)) out.push(date)
  return out
}

/** Rhythms the board of this period lists: weekly ones in a week, monthly ones in a month; daily ones in a week too. */
export function rhythmsDueIn(rhythms: Rhythm[], scope: PeriodScope): Rhythm[] {
  return rhythms.filter((rhythm) => {
    if (scope.kind === "month") return rhythm.cadence === "monthly"
    if (rhythm.cadence === "monthly") return false
    if (rhythm.cadence === "biweekly") return rhythmWeekOn(rhythm, scope.start)
    return true
  })
}

/** Count rhythms get slots; daily and duration rhythms are measured instead. */
export function takesSlots(rhythm: Rhythm): boolean {
  return rhythm.quota.kind === "count" && rhythm.cadence !== "daily" && rhythm.cadence !== "weekdays"
}

function fixedDay(rhythm: Rhythm, scope: PeriodScope): string | undefined {
  if (rhythm.weekday === undefined || scope.kind !== "week") return undefined
  return daysOf(scope).find((date) => new Date(`${date}T00:00:00Z`).getUTCDay() === rhythm.weekday)
}

/** Todo ids are ASCII; the readable rhythm name travels in `rhythm=`. */
function hash36(text: string): string {
  let hash = 5381
  for (const char of text) hash = ((hash * 33) ^ char.codePointAt(0)!) >>> 0
  return hash.toString(36)
}

export function slotId(rhythm: Rhythm, index: number): string {
  return `r-${hash36(rhythm.id)}-${index}`
}

/**
 * Add the slots this period still lacks. Idempotent: existing slots (ticked,
 * moved or not) count toward the quota; skipped rhythms get none.
 */
export function ensureRhythmSlots(source: string, rhythms: Rhythm[], scope: PeriodScope): string {
  const doc = parseTimeline(source)
  let out = source
  for (const rhythm of rhythmsDueIn(rhythms, scope)) {
    if (!takesSlots(rhythm) || doc.rhythmSkips.includes(rhythm.id)) continue
    const existing = doc.todos.filter((todo) => todo.rhythm === rhythm.id && !todo.owed)
    const day = fixedDay(rhythm, scope)
    const count = rhythm.quota.kind === "count" ? rhythm.quota.count : 0
    for (let index = existing.length + 1; index <= count; index++) {
      out = insertTodo(out, {
        id: slotId(rhythm, index), title: rhythm.name, group: "", type: rhythm.type, completed: false,
        estimateMin: rhythm.startMin !== undefined && rhythm.endMin !== undefined ? rhythm.endMin - rhythm.startMin : 0,
        rhythm: rhythm.id, ...(rhythm.zone ? { zone: rhythm.zone } : {}), ...(day ? { day } : {}),
      })
    }
  }
  return out
}

/** Open, unskipped, not-yet-carried slots of the previous period, by rhythm. */
export function openSlots(prevSource: string, rhythms: Rhythm[]): TodoItem[] {
  const doc = parseTimeline(prevSource)
  const known = new Set(rhythms.map((rhythm) => rhythm.id))
  return doc.todos.filter((todo) => todo.rhythm && known.has(todo.rhythm) && !todo.completed && !todo.moved && !doc.rhythmSkips.includes(todo.rhythm))
}

/**
 * Carry the previous period's open slots into this one: here they become
 * `owed="<prev key>"` slots; there they become shadows (`moved=`).
 */
export function carryOver(source: string, prevSource: string, rhythms: Rhythm[], scope: PeriodScope, prevKey: string): { source: string; prevSource: string } {
  const open = openSlots(prevSource, rhythms)
  if (!open.length) return { source, prevSource }
  const doc = parseTimeline(source)
  let out = source, prev = prevSource
  for (const slot of open) {
    const rhythm = rhythms.find((item) => item.id === slot.rhythm)!
    const already = doc.todos.filter((todo) => todo.rhythm === rhythm.id && todo.owed === prevKey).length
    const carried = doc.todos.filter((todo) => todo.owed === prevKey && todo.rhythm === rhythm.id)
    const needed = open.filter((item) => item.rhythm === rhythm.id).length
    if (carried.length >= needed) { prev = updateTodo(prev, slot.id, { moved: scope.start }); continue }
    const index = doc.todos.filter((todo) => todo.rhythm === rhythm.id).length + already + 1
    out = insertTodo(out, { id: `${slotId(rhythm, index)}-owed`, title: rhythm.name, group: "", type: rhythm.type, completed: false, estimateMin: slot.estimateMin, rhythm: rhythm.id, owed: prevKey, ...(rhythm.zone ? { zone: rhythm.zone } : {}) })
    prev = updateTodo(prev, slot.id, { moved: scope.start })
    doc.todos.push({ ...slot, owed: prevKey, line: -1 })
  }
  return { source: out, prevSource: prev }
}

function recordedOn(day: PeriodDayFacts | undefined, rhythm: Rhythm): number {
  if (!day || !rhythm.type) return 0
  return day.entries.filter((entry) => !entry.plan && entry.type === rhythm.type).reduce((sum, entry) => sum + entry.endMin - entry.startMin, 0)
}

/** The board: every rhythm due in the period with its slots and counts. */
export function rhythmBoard(rhythms: Rhythm[], scope: PeriodScope, todos: Array<TodoItem & { placement?: { date: string; startMin?: number } }>, days: PeriodDayFacts[], skips: string[]): RhythmBoardRow[] {
  const byDate = new Map(days.map((day) => [day.date, day]))
  return rhythmsDueIn(rhythms, scope).map((rhythm) => {
    const skipped = skips.includes(rhythm.id)
    if (takesSlots(rhythm)) {
      const slots: RhythmSlotView[] = todos.filter((todo) => todo.rhythm === rhythm.id && !todo.moved).map((todo) => ({
        ...todo,
        done: todo.completed || Boolean(todo.placement && recordedOn(byDate.get(todo.placement.date), rhythm) > 0),
      }))
      return {
        rhythm, slots, skipped,
        due: slots.length,
        placed: slots.filter((slot) => slot.placement).length,
        done: slots.filter((slot) => slot.done).length,
        minutes: slots.reduce((sum, slot) => sum + (slot.placement ? recordedOn(byDate.get(slot.placement.date), rhythm) : 0), 0),
        owed: slots.filter((slot) => slot.owed).length,
      }
    }
    const habit = rhythmToHabit(rhythm, 0)
    const dueDays = habit ? daysOf(scope).filter((date) => isHabitDue(habit, date)) : daysOf(scope)
    const minutes = dueDays.reduce((sum, date) => sum + recordedOn(byDate.get(date), rhythm), 0)
    if (rhythm.quota.kind === "duration" && rhythm.cadence !== "daily" && rhythm.cadence !== "weekdays") {
      return { rhythm, slots: [], skipped, due: 0, placed: 0, done: minutes >= rhythm.quota.minutes ? 1 : 0, minutes, owed: 0 }
    }
    const target = rhythm.quota.kind === "duration" ? rhythm.quota.minutes : 0
    const doneDays = dueDays.filter((date) => {
      const day = byDate.get(date)
      if (day?.habitDone?.includes(rhythm.id)) return true
      const recorded = recordedOn(day, rhythm)
      return target > 0 ? recorded >= target : recorded > 0
    })
    return { rhythm, slots: [], skipped, due: dueDays.length, placed: doneDays.length, done: doneDays.length, minutes, owed: 0 }
  })
}
