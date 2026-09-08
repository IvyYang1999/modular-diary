import { describe, expect, it } from "vitest"
import { estimateTextWidth, wrapTextToWidth } from "./text-wrap"

const measure = (text: string): number => estimateTextWidth(text, 9)

describe("estimateTextWidth", () => {
  it("counts CJK glyphs as one em and Latin glyphs as roughly half", () => {
    expect(estimateTextWidth("备注", 9)).toBe(18)
    expect(estimateTextWidth("note", 9)).toBeLessThan(18)
    expect(estimateTextWidth("note", 9)).toBeGreaterThan(9)
  })
})

describe("wrapTextToWidth", () => {
  it("keeps text that fits on one line", () => {
    expect(wrapTextToWidth("李林线代", 38, 3, measure)).toEqual(["李林线代"])
  })

  it("wraps CJK text by measured width, not by a shared character count", () => {
    expect(wrapTextToWidth("背单词打卡", 38, 3, measure)).toEqual(["背单词打", "卡"])
    // The same pixel budget holds more Latin glyphs than CJK glyphs.
    expect(wrapTextToWidth("abcdefgh", 38, 3, measure)).toEqual(["abcdefgh"])
  })

  it("prefers breaking Latin text at spaces", () => {
    expect(wrapTextToWidth("review list five", 50, 3, measure)).toEqual(["review list", "five"])
  })

  it("splits a single word that cannot fit an empty line", () => {
    const lines = wrapTextToWidth("supercalifragilistic", 40, 4, measure)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.join("")).toBe("supercalifragilistic")
    for (const line of lines) expect(measure(line)).toBeLessThanOrEqual(40)
  })

  it("ends the last permitted line with an ellipsis that fits", () => {
    const lines = wrapTextToWidth("这是一段特别特别特别长的备注文字内容", 38, 2, measure)
    expect(lines).toHaveLength(2)
    expect(lines[1].endsWith("…")).toBe(true)
    expect(measure(lines[1])).toBeLessThanOrEqual(38)
  })

  it("mixes scripts naturally", () => {
    const lines = wrapTextToWidth("微观 P358-369 + 课后题", 45, 5, measure)
    expect(lines.join(" ").replace(/\s+/g, " ")).toBe("微观 P358-369 + 课后题")
    for (const line of lines) expect(measure(line)).toBeLessThanOrEqual(45)
    // A Latin token stays whole instead of breaking mid-word when it fits.
    expect(lines.some((line) => line.includes("P358-369"))).toBe(true)
  })

  it("breaks a hyphenated token after the hyphen rather than inside a number", () => {
    expect(wrapTextToWidth("微观 P358-369 + 课后题", 38, 5, measure)).toEqual(["微观", "P358-", "369 + 课", "后题"])
  })
})
