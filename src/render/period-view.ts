import type { UpcomingItem } from "../core/upcoming"
import type { PeriodScope, RhythmBoardRow } from "../core/rhythm-ledger"
import { clearPillPreviews, dayHead, renderActualMonth, renderPlanCalendar, renderRhythmBoard } from "./plan-view"
import { laneLayout } from "../core/period-lanes"
import { parsePeriodStatsWidget, shareSlices, type PeriodStatsWidget } from "../core/period-stats"
/**
 * Period block (`days:`), redesigned 2026-09-29 after yyt's review.
 *
 * Left: a resizable rail built from the same parts as a day block — goals
 * (editable in place), the period's todo list (the day todo component
 * itself, so rows look and behave identically) and bar totals.
 * Right: a week calendar — one continuous grid with shared hour lines, an
 * all-day band of compact pills, and each day's timeline read from its note.
 *
 * Period todos are the block's own `todo:` lines. A todo is unplaced, placed
 * all-day on a day (`day=`), or planned at a time (a plan block in that
 * day's note). Every change goes back through deps; the markdown is the truth.
 */
import { setIcon } from "obsidian"
import { blockTextColor } from "../core/contrast"
import { formatHours } from "../core/duration"
import type { GoalProgress, ResolvedPeriod } from "../core/period"
import type { Entry, PeriodGoal, PeriodSpec, SpanNote, TodoItem, TodoViewConfig } from "../core/types"
import { attachTagSuggest, type TagSuggestDeps } from "../edit/tag-suggest"
import { setPointerInteractionActive } from "../edit/pointer-interaction"
import { t } from "../i18n"
import { renderTodosInto, type NewTodoInput, type TodoViewItem } from "./todos-view"

export interface PeriodTodoView extends TodoItem {
  actualMinutes: number
  /** Where the todo sits in the period: all-day on a date, or planned at a time. */
  placement?: { date: string; startMin?: number }
  /** Set on items that belong to another period (the month seen from a week, or the reverse): where they come from. */
  foreign?: string
  /** The period note that item lives in, so a drop writes there. */
  foreignScope?: PeriodScope
}

export interface PeriodDayView {
  date: string
  entries: Entry[]
  spans: SpanNote[]
  /** Period todos placed all-day on this date. */
  allDay: PeriodTodoView[]
  /** Future schedule items (Upcoming.md) not yet copied into this day's diary. */
  upcoming?: UpcomingItem[]
  /** Items of the other period kind placed on this date (shown, not moved). */
  foreign?: PeriodTodoView[]
  /** Habits ticked by hand that day (rhythm ids). */
  habitDone?: string[]
  hasNote: boolean
}

export interface PeriodViewModel {
  spec: PeriodSpec
  /** True while browsing a period other than the one written in `days:`. */
  browsing: boolean
  period: ResolvedPeriod
  today: string
  goals: GoalProgress[]
  totals: Array<{ type: string; minutes: number }>
  /** Extra statistics widgets under the bar totals (`period-stats:` tokens). */
  statsWidgets?: string[]
  todos: PeriodTodoView[]
  todoView: TodoViewConfig
  /** Dragged todo group order (`todo-groups:` header). */
  todoGroupOrder: string[]
  days: PeriodDayView[]
  rangeStartMin: number
  rangeEndMin: number
  indexReady: boolean
  railWidth: number
  /** Week or month when the range is exactly one; the plan face needs it. */
  scope?: PeriodScope
  face: "plan" | "actual"
  /** Protocol board rows (plan face). */
  board: RhythmBoardRow[]
  /** Set when a day block embeds this period: which switch is active. */
  embeddedView?: "week" | "month"
  /** Fixed block height in px; the rail and the calendar scroll inside it. Absent: the block grows with its content. */
  height?: number
  /** Every todo of the overlapping periods of the other kind, for plan entries bound to them. */
  foreignTodos?: PeriodTodoView[]
  /** Month cells: also show placed todos (the plan face shows rhythm slots and schedule items regardless). */
  showTodos?: boolean
}

export interface GoalDraft { kind: PeriodGoal["kind"]; key: string; targetMinutes: number; note?: string; done?: boolean }

export interface PeriodViewDeps {
  typeColors: Record<string, string>
  categories: string[]
  priorities?: string[]
  tagStyle?: (tag: string) => { background: string; color: string } | null
  tagSuggest?: TagSuggestDeps
  onShift: (direction: 1 | -1) => void
  onToday: () => void
  /** Write the period being browsed back into `days:`. */
  onPin: () => void
  onOpenDay: (date: string) => void
  /** Place all-day on a date, or back to unplaced with POOL_ZONE. */
  onAssign: (id: string, to: string) => void
  onPlan: (id: string, date: string, startMin: number) => void
  onAdd: (input: NewTodoInput) => void
  onEdit: (id: string, input: NewTodoInput) => void
  onToggle: (id: string, completed: boolean) => void | Promise<void>
  onDelete: (id: string) => void
  onMove: (id: string, targetIndex: number) => void
  /** Reorder a todo group among its same-level siblings (composite group key). */
  onMoveGroup?: (key: string, targetIndex: number) => void
  /** Session state for collapsed parent todos, drop-on-row re-parenting. */
  collapsed?: (id: string) => boolean
  onToggleCollapse?: (id: string) => void
  onReparent?: (id: string, parentId: string) => void
  onGroupMenu: (x: number, y: number) => void
  onSortMenu: (x: number, y: number) => void
  onTodoMenu?: (id: string, x: number, y: number, edit: () => void, addChild: (() => void) | null) => void
  onSaveGoal: (line: number | null, goal: GoalDraft) => void
  onDeleteGoal: (line: number) => void
  /** Tick or untick a written goal. */
  onToggleGoal?: (line: number, done: boolean) => void
  onRailWidth: (px: number) => void
  /** Offer the statistics widgets that can be added (menu at x, y). */
  onAddStatsWidget?: (x: number, y: number) => void
  /** Remove one statistics widget by its header token. */
  onRemoveStatsWidget?: (token: string) => void
  onSetFace?: (face: "plan" | "actual") => void
  /** Day block embedding: switch between day / week / month. */
  onSwitchView?: (view: "day" | "week" | "month") => void
  onRhythmMenu?: (rhythmId: string, x: number, y: number) => void
  /** Right-click on one slot (row or pill): skip it this period, let an owed one go, edit the rhythm. */
  onSlotMenu?: (todo: PeriodTodoView, x: number, y: number) => void
  /** An accumulation row dropped on a day / band: a todo of that rhythm placed there (null = all day). */
  onSession?: (id: string, date: string, zone: "am" | "pm" | "ev" | null) => void
  onOpenRhythms?: () => void
  /** Reorder a rhythm in the note: before `beforeId`, or last when null. */
  onReorderRhythm?: (id: string, beforeId: string | null) => void
  /** The block's fixed height was dragged (0 = back to the default). */
  onHeight?: (px: number) => void
  /** Month plan: toggle todos in the cells. */
  onToggleShowTodos?: () => void
}

/** Starting hour height; the rendered block adapts it to the rail's height (22–40px). */
export const PERIOD_HOUR_HEIGHT = 28
export const PERIOD_HOUR_MIN = 22
export const PERIOD_HOUR_MAX = 40
export const PERIOD_SNAP_MINUTES = 30
export const RAIL_DEFAULT = 248
const ALLDAY_VISIBLE = 3
export const POOL_ZONE = "pool"
export const RAIL_MIN = 180
export const RAIL_MAX = 420
export const HEIGHT_MIN = 320
export const HEIGHT_MAX = 1400

export const clock = (minutes: number): string => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
const monthDay = (date: string): string => date.slice(5).replace("-", ".")
const weekdayIndex = (date: string): number => {
  const [y, m, d] = date.split("-").map(Number)
  return new Date(y, m - 1, d).getDay()
}
export const weekday = (date: string): string => `${t("weekdayPrefix")}${t("weekdayNames").split(" ")[weekdayIndex(date)] ?? ""}`
/** Spans read as clock durations (40m, 2h25m); sums and goals as hours with one decimal. */
export function formatSpan(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60), rest = m % 60
  return rest === 0 ? `${h}h` : `${h}h${rest}m`
}
export function formatTotal(minutes: number): string {
  const h = Math.round(minutes / 6) / 10
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`
}
export const shortDate = (date: string): string => `${Number(date.slice(5, 7))}.${Number(date.slice(8))}`
/** Title without `#tags`: pills, ghosts and blocks show what the todo is, not how it is filed. */
export const plainTitle = (title: string): string => title.replace(/#[^\s#]+/g, "").replace(/\s+/g, " ").trim() || title
function isoWeek(date: string): number {
  const [y, m, d] = date.split("-").map(Number)
  const value = new Date(Date.UTC(y, m - 1, d))
  const day = value.getUTCDay() || 7
  value.setUTCDate(value.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1))
  return Math.ceil(((value.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
}

function tint(color: string): { background: string; color: string } {
  return {
    background: `color-mix(in srgb, ${color} 20%, var(--background-primary))`,
    color: `color-mix(in srgb, ${color} 72%, var(--text-normal))`,
  }
}

function badge(parent: HTMLElement, text: string, style: { background: string; color: string } | null): HTMLElement {
  const el = parent.createEl("span", { cls: "modular-diary-tag", text })
  if (style) {
    el.classList.add("has-category")
    el.style.setProperty("--modular-diary-tag-bg", style.background)
    el.style.setProperty("--modular-diary-tag-fg", style.color)
  }
  return el
}

export function iconButton(parent: HTMLElement, icon: string, label: string, cls = ""): HTMLButtonElement {
  const button = parent.createEl("button", { cls: `modular-diary-period-icon${cls ? " " + cls : ""}`, attr: { type: "button", "aria-label": label } })
  setIcon(button, icon)
  return button
}

/* ── drag: list rows and calendar pills move between the list, all-day cells and a day's hours ── */

interface DragSubject {
  todo: PeriodTodoView
  from: string
  /** A protocol board row: dropping on another row reorders the rhythms. */
  rhythmId?: string
  /** Board rows without slots (measured rhythms) only reorder; they never land on a day. */
  reorderOnly?: boolean
  /** A period todo row: dropping on another todo row reorders the list. */
  todoRow?: boolean
  /** An accumulation row: every drop makes a session; the row stays where it is. */
  session?: boolean
}

export function attachDrag(root: HTMLElement, handle: HTMLElement, subject: DragSubject, model: PeriodViewModel, deps: PeriodViewDeps): void {
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest("button, input, select, textarea, form")) return
    const dom = root.ownerDocument
    const startX = event.clientX, startY = event.clientY
    let ghost: HTMLElement | null = null
    let zone: HTMLElement | null = null
    let preview: HTMLElement | null = null
    let startMin = 0
    const color = subject.todo.type ? deps.typeColors[subject.todo.type] : undefined
    const duration = Math.max(PERIOD_SNAP_MINUTES, subject.todo.estimateMin || PERIOD_SNAP_MINUTES)
    let rowTarget: { row: HTMLElement; before: boolean } | null = null
    const clear = (): void => {
      zone?.classList.remove("is-over"); preview?.remove(); preview = null; zone = null
      rowTarget?.row.classList.remove("is-drop-before", "is-drop-after"); rowTarget = null
    }
    // Near an edge of the note or of the calendar strip, keep scrolling so far targets stay reachable.
    let lastX = startX, lastY = startY, scrollFrame = 0
    const win = dom.defaultView
    const scrollers = ((): HTMLElement[] => {
      const out: HTMLElement[] = []
      const cal = root.querySelector<HTMLElement>(".modular-diary-period-cal-scroll")
      if (cal) out.push(cal)
      for (let node = root.parentElement; node; node = node.parentElement) {
        const style = win?.getComputedStyle(node)
        if (style && /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) { out.push(node); break }
      }
      return out
    })()
    const autoscroll = (): void => {
      scrollFrame = 0
      if (!ghost) return
      let moved = false
      for (const scroller of scrollers) {
        const rect = scroller.getBoundingClientRect()
        const edge = 40, step = 10
        const dy = lastY < rect.top + edge ? -step : lastY > rect.bottom - edge ? step : 0
        const dx = lastX < rect.left + edge && lastX >= rect.left ? -step : lastX > rect.right - edge && lastX <= rect.right ? step : 0
        if (dy && scroller.scrollHeight > scroller.clientHeight) { scroller.scrollTop += dy; moved = true }
        if (dx && scroller.scrollWidth > scroller.clientWidth) { scroller.scrollLeft += dx; moved = true }
      }
      if (moved && win) scrollFrame = win.requestAnimationFrame(autoscroll)
    }
    const canPlan = Boolean(subject.todo.type)
    const minutesAt = (axis: HTMLElement, clientY: number): number => {
      const rect = axis.getBoundingClientRect()
      const raw = model.rangeStartMin + ((clientY - rect.top) / rect.height) * (model.rangeEndMin - model.rangeStartMin) - duration / 2
      const snapped = Math.round(raw / PERIOD_SNAP_MINUTES) * PERIOD_SNAP_MINUTES
      return Math.max(model.rangeStartMin, Math.min(snapped, model.rangeEndMin - duration))
    }
    // While a drag is in flight the block must not be redrawn under it (that is how ghosts got stranded).
    const owner = root.closest<HTMLElement>(".modular-diary-container")
    let finished = false
    const onMove = (move: PointerEvent): void => {
      if (finished) return
      if (!ghost) {
        if (Math.hypot(move.clientX - startX, move.clientY - startY) < 4) return
        ghost = dom.createElement("div")
        ghost.className = "modular-diary-plan-pill is-ghost"
        ghost.createEl("span", { cls: "modular-diary-plan-pill-text", text: plainTitle(subject.todo.title) })
        if (color) ghost.style.setProperty("--pc", color)
        dom.body.appendChild(ghost)
        root.classList.add("is-dragging")
        handle.classList.add("is-drag-source")
        if (owner) setPointerInteractionActive(owner, true)
      }
      // The pill rides under the pointer, not beside it.
      ghost.style.transform = `translate(${move.clientX - 14}px, ${move.clientY - 14}px)`
      lastX = move.clientX; lastY = move.clientY
      if (!scrollFrame && win) scrollFrame = win.requestAnimationFrame(autoscroll)
      const hit = dom.elementFromPoint(move.clientX, move.clientY)
      // Over another board row: this is a reorder, not a placement.
      const row = subject.rhythmId ? (hit?.closest(".modular-diary-plan-row[data-rhythm]") ?? null) as HTMLElement | null
        : subject.todoRow ? (hit?.closest(".modular-diary-period-todos .modular-diary-todo-row[data-todo-id]") ?? null) as HTMLElement | null : null
      const sameRow = subject.rhythmId ? row?.dataset.rhythm === subject.rhythmId : row?.dataset.todoId === subject.todo.id
      if (row && !sameRow && root.contains(row)) {
        const rect = row.getBoundingClientRect()
        const before = move.clientY < rect.top + rect.height / 2
        if (rowTarget?.row !== row || rowTarget.before !== before) {
          clear()
          rowTarget = { row, before }
          row.classList.add(before ? "is-drop-before" : "is-drop-after")
        }
        if (ghost) ghost.hidden = false
        return
      }
      const under = subject.reorderOnly ? null : (hit?.closest("[data-zone]") ?? null) as HTMLElement | null
      if (under !== zone || rowTarget) { clear(); zone = under; zone?.classList.add("is-over") }
      if (zone?.dataset.zoneKind === "axis") {
        startMin = minutesAt(zone, move.clientY)
        if (!preview) {
          preview = zone.createDiv({ cls: `modular-diary-period-drop-preview${canPlan ? "" : " is-invalid"}` })
          if (color) preview.style.setProperty("--modular-diary-block-color", color)
          preview.createEl("span", { cls: "modular-diary-period-drop-title", text: canPlan ? plainTitle(subject.todo.title) : t("needsCategoryShort") })
          preview.createEl("span", { cls: "modular-diary-period-drop-time" })
        }
        const span = model.rangeEndMin - model.rangeStartMin
        preview.style.top = `${((startMin - model.rangeStartMin) / span) * 100}%`
        preview.style.height = `${(duration / span) * 100}%`
        preview.querySelector<HTMLElement>(".modular-diary-period-drop-time")!.textContent = `${clock(startMin)}–${clock(startMin + duration)}`
      }
      if (ghost) ghost.hidden = zone?.dataset.zoneKind === "axis"
    }
    const finish = (commit: boolean): void => {
      if (finished) return
      finished = true
      handle.removeEventListener("pointermove", onMove)
      handle.removeEventListener("pointerup", onUp)
      handle.removeEventListener("pointercancel", onCancel)
      dom.removeEventListener("pointermove", onMove)
      dom.removeEventListener("pointerup", onUp, true)
      dom.removeEventListener("pointercancel", onCancel, true)
      dom.removeEventListener("keydown", onKey, true)
      if (owner) setPointerInteractionActive(owner, false)
      if (scrollFrame && win) { win.cancelAnimationFrame(scrollFrame); scrollFrame = 0 }
      const dropped = zone, minutes = startMin, dragged = ghost !== null, reorder = rowTarget
      clear()
      ghost?.remove(); ghost = null
      root.classList.remove("is-dragging")
      handle.classList.remove("is-drag-source")
      if (!commit || !dragged) return
      if (reorder && subject.todoRow) {
        // Reorder in source order: the index the dragged subtree takes among the other todos.
        const targetId = reorder.row.dataset.todoId ?? ""
        const moving = new Set<string>([subject.todo.id])
        for (let grew = true; grew;) { grew = false; for (const todo of model.todos) if (todo.parent && moving.has(todo.parent) && !moving.has(todo.id)) { moving.add(todo.id); grew = true } }
        const rest = model.todos.filter((todo) => !moving.has(todo.id)).map((todo) => todo.id)
        const at = rest.indexOf(targetId)
        if (at >= 0) deps.onMove(subject.todo.id, at + (reorder.before ? 0 : 1))
        return
      }
      if (reorder && subject.rhythmId) {
        // Dropping below a row means "before the rhythm after it" in note order.
        const ids = [...new Set(Array.from(root.querySelectorAll<HTMLElement>(".modular-diary-plan-row[data-rhythm]")).map((el) => el.dataset.rhythm ?? ""))]
        const targetId = reorder.row.dataset.rhythm ?? ""
        const order = model.board.map((row) => row.rhythm.id).filter((id) => ids.includes(id))
        const index = order.indexOf(targetId)
        const beforeId = reorder.before ? targetId : order[index + 1] ?? null
        deps.onReorderRhythm?.(subject.rhythmId, beforeId)
        return
      }
      if (!dropped) return
      const to = dropped.dataset.zone ?? ""
      if (dropped.dataset.zoneKind === "axis") { if (canPlan) deps.onPlan(subject.todo.id, to, minutes) }
      else if (subject.session) {
        if (to === POOL_ZONE) return
        const [date, zone] = to.split("@") as [string, "am" | "pm" | "ev" | undefined]
        deps.onSession?.(subject.todo.id, date, zone ?? null)
      }
      else if (to !== subject.from) deps.onAssign(subject.todo.id, to)
    }
    const onUp = (): void => finish(true)
    const onCancel = (): void => finish(false)
    const onKey = (key: KeyboardEvent): void => { if (key.key === "Escape") { key.preventDefault(); finish(false) } }
    handle.setPointerCapture(event.pointerId)
    handle.addEventListener("pointermove", onMove)
    handle.addEventListener("pointerup", onUp)
    handle.addEventListener("pointercancel", onCancel)
    // Should the handle be replaced mid-drag, the document still ends the gesture.
    dom.addEventListener("pointermove", onMove)
    dom.addEventListener("pointerup", onUp, true)
    dom.addEventListener("pointercancel", onCancel, true)
    dom.addEventListener("keydown", onKey, true)
  })
}

/* ── rail ── */

export function goalEditor(host: HTMLElement, initial: GoalDraft | null, line: number | null, deps: PeriodViewDeps, close: () => void, mode: "hours" | "text" = "hours"): HTMLFormElement {
  const form = host.createEl("form", { cls: `modular-diary-period-goal-form${mode === "text" ? " is-text" : ""}` })
  form.noValidate = true
  if (mode === "text") {
    // A written goal: what, and an optional note.
    const title = form.createEl("input", { cls: "modular-diary-period-goal-title", attr: { type: "text", placeholder: t("textGoalPlaceholder"), "aria-label": t("addTextGoal") } })
    title.value = initial?.key ?? ""
    const noteInput = form.createEl("input", { cls: "modular-diary-period-goal-note", attr: { type: "text", placeholder: t("goalNotePlaceholder"), "aria-label": t("goalNotePlaceholder") } })
    noteInput.value = initial?.note ?? ""
    const actions = form.createDiv({ cls: "modular-diary-period-goal-actions" })
    if (line !== null) iconButton(actions, "trash-2", t("deleteGoal"), "is-danger").addEventListener("click", () => deps.onDeleteGoal(line))
    iconButton(actions, "x", t("cancel")).addEventListener("click", close)
    const save = actions.createEl("button", { cls: "modular-diary-period-icon is-primary", attr: { type: "submit", "aria-label": t("save") } })
    setIcon(save, "check")
    form.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); close() } })
    form.addEventListener("submit", (event) => {
      event.preventDefault()
      const key = title.value.trim()
      if (!key) { title.focus(); title.setAttribute("aria-invalid", "true"); return }
      deps.onSaveGoal(line, { kind: "text", key, targetMinutes: 0, note: noteInput.value.trim() || undefined, done: initial?.done })
    })
    queueMicrotask(() => title.focus({ preventScroll: true }))
    return form
  }
  let kind: PeriodGoal["kind"] = initial?.kind ?? "type"
  const seg = form.createDiv({ cls: "modular-diary-period-seg", attr: { role: "radiogroup", "aria-label": t("goalKind") } })
  const typeBtn = seg.createEl("button", { text: t("goalByCategory"), attr: { type: "button", role: "radio" } })
  const tagBtn = seg.createEl("button", { text: t("goalByTag"), attr: { type: "button", role: "radio" } })
  const keyHost = form.createDiv({ cls: "modular-diary-period-goal-key" })
  const target = form.createDiv({ cls: "modular-diary-period-goal-target" })
  const hours = target.createEl("input", { attr: { type: "number", min: "0.25", step: "0.25", inputmode: "decimal", "aria-label": t("goalTargetHours") } })
  hours.value = initial ? String(+(initial.targetMinutes / 60).toFixed(2)) : "3"
  target.createEl("span", { text: t("hoursShort") })
  const noteInput = form.createEl("input", { cls: "modular-diary-period-goal-note", attr: { type: "text", placeholder: t("goalNotePlaceholder"), "aria-label": t("goalNotePlaceholder") } })
  noteInput.value = initial?.note ?? ""
  const actions = form.createDiv({ cls: "modular-diary-period-goal-actions" })
  if (line !== null) {
    const remove = iconButton(actions, "trash-2", t("deleteGoal"), "is-danger")
    remove.addEventListener("click", () => deps.onDeleteGoal(line))
  }
  const cancel = iconButton(actions, "x", t("cancel"))
  cancel.addEventListener("click", close)
  const save = actions.createEl("button", { cls: "modular-diary-period-icon is-primary", attr: { type: "submit", "aria-label": t("save") } })
  setIcon(save, "check")

  let keyControl: HTMLInputElement | HTMLSelectElement
  const paintKind = (): void => {
    typeBtn.setAttribute("aria-checked", String(kind === "type"))
    tagBtn.setAttribute("aria-checked", String(kind === "tag"))
    keyHost.replaceChildren()
    if (kind === "type") {
      const select = keyHost.createEl("select", { attr: { "aria-label": t("category") } })
      const options = [...new Set([...(initial?.kind === "type" && initial.key ? [initial.key] : []), ...deps.categories])]
      for (const option of options) select.createEl("option", { text: option, attr: { value: option } })
      select.value = initial?.kind === "type" ? initial.key : options[0] ?? ""
      keyControl = select
    } else {
      const input = keyHost.createEl("input", { attr: { type: "text", placeholder: t("goalTagPlaceholder"), "aria-label": t("tag") } })
      input.value = initial?.kind === "tag" ? `#${initial.key}` : "#"
      if (deps.tagSuggest) attachTagSuggest(input, deps.tagSuggest)
      keyControl = input
    }
  }
  typeBtn.addEventListener("click", () => { kind = "type"; paintKind() })
  tagBtn.addEventListener("click", () => { kind = "tag"; paintKind(); keyControl.focus() })
  paintKind()
  form.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); close() } })
  form.addEventListener("submit", (event) => {
    event.preventDefault()
    const key = keyControl.value.trim().replace(/^#/, "").trim()
    const minutes = Math.round(Number(hours.value) * 60)
    if (!key) { keyControl.focus(); keyControl.setAttribute("aria-invalid", "true"); return }
    if (!Number.isFinite(minutes) || minutes <= 0) { hours.focus(); hours.setAttribute("aria-invalid", "true"); return }
    deps.onSaveGoal(line, { kind, key, targetMinutes: minutes, note: noteInput.value.trim() || undefined })
  })
  queueMicrotask(() => (kind === "tag" ? keyControl : hours).focus({ preventScroll: true }))
  return form
}

function renderGoals(rail: HTMLElement, model: PeriodViewModel, deps: PeriodViewDeps): void {
  const section = rail.createEl("section", { cls: "modular-diary-period-section modular-diary-period-goals" })
  const header = section.createDiv({ cls: "modular-diary-component-header" })
  header.createEl("span", { cls: "modular-diary-component-title", text: t("periodGoals") })
  if (model.goals.length > 0) header.createEl("span", { cls: "modular-diary-component-count", text: `${model.goals.filter((g) => g.complete).length}/${model.goals.length}` })
  const actions = header.createDiv({ cls: "modular-diary-component-actions" })
  const add = actions.createEl("button", { attr: { type: "button", "aria-label": t("addGoal") } })
  setIcon(add, "plus")
  const list = section.createDiv({ cls: "modular-diary-period-goal-list" })
  let open: HTMLFormElement | null = null
  const closeEditor = (): void => { open?.remove(); open = null; list.querySelectorAll<HTMLElement>(".modular-diary-period-goal").forEach((row) => { row.hidden = false }) }
  add.addEventListener("click", () => {
    closeEditor()
    open = goalEditor(list, null, null, deps, closeEditor)
    list.appendChild(open)
  })
  if (model.goals.length === 0) {
    const empty = list.createEl("button", { cls: "modular-diary-component-empty", attr: { type: "button" } })
    setIcon(empty.createEl("span", { cls: "modular-diary-component-empty-icon" }), "plus")
    empty.createEl("span", { text: t("addFirstGoal") })
    empty.addEventListener("click", () => { empty.remove(); add.click() })
  }
  for (const item of model.goals) {
    if (item.goal.kind === "text") continue
    const row = list.createDiv({ cls: `modular-diary-period-goal${item.complete ? " is-complete" : ""}`, attr: { role: "button", tabindex: "0" } })
    row.setAttribute("aria-label", t("editGoalNamed", { name: item.goal.key }))
    row.title = item.complete ? t("goalComplete") : t("goalRemaining", { hours: formatHours(item.goal.targetMinutes - item.doneMinutes) })
    const head = row.createDiv({ cls: "modular-diary-period-goal-head" })
    const color = item.goal.kind === "type" ? deps.typeColors[item.goal.key] : undefined
    if (item.goal.kind === "type") badge(head, item.goal.key, color ? tint(color) : null)
    else badge(head, `#${item.goal.key}`, deps.tagStyle?.(item.goal.key) ?? null)
    const value = head.createEl("span", { cls: "modular-diary-period-goal-value" })
    value.createEl("b", { text: formatTotal(item.doneMinutes) })
    value.appendChild(value.ownerDocument.createTextNode(` / ${formatTotal(item.goal.targetMinutes)}`))
    const track = row.createDiv({ cls: "modular-diary-period-meter" })
    const bar = track.createDiv({ cls: "modular-diary-period-meter-bar" })
    bar.style.width = `${Math.round(item.ratio * 100)}%`
    bar.style.background = color ?? deps.tagStyle?.(item.goal.key)?.color ?? "color-mix(in srgb, var(--text-normal) 35%, var(--background-primary))"
    const edit = (): void => {
      closeEditor()
      row.hidden = true
      open = goalEditor(list, { kind: item.goal.kind, key: item.goal.key, targetMinutes: item.goal.targetMinutes }, item.goal.line, deps, closeEditor)
      list.insertBefore(open, row)
    }
    row.addEventListener("click", edit)
    row.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); edit() } })
  }
}

/** Written goals of the period: a box to tick, the text, a note underneath. */
function renderTextGoals(rail: HTMLElement, model: PeriodViewModel, deps: PeriodViewDeps): void {
  const goals = model.goals.filter((item) => item.goal.kind === "text")
  const section = rail.createEl("section", { cls: "modular-diary-period-section modular-diary-period-text-goals" })
  const header = section.createDiv({ cls: "modular-diary-component-header" })
  header.createEl("span", { cls: "modular-diary-component-title", text: t(model.scope?.kind === "month" ? "textGoalsMonth" : "textGoalsWeek") })
  if (goals.length) header.createEl("span", { cls: `modular-diary-component-count${goals.every((g) => g.complete) ? " is-complete" : ""}`, text: `${goals.filter((g) => g.complete).length}/${goals.length}` })
  const actions = header.createDiv({ cls: "modular-diary-component-actions" })
  const add = actions.createEl("button", { attr: { type: "button", "aria-label": t("addTextGoal"), title: t("addTextGoal") } })
  setIcon(add, "plus")
  const list = section.createDiv({ cls: "modular-diary-period-goal-list" })
  let open: HTMLFormElement | null = null
  const closeEditor = (): void => { open?.remove(); open = null; list.querySelectorAll<HTMLElement>(".modular-diary-text-goal").forEach((row) => { row.hidden = false }) }
  add.addEventListener("click", () => { closeEditor(); open = goalEditor(list, null, null, deps, closeEditor, "text") })
  if (!goals.length) {
    const empty = list.createEl("button", { cls: "modular-diary-component-empty", attr: { type: "button" } })
    setIcon(empty.createEl("span", { cls: "modular-diary-component-empty-icon" }), "plus")
    empty.createEl("span", { text: t("textGoalEmpty") })
    empty.addEventListener("click", () => { empty.remove(); add.click() })
  }
  for (const item of goals) {
    const row = list.createDiv({ cls: `modular-diary-text-goal${item.complete ? " is-done" : ""}` })
    const box = row.createEl("input", { cls: "task-list-item-checkbox", attr: { type: "checkbox", "aria-label": t("toggleGoalDone") } })
    box.checked = item.complete
    box.addEventListener("change", () => deps.onToggleGoal?.(item.goal.line, box.checked))
    const body = row.createEl("button", { cls: "modular-diary-text-goal-body", attr: { type: "button", title: t("editTextGoal") } })
    const bound = item.goal.id ? model.todos.filter((todo) => todo.goal === item.goal.id && !todo.moved) : []
    const titleLine = body.createEl("span", { cls: "modular-diary-text-goal-title", text: item.goal.key })
    if (bound.length) titleLine.createEl("span", { cls: "modular-diary-text-goal-count", text: ` ${bound.filter((todo) => todo.completed).length}/${bound.length}` })
    if (item.goal.note) body.createEl("span", { cls: "modular-diary-text-goal-note", text: item.goal.note })
    if (bound.length) renderBoundTodos(list, bound, model, deps, rail.closest<HTMLElement>(".modular-diary-period") ?? rail)
    body.addEventListener("click", () => {
      closeEditor()
      row.hidden = true
      open = goalEditor(list, { kind: "text", key: item.goal.key, targetMinutes: 0, note: item.goal.note, done: item.goal.done }, item.goal.line, deps, closeEditor, "text")
      list.insertBefore(open, row)
    })
  }
}

function placementFlag(todo: PeriodTodoView, model: PeriodViewModel): { text: string; tone: "placed" | "due" | "elsewhere" }[] {
  const flags: { text: string; tone: "placed" | "due" | "elsewhere" }[] = []
  const inPeriod = (date: string): boolean => date >= model.period.start && date <= model.period.end
  // Outside the shown period a bare weekday would point at the wrong week.
  const dayLabel = (date: string): string => inPeriod(date) ? weekday(date) : `${shortDate(date)} ${weekday(date)}`
  if (todo.placement) {
    const at = todo.placement.startMin !== undefined ? ` ${clock(todo.placement.startMin)}` : ""
    flags.push({ text: `${dayLabel(todo.placement.date)}${at}`, tone: inPeriod(todo.placement.date) ? "placed" : "elsewhere" })
  }
  if (todo.due && !todo.completed) flags.push({ text: `⚑ ${dayLabel(todo.due)}${t("dueSuffix")}`, tone: "due" })
  return flags
}

/** A period todo as the shared todo-row renderer shows it. */
function todoViewItem(todo: PeriodTodoView, model: PeriodViewModel): TodoViewItem {
  return {
    id: todo.id, title: todo.title, group: todo.group, type: todo.type, completed: todo.completed, weekly: false, placed: Boolean(todo.placement),
    tags: todo.tags, note: todo.note, parent: todo.parent, partial: todo.partial, difficulty: todo.difficulty, priority: todo.priority,
    estimateMinutes: todo.estimateMin, actualMinutes: todo.actualMinutes, flags: placementFlag(todo, model),
  }
}

/** The whole row drags: onto a day (or band) to place it, onto another row to reorder. */
function attachRowDrags(section: HTMLElement, root: HTMLElement, model: PeriodViewModel, deps: PeriodViewDeps): void {
  const byId = new Map(model.todos.map((todo) => [todo.id, todo]))
  section.querySelectorAll<HTMLElement>(".modular-diary-todo-row[data-todo-id]").forEach((row) => {
    const todo = byId.get(row.dataset.todoId ?? "")
    if (!todo) return
    row.classList.add("modular-diary-period-draggable")
    attachDrag(root, row, { todo, todoRow: true, from: todo.placement && todo.placement.startMin === undefined ? (todo.zone ? `${todo.placement.date}@${todo.zone}` : todo.placement.date) : POOL_ZONE }, model, deps)
  })
}

/**
 * Todos hung under a goal or a rhythm row: the same rows as the list (tags,
 * priority, numbers, inline edit, menu, drag), without a header of their own.
 */
export function renderBoundTodos(host: HTMLElement, todos: PeriodTodoView[], model: PeriodViewModel, deps: PeriodViewDeps, root: HTMLElement): HTMLElement {
  const wrap = host.createDiv({ cls: "modular-diary-plan-subs" })
  renderTodosInto(wrap, todos.map((todo) => todoViewItem(todo, model)), {
    bare: true,
    compactMeta: true,
    rowGrips: false,
    categories: deps.categories,
    priorities: deps.priorities,
    typeColors: deps.typeColors,
    view: { groupBy: "none", sortBy: "manual", layout: "list" },
    tagStyle: deps.tagStyle,
    tagSuggest: deps.tagSuggest,
    onAdd: () => undefined,
    onEdit: deps.onEdit,
    onGroupMenu: () => undefined,
    onSortMenu: () => undefined,
    onToggle: deps.onToggle,
    onMove: () => undefined,
    onMenu: (item, x, y, edit) => deps.onTodoMenu?.(item.id, x, y, edit, null),
  })
  attachRowDrags(wrap, root, model, deps)
  return wrap
}

function renderTodoList(rail: HTMLElement, root: HTMLElement, model: PeriodViewModel, deps: PeriodViewDeps): void {
  const section = rail.createEl("section", { cls: "modular-diary-period-section modular-diary-period-todos" })
  section.dataset.zone = POOL_ZONE
  section.dataset.zoneKind = "list"
  // Bound todos live under their goal or rhythm on the board; pushed ones are gone from here.
  const items: TodoViewItem[] = model.todos.filter((todo) => !todo.rhythm && !todo.under && !todo.goal && !todo.moved).map((todo) => todoViewItem(todo, model))
  renderTodosInto(section, items, {
    title: t(model.scope?.kind === "week" ? "periodTodosWeek" : model.scope?.kind === "month" ? "periodTodosMonth" : "periodTodos"),
    compactMeta: true,
    rowGrips: false,
    categories: deps.categories,
    priorities: deps.priorities,
    typeColors: deps.typeColors,
    view: model.todoView,
    groupOrder: model.todoGroupOrder,
    collapsed: deps.collapsed,
    onToggleCollapse: deps.onToggleCollapse,
    onReparent: deps.onReparent,
    tagStyle: deps.tagStyle,
    tagSuggest: deps.tagSuggest,
    onAdd: deps.onAdd,
    onEdit: deps.onEdit,
    onGroupMenu: deps.onGroupMenu,
    onSortMenu: deps.onSortMenu,
    onToggle: deps.onToggle,
    onMove: deps.onMove,
    onMoveGroup: deps.onMoveGroup,
    onMenu: (item, x, y, edit, addChild) => deps.onTodoMenu?.(item.id, x, y, edit, addChild),
  })
  attachRowDrags(section, root, model, deps)
}

function renderTotals(rail: HTMLElement, model: PeriodViewModel, deps: PeriodViewDeps): void {
  const section = rail.createEl("section", { cls: "modular-diary-period-section" })
  const header = section.createDiv({ cls: "modular-diary-component-header" })
  header.createEl("span", { cls: "modular-diary-component-title", text: t("periodTotals") })
  const sum = model.totals.reduce((acc, item) => acc + item.minutes, 0)
  if (sum > 0) header.createEl("span", { cls: "modular-diary-component-count", text: formatTotal(sum) })
  const totals = section.createDiv({ cls: "modular-diary-period-totals" })
  const targets = new Map(model.goals.filter((g) => g.goal.kind === "type").map((g) => [g.goal.key, g.goal.targetMinutes]))
  const max = Math.max(model.totals[0]?.minutes ?? 0, ...model.totals.map((total) => targets.get(total.type) ?? 0))
  for (const total of model.totals) {
    const target = targets.get(total.type)
    totals.createEl("span", { cls: "modular-diary-period-total-name", text: total.type })
    const track = totals.createDiv({ cls: "modular-diary-period-meter" })
    const bar = track.createDiv({ cls: "modular-diary-period-meter-bar" })
    bar.style.width = `${max ? Math.max(3, Math.round(total.minutes / max * 100)) : 0}%`
    bar.style.background = deps.typeColors[total.type] ?? "var(--text-muted)"
    if (target && max) {
      // The goal for this category, drawn on its own bar.
      const tick = track.createDiv({ cls: `modular-diary-period-meter-tick${total.minutes >= target ? " is-met" : ""}` })
      tick.style.left = `${Math.min(100, target / max * 100)}%`
      tick.title = t("goalTick", { hours: formatTotal(target) })
    }
    const hours = totals.createEl("span", { cls: "modular-diary-period-total-hours" })
    hours.createEl("span", { text: formatTotal(total.minutes) })
    if (target) hours.createEl("span", { cls: "modular-diary-period-total-target", text: ` / ${formatTotal(target)}` })
  }
  if (model.totals.length === 0) section.createEl("p", { cls: "modular-diary-period-muted", text: t("periodNoRecords") })
  if (deps.onAddStatsWidget) {
    const add = header.createEl("button", { cls: "modular-diary-period-stats-add", attr: { type: "button", "aria-label": t("addStatsWidget"), title: t("addStatsWidget") } })
    setIcon(add, "plus")
    add.addEventListener("click", () => {
      const rect = add.getBoundingClientRect()
      deps.onAddStatsWidget?.(rect.left, rect.bottom)
    })
  }
  for (const token of model.statsWidgets ?? []) {
    const widget = parsePeriodStatsWidget(token)
    if (widget) renderStatsWidget(rail, token, widget, model, deps)
  }
}

/** One optional statistics widget: a donut of category shares, or a row of days for one category. */
function renderStatsWidget(rail: HTMLElement, token: string, widget: PeriodStatsWidget, model: PeriodViewModel, deps: PeriodViewDeps): void {
  const section = rail.createEl("section", { cls: `modular-diary-period-section modular-diary-period-stats is-${widget.kind}` })
  section.dataset.statsWidget = token
  const header = section.createDiv({ cls: "modular-diary-component-header" })
  const title = widget.kind === "share" ? t("statsShare") : t("statsDays", { type: widget.type })
  header.createEl("span", { cls: "modular-diary-component-title", text: title })
  if (widget.kind === "days") {
    const done = model.days.filter((day) => day.entries.some((entry) => !entry.plan && entry.type === widget.type)).length
    header.createEl("span", { cls: "modular-diary-component-count", text: t("statsDaysCount", { done, total: model.days.length }) })
  }
  if (deps.onRemoveStatsWidget) {
    const remove = header.createEl("button", { cls: "modular-diary-period-stats-remove", attr: { type: "button", "aria-label": t("removeStatsWidget", { name: title }), title: t("removeStatsWidget", { name: title }) } })
    setIcon(remove, "x")
    remove.addEventListener("click", () => deps.onRemoveStatsWidget?.(token))
  }
  if (widget.kind === "share") {
    const slices = shareSlices(model.totals)
    if (!slices.length) { section.createEl("p", { cls: "modular-diary-period-muted", text: t("periodNoRecords") }); return }
    const body = section.createDiv({ cls: "modular-diary-period-share" })
    // A donut from stroked circles: circumference 100, so dash lengths are percentages.
    const ns = "http://www.w3.org/2000/svg"
    const svg = body.ownerDocument.createElementNS(ns, "svg")
    svg.setAttribute("viewBox", "0 0 42 42")
    svg.setAttribute("class", "modular-diary-period-donut")
    svg.setAttribute("role", "img")
    svg.setAttribute("aria-label", slices.map((s) => `${s.type ?? t("statsOther")} ${Math.round(s.ratio * 100)}%`).join(", "))
    let offset = 25
    for (const slice of slices) {
      const circle = body.ownerDocument.createElementNS(ns, "circle")
      circle.setAttribute("cx", "21"); circle.setAttribute("cy", "21"); circle.setAttribute("r", "15.9155")
      circle.setAttribute("fill", "none"); circle.setAttribute("stroke-width", "6")
      circle.setAttribute("stroke", slice.type ? deps.typeColors[slice.type] ?? "var(--text-muted)" : "var(--background-modifier-border)")
      const length = slice.ratio * 100
      // A hairline gap keeps neighbouring slices apart.
      circle.setAttribute("stroke-dasharray", `${Math.max(0, length - (slices.length > 1 ? 0.6 : 0))} ${100 - Math.max(0, length - (slices.length > 1 ? 0.6 : 0))}`)
      circle.setAttribute("stroke-dashoffset", String(offset))
      svg.appendChild(circle)
      offset -= length
    }
    body.appendChild(svg)
    const legend = body.createDiv({ cls: "modular-diary-period-share-legend" })
    for (const slice of slices) {
      const row = legend.createDiv({ cls: "modular-diary-period-share-row" })
      const dot = row.createEl("span", { cls: "modular-diary-period-share-dot" })
      dot.style.background = slice.type ? deps.typeColors[slice.type] ?? "var(--text-muted)" : "var(--background-modifier-border)"
      row.createEl("span", { cls: "modular-diary-period-share-name", text: slice.type ?? t("statsOther") })
      row.createEl("span", { cls: "modular-diary-period-share-pct", text: `${Math.round(slice.ratio * 100)}%` })
    }
    return
  }
  const color = deps.typeColors[widget.type] ?? "var(--interactive-accent)"
  const row = section.createDiv({ cls: `modular-diary-period-days-row${model.days.length > 7 ? " is-month" : ""}` })
  if (model.days.length > 7) {
    // Lead-in blanks so the first day sits under its weekday (Monday first).
    const lead = (new Date(`${model.days[0].date}T00:00:00`).getDay() + 6) % 7
    for (let i = 0; i < lead; i++) row.createDiv({ cls: "modular-diary-period-day-dot is-blank" })
  }
  for (const day of model.days) {
    const hit = day.entries.some((entry) => !entry.plan && entry.type === widget.type)
    const cell = row.createDiv({ cls: `modular-diary-period-day-dot${hit ? " is-done" : ""}${day.date === model.today ? " is-today" : ""}`, attr: { title: `${day.date} · ${hit ? t("checkedToday") : t("notChecked")}` } })
    cell.style.setProperty("--modular-diary-day-color", color)
    // A month shows day numbers in a seven-wide grid; a week shows weekday letters.
    cell.createEl("span", { cls: "modular-diary-period-day-label", text: model.days.length > 7 ? String(Number(day.date.slice(8, 10))) : weekdayShort(day.date) })
  }
}

/** One-letter weekday from the Monday-first `weekdayShort` string. */
function weekdayShort(date: string): string {
  const day = new Date(`${date}T00:00:00`).getDay()
  return [...t("weekdayShort")][(day + 6) % 7] ?? ""
}

function attachRailResize(root: HTMLElement, handle: HTMLElement, deps: PeriodViewDeps): void {
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = parseFloat(getComputedStyle(root).getPropertyValue("--modular-diary-rail-width")) || 240
    let width = startWidth
    root.classList.add("is-resizing")
    const move = (e: PointerEvent): void => {
      width = Math.round(Math.max(RAIL_MIN, Math.min(RAIL_MAX, startWidth + e.clientX - startX)))
      root.style.setProperty("--modular-diary-rail-width", `${width}px`)
    }
    const up = (): void => {
      handle.removeEventListener("pointermove", move)
      handle.removeEventListener("pointerup", up)
      handle.removeEventListener("pointercancel", up)
      root.classList.remove("is-resizing")
      if (width !== startWidth) deps.onRailWidth(width)
    }
    handle.setPointerCapture(event.pointerId)
    handle.addEventListener("pointermove", move)
    handle.addEventListener("pointerup", up)
    handle.addEventListener("pointercancel", up)
  })
  // Keyboard steps only move the CSS variable; the file is written once the keys settle.
  let commitTimer = 0
  const commitSoon = (): void => {
    const win = root.ownerDocument.defaultView
    if (!win) return
    win.clearTimeout(commitTimer)
    commitTimer = win.setTimeout(() => deps.onRailWidth(Math.round(parseFloat(getComputedStyle(root).getPropertyValue("--modular-diary-rail-width")) || RAIL_DEFAULT)), 450)
  }
  handle.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()
    const current = parseFloat(getComputedStyle(root).getPropertyValue("--modular-diary-rail-width")) || RAIL_DEFAULT
    const next = Math.max(RAIL_MIN, Math.min(RAIL_MAX, current + (event.key === "ArrowRight" ? 16 : -16)))
    root.style.setProperty("--modular-diary-rail-width", `${next}px`)
    commitSoon()
  })
  handle.addEventListener("dblclick", () => {
    root.style.setProperty("--modular-diary-rail-width", `${RAIL_DEFAULT}px`)
    deps.onRailWidth(RAIL_DEFAULT)
  })
}

/* ── calendar ── */

/** Side-by-side lanes for overlapping actual records (plans stay full width underneath). */
function renderCalendar(host: HTMLElement, root: HTMLElement, model: PeriodViewModel, deps: PeriodViewDeps): void {
  // The actual face of a week or month is what happened: no plans, no all-day items, no schedule.
  const recordsOnly = model.scope !== undefined && model.face === "actual"
  const scroll = host.createDiv({ cls: "modular-diary-period-cal-scroll" })
  const cal = scroll.createDiv({ cls: "modular-diary-period-cal" })
  const count = model.days.length
  const hours = (model.rangeEndMin - model.rangeStartMin) / 60
  cal.style.setProperty("--modular-diary-period-days", String(count))
  cal.style.setProperty("--modular-diary-period-hours", String(hours))
  const span = model.rangeEndMin - model.rangeStartMin
  const pct = (minutes: number): string => `${((minutes - model.rangeStartMin) / span) * 100}%`
  const pctLen = (minutes: number): string => `${(minutes / span) * 100}%`
  const todoById = new Map(model.todos.map((todo) => [todo.id, todo]))
  const openRowEditor = (id: string): void => {
    const row = root.querySelector<HTMLElement>(`.modular-diary-period-rail .modular-diary-todo-row[data-todo-id="${CSS.escape(id)}"]`)
    if (!row) return
    row.scrollIntoView({ block: "nearest" })
    row.dispatchEvent(new CustomEvent("modular-diary-edit"))
  }
  const addChildFor = (id: string): void => {
    const row = root.querySelector<HTMLElement>(`.modular-diary-period-rail .modular-diary-todo-row[data-todo-id="${CSS.escape(id)}"]`)
    if (!row) return
    row.scrollIntoView({ block: "nearest" })
    row.dispatchEvent(new CustomEvent("modular-diary-add-child"))
  }
  const menuFor = (el: HTMLElement, id: string): void => {
    const open = (x: number, y: number): void => deps.onTodoMenu?.(id, x, y, () => openRowEditor(id), () => addChildFor(id))
    el.addEventListener("contextmenu", (event) => { event.preventDefault(); event.stopPropagation(); open(event.clientX, event.clientY) })
    el.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        event.preventDefault()
        const rect = el.getBoundingClientRect()
        open(rect.left, rect.bottom)
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault()
        deps.onAssign(id, POOL_ZONE)
      }
    })
  }

  // Row 1: day heads, the same as the plan face's (and all-day drop targets outside the records-only face).
  cal.createDiv({ cls: "modular-diary-period-corner" })
  for (const day of model.days) {
    const head = dayHead(cal, day, model, deps, "is-cal")
    if (!recordsOnly) { head.dataset.zone = day.date; head.dataset.zoneKind = "list" }
  }

  // Row 2: all-day band (plans only).
  if (!recordsOnly) cal.createDiv({ cls: "modular-diary-period-gutter-label", text: t("allDay") })
  for (const day of recordsOnly ? [] : model.days) {
    const cell = cal.createDiv({ cls: `modular-diary-period-allday${day.date === model.today ? " is-today" : ""}` })
    cell.dataset.zone = day.date
    cell.dataset.zoneKind = "list"
    for (const todo of day.allDay) {
      const pill = cell.createDiv({ cls: `modular-diary-period-pill${todo.completed ? " is-complete" : ""}`, attr: { tabindex: "0" } })
      pill.textContent = plainTitle(todo.title)
      pill.title = `${todo.title}${todo.type ? " · " + todo.type : ""} · ${formatSpan(todo.estimateMin)}${todo.note ? `\n${todo.note}` : ""}`
      const color = todo.type ? deps.typeColors[todo.type] : undefined
      if (color) pill.style.setProperty("--modular-diary-pill-color", color)
      attachDrag(root, pill, { todo, from: day.date }, model, deps)
      menuFor(pill, todo.id)
    }
    for (const item of day.upcoming ?? []) {
      if (item.startMin !== undefined) continue
      cell.createDiv({ cls: "modular-diary-period-pill is-upcoming", text: item.text, attr: { title: `${t("upcomingTitle")} · ${item.text}` } })
    }
    for (const todo of model.todos) {
      if (todo.due !== day.date || todo.completed) continue
      cell.createDiv({ cls: "modular-diary-period-due", text: `⚑ ${plainTitle(todo.title)}`, attr: { title: t("dueOn", { date: monthDay(todo.due) }) } })
    }
    // A busy day shows three items and a "+N"; the band never pushes the hours off screen.
    const items = Array.from(cell.children) as HTMLElement[]
    if (items.length > ALLDAY_VISIBLE) {
      items.slice(ALLDAY_VISIBLE - 1).forEach((item) => item.classList.add("is-overflow"))
      const more = cell.createEl("button", { cls: "modular-diary-period-more", text: `+${items.length - ALLDAY_VISIBLE + 1}`, attr: { type: "button", "aria-label": t("showAllAllDay") } })
      more.addEventListener("click", () => {
        const expanded = cal.classList.toggle("is-allday-expanded")
        cal.querySelectorAll<HTMLElement>(".modular-diary-period-more").forEach((button) => { button.hidden = expanded })
      })
    }
  }

  // Row 3: hours. Everything below is positioned in % of the column, so the
  // hour height is a single CSS variable the block tunes after layout.
  const gutter = cal.createDiv({ cls: "modular-diary-period-gutter" })
  for (let h = Math.ceil(model.rangeStartMin / 60) + 1; h * 60 < model.rangeEndMin; h += 1) {
    if (h % 2 !== 0) continue
    gutter.createEl("span", { text: `${h % 24}` }).style.top = pct(h * 60)
  }
  const nowMin = (() => { const now = new Date(); return now.getHours() * 60 + now.getMinutes() })()
  let anything = false
  for (const day of model.days) {
    const col = cal.createDiv({ cls: `modular-diary-period-col${day.date === model.today ? " is-today" : ""}` })
    col.dataset.zone = day.date
    col.dataset.zoneKind = "axis"
    col.style.setProperty("--modular-diary-period-offset", `${(Math.ceil(model.rangeStartMin / 60) * 60 - model.rangeStartMin) / 60}`)
    const shown = recordsOnly ? day.entries.filter((entry) => !entry.plan) : day.entries
    const lanes = laneLayout(shown)
    const sorted = [...shown].sort((a, b) => Number(!a.plan) - Number(!b.plan) || a.startMin - b.startMin)
    for (const entry of sorted) {
      if (entry.endMin <= model.rangeStartMin || entry.startMin >= model.rangeEndMin) continue
      anything = true
      const start = Math.max(entry.startMin, model.rangeStartMin)
      const end = Math.min(entry.endMin, model.rangeEndMin)
      const color = deps.typeColors[entry.type] ?? "var(--text-faint)"
      const block = col.createDiv({ cls: `modular-diary-period-block${entry.plan ? " is-plan" : ""}` })
      // A 1px inset at both ends keeps back-to-back blocks visibly separate.
      block.style.top = `calc(${pct(start)} + 1px)`
      block.style.height = `calc(${pctLen(end - start)} - 2px)`
      const lane = lanes.get(entry)
      if (lane && lane.lanes > 1) {
        // Lanes share the column with a 2px gutter between neighbours.
        block.style.left = `calc(3px + (100% - 7px) * ${lane.lane / lane.lanes}${lane.lane ? " + 1px" : ""})`
        block.style.right = `calc(4px + (100% - 7px) * ${(lane.lanes - lane.lane - lane.span) / lane.lanes}${lane.lane + lane.span < lane.lanes ? " + 1px" : ""})`
      }
      block.style.setProperty("--modular-diary-block-color", color)
      if (!entry.plan && color.startsWith("#")) block.style.color = blockTextColor(color)
      const name = entry.note ? plainTitle(entry.note) : entry.type
      block.title = `${entry.plan ? t("planLabel") + " · " : ""}${clock(entry.startMin)}–${clock(entry.endMin)} ${entry.type}${entry.note ? " · " + entry.note : ""}`
      const inner = block.createDiv({ cls: "modular-diary-period-block-inner" })
      inner.createEl("span", { cls: "modular-diary-period-block-name", text: name })
      inner.createEl("span", { cls: "modular-diary-period-block-time", text: formatSpan(entry.endMin - entry.startMin) })
      // A plan already covered by what actually happened keeps only its hatching.
      if (entry.plan && day.entries.some((other) => !other.plan && other.startMin < entry.endMin && other.endMin > entry.startMin)) block.classList.add("is-covered")
      // A plan that belongs to a period todo moves like the todo itself.
      const owned = entry.plan && entry.todoId ? todoById.get(entry.todoId) : undefined
      if (owned) {
        block.classList.add("is-owned")
        block.tabIndex = 0
        attachDrag(root, block, { todo: owned, from: `plan:${day.date}` }, model, deps)
        menuFor(block, owned.id)
      }
    }
    // Scheduled ahead in Upcoming.md: a dashed outline until that day's diary takes it.
    for (const item of recordsOnly ? [] : day.upcoming ?? []) {
      if (item.startMin === undefined || item.endMin === undefined) continue
      if (item.endMin <= model.rangeStartMin || item.startMin >= model.rangeEndMin) continue
      anything = true
      const start = Math.max(item.startMin, model.rangeStartMin)
      const end = Math.min(item.endMin, model.rangeEndMin)
      const block = col.createDiv({ cls: "modular-diary-period-block is-upcoming" })
      block.style.top = `calc(${pct(start)} + 1px)`
      block.style.height = `calc(${pctLen(end - start)} - 2px)`
      block.style.setProperty("--modular-diary-block-color", (item.type && deps.typeColors[item.type]) || "var(--text-faint)")
      block.title = `${t("upcomingTitle")} · ${clock(item.startMin)}–${clock(item.endMin)} ${item.type ?? ""}${item.text ? " · " + item.text : ""}`
      const inner = block.createDiv({ cls: "modular-diary-period-block-inner" })
      inner.createEl("span", { cls: "modular-diary-period-block-name", text: item.text || item.type || "" })
      inner.createEl("span", { cls: "modular-diary-period-block-time", text: formatSpan(item.endMin - item.startMin) })
    }
    for (const item of day.spans) {
      const mark = col.createDiv({ cls: "modular-diary-period-span" })
      mark.style.top = pct(Math.max(item.startMin, model.rangeStartMin))
      mark.style.height = pctLen(Math.min(item.endMin, model.rangeEndMin) - Math.max(item.startMin, model.rangeStartMin))
      mark.title = `${clock(item.startMin)}–${clock(item.endMin)} ${item.text}`
    }
    if (day.date === model.today && nowMin >= model.rangeStartMin && nowMin <= model.rangeEndMin) {
      col.createDiv({ cls: "modular-diary-period-now" }).style.top = pct(nowMin)
    }
  }
  if (!anything && model.todos.length === 0 && model.days.every((day) => day.allDay.length === 0)) {
    host.createDiv({ cls: "modular-diary-period-empty-hint", text: t("periodEmptyHint") })
  }
  const paintOverflow = (): void => { scroll.classList.toggle("is-scrollable-right", scroll.scrollLeft + scroll.clientWidth < scroll.scrollWidth - 1) }
  scroll.addEventListener("scroll", paintOverflow, { passive: true })
  queueMicrotask(paintOverflow)
}

/**
 * Fit the hour height to the rail so the calendar and the rail end together:
 * short weeks get roomier hours (up to 40px), long rails never stretch the
 * calendar past that.
 */
function fitHourHeight(root: HTMLElement, rail: HTMLElement, main: HTMLElement, hours: number): () => void {
  const win = root.ownerDocument.defaultView
  if (!win || typeof win.ResizeObserver !== "function") return () => undefined
  let frame = 0
  const measure = (): void => {
    frame = 0
    const cal = main.querySelector<HTMLElement>(".modular-diary-period-cal")
    const col = main.querySelector<HTMLElement>(".modular-diary-period-col")
    if (!cal || !col) return
    // Stacked (narrow block): the rail no longer sits beside the week, so it sets nothing.
    if (Math.abs(rail.getBoundingClientRect().top - main.getBoundingClientRect().top) > 4) {
      root.style.setProperty("--modular-diary-period-hour", `${PERIOD_HOUR_HEIGHT}px`)
      rail.classList.remove("is-capped")
      rail.style.maxHeight = ""
      return
    }
    const chrome = cal.getBoundingClientRect().height - col.getBoundingClientRect().height
    if (root.classList.contains("is-fixed-height")) {
      // The block owns its height: the hours fill the main pane, and the week scrolls past 22px an hour.
      const hour = Math.max(PERIOD_HOUR_MIN, Math.min(PERIOD_HOUR_MAX, Math.floor((main.clientHeight - chrome - 14) / hours)))
      root.style.setProperty("--modular-diary-period-hour", `${hour}px`)
      rail.classList.remove("is-capped")
      rail.style.maxHeight = ""
      return
    }
    // scrollHeight, not the box: capping the rail below must not feed back into this measure.
    const available = rail.scrollHeight - chrome - 14
    const ideal = Math.floor(available / hours)
    const hour = Math.max(PERIOD_HOUR_MIN, Math.min(PERIOD_HOUR_MAX, ideal))
    root.style.setProperty("--modular-diary-period-hour", `${hour}px`)
    // A very long rail scrolls on its own instead of stretching the week past 40px an hour.
    const capped = ideal > PERIOD_HOUR_MAX
    rail.classList.toggle("is-capped", capped)
    rail.style.maxHeight = capped ? `${Math.round(chrome + hour * hours + 14)}px` : ""
  }
  const observer = new win.ResizeObserver(() => { if (!frame) frame = win.requestAnimationFrame(measure) })
  observer.observe(rail)
  observer.observe(root)
  measure()
  return () => observer.disconnect()
}

/** Right-click / keyboard menu for a placed todo pill outside renderCalendar. */
function menuForRow(deps: PeriodViewDeps): (el: HTMLElement, id: string) => void {
  return (el, id) => {
    const open = (x: number, y: number): void => deps.onTodoMenu?.(id, x, y, () => el.dispatchEvent(new CustomEvent("modular-diary-edit")), null)
    el.addEventListener("contextmenu", (event) => { event.preventDefault(); event.stopPropagation(); open(event.clientX, event.clientY) })
    el.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) { event.preventDefault(); const rect = el.getBoundingClientRect(); open(rect.left, rect.bottom) }
      else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deps.onAssign(id, POOL_ZONE) }
    })
  }
}

export function renderPeriodInto(container: HTMLElement, model: PeriodViewModel, deps: PeriodViewDeps): HTMLElement {
  clearPillPreviews(container.ownerDocument)
  const root = container.createDiv({ cls: `modular-diary-period${model.indexReady ? "" : " is-loading"}` })
  root.style.setProperty("--modular-diary-rail-width", `${model.railWidth}px`)
  root.style.setProperty("--modular-diary-period-hour", `${PERIOD_HOUR_HEIGHT}px`)

  const bar = root.createDiv({ cls: "modular-diary-period-toolbar" })
  if (deps.onSwitchView) {
    const seg = bar.createDiv({ cls: "modular-diary-seg", attr: { role: "group", "aria-label": t("viewSwitch") } })
    for (const [view, label] of [["day", t("viewDay")], ["week", t("viewWeek")], ["month", t("viewMonth")]] as const) {
      const button = seg.createEl("button", { text: label, attr: { type: "button", "aria-pressed": String(model.embeddedView === view) } })
      button.addEventListener("click", () => deps.onSwitchView?.(view))
    }
  }
  if (model.scope && deps.onSetFace) {
    const seg = bar.createDiv({ cls: "modular-diary-seg is-soft", attr: { role: "group", "aria-label": t("faceSwitch") } })
    for (const [face, label] of [["plan", t("facePlan")], ["actual", t("faceActual")]] as const) {
      const button = seg.createEl("button", { text: label, attr: { type: "button", "aria-pressed": String(model.face === face) } })
      button.addEventListener("click", () => { if (model.face !== face) deps.onSetFace?.(face) })
    }
  }
  iconButton(bar, "chevron-left", t("previousPeriod")).addEventListener("click", () => deps.onShift(-1))
  iconButton(bar, "chevron-right", t("nextPeriod")).addEventListener("click", () => deps.onShift(1))
  const title = bar.createEl("span", { cls: "modular-diary-period-title" })
  const isWeek = model.period.days.length === 7 && weekdayIndex(model.period.start) === 1
  const isMonth = model.scope?.kind === "month"
  if (isWeek) title.createEl("span", { cls: "modular-diary-period-title-week", text: t("weekNumber", { week: String(isoWeek(model.period.start)) }) })
  title.createEl("span", { text: isMonth
    ? t("monthTitle", { year: model.period.start.slice(0, 4), month: String(Number(model.period.start.slice(5, 7))) })
    : isWeek
      ? `${shortDate(model.period.start)} – ${shortDate(model.period.end)}`
      : t("periodTitle", { start: shortDate(model.period.start), end: shortDate(model.period.end), days: String(model.period.days.length) }) })
  // "Back to this week" only when the view is somewhere else; on the current period there is nowhere to go back to.
  const onCurrent = isMonth ? model.period.start.slice(0, 7) === model.today.slice(0, 7) : model.period.start <= model.today && model.today <= model.period.end
  if (!onCurrent) bar.createEl("button", { cls: "modular-diary-period-text-button", text: t(isMonth ? "thisMonth" : "thisWeek"), attr: { type: "button" } }).addEventListener("click", deps.onToday)
  if (isMonth && model.face === "plan" && deps.onToggleShowTodos) {
    const toggle = bar.createEl("button", { cls: "modular-diary-period-text-button is-toggle", text: t("monthShowTodos"), attr: { type: "button", "aria-pressed": String(Boolean(model.showTodos)), title: t("monthShowTodosHint") } })
    toggle.addEventListener("click", () => deps.onToggleShowTodos?.())
  }
  // Paging is a view state; only an explicit pin rewrites the note.
  if (model.browsing) {
    const pin = bar.createEl("button", { cls: "modular-diary-period-text-button is-pin", attr: { type: "button", title: t("pinPeriodHint") } })
    setIcon(pin.createEl("span", { cls: "modular-diary-period-text-icon" }), "pin")
    pin.appendChild(pin.ownerDocument.createTextNode(t("pinPeriod")))
    pin.addEventListener("click", deps.onPin)
  }
  if (!model.indexReady) bar.createEl("span", { cls: "modular-diary-period-loading", text: t("periodLoading") })

  const body = root.createDiv({ cls: "modular-diary-period-body" })
  const rail = body.createEl("aside", { cls: "modular-diary-period-rail" })
  const plan = model.face === "plan" && model.scope !== undefined
  root.classList.toggle("is-plan", plan)
  if (plan) {
    // Written goals first; hour targets are protocol and sit on the board.
    renderTextGoals(rail, model, deps)
    renderRhythmBoard(rail, root, model, deps)
    renderTodoList(rail, root, model, deps)
  } else {
    if (!model.scope) renderGoals(rail, model, deps)
    if (!model.scope) renderTodoList(rail, root, model, deps)
    renderTotals(rail, model, deps)
  }
  const handle = body.createDiv({ cls: "modular-diary-period-rail-handle", attr: { role: "separator", tabindex: "0", "aria-orientation": "vertical", "aria-label": t("resizeRail"), title: t("resizeRail") } })
  attachRailResize(root, handle, deps)
  const main = body.createDiv({ cls: "modular-diary-period-main" })
  if (model.height) {
    root.classList.add("is-fixed-height")
    root.style.setProperty("--modular-diary-period-height", `${Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, model.height))}px`)
  }
  if (plan) renderPlanCalendar(main, root, model, deps, menuForRow(deps))
  else if (model.scope?.kind === "month") renderActualMonth(main, model, deps)
  else {
    renderCalendar(main, root, model, deps)
    fitHourHeight(root, rail, main, (model.rangeEndMin - model.rangeStartMin) / 60)
  }
  if (model.height && deps.onHeight) attachHeightResize(root, deps)
  return root
}

/** A grab bar along the bottom edge: drag sets the block height, double-click restores the default. */
function attachHeightResize(root: HTMLElement, deps: PeriodViewDeps): void {
  const handle = root.createDiv({ cls: "modular-diary-period-height-handle", attr: { role: "separator", tabindex: "0", "aria-orientation": "horizontal", "aria-label": t("resizeHeight"), title: t("resizeHeight") } })
  handle.createEl("span", { cls: "modular-diary-period-height-grip" })
  const current = (): number => parseFloat(getComputedStyle(root).getPropertyValue("--modular-diary-period-height")) || HEIGHT_MIN
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    const startY = event.clientY, startHeight = current()
    let height = startHeight
    root.classList.add("is-resizing-height")
    const move = (e: PointerEvent): void => {
      height = Math.round(Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, startHeight + e.clientY - startY)))
      root.style.setProperty("--modular-diary-period-height", `${height}px`)
    }
    const up = (): void => {
      handle.removeEventListener("pointermove", move)
      handle.removeEventListener("pointerup", up)
      handle.removeEventListener("pointercancel", up)
      root.classList.remove("is-resizing-height")
      if (height !== startHeight) deps.onHeight?.(height)
    }
    handle.setPointerCapture(event.pointerId)
    handle.addEventListener("pointermove", move)
    handle.addEventListener("pointerup", up)
    handle.addEventListener("pointercancel", up)
  })
  handle.addEventListener("dblclick", () => deps.onHeight?.(0))
  handle.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
    event.preventDefault()
    const next = Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, current() + (event.key === "ArrowDown" ? 24 : -24)))
    root.style.setProperty("--modular-diary-period-height", `${next}px`)
    deps.onHeight?.(next)
  })
}
