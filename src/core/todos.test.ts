import { describe, expect, it } from "vitest"
import { formatTodoHeaderValue, parseTodoHeaderValue, todoMetrics, normalizeTodoPriorities, sortTodoItems } from "./todos"
import type { Entry, TodoItem } from "./types"

const todo: TodoItem = {
  id: "landing", title: "完成｜落地页", group: "工作 / 产品", type: "开发",
  estimateMin: 90, completed: false, tags: [], line: 2,
}
const entry = (patch: Partial<Entry>): Entry => ({
  plan: false, startMin: 600, endMin: 630, type: "开发", tags: [], line: 5, ...patch,
})

describe("todo source model", () => {
  it("round-trips multilingual titles and separators through a header value", () => {
    const value = formatTodoHeaderValue(todo)
    expect(value).toBe('id="landing" done=false estimate=90 category="开发" group="工作 / 产品" title="完成｜落地页"')
    expect(value).not.toContain("%E")
    expect(parseTodoHeaderValue(value, todo.line)).toEqual(todo)
  })

  it("preserves quotes, pipes, percent signs, backslashes, and emoji in readable source", () => {
    const special = {
      ...todo,
      title: '修复 "A|B" 的 50% 路径 \\ 🎉',
      group: "研发 | 发布",
    }
    const value = formatTodoHeaderValue(special)
    expect(value).toContain('title="修复 \\"A|B\\" 的 50% 路径 \\\\ 🎉"')
    expect(parseTodoHeaderValue(value, special.line)).toEqual(special)
  })

  it("continues to read the legacy percent-encoded pipe format", () => {
    expect(parseTodoHeaderValue(
      "landing|0|90|%E5%BC%80%E5%8F%91|%E5%B7%A5%E4%BD%9C%20%2F%20%E4%BA%A7%E5%93%81|%E5%AE%8C%E6%88%90%EF%BD%9C%E8%90%BD%E5%9C%B0%E9%A1%B5",
      todo.line,
    )).toEqual(todo)
  })

  it("round-trips the small-print note, including quotes and emoji", () => {
    const noted = { ...todo, note: '先给 "设计" 过目 🎨' }
    const value = formatTodoHeaderValue(noted)
    expect(value).toContain('note="先给 \\"设计\\" 过目 🎨"')
    expect(value.indexOf("note=")).toBeLessThan(value.indexOf("title="))
    expect(parseTodoHeaderValue(value, noted.line)).toEqual(noted)
  })

  it("round-trips the parent link of a sub-todo", () => {
    const child = { ...todo, id: "child", parent: "landing" }
    const value = formatTodoHeaderValue(child)
    expect(value).toContain('parent="landing"')
    expect(parseTodoHeaderValue(value, child.line)).toEqual(child)
  })

  it("keeps the manual estimate and sums only actual bound blocks", () => {
    const estimated = { ...todo, estimateMin: 45 }
    const entries = [
      entry({ plan: true, startMin: 480, endMin: 570, todoId: todo.id }),
      entry({ startMin: 600, endMin: 630, todoId: todo.id }),
      entry({ startMin: 700, endMin: 745, todoId: todo.id }),
      entry({ startMin: 800, endMin: 860, todoId: "other" }),
    ]
    expect(todoMetrics(estimated, entries)).toEqual({ estimateMinutes: 45, actualMinutes: 75 })
  })
})


describe("Todo priority choices", () => {
  it("adds P0 to existing defaults and keeps custom tiers in their authored order", () => {
    expect(normalizeTodoPriorities(["P1", "P2", "P3"])).toEqual(["P0", "P1", "P2", "P3"])
    expect(normalizeTodoPriorities([" 随时 ", "P0", "马上", "随时"])).toEqual(["P0", "随时", "马上"])
  })
  it("sorts P0 first even when persisted settings predate that tier", () => {
    expect(sortTodoItems([{ priority: "P1" }, { priority: "P0" }, { priority: "retired" }], "priority", ["P1", "P2", "P3"]))
      .toEqual([{ priority: "P0" }, { priority: "P1" }, { priority: "retired" }])
  })
})

describe("grouping by day", () => {
  it("keys period todos by the day they sit on, in calendar order, unscheduled last", async () => {
    const { groupTodoItems, todoGroupLabel } = await import("./todos")
    const items = [
      { id: "a", completed: false, day: "2026-10-28" },
      { id: "b", completed: false },
      { id: "c", completed: false, day: "2026-10-26" },
      { id: "d", completed: true, day: "2026-10-28" },
    ]
    const groups = groupTodoItems(items, "day")
    expect(groups.map((group) => group.key)).toEqual(["d:2026-10-26", "d:2026-10-28", "d:"])
    expect(groups[1].items.map((item) => item.id)).toEqual(["a", "d"])
    expect(todoGroupLabel("d:2026-10-26")).toMatch(/10\.26$/)
    expect(todoGroupLabel("d:")).not.toBe("")
  })
})
