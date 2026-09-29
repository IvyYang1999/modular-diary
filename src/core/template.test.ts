import { describe, expect, it } from "vitest"
import { blockFromSkeleton, skeletonFromSource } from "./template"
import { parseTimeline } from "./parser"

describe("new-block template as a source skeleton", () => {
  const day = [
    "date: 2026-09-30",
    "layout: timeline@7,0,5,40 todos@0,0,7,12 text@0,12,7,8",
    "off: dialog",
    "todo-view: group=none sort=manual layout=abc",
    "todo: id=\"t1\" done=false estimate=30 category=\"开发\" group=\"\" title=\"今天的事\"",
    "goal: type=\"运动\" target=60",
    "---",
    "09:00-10:00 开发 写代码",
    "  正文",
    "=== 感恩日记",
    "今天的阳光很好",
    "=== 阅读笔记",
    "读了一章",
  ].join("\n")

  it("keeps the day's shape and section titles, drops everything that happened", () => {
    expect(skeletonFromSource(day)).toBe([
      "layout: timeline@7,0,5,40 todos@0,0,7,12 text@0,12,7,8",
      "off: dialog",
      "todo-view: group=none sort=manual layout=abc",
      "---",
      "=== 感恩日记",
      "=== 阅读笔记",
    ].join("\n"))
  })

  it("builds a clean block for another day that parses without errors", () => {
    const block = blockFromSkeleton("2026-10-01", skeletonFromSource(day))
    const doc = parseTimeline(block)
    expect(doc.errors).toEqual([])
    expect(doc.date).toBe("2026-10-01")
    expect(doc.textTitles).toEqual(["感恩日记", "阅读笔记"])
    expect(doc.texts).toEqual(["", ""])
    expect(doc.todoView.layout).toBe("abc")
    expect(doc.entries).toEqual([])
    expect(doc.todos).toEqual([])
  })

  it("strips what must never repeat into every day, and reports problems before saving", async () => {
    const { templateProblems } = await import("./template")
    const bad = "days: this-week\n---\n=== 阅读笔记\n```js\nx()\n```"
    expect(blockFromSkeleton("2026-10-02", bad)).toBe("date: 2026-10-02\n---\n=== 阅读笔记\nx()")
    expect(templateProblems(bad)).toEqual(expect.arrayContaining(["fence", "days"]))
    expect(templateProblems("todo-veiw: x\n---")[0]).toMatch(/^line:todo-veiw/)
    expect(templateProblems("off: dialog\n---\n=== 感恩日记")).toEqual([])
  })

  it("accepts a hand-written skeleton without --- or with a stray date", () => {
    expect(blockFromSkeleton("2026-10-02", "date: 2020-01-01\n=== 今日复盘")).toBe("date: 2026-10-02\n---\n=== 今日复盘")
    expect(blockFromSkeleton("2026-10-02", "off: stats")).toBe("date: 2026-10-02\noff: stats\n---")
  })
})
