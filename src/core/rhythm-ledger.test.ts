import { describe, expect, it } from "vitest"
import { parseTimeline } from "./parser"
import { carryOver, ensureRhythmSlots, periodKey, propagateBoundCompletion, rhythmBoard, rhythmsDueIn, scopeContaining, scopeOfRange, shiftScope } from "./rhythm-ledger"
import { insertTodo, setTodoCompleted } from "../edit/source-rewriter"
import { formatGoalLine } from "./period"
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
    // A duration rhythm (学习 3小时) is an accumulation row: sessions, not a slot.
    expect(todos.map((todo) => [todo.rhythm, todo.day ?? ""])).toEqual([["拍口播视频", ""], ["和爸妈出门", ""], ["和爸妈出门", ""], ["心理咨询", "2026-10-27"]])
    expect(todos[3]).toMatchObject({ estimateMin: 60, type: "家人" })
    expect(todos[3].id).toMatch(/^r-[a-z0-9]+-1$/)
    expect(ensureRhythmSlots(once, rhythms, week)).toBe(once)
    // The biweekly one is off next week, and a skipped rhythm gets no slot.
    const next = ensureRhythmSlots("days: 2026-11-02..2026-11-08\nrhythm-skip: 拍口播视频\n---", rhythms, shiftScope(week, 1))
    expect(parseTimeline(next).todos.map((todo) => todo.rhythm)).toEqual(["和爸妈出门", "和爸妈出门"])
  })
  it("carries open slots into the next period and shadows them in the old one", () => {
    let prev = ensureRhythmSlots("days: 2026-10-19..2026-10-25\n---", rhythms, shiftScope(week, -1))
    // The video slot was done last week; the two outings were not.
    prev = prev.replace(/- \[ \] (todo: id="[^"]+"[^\n]*rhythm="拍口播视频")/, "- [x] $1")
    const here = ensureRhythmSlots("days: 2026-10-26..2026-11-01\n---", rhythms, week)
    const carried = carryOver(here, prev, rhythms, week, "2026-W43")
    const owed = parseTimeline(carried.source).todos.filter((todo) => todo.owed)
    expect(owed.map((todo) => [todo.rhythm, todo.owed])).toEqual([["和爸妈出门", "2026-W43"], ["和爸妈出门", "2026-W43"]])
    expect(parseTimeline(carried.prevSource).todos.filter((todo) => todo.moved).map((todo) => todo.rhythm)).toEqual(["和爸妈出门", "和爸妈出门"])
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
    // Without week notes a weekly duration rhythm has no slots yet; the month still knows how many weeks it is due.
    // Accumulation over the month: the weekly 3h times the six weeks it spans.
    expect(month.find((item) => item.rhythm.id === "学习")).toMatchObject({ slots: [], due: 0, targetMinutes: 180 * 6 })
  })
})

describe("slot pruning", () => {
  it("drops untouched surplus slots when a quota shrinks, keeps placed or ticked ones, and removes a deleted rhythm's slots", () => {
    const six = parseRhythms("- 每周 6次 心理咨询 @家人\n- 每周 散步")
    let source = ensureRhythmSlots("days: 2026-10-26..2026-11-01\n---", six, week)
    expect(parseTimeline(source).todos.filter((todo) => todo.rhythm === "心理咨询")).toHaveLength(6)
    // One slot placed on a day, one ticked: they survive the cut to 1次.
    const ids = parseTimeline(source).todos.filter((todo) => todo.rhythm === "心理咨询").map((todo) => todo.id)
    source = source.replace(new RegExp(`id="${ids[0]}"`), `id="${ids[0]}" day=2026-10-27`).replace(new RegExp(`- \\[ \\] (todo: id="${ids[1]}")`), "- [x] $1")
    const one = parseRhythms("- 每周 心理咨询 @家人")
    const pruned = parseTimeline(ensureRhythmSlots(source, one, week)).todos
    expect(pruned.filter((todo) => todo.rhythm === "心理咨询").map((todo) => todo.id)).toEqual([ids[0], ids[1]])
    expect(pruned.some((todo) => todo.rhythm === "散步")).toBe(false)
  })
})

describe("early carry-over", () => {
  it("is undone: the shadows come back and the owed copies go", async () => {
    const { undoEarlyCarry } = await import("./rhythm-ledger")
    const here = ensureRhythmSlots("days: 2026-10-26..2026-11-01\n---", rhythms, week)
    const next = ensureRhythmSlots("days: 2026-11-02..2026-11-08\n---", rhythms, shiftScope(week, 1))
    const carried = carryOver(next, here, rhythms, shiftScope(week, 1), "2026-W44")
    expect(parseTimeline(carried.prevSource).todos.filter((todo) => todo.moved).length).toBeGreaterThan(0)
    const undone = undoEarlyCarry(carried.source, carried.prevSource, shiftScope(week, 1), "2026-W44")
    expect(parseTimeline(undone.prevSource).todos.some((todo) => todo.moved)).toBe(false)
    expect(parseTimeline(undone.source).todos.some((todo) => todo.owed)).toBe(false)
    expect(undone.source).toBe(next)
  })
})

describe("carry-over limits", () => {
  it("never carries more copies than the quota and honours a dropped carry", () => {
    const many = parseRhythms("- 每周 3次 游泳\n- 每周 散步")
    let prev = ensureRhythmSlots("days: 2026-10-19..2026-10-25\n---", many, shiftScope(week, -1))
    const one = parseRhythms("- 每周 游泳\n- 每周 散步")
    const here = ensureRhythmSlots("days: 2026-10-26..2026-11-01\n---", one, week)
    const carried = carryOver(here, prev, one, week, "2026-W43")
    expect(parseTimeline(carried.source).todos.filter((todo) => todo.owed && todo.rhythm === "游泳")).toHaveLength(1)
    const dropped = carryOver(here.replace("---", "rhythm-drop: 散步@2026-W43\n---"), prev, one, week, "2026-W43")
    expect(parseTimeline(dropped.source).todos.some((todo) => todo.owed && todo.rhythm === "散步")).toBe(false)
  })
})

describe("a weekly rhythm with a start date", () => {
  const started = parseRhythms("- 每周 泡脚 @玩耍 自2026-10-28")
  it("is not due in the weeks before it, and a month counts only the weeks it is on", () => {
    expect(rhythmsDueIn(started, scopeContaining("week", "2026-10-20"))).toEqual([])
    expect(rhythmsDueIn(started, week).map((item) => item.id)).toEqual(["泡脚"])
    expect(ensureRhythmSlots("days: 2026-10-19..2026-10-25\n---", started, scopeContaining("week", "2026-10-20"))).not.toContain("泡脚")
    // October: only the week of the 26th is on; September does not list it at all.
    expect(rhythmBoard(started, scopeContaining("month", "2026-10-05"), [], [], []).find((item) => item.rhythm.id === "泡脚")).toMatchObject({ due: 1, unit: "times" })
    expect(rhythmBoard(started, scopeContaining("month", "2026-09-05"), [], [], [])).toEqual([])
  })
  it("prunes the slot an earlier week got before the start date was set", () => {
    const early = scopeContaining("week", "2026-10-20")
    const before = ensureRhythmSlots("days: 2026-10-19..2026-10-25\n---", parseRhythms("- 每周 泡脚 @玩耍"), early)
    expect(before).toContain('rhythm="泡脚"')
    expect(ensureRhythmSlots(before, started, early)).not.toContain('rhythm="泡脚"')
  })
})

describe("a daily limit", () => {
  it("is judged only on days with actual records: a day that only has plans is not stamped", () => {
    const limited = parseRhythms("- 每天 1小时以下 消费 @消费")
    const days = [
      { date: "2026-10-26", entries: [entry("消费", 600, 700)] },
      { date: "2026-10-27", entries: [entry("消费", 600, 630)] },
      { date: "2026-10-30", entries: [entry("消费", 600, 630, true), entry("学习", 700, 800, true)] },
    ]
    expect(rhythmBoard(limited, week, [], days, [])[0]).toMatchObject({ limit: true, due: 7, done: 1 })
  })
})

describe("bound todos and their rhythm slot", () => {
  const rhythm = parseRhythms("- 每周 参加一次线下AI活动 @出门")
  const base = ensureRhythmSlots("days: 2026-10-26..2026-11-01\n---", rhythm, week)
  const slot = parseTimeline(base).todos[0]
  const withBound = insertTodo(base, { id: "t1", title: "参加Tab宣讲", group: "", type: "出门", estimateMin: 240, completed: false, under: rhythm[0].id })
  it("completes the slot when every bound todo is done, and reopens it when one is reopened", () => {
    const done = propagateBoundCompletion(setTodoCompleted(withBound, "t1", true), "t1")
    expect(parseTimeline(done).todos.find((item) => item.id === slot.id)?.completed).toBe(true)
    const undone = propagateBoundCompletion(setTodoCompleted(done, "t1", false), "t1")
    expect(parseTimeline(undone).todos.find((item) => item.id === slot.id)?.completed).toBe(false)
  })
  it("ticks a text goal when its bound todos are all done and unticks it when one is reopened", () => {
    const goalSource = `days: 2026-10-26..2026-11-01\n${formatGoalLine({ kind: "text", key: "搬家", targetMinutes: 0, id: "g1" })}\n---`
    const bound = insertTodo(goalSource, { id: "t2", title: "打包", group: "", type: "", estimateMin: 0, completed: false, goal: "g1" })
    const done = propagateBoundCompletion(setTodoCompleted(bound, "t2", true), "t2")
    expect(done).toContain("done=true")
    const undone = propagateBoundCompletion(setTodoCompleted(done, "t2", false), "t2")
    expect(undone).not.toContain("done=true")
  })
})

describe("sub-goals and daily ticks from bound todos", () => {
  it("ticks a parent goal when its sub-goals and bound todos are all done, and unticks it again", async () => {
    const { propagateGoalCompletion } = await import("./rhythm-ledger")
    const { replaceEntryLine } = await import("../edit/source-rewriter")
    const source = ['days: 2026-10-26..2026-11-01', 'goal: text="大" id="g-p"', 'goal: text="小一" id="g-c1" parent="g-p"', 'goal: text="小二" id="g-c2" parent="g-p" done=true', '---'].join("\n")
    const ticked = replaceEntryLine(source, 2, 'goal: text="小一" id="g-c1" parent="g-p" done=true')
    const out = propagateGoalCompletion(ticked, "g-c1")
    expect(out).toContain('goal: text="大" id="g-p" done=true')
    const unticked = replaceEntryLine(out, 2, 'goal: text="小一" id="g-c1" parent="g-p"')
    expect(propagateGoalCompletion(unticked, "g-c1")).toContain('goal: text="大" id="g-p"\n')
  })
  it("counts a ticked todo under a daily rhythm as that day's stamp", () => {
    const daily = parseRhythms("- 每天 运动 @运动")
    const todos = [{ id: "t1", title: "跑步", group: "", type: "运动", estimateMin: 30, completed: true, under: "运动", day: "2026-10-28", line: 0 }] as unknown as Parameters<typeof rhythmBoard>[2]
    expect(rhythmBoard(daily, week, todos, [], [])[0]).toMatchObject({ due: 7, done: 1 })
  })
})
