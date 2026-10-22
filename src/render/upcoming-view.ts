import { setIcon } from "obsidian"
import type { UpcomingItem } from "../core/upcoming"
import { shiftDate } from "../core/daily-notes"
import { t } from "../i18n"

export interface UpcomingViewDeps {
  today: string
  typeColors: Record<string, string>
  onAdd: () => void
  /** Open the schedule note (to edit or remove items). */
  onOpenNote: () => void
}

function clock(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
}

function dayLabel(date: string, today: string): string {
  if (date === today) return t("today")
  if (date === shiftDate(today, 1)) return t("tomorrow")
  const weekday = [...t("weekdayShort")][(new Date(`${date}T00:00:00`).getDay() + 6) % 7] ?? ""
  return `${Number(date.slice(5, 7))}.${Number(date.slice(8, 10))} ${t("weekdayPrefix")}${weekday}`
}

/** The schedule from today on, grouped by day: time (or all-day), category dot, text. */
export function renderUpcomingInto(slot: HTMLElement, items: UpcomingItem[], deps: UpcomingViewDeps): void {
  const root = slot.createDiv({ cls: "modular-diary-upcoming" })
  const header = root.createDiv({ cls: "modular-diary-component-header" })
  header.createEl("span", { cls: "modular-diary-component-title", text: t("upcomingTitle") })
  if (items.length) header.createEl("span", { cls: "modular-diary-component-count", text: String(items.length) })
  const actions = header.createDiv({ cls: "modular-diary-component-actions" })
  const open = actions.createEl("button", { attr: { type: "button", "aria-label": t("upcomingOpenNote"), title: t("upcomingOpenNote") } })
  setIcon(open, "file-text")
  open.addEventListener("click", deps.onOpenNote)
  const add = actions.createEl("button", { attr: { type: "button", "aria-label": t("addUpcoming"), title: t("addUpcoming") } })
  setIcon(add, "plus")
  add.addEventListener("click", deps.onAdd)
  if (!items.length) {
    const empty = root.createEl("button", { cls: "modular-diary-component-empty", attr: { type: "button" } })
    setIcon(empty.createEl("span", { cls: "modular-diary-component-empty-icon" }), "plus")
    empty.createEl("span", { text: t("addUpcoming") })
    empty.addEventListener("click", deps.onAdd)
    return
  }
  const list = root.createDiv({ cls: "modular-diary-upcoming-list" })
  let lastDate = ""
  for (const item of items) {
    if (item.date !== lastDate) {
      lastDate = item.date
      list.createDiv({ cls: "modular-diary-upcoming-day", text: dayLabel(item.date, deps.today) })
    }
    const row = list.createDiv({ cls: "modular-diary-upcoming-row" })
    const dot = row.createEl("span", { cls: "modular-diary-item-dot", attr: { "aria-hidden": "true" } })
    dot.style.setProperty("--c", item.type ? deps.typeColors[item.type] ?? "var(--text-muted)" : "var(--background-modifier-border)")
    row.createEl("span", { cls: "modular-diary-upcoming-time", text: item.startMin !== undefined && item.endMin !== undefined ? `${clock(item.startMin)}–${clock(item.endMin)}` : t("allDay") })
    row.createEl("span", { cls: "modular-diary-upcoming-text", text: [item.type, item.text].filter(Boolean).join(" · ") })
  }
}
