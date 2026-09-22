import { describe, expect, it } from "vitest"
import { localDateKey, nowMinutesForDate } from "./now"

describe("localDateKey", () => {
  it("pads month and day", () => {
    expect(localDateKey(new Date(2026, 0, 5, 9, 30))).toBe("2026-01-05")
  })
})

describe("nowMinutesForDate", () => {
  const now = new Date(2026, 8, 22, 15, 7) // 2026-09-22 15:07 local

  it("returns minutes since midnight on today's block", () => {
    expect(nowMinutesForDate("2026-09-22", now)).toBe(15 * 60 + 7)
  })

  it("hides the marker on other days", () => {
    expect(nowMinutesForDate("2026-09-21", now)).toBeUndefined()
    expect(nowMinutesForDate("2026-09-23", now)).toBeUndefined()
  })

  it("hides the marker on a dateless block", () => {
    expect(nowMinutesForDate(null, now)).toBeUndefined()
    expect(nowMinutesForDate(undefined, now)).toBeUndefined()
    expect(nowMinutesForDate("", now)).toBeUndefined()
  })

  it("uses local midnight, not UTC", () => {
    expect(nowMinutesForDate("2026-09-22", new Date(2026, 8, 22, 0, 0))).toBe(0)
  })
})
