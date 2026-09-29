/**
 * Period block (`days:`): the period's own todos and goals in a rail, one
 * column per day. Period todos are separate from day todos: a pool todo can
 * be assigned to a day (all-day, `day=`) or planned at a time (a plan block
 * in that day's note). Day notes' own todos never show here; their timeline
 * does. Every change goes back through deps so the markdown stays the truth.
 */
import { setIcon } from "obsidian"
import { formatHours } from "../core/duration"
import type { GoalProgress, ResolvedPeriod } from "../core/period"
import type { Entry, PeriodSpec, SpanNote, TodoItem } from "../core/types"
import type { TagSuggestDeps } from "../edit/tag-suggest"
import { t } from "../i18n"
import { createTodoForm, renderTitleWithTags, type NewTodoInput } from "./todos-view"

export interface PeriodDayView {
  date: string
  entries: Entry[]
  spans: SpanNote[]
  /** Period todos assigned to this day (all-day). */
  todos: TodoItem[]
  hasNote: boolean
}

export interface PeriodViewModel {
  spec: PeriodSpec
  period: ResolvedPeriod
  today: string
  goals: GoalProgress[]
  totals: Array<{ type: string; minutes: number }>
  /** Period todos not assigned to any day. */
  pool: TodoItem[]
  days: PeriodDayView[]
  rangeStartMin: number
  rangeEndMin: number
  indexReady: boolean
}

export interface PeriodViewDeps {
  typeColors: Record<string, string>
  categories: string[]
  tagStyle?: (tag: string) => { background: string; color: string } | null
  tagSuggest?: TagSuggestDeps
  onShift: (direction: 1 | -1) => void
  onToday: () => void
  onOpenDay: (date: string) => void
  /** Assign to a day ("pool" unassigns). */
  onAssign: (id: string, to: string) => void
  /** Assign and plan at a time inside that day's note. */
  onPlan: (id: string, date: string, startMin: number) => void
  onAdd: (input: NewTodoInput) => void
  onEdit: (id: string, input: NewTodoInput) => void
  onMenu: (todo: TodoItem, x: number, y: number) => void
}

export const PERIOD_HOUR_HEIGHT = 18
export const PERIOD_SNAP_MINUTES = 30
export const POOL_ZONE = "pool"

const clock = (minutes: number): string => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
const monthDay = (date: string): string => date.slice(5).replace("-", ".")
const weekday = (date: string): string => {
  const [y, m, d] = date.split("-").map(Number)
  const names = t("weekdayNames").split(" ")
  return `${t("weekdayPrefix")}${names[new Date(y, m - 1, d).getDay()] ?? ""}`
}

function attachChipDrag(root: HTMLElement, chip: HTMLElement, id: string, from: string, model: PeriodViewModel, deps: PeriodViewDeps): void {
  chip.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("form")) return
    const dom = root.ownerDocument
    const startX = event.clientX, startY = event.clientY
    let ghost: HTMLElement | null = null
    let zone: HTMLElement | null = null
    let indicator: HTMLElement | null = null
    let lastMinutes = 0
    const clearZone = (): void => { zone?.classList.remove("is-over"); indicator?.remove(); indicator = null; zone = null }
    const axisMinutes = (target: HTMLElement, clientY: number): number => {
      const rect = target.getBoundingClientRect()
      const span = model.rangeEndMin - model.rangeStartMin
      const raw = model.rangeStartMin + ((clientY - rect.top) / rect.height) * span
      const snapped = Math.round(raw / PERIOD_SNAP_MINUTES) * PERIOD_SNAP_MINUTES
      return Math.max(model.rangeStartMin, Math.min(snapped, model.rangeEndMin - PERIOD_SNAP_MINUTES))
    }
    const onMove = (move: PointerEvent): void => {
      if (!ghost) {
        if (Math.hypot(move.clientX - startX, move.clientY - startY) < 4) return
        ghost = chip.cloneNode(true) as HTMLElement
        ghost.classList.add("is-ghost")
        ghost.style.width = `${chip.getBoundingClientRect().width}px`
        dom.body.appendChild(ghost)
        chip.classList.add("is-dragging")
        root.classList.add("is-dragging")
      }
      ghost.style.transform = `translate(${move.clientX + 10}px, ${move.clientY + 8}px)`
      const under = (dom.elementFromPoint(move.clientX, move.clientY)?.closest("[data-zone]") ?? null) as HTMLElement | null
      if (under !== zone) { clearZone(); zone = under; zone?.classList.add("is-over") }
      if (zone?.dataset.zoneKind === "axis") {
        lastMinutes = axisMinutes(zone, move.clientY)
        if (!indicator) indicator = zone.createDiv({ cls: "modular-diary-period-drop-line" })
        indicator.style.top = `${((lastMinutes - model.rangeStartMin) / 60) * PERIOD_HOUR_HEIGHT}px`
        indicator.dataset.time = clock(lastMinutes)
      }
    }
    const finish = (commit: boolean): void => {
      chip.removeEventListener("pointermove", onMove)
      chip.removeEventListener("pointerup", onUp)
      chip.removeEventListener("pointercancel", onCancel)
      dom.removeEventListener("keydown", onKey, true)
      const target = zone, minutes = lastMinutes, dragged = ghost !== null
      clearZone()
      ghost?.remove(); ghost = null
      chip.classList.remove("is-dragging"); root.classList.remove("is-dragging")
      if (!commit || !dragged || !target) return
      const to = target.dataset.zone ?? ""
      if (target.dataset.zoneKind === "axis") deps.onPlan(id, to, minutes)
      else if (to !== from) deps.onAssign(id, to)
    }
    const onUp = (): void => finish(true)
    const onCancel = (): void => finish(false)
    const onKey = (key: KeyboardEvent): void => { if (key.key === "Escape") { key.preventDefault(); finish(false) } }
    chip.setPointerCapture(event.pointerId)
    chip.addEventListener("pointermove", onMove)
    chip.addEventListener("pointerup", onUp)
    chip.addEventListener("pointercancel", onCancel)
    dom.addEventListener("keydown", onKey, true)
  })
}

function todoChip(parent: HTMLElement, todo: TodoItem, from: string, model: PeriodViewModel, deps: PeriodViewDeps): HTMLElement {
  const chip = parent.createDiv({ cls: `modular-diary-period-chip${todo.completed ? " is-complete" : ""}` })
  chip.dataset.todoId = todo.id
  chip.tabIndex = 0
  const color = todo.type ? deps.typeColors[todo.type] : undefined
  if (color) chip.style.setProperty("--modular-diary-chip-color", color)
  const bits = [todo.type, formatHours(todo.estimateMin), todo.due ? t("dueOn", { date: monthDay(todo.due) }) : ""].filter(Boolean)
  chip.setAttribute("aria-label", `${todo.title} · ${bits.join(" · ")}`)
  chip.title = `${todo.title} · ${bits.join(" · ")}`
  renderTitleWithTags(chip.createEl("span", { cls: "modular-diary-period-chip-title" }), todo.title, deps.tagStyle)
  if (todo.due && from === POOL_ZONE) chip.createEl("span", { cls: "modular-diary-period-chip-due", text: `⚑ ${weekday(todo.due)}` })
  const root = parent.closest<HTMLElement>(".modular-diary-period") ?? parent
  attachChipDrag(root, chip, todo.id, from, model, deps)
  const openMenu = (x: number, y: number): void => deps.onMenu(todo, x, y)
  chip.addEventListener("contextmenu", (event) => { event.preventDefault(); event.stopPropagation(); openMenu(event.clientX, event.clientY) })
  chip.addEventListener("keydown", (event) => {
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) { event.preventDefault(); const r = chip.getBoundingClientRect(); openMenu(r.left, r.bottom) }
  })
  // Double-click edits in place with the same form the day todo list uses.
  chip.addEventListener("dblclick", () => {
    const editor = createTodoForm(parent, deps.categories, "modular-diary-todo-edit-form modular-diary-period-edit-form", (input) => { editor.close(); deps.onEdit(todo.id, input) }, () => { editor.form.remove(); chip.hidden = false }, undefined, deps.tagSuggest)
    parent.insertBefore(editor.form, chip)
    chip.hidden = true
    editor.open({ title: todo.title, type: todo.type, estimateMinutes: todo.estimateMin })
  })
  return chip
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

const tint = (color: string): { background: string; color: string } => ({
  background: `color-mix(in srgb, ${color} 22%, var(--background-primary))`,
  color: `color-mix(in srgb, ${color} 70%, var(--text-normal))`,
})

function renderRail(root: HTMLElement, model: PeriodViewModel, deps: PeriodViewDeps): void {
  const rail = root.createEl("aside", { cls: "modular-diary-period-rail" })

  const goalsSection = rail.createEl("section", { cls: "modular-diary-period-section" })
  goalsSection.createEl("h4", { cls: "modular-diary-period-heading", text: t("periodGoals") })
  if (model.goals.length === 0) goalsSection.createEl("p", { cls: "modular-diary-period-hint", text: t("periodGoalsHint") })
  for (const item of model.goals) {
    const goal = goalsSection.createDiv({ cls: `modular-diary-period-goal${item.complete ? " is-complete" : ""}` })
    const head = goal.createDiv({ cls: "modular-diary-period-goal-head" })
    const color = item.goal.kind === "type" ? deps.typeColors[item.goal.key] : undefined
    if (item.goal.kind === "type") badge(head, item.goal.key, color ? tint(color) : null)
    else badge(head, `#${item.goal.key}`, deps.tagStyle?.(item.goal.key) ?? null)
    head.createEl("b", { text: `${formatHours(item.doneMinutes)} / ${formatHours(item.goal.targetMinutes)}` })
    const track = goal.createDiv({ cls: "modular-diary-period-bar-track" })
    const bar = track.createDiv({ cls: "modular-diary-period-bar" })
    bar.style.width = `${Math.round(item.ratio * 100)}%`
    if (color) bar.style.background = color
    goal.createDiv({ cls: "modular-diary-period-goal-status", text: item.complete ? t("goalComplete") : t("goalRemaining", { hours: formatHours(item.goal.targetMinutes - item.doneMinutes) }) })
  }

  const poolSection = rail.createEl("section", { cls: "modular-diary-period-section" })
  const poolHead = poolSection.createDiv({ cls: "modular-diary-period-heading-row" })
  poolHead.createEl("h4", { cls: "modular-diary-period-heading", text: t("periodPool") })
  poolHead.createEl("span", { cls: "modular-diary-period-count", text: String(model.pool.length) })
  const add = poolHead.createEl("button", { cls: "modular-diary-period-add", attr: { type: "button", "aria-label": t("addPeriodTodo") } })
  setIcon(add, "plus")
  const pool = poolSection.createDiv({ cls: "modular-diary-period-pool" })
  pool.dataset.zone = POOL_ZONE
  pool.dataset.zoneKind = "list"
  const addForm = createTodoForm(poolSection, deps.categories, "modular-diary-todo-add-form modular-diary-period-add-form", (input) => { addForm.close(); deps.onAdd(input) }, undefined, undefined, deps.tagSuggest)
  poolSection.insertBefore(addForm.form, pool)
  add.addEventListener("click", () => addForm.form.hidden ? addForm.open({ title: "", estimateMinutes: 30, estimateUnit: "minutes" }) : addForm.close())
  for (const todo of model.pool) todoChip(pool, todo, POOL_ZONE, model, deps)
  if (model.pool.length === 0) pool.createEl("span", { cls: "modular-diary-period-empty", text: t("periodPoolEmpty") })
  poolSection.createEl("p", { cls: "modular-diary-period-hint", text: t("periodPoolHint") })

  const totalsSection = rail.createEl("section", { cls: "modular-diary-period-section" })
  totalsSection.createEl("h4", { cls: "modular-diary-period-heading", text: t("periodTotals") })
  const totals = totalsSection.createDiv({ cls: "modular-diary-period-totals" })
  const max = model.totals[0]?.minutes ?? 0
  for (const total of model.totals) {
    totals.createEl("span", { cls: "modular-diary-period-total-name", text: total.type })
    const track = totals.createDiv({ cls: "modular-diary-period-bar-track" })
    const bar = track.createDiv({ cls: "modular-diary-period-bar" })
    bar.style.width = `${max ? Math.max(2, Math.round(total.minutes / max * 100)) : 0}%`
    bar.style.background = deps.typeColors[total.type] ?? "var(--text-muted)"
    totals.createEl("span", { cls: "modular-diary-period-total-hours", text: formatHours(total.minutes) })
  }
  if (model.totals.length === 0) totals.createEl("span", { cls: "modular-diary-period-empty", text: t("periodNoRecords") })
}

function renderAxis(column: HTMLElement, day: PeriodDayView, model: PeriodViewModel, deps: PeriodViewDeps): void {
  const axis = column.createDiv({ cls: `modular-diary-period-axis${day.date === model.today ? " is-today" : ""}` })
  axis.dataset.zone = day.date
  axis.dataset.zoneKind = "axis"
  const span = model.rangeEndMin - model.rangeStartMin
  axis.style.height = `${(span / 60) * PERIOD_HOUR_HEIGHT}px`
  const y = (minutes: number): number => ((minutes - model.rangeStartMin) / 60) * PERIOD_HOUR_HEIGHT
  for (let h = Math.ceil(model.rangeStartMin / 60); h * 60 <= model.rangeEndMin; h += 1) {
    axis.createDiv({ cls: "modular-diary-period-hour" }).style.top = `${y(h * 60)}px`
  }
  const sorted = [...day.entries].sort((a, b) => Number(!a.plan) - Number(!b.plan) || a.startMin - b.startMin)
  for (const entry of sorted) {
    const top = y(entry.startMin), h = Math.max(3, y(entry.endMin) - top - 1)
    const block = axis.createDiv({ cls: `modular-diary-period-block${entry.plan ? " is-plan" : ""}` })
    block.style.top = `${top + 0.5}px`
    block.style.height = `${h}px`
    block.style.setProperty("--modular-diary-block-color", deps.typeColors[entry.type] ?? "var(--text-muted)")
    block.title = `${entry.plan ? t("planLabel") + " " : ""}${clock(entry.startMin)}–${clock(entry.endMin)} ${entry.type}${entry.note ? " · " + entry.note : ""}`
    if (h >= 13) block.createEl("span", { text: formatHours(entry.endMin - entry.startMin) })
  }
  for (const item of day.spans) {
    const mark = axis.createDiv({ cls: "modular-diary-period-span" })
    mark.style.top = `${y(item.startMin)}px`
    mark.style.height = `${Math.max(4, y(item.endMin) - y(item.startMin))}px`
    mark.title = `${clock(item.startMin)}–${clock(item.endMin)} ${item.text}`
  }
  if (day.date === model.today) {
    const now = new Date()
    const minutes = now.getHours() * 60 + now.getMinutes()
    if (minutes >= model.rangeStartMin && minutes <= model.rangeEndMin) axis.createDiv({ cls: "modular-diary-period-now" }).style.top = `${y(minutes)}px`
  }
}

export function renderPeriodInto(container: HTMLElement, model: PeriodViewModel, deps: PeriodViewDeps): HTMLElement {
  const root = container.createDiv({ cls: "modular-diary-period" })

  const bar = root.createDiv({ cls: "modular-diary-period-bar-row" })
  const prev = bar.createEl("button", { cls: "modular-diary-period-nav", attr: { type: "button", "aria-label": t("previousPeriod") } })
  setIcon(prev, "chevron-left")
  prev.addEventListener("click", () => deps.onShift(-1))
  bar.createEl("span", { cls: "modular-diary-period-title", text: t("periodTitle", { start: monthDay(model.period.start), end: monthDay(model.period.end), days: String(model.period.days.length) }) })
  const next = bar.createEl("button", { cls: "modular-diary-period-nav", attr: { type: "button", "aria-label": t("nextPeriod") } })
  setIcon(next, "chevron-right")
  next.addEventListener("click", () => deps.onShift(1))
  if (model.spec.kind !== "this-week") {
    bar.createEl("button", { cls: "modular-diary-period-today", text: t("thisWeek"), attr: { type: "button" } }).addEventListener("click", deps.onToday)
  }
  bar.createEl("span", { cls: "modular-diary-period-spec", text: `days: ${model.spec.spec}` })
  if (!model.indexReady) bar.createEl("span", { cls: "modular-diary-period-loading", text: t("periodLoading") })

  const body = root.createDiv({ cls: "modular-diary-period-body" })
  renderRail(body, model, deps)

  const scroll = body.createDiv({ cls: "modular-diary-period-scroll" })
  const grid = scroll.createDiv({ cls: "modular-diary-period-grid" })
  const count = model.days.length
  grid.style.gridTemplateColumns = `26px repeat(${count}, minmax(${count > 5 ? 108 : 136}px, 1fr))`
  const hours = grid.createDiv({ cls: "modular-diary-period-hours" })
  hours.style.gridRow = "3"
  hours.style.height = `${((model.rangeEndMin - model.rangeStartMin) / 60) * PERIOD_HOUR_HEIGHT}px`
  for (let h = Math.ceil(model.rangeStartMin / 60); h * 60 <= model.rangeEndMin; h += 4) {
    hours.createEl("span", { text: String(h % 24) }).style.top = `${((h * 60 - model.rangeStartMin) / 60) * PERIOD_HOUR_HEIGHT}px`
  }
  model.days.forEach((day, index) => {
    const col = index + 2
    const isToday = day.date === model.today
    const head = grid.createEl("button", { cls: `modular-diary-period-day-head${isToday ? " is-today" : ""}${day.hasNote ? "" : " is-missing"}`, attr: { type: "button", "aria-label": t("openDay", { date: day.date }) } })
    head.style.gridColumn = String(col); head.style.gridRow = "1"
    head.createEl("b", { text: weekday(day.date) })
    head.createEl("span", { text: String(Number(day.date.slice(8))) })
    head.addEventListener("click", () => deps.onOpenDay(day.date))

    const list = grid.createDiv({ cls: "modular-diary-period-allday" })
    list.style.gridColumn = String(col); list.style.gridRow = "2"
    list.dataset.zone = day.date
    list.dataset.zoneKind = "list"
    for (const todo of day.todos) todoChip(list, todo, day.date, model, deps)
    for (const todo of model.pool) if (todo.due === day.date) list.createDiv({ cls: "modular-diary-period-due", text: `⚑ ${todo.title}`, attr: { title: t("dueHere") } })
    if (list.childElementCount === 0 && day.date >= model.today) list.createEl("span", { cls: "modular-diary-period-empty", text: t("allDay") })

    const column = grid.createDiv({ cls: "modular-diary-period-column" })
    column.style.gridColumn = String(col); column.style.gridRow = "3"
    renderAxis(column, day, model, deps)
  })
  return root
}
