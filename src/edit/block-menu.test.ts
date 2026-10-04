import { describe, expect, it } from "vitest"
import { buildTodoGroupMenuOptions, buildTodoMenuOptions, buildTodoSortMenuOptions, buildTodoSubGroupMenuOptions, buildTypeMenuOptions } from "./block-menu-model"

describe("block type submenu model", () => {
  it("keeps every type in one secondary menu and marks the current type", () => {
    expect(buildTypeMenuOptions(["开发", "运动", "睡觉"], "开发")).toEqual([
      { title: "开发", type: "开发", checked: true },
      { title: "运动", type: "运动", checked: false },
      { title: "睡觉", type: "睡觉", checked: false },
    ])
  })

  it("deduplicates types while retaining a missing legacy current type", () => {
    expect(buildTypeMenuOptions(["运动", "运动"], "旧类型")).toEqual([
      { title: "旧类型", type: "旧类型", checked: true },
      { title: "运动", type: "运动", checked: false },
    ])
  })
})

describe("todo binding submenu model", () => {
  it("shows unbind first when bound and marks the current todo", () => {
    expect(buildTodoMenuOptions([{ id: "a", title: "任务 A" }, { id: "b", title: "任务 B" }], "a", "取消绑定")).toEqual([
      { title: "取消绑定", todoId: null, checked: false },
      { title: "任务 A", todoId: "a", checked: true },
      { title: "任务 B", todoId: "b", checked: false },
    ])
  })
})

describe("todo grouping menu copy", () => {
  it("shows only the differentiating choice and does not repeat the parent action", () => {
    expect(buildTodoGroupMenuOptions("none", {
      none: "不分组",
      category: "按分类",
      status: "按完成状态",
      tag: "按标签",
    })).toEqual([
      { title: "不分组", value: "none", checked: true },
      { title: "按分类", value: "category", checked: false },
      { title: "按完成状态", value: "status", checked: false },
      { title: "按标签", value: "tag", checked: false },
    ])
  })

  it("secondary grouping offers everything but the primary choice", () => {
    expect(buildTodoSubGroupMenuOptions("category", "tag", {
      none: "不分组",
      category: "按分类",
      status: "按完成状态",
      tag: "按标签",
    })).toEqual([
      { title: "不分组", value: "none", checked: false },
      { title: "按完成状态", value: "status", checked: false },
      { title: "按标签", value: "tag", checked: true },
    ])
  })
})

describe("todo sorting menu copy", () => {
  it("shows only the differentiating choice and does not repeat the parent action", () => {
    expect(buildTodoSortMenuOptions("estimate", {
      manual: "手动排序",
      estimate: "按预计时长",
      actual: "按实际时长",
    })).toEqual([
      { title: "手动排序", value: "manual", checked: false },
      { title: "按预计时长", value: "estimate", checked: true },
      { title: "按实际时长", value: "actual", checked: false },
    ])
  })
})
