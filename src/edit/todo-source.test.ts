import { describe, expect, it } from "vitest"
import { parseTimeline } from "../core/parser"
import { todoMetrics } from "../core/todos"
import type { TodoItem } from "../core/types"
import {
  addHabitSkip, deleteEntryLine, deleteTodo, deleteTodoSubtree, insertChildTodo, insertTodo, moveTodo, removeHabitSkip, setEntryTodoBinding,
  setHeaderValue, setTodoCompleted, updateTodo,
} from "./source-rewriter"

const item = (id: string, title = id): Omit<TodoItem, "line"> => ({
  id, title, group: "工作", type: "开发", estimateMin: 60, completed: false,
})

describe("todo and habit source rewrites", () => {
  it("inserts, updates, reorders, and deletes repeated todo headers without touching entries", () => {
    let source = "date: 2026-08-23\n---\n09:00-10:00 开发"
    source = insertTodo(source, item("a"))
    source = insertTodo(source, item("b"))
    source = updateTodo(source, "a", { completed: true, title: "完成 A" })
    source = moveTodo(source, "b", 0)
    expect(parseTimeline(source).todos.map((todo) => [todo.id, todo.completed, todo.title])).toEqual([
      ["b", false, "b"], ["a", true, "完成 A"],
    ])
    source = deleteTodo(source, "b")
    expect(parseTimeline(source).todos.map((todo) => todo.id)).toEqual(["a"])
    expect(source).toContain("09:00-10:00 开发")
  })

  it("binds and unbinds an entry while preserving its note", () => {
    const source = "---\n09:00-10:00 开发 写代码"
    const bound = setEntryTodoBinding(source, 1, "task")
    expect(parseTimeline(bound).entries[0]).toMatchObject({ note: "写代码", todoId: "task" })
    expect(setEntryTodoBinding(bound, 1, null)).toBe(source)
  })

  it("keeps the manual estimate before and after deleting a bound plan", () => {
    const source = [
      "todo: task|0|30|%E5%BC%80%E5%8F%91||%E5%BC%80%E5%8F%91",
      "---",
      "plan 09:00-10:00 开发",
    ].join("\n")
    const bound = setEntryTodoBinding(source, 2, "task")
    const withPlan = parseTimeline(bound)
    expect(withPlan.todos[0].estimateMin).toBe(30)
    expect(todoMetrics(withPlan.todos[0], withPlan.entries).estimateMinutes).toBe(30)

    const deleted = parseTimeline(deleteEntryLine(bound, 2))
    expect(todoMetrics(deleted.todos[0], deleted.entries).estimateMinutes).toBe(30)
  })

  it("writes readable Todo headers and upgrades a legacy row when it is edited", () => {
    const legacy = [
      "todo: task|0|30|%E5%BC%80%E5%8F%91||%E5%BC%80%E5%8F%91",
      "---",
    ].join("\n")
    const updated = updateTodo(legacy, "task", { title: "开发 | 发布 50%" })
    expect(updated).toContain('todo: id="task" done=false estimate=30 category="开发" group="" title="开发 | 发布 50%"')
    expect(updated).not.toContain("%E5")
    expect(parseTimeline(updated).todos[0]).toMatchObject({ id: "task", title: "开发 | 发布 50%", type: "开发" })
  })

  it("adds and removes a per-day habit exception", () => {
    let source = addHabitSkip("date: 2026-08-23\n---", "walk")
    source = addHabitSkip(source, "read")
    expect(parseTimeline(source).habitSkips).toEqual(["walk", "read"])
    source = removeHabitSkip(source, "walk")
    expect(parseTimeline(source).habitSkips).toEqual(["read"])
  })

  it("keeps the authored order while entering and leaving derived views", () => {
    let source = "date: 2026-08-23\n---"
    source = insertTodo(source, item("first"))
    source = insertTodo(source, item("second"))
    const manualOrder = parseTimeline(source).todos.map((todo) => todo.id)

    source = setHeaderValue(source, "todo-view", "group=category sort=estimate")
    source = setHeaderValue(source, "todo-view", "group=none sort=manual")
    expect(parseTimeline(source).todos.map((todo) => todo.id)).toEqual(manualOrder)
  })

  it("inserts a child right after its parent's subtree, keeping preorder", () => {
    let source = "date: 2026-08-23\n---"
    source = insertTodo(source, item("a", "根"))
    source = insertTodo(source, item("z", "另一个"))
    source = insertChildTodo(source, "a", item("a1", "子一"))
    source = insertChildTodo(source, "a1", item("a1i", "孙"))
    source = insertChildTodo(source, "a", item("a2", "子二"))
    expect(parseTimeline(source).todos.map((todo) => [todo.id, todo.parent ?? ""])).toEqual([
      ["a", ""], ["a1", "a"], ["a1i", "a1"], ["a2", "a"], ["z", ""],
    ])
  })

  it("cascades completion down the subtree and bubbles it up", () => {
    let source = "---"
    source = insertTodo(source, item("p"))
    source = insertChildTodo(source, "p", item("c1"))
    source = insertChildTodo(source, "p", item("c2"))
    // Completing the parent completes the children.
    source = setTodoCompleted(source, "p", true)
    expect(parseTimeline(source).todos.map((todo) => [todo.id, todo.completed]))
      .toEqual([["p", true], ["c1", true], ["c2", true]])
    // Un-checking one child un-dones the parent.
    source = setTodoCompleted(source, "c1", false)
    expect(parseTimeline(source).todos.map((todo) => [todo.id, todo.completed]))
      .toEqual([["p", false], ["c1", false], ["c2", true]])
    // Completing the last open child completes the parent.
    source = setTodoCompleted(source, "c1", true)
    expect(parseTimeline(source).todos.map((todo) => todo.completed))
      .toEqual([true, true, true])
  })

  it("deletes the whole subtree along with its entry bindings", () => {
    let source = "---\n09:00-10:00 开发 写代码 [todo:p]"
    source = insertTodo(source, item("p"))
    source = insertChildTodo(source, "p", item("c1"))
    source = insertTodo(source, item("z"))
    const out = deleteTodoSubtree(source, "p")
    expect(parseTimeline(out).todos.map((todo) => todo.id)).toEqual(["z"])
    expect(out).not.toContain("[todo:p]")
    expect(out).toContain("09:00-10:00 开发")
  })
})
