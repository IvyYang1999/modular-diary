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
import { deleteTodoSubtree, insertTodo, replaceEntryLine, setHeaderValue, setTodoCompleted, updateTodo } from "../edit/source-rewriter"
import { formatGoalLine } from "./period"
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
  actualMinutes: number
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
  /** What `due` / `done` count: days (daily rhythms) or times (weekly rhythms seen from a month). */
  unit?: "days" | "times"
  /** Duration rhythms: the quota for this period (a weekly quota times the weeks of a month). */
  targetMinutes?: number
  /** Daily upper bound: `done` counts the days that stayed under it. */
  limit?: boolean
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
    // A weekly rhythm with a start date (自2026-10-28) is not due in the weeks before it; a biweekly one every other week after.
    return rhythmWeekOn(rhythm, scope.start)
  })
}

/**
 * Count rhythms (做 N 次) get slots to place on a day. Duration rhythms (累计 N 小时) are
 * accumulation rows: placed as many times as one likes (sessions), measured by hours.
 * Daily ones are measured day by day.
 */
export function takesSlots(rhythm: Rhythm): boolean {
  return rhythm.quota.kind === "count" && rhythm.cadence !== "daily" && rhythm.cadence !== "weekdays"
}

/** The id a duration rhythm's sessions (plan blocks) bind to; the same in every period. */
export function sessionId(rhythm: Rhythm): string {
  return `r-${hash36(rhythm.id)}-s`
}

/** How many slots a period gets: the count, or one session for a duration quota. */
function slotCount(rhythm: Rhythm): number {
  return rhythm.quota.kind === "count" ? rhythm.quota.count : 1
}

/** A planned block for a slot: the fixed time's length, else the quota (a long one starts as an hour). */
function slotEstimate(rhythm: Rhythm): number {
  if (rhythm.startMin !== undefined && rhythm.endMin !== undefined) return rhythm.endMin - rhythm.startMin
  if (rhythm.quota.kind === "duration") return rhythm.quota.minutes <= 180 ? rhythm.quota.minutes : 60
  return 0
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
  // Slots that no longer belong: a rhythm that was deleted, skipped or had its quota lowered.
  // Only untouched ones go (not ticked, not placed, not carried): nothing the user did is lost.
  const untouched = (todo: TodoItem): boolean => !todo.completed && !todo.day && !todo.owed && !todo.moved
  const due = new Map(rhythmsDueIn(rhythms, scope).map((rhythm) => [rhythm.id, rhythm]))
  const byRhythm = new Map<string, TodoItem[]>()
  for (const todo of doc.todos) if (todo.rhythm) byRhythm.set(todo.rhythm, [...(byRhythm.get(todo.rhythm) ?? []), todo])
  for (const [id, slots] of byRhythm) {
    const rhythm = due.get(id)
    const wanted = rhythm && takesSlots(rhythm) && !doc.rhythmSkips.includes(id) ? slotCount(rhythm) : 0
    const surplus = Math.max(0, slots.filter((todo) => !todo.owed && !todo.moved).length - wanted)
    for (const todo of slots.filter(untouched).reverse().slice(0, surplus)) out = deleteTodoSubtree(out, todo.id)
  }
  const current = parseTimeline(out)
  for (const rhythm of rhythmsDueIn(rhythms, scope)) {
    if (!takesSlots(rhythm) || doc.rhythmSkips.includes(rhythm.id)) continue
    const existing = current.todos.filter((todo) => todo.rhythm === rhythm.id && !todo.owed)
    const day = fixedDay(rhythm, scope)
    const count = slotCount(rhythm)
    for (let index = existing.length + 1; index <= count; index++) {
      out = insertTodo(out, {
        id: slotId(rhythm, index), title: rhythm.name, group: "", type: rhythm.type, completed: false,
        estimateMin: slotEstimate(rhythm),
        rhythm: rhythm.id, ...(rhythm.zone ? { zone: rhythm.zone } : {}), ...(day ? { day } : {}),
      })
    }
  }
  return out
}

/**
 * Undo a carry-over made before the previous period had ended (paging ahead
 * used to trigger one): the shadows there come back, the owed copies here go.
 */
export function undoEarlyCarry(source: string, prevSource: string, scope: PeriodScope, prevKey: string): { source: string; prevSource: string } {
  let out = source, prev = prevSource
  for (const todo of parseTimeline(source).todos) if (todo.owed === prevKey && !todo.completed && !todo.day) out = deleteTodoSubtree(out, todo.id)
  for (const todo of parseTimeline(prevSource).todos) if (todo.moved === scope.start) prev = updateTodo(prev, todo.id, { moved: undefined })
  return { source: out, prevSource: prev }
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
  const doc = parseTimeline(source)
  // A carry the user let go of (`rhythm-drop: id@prevKey`) is not made again; stale surplus never multiplies either.
  const open = openSlots(prevSource, rhythms).filter((slot) => !doc.rhythmDrops.includes(`${slot.rhythm}@${prevKey}`))
  if (!open.length) return { source, prevSource }
  let out = source, prev = prevSource
  for (const slot of open) {
    const rhythm = rhythms.find((item) => item.id === slot.rhythm)!
    const already = doc.todos.filter((todo) => todo.rhythm === rhythm.id && todo.owed === prevKey).length
    const carried = doc.todos.filter((todo) => todo.owed === prevKey && todo.rhythm === rhythm.id)
    const needed = Math.min(open.filter((item) => item.rhythm === rhythm.id).length, slotCount(rhythm))
    if (carried.length >= needed) { prev = updateTodo(prev, slot.id, { moved: scope.start }); continue }
    const index = doc.todos.filter((todo) => todo.rhythm === rhythm.id).length + already + 1
    out = insertTodo(out, { id: `${slotId(rhythm, index)}-owed`, title: rhythm.name, group: "", type: rhythm.type, completed: false, estimateMin: slot.estimateMin, rhythm: rhythm.id, owed: prevKey, ...(rhythm.zone ? { zone: rhythm.zone } : {}) })
    prev = updateTodo(prev, slot.id, { moved: scope.start })
    doc.todos.push({ ...slot, owed: prevKey, line: -1 })
  }
  return { source: out, prevSource: prev }
}

/**
 * After a bound todo (`under=` a rhythm, `goal=` a text goal) is toggled: when every
 * todo bound there is done, the rhythm's first open slot completes / the goal ticks;
 * when one is reopened, the slot that completion ticked reopens / the goal unticks.
 * Doing the bound todos is doing the rhythm, so the two never disagree.
 */
export function propagateBoundCompletion(source: string, id: string): string {
  const live = parseTimeline(source)
  const todo = live.todos.find((item) => item.id === id)
  if (!todo) return source
  let out = source
  if (todo.goal) {
    const siblings = live.todos.filter((item) => item.goal === todo.goal && !item.moved)
    const goal = live.goals.find((item) => item.kind === "text" && item.id === todo.goal)
    const subGoalsDone = live.goals.filter((item) => item.kind === "text" && item.parent === todo.goal).every((item) => item.done)
    const allDone = siblings.length > 0 && siblings.every((item) => item.completed) && subGoalsDone
    if (goal && goal.done !== allDone && (allDone || !todo.completed)) {
      out = replaceEntryLine(out, goal.line, formatGoalLine({ ...goal, done: allDone }))
      if (goal.parent) out = propagateGoalCompletion(out, goal.id ?? "")
    }
  }
  if (todo.under) {
    const siblings = live.todos.filter((item) => item.under === todo.under && !item.moved)
    const slots = live.todos.filter((item) => item.rhythm === todo.under && !item.moved)
    if (siblings.length && siblings.every((item) => item.completed)) {
      const open = slots.find((item) => !item.completed)
      if (open) out = setTodoCompleted(out, open.id, true)
    } else if (!todo.completed) {
      // The slot the last tick completed is the last one done; reopen it.
      const done = [...slots].reverse().find((item) => item.completed)
      if (done) out = setTodoCompleted(out, done.id, false)
    }
  }
  return out
}

/**
 * After a written goal's tick changed: each parent above it is done exactly when all
 * of its sub-goals and all of the todos bound to it are done.
 */
export function propagateGoalCompletion(source: string, goalId: string): string {
  let out = source
  let cursor: string | undefined = goalId
  for (let depth = 0; cursor && depth < 20; depth++) {
    const live = parseTimeline(out)
    const goal = live.goals.find((item) => item.kind === "text" && item.id === cursor)
    const parent = goal?.parent ? live.goals.find((item) => item.kind === "text" && item.id === goal.parent) : undefined
    if (!parent) break
    const children = live.goals.filter((item) => item.kind === "text" && item.parent === parent.id)
    const bound = live.todos.filter((item) => item.goal === parent.id && !item.moved)
    const done = children.every((item) => item.done) && bound.every((item) => item.completed) && (children.length > 0 || bound.length > 0)
    if (parent.done !== done) out = replaceEntryLine(out, parent.line, formatGoalLine({ ...parent, done }))
    cursor = parent.id
  }
  return out
}

function recordedOn(day: PeriodDayFacts | undefined, rhythm: Rhythm): number {
  if (!day || !rhythm.type) return 0
  return day.entries.filter((entry) => !entry.plan && entry.type === rhythm.type).reduce((sum, entry) => sum + entry.endMin - entry.startMin, 0)
}

/** Weeks (Mondays) a weekly / biweekly rhythm is on inside a scope. */
function weeksOn(rhythm: Rhythm, scope: PeriodScope): string[] {
  const mondays = [...new Set(daysOf(scope).map(mondayOf))]
  return mondays.filter((monday) => rhythmWeekOn(rhythm, monday))
}

/**
 * The board: every rhythm the period shows, with slots and counts. A week
 * lists its own slots; a month also lists the weekly rhythms (summed over its
 * weeks) and the daily ones, so the month protocol is never empty.
 */
type PlacedTodo = TodoItem & { placement?: { date: string; startMin?: number }; actualMinutes?: number }

export function rhythmBoard(rhythms: Rhythm[], scope: PeriodScope, todos: PlacedTodo[], days: PeriodDayFacts[], skips: string[], weekTodos: PlacedTodo[] = []): RhythmBoardRow[] {
  const byDate = new Map(days.map((day) => [day.date, day]))
  // A month lists every rhythm, except a weekly one that has not started yet (no week of the month is on).
  const shown = scope.kind === "month" ? rhythms.filter((rhythm) => rhythm.cadence !== "weekly" && rhythm.cadence !== "biweekly" || weeksOn(rhythm, scope).length > 0) : rhythmsDueIn(rhythms, scope)
  const recordedIn = (rhythm: Rhythm): number => daysOf(scope).reduce((sum, date) => sum + recordedOn(byDate.get(date), rhythm), 0)
  /** A slot is done when ticked, or (count) its day has a record, or (duration) the period's hours reach the quota. */
  const slotDone = (todo: PlacedTodo, rhythm: Rhythm, minutes: number): boolean => todo.completed
    || (rhythm.quota.kind === "duration" ? minutes >= rhythm.quota.minutes : Boolean(todo.placement && recordedOn(byDate.get(todo.placement.date), rhythm) > 0))
  return shown.map((rhythm) => {
    const skipped = skips.includes(rhythm.id)
    const weekly = rhythm.cadence === "weekly" || rhythm.cadence === "biweekly"
    if (scope.kind === "month" && weekly && rhythm.quota.kind === "duration") {
      // Accumulation over the month: the weekly quota times the weeks it is on.
      const minutes = recordedIn(rhythm)
      const target = rhythm.quota.minutes * Math.max(1, weeksOn(rhythm, scope).length)
      return { rhythm, slots: [], skipped, due: 0, placed: 0, done: minutes >= target ? 1 : 0, minutes, owed: 0, targetMinutes: target }
    }
    if (scope.kind === "month" && weekly) {
      // Seen from the month: the weeks' own slots, as rows one can place on a day of their week.
      const minutes = recordedIn(rhythm)
      const slots: RhythmSlotView[] = weekTodos.filter((todo) => todo.rhythm === rhythm.id && !todo.moved).map((todo) => ({
        ...todo, actualMinutes: todo.actualMinutes ?? 0, done: slotDone(todo, rhythm, minutes),
      }))
      const weeks = weeksOn(rhythm, scope).length
      return {
        rhythm, slots, skipped,
        due: Math.max(slots.length, rhythm.quota.kind === "count" ? rhythm.quota.count * weeks : weeks),
        placed: slots.filter((slot) => slot.placement).length, done: slots.filter((slot) => slot.done).length,
        minutes, owed: slots.filter((slot) => slot.owed).length, unit: "times",
      }
    }
    if (takesSlots(rhythm)) {
      const minutes = recordedIn(rhythm)
      const slots: RhythmSlotView[] = todos.filter((todo) => todo.rhythm === rhythm.id && !todo.moved).map((todo) => ({
        ...todo,
        actualMinutes: todo.actualMinutes ?? 0,
        done: slotDone(todo, rhythm, minutes),
      }))
      return {
        rhythm, slots, skipped,
        due: slots.length,
        placed: slots.filter((slot) => slot.placement).length,
        done: slots.filter((slot) => slot.done).length,
        minutes,
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
    const limit = rhythm.quota.kind === "duration" && rhythm.quota.limit === true
    const doneDays = dueDays.filter((date) => {
      const day = byDate.get(date)
      if (day?.habitDone?.includes(rhythm.id)) return true
      // A todo planned under the rhythm for that day and ticked is that day's tick.
      if (todos.some((todo) => todo.under === rhythm.id && todo.completed && !todo.moved && (todo.placement?.date ?? todo.day) === date)) return true
      const recorded = recordedOn(day, rhythm)
      // A limit is kept when the day's records stay under it; a day with nothing recorded yet (plans are not records) is not judged.
      if (limit) return Boolean(day?.entries.some((entry) => !entry.plan)) && recorded < target
      return target > 0 ? recorded >= target : recorded > 0
    })
    return { rhythm, slots: [], skipped, due: dueDays.length, placed: doneDays.length, done: doneDays.length, minutes, owed: 0, ...(limit ? { limit: true } : {}) }
  })
}
