import { describe, expect, it } from "vitest"
import { parseTimeline } from "./parser"
import { formatTodoSourceLine, formatTodoViewHeaderValue, groupTodoTree, parseTodoViewHeaderValue } from "./todos"
import { insertChildTodo, setTodoCompleted, updateTodo } from "../edit/source-rewriter"

describe("main and phase2 feature compatibility", () => {
  it("retains secondary tag grouping alongside priority and difficulty sorting", () => {
    for (const sortBy of ["priority", "difficulty"] as const) {
      const view = { groupBy: "category", group2: "tag", sortBy } as const
      expect(parseTodoViewHeaderValue(formatTodoViewHeaderValue(view))).toEqual(view)
    }
  })

  it("reads both todo syntaxes with tags, tree links and newer attributes", () => {
    const item = { id: "task", title: "#sample Task", group: "", type: "Work", completed: false,
      estimateMin: 30, partial: true, difficulty: 4, priority: "P0", parent: "root", bucket: "A", note: "line\r\nnext" }
    const source = `todo-view: group=category sort=priority group2=tag\n${formatTodoSourceLine(item)}\n---`
    const parsed = parseTimeline(source)
    expect(parsed.todos).toHaveLength(1)
    expect(parsed.todos[0]).toMatchObject({ ...item, tags: ["sample"] })
    expect(groupTodoTree(parsed.todos, parsed.todoView)[0].subs[0].key).toBe("c:Work\nt:sample")
    const changed = updateTodo(source, "task", { title: "#sample Renamed" })
    expect(changed).toContain('note="line\\r\\nnext"')
    expect(parseTimeline(changed).todos[0]).toMatchObject({ ...item, title: "#sample Renamed" })
  })

  it("keeps half completion distinct when grouping by status", () => {
    const items = [{ completed: false }, { completed: false, partial: true }, { completed: true }]
    expect(groupTodoTree(items, { groupBy: "status", sortBy: "manual" }).map(x => x.key))
      .toEqual(["s:open", "s:partial", "s:done"])
  })

  it("toggles a subtree without losing notes, tags or ranked attributes", () => {
    const root = { id: "root", title: "#sample Root", group: "", completed: false, partial: true, estimateMin: 30,
      difficulty: 3, priority: "P0", note: "root note" }
    const child = { id: "child", title: "#sample Child", group: "", completed: false, partial: true, estimateMin: 20,
      difficulty: 4, priority: "P1", note: "child note" }
    const source = insertChildTodo(`${formatTodoSourceLine(root)}\n---`, "root", child)
    const next = parseTimeline(setTodoCompleted(source, "root", true))
    expect(next.todos).toHaveLength(2)
    expect(next.todos[0]).toMatchObject({ id: "root", completed: true, note: root.note, difficulty: 3, priority: "P0", tags: ["sample"] })
    expect(next.todos[1]).toMatchObject({ id: "child", parent: "root", completed: true, note: child.note, difficulty: 4, priority: "P1", tags: ["sample"] })
    expect(next.todos.every(item => !item.partial)).toBe(true)
  })
})
