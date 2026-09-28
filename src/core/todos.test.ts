import { describe, expect, it } from "vitest"
import { formatTodoHeaderValue, parseTodoHeaderValue, todoMetrics } from "./todos"
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
