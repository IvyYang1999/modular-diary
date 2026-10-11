import { describe, expect, it } from "vitest"
import { appendChecklists, checklistInsertion, checklistTemplateStarter, hasChecklist, isDailyNotePath, parseChecklistTemplate, renderChecklist } from "./checklists"

const bedtime = parseChecklistTemplate("睡前", "---\ndaily: true\n---\n# 睡前\n说明文字\n- 刷牙\n- [x] 关电脑\n  - 关显示器\n* 写明天计划\n1. 喝水\n-   \n")

describe("checklist templates", () => {
  it("reads items from any list style and the daily flag from frontmatter", () => {
    expect(bedtime.daily).toBe(true)
    expect(bedtime.items).toEqual([
      { indent: "", text: "刷牙" },
      { indent: "", text: "关电脑" },
      { indent: "  ", text: "关显示器" },
      { indent: "", text: "写明天计划" },
      { indent: "", text: "喝水" },
    ])
  })

  it("defaults to manual and accepts quoted/yes values", () => {
    expect(parseChecklistTemplate("a", "- x").daily).toBe(false)
    expect(parseChecklistTemplate("a", "---\ndaily: false\n---\n- x").daily).toBe(false)
    expect(parseChecklistTemplate("a", "---\ntags: [x]\ndaily: \"yes\"\n---\n- x").daily).toBe(true)
  })

  it("copies every item unchecked, whatever the template says", () => {
    expect(renderChecklist(bedtime)).toBe("### 睡前\n- [ ] 刷牙\n- [ ] 关电脑\n  - [ ] 关显示器\n- [ ] 写明天计划\n- [ ] 喝水")
  })

  it("round-trips the settings starter file", () => {
    const parsed = parseChecklistTemplate("产品体验", checklistTemplateStarter(true, ["飞搜", "Long2Text"]))
    expect(parsed).toEqual({ name: "产品体验", daily: true, items: [{ indent: "", text: "飞搜" }, { indent: "", text: "Long2Text" }] })
  })
})

describe("adding checklists to a diary", () => {
  it("appends missing checklists once and keeps existing text", () => {
    const self = parseChecklistTemplate("计划自检", "- 有没有留白")
    const first = appendChecklists("# 2026-10-11\n\n```timeline\ndate: 2026-10-11\n---\n```", [bedtime, self])
    expect(first).toBe("# 2026-10-11\n\n```timeline\ndate: 2026-10-11\n---\n```\n\n" + renderChecklist(bedtime) + "\n\n" + renderChecklist(self) + "\n")
    expect(appendChecklists(first, [bedtime, self])).toBe(first)
  })

  it("never rewrites a checklist already in the note, even after the template changed", () => {
    const ticked = "### 睡前\n- [x] 刷牙\n"
    const changed = parseChecklistTemplate("睡前", "- 刷牙\n- 冥想")
    expect(appendChecklists(ticked, [changed])).toBe(ticked)
  })

  it("matches the heading name exactly at any level", () => {
    expect(hasChecklist("## 睡前 \n", "睡前")).toBe(true)
    expect(hasChecklist("### 睡前计划\n", "睡前")).toBe(false)
    expect(hasChecklist("睡前\n", "睡前")).toBe(false)
    expect(hasChecklist("# a.b\n", "a+b")).toBe(false)
  })

  it("handles empty notes and trailing newlines", () => {
    expect(appendChecklists("", [bedtime])).toBe(renderChecklist(bedtime) + "\n")
    expect(appendChecklists("x\n", [bedtime])).toBe("x\n\n" + renderChecklist(bedtime) + "\n")
    expect(appendChecklists("x\n\n", [bedtime])).toBe("x\n\n" + renderChecklist(bedtime) + "\n")
  })

  it("inserts at the cursor as its own paragraph", () => {
    expect(checklistInsertion(bedtime, "")).toBe(renderChecklist(bedtime) + "\n")
    expect(checklistInsertion(bedtime, "今天不错")).toBe("\n\n" + renderChecklist(bedtime) + "\n")
  })
})

describe("daily note detection", () => {
  const strict = (value: string, format: string): boolean => {
    if (format === "YYYY-MM-DD") return /^\d{4}-\d{2}-\d{2}$/.test(value)
    if (format === "YYYY/MM/日记 DD") return /^\d{4}\/\d{2}\/日记 \d{2}$/.test(value)
    return false
  }

  it("follows the Daily Notes folder and format", () => {
    expect(isDailyNotePath("daily/2026-10-11.md", { folder: "daily/" }, strict)).toBe(true)
    expect(isDailyNotePath("2026-10-11.md", {}, strict)).toBe(true)
    expect(isDailyNotePath("Journal/2026/10/日记 11.md", { folder: "Journal", format: "YYYY/MM/日记 DD" }, strict)).toBe(true)
  })

  it("rejects other notes and unavailable settings", () => {
    expect(isDailyNotePath("notes/2026-10-11.md", { folder: "daily" }, strict)).toBe(false)
    expect(isDailyNotePath("daily/Ideas.md", { folder: "daily" }, strict)).toBe(false)
    expect(isDailyNotePath("daily/2026-10-11.canvas", { folder: "daily" }, strict)).toBe(false)
    expect(isDailyNotePath("daily/2026-10-11.md", undefined, strict)).toBe(false)
    expect(isDailyNotePath("daily/2026-10-11.md", { folder: 3 }, strict)).toBe(false)
  })
})
