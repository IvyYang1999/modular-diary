import { describe, expect, it } from "vitest"
import { dailyQuoteForDate, parseQuoteLibrary, resolveQuoteInk, serializeQuoteLibrary } from "./daily-quotes"

const quotes = [
  { id: "a", text: "A", author: "", order: 0 },
  { id: "b", text: "B", author: "", order: 1 },
]

describe("daily quotes", () => {
  it("selects the same quote for the same date", () => {
    expect(dailyQuoteForDate(quotes, "2026-08-29")?.id).toBe(dailyQuoteForDate(quotes, "2026-08-29")?.id)
  })

  it("parses one sentence per line with an optional source and highlighter", () => {
    const parsed = parseQuoteLibrary([
      "我们先塑造习惯，然后习惯塑造我们。—— John Dryden #阅读",
      "",
      "成效的关键时刻：13 天，坚持下去。",
      "Keep going — Anonymous",
      "   ",
    ].join("\n"))
    expect(parsed).toHaveLength(3)
    expect(parsed[0]).toMatchObject({ text: "我们先塑造习惯，然后习惯塑造我们。", author: "John Dryden", ink: "阅读", order: 0 })
    expect(parsed[1]).toMatchObject({ text: "成效的关键时刻：13 天，坚持下去。", author: "", order: 1 })
    expect(parsed[1].ink).toBeUndefined()
    expect(parsed[2]).toMatchObject({ text: "Keep going", author: "Anonymous", order: 2 })
  })

  it("keeps ids for sentences that already existed and derives stable ids for new ones", () => {
    const previous = [{ id: "quote-1", text: "旧句子", author: "", order: 0 }]
    const first = parseQuoteLibrary("旧句子\n新句子", previous)
    const again = parseQuoteLibrary("旧句子\n新句子", previous)
    expect(first[0].id).toBe("quote-1")
    expect(first[1].id).toBe(again[1].id)
    expect(first[1].id).not.toBe("quote-1")
  })

  it("round-trips through the serialized library text", () => {
    const library = parseQuoteLibrary("一 —— 甲 #x\n二\n三 —— 丙")
    expect(serializeQuoteLibrary(library)).toBe("一 —— 甲 #x\n二\n三 —— 丙")
    expect(parseQuoteLibrary(serializeQuoteLibrary(library), library)).toEqual(library)
  })

  it("resolves the slot tint from the sentence's ink, then the global ink", () => {
    const colors = { 阅读: "#9bd17b", 运动: "#c8b6e2" }
    expect(resolveQuoteInk({ ink: "阅读" }, "运动", colors)).toBe("#9bd17b")
    expect(resolveQuoteInk({}, "运动", colors)).toBe("#c8b6e2")
    expect(resolveQuoteInk({ ink: "missing" }, "", colors)).toBeNull()
    expect(resolveQuoteInk(null, "", colors)).toBeNull()
  })
})
