import { describe, expect, it } from "vitest"
import { formatRhythmLine, parseRhythmLine, parseRhythms, rhythmLinesFromSettings, rhythmToHabit, rhythmWeekOn } from "./rhythms"

const note = `# 节律

说明文字，不是节律。
- 每天 30分钟 运动 @运动 下午
- 每天 八段锦 @运动 晚上
  陪妈一起
- 每周 1次 拍口播视频 @视频 整天
- 每周 3小时 学习 @学习
- 每两周 周二 14:00-15:00 心理咨询 @家人 自2026-10-27
- 每月 1次 独立旅游 @旅行 2-3天 #自由
- [ ] 2026-11-06 不是节律，是日程
- 每周 没有名字的不算 @x
`

describe("rhythm lines", () => {
  it("reads cadence, quota, category, span, zone, time and anchor in any order", () => {
    const items = parseRhythms(note)
    expect(items.map((item) => item.name)).toEqual(["运动", "八段锦", "拍口播视频", "学习", "心理咨询", "独立旅游", "没有名字的不算"])
    expect(items[0]).toMatchObject({ cadence: "daily", quota: { kind: "duration", minutes: 30 }, type: "运动", zone: "pm", id: "运动" })
    expect(items[1]).toMatchObject({ quota: { kind: "count", count: 1 }, note: "陪妈一起", zone: "ev" })
    expect(items[2]).toMatchObject({ cadence: "weekly", span: { kind: "allDay" }, type: "视频" })
    expect(items[3]).toMatchObject({ quota: { kind: "duration", minutes: 180 } })
    expect(items[4]).toMatchObject({ cadence: "biweekly", weekday: 2, startMin: 840, endMin: 900, anchor: "2026-10-27" })
    expect(items[5]).toMatchObject({ cadence: "monthly", span: { kind: "days", min: 2, max: 3 }, tags: ["自由"] })
  })
  it("round-trips through formatRhythmLine", () => {
    for (const line of ["每天 30分钟 运动 @运动 下午", "每周 拍口播视频 @视频 整天", "每两周 周二 14:00-15:00 心理咨询 @家人 自2026-10-27", "每月 2次 独立旅游 @旅行 2-3天 #自由", "每周 3小时 学习"]) {
      expect(formatRhythmLine(parseRhythmLine(line)!)).toBe(`- ${line}`)
    }
  })
  it("numbers duplicate names so slot ids never collide", () => {
    const items = parseRhythms("- 每周 跑步\n- 每周 跑步")
    expect(items.map((item) => item.id)).toEqual(["跑步", "跑步-2"])
  })
  it("knows which weeks a biweekly rhythm is on", () => {
    const anchored = parseRhythmLine("每两周 周二 心理咨询 自2026-10-27")!
    expect(rhythmWeekOn(anchored, "2026-10-29")).toBe(true)
    expect(rhythmWeekOn(anchored, "2026-11-04")).toBe(false)
    expect(rhythmWeekOn(anchored, "2026-11-12")).toBe(true)
    expect(rhythmWeekOn(parseRhythmLine("每周 跑步")!, "2026-11-04")).toBe(true)
  })
})

describe("rhythms as habits", () => {
  it("maps daily and weekly rhythms onto habit rules and leaves monthly ones out", () => {
    expect(rhythmToHabit(parseRhythmLine("每天 30分钟 运动 @运动")!, 0)).toMatchObject({ targetPeriod: "day", targetMinutes: 30, schedule: { kind: "daily" } })
    expect(rhythmToHabit(parseRhythmLine("每天 八段锦")!, 1)).toMatchObject({ targetPeriod: "day", targetMinutes: 0 })
    expect(rhythmToHabit(parseRhythmLine("每周 3小时 学习")!, 2)).toMatchObject({ targetPeriod: "week", targetMinutes: 180, targetMetric: "duration" })
    expect(rhythmToHabit(parseRhythmLine("每周 2次 拍视频")!, 3)).toMatchObject({ targetPeriod: "week", targetMetric: "count", targetCount: 2 })
    expect(rhythmToHabit(parseRhythmLine("工作日 站立")!, 4)).toMatchObject({ schedule: { kind: "weekdays" } })
    expect(rhythmToHabit(parseRhythmLine("每月 旅游")!, 5)).toBeNull()
  })
  it("writes the old habits and weekly todos as rhythm lines", () => {
    const text = rhythmLinesFromSettings([
      { id: "a", name: "运动", type: "运动", targetMinutes: 30, targetPeriod: "day", schedule: { kind: "daily" }, order: 1 },
      { id: "b", name: "读书", type: "阅读", targetMinutes: 300, targetPeriod: "week", targetMetric: "duration", schedule: { kind: "daily" }, order: 0 },
      { id: "c", name: "称体重", type: "", targetMinutes: 0, targetPeriod: "week", targetMetric: "count", targetCount: 2, schedule: { kind: "daily" }, order: 2 },
    ], [{ id: "w", title: "发一条视频", group: "", type: "视频", targetMinutes: 0, order: 0 }])
    expect(text).toBe("# 节律\n\n- 每周 5小时 读书 @阅读\n- 每天 30分钟 运动 @运动\n- 每周 2次 称体重\n- 每周 发一条视频 @视频\n")
    expect(parseRhythms(text)).toHaveLength(4)
  })
})
