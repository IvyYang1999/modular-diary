import { describe, expect, it } from "vitest"
import { composerDefaults, findLinkable, hourlogItems, linkableEntries, linkOf, locateHourlogItem, parseClock } from "./hourlog"
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

  it("locates a piece by identity, ordinal and text, and refuses on any mismatch", () => {
    const twin = parseTimeline(["---", "@10:00-11:00", "  第一条", "@10:00-11:00", "  第二条"].join("\n"))
    const items = hourlogItems(twin)
    expect(items.map((i) => [i.ordinal, i.line])).toEqual([[0, 1], [1, 3]])
    expect(locateHourlogItem(twin, items[1])).toBe(3)
    expect(locateHourlogItem(twin, { ...items[1], body: "别人改过" })).toBeNull()
    expect(locateHourlogItem(parseTimeline("---\n@10:00-11:00\n  第一条"), items[1])).toBeNull()
  })

  it("links by what a block is, and never to a block that already has a diary", () => {
    const entry = doc.entries.find((e) => e.startMin === 840)!
    expect(findLinkable(doc, linkOf(entry))?.line).toBe(entry.line)
    const first = doc.entries.find((e) => e.startMin === 555)!
    expect(findLinkable(doc, linkOf(first))).toBeUndefined()
  })

  it("reads clock inputs leniently", () => {
    expect(parseClock("9:05")).toBe(545)
    expect(parseClock(" 17：30 ")).toBe(1050)
    expect(parseClock("25:00")).toBe(1500)
    expect(parseClock("17:60")).toBeNull()
    expect(parseClock("5pm")).toBeNull()
  })
})
