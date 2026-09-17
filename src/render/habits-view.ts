import { setIcon } from "obsidian"
import type { HabitDefinition, HabitProgress } from "../core/habits"
import { formatHours } from "../core/duration"
import { t } from "../i18n"
import { attachPointerRowSort } from "../edit/row-sort"
import { appendSixDotGrip } from "./grip"

export interface HabitViewItem {
  habit: HabitDefinition
  progress: HabitProgress
}

export interface HabitViewDeps {
  typeColors: Record<string, string>
  onEdit: () => void
  onMenu: (habit: HabitDefinition, x: number, y: number) => void
  onMove: (id: string, targetIndex: number) => void
}

export function renderHabitsInto(slot: HTMLElement, items: HabitViewItem[], deps: HabitViewDeps): void {
  const dom = slot.ownerDocument
  const root = slot.createDiv({ cls: "modular-diary-habits" })
  const header = root.createDiv({ cls: "modular-diary-component-header" })
  header.createEl("span", { cls: "modular-diary-component-title", text: t("todayHabits") })
  header.createEl("span", {
    cls: "modular-diary-component-count",
    text: `${items.filter((item) => item.progress.complete).length}/${items.length}`,
  })
  const actions = header.createDiv({ cls: "modular-diary-component-actions" })
  const edit = actions.createEl("button", { attr: { type: "button", "aria-label": t("editHabits") } })
  setIcon(edit, "pencil")
  edit.addEventListener("click", deps.onEdit)

  if (items.length === 0) {
    const empty = root.createEl("button", { cls: "modular-diary-component-empty", attr: { type: "button" } })
    const icon = empty.createEl("span", { cls: "modular-diary-component-empty-icon" })
    setIcon(icon, "plus")
    empty.createEl("span", { text: t("addFirstHabit") })
    empty.addEventListener("click", deps.onEdit)
    return
  }

  const list = root.createDiv({ cls: "modular-diary-habit-list" })
  items.forEach(({ habit, progress }, index) => {
    const row = list.createDiv({ cls: `modular-diary-habit-row${progress.complete ? " is-complete" : ""}` })
    row.tabIndex = 0
    row.dataset.habitId = habit.id
    row.setAttribute("aria-label", t("habitActions", { name: habit.name }))
    const openMenu = (x: number, y: number): void => deps.onMenu(habit, x, y)
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault()
      event.stopPropagation()
      openMenu(event.clientX, event.clientY)
    })
    row.addEventListener("keydown", (event) => {
      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return
      event.preventDefault()
      const rect = row.getBoundingClientRect()
      openMenu(rect.left + rect.width / 2, rect.bottom)
    })
    const drag = row.createEl("button", { cls: "modular-diary-item-drag modular-diary-habit-drag", attr: { type: "button", "aria-label": t("dragHabit", { name: habit.name }) } })
    appendSixDotGrip(drag)
    attachPointerRowSort({
      list,
      row,
      handle: drag,
      rowSelector: ".modular-diary-habit-row",
      onMove: (targetIndex) => deps.onMove(habit.id, targetIndex),
    })
    const dot = row.createEl("span", { cls: "modular-diary-item-dot", attr: { "aria-hidden": "true" } })
    dot.style.setProperty("--c", deps.typeColors[habit.type] ?? "var(--text-muted)")
    const body = row.createDiv({ cls: "modular-diary-habit-body" })
    if (habit.targetMetric !== "count" && habit.type) {
      body.classList.add("modular-diary-schedule-source")
      body.dataset.scheduleSource = "habit"
      body.dataset.scheduleId = habit.id
      body.dataset.scheduleTitle = habit.name
      body.dataset.scheduleType = habit.type
      body.dataset.scheduleDuration = String(habit.targetMinutes)
    }
    body.createEl("span", { cls: "modular-diary-item-title", text: habit.name })
    if (habit.targetMetric === "count" || habit.targetMinutes > 0) {
      const meta = body.createEl("span", { cls: "modular-diary-item-meta" })
      meta.textContent = habit.targetMetric === "count"
        ? t("weeklyCountProgress", { current: progress.count ?? 0, target: progress.targetCount ?? habit.targetCount ?? 1 })
        : habit.targetPeriod === "week"
          ? t("weeklyProgress", { current: formatHours(progress.minutes), target: formatHours(habit.targetMinutes) })
          : t("durationProgress", { current: formatHours(progress.minutes), target: formatHours(habit.targetMinutes) })
      const track = body.createDiv({ cls: "modular-diary-item-progress" })
      const bar = track.createDiv({ cls: "modular-diary-item-progress-bar" })
      bar.style.width = `${progress.ratio * 100}%`
      bar.style.background = deps.typeColors[habit.type] ?? "var(--interactive-accent)"
    }
    const status = row.createEl("span", {
      cls: "modular-diary-item-status",
      attr: { role: "status", "aria-label": progress.complete ? t("complete") : t("incomplete") },
    })
    if (progress.complete) setIcon(status, "check")
    status.createEl("span", {
      text: habit.targetPeriod === "week"
        ? (progress.complete ? t("weeklyComplete") : t("weeklyInProgress"))
        : (progress.complete ? t("checkedToday") : t("notChecked")),
    })
  })
}
