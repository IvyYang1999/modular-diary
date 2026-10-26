/**
 * The plan face of a period (week or month): the protocol board in the rail,
 * day cells with morning / afternoon / evening bands, and the month grid; plus
 * the actual face of a month (one stacked bar per day).
 */
import { setIcon } from "obsidian"
import { formatHours } from "../core/duration"
import type { RhythmBoardRow, RhythmSlotView } from "../core/rhythm-ledger"
import type { RhythmZone } from "../core/rhythms"
import type { UpcomingItem } from "../core/upcoming"
import { t } from "../i18n"
import { attachDrag, clock, plainTitle, POOL_ZONE, shortDate, weekday, type PeriodDayView, type PeriodTodoView, type PeriodViewDeps, type PeriodViewModel } from "./period-view"

/** Where a timed item falls: the bands' hour edges (settings may move these later). */
export const ZONE_EDGES = { am: 6 * 60, pm: 12 * 60, ev: 18 * 60 }
const ZONES: RhythmZone[] = ["am", "pm", "ev"]
const MONTH_CELL_VISIBLE = 4

export function zoneOfMinute(minute: number): RhythmZone {
  return minute < ZONE_EDGES.pm ? "am" : minute < ZONE_EDGES.ev ? "pm" : "ev"
}

function zoneLabel(zone: RhythmZone): string {
  return t(zone === "am" ? "zoneAm" : zone === "pm" ? "zonePm" : "zoneEv")
}

interface Pill {
  text: string
  type?: string
  time?: string
  kind: "slot" | "todo" | "upcoming" | "due"
  done?: boolean
  owed?: boolean
  todo?: PeriodTodoView
  /** Drag origin for a placed todo (see attachDrag). */
  from?: string
  title?: string
}

function pillsOf(day: PeriodDayView, model: PeriodViewModel): Record<"all" | RhythmZone, Pill[]> {
  const out: Record<"all" | RhythmZone, Pill[]> = { all: [], am: [], pm: [], ev: [] }
  const byId = new Map(model.todos.map((todo) => [todo.id, todo]))
  for (const todo of day.allDay) {
    // A slot of a fixed-time rhythm sits in that time's band and shows the time, even before it is planned.
    const rhythm = todo.rhythm ? model.board.find((row) => row.rhythm.id === todo.rhythm)?.rhythm : undefined
    const zone = todo.zone ?? (rhythm?.startMin !== undefined ? zoneOfMinute(rhythm.startMin) : undefined)
    const pill: Pill = { text: plainTitle(todo.title), type: todo.type, kind: todo.rhythm ? "slot" : "todo", done: todo.completed, owed: Boolean(todo.owed), todo, from: todo.zone ? `${day.date}@${todo.zone}` : day.date, title: todo.title, time: !todo.zone && rhythm?.startMin !== undefined ? clock(rhythm.startMin) : undefined }
    out[zone ?? "all"].push(pill)
  }
  for (const entry of day.entries) {
    if (!entry.plan || !entry.todoId) continue
    const todo = byId.get(entry.todoId)
    if (!todo) continue
    out[zoneOfMinute(entry.startMin)].push({ text: plainTitle(todo.title), type: todo.type, time: clock(entry.startMin), kind: todo.rhythm ? "slot" : "todo", done: todo.completed, todo, from: `plan:${day.date}`, title: `${clock(entry.startMin)}–${clock(entry.endMin)} ${todo.title}` })
  }
  for (const item of day.upcoming ?? []) {
    const zone = item.startMin !== undefined ? zoneOfMinute(item.startMin) : item.zone
    out[zone ?? "all"].push({ text: item.text || item.type || "", type: item.type, time: item.startMin !== undefined ? clock(item.startMin) : undefined, kind: "upcoming", title: `${t("upcomingTitle")} · ${item.text}` })
  }
  for (const todo of model.todos) {
    if (todo.due === day.date && !todo.completed) out.all.push({ text: `⚑ ${plainTitle(todo.title)}`, kind: "due", title: t("dueOn", { date: shortDate(todo.due) }) })
  }
  return out
}

function renderPill(host: HTMLElement, root: HTMLElement, pill: Pill, model: PeriodViewModel, deps: PeriodViewDeps, menuFor?: (el: HTMLElement, id: string) => void): HTMLElement {
  const el = host.createDiv({ cls: `modular-diary-plan-pill is-${pill.kind}${pill.done ? " is-done" : ""}${pill.owed ? " is-owed" : ""}`, attr: { title: pill.title ?? pill.text } })
  const color = pill.type ? deps.typeColors[pill.type] : undefined
  if (color) el.style.setProperty("--pc", color)
  if (pill.done) setIcon(el.createEl("span", { cls: "modular-diary-plan-pill-check" }), "check")
  el.createEl("span", { cls: "modular-diary-plan-pill-text", text: pill.text })
  if (pill.time) el.createEl("span", { cls: "modular-diary-plan-pill-time", text: pill.time })
  if (pill.todo && pill.from) {
    el.tabIndex = 0
    attachDrag(root, el, { todo: pill.todo, from: pill.from }, model, deps)
    menuFor?.(el, pill.todo.id)
  }
  return el
}

/* ── rail: the protocol board ── */

function slotFrom(slot: RhythmSlotView): string {
  if (!slot.placement) return POOL_ZONE
  if (slot.placement.startMin !== undefined) return `plan:${slot.placement.date}`
  return slot.zone ? `${slot.placement.date}@${slot.zone}` : slot.placement.date
}

function slotWhere(slot: RhythmSlotView, model: PeriodViewModel): string {
  if (!slot.placement) return ""
  const date = slot.placement.date
  const day = model.scope?.kind === "month" ? shortDate(date) : weekday(date)
  if (slot.placement.startMin !== undefined) return `${day} ${clock(slot.placement.startMin)}`
  return slot.zone ? `${day} ${zoneLabel(slot.zone)}` : day
}

export function renderRhythmBoard(rail: HTMLElement, root: HTMLElement, model: PeriodViewModel, deps: PeriodViewDeps): void {
  const scope = model.scope
  if (!scope) return
  const section = rail.createEl("section", { cls: "modular-diary-period-section modular-diary-plan-board" })
  section.dataset.zone = POOL_ZONE
  section.dataset.zoneKind = "list"
  const header = section.createDiv({ cls: "modular-diary-component-header" })
  header.createEl("span", { cls: "modular-diary-component-title", text: t(scope.kind === "week" ? "periodProtocolWeek" : "periodProtocolMonth") })
  const counted = model.board.filter((row) => !row.skipped && (row.slots.length > 0 || row.due > 0 || row.rhythm.quota.kind === "duration"))
  const doneCount = counted.filter((row) => row.slots.length ? row.done === row.due : row.rhythm.quota.kind === "duration" && row.due === 0 ? row.done > 0 : row.done === row.due).length
  if (counted.length) header.createEl("span", { cls: "modular-diary-component-count", text: `${doneCount}/${counted.length}` })
  const actions = header.createDiv({ cls: "modular-diary-component-actions" })
  const edit = actions.createEl("button", { attr: { type: "button", "aria-label": t("openRhythms"), title: t("openRhythms") } })
  setIcon(edit, "pencil")
  edit.addEventListener("click", () => deps.onOpenRhythms?.())
  if (!model.board.length) {
    const empty = section.createEl("button", { cls: "modular-diary-component-empty", attr: { type: "button" } })
    setIcon(empty.createEl("span", { cls: "modular-diary-component-empty-icon" }), "plus")
    empty.createEl("span", { text: t("rhythmsEmptyBoard") })
    empty.addEventListener("click", () => deps.onOpenRhythms?.())
    return
  }
  const groups: Array<{ key: string; rows: HTMLElement[] }> = []
  const group = (key: string): HTMLElement => {
    let found = groups.find((item) => item.key === key)
    if (!found) {
      const label = section.createDiv({ cls: "modular-diary-plan-board-label", text: t(key as Parameters<typeof t>[0]) })
      found = { key, rows: [label] }
      groups.push(found)
    }
    return section
  }
  const rowEl = (key: string, rhythm: RhythmBoardRow["rhythm"], cls: string): HTMLElement => {
    const host = group(key)
    const row = host.createDiv({ cls: `modular-diary-plan-row ${cls}` })
    row.dataset.rhythm = rhythm.id
    const color = rhythm.type ? deps.typeColors[rhythm.type] : undefined
    const dot = row.createEl("span", { cls: "modular-diary-plan-dot" })
    if (color) dot.style.setProperty("--c", color)
    row.createEl("span", { cls: "modular-diary-plan-name", text: rhythm.name })
    row.addEventListener("contextmenu", (event) => { event.preventDefault(); event.stopPropagation(); deps.onRhythmMenu?.(rhythm.id, event.clientX, event.clientY) })
    return row
  }
  const order = ["boardOwed", "boardUnplaced", "boardPlaced", "boardProgress", "boardDone", "boardSkipped"]
  // Slot rhythms: one row per slot, grouped by its state. Measured rhythms: one progress row.
  const rowsByKey = new Map<string, Array<() => void>>()
  const queue = (key: string, build: () => void): void => { rowsByKey.set(key, [...(rowsByKey.get(key) ?? []), build]) }
  for (const row of model.board) {
    const { rhythm } = row
    if (row.skipped) {
      queue("boardSkipped", () => {
        const el = rowEl("boardSkipped", rhythm, "is-skipped")
        el.createEl("span", { cls: "modular-diary-plan-meta", text: t("boardSkippedMeta") })
      })
      continue
    }
    if (row.slots.length) {
      row.slots.forEach((slot, index) => {
        const key = slot.done ? "boardDone" : slot.owed ? "boardOwed" : slot.placement ? "boardPlaced" : "boardUnplaced"
        queue(key, () => {
          const el = rowEl(key, rhythm, slot.done ? "is-done" : slot.owed ? "is-owed" : slot.placement ? "is-placed" : "is-unplaced")
          if (row.slots.length > 1) el.querySelector(".modular-diary-plan-name")!.textContent = `${rhythm.name} ${index + 1}`
          const meta = el.createEl("span", { cls: `modular-diary-plan-meta${slot.placement ? " is-where" : ""}${slot.owed && !slot.placement ? " is-owed" : ""}` })
          meta.textContent = slot.placement ? slotWhere(slot, model) : slot.owed ? t("boardOwedFrom", { period: slot.owed }) : rhythm.span.kind === "allDay" ? t("allDay") : rhythm.span.kind === "days" ? t("spanDays", { days: rhythm.span.min === rhythm.span.max ? String(rhythm.span.min) : `${rhythm.span.min}-${rhythm.span.max}` }) : rhythm.zone ? zoneLabel(rhythm.zone) : ""
          el.classList.add("modular-diary-period-draggable")
          el.tabIndex = 0
          attachDrag(root, el, { todo: slot, from: slotFrom(slot) }, model, deps)
        })
      })
      continue
    }
    queue("boardProgress", () => {
      const el = rowEl("boardProgress", rhythm, row.due > 0 && row.done === row.due ? "is-done" : "is-measured")
      const meta = el.createEl("span", { cls: "modular-diary-plan-meta" })
      const color = rhythm.type ? deps.typeColors[rhythm.type] : undefined
      const bar = el.createDiv({ cls: "modular-diary-plan-bar" })
      const fill = bar.createDiv({ cls: "modular-diary-plan-bar-fill" })
      if (color) fill.style.background = color
      if (rhythm.quota.kind === "duration" && row.due === 0) {
        meta.textContent = `${formatHours(row.minutes)} / ${formatHours(rhythm.quota.minutes)}`
        fill.style.width = `${Math.min(100, (row.minutes / Math.max(1, rhythm.quota.minutes)) * 100)}%`
      } else {
        meta.textContent = t("daysDone", { done: String(row.done), total: String(row.due) })
        fill.style.width = `${row.due ? Math.min(100, (row.done / row.due) * 100) : 0}%`
      }
    })
  }
  for (const key of order) for (const build of rowsByKey.get(key) ?? []) build()
}

/* ── main: plan calendars ── */

function dayHead(host: HTMLElement, day: PeriodDayView, model: PeriodViewModel, deps: PeriodViewDeps, cls = ""): HTMLElement {
  const isToday = day.date === model.today
  const label = day.hasNote ? t("openDayNamed", { date: shortDate(day.date) }) : t("createDayNamed", { date: shortDate(day.date) })
  const head = host.createDiv({ cls: `modular-diary-period-head${isToday ? " is-today" : ""}${day.date < model.today ? " is-past" : ""}${day.hasNote ? "" : " is-missing"} ${cls}`.trim(), attr: { role: "button", tabindex: "0", "aria-label": label, title: label } })
  head.createEl("span", { cls: "modular-diary-period-head-weekday", text: weekday(day.date) })
  head.createEl("span", { cls: "modular-diary-period-head-day", text: String(Number(day.date.slice(8, 10))) })
  head.addEventListener("click", () => deps.onOpenDay(day.date))
  head.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); deps.onOpenDay(day.date) } })
  return head
}

export function renderPlanCalendar(main: HTMLElement, root: HTMLElement, model: PeriodViewModel, deps: PeriodViewDeps, menuFor: (el: HTMLElement, id: string) => void): void {
  if (model.scope?.kind === "month") { renderPlanMonth(main, root, model, deps, menuFor); return }
  const grid = main.createDiv({ cls: "modular-diary-plan-week" })
  grid.style.setProperty("--modular-diary-period-days", String(model.days.length))
  for (const day of model.days) dayHead(grid, day, model, deps)
  for (const day of model.days) {
    const cell = grid.createDiv({ cls: `modular-diary-plan-cell${day.date === model.today ? " is-today" : ""}${day.date < model.today ? " is-past" : ""}` })
    const pills = pillsOf(day, model)
    const strip = cell.createDiv({ cls: "modular-diary-plan-strip" })
    strip.dataset.zone = day.date
    strip.dataset.zoneKind = "list"
    for (const pill of pills.all) renderPill(strip, root, pill, model, deps, menuFor)
    for (const zone of ZONES) {
      const band = cell.createDiv({ cls: `modular-diary-plan-band is-${zone}` })
      band.dataset.zone = `${day.date}@${zone}`
      band.dataset.zoneKind = "list"
      band.createEl("span", { cls: "modular-diary-plan-band-label", text: zoneLabel(zone) })
      for (const pill of pills[zone]) renderPill(band, root, pill, model, deps, menuFor)
    }
  }
}

function renderPlanMonth(main: HTMLElement, root: HTMLElement, model: PeriodViewModel, deps: PeriodViewDeps, menuFor: (el: HTMLElement, id: string) => void): void {
  const grid = main.createDiv({ cls: "modular-diary-plan-month" })
  for (const name of t("weekdayNames").split(" ").slice(1).concat(t("weekdayNames").split(" ")[0])) grid.createDiv({ cls: "modular-diary-plan-month-head", text: name })
  const byDate = new Map(model.days.map((day) => [day.date, day]))
  // Lead-in cells so the first of the month sits under its weekday (Monday first).
  const first = new Date(`${model.period.start}T00:00:00`)
  const lead = (first.getDay() + 6) % 7
  for (let i = 0; i < lead; i++) grid.createDiv({ cls: "modular-diary-plan-month-cell is-outside" })
  for (const day of model.days) {
    const cell = grid.createDiv({ cls: `modular-diary-plan-month-cell${day.date === model.today ? " is-today" : ""}${day.date < model.today ? " is-past" : ""}` })
    cell.dataset.zone = day.date
    cell.dataset.zoneKind = "list"
    const number = cell.createEl("button", { cls: "modular-diary-plan-month-day", text: String(Number(day.date.slice(8, 10))), attr: { type: "button", title: day.hasNote ? t("openDayNamed", { date: shortDate(day.date) }) : t("createDayNamed", { date: shortDate(day.date) }) } })
    number.addEventListener("click", () => deps.onOpenDay(day.date))
    const pills = pillsOf(day, model)
    const flat = [...pills.all, ...pills.am, ...pills.pm, ...pills.ev]
    const shown = flat.length > MONTH_CELL_VISIBLE ? flat.slice(0, MONTH_CELL_VISIBLE - 1) : flat
    for (const pill of shown) {
      const el = renderPill(cell, root, pill, model, deps, menuFor)
      const span = pill.todo?.rhythm ? model.board.find((row) => row.rhythm.id === pill.todo?.rhythm)?.rhythm.span : undefined
      if (span?.kind === "days") el.createEl("span", { cls: "modular-diary-plan-pill-time", text: t("spanDays", { days: span.min === span.max ? String(span.min) : `${span.min}-${span.max}` }) })
    }
    if (shown.length < flat.length) cell.createDiv({ cls: "modular-diary-plan-more", text: `+${flat.length - shown.length}` })
    byDate.delete(day.date)
  }
  const trailing = (7 - ((lead + model.days.length) % 7)) % 7
  for (let i = 0; i < trailing; i++) grid.createDiv({ cls: "modular-diary-plan-month-cell is-outside" })
}

/* ── main: the actual face of a month ── */

export function renderActualMonth(main: HTMLElement, model: PeriodViewModel, deps: PeriodViewDeps): void {
  const grid = main.createDiv({ cls: "modular-diary-plan-month is-actual" })
  for (const name of t("weekdayNames").split(" ").slice(1).concat(t("weekdayNames").split(" ")[0])) grid.createDiv({ cls: "modular-diary-plan-month-head", text: name })
  const first = new Date(`${model.period.start}T00:00:00`)
  const lead = (first.getDay() + 6) % 7
  for (let i = 0; i < lead; i++) grid.createDiv({ cls: "modular-diary-plan-month-cell is-outside" })
  const order = model.totals.map((total) => total.type)
  for (const day of model.days) {
    const cell = grid.createDiv({ cls: `modular-diary-plan-month-cell is-actual${day.date === model.today ? " is-today" : ""}` })
    const number = cell.createEl("button", { cls: "modular-diary-plan-month-day", text: String(Number(day.date.slice(8, 10))), attr: { type: "button" } })
    number.addEventListener("click", () => deps.onOpenDay(day.date))
    const minutes = new Map<string, number>()
    for (const entry of day.entries) if (!entry.plan) minutes.set(entry.type, (minutes.get(entry.type) ?? 0) + entry.endMin - entry.startMin)
    const total = [...minutes.values()].reduce((sum, value) => sum + value, 0)
    if (!total) continue
    const hours = cell.createDiv({ cls: "modular-diary-plan-hours" })
    hours.createEl("b", { text: formatHours(total).replace(/h$/, "") })
    hours.createEl("small", { text: "h" })
    const stack = cell.createDiv({ cls: "modular-diary-plan-stack" })
    for (const type of [...minutes.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b))) {
      const part = stack.createDiv({ attr: { title: `${type} ${formatHours(minutes.get(type) ?? 0)}` } })
      part.style.width = `${((minutes.get(type) ?? 0) / total) * 100}%`
      part.style.background = deps.typeColors[type] ?? "var(--text-faint)"
    }
  }
  const trailing = (7 - ((lead + model.days.length) % 7)) % 7
  for (let i = 0; i < trailing; i++) grid.createDiv({ cls: "modular-diary-plan-month-cell is-outside" })
  if (order.length) {
    const legend = main.createDiv({ cls: "modular-diary-plan-legend" })
    for (const type of order) {
      const item = legend.createEl("span")
      item.style.setProperty("--c", deps.typeColors[type] ?? "var(--text-faint)")
      item.textContent = type
    }
  }
}
