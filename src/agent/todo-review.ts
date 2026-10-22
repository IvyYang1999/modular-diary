/**
 * AI review of todos against a user-editable checklist. The model only reads
 * and answers in Markdown; nothing is written back to the note.
 */
export const DEFAULT_TODO_REVIEW_CHECKLIST = [
  "具体程度：每条待办是否具体到可以马上开始（动词 + 对象 + 做完的标准），不够具体的给出改写",
  "单条耗时：预计时长是否合理；超过 2 小时的建议拆成更小的步骤",
  "总量：所有未完成待办的预计时长加起来，是否超出一天可用的时间（按 8 小时算）",
  "可行性：这些待办组合在一起是否可行，有没有互相冲突或明显遗漏的前置条件",
  "优先级：最重要的事是否清楚，P0 不要超过 3 条",
].join("\n")

export interface ReviewTodo {
  id: string
  title: string
  estimateMinutes: number
  completed: boolean
  partial?: boolean
  type?: string
  note?: string
  difficulty?: number
  priority?: string
  parent?: string
}

export interface TodoReviewPrompt { system: string; user: string }

function line(todo: ReviewTodo, depth: number): string {
  const state = todo.completed ? "[x]" : todo.partial ? "[/]" : "[ ]"
  const attrs = [
    todo.estimateMinutes > 0 ? `预计 ${todo.estimateMinutes} 分钟` : "未估时",
    todo.type ? `分类 ${todo.type}` : "",
    todo.priority ? `优先级 ${todo.priority}` : "",
    todo.difficulty ? `难度 ${todo.difficulty}/5` : "",
  ].filter(Boolean).join("，")
  const note = todo.note ? `\n${"  ".repeat(depth + 1)}备注：${todo.note.replace(/\n/g, " ")}` : ""
  return `${"  ".repeat(depth)}- ${state} ${todo.title}（${attrs}）${note}`
}

/** The whole list, or one todo (`focusId`) read against the rest for context. */
export function buildTodoReviewPrompt(todos: ReviewTodo[], checklist: string, focusId?: string): TodoReviewPrompt {
  const rules = checklist.split("\n").map((rule) => rule.trim()).filter(Boolean)
  const depthOf = (todo: ReviewTodo): number => {
    let depth = 0
    for (let parent = todo.parent; parent && depth < 6; depth++) parent = todos.find((item) => item.id === parent)?.parent
    return depth
  }
  const list = todos.map((todo) => line(todo, depthOf(todo))).join("\n")
  const open = todos.filter((todo) => !todo.completed)
  const total = open.reduce((sum, todo) => sum + Math.max(0, todo.estimateMinutes), 0)
  const focus = focusId ? todos.find((todo) => todo.id === focusId) : undefined
  const system = [
    "你是一位务实的计划教练，帮用户检查日记里的待办清单。",
    "严格按下面的检查清单逐条评价，每一条都要用它原本的名字作小标题，哪怕结论是「没问题」。",
    "检查清单：",
    ...rules.map((rule, index) => `${index + 1}. ${rule}`),
    "回答用中文 Markdown：先一句话总评，再按检查清单逐条写；需要改写的待办直接给出改写后的标题。",
    "不要编造用户没写的事实；信息不够时说明还需要什么。只回答文字，不要输出 JSON。",
  ].join("\n")
  const user = focus
    ? `请只 review 这一条待办：\n${line(focus, 0)}\n\n供参考的完整清单：\n${list}`
    : `请 review 今天的整个待办清单（未完成 ${open.length} 条，预计合计 ${total} 分钟）：\n${list}`
  return { system, user }
}
