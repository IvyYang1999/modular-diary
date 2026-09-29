import { describe, expect, it } from "vitest"
import { composerDefaults, hourlogItems, linkableEntries, parseClock } from "./hourlog"
import { parseTimeline } from "./parser"

const doc = parseTimeline([
  "date: 2026-09-30",
  "---",
  "plan 09:00-12:00 开发",
  "09:15-11:40 开发 #模块日记 周视图",
  "  days 头解析 + 列渲染。",
  "12:00-12:45 吃饭",
  "@12:45-13:00 #飞搜",
  "  回 issue",
  "@13:10-13:30",
  "14:00-16:00 开发 跨天拖放",
].join("\n"))

describe("hour diary model", () => {
  it("lists block bodies and spans in time order, never plans", () => {
    const items = hourlogItems(doc)
    expect(items.map((i) => [i.kind, i.startMin, i.body])).toEqual([
      ["entry", 555, "days 头解析 + 列渲染。"],
      ["span", 765, "回 issue"],
      ["span", 790, ""],
    ])
    expect(items[0]).toMatchObject({ type: "开发", note: "#模块日记 周视图", tags: ["模块日记"] })
    expect(items[1]).toMatchObject({ note: "#飞搜", tags: ["飞搜"] })
  })

  it("offers only actual blocks without a diary to hang a new piece on", () => {
    expect(linkableEntries(doc).map((e) => e.startMin)).toEqual([720, 840])
  })

  it("starts a new piece where the last one ended and ends it now", () => {
    const items = hourlogItems(doc)
    expect(composerDefaults(items, 17 * 60 + 12)).toEqual({ startMin: 13 * 60 + 30, endMin: 17 * 60 + 10 })
    expect(composerDefaults([], 17 * 60 + 40)).toEqual({ startMin: 17 * 60, endMin: 17 * 60 + 40 })
    expect(composerDefaults([], 17 * 60 + 5)).toEqual({ startMin: 16 * 60, endMin: 17 * 60 + 5 })
    // A last piece from long ago does not stretch a new one across the day.
    expect(composerDefaults(items.slice(0, 1), 22 * 60)).toEqual({ startMin: 21 * 60, endMin: 22 * 60 })
  })

  it("reads clock inputs leniently", () => {
    expect(parseClock("9:05")).toBe(545)
    expect(parseClock(" 17：30 ")).toBe(1050)
    expect(parseClock("25:00")).toBe(1500)
    expect(parseClock("17:60")).toBeNull()
    expect(parseClock("5pm")).toBeNull()
  })
})
