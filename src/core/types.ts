/**
 * oneday core types — pure TS, zero Obsidian deps.
 * Markdown source is the single source of truth; these are the parsed forms.
 */

export interface TimelineDoc {
  /** YYYY-MM-DD, optional in source (falls back to note name/frontmatter at render time). */
  date?: string
  /** Axis start, minutes from midnight. Default 7*60. */
  rangeStart: number
  /** Axis end, minutes from midnight (may exceed 1440 when the axis extends past midnight, D10). */
  rangeEnd: number
  entries: Entry[]
  annotations: Annotation[]
  errors: ParseError[]
  /** Per-block hidden highlighters (`hide:` header); global palette minus these is shown. */
  hiddenTypes: string[]
  /** Per-block hidden point categories (`hide-marker:`), independent from spans. */
  hiddenMarkerTypes: string[]
  /** Per-block width override in px (`width:` header, base width without the label lane). */
  width?: number
  /** Outer Oneday viewport size; internal components keep their own geometry and scroll behind it. */
  blockSize?: import("./block-size").BlockSize
  /** Pixel width occupied by the first 12 logical grid columns after the viewport is resized. */
  canvasWidth?: number
  /** Float the block right so text wraps on the left (`float: right` header). */
  floatRight?: boolean
  /** Free markdown text sections (=== 分隔，可多个) — 块内图文混排的文。 */
  texts: string[]
  /** 兼容读取：第一个文本区 */
  text?: string
  /** 时间轴栏在左还是右（`side: left`，默认右）。 */
  side?: "left" | "right"
  /** 组件网格布局（`layout:` 头，id\@x,y,w,h）；缺省按 side/text 推导。 */
  layout?: import("./grid-layout").GridItem[]
  /** 隐藏的组件（`off:` 头，如 off: stats dialog）；更多菜单可重新显示 */
  hiddenSlots: import("./grid-layout").SlotId[]
  /** Per-day exceptions for global recurring habits. */
  habitSkips: string[]
  /** Todo items stored in repeated `todo:` headers. */
  todos: TodoItem[]
  /** Block-local presentation rule for the Todo component. */
  todoView: TodoViewConfig
}

export interface Entry {
  /** plan-layer block (低透明度背景，实际块覆盖其上) */
  plan: boolean
  /** Minutes from midnight; may exceed 1440 for after-midnight entries (D10). */
  startMin: number
  endMin: number
  /** Task type key; color comes from settings mapping (D2). */
  type: string
  note?: string
  /** Stable binding to a Todo item in this Oneday block. */
  todoId?: string
  /** 0-based source line inside the code block, for write-back. */
  line: number
}

export interface TodoItem {
  id: string
  title: string
  group: string
  type?: string
  estimateMin: number
  completed: boolean
  line: number
}

export type TodoGroupBy = "none" | "category" | "status"
export type TodoSortBy = "manual" | "estimate" | "actual"
export type TimelineDrawTool = "span" | "marker"

export interface TodoViewConfig {
  groupBy: TodoGroupBy
  sortBy: TodoSortBy
}

export interface Annotation {
  timeMin: number
  text: string
  line: number
  /** Categorized annotations are interactive point-in-time markers. Omitted for legacy `@HH:MM text`. */
  type?: string
  /** Uses the same actual/plan layer semantics as duration blocks. */
  plan?: boolean
}

export interface ParseError {
  line: number
  text: string
  reason: string
}

export const DEFAULT_RANGE_START = 7 * 60
export const DEFAULT_RANGE_END = 23 * 60
export const DAY_MINUTES = 24 * 60
