import { describe, expect, it } from "vitest"
import { parseBodyTodos, setBodyTodoCompleted } from "./body-todos"

const NOTE = [
  "---",
  'date: "2026-09-22"',
  "---",
  "```timeline",
  "date: 2026-09-22",
  "todo: id=\"t1\" done=false estimate=0 category=\"\" group=\"\" title=\"in the block\"",
  "- [ ] not a todo, this is inside a fence",
  "```",
  "",
  "# 今日待办",
  "",
  "## 工作与造物",
  "- [ ] 对一下 tiiny verse 的需求",
  "- [x] 把 tiiny image 上次的需求",
  "",
  "## 求职与学习",
  "- [ ] 快速把 CS336 过完 ^td-cs336",
  "  - [ ] 缩进的子项也算",
  "- [ ]",
  "",
  "# 今日日记",
  "",
  "## 今日总结",
  "- [ ] 不该出现：不在待办区里",
].join("\n")

describe("parseBodyTodos", () => {
  it("reads only the named section, grouped by sub-heading", () => {
    expect(parseBodyTodos(NOTE, "今日待办").map((t) => [t.group, t.title, t.completed])).toEqual([
      ["工作与造物", "对一下 tiiny verse 的需求", false],
      ["工作与造物", "把 tiiny image 上次的需求", true],
      ["求职与学习", "快速把 CS336 过完", false],
      ["求职与学习", "缩进的子项也算", false],
    ])
  })

  it("skips fenced code and empty placeholder boxes", () => {
    const titles = parseBodyTodos(NOTE, "今日待办").map((t) => t.title)
    expect(titles).not.toContain("not a todo, this is inside a fence")
    expect(titles.some((title) => title === "")).toBe(false)
  })

  it("strips a trailing block anchor from the title", () => {
    const item = parseBodyTodos(NOTE, "今日待办").find((t) => t.title.includes("CS336"))
    expect(item?.title).toBe("快速把 CS336 过完")
    expect(item?.raw).toContain("^td-cs336")
  })

  it("scans the whole note when no section is named", () => {
    expect(parseBodyTodos(NOTE, "").map((t) => t.title)).toContain("不该出现：不在待办区里")
  })

  it("returns nothing when the section is absent", () => {
    expect(parseBodyTodos(NOTE, "没有这个标题")).toEqual([])
  })

  it("gives ids that survive reordering and stay binding-safe", () => {
    const before = parseBodyTodos(NOTE, "今日待办")
    const moved = NOTE.replace(
      "- [ ] 对一下 tiiny verse 的需求\n- [x] 把 tiiny image 上次的需求",
      "- [x] 把 tiiny image 上次的需求\n- [ ] 对一下 tiiny verse 的需求"
    )
    const after = parseBodyTodos(moved, "今日待办")
    const idOf = (items: typeof before, title: string) => items.find((t) => t.title === title)?.id
    expect(idOf(after, "对一下 tiiny verse 的需求")).toBe(idOf(before, "对一下 tiiny verse 的需求"))
    for (const item of before) expect(item.id).toMatch(/^[a-z0-9_-]+$/)
  })

  it("keeps duplicate titles in one group apart", () => {
    const dup = "# 待办\n- [ ] 同一件事\n- [ ] 同一件事\n"
    const ids = parseBodyTodos(dup, "待办").map((t) => t.id)
    expect(new Set(ids).size).toBe(2)
  })
})

describe("writing back", () => {
  const item = () => parseBodyTodos(NOTE, "今日待办")[0]

  it("ticks and unticks the box in place", () => {
    const done = setBodyTodoCompleted(NOTE, item(), true)
    expect(done).toContain("- [x] 对一下 tiiny verse 的需求")
    const undone = setBodyTodoCompleted(done ?? "", { ...item(), raw: "- [x] 对一下 tiiny verse 的需求" }, false)
    expect(undone).toContain("- [ ] 对一下 tiiny verse 的需求")
  })

  it("re-finds the line when the note shifted above it", () => {
    const shifted = `新加的一行\n${NOTE}`
    expect(setBodyTodoCompleted(shifted, item(), true)).toContain("- [x] 对一下 tiiny verse 的需求")
  })

  it("returns null when the line is gone", () => {
    const gone = NOTE.replace("- [ ] 对一下 tiiny verse 的需求\n", "")
    expect(setBodyTodoCompleted(gone, item(), true)).toBeNull()
  })
})
