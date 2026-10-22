import { describe, expect, it } from "vitest"
import { addUpcoming, formatUpcomingLine, markUpcomingDone, parseUpcoming, pendingForDate, upcomingFrom } from "./upcoming"

const note = "# Upcoming\n\n随便写的说明\n- [ ] 2026-11-06 14:00-14:30 外出 去某地 带身份证\n- [x] 2026-10-01 09:00-10:00 开发 已经放进去了\n- [ ] 2026-11-03 交房租\n- 不是任务行\n"

describe("upcoming note", () => {
  it("reads timed and untimed items and ignores other text", () => {
    const items = parseUpcoming(note)
    expect(items).toEqual([
      { line: 3, date: "2026-11-06", startMin: 840, endMin: 870, type: "外出", text: "去某地 带身份证", done: false },
      { line: 4, date: "2026-10-01", startMin: 540, endMin: 600, type: "开发", text: "已经放进去了", done: true },
      { line: 5, date: "2026-11-03", text: "交房租", done: false },
    ])
    expect(formatUpcomingLine(items[0])).toBe("- [ ] 2026-11-06 14:00-14:30 外出 去某地 带身份证")
  })
  it("inserts in date order and starts an empty note with a heading", () => {
    const added = addUpcoming(note, { date: "2026-11-04", startMin: 600, endMin: 660, type: "运动", text: "游泳" })
    expect(parseUpcoming(added).map((item) => item.date)).toEqual(["2026-11-06", "2026-10-01", "2026-11-03", "2026-11-04"])
    expect(added.split("\n")[6]).toBe("- [ ] 2026-11-04 10:00-11:00 运动 游泳")
    expect(addUpcoming("", { date: "2026-11-04", text: "体检" })).toBe("# Upcoming\n\n- [ ] 2026-11-04 体检\n")
  })
  it("ticks only the copied items, and only while the line is unchanged", () => {
    const items = parseUpcoming(note)
    const pending = pendingForDate(items, "2026-11-06")
    expect(pending).toHaveLength(1)
    const ticked = markUpcomingDone(note, pending)
    expect(parseUpcoming(ticked)[0].done).toBe(true)
    expect(markUpcomingDone(note.replace("去某地", "去别处"), pending)).toBe(note.replace("去某地", "去别处"))
    expect(upcomingFrom(items, "2026-11-01").map((item) => item.text)).toEqual(["交房租", "去某地 带身份证"])
  })
})
