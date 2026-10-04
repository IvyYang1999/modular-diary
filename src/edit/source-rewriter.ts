/**
 * Insert a new entry line into a timeline block source, keeping entries
 * sorted by start time. Pure string surgery; the caller (dialog) locates
 * the code block in the note via MarkdownPostProcessorContext.
 */
import { parseTimeline } from "../core/parser"
import { bodyExtent, escapeSectionLine, headerInsertIndex, headerZone, TEXT_SEPARATOR_RE } from "../core/body-extent"
import { formatBodyLines, formatEntryLine, formatSpanLine } from "../core/format"
import { MIN_TIMELINE_SPAN_MINUTES } from "../core/duration"
import { formatTodoHeaderValue, indexTodoTree } from "../core/todos"
import { parseRecoverableLayoutHeader } from "../core/grid-layout"
import type { TodoItem } from "../core/types"


/** Insert sourceLine into source. Returns the new block source. */
export function insertEntryLine(source: string, sourceLine: string, newStartMin: number): string {
  return insertEntryLineAt(source, sourceLine, newStartMin).source
}

/** Same as insertEntryLine, and says which line the new one landed on. */
export function insertEntryLineAt(source: string, sourceLine: string, newStartMin: number): { source: string; line: number } {
  const lines = source.split("\n")
  // Drop trailing blank lines so we insert before the fence, not after them.
  let tail = lines.length
  while (tail > 0 && lines[tail - 1].trim() === "") tail--
  const body = lines.slice(0, tail)
  const trailing = lines.slice(tail)

  const doc = parseTimeline(source)
  // `===` 文字区边界：条目必须插在文字区之前（yyt 2026-08-17 踩坑：无条目时
  // 追加到末尾，落进文字区变成普通文本，色块不出现）
  const sepIdx = body.findIndex((l) => TEXT_SEPARATOR_RE.test(l))
  const boundary = sepIdx >= 0 ? sepIdx : body.length

  // Entries and diary spans share one time order; find the last one starting <= newStartMin.
  const timed = [...doc.entries, ...doc.spans]
  const entryLines = timed.map((e) => e.line).sort((a, b) => a - b)
  let insertAt = -1
  for (const e of timed) {
    if (e.startMin <= newStartMin && (insertAt === -1 || e.line > insertAt)) {
      insertAt = e.line
    }
  }
  let at: number
  if (insertAt >= 0) {
    at = insertAt + 1 + bodyExtent(body, insertAt)
  } else {
    // Before the first entry; after header/separator if present; never past ===.
    const firstEntry = entryLines[0]
    at = firstEntry !== undefined ? firstEntry : boundary
  }
  body.splice(at, 0, sourceLine)
  return { source: [...body, ...trailing].join("\n"), line: at }
}

/** Insert a categorized point marker in stable timestamp/source order. */
export function insertMarkerLine(source: string, sourceLine: string, timeMin: number): string {
  const lines = source.split("\n")
  const doc = parseTimeline(source)
  const boundary = lines.findIndex((line) => TEXT_SEPARATOR_RE.test(line))
  const end = boundary >= 0 ? boundary : lines.length
  let insertAt = -1
  for (const marker of doc.annotations) {
    if (marker.timeMin <= timeMin && marker.line < end) insertAt = Math.max(insertAt, marker.line)
  }
  if (insertAt >= 0) {
    lines.splice(insertAt + 1 + bodyExtent(lines, insertAt), 0, sourceLine)
  } else {
    const firstMarker = doc.annotations.find((marker) => marker.line < end)?.line
    lines.splice(firstMarker ?? end, 0, sourceLine)
  }
  return lines.join("\n")
}

/** Replace the 0-based line inside the block source. */
export function replaceEntryLine(source: string, line: number, newLine: string): string {
  const lines = source.split("\n")
  if (line < 0 || line >= lines.length) throw new Error(`行号越界：${line}`)
  lines[line] = newLine
  return lines.join("\n")
}

/** Atomically replace one categorized point with the canonical five-minute span. */
export function convertMarkerToEntry(source: string, line: number): string {
  const marker = parseTimeline(source).annotations.find((item) => item.line === line && item.type)
  if (!marker?.type) return source
  return replaceEntryLine(source, line, formatEntryLine({
    plan: Boolean(marker.plan),
    startMin: marker.timeMin,
    endMin: marker.timeMin + MIN_TIMELINE_SPAN_MINUTES,
    type: marker.type,
    note: marker.text || undefined,
  }))
}

/** Delete the 0-based line from the block source, together with its diary body. */
export function deleteEntryLine(source: string, line: number): string {
  const lines = source.split("\n")
  if (line < 0 || line >= lines.length) throw new Error(`行号越界：${line}`)
  lines.splice(line, 1 + bodyExtent(lines, line))
  return lines.join("\n")
}

/** Replace the diary body under an entry, marker or span line (undefined removes it). */
export function setItemBody(source: string, line: number, body: string | undefined): string {
  const lines = source.split("\n")
  if (line < 0 || line >= lines.length) throw new Error(`行号越界：${line}`)
  lines.splice(line + 1, bodyExtent(lines, line), ...formatBodyLines(body))
  return lines.join("\n")
}

/** Add a header line after the last line with the same key, else before `---`, else at the top. */
export function insertHeaderLine(source: string, key: string, line: string): string {
  const lines = source.split("\n")
  const re = new RegExp(`^${key}\\s*:`)
  const zone = headerZone(lines)
  let last = -1
  for (let i = 0; i < zone.end; i += 1) if (re.test(lines[i].trim())) last = i
  lines.splice(last >= 0 ? last + 1 : headerInsertIndex(lines), 0, line)
  return lines.join("\n")
}

/** Insert a categoryless diary span in time order, with an optional body. */
export function insertSpanLine(source: string, span: { startMin: number; endMin: number; text?: string; body?: string }): string {
  // Body goes right under the line just inserted: never "the first span with these times".
  const inserted = insertEntryLineAt(source, formatSpanLine(span), span.startMin)
  return span.body === undefined ? inserted.source : setItemBody(inserted.source, inserted.line, span.body)
}

export function insertTodo(source: string, todo: Omit<TodoItem, "line">): string {
  const lines = source.split("\n")
  const todos = parseTimeline(source).todos
  const at = todos.length > 0 ? todos[todos.length - 1].line + 1 : headerInsertIndex(lines)
  lines.splice(at, 0, `todo: ${formatTodoHeaderValue(todo)}`)
  return lines.join("\n")
}

/** Insert a sub-todo right after its parent's subtree, keeping the source in preorder. */
export function insertChildTodo(source: string, parentId: string, todo: Omit<TodoItem, "line">): string {
  const doc = parseTimeline(source)
  const parent = doc.todos.find((item) => item.id === parentId)
  if (!parent) return insertTodo(source, todo)
  const subtree = new Set([parentId, ...indexTodoTree(doc.todos).descendantIds(parentId)])
  const lastLine = Math.max(...doc.todos.filter((item) => subtree.has(item.id)).map((item) => item.line))
  const lines = source.split("\n")
  lines.splice(lastLine + 1, 0, `todo: ${formatTodoHeaderValue({ ...todo, parent: parentId })}`)
  return lines.join("\n")
}

export function updateTodo(source: string, id: string, patch: Partial<Omit<TodoItem, "id" | "line">>): string {
  const current = parseTimeline(source).todos.find((todo) => todo.id === id)
  if (!current) return source
  const lines = source.split("\n")
  lines[current.line] = `todo: ${formatTodoHeaderValue({ ...current, ...patch })}`
  return lines.join("\n")
}

/**
 * Toggle a todo. Descendants follow the toggle; afterwards each ancestor is
 * done exactly when all of its children are. All of it is written back line
 * by line, so the markdown stays the truth.
 */
export function setTodoCompleted(source: string, id: string, completed: boolean): string {
  const doc = parseTimeline(source)
  if (!doc.todos.some((todo) => todo.id === id)) return source
  const tree = indexTodoTree(doc.todos)
  const done = new Map(doc.todos.map((todo) => [todo.id, todo.completed]))
  const changed = new Set<string>([id, ...tree.descendantIds(id)])
  for (const sub of changed) done.set(sub, completed)
  let cursor = tree.parentOf(id)
  while (cursor) {
    const children = tree.childrenOf(cursor)
    const next = children.length > 0 && children.every((child) => done.get(child.id))
    if (done.get(cursor) !== next) { done.set(cursor, next); changed.add(cursor) }
    cursor = tree.parentOf(cursor)
  }
  const lines = source.split("\n")
  for (const todo of doc.todos) {
    if (changed.has(todo.id)) lines[todo.line] = `todo: ${formatTodoHeaderValue({ ...todo, completed: done.get(todo.id)! })}`
  }
  return lines.join("\n")
}

/** Delete a todo together with its whole subtree (and entry bindings of each). */
export function deleteTodoSubtree(source: string, id: string): string {
  const doc = parseTimeline(source)
  const ids = new Set([id, ...indexTodoTree(doc.todos).descendantIds(id)])
  // Descending line order keeps the remaining line numbers valid mid-surgery.
  const doomed = doc.todos.filter((todo) => ids.has(todo.id)).sort((a, b) => b.line - a.line)
  let out = source
  for (const todo of doomed) out = deleteTodo(out, todo.id)
  return out
}

export function deleteTodo(source: string, id: string): string {
  const current = parseTimeline(source).todos.find((todo) => todo.id === id)
  if (!current) return source
  const lines = source.split("\n")
  lines.splice(current.line, 1)
  const marker = new RegExp(`\\s*\\[todo:${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\s*$`, "i")
  return lines.map((line) => line.replace(marker, "")).join("\n")
}

export function moveTodo(source: string, id: string, targetIndex: number): string {
  const doc = parseTimeline(source)
  const currentIndex = doc.todos.findIndex((todo) => todo.id === id)
  if (currentIndex < 0) return source
  const ordered = [...doc.todos]
  const [moved] = ordered.splice(currentIndex, 1)
  ordered.splice(Math.max(0, Math.min(targetIndex, ordered.length)), 0, moved)
  const lines = source.split("\n")
  const todoLines = doc.todos.map((todo) => todo.line).sort((a, b) => a - b)
  const values = ordered.map((todo) => `todo: ${formatTodoHeaderValue(todo)}`)
  todoLines.forEach((line, index) => { lines[line] = values[index] })
  return lines.join("\n")
}

/** The whole subtree as one block, in source order. */
function subtreeOf(doc: { todos: TodoItem[] }, id: string): TodoItem[] {
  const ids = new Set([id, ...indexTodoTree(doc.todos).descendantIds(id)])
  return doc.todos.filter((todo) => ids.has(todo.id))
}

/** Move a todo and its subtree as one block; `targetIndex` counts the todos left after the move. */
export function moveTodoSubtree(source: string, id: string, targetIndex: number): string {
  const doc = parseTimeline(source)
  if (!doc.todos.some((todo) => todo.id === id)) return source
  const subtree = subtreeOf(doc, id)
  const subtreeIds = new Set(subtree.map((todo) => todo.id))
  const ordered = doc.todos.filter((todo) => !subtreeIds.has(todo.id))
  ordered.splice(Math.max(0, Math.min(targetIndex, ordered.length)), 0, ...subtree)
  const lines = source.split("\n")
  const todoLines = doc.todos.map((todo) => todo.line).sort((a, b) => a - b)
  const values = ordered.map((todo) => `todo: ${formatTodoHeaderValue(todo)}`)
  todoLines.forEach((line, index) => { lines[line] = values[index] })
  return lines.join("\n")
}

/** Move a subtree so it lands right after `anchorId`'s subtree (parent's last child slot). */
export function moveTodoSubtreeAfter(source: string, id: string, anchorId: string): string {
  const doc = parseTimeline(source)
  const subtreeIds = new Set(subtreeOf(doc, id).map((todo) => todo.id))
  // An anchor that is missing or inside the moved subtree degrades to "append at the end".
  if (!doc.todos.some((todo) => todo.id === anchorId) || subtreeIds.has(anchorId)) return moveTodoSubtree(source, id, doc.todos.length)
  const anchorTree = indexTodoTree(doc.todos)
  // The parent link is already updated, so the anchor's subtree would swallow the moved
  // item itself; measure the anchor's subtree without it.
  const anchorIds = new Set([anchorId, ...anchorTree.descendantIds(anchorId)].filter((id) => !subtreeIds.has(id)))
  // Last subtree member in source order, robust to a non-preorder hand-edited source.
  const last = doc.todos.filter((todo) => anchorIds.has(todo.id)).reduce((acc, todo) => (todo.line > acc.line ? todo : acc))
  const rest = doc.todos.filter((todo) => !subtreeIds.has(todo.id))
  return moveTodoSubtree(source, id, rest.findIndex((todo) => todo.id === last.id) + 1)
}

/**
 * Re-parent a todo (undefined = back to a root) and park it in preorder:
 * as the new parent's last child, or after the last root when freed.
 */
export function setTodoParent(source: string, id: string, parent: string | undefined): string {
  const doc = parseTimeline(source)
  const tree = indexTodoTree(doc.todos)
  if (!doc.todos.some((todo) => todo.id === id)) return source
  if (parent && (parent === id || new Set(tree.descendantIds(id)).has(parent))) return source
  const out = updateTodo(source, id, { parent })
  if (!parent) {
    const anchor = lastRootId(parseTimeline(out).todos, id)
    return anchor === null ? out : moveTodoSubtreeAfter(out, id, anchor)
  }
  // Park as the parent's last child; when it already is the only child, the anchor is the parent itself.
  const siblings = indexTodoTree(parseTimeline(out).todos).childrenOf(parent).filter((child) => child.id !== id)
  if (siblings.length === 0) return moveTodoSubtreeAfter(out, id, parent)
  return moveTodoSubtreeAfter(out, id, siblings[siblings.length - 1].id)
}

/** The last root that is not the moved subtree itself; null when it is the only root. */
function lastRootId(todos: TodoItem[], id: string): string | null {
  const tree = indexTodoTree(todos)
  const roots = tree.roots.filter((root) => root.id !== id)
  return roots.length > 0 ? roots[roots.length - 1].id : null
}

/**
 * Put a todo into a cell and at a position there, in one change: before
 * `beforeId`, or after the last todo already in that cell (its place in the
 * source is otherwise kept).
 */
export function placeTodoInBucket(source: string, id: string, bucket: string, beforeId: string | null): string {
  let out = updateTodo(source, id, { bucket: bucket || undefined })
  const todos = parseTimeline(out).todos
  const rest = todos.filter((todo) => todo.id !== id)
  let target = -1
  if (beforeId) target = rest.findIndex((todo) => todo.id === beforeId)
  else {
    const lastInCell = rest.map((todo) => (todo.bucket ?? "") === bucket).lastIndexOf(true)
    if (lastInCell >= 0) target = lastInCell + 1
  }
  if (target >= 0) out = moveTodoSubtree(out, id, target)
  return out
}

export function setEntryTodoBinding(source: string, line: number, todoId: string | null): string {
  const entry = parseTimeline(source).entries.find((candidate) => candidate.line === line)
  if (!entry) return source
  return replaceEntryLine(source, line, formatEntryLine({ ...entry, todoId: todoId ?? undefined }))
}

export function addHabitSkip(source: string, id: string): string {
  const doc = parseTimeline(source)
  if (doc.habitSkips.includes(id)) return source
  return setHeaderValue(source, "habit-skip", [...doc.habitSkips, id].join(" "))
}

export function removeHabitSkip(source: string, id: string): string {
  const remaining = parseTimeline(source).habitSkips.filter((value) => value !== id)
  return remaining.length > 0
    ? setHeaderValue(source, "habit-skip", remaining.join(" "))
    : removeHeaderValue(source, "habit-skip")
}

/** Add a type to the block's `hide:` header (per-day highlighter hiding). */
export function addHiddenType(source: string, type: string, tool: "span" | "marker" = "span"): string {
  const header = tool === "marker" ? "hide-marker" : "hide"
  const lines = source.split("\n")
  const re = new RegExp(`^${header}\\s*:`)
  const idx = lines.findIndex((l) => re.test(l.trim()))
  if (idx >= 0) {
    const existing = lines[idx].split(":")[1].split(/[\s,，]+/).filter(Boolean)
    if (existing.includes(type)) return source
    lines[idx] = `${header}: ${[...existing, type].join(" ")}`
    return lines.join("\n")
  }
  // No hide header yet: insert at the top (header order doesn't matter to the parser).
  return `${header}: ${type}\n${source}`
}

/** Remove a type from the block's `hide:` header (re-show a hidden highlighter). */
export function removeHiddenType(source: string, type: string, tool: "span" | "marker" = "span"): string {
  const header = tool === "marker" ? "hide-marker" : "hide"
  const lines = source.split("\n")
  const re = new RegExp(`^${header}\\s*:`)
  const idx = lines.findIndex((l) => re.test(l.trim()))
  if (idx < 0) return source
  const remaining = lines[idx].split(":")[1].split(/[\s,，]+/).filter((t) => t && t !== type)
  if (remaining.length === 0) {
    lines.splice(idx, 1) // drop the header entirely when nothing is hidden anymore
  } else {
    lines[idx] = `${header}: ${remaining.join(" ")}`
  }
  return lines.join("\n")
}

/** Set a header key (width/float/hide...), updating in place or inserting into the header zone. */
export function setHeaderValue(source: string, key: string, value: string): string {
  const lines = source.split("\n")
  const re = new RegExp(`^${key}\\s*:`)
  // Only the header zone holds headers: a "layout: x" line in a text section is text.
  const zoneEnd = headerZone(lines).end
  let idx = lines.findIndex((l, i) => i < zoneEnd && re.test(l.trim()))
  if (idx < 0 && key.toLowerCase() === "layout") {
    const candidates = lines.flatMap((line, index) => {
      const match = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line.trim())
      return index < zoneEnd && match && match[1].toLowerCase() !== "layout"
        && parseRecoverableLayoutHeader(match[1], match[2].trim())
        ? [index]
        : []
    })
    // One unambiguous typo may be canonicalized in place. Multiple candidates
    // stay visible for manual resolution instead of guessing which one owns the layout.
    if (candidates.length === 1) idx = candidates[0]
  }
  if (idx >= 0) {
    lines[idx] = `${key}: ${value}`
    return lines.join("\n")
  }
  lines.splice(headerInsertIndex(lines), 0, `${key}: ${value}`)
  return lines.join("\n")
}

/** Remove a header key entirely (no-op when absent). */
export function removeHeaderValue(source: string, key: string): string {
  const lines = source.split("\n")
  const re = new RegExp(`^${key}\\s*:`)
  const zoneEnd = headerZone(lines).end
  const idx = lines.findIndex((l, i) => i < zoneEnd && re.test(l.trim()))
  if (idx < 0) return source
  lines.splice(idx, 1)
  return lines.join("\n")
}

/**
 * Replace a fenced block's body inside whole-note content, preserving any
 * callout/quote prefix (e.g. "> ") of the opening fence on every body line.
 * Without this, editing a timeline inside `> [!note|right]` would break the callout.
 */
export function replaceBlockInContent(
  content: string,
  section: { lineStart: number; lineEnd: number },
  newSource: string
): string {
  const lines = content.split("\n")
  const openFence = lines[section.lineStart] ?? ""
  const prefix = /^(\s*(?:>\s*)*)/.exec(openFence)?.[1] ?? ""
  const body = newSource.split("\n").map((l) => (l === "" ? prefix.trimEnd() : prefix + l))
  lines.splice(section.lineStart + 1, section.lineEnd - section.lineStart - 1, ...body)
  return lines.join("\n")
}

/**
 * Read the current body of a fenced timeline block from whole-note content.
 * This is the inverse of replaceBlockInContent and deliberately reads from the
 * live editor/file instead of a render-time source snapshot.
 */
export function extractBlockSourceFromContent(
  content: string,
  section: { lineStart: number; lineEnd: number }
): string | null {
  const lines = content.split("\n")
  if (
    section.lineStart < 0
    || section.lineEnd <= section.lineStart
    || section.lineEnd >= lines.length
  ) return null

  const openFence = lines[section.lineStart] ?? ""
  const prefix = /^(\s*(?:>\s*)*)/.exec(openFence)?.[1] ?? ""
  const opening = /^(`{3,}|~{3,})\s*timeline(?:\s.*)?$/i.exec(openFence.slice(prefix.length).trim())
  if (!opening) return null
  const closeFence = (lines[section.lineEnd] ?? "").slice(prefix.length).trim()
  if (closeFence !== opening[1]) return null

  const emptyQuotedLine = prefix.trimEnd()
  return lines
    .slice(section.lineStart + 1, section.lineEnd)
    .map((line) => {
      if (prefix === "") return line
      if (line.startsWith(prefix)) return line.slice(prefix.length)
      if (line === emptyQuotedLine) return ""
      // A mismatched quote/callout prefix means the section no longer describes
      // one coherent fenced block. Refuse the write instead of corrupting it.
      return null
    })
    .reduce<string[] | null>((body, line) => {
      if (body === null || line === null) return null
      body.push(line)
      return body
    }, [])
    ?.join("\n") ?? null
}

/**
 * Remove one complete fenced timeline block from whole-note content.
 * Validation deliberately reuses extractBlockSourceFromContent so a stale
 * section can never delete an unrelated fence or surrounding prose/callout.
 */
export function removeTimelineBlockFromContent(
  content: string,
  section: { lineStart: number; lineEnd: number }
): string | null {
  if (extractBlockSourceFromContent(content, section) === null) return null
  const lines = content.split("\n")
  lines.splice(section.lineStart, section.lineEnd - section.lineStart + 1)
  return lines.join("\n")
}

/** Set/replace the Nth free-text section (`===` 分隔，可多个). Empty text keeps a placeholder; a new section may carry a title. */
export function setTextSection(source: string, text: string, index = 0, title?: string): string {
  const lines = source.split("\n")
  const sepIdxs = lines.map((l, i) => (TEXT_SEPARATOR_RE.test(l) ? i : -1)).filter((i) => i >= 0)
  const trimmed = text.trim()
  if (sepIdxs.length === 0 || index >= sepIdxs.length) {
    // 目标不存在 -> 追加新区（index 0 等价于创建）
    const head = [...lines]
    while (head.length > 0 && head[head.length - 1].trim() === "") head.pop()
    return [...head, separatorLine(title), ...(trimmed === "" ? [] : trimmed.split("\n").map(escapeSectionLine))].join("\n")
  }
  const start = sepIdxs[index]
  const end = index + 1 < sepIdxs.length ? sepIdxs[index + 1] : lines.length
  // The separator line (and its title) stays as written.
  const replacement = trimmed === "" ? [lines[start]] : [lines[start], ...trimmed.split("\n").map(escapeSectionLine)]
  lines.splice(start, end - start, ...replacement)
  return lines.join("\n")
}

function separatorLine(title: string | undefined): string {
  const clean = (title ?? "").replace(/\s+/g, " ").trim()
  return clean ? `=== ${clean}` : "==="
}

/** Rename (or untitle) the Nth text section. */
export function setTextTitle(source: string, index: number, title: string | undefined): string {
  const lines = source.split("\n")
  const sepIdxs = lines.map((l, i) => (TEXT_SEPARATOR_RE.test(l) ? i : -1)).filter((i) => i >= 0)
  if (index >= sepIdxs.length) return source
  lines[sepIdxs[index]] = separatorLine(title)
  return lines.join("\n")
}

/** Remove the Nth text section entirely（删除文本框）。 */
export function removeTextSection(source: string, index: number): string {
  const lines = source.split("\n")
  const sepIdxs = lines.map((l, i) => (TEXT_SEPARATOR_RE.test(l) ? i : -1)).filter((i) => i >= 0)
  if (index >= sepIdxs.length) return source
  const start = sepIdxs[index]
  const end = index + 1 < sepIdxs.length ? sepIdxs[index + 1] : lines.length
  lines.splice(start, end - start)
  return lines.join("\n")
}

/** Add a component to the block's `off:` header (hide a slot). */
export function addOffSlot(source: string, id: string): string {
  const lines = source.split("\n")
  const zoneEnd = headerZone(lines).end
  const idx = lines.findIndex((l, i) => i < zoneEnd && /^off\s*:/.test(l.trim()))
  if (idx >= 0) {
    const existing = lines[idx].split(":")[1].split(/[\s,，]+/).filter(Boolean)
    if (existing.includes(id)) return source
    lines[idx] = `off: ${[...existing, id].join(" ")}`
    return lines.join("\n")
  }
  lines.splice(headerInsertIndex(lines), 0, `off: ${id}`)
  return lines.join("\n")
}

/** Remove a component from the `off:` header (re-show a hidden slot). */
export function removeOffSlot(source: string, id: string): string {
  const lines = source.split("\n")
  const zoneEnd = headerZone(lines).end
  const idx = lines.findIndex((l, i) => i < zoneEnd && /^off\s*:/.test(l.trim()))
  if (idx < 0) return source
  const remaining = lines[idx].split(":")[1].split(/[\s,，]+/).filter((t) => t && t !== id)
  if (remaining.length === 0) {
    lines.splice(idx, 1)
  } else {
    lines[idx] = `off: ${remaining.join(" ")}`
  }
  return lines.join("\n")
}
