import { describe, expect, it } from "vitest"
import { parseTimeline } from "../core/parser"
import { formatTodoHeaderValue, parseTodoHeaderValue, parseTodoViewHeaderValue, sortTodoItems } from "../core/todos"
import { insertTodo, updateTodo, moveTodo } from "./source-rewriter"
const todo = { id: "a", title: "任务", group: "", estimateMin: 30, completed: false }
describe("todo batch source contract", () => {
  it("round-trips notes and optional attributes, including escaped multiline text", () => {
    const value = { ...todo, note: '第一行\n"引号" \\ 50% 🎉', difficulty: 3, priority: "紧急" }
    const source = insertTodo("date: 2026-10-10\n---\n09:00-10:00 work", value)
    expect(parseTimeline(source).todos[0]).toMatchObject(value)
    expect(parseTimeline(source).errors).toEqual([])
  })
  it("preserves an unchanged note's exact source bytes while changing a title", () => {
    const source = 'todo: ' + formatTodoHeaderValue(todo) + ' note="  \\u5907注\\n第二行  "\n---'
    const updated = updateTodo(source, "a", { title: "新标题", note: "  备注\n第二行  " })
    expect(updated).toContain('note="  \\u5907注\\n第二行  "')
    expect(parseTimeline(updated).todos[0]).toMatchObject({ title: "新标题", note: "  备注\n第二行  " })
    expect(updateTodo(updated, "a", { note: "" })).not.toContain(" note=")
  })
  it("does not mistake note= inside a title for the actual note field", () => {
    const source = 'todo: ' + formatTodoHeaderValue({ ...todo, title: "检查 note=" }) + ' note="真实备注"\n---'
    const updated = updateTodo(source, "a", { title: "新标题", note: "真实备注" })
    expect(parseTimeline(updated).todos[0]).toMatchObject({ title: "新标题", note: "真实备注" })
    expect(updated).toContain('note="真实备注"')
  })
  it.each(['note=备注', 'note=""', 'note="\\u5907注"'])("retains the accepted note token %s verbatim on title-only saves", (rawNote) => {
    const source = 'todo: ' + formatTodoHeaderValue(todo) + ' ' + rawNote + '\n---'
    const note = parseTimeline(source).todos[0].note
    const updated = updateTodo(source, "a", { title: "新标题", note })
    expect(updated).toContain(rawNote + '\n---')
    expect(parseTimeline(updated).todos[0]).toMatchObject({ title: "新标题", note })
  })
  it("preserves the field independently of its position and of field-like title text", () => {
    const source = '- [/] todo: id="a" note="\\u5907注" estimate=30 category="" group="" title="检查 note="\n---'
    const updated = updateTodo(source, "a", { title: "新 note=", note: "备注", difficulty: 3 })
    expect(updated).toContain('note="\\u5907注"')
    expect(parseTimeline(updated).todos[0]).toMatchObject({ title: "新 note=", note: "备注", partial: true, difficulty: 3 })
    expect(parseTimeline(updated).errors).toEqual([])
    const cleared = updateTodo(updated, "a", { note: undefined, priority: "P1" })
    expect(parseTimeline(cleared).todos[0].note).toBeUndefined()
    expect(cleared).not.toContain('note="\\u5907注"')
  })
  it.each(["todo:", "todo :", "TODO:"])("retains note escapes with the accepted header prefix %s", (prefix) => {
    const source = prefix + ' ' + formatTodoHeaderValue(todo) + ' note="\\u5907注"\n---'
    expect(parseTimeline(source).todos[0].note).toBe("备注")
    expect(updateTodo(source, "a", { title: "新标题", note: "备注" })).toContain('note="\\u5907注"')
  })
  it("writes and reads Markdown half-completion and retains all data through normal toggles", () => {
    const source = updateTodo(insertTodo("---", { ...todo, note: "尾巴" }), "a", { partial: true })
    expect(source).toMatch(/^- \[\/\] todo:/)
    expect(parseTimeline(source).todos[0]).toMatchObject({ completed: false, partial: true, note: "尾巴" })
    const done = updateTodo(source, "a", { completed: true, partial: false })
    expect(done).toMatch(/^- \[x\] todo:/)
    expect(parseTimeline(done).todos[0]).toMatchObject({ completed: true, note: "尾巴" })
    expect(parseTimeline(done.replace("[x]", "[/]")).todos[0]).toMatchObject({ completed: false, partial: true })
  })
  it("manual reordering preserves authored rows byte for byte", () => {
    const first = 'todo: ' + formatTodoHeaderValue(todo) + ' note="\\u5907注"'
    const second = 'todo: ' + formatTodoHeaderValue({ ...todo, id: "b" })
    expect(moveTodo(first + '\n' + second + '\n---', "b", 0)).toBe(second + '\n' + first + '\n---')
  })
  it("clears optional attributes without changing old defaults", () => {
    let source = insertTodo("---", { ...todo, difficulty: 5, priority: "P1" })
    source = updateTodo(source, "a", { difficulty: undefined, priority: undefined })
    expect(source).not.toMatch(/difficulty=|priority=/)
    expect(parseTimeline(source).todos[0]).toMatchObject(todo)
  })
})

describe("attribute views and compatibility", () => {
  it("sorts descending difficulty and custom priority without altering authored order", () => {
    const items = [{ id: "unset" }, { id: "low", difficulty: 1, priority: "随时" }, { id: "high", difficulty: 5, priority: "马上" }, { id: "tie", difficulty: 5, priority: "马上" }, { id: "retired", priority: "已删档位" }]
    expect(sortTodoItems(items, "difficulty").map(i => i.id)).toEqual(["high", "tie", "low", "unset", "retired"])
    expect(sortTodoItems(items, "priority", ["马上", "随时"]).map(i => i.id)).toEqual(["high", "tie", "low", "unset", "retired"])
    expect(sortTodoItems(items, "manual").map(i => i.id)).toEqual(["unset", "low", "high", "tie", "retired"])
    expect(parseTodoViewHeaderValue("group=none sort=difficulty")?.sortBy).toBe("difficulty")
    expect(parseTodoViewHeaderValue("group=status sort=priority")?.sortBy).toBe("priority")
  })
  it("rejects invalid stars and duplicate fields rather than losing a task", () => {
    for (const suffix of ["difficulty=0", "difficulty=6", "difficulty=2.5", 'note="a" note="b"']) {
      expect(parseTodoHeaderValue(formatTodoHeaderValue(todo) + " " + suffix, 0)).toBeNull()
    }
  })
  it("does not rewrite source when the form submits unchanged values", () => {
    const source = "todo: " + formatTodoHeaderValue(todo) + "\n---"
    expect(updateTodo(source, todo.id, { title: todo.title, type: undefined, estimateMin: 30, note: "", difficulty: undefined, priority: undefined })).toBe(source)
  })
})
