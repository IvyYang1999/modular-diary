import { describe, expect, it } from "vitest"
import { parseScheduleLine } from "./schedule-parse"

const today = "2026-10-29" // a Thursday

describe("parseScheduleLine", () => {
  it("reads a Chinese date, an afternoon clock time, a category and a duration", () => {
    expect(parseScheduleLine("11月15日 下午3点 参加演出 @出门 2小时", today)).toEqual({
      date: "2026-11-15", dateExplicit: true, at: 15 * 60, estimateMin: 120, type: "出门", title: "参加演出",
    })
  })
  it("works without spaces and with a clock time", () => {
    expect(parseScheduleLine("11月15日15:30参加演出", today)).toMatchObject({ date: "2026-11-15", at: 15 * 60 + 30, estimateMin: 60, title: "参加演出" })
    expect(parseScheduleLine("2026-12-01 09:00-10:30 牙医", today)).toMatchObject({ date: "2026-12-01", at: 540, estimateMin: 90, title: "牙医" })
  })
  it("understands relative days and weekdays", () => {
    expect(parseScheduleLine("明天 晚上 跑步", today)).toMatchObject({ date: "2026-10-30", zone: "ev", title: "跑步" })
    expect(parseScheduleLine("后天 交房租", today)).toMatchObject({ date: "2026-10-31", title: "交房租" })
    expect(parseScheduleLine("周三 开会", today)).toMatchObject({ date: "2026-11-04", title: "开会" })
    expect(parseScheduleLine("周四 开会", today)).toMatchObject({ date: "2026-10-29" })
    expect(parseScheduleLine("下周三 开会", today)).toMatchObject({ date: "2026-11-04" })
    expect(parseScheduleLine("下周一 开会", today)).toMatchObject({ date: "2026-11-02" })
    expect(parseScheduleLine("3天后 复诊", today)).toMatchObject({ date: "2026-11-01", title: "复诊" })
    expect(parseScheduleLine("next mon 10am standup", today)).toMatchObject({ date: "2026-11-02", at: 600, title: "standup" })
  })
  it("reads the hour by its part of the day, and a bare small hour as the afternoon", () => {
    expect(parseScheduleLine("上午9点 复习", today)?.at).toBe(540)
    expect(parseScheduleLine("晚上8点半 读书", today)?.at).toBe(20 * 60 + 30)
    expect(parseScheduleLine("中午12点 午饭", today)?.at).toBe(12 * 60)
    expect(parseScheduleLine("3点 开会", today)?.at).toBe(15 * 60)
    expect(parseScheduleLine("9点 开会", today)?.at).toBe(9 * 60)
    expect(parseScheduleLine("下午3 开会", today)?.at).toBe(15 * 60)
  })
  it("reads durations in hours and minutes and never mistakes them for times", () => {
    expect(parseScheduleLine("写周报 1.5小时", today)).toMatchObject({ estimateMin: 90, title: "写周报" })
    expect(parseScheduleLine("写周报 1.5小时", today)?.at).toBeUndefined()
    expect(parseScheduleLine("写周报 1个半小时", today)).toMatchObject({ estimateMin: 90 })
    expect(parseScheduleLine("写周报 半小时", today)).toMatchObject({ estimateMin: 30 })
    expect(parseScheduleLine("写周报 45分钟", today)).toMatchObject({ estimateMin: 45 })
    expect(parseScheduleLine("写周报 2h", today)).toMatchObject({ estimateMin: 120, title: "写周报" })
  })
  it("defaults to today without a date, and needs a title", () => {
    expect(parseScheduleLine("买菜", today)).toEqual({ date: today, dateExplicit: false, title: "买菜" })
    expect(parseScheduleLine("11月15日", today)).toBeNull()
    expect(parseScheduleLine("   ", today)).toBeNull()
  })
  it("rolls a month-day that is well behind into next year", () => {
    expect(parseScheduleLine("1月5日 体检", today)).toMatchObject({ date: "2027-01-05" })
    expect(parseScheduleLine("10月20日 补记", today)).toMatchObject({ date: "2026-10-20" })
  })
})
