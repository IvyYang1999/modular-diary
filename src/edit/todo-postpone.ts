import { parseTimeline } from "../core/parser"
import { formatTodoSourceLine } from "../core/todos"
import type { TodoItem } from "../core/types"
import { timelineFences } from "./block-identity"
import { insertTodo, replaceBlockInContent } from "./source-rewriter"

export function nextTodoDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("invalid-todo-date")
  const date = new Date(value + "T12:00:00Z")
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("invalid-todo-date")
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

const equalTodo = (a: Omit<TodoItem, "line">, b: Omit<TodoItem, "line">): boolean =>
  formatTodoSourceLine(a) === formatTodoSourceLine(b)

/** Idempotent copy. Preserve unrelated prose/fences and fail on a conflicting ID. */
export function appendPostponedTodo(content: string, date: string, todo: TodoItem): string {
  if (todo.completed) throw new Error("completed-todo-cannot-postpone")
  const fences = [...timelineFences(content)]
  const sameId = fences.flatMap((fence) => { const doc = parseTimeline(fence.source); return doc.todos.filter((item) => item.id === todo.id).map((item) => ({ date: doc.date, item })) })
  if (sameId.length > 0) {
    if (sameId.length === 1 && sameId[0].date === date && equalTodo(sameId[0].item, todo)) return content
    throw new Error("postponed-todo-id-conflict")
  }
  const targets = fences.filter((fence) => parseTimeline(fence.source).date === date)
  if (targets.length > 1) throw new Error("ambiguous-tomorrow-timeline")
  if (targets.length === 1) {
    const target = targets[0]
    if (parseTimeline(target.source).errors.length) throw new Error("invalid-tomorrow-timeline")
    return replaceBlockInContent(content, target, insertTodo(target.source, todo))
  }
  const block = "```timeline\n" + insertTodo(`date: ${date}\n---`, todo) + "\n```\n"
  return content + (content && !content.endsWith("\n\n") ? "\n\n" : "") + block
}

/** Copy-first means a failed destination write never removes the original. */
export async function transferPostponedTodo(io: {
  copy: () => Promise<void>
  verifyCopy: () => Promise<boolean>
  removeOriginal: () => Promise<void>
}): Promise<void> {
  await io.copy()
  if (!await io.verifyCopy()) throw new Error("postponed-todo-not-durable")
  await io.removeOriginal()
}

/** A postponed row is removed without erasing historical timeline bindings. */
export function removePostponedTodo(source: string, expected: TodoItem): string {
  const matches = parseTimeline(source).todos.filter((item) => item.id === expected.id)
  if (matches.length !== 1 || !equalTodo(matches[0], expected)) throw new Error("postponed-todo-source-changed")
  const lines = source.split("\n")
  lines.splice(matches[0].line, 1)
  return lines.join("\n")
}
