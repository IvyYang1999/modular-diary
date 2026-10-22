import type { Entry } from "./types"

export type HabitSchedule =
  | { kind: "daily" }
  | { kind: "weekdays" }
  | { kind: "weekly"; weekdays: number[] }
  | { kind: "interval"; everyDays: number; anchorDate: string }
  | { kind: "dates"; dates: string[] }

export interface HabitDefinition {
  id: string
  name: string
  type: string
  /** 0 means any positive recorded duration completes the habit. */
  targetMinutes: number
  targetPeriod: "day" | "week"
  /** Legacy rules omit this and therefore remain duration goals. */
  targetMetric?: "duration" | "count"
  /** Legacy duration rules are lower-bound goals. `below` is a strict daily upper bound. */
  durationComparison?: "at-least" | "below"
  /** A count goal contributes at most once per calendar day. */
  targetCount?: number
  /** Undefined keeps the legacy behavior: weekly goals repeat every week. */
  repeatWeekly?: boolean
  /** Any date inside the only active natural week when repeatWeekly is false. */
  weekAnchor?: string
  schedule: HabitSchedule
  order: number
  startDate?: string
  endDate?: string
}

export interface HabitProgress {
  /** Checked off by hand (today, or on a day of this week for a weekly goal). */
  manual?: boolean
  minutes: number
  targetMinutes: number
  count?: number
  targetCount?: number
  complete: boolean
  ratio: number
}

export interface HabitDatedEntries {
  date: string
  entries: Entry[]
  habitDone?: string[]
}

function normalizedSchedule(schedule: HabitSchedule | undefined): HabitSchedule {
  if (!schedule) return { kind: "daily" }
  if (schedule.kind === "weekly") {
    const weekdays = [...new Set(schedule.weekdays
      .map(Number)
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    return { kind: "weekly", weekdays }
  }
  if (schedule.kind === "dates") {
    return { kind: "dates", dates: [...new Set(schedule.dates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort() }
  }
  if (schedule.kind === "interval") {
    return {
      kind: "interval",
      everyDays: Math.max(1, Math.round(Number(schedule.everyDays) || 1)),
      anchorDate: /^\d{4}-\d{2}-\d{2}$/.test(schedule.anchorDate) ? schedule.anchorDate : "1970-01-01",
    }
  }
  return schedule.kind === "weekdays" ? { kind: "weekdays" } : { kind: "daily" }
}

/** Runtime migration for settings written before recurrence/count goals existed. */
export function normalizeHabitDefinition(habit: HabitDefinition, fallbackOrder: number): HabitDefinition {
  const targetMetric = habit.targetMetric === "count" ? "count" : "duration"
  const durationComparison = targetMetric === "duration"
    && habit.targetPeriod !== "week"
    && habit.durationComparison === "below"
    ? "below"
    : "at-least"
  return {
    ...habit,
    targetMetric,
    durationComparison: targetMetric === "duration" ? durationComparison : undefined,
    targetMinutes: targetMetric === "count" ? 0 : Math.max(0, Number(habit.targetMinutes) || 0),
    targetCount: targetMetric === "count" ? Math.max(1, Math.round(Number(habit.targetCount) || 1)) : undefined,
    targetPeriod: targetMetric === "count" || habit.targetPeriod === "week" ? "week" : "day",
    schedule: normalizedSchedule(habit.schedule),
    order: Number.isFinite(habit.order) ? habit.order : fallbackOrder,
  }
}

export function orderedHabits<T extends Pick<HabitDefinition, "order">>(habits: T[]): T[] {
  return habits
    .map((habit, index) => ({ habit, index }))
    .sort((a, b) => a.habit.order - b.habit.order || a.index - b.index)
    .map(({ habit }) => habit)
}

/** Reorder only the rows visible on one date while preserving hidden schedules in place. */
export function moveHabitInVisibleOrder(
  habits: HabitDefinition[], visibleIds: string[], id: string, targetIndex: number,
): HabitDefinition[] {
  const global = orderedHabits(habits)
  const byId = new Map(global.map((habit) => [habit.id, habit]))
  const visible = visibleIds.map((visibleId) => byId.get(visibleId)).filter((habit): habit is HabitDefinition => Boolean(habit))
  const from = visible.findIndex((habit) => habit.id === id)
  if (from < 0) return global.map((habit, order) => ({ ...habit, order }))
  const [moved] = visible.splice(from, 1)
  visible.splice(Math.max(0, Math.min(targetIndex, visible.length)), 0, moved)
  const visibleSet = new Set(visibleIds)
  let nextVisible = 0
  return global
    .map((habit) => visibleSet.has(habit.id) ? visible[nextVisible++] ?? habit : habit)
    .map((habit, order) => ({ ...habit, order }))
}

function weekday(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return null
  const value = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(value.getTime()) ? null : value.getDay()
}

function naturalWeekStart(date: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return null
  const value = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (Number.isNaN(value.getTime())) return null
  value.setDate(value.getDate() - ((value.getDay() + 6) % 7))
  const part = (number: number): string => String(number).padStart(2, "0")
  return `${value.getFullYear()}-${part(value.getMonth() + 1)}-${part(value.getDate())}`
}

function epochDay(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return null
  const value = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(value) ? null : Math.floor(value / 86_400_000)
}

export function isHabitDue(habit: HabitDefinition, date: string): boolean {
  if (habit.startDate && date < habit.startDate) return false
  if (habit.endDate && date > habit.endDate) return false
  const day = weekday(date)
  if (day === null) return false
  if (habit.targetPeriod === "week") {
    if (habit.repeatWeekly !== false) return true
    const activeWeek = habit.weekAnchor ? naturalWeekStart(habit.weekAnchor) : null
    return activeWeek !== null && naturalWeekStart(date) === activeWeek
  }
  switch (habit.schedule.kind) {
    case "daily": return true
    case "weekdays": return day >= 1 && day <= 5
    case "weekly": return habit.schedule.weekdays.includes(day)
    case "interval": {
      const current = epochDay(date)
      const anchor = epochDay(habit.schedule.anchorDate)
      if (current === null || anchor === null || current < anchor) return false
      return (current - anchor) % Math.max(1, habit.schedule.everyDays) === 0
    }
    case "dates": return habit.schedule.dates.includes(date)
  }
}

/**
 * A hand check (`habit-done:`) completes a daily goal and counts as one day of
 * a weekly count goal; for a weekly duration goal any hand check in the week
 * completes it. `manualToday` is the rendered day's own check when no dated
 * week is given; with a week, each day's `habitDone` is used instead.
 */
export function habitProgress(
  habit: HabitDefinition,
  entries: Entry[],
  datedEntries: HabitDatedEntries[] = [],
  manualToday = false,
): HabitProgress {
  const matching = (values: Entry[]): Entry[] => values.filter((entry) => !entry.plan && entry.type === habit.type)
  const minutes = matching(entries)
    .reduce((sum, entry) => sum + Math.max(0, entry.endMin - entry.startMin), 0)
  const handDays = datedEntries.filter((item) => item.habitDone?.includes(habit.id)).map((item) => item.date)
  const manual = datedEntries.length > 0 ? handDays.length > 0 : manualToday
  if (habit.targetMetric === "count") {
    const days = datedEntries.length > 0
      ? new Set([...datedEntries.filter((item) => matching(item.entries).length > 0).map((item) => item.date), ...handDays])
      : new Set(matching(entries).length > 0 || manualToday ? ["today"] : [])
    const count = days.size
    const targetCount = Math.max(1, Math.round(Number(habit.targetCount) || 1))
    return {
      ...(manual ? { manual } : {}),
      minutes,
      targetMinutes: 0,
      count,
      targetCount,
      complete: count >= targetCount,
      ratio: Math.min(1, count / targetCount),
    }
  }
  if (manual) return { manual, minutes, targetMinutes: Math.max(0, habit.targetMinutes), complete: true, ratio: 1 }
  const targetMinutes = Math.max(0, habit.targetMinutes)
  const upperBound = habit.durationComparison === "below" && habit.targetPeriod === "day"
  const complete = upperBound
    ? targetMinutes > 0 && minutes < targetMinutes
    : (targetMinutes === 0 ? minutes > 0 : minutes >= targetMinutes)
  const ratio = targetMinutes === 0 ? (complete ? 1 : 0) : Math.min(1, minutes / targetMinutes)
  return { minutes, targetMinutes, complete, ratio }
}
