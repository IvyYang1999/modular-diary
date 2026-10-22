import { describe, expect, it, vi } from "vitest"
import { applyUpcomingToBlock, UpcomingSchedule } from "./upcoming-schedule"
import { parseTimeline } from "./parser"

describe("upcoming schedule", () => {
  it("turns timed items into plan blocks and untimed ones into todos, without copying twice", () => {
    const items = [
      { line: 0, date: "2026-11-06", startMin: 840, endMin: 870, type: "外出", text: "去某地", done: false },
      { line: 1, date: "2026-11-06", text: "交房租", done: false },
    ]
    const once = applyUpcomingToBlock("date: 2026-11-06\n---\n09:00-10:00 开发", items)
    const doc = parseTimeline(once)
    expect(doc.entries.find((entry) => entry.plan)?.startMin).toBe(840)
    expect(doc.todos.map((todo) => todo.title)).toEqual(["交房租"])
    expect(applyUpcomingToBlock(once, items)).toBe(once)
  })

  it("adds to the note, copies into an existing diary right away and ticks the line", async () => {
    const files: Record<string, string> = {}
    let block = "date: 2026-11-06\n---"
    const changed = vi.fn()
    const schedule = new UpcomingSchedule({
      readNote: async () => files["Upcoming.md"] ?? null,
      writeNote: async (change) => { files["Upcoming.md"] = change(files["Upcoming.md"] ?? "") },
      dayExists: async (date) => date === "2026-11-06",
      writeToDay: async (_date, transform) => { block = transform(block) },
      onChange: changed,
    })
    await schedule.add({ date: "2026-11-07", startMin: 600, endMin: 660, type: "运动", text: "游泳" })
    expect(files["Upcoming.md"]).toBe("# Upcoming\n\n- [ ] 2026-11-07 10:00-11:00 运动 游泳\n")
    expect(block).not.toContain("游泳")
    await schedule.add({ date: "2026-11-06", startMin: 840, endMin: 870, type: "外出", text: "去某地" })
    expect(block).toContain("plan 14:00-14:30 外出 去某地")
    expect(files["Upcoming.md"]).toContain("- [x] 2026-11-06 14:00-14:30 外出 去某地")
    expect(files["Upcoming.md"]).toContain("- [ ] 2026-11-07 10:00-11:00 运动 游泳")
    expect(await schedule.copyInto("2026-11-06")).toBe(false)
    expect(changed).toHaveBeenCalled()
  })
})
