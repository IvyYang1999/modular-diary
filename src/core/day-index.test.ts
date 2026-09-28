import { describe, expect, it } from "vitest"
import { DayIndex, extractIndexedBlocks } from "./day-index"

const note = (date: string, body = "09:00-10:00 开发") => ["```timeline", `date: ${date}`, "---", body, "```"].join("\n")

describe("day index", () => {
  it("indexes blocks by explicit date or by the note name", () => {
    const blocks = extractIndexedBlocks("日记/2026.10.1.md", "2026.10.1", ["```timeline", "10:00-11:00 写作 #官网", "  正文", "```", "", "```timeline", "date: 2026-10-02", "todo: id=\"t\" done=false estimate=30 category=\"\" group=\"\" title=\"x\"", "---", "```"].join("\n"))
    expect(blocks.map((b) => [b.date, b.ordinal])).toEqual([["2026-10-01", 0], ["2026-10-02", 1]])
    expect(blocks[0].entries[0].tags).toEqual(["官网"])
    expect(blocks[1].todos[0].id).toBe("t")
    expect(extractIndexedBlocks("杂记.md", "杂记", "```timeline\n09:00-10:00 开发\n```")).toEqual([])
  })

  it("tracks dirt per path and answers date and range queries", () => {
    const index = new DayIndex()
    index.markDirty("a.md"); index.markDirty("b.md")
    expect(index.pending).toEqual(["a.md", "b.md"])
    index.update("a.md", "a", note("2026-09-29"))
    index.update("b.md", "b", note("2026-10-01"))
    expect(index.pending).toEqual([])
    expect(index.blocksInRange("2026-09-28", "2026-10-04").map((b) => b.date)).toEqual(["2026-09-29", "2026-10-01"])
    expect(index.datedEntries()).toHaveLength(2)
    index.rename("b.md", "c.md")
    expect(index.blocksForDate("2026-10-01")).toEqual([])
    expect(index.pending).toEqual(["c.md"])
    index.update("c.md", "c", "no blocks here")
    expect(index.pending).toEqual([])
  })

  it("prefers the note named after the day when several notes hold that day", () => {
    const index = new DayIndex()
    index.update("周记.md", "周记", note("2026-10-01"))
    index.update("日记/2026.10.1.md", "2026.10.1", note("2026-10-01"))
    expect(index.notePathForDate("2026-10-01")).toBe("日记/2026.10.1.md")
    expect(index.notePathForDate("2026-10-09")).toBeNull()
  })
})
