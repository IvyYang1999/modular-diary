/**
 * Modular Diary timeline source parser (mermaid-style fenced block body, without the fences).
 *
 * Grammar v0 (技术方案.md §二):
 *   header:  "key: value" lines (date, range), terminated by an optional "---"
 *   entry:   [plan] HH:MM-HH:MM <type> [note...]
 *   annotation: @HH:MM text...
 *   blank lines and "#" comments are ignored
 *
 * Cross-midnight (D10): an entry starting before rangeStart belongs to the next
 * calendar morning but the same logical day -> shifted +24h internally.
 */
import { parseLayoutHeader, parseRecoverableLayoutHeader } from "./grid-layout"
import { parseBlockSize, parseCanvasWidth } from "./block-size"
import { DEFAULT_TODO_VIEW, parseTodoHeaderValue, parseTodoViewHeaderValue, splitTodoBinding } from "./todos"
import { t as tr } from "../i18n"
import {
  Annotation,
  DAY_MINUTES,
  DEFAULT_RANGE_END,
  DEFAULT_RANGE_START,
  Entry,
  ParseError,
  TimelineDoc,
} from "./types"

const ENTRY_RE = /^(plan\s+)?(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})\s+([^\s]+)(?:\s+(.*))?$/
const MARKER_RE = /^(plan\s+)?@(\d{1,2}):(\d{2})\s+\[([^\]]+)\](?:\s+(.*))?$/
const ANNOTATION_RE = /^@(\d{1,2}):(\d{2})\s+(.*)$/
const HEADER_RE = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/
const RANGE_RE = /^(\d{1,2})(?:-(\d{1,2}))?$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
/** Accept hours 0..30 so sources may write 24:30 / 25:30 directly. */
const MAX_HOUR = 30

function toMinutes(h: string, m: string): number | null {
  const hour = Number(h)
  const minute = Number(m)
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
  if (hour < 0 || hour > MAX_HOUR || minute < 0 || minute > 59) return null
  return hour * 60 + minute
}

/** Normalize [start, end): cross-midnight wrap and D10 range-based shifting. */
export function normalizeSpan(rawStart: number, rawEnd: number, rangeStart: number): [number, number] {
  let start = rawStart
  let end = rawEnd
  if (start < rangeStart) {
    start += DAY_MINUTES
    end += DAY_MINUTES
  }
  if (end <= start) {
    end += DAY_MINUTES
  }
  return [start, end]
}

export interface ParseOptions {
  /** 设置页的默认时间范围（range: 头优先） */
  rangeStart?: number
  rangeEnd?: number
}

export function parseTimeline(source: string, opts: ParseOptions = {}): TimelineDoc {
  const doc: TimelineDoc = {
    rangeStart: opts.rangeStart ?? DEFAULT_RANGE_START,
    rangeEnd: opts.rangeEnd ?? DEFAULT_RANGE_END,
    entries: [],
    annotations: [],
    errors: [],
    hiddenTypes: [],
    hiddenMarkerTypes: [],
    hiddenSlots: [],
    habitSkips: [],
    todos: [],
    todoView: { ...DEFAULT_TODO_VIEW },
    texts: [],
  }

  const lines = source.split(/\r?\n/)
  // `===` splits the block: entry syntax above, free markdown text below (块内图文混排)。
  // 多个 ===  -> 多个文本框（text, text2, …，yyt 2026-08-17）
  const allLines = [...lines]
  const sepIdxs = allLines.map((l, i) => (l.trim() === "===" ? i : -1)).filter((i) => i >= 0)
  if (sepIdxs.length > 0) {
    const first = sepIdxs[0]
    const bounds = [...sepIdxs, allLines.length]
    for (let i = 0; i < bounds.length - 1; i++) {
      doc.texts.push(allLines.slice(bounds[i] + 1, bounds[i + 1]).join("\n").trim())
    }
    lines.splice(first) // 条目区只保留 === 之前
    doc.text = doc.texts[0]
  }
  let inHeader = true
  let sawSeparator = false

  lines.forEach((raw, line) => {
    const text = raw.trim()
    if (text === "" || text.startsWith("#")) return

    if (inHeader && text === "---") {
      inHeader = false
      sawSeparator = true
      return
    }

    if (inHeader) {
      const header = HEADER_RE.exec(text)
      // A line that parses as an entry/annotation ends the header section.
      if (!header || ENTRY_RE.test(text) || MARKER_RE.test(text) || ANNOTATION_RE.test(text)) {
        inHeader = false
      } else {
        applyHeader(doc, header[1].toLowerCase(), header[2].trim(), line, raw)
        return
      }
    }

    const marker = MARKER_RE.exec(text)
    if (marker) {
      const timeMin = toMinutes(marker[2], marker[3])
      const type = marker[4].trim()
      if (timeMin === null || !type) {
        doc.errors.push({ line, text: raw, reason: tr("invalidTime") })
        return
      }
      let value = timeMin
      if (value < doc.rangeStart) value += DAY_MINUTES
      doc.annotations.push({
        timeMin: value,
        text: marker[5]?.trim() ?? "",
        line,
        type,
        plan: Boolean(marker[1]),
      })
      return
    }

    const annotation = ANNOTATION_RE.exec(text)
    if (annotation) {
      const timeMin = toMinutes(annotation[1], annotation[2])
      if (timeMin === null) {
        doc.errors.push({ line, text: raw, reason: tr("invalidTime") })
        return
      }
      let t = timeMin
      if (t < doc.rangeStart) t += DAY_MINUTES // D10, same rule as entries
      const item: Annotation = { timeMin: t, text: annotation[3].trim(), line }
      doc.annotations.push(item)
      return
    }

    const entry = ENTRY_RE.exec(text)
    if (entry) {
      const rawStart = toMinutes(entry[2], entry[3])
      const rawEnd = toMinutes(entry[4], entry[5])
      if (rawStart === null || rawEnd === null) {
        doc.errors.push({ line, text: raw, reason: tr("invalidTime") })
        return
      }
      const [startMin, endMin] = normalizeSpan(rawStart, rawEnd, doc.rangeStart)
      const binding = splitTodoBinding(entry[7]?.trim())
      const item: Entry = {
        plan: Boolean(entry[1]),
        startMin,
        endMin,
        type: entry[6],
        note: binding.note,
        todoId: binding.todoId,
        line,
      }
      doc.entries.push(item)
      return
    }

    doc.errors.push({ line, text: raw, reason: tr("unrecognizedLine") })
  })

  // Axis extends past rangeEnd to cover after-midnight entries (D10 自然延伸).
  for (const e of doc.entries) {
    if (e.endMin > doc.rangeEnd) doc.rangeEnd = e.endMin
  }
  for (const a of doc.annotations) {
    if (a.timeMin > doc.rangeEnd) doc.rangeEnd = a.timeMin
  }

  return doc
}

function applyHeader(doc: TimelineDoc, key: string, value: string, line: number, raw: string): void {
  if (key !== "layout") {
    const recoveredLayout = parseRecoverableLayoutHeader(key, value)
    if (recoveredLayout) {
      doc.layout = recoveredLayout
      return
    }
  }
  switch (key) {
    case "date": {
      if (DATE_RE.test(value)) {
        doc.date = value
      } else {
        doc.errors.push({ line, text: raw, reason: tr("invalidDate") })
      }
      return
    }
    case "range": {
      const m = RANGE_RE.exec(value)
      if (!m) {
        doc.errors.push({ line, text: raw, reason: tr("invalidRangeFormat") })
        return
      }
      const start = Number(m[1])
      const end = m[2] !== undefined ? Number(m[2]) : DEFAULT_RANGE_END / 60
      if (start < 0 || start > 23 || end <= start || end > MAX_HOUR) {
        doc.errors.push({ line, text: raw, reason: tr("rangeOutOfBounds") })
        return
      }
      doc.rangeStart = start * 60
      doc.rangeEnd = end * 60
      return
    }
    case "width": {
      const n = Number(value)
      if (!Number.isFinite(n) || n < 140 || n > 640) {
        doc.errors.push({ line, text: raw, reason: tr("invalidWidth") })
        return
      }
      doc.width = Math.round(n)
      return
    }
    case "block-size": {
      const size = parseBlockSize(value)
      if (!size) {
        doc.errors.push({ line, text: raw, reason: tr("invalidBlockSize") })
        return
      }
      doc.blockSize = size
      return
    }
    case "canvas-width": {
      const width = parseCanvasWidth(value)
      if (width === null) {
        doc.errors.push({ line, text: raw, reason: tr("invalidCanvasWidth") })
        return
      }
      doc.canvasWidth = width
      return
    }
    case "float": {
      if (value === "right") {
        doc.floatRight = true
      } else {
        doc.errors.push({ line, text: raw, reason: tr("floatRightOnly") })
      }
      return
    }
    case "layout": {
      const cols = parseLayoutHeader(value)
      // 旧列式格式（迁移期）静默回退默认网格，不报错
      if (cols) doc.layout = cols
      return
    }
    case "side": {
      if (value === "left" || value === "right") {
        doc.side = value
      } else {
        doc.errors.push({ line, text: raw, reason: tr("sideLeftRightOnly") })
      }
      return
    }
    case "off": {
      const ids = value.split(/[\s,，]+/).filter((t): t is import("./grid-layout").SlotId =>
        ["toolbar", "stats", "dialog", "habits", "todos", "quote"].includes(t) // text/timeline 不允许隐藏
      )
      doc.hiddenSlots.push(...ids)
      return
    }
    case "hide": {
      const types = value.split(/[\s,，]+/).filter((t) => /^\S+$/.test(t))
      if (types.length === 0) {
        doc.errors.push({ line, text: raw, reason: tr("hideNeedsCategory") })
        return
      }
      doc.hiddenTypes.push(...types)
      return
    }
    case "hide-marker": {
      const types = value.split(/[\s,，]+/).filter((t) => /^\S+$/.test(t))
      if (types.length === 0) {
        doc.errors.push({ line, text: raw, reason: tr("hideNeedsCategory") })
        return
      }
      doc.hiddenMarkerTypes.push(...types)
      return
    }
    case "habit-skip": {
      doc.habitSkips.push(...value.split(/[\s,，]+/).filter((id) => /^[a-z0-9_-]+$/i.test(id)))
      return
    }
    case "todo": {
      const todo = parseTodoHeaderValue(value, line)
      if (todo) doc.todos.push(todo)
      else doc.errors.push({ line, text: raw, reason: tr("invalidTodo") })
      return
    }
    case "todo-view": {
      const view = parseTodoViewHeaderValue(value)
      if (view) doc.todoView = view
      else doc.errors.push({ line, text: raw, reason: tr("invalidTodoView") })
      return
    }
    // Legacy quote headers (card designer, retired 2026-09-10): the sentence
    // and its look now live in settings only. Old notes stay error-free.
    case "quote": case "quote-text": case "quote-author": case "quote-theme": case "quote-layout": case "quote-font":
    case "quote-size": case "quote-bg": case "quote-text-color": case "quote-accent": case "quote-image":
    case "quote-overlay": case "quote-image-x": case "quote-image-y": case "quote-image-zoom":
      return
    default:
      doc.errors.push({ line, text: raw, reason: tr("unknownHeaderKey", { key }) })
  }
}
