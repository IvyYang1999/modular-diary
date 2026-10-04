import type { Entry, TodoItem, TodoSubGroupBy, TodoViewConfig } from "./types"
import { extractTags } from "./tags"
import { t } from "../i18n"

export const DEFAULT_TODO_VIEW: TodoViewConfig = { groupBy: "none", sortBy: "manual" }

/** A view rule is kept clean: no secondary grouping without or equal to the primary one. */
export function normalizeTodoView(view: TodoViewConfig): TodoViewConfig {
  const group2 = view.groupBy !== "none" && view.group2 && view.group2 !== view.groupBy ? view.group2 : undefined
  return { groupBy: view.groupBy, sortBy: view.sortBy, ...(group2 ? { group2 } : {}), ...(view.layout && view.layout !== "list" ? { layout: view.layout } : {}) }
}

export function formatTodoViewHeaderValue(view: TodoViewConfig): string {
  const normalized = normalizeTodoView(view)
  return `group=${normalized.groupBy} sort=${normalized.sortBy}${normalized.group2 ? ` group2=${normalized.group2}` : ""}${normalized.layout && normalized.layout !== "list" ? ` layout=${normalized.layout}` : ""}`
}

export function parseTodoViewHeaderValue(value: string): TodoViewConfig | null {
  const fields = Object.fromEntries(value.trim().split(/\s+/).map((part) => part.split("=", 2)))
  const groupBy = fields.group
  const sortBy = fields.sort
  const group2 = fields.group2
  const layout = fields.layout ?? "list"
  if (!(["none", "category", "status", "tag"] as string[]).includes(groupBy)) return null
  if (!(["manual", "estimate", "actual"] as string[]).includes(sortBy)) return null
  if (group2 !== undefined && !(["category", "status", "tag"] as string[]).includes(group2)) return null
  if (!(["list", "abc", "matrix"] as string[]).includes(layout)) return null
  return normalizeTodoView({ groupBy, sortBy, ...(group2 ? { group2 } : {}), ...(layout !== "list" ? { layout } : {}) } as TodoViewConfig)
}

/** Cells of each layout, in reading order: key written to `bucket=`, and its i18n label. */
export const TODO_BUCKETS = {
  abc: [["A", "bucketA"], ["B", "bucketB"], ["C", "bucketC"]],
  matrix: [["q1", "bucketQ1"], ["q2", "bucketQ2"], ["q3", "bucketQ3"], ["q4", "bucketQ4"]],
} as const

/* ── grouping ── */

/** Joins the levels of a composite group key (a `todo-groups:` entry); newline survives JSON round-trips escaped. */
export const TODO_GROUP_SEP = "\n"

export interface TodoGroupable {
  type?: string
  completed: boolean
  tags?: string[]
  title?: string
}

/** Stable, locale-free identity of an item's group: `c:分类` / `s:open|s:done` / `t:标签` (empty value = none). */
export function todoGroupKey(item: TodoGroupable, by: TodoSubGroupBy): string {
  if (by === "category") return `c:${item.type ?? ""}`
  if (by === "status") return item.completed ? "s:done" : "s:open"
  const tag = item.tags?.[0] ?? (item.title ? extractTags(item.title)[0] : undefined)
  return `t:${tag ?? ""}`
}

/** Display label for a (possibly composite) group key. */
export function todoGroupLabel(key: string): string {
  const leaf = key.includes(TODO_GROUP_SEP) ? key.slice(key.lastIndexOf(TODO_GROUP_SEP) + 1) : key
  const value = leaf.slice(2)
  if (leaf.startsWith("c:")) return value || t("noCategory")
  if (leaf.startsWith("s:")) return value === "done" ? t("complete") : t("incomplete")
  return value ? `#${value}` : t("noTag")
}

export interface TodoGroupLeaf<T> {
  /** Composite key when nested (`parent\nchild`). */
  key: string
  label: string
  items: T[]
}

export interface TodoGroupNode<T> extends TodoGroupLeaf<T> {
  /** Second-level groups; empty when the view has no group2. */
  subs: TodoGroupLeaf<T>[]
}

/**
 * Group items one level deep. Derived order: open-before-done for status,
 * label localeCompare otherwise; then the persisted drag order applies —
 * known keys first in persisted order, new keys after in derived order.
 */
export function groupTodoItems<T extends TodoGroupable>(items: T[], by: TodoSubGroupBy, order: string[] = [], prefix = ""): TodoGroupLeaf<T>[] {
  const buckets = new Map<string, T[]>()
  for (const item of items) {
    const key = `${prefix}${todoGroupKey(item, by)}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(item)
    else buckets.set(key, [item])
  }
  const keys = [...buckets.keys()]
  // The "none" bucket (no category / no tag) always comes last, not into the label sort.
  const emptyKey = (key: string): boolean => /(?:^|\n)[ct]:$/.test(key)
  if (by === "status") keys.sort((a, b) => Number(a.endsWith(":done")) - Number(b.endsWith(":done")))
  else keys.sort((a, b) => Number(emptyKey(a)) - Number(emptyKey(b)) || todoGroupLabel(a).localeCompare(todoGroupLabel(b)))
  const position = new Map(order.map((key, index) => [key, index]))
  keys.sort((a, b) => {
    const pa = position.get(a), pb = position.get(b)
    if (pa === undefined && pb === undefined) return 0
    if (pa === undefined) return 1
    if (pb === undefined) return -1
    return pa - pb
  })
  return keys.map((key) => ({ key, label: todoGroupLabel(key), items: buckets.get(key)! }))
}

/** Two-level grouping for the todo list. Only call with groupBy ≠ "none". */
export function groupTodoTree<T extends TodoGroupable>(items: T[], view: TodoViewConfig, order: string[] = []): TodoGroupNode<T>[] {
  return groupTodoItems(items, view.groupBy as TodoSubGroupBy, order).map((node) => ({
    key: node.key,
    label: node.label,
    items: view.group2 ? [] : node.items,
    subs: view.group2 ? groupTodoItems(node.items, view.group2, order, `${node.key}${TODO_GROUP_SEP}`) : [],
  }))
}

/** The persisted shape: top-level keys each followed by their sub-group keys. */
export function flatTodoGroupOrder<T>(tree: TodoGroupNode<T>[]): string[] {
  return tree.flatMap((node) => [node.key, ...node.subs.map((sub) => sub.key)])
}

/** Move a group (any level; sub-groups stay inside their parent) and return the new flat order. */
export function moveTodoGroupKey<T>(tree: TodoGroupNode<T>[], key: string, targetIndex: number): string[] {
  const moveIn = <X extends { key: string }>(list: X[]): X[] => {
    const from = list.findIndex((group) => group.key === key)
    if (from < 0) return list
    const next = [...list]
    const [moved] = next.splice(from, 1)
    next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, moved)
    return next
  }
  const nextTree = key.includes(TODO_GROUP_SEP)
    ? tree.map((node) => node.key === key.slice(0, key.indexOf(TODO_GROUP_SEP)) ? { ...node, subs: moveIn(node.subs) } : node)
    : moveIn(tree)
  return flatTodoGroupOrder(nextTree)
}

/* ── sub-todos (`parent=`) ── */

export interface TodoTreeIndex<T> {
  /** Roots in item order; an item whose parent is missing or cyclic is a root. */
  roots: T[]
  childrenOf: (id: string) => T[]
  parentOf: (id: string) => string | null
  depthOf: (id: string) => number
  /** All descendant ids in preorder. */
  descendantIds: (id: string) => string[]
  rootOf: (id: string) => T
}

/**
 * Derive the todo tree from `parent=` links. The tree never depends on line
 * adjacency: a reordered source still renders the same hierarchy, with each
 * sibling list in source order.
 */
export function indexTodoTree<T extends { id: string; parent?: string }>(items: T[]): TodoTreeIndex<T> {
  const byId = new Map(items.map((item) => [item.id, item]))
  const effectiveParent = new Map<string, string | null>()
  for (const item of items) {
    let parent = item.parent && byId.has(item.parent) ? item.parent : null
    if (parent) {
      // Cycle check: walk the raw parent chain up from the candidate parent.
      const seen = new Set<string>([item.id])
      let cursor: string | null = parent
      while (cursor && byId.has(cursor)) {
        if (seen.has(cursor)) { parent = null; break }
        seen.add(cursor)
        cursor = byId.get(cursor)?.parent ?? null
      }
    }
    effectiveParent.set(item.id, parent)
  }
  const children = new Map<string, T[]>()
  const roots: T[] = []
  for (const item of items) {
    const parent = effectiveParent.get(item.id) ?? null
    if (!parent) { roots.push(item); continue }
    const siblings = children.get(parent) ?? []
    siblings.push(item)
    children.set(parent, siblings)
  }
  const parentOf = (id: string): string | null => effectiveParent.get(id) ?? null
  const depthOf = (id: string): number => {
    let depth = 0
    let cursor = parentOf(id)
    while (cursor) { depth += 1; cursor = parentOf(cursor) }
    return depth
  }
  const descendantIds = (id: string): string[] => {
    const out: string[] = []
    const walk = (parent: string): void => {
      for (const child of children.get(parent) ?? []) {
        out.push(child.id)
        walk(child.id)
      }
    }
    walk(id)
    return out
  }
  const rootOf = (id: string): T => {
    let current = byId.get(id) ?? items[0]
    let cursor = parentOf(current.id)
    while (cursor) {
      current = byId.get(cursor)!
      cursor = parentOf(cursor)
    }
    return current
  }
  return {
    roots,
    childrenOf: (id) => children.get(id) ?? [],
    parentOf,
    depthOf,
    descendantIds,
    rootOf,
  }
}

export interface WeeklyTodoDefinition {
  id: string
  title: string
  group: string
  type?: string
  targetMinutes: number
  order: number
  startDate?: string
  endDate?: string
  /** Free-text note shown in small type under the title. */
  note?: string
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
    ...(todo.due ? [`due=${todo.due}`] : []),
    ...(todo.moved ? [`moved=${todo.moved}`] : []),
    ...(todo.day ? [`day=${todo.day}`] : []),
    ...(todo.bucket ? [`bucket=${JSON.stringify(todo.bucket)}`] : []),
    ...(todo.note ? [`note=${JSON.stringify(todo.note)}`] : []),
    ...(todo.parent ? [`parent=${JSON.stringify(todo.parent)}`] : []),
    `title=${JSON.stringify(todo.title)}`,
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
    type: type || undefined, group, title, tags: extractTags(title), line,
  }
}

export function parseReadableFields(value: string): Map<string, string> | null {
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
  const optional = ["due", "moved", "day", "bucket", "note", "parent"]
  if (!fields || keys.some((key) => !fields.has(key)) || [...fields.keys()].some((key) => !keys.includes(key) && !optional.includes(key))) return null
  const due = fields.get("due")
  const moved = fields.get("moved")
  const day = fields.get("day")
  if ([due, moved, day].some((value) => value !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(value))) return null
  const id = fields.get("id") ?? ""
  const done = fields.get("done")
  const estimate = fields.get("estimate") ?? ""
  const type = fields.get("category") ?? ""
  const group = fields.get("group") ?? ""
  const title = fields.get("title") ?? ""
  const parent = fields.get("parent")
  const estimateMin = Number(estimate)
  if (!/^[a-z0-9_-]+$/i.test(id) || (done !== "true" && done !== "false") ||
      !/^\d+$/.test(estimate) || !Number.isFinite(estimateMin) || !title) return null
  if (parent !== undefined && !/^[a-z0-9_-]+$/i.test(parent)) return null
  return {
    id,
    completed: done === "true",
    estimateMin: Math.round(estimateMin),
    type: type || undefined,
    group,
    title,
    tags: extractTags(title),
    ...(due ? { due } : {}),
    ...(moved ? { moved } : {}),
    ...(day ? { day } : {}),
    ...(fields.get("bucket") ? { bucket: fields.get("bucket") } : {}),
    ...(fields.get("note") ? { note: fields.get("note") } : {}),
    ...(parent && parent !== id ? { parent } : {}),
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
