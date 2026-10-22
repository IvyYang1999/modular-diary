import { describe, expect, it } from "vitest"
import { buildTodoReviewPrompt, DEFAULT_TODO_REVIEW_CHECKLIST } from "./todo-review"

const todos = [
  { id: "a", title: "做产品", estimateMinutes: 0, completed: false, priority: "P0" },
  { id: "b", title: "写周报第一节", estimateMinutes: 45, completed: false, parent: "a", note: "先列提纲" },
  { id: "c", title: "回邮件", estimateMinutes: 15, completed: true },
]

describe("todo review prompt", () => {
  it("names every checklist rule, including a custom one, in the system prompt", () => {
    const { system } = buildTodoReviewPrompt(todos, DEFAULT_TODO_REVIEW_CHECKLIST + "\n周末不安排工作")
    for (const rule of DEFAULT_TODO_REVIEW_CHECKLIST.split("\n")) expect(system).toContain(rule)
    expect(system).toContain("6. 周末不安排工作")
  })
  it("sends the whole list with totals, or one todo with the list as context", () => {
    const whole = buildTodoReviewPrompt(todos, "具体程度").user
    expect(whole).toContain("未完成 2 条，预计合计 45 分钟")
    expect(whole).toContain("  - [ ] 写周报第一节（预计 45 分钟）")
    expect(whole).toContain("备注：先列提纲")
    const one = buildTodoReviewPrompt(todos, "具体程度", "a").user
    expect(one.startsWith("请只 review 这一条待办：\n- [ ] 做产品（未估时，优先级 P0）")).toBe(true)
  })
})
