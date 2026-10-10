/**
 * Insert a new entry line into a timeline block source, keeping entries
 * sorted by start time. Pure string surgery; the caller (dialog) locates
 * the code block in the note via MarkdownPostProcessorContext.
 */
import { parseTimeline } from "../core/parser"
import { formatEntryLine } from "../core/format"
import { MIN_TIMELINE_SPAN_MINUTES } from "../core/duration"
import { formatTodoSourceLine } from "../core/todos"
import { parseRecoverableLayoutHeader } from "../core/grid-layout"
import type { TodoItem } from "../core/types"

/** Insert sourceLine into source. Returns the new block source. */
export function insertEntryLine(source: string, sourceLine: string, newStartMin: number): string {
  const lines = source.split("\n")
  // Drop trailing blank lines so we insert before the fence, not after them.
  let tail = lines.length
  while (tail > 0 && lines[tail - 1].trim() === "") tail--
  const body = lines.slice(0, tail)
  const trailing = lines.slice(tail)

  const doc = parseTimeline(source)
  // `===` 文字区边界：条目必须插在文字区之前（yyt 2026-08-17 踩坑：无条目时
  // 追加到末尾，落进文字区变成普通文本，色块不出现）
  const sepIdx = body.findIndex((l) => l.trim() === "===")
  const boundary = sepIdx >= 0 ? sepIdx : body.length

  // Entry lines sorted in source; find the last entry starting <= newStartMin.
  const entryLines = doc.entries.map((e) => e.line).sort((a, b) => a - b)
  let insertAt = -1
  for (const e of doc.entries) {
    if (e.startMin <= newStartMin && (insertAt === -1 || e.line > insertAt)) {
      insertAt = e.line
    }
  }
  if (insertAt >= 0) {
    body.splice(insertAt + 1, 0, sourceLine)
  } else {
    // Before the first entry; after header/separator if present; never past ===.
    const firstEntry = entryLines[0]
    body.splice(firstEntry !== undefined ? firstEntry : boundary, 0, sourceLine)
  }
  return [...body, ...trailing].join("\n")
}

/** Insert a categorized point marker in stable timestamp/source order. */
export function insertMarkerLine(source: string, sourceLine: string, timeMin: number): string {
  const lines = source.split("\n")
  const doc = parseTimeline(source)
  const boundary = lines.findIndex((line) => line.trim() === "===")
  const end = boundary >= 0 ? boundary : lines.length
  let insertAt = -1
  for (const marker of doc.annotations) {
    if (marker.timeMin <= timeMin && marker.line < end) insertAt = Math.max(insertAt, marker.line)
  }
  if (insertAt >= 0) {
    lines.splice(insertAt + 1, 0, sourceLine)
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

/** Delete the 0-based line from the block source. */
export function deleteEntryLine(source: string, line: number): string {
  const lines = source.split("\n")
  if (line < 0 || line >= lines.length) throw new Error(`行号越界：${line}`)
  lines.splice(line, 1)
  return lines.join("\n")
}

export function insertTodo(source: string, todo: Omit<TodoItem, "line">): string {
  const lines = source.split("\n")
  const todos = parseTimeline(source).todos
  const separator = lines.findIndex((line) => line.trim() === "---")
  const at = todos.length > 0 ? todos[todos.length - 1].line + 1 : (separator >= 0 ? separator : 0)
  lines.splice(at, 0, formatTodoSourceLine(todo))
  return lines.join("\n")
}

export function updateTodo(source: string, id: string, patch: Partial<Omit<TodoItem, "id" | "line">>): string {
  const current = parseTimeline(source).todos.find((todo) => todo.id === id)
  if (!current) return source
  const unchanged = Object.entries(patch).every(([key, value]) => {
    const previous = current[key as keyof TodoItem]
    if (key === "note") return (value ?? "") === (previous ?? "")
    if (key === "partial") return Boolean(value) === Boolean(previous)
    return value === previous
  })
  if (unchanged) return source
  const lines = source.split("\n")
  let updated = formatTodoSourceLine({ ...current, ...patch })
  // Preserve authored JSON escaping/spacing inside the note unless its value changed.
  if (patch.note === undefined || patch.note === current.note) {
    const rawNote = /(?:^|\s)note=("(?:[^"\\]|\\.)*")/.exec(lines[current.line])
    if (rawNote) updated = updated.replace(/note="(?:[^"\\]|\\.)*"/, () => `note=${rawNote[1]}`)
  }
  lines[current.line] = updated
  return lines.join("\n")
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
  const values = ordered.map((todo) => lines[todo.line])
  todoLines.forEach((line, index) => { lines[line] = values[index] })
  return lines.join("\n")
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
  let idx = lines.findIndex((l) => re.test(l.trim()))
  if (idx < 0 && key.toLowerCase() === "layout") {
    const candidates = lines.flatMap((line, index) => {
      const match = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line.trim())
      return match && match[1].toLowerCase() !== "layout"
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
  // Insert before the --- separator if present, else at the top.
  const sep = lines.findIndex((l) => l.trim() === "---")
  lines.splice(sep >= 0 ? sep : 0, 0, `${key}: ${value}`)
  return lines.join("\n")
}

/** Remove a header key entirely (no-op when absent). */
export function removeHeaderValue(source: string, key: string): string {
  const lines = source.split("\n")
  const re = new RegExp(`^${key}\\s*:`)
  const idx = lines.findIndex((l) => re.test(l.trim()))
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

/** Set/replace the Nth free-text section (`===` 分隔，可多个). Empty text keeps a placeholder. */
export function setTextSection(source: string, text: string, index = 0): string {
  const lines = source.split("\n")
  const sepIdxs = lines.map((l, i) => (l.trim() === "===" ? i : -1)).filter((i) => i >= 0)
  const trimmed = text.trim()
  if (sepIdxs.length === 0 || index >= sepIdxs.length) {
    // 目标不存在 -> 追加新区（index 0 等价于创建）
    const head = [...lines]
    while (head.length > 0 && head[head.length - 1].trim() === "") head.pop()
    return [...head, "===", ...(trimmed === "" ? [] : trimmed.split("\n"))].join("\n")
  }
  const start = sepIdxs[index]
  const end = index + 1 < sepIdxs.length ? sepIdxs[index + 1] : lines.length
  const replacement = trimmed === "" ? ["==="] : ["===", ...trimmed.split("\n")]
  lines.splice(start, end - start, ...replacement)
  return lines.join("\n")
}

/** Remove the Nth text section entirely（删除文本框）。 */
export function removeTextSection(source: string, index: number): string {
  const lines = source.split("\n")
  const sepIdxs = lines.map((l, i) => (l.trim() === "===" ? i : -1)).filter((i) => i >= 0)
  if (index >= sepIdxs.length) return source
  const start = sepIdxs[index]
  const end = index + 1 < sepIdxs.length ? sepIdxs[index + 1] : lines.length
  lines.splice(start, end - start)
  return lines.join("\n")
}

/** Add a component to the block's `off:` header (hide a slot). */
export function addOffSlot(source: string, id: string): string {
  const lines = source.split("\n")
  const idx = lines.findIndex((l) => /^off\s*:/.test(l.trim()))
  if (idx >= 0) {
    const existing = lines[idx].split(":")[1].split(/[\s,，]+/).filter(Boolean)
    if (existing.includes(id)) return source
    lines[idx] = `off: ${[...existing, id].join(" ")}`
    return lines.join("\n")
  }
  const sep = lines.findIndex((l) => l.trim() === "---")
  lines.splice(sep >= 0 ? sep : 0, 0, `off: ${id}`)
  return lines.join("\n")
}

/** Remove a component from the `off:` header (re-show a hidden slot). */
export function removeOffSlot(source: string, id: string): string {
  const lines = source.split("\n")
  const idx = lines.findIndex((l) => /^off\s*:/.test(l.trim()))
  if (idx < 0) return source
  const remaining = lines[idx].split(":")[1].split(/[\s,，]+/).filter((t) => t && t !== id)
  if (remaining.length === 0) {
    lines.splice(idx, 1)
  } else {
    lines[idx] = `off: ${remaining.join(" ")}`
  }
  return lines.join("\n")
}
