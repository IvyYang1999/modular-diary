import { describe, expect, it } from "vitest"
import { parseTimeline } from "./parser"
import { carryOver, ensureRhythmSlots, periodKey, rhythmBoard, scopeContaining, scopeOfRange, shiftScope } from "./rhythm-ledger"
import { parseRhythms } from "./rhythms"
import type { Entry } from "./types"

const rhythms = parseRhythms([
  "- 每周 拍口播视频 @视频 整天",
  "- 每周 2次 和爸妈出门 @家人",
  "- 每两周 周二 14:00-15:00 心理咨询 @家人 自2026-10-27",
  "- 每周 3小时 学习 @学习",
  "- 每天 30分钟 运动 @运动",
  "- 每天 八段锦",
  "- 每月 独立旅游 @旅行 2-3天",
].join("\n"))
const week = scopeContaining("week", "2026-10-29")
const entry = (type: string, start: number, end: number, plan = false): Entry => ({ type, startMin: start, endMin: end, plan, line: 0 } as unknown as Entry)

describe("period scopes", () => {
  it("finds the week and month around a date and names them", () => {
    expect(week).toEqual({ kind: "week", start: "2026-10-26", end: "2026-11-01" })
    expect(scopeContaining("month", "2026-10-29")).toEqual({ kind: "month", start: "2026-10-01", end: "2026-10-31" })
    expect(periodKey(week)).toBe("2026-W44")
    expect(periodKey(scopeContaining("month", "2026-02-10"))).toBe("2026-02")
    expect(shiftScope(week, -1).start).toBe("2026-10-19")
    expect(shiftScope(scopeContaining("month", "2026-12-05"), 1).start).toBe("2027-01-01")
    expect(scopeOfRange("2026-10-26", "2026-11-01")?.kind).toBe("week")
    expect(scopeOfRange("2026-10-01", "2026-10-31")?.kind).toBe("month")
    expect(scopeOfRange("2026-10-01", "2026-10-20")).toBeNull()
  })
})

describe("rhythm slots", () => {
  it("adds one slot per count for the rhythms due this week, presets a fixed weekday, and is idempotent", () => {
    const once = ensureRhythmSlots("days: 2026-10-26..2026-11-01\n---", rhythms, week)
    const todos = parseTimeline(once).todos
    // A duration rhythm (学习 3小时) gets one session slot too, estimated at its quota.
    expect(todos.map((todo) => [todo.rhythm, todo.day ?? ""])).toEqual([["拍口播视频", ""], ["和爸妈出门", ""], ["和爸妈出门", ""], ["心理咨询", "2026-10-27"], ["学习", ""]])
    expect(todos[3]).toMatchObject({ estimateMin: 60, type: "家人" })
    expect(todos[4]).toMatchObject({ estimateMin: 180, type: "学习" })
    expect(todos[3].id).toMatch(/^r-[a-z0-9]+-1$/)
    expect(ensureRhythmSlots(once, rhythms, week)).toBe(once)
    // The biweekly one is off next week, and a skipped rhythm gets no slot.
    const next = ensureRhythmSlots("days: 2026-11-02..2026-11-08\nrhythm-skip: 拍口播视频\n---", rhythms, shiftScope(week, 1))
    expect(parseTimeline(next).todos.map((todo) => todo.rhythm)).toEqual(["和爸妈出门", "和爸妈出门", "学习"])
  })
  it("carries open slots into the next period and shadows them in the old one", () => {
    let prev = ensureRhythmSlots("days: 2026-10-19..2026-10-25\n---", rhythms, shiftScope(week, -1))
    // The video slot was done last week; the two outings were not.
    prev = prev.replace(/- \[ \] (todo: id="[^"]+"[^\n]*rhythm="拍口播视频")/, "- [x] $1")
    const here = ensureRhythmSlots("days: 2026-10-26..2026-11-01\n---", rhythms, week)
    const carried = carryOver(here, prev, rhythms, week, "2026-W43")
    const owed = parseTimeline(carried.source).todos.filter((todo) => todo.owed)
    expect(owed.map((todo) => [todo.rhythm, todo.owed])).toEqual([["和爸妈出门", "2026-W43"], ["和爸妈出门", "2026-W43"], ["学习", "2026-W43"]])
    expect(parseTimeline(carried.prevSource).todos.filter((todo) => todo.moved).map((todo) => todo.rhythm)).toEqual(["和爸妈出门", "和爸妈出门", "学习"])
    // Running it again changes nothing.
    const again = carryOver(carried.source, carried.prevSource, rhythms, week, "2026-W43")
    expect(again).toEqual(carried)
  })
})

describe("rhythm board", () => {
  it("counts slots, measures daily and duration rhythms, and reads skips", () => {
    const source = ensureRhythmSlots("days: 2026-10-26..2026-11-01\nrhythm-skip: 和爸妈出门\n---", rhythms, week)
    const todos = parseTimeline(source).todos.map((todo) => ({ ...todo, placement: todo.rhythm === "拍口播视频" ? { date: "2026-10-28" } : todo.day ? { date: todo.day } : undefined }))
    const days = [
      { date: "2026-10-26", entries: [entry("运动", 600, 640), entry("学习", 660, 720)], habitDone: ["八段锦"] },
      { date: "2026-10-27", entries: [entry("运动", 600, 620), entry("家人", 840, 900)] },
      { date: "2026-10-28", entries: [entry("视频", 540, 900), entry("学习", 900, 960)], habitDone: ["八段锦"] },
    ]
    const board = rhythmBoard(rhythms, week, todos, days, ["和爸妈出门"])
    const row = (id: string) => board.find((item) => item.rhythm.id === id)!
    expect(row("拍口播视频")).toMatchObject({ due: 1, placed: 1, done: 1 })
    expect(row("和爸妈出门")).toMatchObject({ skipped: true, due: 0 })
    expect(row("心理咨询")).toMatchObject({ due: 1, placed: 1, done: 1 })
    expect(row("学习")).toMatchObject({ minutes: 120, done: 0 })
    expect(row("运动")).toMatchObject({ due: 7, done: 1 })
    expect(row("八段锦")).toMatchObject({ due: 7, done: 2 })
    expect(board.some((item) => item.rhythm.id === "独立旅游")).toBe(false)
    // The month lists every rhythm: its own slots, and the weekly / daily ones summed over its weeks and days.
    const month = rhythmBoard(rhythms, scopeContaining("month", "2026-11-10"), [], days, [])
    expect(month.map((item) => item.rhythm.id)).toEqual(rhythms.map((item) => item.id))
    expect(month.find((item) => item.rhythm.id === "拍口播视频")).toMatchObject({ unit: "times", due: 6, done: 0 })
    expect(month.find((item) => item.rhythm.id === "学习")).toMatchObject({ targetMinutes: 180 * 6, minutes: 0 })
  })
})
