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
import { t } from "../i18n"
import { renderTodosInto, type NewTodoInput, type TodoViewItem } from "./todos-view"

export interface PeriodTodoView extends TodoItem {
  actualMinutes: number
  /** Where the todo sits in the period: all-day on a date, or planned at a time. */
  placement?: { date: string; startMin?: number }
}

export interface PeriodDayView {
  date: string
  entries: Entry[]
  spans: SpanNote[]
  /** Period todos placed all-day on this date. */
  allDay: PeriodTodoView[]
  hasNote: boolean
}

export interface PeriodViewModel {
  spec: PeriodSpec
  period: ResolvedPeriod
  today: string
  goals: GoalProgress[]
  totals: Array<{ type: string; minutes: number }>
  todos: PeriodTodoView[]
  todoView: TodoViewConfig
  days: PeriodDayView[]
  rangeStartMin: number
  rangeEndMin: number
  indexReady: boolean
  railWidth: number
}

export interface GoalDraft { kind: PeriodGoal["kind"]; key: string; targetMinutes: number }

export interface PeriodViewDeps {
  typeColors: Record<string, string>
  categories: string[]
  tagStyle?: (tag: string) => { background: string; color: string } | null
  tagSuggest?: TagSuggestDeps
  onShift: (direction: 1 | -1) => void
  onToday: () => void
  onOpenDay: (date: string) => void
  /** Place all-day on a date, or back to unplaced with POOL_ZONE. */
  onAssign: (id: string, to: string) => void
  onPlan: (id: string, date: string, startMin: number) => void
  onAdd: (input: NewTodoInput) => void
  onEdit: (id: string, input: NewTodoInput) => void
  onToggle: (id: string, completed: boolean) => void | Promise<void>
  onDelete: (id: string) => void
  onMove: (id: string, targetIndex: number) => void
  onGroupMenu: (x: number, y: number) => void
  onSortMenu: (x: number, y: number) => void
  onTodoMenu?: (id: string, x: number, y: number, edit: () => void) => void
  onSaveGoal: (line: number | null, goal: GoalDraft) => void
  onDeleteGoal: (line: number) => void
  onRailWidth: (px: number) => void
}

export const PERIOD_HOUR_HEIGHT = 20
export const PERIOD_SNAP_MINUTES = 30
export const POOL_ZONE = "pool"
export const RAIL_MIN = 180
export const RAIL_MAX = 420

const clock = (minutes: number): string => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
const monthDay = (date: string): string => date.slice(5).replace("-", ".")
const weekdayIndex = (date: string): number => {
  const [y, m, d] = date.split("-").map(Number)
  return new Date(y, m - 1, d).getDay()
}
export const weekday = (date: string): string => `${t("weekdayPrefix")}${t("weekdayNames").split(" ")[weekdayIndex(date)] ?? ""}`

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

function iconButton(parent: HTMLElement, icon: string, label: string, cls = ""): HTMLButtonElement {
  const button = parent.createEl("button", { cls: `modular-diary-period-icon${cls ? " " + cls : ""}`, attr: { type: "button", "aria-label": label } })
  setIcon(button, icon)
  return button
}

/* ── drag: list rows and calendar pills move between the list, all-day cells and a day's hours ── */

interface DragSubject { todo: PeriodTodoView; from: string }

function attachDrag(root: HTMLElement, handle: HTMLElement, subject: DragSubject, model: PeriodViewModel, deps: PeriodViewDeps): void {
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
    const clear = (): void => { zone?.classList.remove("is-over"); preview?.remove(); preview = null; zone = null }
    const minutesAt = (axis: HTMLElement, clientY: number): number => {
      const rect = axis.getBoundingClientRect()
      const raw = model.rangeStartMin + ((clientY - rect.top) / PERIOD_HOUR_HEIGHT) * 60 - duration / 2
      const snapped = Math.round(raw / PERIOD_SNAP_MINUTES) * PERIOD_SNAP_MINUTES
      return Math.max(model.rangeStartMin, Math.min(snapped, model.rangeEndMin - duration))
    }
    const onMove = (move: PointerEvent): void => {
      if (!ghost) {
        if (Math.hypot(move.clientX - startX, move.clientY - startY) < 4) return
        ghost = dom.createElement("div")
        ghost.className = "modular-diary-period-pill is-ghost"
        ghost.textContent = subject.todo.title
        if (color) ghost.style.setProperty("--modular-diary-pill-color", color)
        dom.body.appendChild(ghost)
        root.classList.add("is-dragging")
        handle.classList.add("is-drag-source")
      }
      ghost.style.transform = `translate(${move.clientX + 12}px, ${move.clientY + 10}px)`
      const under = (dom.elementFromPoint(move.clientX, move.clientY)?.closest("[data-zone]") ?? null) as HTMLElement | null
      if (under !== zone) { clear(); zone = under; zone?.classList.add("is-over") }
      if (zone?.dataset.zoneKind === "axis") {
        startMin = minutesAt(zone, move.clientY)
        if (!preview) {
          preview = zone.createDiv({ cls: "modular-diary-period-drop-preview" })
          if (color) preview.style.setProperty("--modular-diary-block-color", color)
        }
        preview.style.top = `${((startMin - model.rangeStartMin) / 60) * PERIOD_HOUR_HEIGHT}px`
        preview.style.height = `${(duration / 60) * PERIOD_HOUR_HEIGHT}px`
        preview.dataset.time = `${clock(startMin)}–${clock(startMin + duration)}`
      }
      if (ghost) ghost.hidden = zone?.dataset.zoneKind === "axis"
    }
    const finish = (commit: boolean): void => {
      handle.removeEventListener("pointermove", onMove)
      handle.removeEventListener("pointerup", onUp)
      handle.removeEventListener("pointercancel", onCancel)
      dom.removeEventListener("keydown", onKey, true)
      const dropped = zone, minutes = startMin, dragged = ghost !== null
      clear()
      ghost?.remove(); ghost = null
      root.classList.remove("is-dragging")
      handle.classList.remove("is-drag-source")
      if (!commit || !dragged || !dropped) return
      const to = dropped.dataset.zone ?? ""
      if (dropped.dataset.zoneKind === "axis") deps.onPlan(subject.todo.id, to, minutes)
      else if (to !== subject.from) deps.onAssign(subject.todo.id, to)
    }
    const onUp = (): void => finish(true)
    const onCancel = (): void => finish(false)
    const onKey = (key: KeyboardEvent): void => { if (key.key === "Escape") { key.preventDefault(); finish(false) } }
    handle.setPointerCapture(event.pointerId)
    handle.addEventListener("pointermove", onMove)
    handle.addEventListener("pointerup", onUp)
    handle.addEventListener("pointercancel", onCancel)
    dom.addEventListener("keydown", onKey, true)
  })
}

/* ── rail ── */

function goalEditor(host: HTMLElement, initial: GoalDraft | null, line: number | null, deps: PeriodViewDeps, close: () => void): HTMLFormElement {
  const form = host.createEl("form", { cls: "modular-diary-period-goal-form" })
  form.noValidate = true
  let kind: PeriodGoal["kind"] = initial?.kind ?? "type"
  const seg = form.createDiv({ cls: "modular-diary-period-seg", attr: { role: "radiogroup", "aria-label": t("goalKind") } })
  const typeBtn = seg.createEl("button", { text: t("goalByCategory"), attr: { type: "button", role: "radio" } })
  const tagBtn = seg.createEl("button", { text: t("goalByTag"), attr: { type: "button", role: "radio" } })
  const keyHost = form.createDiv({ cls: "modular-diary-period-goal-key" })
  const target = form.createDiv({ cls: "modular-diary-period-goal-target" })
  const hours = target.createEl("input", { attr: { type: "number", min: "0.25", step: "0.25", inputmode: "decimal", "aria-label": t("goalTargetHours") } })
  hours.value = initial ? String(+(initial.targetMinutes / 60).toFixed(2)) : "3"
  target.createEl("span", { text: t("hoursShort") })
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
    deps.onSaveGoal(line, { kind, key, targetMinutes: minutes })
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
    const row = list.createDiv({ cls: `modular-diary-period-goal${item.complete ? " is-complete" : ""}`, attr: { role: "button", tabindex: "0" } })
    row.setAttribute("aria-label", t("editGoalNamed", { name: item.goal.key }))
    row.title = item.complete ? t("goalComplete") : t("goalRemaining", { hours: formatHours(item.goal.targetMinutes - item.doneMinutes) })
    const head = row.createDiv({ cls: "modular-diary-period-goal-head" })
    const color = item.goal.kind === "type" ? deps.typeColors[item.goal.key] : undefined
    if (item.goal.kind === "type") badge(head, item.goal.key, color ? tint(color) : null)
    else badge(head, `#${item.goal.key}`, deps.tagStyle?.(item.goal.key) ?? null)
    const value = head.createEl("span", { cls: "modular-diary-period-goal-value" })
    value.createEl("b", { text: formatHours(item.doneMinutes) })
    value.appendChild(value.ownerDocument.createTextNode(` / ${formatHours(item.goal.targetMinutes)}`))
    const track = row.createDiv({ cls: "modular-diary-period-meter" })
    const bar = track.createDiv({ cls: "modular-diary-period-meter-bar" })
    bar.style.width = `${Math.round(item.ratio * 100)}%`
    bar.style.background = color ?? deps.tagStyle?.(item.goal.key)?.color ?? "var(--text-muted)"
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

function placementFlag(todo: PeriodTodoView): { text: string; tone: "placed" | "due" }[] {
  const flags: { text: string; tone: "placed" | "due" }[] = []
  if (todo.placement) flags.push({ text: todo.placement.startMin !== undefined ? `${weekday(todo.placement.date)} ${clock(todo.placement.startMin)}` : weekday(todo.placement.date), tone: "placed" })
  if (todo.due) flags.push({ text: `⚑ ${weekday(todo.due)}`, tone: "due" })
  return flags
}

function renderTodoList(rail: HTMLElement, root: HTMLElement, model: PeriodViewModel, deps: PeriodViewDeps): void {
  const section = rail.createEl("section", { cls: "modular-diary-period-section modular-diary-period-todos" })
  section.dataset.zone = POOL_ZONE
  section.dataset.zoneKind = "list"
  const items: TodoViewItem[] = model.todos.map((todo) => ({
    id: todo.id, title: todo.title, group: todo.group, type: todo.type, completed: todo.completed, weekly: false,
    estimateMinutes: todo.estimateMin, actualMinutes: todo.actualMinutes, flags: placementFlag(todo),
  }))
  renderTodosInto(section, items, {
    title: t("periodTodos"),
    categories: deps.categories,
    typeColors: deps.typeColors,
    view: model.todoView,
    tagStyle: deps.tagStyle,
    tagSuggest: deps.tagSuggest,
    onAdd: deps.onAdd,
    onEdit: deps.onEdit,
    onGroupMenu: deps.onGroupMenu,
    onSortMenu: deps.onSortMenu,
    onToggle: deps.onToggle,
    onMove: deps.onMove,
    onMenu: (item, x, y, edit) => deps.onTodoMenu?.(item.id, x, y, edit),
  })
  const byId = new Map(model.todos.map((todo) => [todo.id, todo]))
  section.querySelectorAll<HTMLElement>(".modular-diary-todo-row[data-todo-id]").forEach((row) => {
    const todo = byId.get(row.dataset.todoId ?? "")
    const body = row.querySelector<HTMLElement>(".modular-diary-todo-body")
    if (!todo || !body) return
    body.classList.add("modular-diary-period-draggable")
    attachDrag(root, body, { todo, from: todo.placement && todo.placement.startMin === undefined ? todo.placement.date : POOL_ZONE }, model, deps)
  })
}

function renderTotals(rail: HTMLElement, model: PeriodViewModel, deps: PeriodViewDeps): void {
  const section = rail.createEl("section", { cls: "modular-diary-period-section" })
  const header = section.createDiv({ cls: "modular-diary-component-header" })
  header.createEl("span", { cls: "modular-diary-component-title", text: t("periodTotals") })
  const sum = model.totals.reduce((acc, item) => acc + item.minutes, 0)
  if (sum > 0) header.createEl("span", { cls: "modular-diary-component-count", text: formatHours(sum) })
  const totals = section.createDiv({ cls: "modular-diary-period-totals" })
  const max = model.totals[0]?.minutes ?? 0
  for (const total of model.totals) {
    totals.createEl("span", { cls: "modular-diary-period-total-name", text: total.type })
    const track = totals.createDiv({ cls: "modular-diary-period-meter" })
    const bar = track.createDiv({ cls: "modular-diary-period-meter-bar" })
    bar.style.width = `${max ? Math.max(3, Math.round(total.minutes / max * 100)) : 0}%`
    bar.style.background = deps.typeColors[total.type] ?? "var(--text-muted)"
    totals.createEl("span", { cls: "modular-diary-period-total-hours", text: formatHours(total.minutes) })
  }
  if (model.totals.length === 0) section.createEl("p", { cls: "modular-diary-period-muted", text: t("periodNoRecords") })
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
  handle.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()
    const current = parseFloat(getComputedStyle(root).getPropertyValue("--modular-diary-rail-width")) || 240
    const next = Math.max(RAIL_MIN, Math.min(RAIL_MAX, current + (event.key === "ArrowRight" ? 16 : -16)))
    root.style.setProperty("--modular-diary-rail-width", `${next}px`)
    deps.onRailWidth(next)
  })
}

/* ── calendar ── */

function renderCalendar(host: HTMLElement, root: HTMLElement, model: PeriodViewModel, deps: PeriodViewDeps): void {
  const scroll = host.createDiv({ cls: "modular-diary-period-cal-scroll" })
  const cal = scroll.createDiv({ cls: "modular-diary-period-cal" })
  const count = model.days.length
  cal.style.setProperty("--modular-diary-period-days", String(count))
  cal.style.setProperty("--modular-diary-period-hour", `${PERIOD_HOUR_HEIGHT}px`)
  const bodyHeight = ((model.rangeEndMin - model.rangeStartMin) / 60) * PERIOD_HOUR_HEIGHT
  const y = (minutes: number): number => ((minutes - model.rangeStartMin) / 60) * PERIOD_HOUR_HEIGHT

  // Row 1: day heads.
  cal.createDiv({ cls: "modular-diary-period-corner" })
  for (const day of model.days) {
    const isToday = day.date === model.today
    const past = day.date < model.today
    const head = cal.createDiv({ cls: `modular-diary-period-head${isToday ? " is-today" : ""}${past ? " is-past" : ""}`, attr: { role: "button", tabindex: "0", "aria-label": t("openDay", { date: day.date }) } })
    head.createEl("span", { cls: "modular-diary-period-head-weekday", text: weekday(day.date) })
    head.createEl("span", { cls: "modular-diary-period-head-date", text: String(Number(day.date.slice(8))) })
    const open = (): void => deps.onOpenDay(day.date)
    head.addEventListener("click", open)
    head.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open() } })
  }

  // Row 2: all-day band.
  cal.createDiv({ cls: "modular-diary-period-gutter-label", text: t("allDay") })
  for (const day of model.days) {
    const cell = cal.createDiv({ cls: `modular-diary-period-allday${day.date === model.today ? " is-today" : ""}` })
    cell.dataset.zone = day.date
    cell.dataset.zoneKind = "list"
    for (const todo of day.allDay) {
      const pill = cell.createDiv({ cls: `modular-diary-period-pill${todo.completed ? " is-complete" : ""}`, attr: { tabindex: "0" } })
      pill.textContent = todo.title.replace(/#[^\s#]+/g, "").trim() || todo.title
      pill.title = `${todo.title}${todo.type ? " · " + todo.type : ""} · ${formatHours(todo.estimateMin)}`
      const color = todo.type ? deps.typeColors[todo.type] : undefined
      if (color) pill.style.setProperty("--modular-diary-pill-color", color)
      attachDrag(root, pill, { todo, from: day.date }, model, deps)
      pill.addEventListener("contextmenu", (event) => {
        event.preventDefault()
        event.stopPropagation()
        deps.onTodoMenu?.(todo.id, event.clientX, event.clientY, () => undefined)
      })
    }
    for (const todo of model.todos) {
      if (todo.due !== day.date || todo.completed) continue
      cell.createDiv({ cls: "modular-diary-period-due", text: `⚑ ${todo.title.replace(/#[^\s#]+/g, "").trim() || todo.title}`, attr: { title: t("dueOn", { date: monthDay(todo.due) }) } })
    }
  }

  // Row 3: hours.
  const gutter = cal.createDiv({ cls: "modular-diary-period-gutter" })
  gutter.style.height = `${bodyHeight}px`
  for (let h = Math.ceil(model.rangeStartMin / 60) + 1; h * 60 < model.rangeEndMin; h += 1) {
    if (h % 2 !== 0) continue
    gutter.createEl("span", { text: `${h % 24}` }).style.top = `${y(h * 60)}px`
  }
  const nowMin = (() => { const now = new Date(); return now.getHours() * 60 + now.getMinutes() })()
  for (const day of model.days) {
    const col = cal.createDiv({ cls: `modular-diary-period-col${day.date === model.today ? " is-today" : ""}` })
    col.dataset.zone = day.date
    col.dataset.zoneKind = "axis"
    col.style.height = `${bodyHeight}px`
    col.style.backgroundPositionY = `${-y(Math.ceil(model.rangeStartMin / 60) * 60) + y(model.rangeStartMin)}px`
    const sorted = [...day.entries].sort((a, b) => Number(!a.plan) - Number(!b.plan) || a.startMin - b.startMin)
    for (const entry of sorted) {
      if (entry.endMin <= model.rangeStartMin || entry.startMin >= model.rangeEndMin) continue
      const top = y(Math.max(entry.startMin, model.rangeStartMin))
      const height = Math.max(3, y(Math.min(entry.endMin, model.rangeEndMin)) - top - 1)
      const color = deps.typeColors[entry.type] ?? "var(--text-faint)"
      const block = col.createDiv({ cls: `modular-diary-period-block${entry.plan ? " is-plan" : ""}` })
      block.style.top = `${top + 0.5}px`
      block.style.height = `${height}px`
      block.style.setProperty("--modular-diary-block-color", color)
      if (!entry.plan && color.startsWith("#")) block.style.color = blockTextColor(color)
      block.title = `${entry.plan ? t("planLabel") + " · " : ""}${clock(entry.startMin)}–${clock(entry.endMin)} ${entry.type}${entry.note ? " · " + entry.note : ""}`
      if (height >= 30 && entry.note) block.createEl("span", { cls: "modular-diary-period-block-note", text: entry.note.replace(/#[^\s#]+/g, "").trim() || entry.note })
      if (height >= 15) block.createEl("span", { cls: "modular-diary-period-block-time", text: formatHours(entry.endMin - entry.startMin) })
    }
    for (const item of day.spans) {
      const mark = col.createDiv({ cls: "modular-diary-period-span" })
      mark.style.top = `${y(item.startMin)}px`
      mark.style.height = `${Math.max(4, y(item.endMin) - y(item.startMin))}px`
      mark.title = `${clock(item.startMin)}–${clock(item.endMin)} ${item.text}`
    }
    if (day.date === model.today && nowMin >= model.rangeStartMin && nowMin <= model.rangeEndMin) {
      col.createDiv({ cls: "modular-diary-period-now" }).style.top = `${y(nowMin)}px`
    }
  }
}

export function renderPeriodInto(container: HTMLElement, model: PeriodViewModel, deps: PeriodViewDeps): HTMLElement {
  const root = container.createDiv({ cls: "modular-diary-period" })
  root.style.setProperty("--modular-diary-rail-width", `${model.railWidth}px`)

  const bar = root.createDiv({ cls: "modular-diary-period-toolbar" })
  iconButton(bar, "chevron-left", t("previousPeriod")).addEventListener("click", () => deps.onShift(-1))
  iconButton(bar, "chevron-right", t("nextPeriod")).addEventListener("click", () => deps.onShift(1))
  bar.createEl("span", { cls: "modular-diary-period-title", text: t("periodTitle", { start: monthDay(model.period.start), end: monthDay(model.period.end), days: String(model.period.days.length) }) })
  if (model.spec.kind !== "this-week") bar.createEl("button", { cls: "modular-diary-period-text-button", text: t("thisWeek"), attr: { type: "button" } }).addEventListener("click", deps.onToday)
  if (!model.indexReady) bar.createEl("span", { cls: "modular-diary-period-loading", attr: { "aria-label": t("periodLoading"), title: t("periodLoading") } })

  const body = root.createDiv({ cls: "modular-diary-period-body" })
  const rail = body.createEl("aside", { cls: "modular-diary-period-rail" })
  renderGoals(rail, model, deps)
  renderTodoList(rail, root, model, deps)
  renderTotals(rail, model, deps)
  const handle = body.createDiv({ cls: "modular-diary-period-rail-handle", attr: { role: "separator", tabindex: "0", "aria-orientation": "vertical", "aria-label": t("resizeRail") } })
  attachRailResize(root, handle, deps)
  const main = body.createDiv({ cls: "modular-diary-period-main" })
  renderCalendar(main, root, model, deps)
  return root
}
