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

describe("writing rhythms back", () => {
  it("replaces the rhythm lines in place and keeps the prose", async () => {
    const { writeRhythms, reorderRhythms } = await import("./rhythms")
    const items = parseRhythms(note)
    const moved = reorderRhythms(items, "独立旅游", "运动")
    expect(moved.map((item) => item.name)[0]).toBe("独立旅游")
    const out = writeRhythms(note, moved)
    const lines = out.split("\n")
    expect(lines.slice(0, 3)).toEqual(["# 节律", "", "说明文字，不是节律。"])
    expect(lines[3]).toBe("- 每月 独立旅游 @旅行 2-3天 #自由")
    expect(lines[4]).toBe("- 每天 30分钟 运动 @运动 下午")
    expect(out).toContain("- 每天 八段锦 @运动 晚上\n  陪妈一起\n")
    expect(out).toContain("- [ ] 2026-11-06 不是节律，是日程")
    expect(parseRhythms(out).map((item) => item.name)).toEqual(moved.map((item) => item.name))
  })
  it("appends to a note without rhythms and drops unnamed drafts", async () => {
    const { writeRhythms } = await import("./rhythms")
    const out = writeRhythms("# 节律\n\n", [{ name: "  ", cadence: "daily", quota: { kind: "count", count: 1 }, span: { kind: "slot" }, tags: [] }, { name: "跑步", cadence: "weekly", quota: { kind: "count", count: 2 }, span: { kind: "slot" }, tags: [] }])
    expect(out).toBe("# 节律\n\n- 每周 2次 跑步\n")
  })
  it("moving to the end and unknown ids are no-ops or last", async () => {
    const { reorderRhythms } = await import("./rhythms")
    const items = parseRhythms("- 每天 a\n- 每天 b\n- 每天 c")
    expect(reorderRhythms(items, "a", null).map((i) => i.name)).toEqual(["b", "c", "a"])
    expect(reorderRhythms(items, "zz", "a")).toBe(items)
  })
})

describe("parts of the day as a range", () => {
  it("reads two zone words or a dash and writes them back as a range", async () => {
    const { zoneRangeLabel } = await import("./rhythms")
    const spaced = parseRhythmLine("每周 和爸妈出门 @家人 上午 下午")!
    expect(spaced).toMatchObject({ zone: "am", zoneEnd: "pm" })
    expect(formatRhythmLine(spaced)).toBe("- 每周 和爸妈出门 @家人 上午-下午")
    const dashed = parseRhythmLine("每周 和爸妈出门 晚上-上午")!
    expect(dashed).toMatchObject({ zone: "am", zoneEnd: "ev" })
    expect(zoneRangeLabel(dashed)).toBe("上午–晚上")
    expect(parseRhythmLine("每天 运动 下午 下午")!.zoneEnd).toBeUndefined()
    expect(zoneRangeLabel(parseRhythmLine("每天 运动 下午")!)).toBe("下午")
  })
})

describe("daily limits", () => {
  it("reads 以下 / 少于 as an upper bound and writes it back", () => {
    const limit = parseRhythmLine("每天 1小时以下 浪费 @wasted")!
    expect(limit.quota).toMatchObject({ kind: "duration", minutes: 60, limit: true })
    expect(formatRhythmLine(limit)).toBe("- 每天 1小时以下 浪费 @wasted")
    expect(parseRhythmLine("每天 少于30分钟 刷手机")!.quota).toMatchObject({ minutes: 30, limit: true })
    expect(rhythmToHabit(limit, 0)).toMatchObject({ durationComparison: "below", targetMinutes: 60 })
    expect(rhythmToHabit(parseRhythmLine("每天 30分钟 运动")!, 0)).not.toHaveProperty("durationComparison")
  })
})

describe("weekly rhythms counting from a date", () => {
  it("are off before their first week and on every week after", () => {
    const weekly = parseRhythmLine("每周 游泳 自2026-11-02")!
    expect(rhythmWeekOn(weekly, "2026-10-28")).toBe(false)
    expect(rhythmWeekOn(weekly, "2026-11-04")).toBe(true)
    expect(rhythmWeekOn(weekly, "2026-11-11")).toBe(true)
    expect(rhythmWeekOn(parseRhythmLine("每周 游泳")!, "2026-01-01")).toBe(true)
  })
})
