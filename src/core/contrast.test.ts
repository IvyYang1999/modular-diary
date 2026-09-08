import { describe, expect, it } from "vitest"
import { contrastRatio, darkThemeBlockFill, mixColors, parseColor, readableTextColor, relatedTextColor } from "./contrast"

describe("contrast", () => {
  it("parses hex and hsl", () => {
    expect(parseColor("#ff0000")).toEqual([1, 0, 0])
    expect(parseColor("hsl(120 50% 50%)")).toEqual([0.25, 0.75, 0.25])
  })
  it("dark bg -> white text, light bg -> dark text", () => {
    expect(readableTextColor("#1a1a1a")).toBe("#ffffff")
    expect(readableTextColor("#7fd4c1")).toBe("#1a1a1a")
    expect(readableTextColor("#b91c1c")).toBe("#ffffff") // 深红
  })
})

describe("relatedTextColor (派生文字色)", () => {
  it("浅蓝底 -> 深蓝字（同色相）", () => {
    const c = relatedTextColor("hsl(200 70% 80%)")
    expect(c).toMatch(/^hsl\(200 /) // 同色相
    expect(contrastRatio(c, "hsl(200 70% 80%)")).toBeGreaterThanOrEqual(4.5)
  })
  it("深底 -> 同色系浅字", () => {
    const c = relatedTextColor("hsl(340 60% 30%)")
    expect(c).toMatch(/^hsl\(340 /)
    expect(contrastRatio(c, "hsl(340 60% 30%)")).toBeGreaterThanOrEqual(4.5)
  })
  it("灰色底 -> 中性黑白", () => {
    expect(relatedTextColor("#cccccc")).toBe("#1a1a1a")
    expect(relatedTextColor("#333333")).toBe("#ffffff")
  })
})

describe("dark-theme block fill", () => {
  it("blends the page background into the highlighter color", () => {
    expect(mixColors("#ffffff", "#000000", 0.5)).toBe("#808080")
    expect(darkThemeBlockFill("#d9d9d9")).toBe("#b0b0b0")
  })

  it("keeps the derived copy readable on the blended fill", () => {
    for (const color of ["#d9d9d9", "#7fd4c1", "#9bd17b", "#f6c667", "#f5a3b7", "#c8b6e2", "hsl(210 62% 62%)"]) {
      const fill = darkThemeBlockFill(color)
      expect(contrastRatio(relatedTextColor(fill), fill)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it("passes unparsable colors through unchanged", () => {
    expect(darkThemeBlockFill("tomato")).toBe("tomato")
  })
})
