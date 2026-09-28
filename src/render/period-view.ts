/**
 * Period block (`days:`): a run of days side by side, with the period's own
 * goals and unscheduled todos in a rail. Read-mostly DOM; every change goes
 * back through deps so the markdown stays the truth. Chips move between the
 * pool, a day's all-day list and a day's axis with a pointer drag.
 */
import { setIcon } from "obsidian"
import { formatHours } from "../core/duration"
import type { GoalProgress, ResolvedPeriod } from "../core/period"
import type { Entry, PeriodSpec, SpanNote, TodoItem } from "../core/types"
import { t } from "../i18n"
import { renderTitleWithTags } from "./todos-view"

export interface PeriodDayView {
  date: string
  entries: Entry[]
  spans: SpanNote[]
  todos: TodoItem[]
  hasNote: boolean
}

export interface PeriodViewModel {
  spec: PeriodSpec
  period: ResolvedPeriod
  today: string
  goals: GoalProgress[]
  totals: Array<{ type: string; minutes: number }>
  /** The block's own todos: not yet placed on a day. */
  pool: TodoItem[]
  days: PeriodDayView[]
  rangeStartMin: number
  rangeEndMin: number
  /** False while other days are still being read; the view says so. */
  indexReady: boolean
}

export interface PeriodViewDeps {
  typeColors: Record<string, string>
  tagStyle?: (tag: string) => { background: string; color: string } | null
  onShift: (direction: 1 | -1) => void
  onToday: () => void
  onOpenDay: (date: string) => void
  /** `from`/`to` are "pool" or a YYYY-MM-DD. */
  onMoveTodo: (id: string, from: string, to: string) => void
  onPlanTodo: (id: string, from: string, date: string, startMin: number) => void
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

interface DragItem { id: string; from: string }

function attachChipDrag(root: HTMLElement, chip: HTMLElement, item: DragItem, model: PeriodViewModel, deps: PeriodViewDeps): void {
  chip.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return
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
        if (!indicator) { indicator = zone.createDiv({ cls: "modular-diary-period-drop-line" }) }
        const top = ((lastMinutes - model.rangeStartMin) / 60) * PERIOD_HOUR_HEIGHT
        indicator.style.top = `${top}px`
        indicator.dataset.time = clock(lastMinutes)
      }
    }
    const finish = (commit: boolean): void => {
      chip.removeEventListener("pointermove", onMove)
      chip.removeEventListener("pointerup", onUp)
      chip.removeEventListener("pointercancel", onCancel)
      dom.removeEventListener("keydown", onKey, true)
      const target = zone
      const minutes = lastMinutes
      const dragged = ghost !== null
      clearZone()
      ghost?.remove(); ghost = null
      chip.classList.remove("is-dragging"); root.classList.remove("is-dragging")
      if (!commit || !dragged || !target) return
      const to = target.dataset.zone ?? ""
      if (target.dataset.zoneKind === "axis") deps.onPlanTodo(item.id, item.from, to, minutes)
      else if (to !== item.from) deps.onMoveTodo(item.id, item.from, to)
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
  chip.title = bits.join(" · ")
  renderTitleWithTags(chip.createEl("span", { cls: "modular-diary-period-chip-title" }), todo.title, deps.tagStyle)
  if (todo.due && from === POOL_ZONE) chip.createEl("span", { cls: "modular-diary-period-chip-due", text: `⚑ ${weekday(todo.due)}` })
  attachChipDrag(parent.closest<HTMLElement>(".modular-diary-period") ?? parent, chip, { id: todo.id, from }, model, deps)
  return chip
}

function badge(parent: HTMLElement, text: string, color: string | undefined): HTMLElement {
  const el = parent.createEl("span", { cls: "modular-diary-tag", text })
  if (color) {
    el.classList.add("has-category")
    el.style.setProperty("--modular-diary-tag-bg", `color-mix(in srgb, ${color} 22%, var(--background-primary))`)
    el.style.setProperty("--modular-diary-tag-fg", `color-mix(in srgb, ${color} 70%, var(--text-normal))`)
  }
  return el
}

function renderRail(root: HTMLElement, model: PeriodViewModel, deps: PeriodViewDeps): void {
  const rail = root.createEl("aside", { cls: "modular-diary-period-rail" })
  rail.createEl("h4", { cls: "modular-diary-period-heading", text: t("periodGoals") })
  if (model.goals.length === 0) rail.createEl("p", { cls: "modular-diary-period-hint", text: t("periodGoalsHint") })
  for (const item of model.goals) {
    const goal = rail.createDiv({ cls: `modular-diary-period-goal${item.complete ? " is-complete" : ""}` })
    const head = goal.createDiv({ cls: "modular-diary-period-goal-head" })
    const color = item.goal.kind === "type" ? deps.typeColors[item.goal.key] : (deps.tagStyle?.(item.goal.key) ? undefined : undefined)
    if (item.goal.kind === "type") badge(head, item.goal.key, color)
    else {
      const style = deps.tagStyle?.(item.goal.key) ?? null
      const el = head.createEl("span", { cls: "modular-diary-tag", text: `#${item.goal.key}` })
      if (style) { el.classList.add("has-category"); el.style.setProperty("--modular-diary-tag-bg", style.background); el.style.setProperty("--modular-diary-tag-fg", style.color) }
    }
    head.createEl("b", { text: `${formatHours(item.doneMinutes)} / ${formatHours(item.goal.targetMinutes)}` })
    const track = goal.createDiv({ cls: "modular-diary-period-goal-track" })
    const bar = track.createDiv({ cls: "modular-diary-period-goal-bar" })
    bar.style.width = `${Math.round(item.ratio * 100)}%`
    if (color) bar.style.background = color
    goal.createDiv({ cls: "modular-diary-period-goal-status", text: item.complete ? t("goalComplete") : t("goalRemaining", { hours: formatHours(item.goal.targetMinutes - item.doneMinutes) }) })
  }

  rail.createEl("h4", { cls: "modular-diary-period-heading", text: t("periodPool") })
  const pool = rail.createDiv({ cls: "modular-diary-period-pool" })
  pool.dataset.zone = POOL_ZONE
  pool.dataset.zoneKind = "list"
  for (const todo of model.pool) todoChip(pool, todo, POOL_ZONE, model, deps)
  if (model.pool.length === 0) pool.createEl("span", { cls: "modular-diary-period-empty", text: t("periodPoolEmpty") })
  rail.createEl("p", { cls: "modular-diary-period-hint", text: t("periodPoolHint") })

  rail.createEl("h4", { cls: "modular-diary-period-heading", text: t("periodTotals") })
  const totals = rail.createDiv({ cls: "modular-diary-period-totals" })
  for (const total of model.totals) {
    const row = totals.createEl("span", { cls: "modular-diary-period-total" })
    const dot = row.createEl("i", { attr: { "aria-hidden": "true" } })
    dot.style.background = deps.typeColors[total.type] ?? "var(--text-muted)"
    row.appendText(`${total.type} ${formatHours(total.minutes)}`)
  }
  if (model.totals.length === 0) totals.createEl("span", { cls: "modular-diary-period-empty", text: t("periodNoRecords") })
}

function renderAxis(column: HTMLElement, day: PeriodDayView, model: PeriodViewModel, deps: PeriodViewDeps): void {
  const axis = column.createDiv({ cls: `modular-diary-period-axis${day.date === model.today ? " is-today" : ""}` })
  axis.dataset.zone = day.date
  axis.dataset.zoneKind = "axis"
  const span = model.rangeEndMin - model.rangeStartMin
  const height = (span / 60) * PERIOD_HOUR_HEIGHT
  axis.style.height = `${height}px`
  const y = (minutes: number): number => ((minutes - model.rangeStartMin) / 60) * PERIOD_HOUR_HEIGHT
  for (let h = Math.ceil(model.rangeStartMin / 60); h * 60 <= model.rangeEndMin; h += 1) {
    const line = axis.createDiv({ cls: "modular-diary-period-hour" })
    line.style.top = `${y(h * 60)}px`
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
    if (minutes >= model.rangeStartMin && minutes <= model.rangeEndMin) {
      const line = axis.createDiv({ cls: "modular-diary-period-now" })
      line.style.top = `${y(minutes)}px`
    }
  }
}

export function renderPeriodInto(container: HTMLElement, model: PeriodViewModel, deps: PeriodViewDeps): HTMLElement {
  const root = container.createDiv({ cls: "modular-diary-period" })

  const bar = root.createDiv({ cls: "modular-diary-period-bar" })
  const prev = bar.createEl("button", { cls: "modular-diary-period-nav", attr: { type: "button", "aria-label": t("previousPeriod") } })
  setIcon(prev, "chevron-left")
  prev.addEventListener("click", () => deps.onShift(-1))
  bar.createEl("span", { cls: "modular-diary-period-title", text: t("periodTitle", { start: monthDay(model.period.start), end: monthDay(model.period.end), days: String(model.period.days.length) }) })
  const next = bar.createEl("button", { cls: "modular-diary-period-nav", attr: { type: "button", "aria-label": t("nextPeriod") } })
  setIcon(next, "chevron-right")
  next.addEventListener("click", () => deps.onShift(1))
  if (model.spec.kind !== "this-week") {
    const today = bar.createEl("button", { cls: "modular-diary-period-today", text: t("thisWeek"), attr: { type: "button" } })
    today.addEventListener("click", deps.onToday)
  }
  bar.createEl("span", { cls: "modular-diary-period-spec", text: `days: ${model.spec.spec}` })
  if (!model.indexReady) bar.createEl("span", { cls: "modular-diary-period-loading", text: t("periodLoading") })

  const body = root.createDiv({ cls: "modular-diary-period-body" })
  renderRail(body, model, deps)

  const scroll = body.createDiv({ cls: "modular-diary-period-scroll" })
  const grid = scroll.createDiv({ cls: "modular-diary-period-grid" })
  const count = model.days.length
  grid.style.gridTemplateColumns = `26px repeat(${count}, minmax(${count > 5 ? 84 : 120}px, 1fr))`
  const hours = grid.createDiv({ cls: "modular-diary-period-hours" })
  hours.style.gridRow = "3"
  hours.style.height = `${((model.rangeEndMin - model.rangeStartMin) / 60) * PERIOD_HOUR_HEIGHT}px`
  for (let h = Math.ceil(model.rangeStartMin / 60); h * 60 <= model.rangeEndMin; h += 4) {
    const label = hours.createEl("span", { text: String(h % 24) })
    label.style.top = `${((h * 60 - model.rangeStartMin) / 60) * PERIOD_HOUR_HEIGHT}px`
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
