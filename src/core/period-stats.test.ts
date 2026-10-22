import { describe, expect, it } from "vitest"
import { canTrackDays, parsePeriodStatsWidget, periodStatsToken, shareSlices } from "./period-stats"

describe("period stats widgets", () => {
  it("round-trips header tokens", () => {
    expect(parsePeriodStatsWidget("share")).toEqual({ kind: "share" })
    expect(parsePeriodStatsWidget("days:运动")).toEqual({ kind: "days", type: "运动" })
    expect(parsePeriodStatsWidget("pie")).toBeNull()
    expect(periodStatsToken({ kind: "days", type: "运动" })).toBe("days:运动")
    expect(canTrackDays("a b")).toBe(false)
  })
  it("keeps the largest categories and folds the rest into other", () => {
    const totals = ["a", "b", "c", "d", "e", "f", "g"].map((type, i) => ({ type, minutes: 70 - i * 10 }))
    const slices = shareSlices(totals)
    expect(slices.map((s) => s.type)).toEqual(["a", "b", "c", "d", "e", null])
    expect(slices.reduce((acc, s) => acc + s.ratio, 0)).toBeCloseTo(1)
    // One extra category is shown as itself rather than as "other".
    expect(shareSlices(totals.slice(0, 6)).map((s) => s.type)).toEqual(["a", "b", "c", "d", "e", "f"])
    expect(shareSlices([])).toEqual([])
  })
})
