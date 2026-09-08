import { describe, expect, it } from "vitest"
import { parseClockInput, spanInputProblem } from "./time-popover"

describe("precise time popover validation", () => {
  it("parses H:MM and HH:MM clocks", () => {
    expect(parseClockInput("9:05")).toBe(545)
    expect(parseClockInput(" 23:59 ")).toBe(1439)
    expect(parseClockInput("9:xx")).toBeNull()
    expect(parseClockInput("12:60")).toBeNull()
    expect(parseClockInput("")).toBeNull()
  })

  it("names the field and reason instead of failing silently", () => {
    expect(spanInputProblem("9:xx", "10:00")).toEqual({ key: "invalidStart", field: "start" })
    expect(spanInputProblem("09:00", "10")).toEqual({ key: "invalidEnd", field: "end" })
    expect(spanInputProblem("09:00", "09:00")).toEqual({ key: "durationTooShort", field: "end" })
    expect(spanInputProblem("09:00", "10:00")).toBeNull()
    // An end before the start is a next-day span, which the parser accepts.
    expect(spanInputProblem("23:30", "00:15")).toBeNull()
  })
})
