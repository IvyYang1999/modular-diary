import { describe, expect, it } from "vitest"
import { habitProgress, isHabitDue, moveHabitInVisibleOrder, normalizeHabitDefinition, orderedHabits, type HabitDefinition } from "./habits"
import type { Entry } from "./types"

const habit = (patch: Partial<HabitDefinition> = {}): HabitDefinition => ({
  id: "walk", name: "散步", type: "运动", targetMinutes: 0,
  schedule: { kind: "daily" }, targetPeriod: "day", order: 0, ...patch,
})

const entry = (patch: Partial<Entry> = {}): Entry => ({
  plan: false, startMin: 9 * 60, endMin: 9 * 60 + 20,
  type: "运动", tags: [], line: 4, ...patch,
})

describe("habit recurrence and progress", () => {
  it("supports daily, weekdays, weekly weekdays, explicit dates, and date bounds", () => {
    expect(isHabitDue(habit(), "2026-08-23")).toBe(true)
    expect(isHabitDue(habit({ schedule: { kind: "weekdays" } }), "2026-08-23")).toBe(false)
    expect(isHabitDue(habit({ schedule: { kind: "weekdays" } }), "2026-08-24")).toBe(true)
    expect(isHabitDue(habit({ schedule: { kind: "weekly", weekdays: [0, 3] } }), "2026-08-23")).toBe(true)
    expect(isHabitDue(habit({ schedule: { kind: "weekly", weekdays: [0, 3] } }), "2026-08-24")).toBe(false)
    expect(isHabitDue(habit({ schedule: { kind: "dates", dates: ["2026-08-25"] } }), "2026-08-25")).toBe(true)
    expect(isHabitDue(habit({ startDate: "2026-08-24" }), "2026-08-23")).toBe(false)
    expect(isHabitDue(habit({ endDate: "2026-08-22" }), "2026-08-23")).toBe(false)
  })

  it("supports every-N-days recurrence from a stable anchor date", () => {
    const everyThreeDays = habit({
      schedule: { kind: "interval", everyDays: 3, anchorDate: "2026-08-23" },
    })
    expect(isHabitDue(everyThreeDays, "2026-08-22")).toBe(false)
    expect(isHabitDue(everyThreeDays, "2026-08-23")).toBe(true)
    expect(isHabitDue(everyThreeDays, "2026-08-24")).toBe(false)
    expect(isHabitDue(everyThreeDays, "2026-08-26")).toBe(true)
    expect(isHabitDue(everyThreeDays, "2026-08-29")).toBe(true)
  })

  it("counts actual matching records, not plans, and supports any-duration or threshold completion", () => {
    const entries = [entry(), entry({ plan: true, startMin: 600, endMin: 660 }), entry({ type: "阅读" })]
    expect(habitProgress(habit(), entries)).toEqual({ minutes: 20, targetMinutes: 0, complete: true, ratio: 1 })
    expect(habitProgress(habit({ targetMinutes: 30 }), entries)).toEqual({
      minutes: 20, targetMinutes: 30, complete: false, ratio: 2 / 3,
    })
  })

  it("completes a daily upper-bound goal only while matching recorded minutes stay strictly below the limit", () => {
    const belowThirty = habit({ targetMinutes: 30, durationComparison: "below" })
    expect(habitProgress(belowThirty, [])).toEqual({
      minutes: 0, targetMinutes: 30, complete: true, ratio: 0,
    })
    expect(habitProgress(belowThirty, [entry(), entry({ plan: true, startMin: 600, endMin: 900 }), entry({ type: "阅读" })])).toEqual({
      minutes: 20, targetMinutes: 30, complete: true, ratio: 2 / 3,
    })
    expect(habitProgress(belowThirty, [entry({ endMin: 9 * 60 + 30 })])).toEqual({
      minutes: 30, targetMinutes: 30, complete: false, ratio: 1,
    })
    expect(habitProgress(belowThirty, [entry({ endMin: 9 * 60 + 31 })])).toEqual({
      minutes: 31, targetMinutes: 30, complete: false, ratio: 1,
    })
  })

  it("shows weekly targets every day and consumes a pre-filtered whole-week ledger", () => {
    const weekly = habit({ targetMinutes: 120, targetPeriod: "week", schedule: { kind: "weekdays" } })
    expect(isHabitDue(weekly, "2026-08-23")).toBe(true)
    expect(habitProgress(weekly, [entry(), entry({ startMin: 600, endMin: 700 })])).toMatchObject({
      minutes: 120, complete: true, ratio: 1,
    })
  })

  it("keeps one-off weekly targets inside the anchored natural week", () => {
    const weekly = habit({
      targetMinutes: 120,
      targetPeriod: "week",
      repeatWeekly: false,
      weekAnchor: "2026-08-19",
    })
    expect(isHabitDue(weekly, "2026-08-17")).toBe(true)
    expect(isHabitDue(weekly, "2026-08-23")).toBe(true)
    expect(isHabitDue(weekly, "2026-08-24")).toBe(false)
    expect(isHabitDue({ ...weekly, repeatWeekly: true }, "2026-08-24")).toBe(true)
  })

  it("counts weekly completions by distinct calendar day and ignores plans", () => {
    const weeklyCount = habit({
      targetMetric: "count",
      targetCount: 3,
      targetPeriod: "week",
    })
    const dated = [
      { date: "2026-08-17", entries: [entry(), entry({ startMin: 700, endMin: 720 })] },
      { date: "2026-08-18", entries: [entry({ plan: true })] },
      { date: "2026-08-19", entries: [entry()] },
    ]
    expect(habitProgress(weeklyCount, dated.flatMap((day) => day.entries), dated)).toEqual({
      minutes: 60,
      targetMinutes: 0,
      count: 2,
      targetCount: 3,
      complete: false,
      ratio: 2 / 3,
    })
  })

  it("normalizes legacy rules without losing selected weekdays or calendar dates", () => {
    expect(normalizeHabitDefinition(habit({ schedule: { kind: "weekly", weekdays: [1, 3, 5] } }), 4))
      .toMatchObject({ targetMetric: "duration", durationComparison: "at-least", schedule: { kind: "weekly", weekdays: [1, 3, 5] }, order: 0 })
    expect(normalizeHabitDefinition(habit({ schedule: { kind: "dates", dates: ["2026-08-23"] } }), 4))
      .toMatchObject({ targetMetric: "duration", durationComparison: "at-least", schedule: { kind: "dates", dates: ["2026-08-23"] } })
    expect(normalizeHabitDefinition(habit({ targetMinutes: 30, durationComparison: "below" }), 4))
      .toMatchObject({ targetMetric: "duration", durationComparison: "below", targetPeriod: "day", targetMinutes: 30 })
  })

  it("persists a visible-row drag as global order and restores it after reload", () => {
    const stored = [
      habit({ id: "read", name: "阅读", order: 0 }),
      habit({ id: "weekday", name: "工作日", order: 1, schedule: { kind: "weekdays" } }),
      habit({ id: "sport", name: "运动", order: 2 }),
    ]
    const moved = moveHabitInVisibleOrder(stored, ["read", "sport"], "sport", 0)
    expect(orderedHabits(moved).map((item) => item.id)).toEqual(["sport", "weekday", "read"])

    const reloaded = JSON.parse(JSON.stringify(moved)) as HabitDefinition[]
    expect(orderedHabits(reloaded).map((item) => item.id)).toEqual(["sport", "weekday", "read"])
    expect(orderedHabits(reloaded).map((item) => item.order)).toEqual([0, 1, 2])
  })
})
