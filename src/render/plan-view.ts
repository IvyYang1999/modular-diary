/**
 * The plan face of a period (week or month): the protocol board in the rail,
 * day cells with morning / afternoon / evening bands, and the month grid; plus
 * the actual face of a month (one stacked bar per day).
 */
import { setIcon } from "obsidian"
import { formatHours } from "../core/duration"
import type { RhythmBoardRow, RhythmSlotView } from "../core/rhythm-ledger"
import { rhythmToHabit, zoneRangeLabel, type RhythmZone } from "../core/rhythms"
import { isHabitDue } from "../core/habits"
import type { UpcomingItem } from "../core/upcoming"
import { t } from "../i18n"
import { attachDrag, clock, formatSpan, formatTotal, goalEditor, plainTitle, POOL_ZONE, shortDate, weekday, type PeriodDayView, type PeriodTodoView, type PeriodViewDeps, type PeriodViewModel } from "./period-view"
import { sessionId } from "../core/rhythm-ledger"

/** Where a timed item falls: the bands' hour edges; settings set the afternoon and evening starts. */
export const ZONE_EDGES = { am: 6 * 60, pm: 12 * 60, ev: 18 * 60 }
export function setZoneEdges(pmHour: number, evHour: number): void {
  ZONE_EDGES.pm = Math.max(1, Math.min(23, Math.round(pmHour))) * 60
  ZONE_EDGES.ev = Math.max(ZONE_EDGES.pm / 60 + 1, Math.min(23, Math.round(evHour))) * 60
}
const ZONES: RhythmZone[] = ["am", "pm", "ev"]
const MONTH_CELL_VISIBLE = 4

export function zoneOfMinute(minute: number): RhythmZone {
  return minute < ZONE_EDGES.pm ? "am" : minute < ZONE_EDGES.ev ? "pm" : "ev"
}

function weekdayShortOf(date: string): string {
  const day = new Date(`${date}T00:00:00`).getDay()
  return [...t("weekdayShort")][(day + 6) % 7] ?? ""
}

function zoneLabel(zone: RhythmZone): string {
  return t(zone === "am" ? "zoneAm" : zone === "pm" ? "zonePm" : "zoneEv")
}

interface Pill {
  text: string
  type?: string
  time?: string
  kind: "slot" | "todo" | "upcoming" | "due" | "foreign"
  /** Lives in another period's note (shown with ↗); draggable when its scope is known. */
  foreign?: boolean
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
  // The other period kind's items on this day: the month's rhythms in a week, a week's in the month.
  for (const todo of day.foreign ?? []) {
    const draggable = Boolean(todo.foreignScope)
    out[todo.zone ?? "all"].push({ text: plainTitle(todo.title), type: todo.type, kind: draggable ? (todo.rhythm ? "slot" : "todo") : "foreign", foreign: true, done: todo.completed, owed: Boolean(todo.owed), title: `${todo.foreign ?? ""} · ${todo.title}`, ...(draggable ? { todo, from: todo.zone ? `${day.date}@${todo.zone}` : day.date } : {}) })
  }
  const foreignById = new Map((model.foreignTodos ?? []).map((todo) => [todo.id, todo]))
  for (const entry of day.entries) {
    if (!entry.plan || !entry.todoId || byId.has(entry.todoId)) continue
    const todo = foreignById.get(entry.todoId)
    if (!todo) continue
    out[zoneOfMinute(entry.startMin)].push({ text: plainTitle(todo.title), type: todo.type, time: clock(entry.startMin), kind: "foreign", done: todo.completed, title: `${todo.foreign ?? ""} · ${clock(entry.startMin)}–${clock(entry.endMin)} ${todo.title}` })
  }
  for (const todo of model.todos) {
    if (todo.due === day.date && !todo.completed) out.all.push({ text: `⚑ ${plainTitle(todo.title)}`, kind: "due", title: t("dueOn", { date: shortDate(todo.due) }) })
  }
  return out
}

/** A hover card with the whole title and its small print; narrow cells cut pills short. */
function attachPillPreview(el: HTMLElement, lines: string[]): void {
  let pop: HTMLElement | null = null
  let timer = 0
  const dom = el.ownerDocument
  const hide = (): void => { if (timer) { dom.defaultView?.clearTimeout(timer); timer = 0 } pop?.remove(); pop = null; dom.removeEventListener("pointerdown", hide, true) }
  const show = (): void => {
    hide()
    // The pill may have been redrawn away while the timer ran: nothing to point at.
    if (!el.isConnected) return
    const rect = el.getBoundingClientRect()
    if (!rect.width) return
    pop = dom.body.createDiv({ cls: "modular-diary-plan-pop" })
    dom.addEventListener("pointerdown", hide, true)
    lines.forEach((line, index) => pop!.createDiv({ cls: index === 0 ? "modular-diary-plan-pop-title" : "modular-diary-plan-pop-line", text: line }))
    const width = Math.min(280, (dom.defaultView?.innerWidth ?? 800) - 16)
    pop.style.left = `${Math.max(8, Math.min(rect.left, (dom.defaultView?.innerWidth ?? 800) - width - 8))}px`
    pop.style.top = `${rect.bottom + 6}px`
    pop.style.maxWidth = `${width}px`
  }
  el.addEventListener("mouseenter", () => { hide(); timer = dom.defaultView?.setTimeout(show, 260) ?? 0 })
  el.addEventListener("mouseleave", hide)
  el.addEventListener("pointerdown", hide)
}

/** Cards from a previous draw have no pill to follow any more. */
export function clearPillPreviews(dom: Document): void {
  dom.querySelectorAll(".modular-diary-plan-pop").forEach((node) => node.remove())
}

function renderPill(host: HTMLElement, root: HTMLElement, pill: Pill, model: PeriodViewModel, deps: PeriodViewDeps, menuFor?: (el: HTMLElement, id: string) => void): HTMLElement {
  const el = host.createDiv({ cls: `modular-diary-plan-pill is-${pill.kind}${pill.foreign ? " is-foreign" : ""}${pill.done ? " is-done" : ""}${pill.owed ? " is-owed" : ""}` })
  const small = [pill.time, pill.todo?.type, pill.todo?.note].filter((line): line is string => Boolean(line))
  attachPillPreview(el, [pill.title && pill.title !== pill.text ? pill.title : pill.text, ...small.filter((line) => !(pill.title ?? "").includes(line))])
  const color = pill.type ? deps.typeColors[pill.type] : undefined
  if (color) el.style.setProperty("--pc", color)
  if (pill.done) setIcon(el.createEl("span", { cls: "modular-diary-plan-pill-check" }), "check")
  el.createEl("span", { cls: "modular-diary-plan-pill-text", text: pill.text })
  if (pill.time) el.createEl("span", { cls: "modular-diary-plan-pill-time", text: pill.time })
  if (pill.todo && pill.from) {
    el.tabIndex = 0
    attachDrag(root, el, { todo: pill.todo, from: pill.from }, model, deps)
    if (pill.todo.rhythm && deps.onSlotMenu) {
      const slot = pill.todo
      el.addEventListener("contextmenu", (event) => { event.preventDefault(); event.stopPropagation(); deps.onSlotMenu?.(slot, event.clientX, event.clientY) })
    } else menuFor?.(el, pill.todo.id)
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

/** Todos bound under a goal or a rhythm: a tick, the title, where it sits; draggable like any period todo. */
export function renderBoundTodos(host: HTMLElement, todos: PeriodTodoView[], model: PeriodViewModel, deps: PeriodViewDeps, root: HTMLElement): HTMLElement {
  const list = host.createDiv({ cls: "modular-diary-plan-subs" })
  for (const todo of todos) {
    const row = list.createDiv({ cls: `modular-diary-plan-sub${todo.completed ? " is-done" : ""}`, attr: { tabindex: "0" } })
    row.dataset.todoId = todo.id
    const check = row.createEl("button", { cls: "modular-diary-plan-sub-check", attr: { type: "button", "aria-pressed": String(todo.completed), "aria-label": t(todo.completed ? "markIncomplete" : "markComplete") } })
    if (todo.completed) setIcon(check, "check")
    check.addEventListener("click", (event) => { event.stopPropagation(); void deps.onToggle(todo.id, !todo.completed) })
    row.createEl("span", { cls: "modular-diary-plan-sub-title", text: plainTitle(todo.title) })
    const meta: string[] = []
    if (todo.placement) meta.push(todo.placement.startMin !== undefined ? `${weekday(todo.placement.date)} ${clock(todo.placement.startMin)}` : `${model.scope?.kind === "month" ? shortDate(todo.placement.date) : weekday(todo.placement.date)}${todo.zone ? " " + zoneLabel(todo.zone) : ""}`)
    if (todo.estimateMin > 0) meta.push(formatSpan(todo.estimateMin))
    if (meta.length) row.createEl("span", { cls: `modular-diary-plan-sub-meta${todo.placement ? " is-where" : ""}`, text: meta.join(" · ") })
    row.classList.add("modular-diary-period-draggable")
    attachDrag(root, row, { todo, todoRow: false, from: todo.placement && todo.placement.startMin === undefined ? (todo.zone ? `${todo.placement.date}@${todo.zone}` : todo.placement.date) : POOL_ZONE }, model, deps)
    row.addEventListener("contextmenu", (event) => { event.preventDefault(); event.stopPropagation(); deps.onTodoMenu?.(todo.id, event.clientX, event.clientY, () => undefined, null) })
  }
  return list
}

/** Sessions of an accumulation row: the plan blocks bound to it across the period's days. */
function sessionsOf(id: string, model: PeriodViewModel): Array<{ date: string; startMin: number; endMin: number; line: number }> {
  const out: Array<{ date: string; startMin: number; endMin: number; line: number }> = []
  for (const day of model.days) for (const entry of day.entries) if (entry.plan && entry.todoId === id) out.push({ date: day.date, startMin: entry.startMin, endMin: entry.endMin, line: entry.line })
  return out
}

function renderSessions(host: HTMLElement, id: string, model: PeriodViewModel, deps: PeriodViewDeps): void {
  const sessions = sessionsOf(id, model)
  if (!sessions.length) return
  const list = host.createDiv({ cls: "modular-diary-plan-sessions" })
  for (const session of sessions) {
    const chip = list.createEl("span", { cls: "modular-diary-plan-session", attr: { title: `${session.date} ${clock(session.startMin)}–${clock(session.endMin)}` } })
    chip.createEl("span", { text: `${model.scope?.kind === "month" ? shortDate(session.date) : weekday(session.date)} ${clock(session.startMin)} · ${formatSpan(session.endMin - session.startMin)}` })
    if (deps.onRemoveSession) {
      const remove = chip.createEl("button", { cls: "modular-diary-plan-session-remove", attr: { type: "button", "aria-label": t("removeSession") } })
      setIcon(remove, "x")
      remove.addEventListener("click", (event) => { event.stopPropagation(); deps.onRemoveSession?.(session.date, session.line) })
    }
  }
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
  const hourGoalsAll = model.goals.filter((item) => item.goal.kind !== "text")
  const total = counted.length + hourGoalsAll.length
  if (total) header.createEl("span", { cls: "modular-diary-component-count", text: `${doneCount + hourGoalsAll.filter((goal) => goal.complete).length}/${total}` })
  const actions = header.createDiv({ cls: "modular-diary-component-actions" })
  const addGoal = actions.createEl("button", { attr: { type: "button", "aria-label": t("addGoalProtocol"), title: t("addGoalProtocol") } })
  setIcon(addGoal, "plus")
  const edit = actions.createEl("button", { attr: { type: "button", "aria-label": t("openRhythms"), title: t("openRhythms") } })
  setIcon(edit, "pencil")
  edit.addEventListener("click", () => deps.onOpenRhythms?.())
  // One inline editor at a time; it sits where the goal it edits was.
  let open: HTMLFormElement | null = null
  const closeEditor = (): void => { open?.remove(); open = null; section.querySelectorAll<HTMLElement>(".modular-diary-plan-row.is-goal").forEach((row) => { row.hidden = false }) }
  const goalsHost = (): HTMLElement => section.querySelector<HTMLElement>(".modular-diary-plan-goals") ?? section.createDiv({ cls: "modular-diary-plan-goals" })
  addGoal.addEventListener("click", () => {
    closeEditor()
    const host = goalsHost()
    if (!host.querySelector(".modular-diary-plan-board-label")) host.createDiv({ cls: "modular-diary-plan-board-label", text: t("boardGoals") })
    open = goalEditor(host, null, null, deps, closeEditor)
  })
  if (!model.board.length && !hourGoalsAll.length) {
    const empty = section.createEl("button", { cls: "modular-diary-component-empty", attr: { type: "button" } })
    setIcon(empty.createEl("span", { cls: "modular-diary-component-empty-icon" }), "plus")
    empty.createEl("span", { text: t("rhythmsEmptyBoard") })
    empty.addEventListener("click", () => deps.onOpenRhythms?.())
    return
  }
  const labels = new Set<string>()
  const group = (key: string): HTMLElement => {
    if (!labels.has(key)) {
      labels.add(key)
      section.createDiv({ cls: "modular-diary-plan-board-label", text: t(key as Parameters<typeof t>[0]) })
    }
    return section
  }
  const rowEl = (key: string, rhythm: RhythmBoardRow["rhythm"], cls: string, rhythmMenu = true): HTMLElement => {
    const host = group(key)
    const row = host.createDiv({ cls: `modular-diary-plan-row ${cls}` })
    row.dataset.rhythm = rhythm.id
    const color = rhythm.type ? deps.typeColors[rhythm.type] : undefined
    const dot = row.createEl("span", { cls: "modular-diary-plan-dot" })
    if (color) dot.style.setProperty("--c", color)
    row.createEl("span", { cls: "modular-diary-plan-name", text: rhythm.name })
    // A slot row has its own menu (skip this one, let an owed one go); the rhythm menu is for rows without slots.
    if (rhythmMenu) row.addEventListener("contextmenu", (event) => { event.preventDefault(); event.stopPropagation(); deps.onRhythmMenu?.(rhythm.id, event.clientX, event.clientY) })
    return row
  }
  /** A row without a slot still moves within the board, so the note's order can be set by hand. */
  const reorderOnly = (row: HTMLElement, rhythm: RhythmBoardRow["rhythm"]): void => {
    if (!deps.onReorderRhythm) return
    row.classList.add("modular-diary-period-draggable")
    row.tabIndex = 0
    const stub = { id: `rhythm:${rhythm.id}`, title: rhythm.name, group: "", type: rhythm.type ?? "", estimateMin: 0, completed: false, tags: [], actualMinutes: 0 } as unknown as PeriodTodoView
    attachDrag(root, row, { todo: stub, from: POOL_ZONE, rhythmId: rhythm.id, reorderOnly: true }, model, deps)
  }
  const order = ["boardOwed", "boardUnplaced", "boardPlaced", "boardProgress", "boardDaily", "boardDone", "boardSkipped"]
  // Todos bound under a rhythm hang off its first row on the board.
  const boundDone = new Set<string>()
  const attachBound = (el: HTMLElement, rhythmId: string): void => {
    if (boundDone.has(rhythmId)) return
    boundDone.add(rhythmId)
    const bound = model.todos.filter((todo) => todo.under === rhythmId && !todo.moved)
    if (bound.length) el.insertAdjacentElement("afterend", renderBoundTodos(section, bound, model, deps, root))
  }
  // Slot rhythms: one row per slot, grouped by its state. Measured rhythms: one progress row.
  const rowsByKey = new Map<string, Array<() => void>>()
  const queue = (key: string, build: () => void): void => { rowsByKey.set(key, [...(rowsByKey.get(key) ?? []), build]) }
  for (const row of model.board) {
    const { rhythm } = row
    if (row.skipped) {
      queue("boardSkipped", () => {
        const el = rowEl("boardSkipped", rhythm, "is-skipped")
        el.createEl("span", { cls: "modular-diary-plan-meta", text: t("boardSkippedMeta") })
        reorderOnly(el, rhythm)
      })
      continue
    }
    if (row.slots.length) {
      row.slots.forEach((slot, index) => {
        const key = slot.done ? "boardDone" : slot.owed ? "boardOwed" : slot.placement ? "boardPlaced" : "boardUnplaced"
        queue(key, () => {
          const el = rowEl(key, rhythm, slot.done ? "is-done" : slot.owed ? "is-owed" : slot.placement ? "is-placed" : "is-unplaced", !deps.onSlotMenu)
          if (row.slots.length > 1) el.querySelector(".modular-diary-plan-name")!.textContent = `${rhythm.name} ${index + 1}`
          const meta = el.createEl("span", { cls: `modular-diary-plan-meta${slot.placement ? " is-where" : ""}${slot.owed && !slot.placement ? " is-owed" : ""}` })
          meta.textContent = slot.placement ? slotWhere(slot, model) : slot.owed ? t("boardOwedFrom", { period: slot.owed }) : rhythm.span.kind === "allDay" ? t("allDay") : rhythm.span.kind === "days" ? t("spanDays", { days: rhythm.span.min === rhythm.span.max ? String(rhythm.span.min) : `${rhythm.span.min}-${rhythm.span.max}` }) : rhythm.zone ? zoneRangeLabel(rhythm, zoneLabel) : ""
          if (rhythm.quota.kind === "duration") {
            // A session to place, measured by the period's hours: the bar says how much of the quota is in.
            el.classList.add("is-measured")
            const where = meta.textContent
            meta.textContent = `${where ? where + " · " : ""}${formatHours(row.minutes)} / ${formatHours(rhythm.quota.minutes)}`
            const fill = el.createDiv({ cls: "modular-diary-plan-bar" }).createDiv({ cls: "modular-diary-plan-bar-fill" })
            fill.style.width = `${Math.min(100, (row.minutes / Math.max(1, rhythm.quota.minutes)) * 100)}%`
            const color = rhythm.type ? deps.typeColors[rhythm.type] : undefined
            if (color) fill.style.background = color
          }
          el.classList.add("modular-diary-period-draggable")
          el.tabIndex = 0
          attachDrag(root, el, { todo: slot, from: slotFrom(slot), rhythmId: rhythm.id }, model, deps)
          if (deps.onSlotMenu) el.addEventListener("contextmenu", (event) => { event.preventDefault(); event.stopPropagation(); deps.onSlotMenu?.(slot, event.clientX, event.clientY) })
          attachBound(el, rhythm.id)
        })
      })
      continue
    }
    // Daily rhythms are ticks per day, not things to place: their own label.
    const progressKey = rhythm.cadence === "daily" || rhythm.cadence === "weekdays" ? "boardDaily" : "boardProgress"
    queue(progressKey, () => {
      const el = rowEl(progressKey, rhythm, row.due > 0 && row.done === row.due ? "is-done" : "is-measured")
      const meta = el.createEl("span", { cls: "modular-diary-plan-meta" })
      const color = rhythm.type ? deps.typeColors[rhythm.type] : undefined
      const bar = el.createDiv({ cls: "modular-diary-plan-bar" })
      const fill = bar.createDiv({ cls: "modular-diary-plan-bar-fill" })
      if (color) fill.style.background = color
      if (rhythm.quota.kind === "duration" && row.due === 0) {
        // Accumulation: hours recorded against the quota; drag it as often as needed, each drop is a session.
        const target = row.targetMinutes ?? rhythm.quota.minutes
        // Planned ahead: the sessions on the calendar plus the open todos hanging under this row.
        const bound = model.todos.filter((todo) => todo.under === rhythm.id && !todo.moved && !todo.completed)
        const planned = sessionsOf(sessionId(rhythm), model).reduce((sum, session) => sum + session.endMin - session.startMin, 0) + bound.reduce((sum, todo) => sum + todo.estimateMin, 0)
        meta.textContent = `${formatHours(row.minutes)} / ${formatHours(target)}${planned ? ` · ${t("plannedSum", { hours: formatHours(planned) })}` : ""}`
        fill.style.width = `${Math.min(100, (row.minutes / Math.max(1, target)) * 100)}%`
        el.title = t("accumulationHint")
        if (deps.onSession) {
          const remaining = Math.max(30, Math.min(60, target - row.minutes))
          const stub = { id: sessionId(rhythm), title: rhythm.name, group: "", type: rhythm.type ?? "", estimateMin: remaining, completed: false, tags: [], actualMinutes: 0 } as unknown as PeriodTodoView
          el.classList.add("modular-diary-period-draggable", "is-session-source")
          el.tabIndex = 0
          attachDrag(root, el, { todo: stub, from: POOL_ZONE, session: true }, model, deps)
        }
        renderSessions(el, sessionId(rhythm), model, deps)
        attachBound(el, rhythm.id)
      } else if (progressKey === "boardDaily") {
        // Daily rhythms: one cell per day, lit when the day earned its tick (a stamp card, not a bar).
        meta.textContent = t("daysDone", { done: String(row.done), total: String(row.due) })
        bar.remove()
        const habit = rhythmToHabit(rhythm, 0)
        const days = model.days.filter((day) => !habit || isHabitDue(habit, day.date))
        const cells = el.createDiv({ cls: `modular-diary-plan-days${days.length > 7 ? " is-month" : ""}` })
        if (days.length > 7) for (let i = 0; i < (new Date(`${days[0].date}T00:00:00`).getDay() + 6) % 7; i++) cells.createDiv({ cls: "modular-diary-plan-day is-blank" })
        for (const day of days) {
          const limit = rhythm.quota.kind === "duration" && rhythm.quota.limit === true
          const recorded = day.entries.filter((entry) => !entry.plan && entry.type === rhythm.type).reduce((sum, entry) => sum + entry.endMin - entry.startMin, 0)
          const manual = day.habitDone?.includes(rhythm.id)
          const target = rhythm.quota.kind === "duration" ? rhythm.quota.minutes : 0
          const judged = manual || day.entries.length > 0
          const hit = manual || (limit ? judged && recorded < target : target > 0 ? recorded >= target : recorded > 0)
          // A kept limit shows a tick, a broken one a cross, so a lit red cell never reads as "wasted again".
          const state = hit ? "is-done" : limit && judged && recorded >= target ? "is-missed" : ""
          const cell = cells.createDiv({ cls: `modular-diary-plan-day ${state}${day.date === model.today ? " is-today" : ""}${day.date > model.today ? " is-future" : ""}`.trim(), attr: { title: `${day.date} · ${hit ? t("checkedToday") : state === "is-missed" ? t("limitMissed", { hours: formatHours(recorded) }) : t("notChecked")}` } })
          if (color) cell.style.setProperty("--c", color)
          cell.createEl("span", { cls: "modular-diary-plan-day-label", text: days.length > 7 ? String(Number(day.date.slice(8, 10))) : weekdayShortOf(day.date) })
          if (limit && (hit || state === "is-missed")) setIcon(cell.createEl("span", { cls: "modular-diary-plan-day-mark" }), hit ? "check" : "x")
        }
      } else {
        meta.textContent = t(row.unit === "times" ? "timesDone" : "daysDone", { done: String(row.done), total: String(row.due) })
        fill.style.width = `${row.due ? Math.min(100, (row.done / row.due) * 100) : 0}%`
        // How a day earns its tick, so the bar is not a riddle.
        const rule = rhythm.quota.kind === "duration"
          ? (row.limit ? t("boardRuleLimit", { type: rhythm.type ?? "", hours: formatHours(rhythm.quota.minutes) }) : t("boardRuleAtLeast", { type: rhythm.type ?? "", hours: formatHours(rhythm.quota.minutes) }))
          : rhythm.type ? t("boardRuleAny", { type: rhythm.type }) : t("boardRuleManual")
        el.title = rule
        meta.title = rule
      }
      reorderOnly(el, rhythm)
    })
  }
  for (const key of order) for (const build of rowsByKey.get(key) ?? []) build()
  // Hour targets for this period only (`goal:` lines): the same row, a bar of hours done.
  const hourGoals = model.goals.filter((item) => item.goal.kind !== "text")
  if (hourGoals.length) {
    const host = goalsHost()
    host.createDiv({ cls: "modular-diary-plan-board-label", text: t("boardGoals") })
    for (const item of hourGoals) {
      const row = host.createDiv({ cls: `modular-diary-plan-row is-goal is-measured${item.complete ? " is-done" : ""}`, attr: { role: "button", tabindex: "0", "aria-label": t("editGoalNamed", { name: item.goal.key }) } })
      row.dataset.goalLine = String(item.goal.line)
      const color = item.goal.kind === "type" ? deps.typeColors[item.goal.key] : deps.tagStyle?.(item.goal.key)?.color
      const dot = row.createEl("span", { cls: "modular-diary-plan-dot" })
      if (color) dot.style.setProperty("--c", color)
      row.createEl("span", { cls: "modular-diary-plan-name", text: item.goal.kind === "type" ? item.goal.key : `#${item.goal.key}` })
      row.createEl("span", { cls: "modular-diary-plan-meta", text: `${formatTotal(item.doneMinutes)} / ${formatTotal(item.goal.targetMinutes)}` })
      const bar = row.createDiv({ cls: "modular-diary-plan-bar" })
      const fill = bar.createDiv({ cls: "modular-diary-plan-bar-fill" })
      fill.style.width = `${Math.round(Math.min(1, item.ratio) * 100)}%`
      if (color) fill.style.background = color
      row.title = item.complete ? t("goalComplete") : t("goalRemaining", { hours: formatHours(item.goal.targetMinutes - item.doneMinutes) })
      if (item.goal.kind === "type" && deps.onSession) {
        const remaining = Math.max(30, Math.min(60, item.goal.targetMinutes - item.doneMinutes))
        const stub = { id: `g-${item.goal.key}`, title: item.goal.key, group: "", type: item.goal.key, estimateMin: remaining, completed: false, tags: [], actualMinutes: 0 } as unknown as PeriodTodoView
        row.classList.add("modular-diary-period-draggable", "is-session-source")
        attachDrag(root, row, { todo: stub, from: POOL_ZONE, session: true }, model, deps)
      }
      const editGoal = (): void => {
        closeEditor()
        row.hidden = true
        open = goalEditor(host, { kind: item.goal.kind, key: item.goal.key, targetMinutes: item.goal.targetMinutes }, item.goal.line, deps, closeEditor)
        host.insertBefore(open, row)
      }
      row.addEventListener("click", editGoal)
      row.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); editGoal() } })
    }
  }
}

/* ── main: plan calendars ── */

export function dayHead(host: HTMLElement, day: PeriodDayView, model: PeriodViewModel, deps: PeriodViewDeps, cls = ""): HTMLElement {
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
    const strip = cell.createDiv({ cls: "modular-diary-plan-strip", attr: { "data-label": t("allDay") } })
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
    // Month cells show what happens on the day (rhythm slots, schedule items); plain todos only on request.
    const flat = [...pills.all, ...pills.am, ...pills.pm, ...pills.ev].filter((pill) => model.showTodos || pill.kind !== "todo" || !pill.todo || Boolean(pill.todo.rhythm))
    const shown = flat.length > MONTH_CELL_VISIBLE ? flat.slice(0, MONTH_CELL_VISIBLE - 1) : flat
    const column = (lead + model.days.indexOf(day)) % 7
    for (const pill of shown) {
      const el = renderPill(cell, root, pill, model, deps, menuFor)
      const span = pill.todo?.rhythm ? model.board.find((row) => row.rhythm.id === pill.todo?.rhythm)?.rhythm.span : undefined
      if (span?.kind === "days") {
        el.createEl("span", { cls: "modular-diary-plan-pill-time", text: t("spanDays", { days: span.min === span.max ? String(span.min) : `${span.min}-${span.max}` }) })
        // A multi-day item runs as one bar across the following cells, to the end of its row.
        const cells = Math.max(1, Math.min(span.max, 7 - column, model.days.length - model.days.indexOf(day)))
        if (cells > 1) {
          el.classList.add("is-span")
          el.style.width = `calc(${cells * 100}% + ${(cells - 1) * 4}px)`
        }
      }
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
    // The day as a thin vertical timeline (same hour range as the week): where the colours fall, top to bottom.
    const body = cell.createDiv({ cls: "modular-diary-plan-daycol" })
    const bar = body.createDiv({ cls: "modular-diary-plan-daybar", attr: { title: `${clock(model.rangeStartMin)}–${clock(model.rangeEndMin)}` } })
    const span = Math.max(1, model.rangeEndMin - model.rangeStartMin)
    for (const entry of [...day.entries].filter((item) => !item.plan).sort((a, b) => a.startMin - b.startMin)) {
      const start = Math.max(entry.startMin, model.rangeStartMin), end = Math.min(entry.endMin, model.rangeEndMin)
      if (end <= start) continue
      const part = bar.createDiv({ attr: { title: `${clock(entry.startMin)}–${clock(entry.endMin)} ${entry.type}${entry.note ? " · " + entry.note : ""}` } })
      part.style.top = `${((start - model.rangeStartMin) / span) * 100}%`
      part.style.height = `${((end - start) / span) * 100}%`
      part.style.background = deps.typeColors[entry.type] ?? "var(--text-faint)"
    }
    // Just the strip: the day's shape. The hours per category are one hover away.
    bar.title = `${formatTotal(total)}\n${[...minutes.entries()].sort((a, b) => b[1] - a[1]).map(([type, value]) => `${type} ${formatHours(value)}`).join("\n")}`
    void order
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
