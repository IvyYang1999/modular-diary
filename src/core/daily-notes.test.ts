import { describe, expect, it } from "vitest"
import { dailyNotePath, dateFromBasename, fillDailyTemplate, parseDailyNotesConfig, shiftDate } from "./daily-notes"

const fakeMoment = (fmt: string, date: string): string => {
  const [y, m, d] = date.split("-")
  return fmt.replace("YYYY", y).replace("MM", m).replace("DD", d).replace("M", String(Number(m))).replace("D", String(Number(d)))
}

describe("daily notes convention", () => {
  it("reads the core plugin config with defaults and trimming", () => {
    expect(parseDailyNotesConfig(null)).toEqual({ folder: "", format: "YYYY-MM-DD", template: "" })
    expect(parseDailyNotesConfig({ format: "YYYY.M.D", folder: "/日记/2026.5毕业之前/", template: "模板/日记.md" }))
      .toEqual({ folder: "日记/2026.5毕业之前", format: "YYYY.M.D", template: "模板/日记" })
  })

  it("builds the note path from folder and format", () => {
    expect(dailyNotePath({ folder: "日记/2026.5毕业之前", format: "YYYY.M.D", template: "" }, "2026-10-01", fakeMoment)).toBe("日记/2026.5毕业之前/2026.10.1.md")
    expect(dailyNotePath({ folder: "", format: "YYYY-MM-DD", template: "" }, "2026-10-01", fakeMoment)).toBe("2026-10-01.md")
  })

  it("reads dates off note names and shifts dates across month ends", () => {
    expect(dateFromBasename("2026.10.1")).toBe("2026-10-01")
    expect(dateFromBasename("2026-08-18 周二")).toBe("2026-08-18")
    expect(dateFromBasename("周记 W40")).toBeNull()
    expect(shiftDate("2026-09-30", 1)).toBe("2026-10-01")
    expect(shiftDate("2026-01-01", -1)).toBe("2025-12-31")
  })

  it("fills the template variables a note name needs", () => {
    expect(fillDailyTemplate("# {{title}}\n{{date:YYYY/MM}} · {{ date }}", "2026-10-01", "2026.10.1", fakeMoment)).toBe("# 2026.10.1\n2026/10 · 2026.10.1")
  })
})
