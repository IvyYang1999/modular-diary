import { describe, expect, it } from "vitest"
import { buildScheduledPlan, schedulePlacement } from "./timeline-schedule-drag"
import { insertEntryLine } from "./source-rewriter"
import { parseTimeline } from "../core/parser"

describe("drag estimated work into the timeline", () => {
  it("snaps the start to five minutes while preserving the authored duration", () => {
    expect(schedulePlacement(9 * 60 + 3, 35, 7 * 60, 23 * 60)).toEqual({
      startMin: 9 * 60 + 5,
      endMin: 9 * 60 + 40,
    })
  })

  it("moves the whole plan upward at the range end instead of shortening it", () => {
    expect(schedulePlacement(22 * 60 + 55, 30, 7 * 60, 23 * 60)).toEqual({
      startMin: 22 * 60 + 30,
      endMin: 23 * 60,
    })
  })

  it("turns an any-record habit into the canonical five-minute minimum block", () => {
    expect(schedulePlacement(9 * 60 + 3, 0, 7 * 60, 23 * 60)).toEqual({
      startMin: 9 * 60 + 5,
      endMin: 9 * 60 + 10,
    })
    expect(buildScheduledPlan({
      source: "habit",
      id: "publish",
      title: "维护 linuxdo 账号",
      type: "发布产品",
      durationMin: 0,
    }, 9 * 60 + 5)).toEqual({
      startMin: 9 * 60 + 5,
      endMin: 9 * 60 + 10,
      line: "plan 09:05-09:10 发布产品 维护 linuxdo 账号",
    })
  })

  it("rejects malformed estimates and work longer than the visible range", () => {
    expect(schedulePlacement(9 * 60, Number.NaN, 7 * 60, 23 * 60)).toBeNull()
    expect(schedulePlacement(9 * 60, 17 * 60, 7 * 60, 23 * 60)).toBeNull()
  })

  it("creates a plan with the source title/category and keeps todo binding", () => {
    expect(buildScheduledPlan({
      source: "todo",
      id: "ship",
      title: "发布 Modular Diary",
      type: "开发",
      durationMin: 30,
    }, 9 * 60 + 5)).toEqual({
      startMin: 9 * 60 + 5,
      endMin: 9 * 60 + 35,
      line: "plan 09:05-09:35 开发 发布 Modular Diary [todo:ship]",
    })
  })

  it("uses the habit name as the note without inventing a todo binding", () => {
    expect(buildScheduledPlan({
      source: "habit",
      id: "read",
      title: "阅读论文",
      type: "阅读",
      durationMin: 45,
    }, 20 * 60)).toEqual({
      startMin: 20 * 60,
      endMin: 20 * 60 + 45,
      line: "plan 20:00-20:45 阅读 阅读论文",
    })
  })

  it("round-trips the scheduled Todo through the canonical Markdown writer", () => {
    const plan = buildScheduledPlan({
      source: "todo", id: "ship", title: "发布 Modular Diary", type: "开发", durationMin: 30,
    }, 9 * 60 + 5)
    const source = insertEntryLine("date: 2026-08-24\n---", plan.line, plan.startMin)

    expect(parseTimeline(source).entries[0]).toMatchObject({
      plan: true,
      startMin: 9 * 60 + 5,
      endMin: 9 * 60 + 35,
      type: "开发",
      note: "发布 Modular Diary",
      todoId: "ship",
    })
  })
})
