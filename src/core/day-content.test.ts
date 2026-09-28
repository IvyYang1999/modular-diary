import { describe, expect, it } from "vitest"
import { ensureBlockForDate, findBlockForDate } from "./day-content"

describe("block for a day inside a note", () => {
  const two = ["intro", "```timeline", "date: 2026-09-30", "---", "09:00-10:00 开发", "```", "", "```timeline", "date: 2026-10-01", "---", "```", "outro"].join("\n")

  it("prefers the block whose date header matches", () => {
    expect(findBlockForDate(two, "2026-10-01", "随便")?.lineStart).toBe(7)
    expect(findBlockForDate(two, "2026-10-02", "随便")).toBeNull()
  })

  it("accepts a dateless block only when the note name carries that day", () => {
    const dateless = ["```timeline", "09:00-10:00 开发", "```"].join("\n")
    expect(findBlockForDate(dateless, "2026-10-01", "2026.10.1")?.lineStart).toBe(0)
    expect(findBlockForDate(dateless, "2026-10-01", "2026.10.2")).toBeNull()
  })

  it("appends a template block when the day has none, leaving other text alone", () => {
    const out = ensureBlockForDate("# 2026.10.2\n\n随手记\n", "2026-10-02", "2026.10.2", { layout: "timeline@0,0,12,40" })
    expect(out.created).toBe(true)
    expect(out.content).toBe("# 2026.10.2\n\n随手记\n\n```timeline\ndate: 2026-10-02\nlayout: timeline@0,0,12,40\n---\n```\n")
    expect(out.section.source).toBe("date: 2026-10-02\nlayout: timeline@0,0,12,40\n---")
    const again = ensureBlockForDate(out.content, "2026-10-02", "2026.10.2")
    expect(again.created).toBe(false)
    expect(again.content).toBe(out.content)
  })

  it("starts an empty note with just the block", () => {
    expect(ensureBlockForDate("", "2026-10-03", "x").content).toBe("```timeline\ndate: 2026-10-03\n---\n```\n")
  })
})
