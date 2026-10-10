import type { Entry, TodoItem, TodoViewConfig } from "./types"

export const DEFAULT_TODO_VIEW: TodoViewConfig = { groupBy: "none", sortBy: "manual" }

export function formatTodoViewHeaderValue(view: TodoViewConfig): string {
  return `group=${view.groupBy} sort=${view.sortBy}`
}

export function parseTodoViewHeaderValue(value: string): TodoViewConfig | null {
  const fields = Object.fromEntries(value.trim().split(/\s+/).map((part) => part.split("=", 2)))
  const groupBy = fields.group
  const sortBy = fields.sort
  if (!(["none", "category", "status"] as string[]).includes(groupBy)) return null
  if (!(["manual", "estimate", "actual", "difficulty", "priority"] as string[]).includes(sortBy)) return null
  return { groupBy, sortBy } as TodoViewConfig
}

export interface WeeklyTodoDefinition {
  note?: string
  difficulty?: number
  priority?: string
  id: string
  title: string
  group: string
  type?: string
  targetMinutes: number
  order: number
  startDate?: string
  endDate?: string
}

export function isWeeklyTodoDue(todo: WeeklyTodoDefinition, date: string): boolean {
  return (!todo.startDate || date >= todo.startDate) && (!todo.endDate || date <= todo.endDate)
}

const decodeLegacyField = (value: string): string | null => {
  try { return decodeURIComponent(value) } catch { return null }
}

export function formatTodoHeaderValue(todo: Omit<TodoItem, "line"> | TodoItem): string {
  return [
    `id=${JSON.stringify(todo.id)}`,
    `done=${todo.completed ? "true" : "false"}`,
    `estimate=${Math.max(0, Math.round(todo.estimateMin))}`,
    `category=${JSON.stringify(todo.type ?? "")}`,
    `group=${JSON.stringify(todo.group)}`,
    `title=${JSON.stringify(todo.title)}`,
    ...(todo.note ? [`note=${JSON.stringify(todo.note)}`] : []),
    ...(todo.difficulty !== undefined ? [`difficulty=${todo.difficulty}`] : []),
    ...(todo.priority ? [`priority=${JSON.stringify(todo.priority)}`] : []),
  ].join(" ")
}

function parseLegacyTodoHeaderValue(value: string, line: number): TodoItem | null {
  const parts = value.split("|")
  if (parts.length !== 6 || !/^[a-z0-9_-]+$/i.test(parts[0])) return null
  const estimateMin = Number(parts[2])
  const type = decodeLegacyField(parts[3])
  const group = decodeLegacyField(parts[4])
  const title = decodeLegacyField(parts[5])
  if (!Number.isFinite(estimateMin) || estimateMin < 0 || type === null || group === null || !title) return null
  return {
    id: parts[0], completed: parts[1] === "1", estimateMin: Math.round(estimateMin),
    type: type || undefined, group, title, line,
  }
}

function parseReadableFields(value: string): Map<string, string> | null {
  const fields = new Map<string, string>()
  let cursor = 0
  while (cursor < value.length) {
    while (/\s/.test(value[cursor] ?? "")) cursor += 1
    if (cursor >= value.length) break

    const keyMatch = /^([a-z][a-z-]*)=/.exec(value.slice(cursor))
    if (!keyMatch || fields.has(keyMatch[1])) return null
    const key = keyMatch[1]
    cursor += keyMatch[0].length
    if (cursor >= value.length) return null

    let fieldValue: string
    if (value[cursor] === '"') {
      const start = cursor
      cursor += 1
      let escaped = false
      while (cursor < value.length) {
        const character = value[cursor]
        cursor += 1
        if (escaped) {
          escaped = false
        } else if (character === "\\") {
          escaped = true
        } else if (character === '"') {
          break
        }
      }
      const raw = value.slice(start, cursor)
      if (!raw.endsWith('"')) return null
      try {
        const decoded: unknown = JSON.parse(raw)
        if (typeof decoded !== "string") return null
        fieldValue = decoded
      } catch {
        return null
      }
    } else {
      const start = cursor
      while (cursor < value.length && !/\s/.test(value[cursor])) cursor += 1
      fieldValue = value.slice(start, cursor)
      if (!fieldValue) return null
    }
    fields.set(key, fieldValue)
  }
  return fields
}

function parseReadableTodoHeaderValue(value: string, line: number): TodoItem | null {
  const fields = parseReadableFields(value)
  const keys = ["id", "done", "estimate", "category", "group", "title"]
  if (!fields || [...fields.keys()].some((key) => ![...keys, "note", "difficulty", "priority"].includes(key)) || keys.some((key) => !fields.has(key))) return null
  const id = fields.get("id") ?? ""
  const done = fields.get("done")
  const estimate = fields.get("estimate") ?? ""
  const type = fields.get("category") ?? ""
  const group = fields.get("group") ?? ""
  const title = fields.get("title") ?? ""
  const estimateMin = Number(estimate)
  if (!/^[a-z0-9_-]+$/i.test(id) || (done !== "true" && done !== "false") ||
      !/^\d+$/.test(estimate) || !Number.isFinite(estimateMin) || !title) return null
  const difficulty = fields.get("difficulty")
  if (difficulty !== undefined && !/^[1-5]$/.test(difficulty)) return null
  return {
    ...(fields.has("note") ? { note: fields.get("note") } : {}),
    ...(difficulty !== undefined ? { difficulty: Number(difficulty) } : {}),
    ...(fields.has("priority") ? { priority: fields.get("priority") } : {}),
    id,
    completed: done === "true",
    estimateMin: Math.round(estimateMin),
    type: type || undefined,
    group,
    title,
    line,
  }
}

export function parseTodoHeaderValue(value: string, line: number): TodoItem | null {
  return value.trimStart().startsWith("id=")
    ? parseReadableTodoHeaderValue(value.trim(), line)
    : parseLegacyTodoHeaderValue(value, line)
}

export function splitTodoBinding(note: string | undefined): { note?: string; todoId?: string } {
  if (!note) return {}
  const match = /(?:^|\s)\[todo:([a-z0-9_-]+)\]\s*$/i.exec(note)
  if (!match) return { note }
  const clean = note.slice(0, match.index).trim()
  return { note: clean || undefined, todoId: match[1] }
}

export function todoMetrics(todo: TodoItem, entries: Entry[]): { estimateMinutes: number; actualMinutes: number } {
  const bound = entries.filter((entry) => entry.todoId === todo.id)
  const actualMinutes = bound.filter((entry) => !entry.plan).reduce((sum, entry) => sum + entry.endMin - entry.startMin, 0)
  return { estimateMinutes: todo.estimateMin, actualMinutes }
}

/** The checkbox is the single source of completion for new task rows. */
export function formatTodoSourceLine(todo: Omit<TodoItem, "line">): string {
  const fields = formatTodoHeaderValue(todo).replace(/ done=(?:true|false)/, "")
  return `- [${todo.completed ? "x" : todo.partial ? "/" : " "}] todo: ${fields}`
}

export function parseTodoSourceLine(text: string, line: number): TodoItem | null {
  const match = /^- \[([ xX/])\] todo:\s*(id=.*)$/.exec(text)
  if (!match) return null
  const todo = parseTodoHeaderValue(match[2].replace(/^(id="(?:[^"\\]|\\.)*")/, '$1 done=false'), line)
  if (!todo) return null
  todo.completed = /x/i.test(match[1])
  if (match[1] === "/") todo.partial = true
  return todo
}

/** Derived sorting never mutates the authored order; unset/retired tiers follow configured ones. */
export function sortTodoItems<T extends { difficulty?: number; priority?: string }>(items: T[], sortBy: TodoViewConfig["sortBy"], priorities: string[] = ["P1", "P2", "P3"]): T[] {
  const rank = (item: T): number => item.priority && priorities.includes(item.priority) ? priorities.indexOf(item.priority) : priorities.length
  return [...items].sort((a, b) => sortBy === "difficulty" ? (b.difficulty ?? 0) - (a.difficulty ?? 0) : sortBy === "priority" ? rank(a) - rank(b) : 0)
}
