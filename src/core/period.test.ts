import { describe, expect, it } from "vitest"
import { formatGoalLine, goalProgress, parsePeriodSpec, periodTotals, resolvePeriod, shiftPeriod } from "./period"
import { parseTimeline } from "./parser"
import { formatTodoHeaderValue, parseTodoHeaderValue } from "./todos"

const day = (date: string, source: string) => { const doc = parseTimeline(source); return { date, entries: doc.entries, spans: doc.spans } }

describe("period spec", () => {
  it("parses the three spellings and rejects the rest", () => {
    expect(parsePeriodSpec("this-week")).toEqual({ spec: "this-week", kind: "this-week" })
    expect(parsePeriodSpec("2026-09-30..2026-10-04")).toMatchObject({ kind: "range", start: "2026-09-30", end: "2026-10-04" })
    expect(parsePeriodSpec("2026-09-30 +3")).toMatchObject({ kind: "range", start: "2026-09-30", end: "2026-10-02" })
    expect(parsePeriodSpec("2026-10-04..2026-09-30")).toBeNull()
    expect(parsePeriodSpec("next week")).toBeNull()
    expect(parsePeriodSpec("2026-01-01..2026-12-31")).toBeNull()
  })

  it("resolves this-week around today and pages by its own length", () => {
    const week = resolvePeriod({ spec: "this-week", kind: "this-week" }, "2026-09-30")
    expect(week.start).toBe("2026-09-28"); expect(week.end).toBe("2026-10-04"); expect(week.days).toHaveLength(7)
    const next = shiftPeriod({ spec: "this-week", kind: "this-week" }, "2026-09-30", 1)
    expect(next).toMatchObject({ kind: "range", start: "2026-10-05", end: "2026-10-11" })
    expect(shiftPeriod(next, "2026-09-30", -1)).toEqual({ spec: "this-week", kind: "this-week" })
    const three = parsePeriodSpec("2026-09-30 +3")!
    expect(shiftPeriod(three, "2026-09-30", 1)).toMatchObject({ start: "2026-10-03", end: "2026-10-05" })
  })

  it("measures goals by category or tag, counting spans for tags and never plans", () => {
    const days = [
      day("2026-09-28", "09:00-10:00 运动\nplan 10:00-11:00 运动\n@12:00-12:30 #飞搜"),
      day("2026-09-29", "09:00-09:30 运动 #飞搜 跑步"),
    ]
    const doc = parseTimeline('days: this-week\ngoal: type="运动" target=120\ngoal: tag="飞搜" target=60\n---')
    expect(doc.errors).toEqual([])
    expect(doc.period?.kind).toBe("this-week")
    const progress = goalProgress(doc.goals, days)
    expect(progress.map((p) => [p.goal.key, p.doneMinutes, p.complete])).toEqual([["运动", 90, false], ["飞搜", 60, true]])
    expect(periodTotals(days)).toEqual([{ type: "运动", minutes: 90 }])
    expect(formatGoalLine(doc.goals[1])).toBe('goal: tag="飞搜" target=60')
  })

  it("reports bad days: and goal: headers without giving up the block", () => {
    const doc = parseTimeline('days: someday\ngoal: type="运动"\ngoal: type="a" tag="b" target=1\n---\n09:00-10:00 开发')
    expect(doc.errors).toHaveLength(3)
    expect(doc.entries).toHaveLength(1)
    expect(doc.period).toBeUndefined()
  })
})

describe("todo layouts and buckets (phase 4)", () => {
  it("round-trips layout= and bucket= and keeps old headers valid", async () => {
    const { formatTodoViewHeaderValue, parseTodoViewHeaderValue } = await import("./todos")
    expect(parseTodoViewHeaderValue("group=none sort=manual")).toEqual({ groupBy: "none", sortBy: "manual" })
    const abc = parseTodoViewHeaderValue("group=none sort=manual layout=abc")!
    expect(abc.layout).toBe("abc")
    expect(formatTodoViewHeaderValue(abc)).toBe("group=none sort=manual layout=abc")
    expect(formatTodoViewHeaderValue({ groupBy: "none", sortBy: "manual", layout: "list" })).toBe("group=none sort=manual")
    expect(parseTodoViewHeaderValue("group=none sort=manual layout=kanban")).toBeNull()
    const todo = parseTodoHeaderValue('id="t" done=false estimate=30 category="" group="" bucket="q2" title="读书"', 0)!
    expect(todo.bucket).toBe("q2")
    expect(formatTodoHeaderValue(todo)).toContain(' bucket="q2" ')
    expect(formatTodoHeaderValue({ ...todo, bucket: undefined })).not.toContain("bucket")
  })
})

describe("todo due date", () => {
  it("round-trips an optional due= and rejects a malformed one", () => {
    const todo = parseTodoHeaderValue('id="t8" done=false estimate=60 category="写作" group="" due=2026-10-04 title="写周报 #官网"', 3)
    expect(todo).toMatchObject({ id: "t8", due: "2026-10-04", tags: ["官网"] })
    expect(formatTodoHeaderValue(todo!)).toBe('id="t8" done=false estimate=60 category="写作" group="" due=2026-10-04 title="写周报 #官网"')
    expect(parseTodoHeaderValue('id="t8" done=false estimate=60 category="" group="" title="x"', 0)?.due).toBeUndefined()
    expect(parseTodoHeaderValue('id="t8" done=false estimate=60 category="" group="" due=tomorrow title="x"', 0)).toBeNull()
    expect(parseTodoHeaderValue('id="t8" done=false estimate=60 category="" group="" color=red title="x"', 0)).toBeNull()
  })

  it("keeps a moved= shadow and rejects malformed ones", () => {
    const todo = parseTodoHeaderValue('id="t1" done=false estimate=30 category="" group="" moved=2026-10-01 title="回邮件"', 0)
    expect(todo?.moved).toBe("2026-10-01")
    expect(formatTodoHeaderValue(todo!)).toContain(" moved=2026-10-01 ")
    expect(formatTodoHeaderValue({ ...todo!, moved: undefined })).not.toContain("moved=")
    expect(parseTodoHeaderValue('id="t1" done=false estimate=30 category="" group="" moved=soon title="x"', 0)).toBeNull()
  })
})

describe("placing a todo in a cell (phase 4 review B4)", () => {
  it("sets the cell and the position in one change", async () => {
    const { placeTodoInBucket } = await import("../edit/source-rewriter")
    const src = [
      'todo: id="a1" done=false estimate=30 category="" group="" bucket="A" title="a1"',
      'todo: id="b1" done=false estimate=30 category="" group="" bucket="B" title="b1"',
      'todo: id="a2" done=false estimate=30 category="" group="" bucket="A" title="a2"',
      'todo: id="n1" done=false estimate=30 category="" group="" title="n1"',
      "---",
    ].join("\n")
    const order = (s: string) => parseTimeline(s).todos.map((t) => `${t.id}:${t.bucket ?? ""}`)
    expect(order(placeTodoInBucket(src, "n1", "A", "a2"))).toEqual(["a1:A", "b1:B", "n1:A", "a2:A"])
    expect(order(placeTodoInBucket(src, "n1", "A", null))).toEqual(["a1:A", "b1:B", "a2:A", "n1:A"])
    expect(order(placeTodoInBucket(src, "a1", "C", null))).toEqual(["a1:C", "b1:B", "a2:A", "n1:"])
    expect(order(placeTodoInBucket(src, "a2", "A", "a1"))).toEqual(["a2:A", "a1:A", "b1:B", "n1:"])
  })
})
