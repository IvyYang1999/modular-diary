import { describe, expect, it } from "vitest"
import { parseTimeline } from "./parser"
import { flatTodoGroupOrder, formatTodoViewHeaderValue, groupTodoTree, moveTodoGroupKey, parseTodoViewHeaderValue } from "./todos"

describe("todo view rules", () => {
  it("round-trips the block-local grouping and sorting rule", () => {
    const value = { groupBy: "category", sortBy: "estimate" } as const
    expect(formatTodoViewHeaderValue(value)).toBe("group=category sort=estimate")
    expect(parseTodoViewHeaderValue("sort=estimate group=category")).toEqual(value)
    expect(parseTimeline("todo-view: group=category sort=estimate\n---").todoView).toEqual(value)
  })

  it("fails closed for unknown view rules", () => {
    expect(parseTodoViewHeaderValue("group=project sort=manual")).toBeNull()
    expect(parseTodoViewHeaderValue("group=none sort=random")).toBeNull()
  })

  it("round-trips tag grouping and a second level", () => {
    const value = { groupBy: "category", sortBy: "manual", group2: "tag" } as const
    expect(formatTodoViewHeaderValue(value)).toBe("group=category sort=manual group2=tag")
    expect(parseTodoViewHeaderValue("group=category sort=manual group2=tag")).toEqual(value)
    expect(parseTodoViewHeaderValue("group=tag sort=estimate")).toEqual({ groupBy: "tag", sortBy: "estimate" })
  })

  it("drops a second level that is missing a primary or duplicates it", () => {
    expect(formatTodoViewHeaderValue({ groupBy: "none", sortBy: "manual", group2: "tag" })).toBe("group=none sort=manual")
    expect(formatTodoViewHeaderValue({ groupBy: "tag", sortBy: "manual", group2: "tag" })).toBe("group=tag sort=manual")
    expect(parseTodoViewHeaderValue("group=category sort=manual group2=project")).toBeNull()
  })
})

describe("todo group tree", () => {
  const todo = <T extends Record<string, unknown>>(patch: T): T & { completed: boolean } => ({ completed: false, ...patch })
  const keys = <T extends { key: string }>(groups: T[]): string[] => groups.map((group) => group.key)

  it("groups by the first #tag, with untagged last by its label", () => {
    const tree = groupTodoTree([
      todo({ title: "写周报 #工作" }),
      todo({ title: "无标签" }),
      todo({ title: "读论文 #阅读 #论文" }),
    ], { groupBy: "tag", sortBy: "manual" })
    expect(keys(tree)).toEqual(["t:工作", "t:阅读", "t:"])
    expect(tree[0].items[0].title).toBe("写周报 #工作")
    expect(tree[1].label).toBe("#阅读")
    expect(tree[2].label).toBe("无标签")
  })

  it("nests a second grouping level under the primary one", () => {
    const tree = groupTodoTree([
      todo({ type: "开发", title: "甲 #紧急", completed: false }),
      todo({ type: "开发", title: "乙", completed: true }),
      todo({ type: "阅读", title: "丙", completed: false }),
    ], { groupBy: "category", sortBy: "manual", group2: "status" })
    expect(keys(tree)).toEqual(["c:开发", "c:阅读"])
    expect(keys(tree[0].subs)).toEqual([`c:开发\ns:open`, `c:开发\ns:done`])
    expect(tree[0].subs[0].items[0].title).toBe("甲 #紧急")
    expect(tree[0].subs[1].items[0].title).toBe("乙")
    expect(tree[1].subs[0].items[0].title).toBe("丙")
  })

  it("applies the persisted drag order and appends groups it does not know", () => {
    const items = [todo({ type: "a" }), todo({ type: "b" }), todo({ type: "c" })]
    const tree = groupTodoTree(items, { groupBy: "category", sortBy: "manual" }, ["c:b"])
    expect(keys(tree)).toEqual(["c:b", "c:a", "c:c"])
  })

  it("moves a group among its siblings and flattens both levels for persistence", () => {
    const tree = groupTodoTree([
      todo({ type: "a", title: "一 #x" }),
      todo({ type: "a", title: "二 #y" }),
      todo({ type: "b", title: "三" }),
    ], { groupBy: "category", sortBy: "manual", group2: "tag" })
    expect(flatTodoGroupOrder(tree)).toEqual(["c:a", "c:a\nt:x", "c:a\nt:y", "c:b", "c:b\nt:"])
    // A sub-group stays inside its parent.
    expect(moveTodoGroupKey(tree, "c:a\nt:y", 0)).toEqual(["c:a", "c:a\nt:y", "c:a\nt:x", "c:b", "c:b\nt:"])
    // A top-level move keeps its sub-groups attached.
    expect(moveTodoGroupKey(tree, "c:a", 1)).toEqual(["c:b", "c:b\nt:", "c:a", "c:a\nt:x", "c:a\nt:y"])
  })
})

describe("todo-groups header", () => {
  it("reads the persisted group order and ignores malformed values", () => {
    expect(parseTimeline(`todo-groups: ["c:b","c:a\\nt:x"]\n---`).todoGroupOrder).toEqual(["c:b", "c:a\nt:x"])
    const doc = parseTimeline("todo-groups: not json\n---")
    expect(doc.todoGroupOrder).toEqual([])
    expect(doc.errors).toEqual([])
  })
})
