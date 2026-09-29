import { describe, expect, it } from "vitest"
import { extractTags, learnTagCategories, tagCategory, tagMinutes } from "./tags"

describe("tags", () => {
  it("extracts unique tags in order and stops at punctuation", () => {
    expect(extractTags("回了 #飞搜 的两个 issue，#opentrends。再 #飞搜")).toEqual(["飞搜", "opentrends"])
    expect(extractTags("no tags here")).toEqual([])
    expect(extractTags(undefined)).toEqual([])
    expect(extractTags("#a/b-c_1 (#x) [#y]")).toEqual(["a/b-c_1", "x", "y"])
  })

  it("resolves membership from the settings table", () => {
    expect(tagCategory("模块日记", { 模块日记: "开发" })).toBe("开发")
    expect(tagCategory("飞搜", { 模块日记: "开发" })).toBeUndefined()
    expect(tagCategory("x", { x: "" })).toBeUndefined()
  })

  it("learns a category from the first categorized use only", () => {
    const doc = {
      entries: [
        { plan: false, startMin: 0, endMin: 60, type: "开发", tags: ["模块日记", "飞搜"], line: 0 },
        { plan: false, startMin: 60, endMin: 120, type: "写作", tags: ["模块日记"], line: 1 },
      ],
      todos: [{ id: "t", title: "x #官网", group: "", type: "写作", tags: ["官网"], estimateMin: 1, completed: false, line: 2 }],
    }
    expect(learnTagCategories(doc, { 飞搜: "杂事" })).toEqual({ 模块日记: "开发", 官网: "写作" })
    expect(learnTagCategories({ entries: [{ plan: false, startMin: 0, endMin: 1, type: "", tags: ["散"], line: 0 }], todos: [] }, {})).toEqual({ 散: "" })
    expect(learnTagCategories(doc, { 飞搜: "杂事", 模块日记: "开发", 官网: "写作" })).toEqual({})
  })

  it("counts overlapping time once per tag", () => {
    expect(tagMinutes([
      { startMin: 540, endMin: 600, tags: ["o"] },
      { startMin: 570, endMin: 630, tags: ["o"] },
      { startMin: 700, endMin: 710, tags: ["o", "p"] },
    ])).toEqual({ o: 100, p: 10 })
  })

  it("sums actual minutes per tag and ignores plans", () => {
    expect(tagMinutes([
      { plan: false, startMin: 0, endMin: 90, tags: ["a", "b"] },
      { plan: true, startMin: 0, endMin: 30, tags: ["a"] },
      { startMin: 100, endMin: 115, tags: ["b"] },
    ])).toEqual({ a: 90, b: 105 })
  })
})
