/**
 * A period block (`days:`) is a view over a run of days plus the period's
 * own goals and unscheduled todos. Pure helpers: spec parsing, resolving the
 * spec to dates for a given "today", paging, goal progress and totals.
 */
import { shiftDate } from "./daily-notes"
import type { Entry, PeriodGoal, PeriodSpec, SpanNote } from "./types"

const DATE = /^\d{4}-\d{2}-\d{2}$/
const RANGE_RE = /^(\d{4}-\d{2}-\d{2})\s*\.\.\s*(\d{4}-\d{2}-\d{2})$/
const PLUS_RE = /^(\d{4}-\d{2}-\d{2})\s*\+\s*(\d{1,3})$/
/** Longest run a period may span; anything larger is a mistake, not a plan. */
export const MAX_PERIOD_DAYS = 62

export function parsePeriodSpec(value: string): PeriodSpec | null {
  const spec = value.trim()
  if (spec === "this-week") return { spec, kind: "this-week" }
  const range = RANGE_RE.exec(spec)
  if (range) {
    const [, start, end] = range
    if (end < start || daysBetween(start, end) + 1 > MAX_PERIOD_DAYS) return null
    return { spec, kind: "range", start, end }
  }
  const plus = PLUS_RE.exec(spec)
  if (plus) {
    const count = Number(plus[2])
    if (count < 1 || count > MAX_PERIOD_DAYS) return null
    return { spec, kind: "range", start: plus[1], end: shiftDate(plus[1], count - 1) }
  }
  return null
}

export function formatPeriodSpec(period: PeriodSpec): string {
  return period.kind === "this-week" ? "this-week" : `${period.start}..${period.end}`
}

export interface ResolvedPeriod {
  start: string
  end: string
  days: string[]
}

export function mondayOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number)
  const value = new Date(y, m - 1, d)
  return shiftDate(date, -((value.getDay() + 6) % 7))
}

function daysBetween(start: string, end: string): number {
  const [ys, ms, ds] = start.split("-").map(Number)
  const [ye, me, de] = end.split("-").map(Number)
  return Math.round((new Date(ye, me - 1, de).getTime() - new Date(ys, ms - 1, ds).getTime()) / 86_400_000)
}

export function resolvePeriod(period: PeriodSpec, today: string): ResolvedPeriod {
  const start = period.kind === "this-week" ? mondayOf(today) : period.start!
  const end = period.kind === "this-week" ? shiftDate(start, 6) : period.end!
  const days: string[] = []
  for (let d = start; d <= end; d = shiftDate(d, 1)) days.push(d)
  return { start, end, days }
}

/** Page by the period's own length; landing back on the current week restores `this-week`. */
export function shiftPeriod(period: PeriodSpec, today: string, direction: 1 | -1): PeriodSpec {
  const current = resolvePeriod(period, today)
  const length = current.days.length
  const start = shiftDate(current.start, direction * length)
  const end = shiftDate(current.end, direction * length)
  if (length === 7 && start === mondayOf(today)) return { spec: "this-week", kind: "this-week" }
  return { spec: `${start}..${end}`, kind: "range", start, end }
}

export interface PeriodDay {
  date: string
  entries: Entry[]
  spans: SpanNote[]
}

export interface GoalProgress {
  goal: PeriodGoal
  doneMinutes: number
  ratio: number
  complete: boolean
}

/** Actual (not plan) minutes inside the period that count toward each goal. */
export function goalProgress(goals: PeriodGoal[], days: PeriodDay[]): GoalProgress[] {
  return goals.map((goal) => {
    let doneMinutes = 0
    for (const day of days) {
      for (const entry of day.entries) {
        if (entry.plan) continue
        if (goal.kind === "type" ? entry.type === goal.key : entry.tags.includes(goal.key)) doneMinutes += entry.endMin - entry.startMin
      }
      if (goal.kind === "tag") for (const span of day.spans) if (span.tags.includes(goal.key)) doneMinutes += span.endMin - span.startMin
    }
    return { goal, doneMinutes, ratio: Math.min(1, doneMinutes / goal.targetMinutes), complete: doneMinutes >= goal.targetMinutes }
  })
}

/** Actual minutes per category across the period, largest first. */
export function periodTotals(days: PeriodDay[]): Array<{ type: string; minutes: number }> {
  const totals = new Map<string, number>()
  for (const day of days) for (const entry of day.entries) {
    if (entry.plan) continue
    totals.set(entry.type, (totals.get(entry.type) ?? 0) + entry.endMin - entry.startMin)
  }
  return [...totals].map(([type, minutes]) => ({ type, minutes })).sort((a, b) => b.minutes - a.minutes)
}

export function formatGoalLine(goal: Pick<PeriodGoal, "kind" | "key" | "targetMinutes">): string {
  return `goal: ${goal.kind}=${JSON.stringify(goal.key)} target=${Math.max(1, Math.round(goal.targetMinutes))}`
}
