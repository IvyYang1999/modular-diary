import { currentLocale, t } from "../i18n"
import { trackAnchor } from "./popover-anchor"

interface DatePopoverElement extends HTMLDivElement {
  modularDiaryClose?: () => void
}

function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null
}

function formatIsoDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0")
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function sameDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
}

function openDatePopover(
  container: HTMLElement,
  anchor: HTMLButtonElement,
  initial: string,
  onSave: (date: string) => void,
): void {
  const dom = container.ownerDocument
  const domWindow = dom.defaultView
  const selected = parseIsoDate(initial)
  if (!domWindow || !selected) return

  dom.querySelectorAll<DatePopoverElement>(".modular-diary-date-popover").forEach((popover) => {
    if (popover.modularDiaryClose) popover.modularDiaryClose()
    else popover.remove()
  })
  dom.querySelectorAll<HTMLElement>('.modular-diary-timeline-date-control[aria-expanded="true"]').forEach((control) => {
    control.setAttribute("aria-expanded", "false")
  })

  const popover = dom.createElement("div") as DatePopoverElement
  popover.className = "modular-diary-date-popover"
  popover.setAttribute("role", "dialog")
  popover.setAttribute("aria-label", t("editTimelineDate"))
  popover.tabIndex = -1

  const header = dom.createElement("div")
  header.className = "modular-diary-date-picker-header"
  const previous = dom.createElement("button")
  previous.type = "button"
  previous.className = "modular-diary-date-picker-nav"
  previous.textContent = "‹"
  previous.setAttribute("aria-label", t("previousMonth"))
  const title = dom.createElement("div")
  title.className = "modular-diary-date-picker-title"
  title.setAttribute("aria-live", "polite")
  const next = dom.createElement("button")
  next.type = "button"
  next.className = "modular-diary-date-picker-nav"
  next.textContent = "›"
  next.setAttribute("aria-label", t("nextMonth"))
  header.append(previous, title, next)

  const weekdays = dom.createElement("div")
  weekdays.className = "modular-diary-date-picker-weekdays"
  weekdays.setAttribute("aria-hidden", "true")
  const weekdayLabels = currentLocale() === "zh"
    ? ["一", "二", "三", "四", "五", "六", "日"]
    : ["M", "T", "W", "T", "F", "S", "S"]
  for (const label of weekdayLabels) {
    const cell = dom.createElement("span")
    cell.textContent = label
    weekdays.appendChild(cell)
  }

  const grid = dom.createElement("div")
  grid.className = "modular-diary-date-picker-grid"
  grid.setAttribute("role", "grid")
  popover.append(header, weekdays, grid)
  dom.body.appendChild(popover)
  anchor.setAttribute("aria-expanded", "true")

  let visibleMonth = new Date(selected.getFullYear(), selected.getMonth(), 1)
  let done = false
  let stopTracking = (): void => {}
  const closeFromOutside = (event: PointerEvent): void => {
    const target = event.target
    if (target instanceof Node && !popover.contains(target) && !anchor.contains(target)) finish()
  }
  const finish = (): void => {
    if (done) return
    done = true
    stopTracking()
    dom.removeEventListener("pointerdown", closeFromOutside, true)
    popover.remove()
    anchor.setAttribute("aria-expanded", "false")
    if (anchor.isConnected) anchor.focus({ preventScroll: true })
  }
  popover.modularDiaryClose = finish
  const commit = (date: Date): void => {
    const value = formatIsoDate(date)
    finish()
    if (value !== initial) onSave(value)
  }

  const place = (rect: DOMRect): void => {
    const inset = 8
    const gap = 4
    const width = popover.offsetWidth
    const height = popover.offsetHeight
    const left = Math.max(inset, Math.min(rect.left, domWindow.innerWidth - width - inset))
    const below = rect.bottom + gap
    const top = below + height <= domWindow.innerHeight - inset
      ? below
      : Math.max(inset, rect.top - height - gap)
    popover.style.left = `${left}px`
    popover.style.top = `${top}px`
  }

  const monthTitle = (date: Date): string => new Intl.DateTimeFormat(
    currentLocale() === "zh" ? "zh-CN" : "en-US",
    { year: "numeric", month: "long" },
  ).format(date)

  const renderMonth = (focusDate?: Date): void => {
    title.textContent = monthTitle(visibleMonth)
    grid.replaceChildren()
    const first = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1)
    const offsetFromMonday = (first.getDay() + 6) % 7
    const cursor = new Date(first.getFullYear(), first.getMonth(), 1 - offsetFromMonday)
    const today = new Date()
    for (let index = 0; index < 42; index += 1) {
      const date = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + index)
      const iso = formatIsoDate(date)
      const day = dom.createElement("button")
      day.type = "button"
      day.className = "modular-diary-date-picker-day"
      day.textContent = String(date.getDate())
      day.dataset.date = iso
      day.setAttribute("role", "gridcell")
      day.setAttribute("aria-label", iso)
      day.setAttribute("aria-pressed", String(sameDay(date, selected)))
      day.tabIndex = focusDate && sameDay(date, focusDate) ? 0 : -1
      day.classList.toggle("is-outside-month", date.getMonth() !== visibleMonth.getMonth())
      day.classList.toggle("is-selected", sameDay(date, selected))
      day.classList.toggle("is-today", sameDay(date, today))
      day.addEventListener("click", () => commit(date))
      grid.appendChild(day)
    }
    const focusTarget = focusDate
      ? grid.querySelector<HTMLButtonElement>(`[data-date="${formatIsoDate(focusDate)}"]`)
      : grid.querySelector<HTMLButtonElement>(".is-selected")
    if (focusTarget) focusTarget.tabIndex = 0
    place(anchor.getBoundingClientRect())
    focusTarget?.focus({ preventScroll: true })
  }

  const changeMonth = (delta: number): void => {
    visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + delta, 1)
    renderMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1))
  }
  previous.addEventListener("click", () => changeMonth(-1))
  next.addEventListener("click", () => changeMonth(1))

  // This editor floats over the timeline and must never start a draw/resize gesture.
  popover.addEventListener("pointerdown", (event) => event.stopPropagation())
  popover.addEventListener("click", (event) => event.stopPropagation())
  popover.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault()
      finish()
    } else if (event.target instanceof HTMLButtonElement && event.target.dataset.date) {
      const date = parseIsoDate(event.target.dataset.date)
      const delta = event.key === "ArrowLeft" ? -1
        : event.key === "ArrowRight" ? 1
          : event.key === "ArrowUp" ? -7
            : event.key === "ArrowDown" ? 7
              : 0
      if (date && delta !== 0) {
        event.preventDefault()
        const focusDate = new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta)
        visibleMonth = new Date(focusDate.getFullYear(), focusDate.getMonth(), 1)
        renderMonth(focusDate)
      }
    }
    event.stopPropagation()
  })

  renderMonth(selected)
  stopTracking = trackAnchor(popover, anchor, place, finish)
  dom.addEventListener("pointerdown", closeFromOutside, true)
}

/** Compact timeline-header control; Markdown write-back stays owned by the caller. */
export function buildTimelineDateControl(
  container: HTMLElement,
  date: string,
  weekday: string,
  onSave: (date: string) => void,
): HTMLButtonElement {
  const button = container.ownerDocument.createElement("button")
  button.type = "button"
  // Do not reuse the settings-page `.modular-diary-date-control` class: it is a
  // full-width wrapping field group, while this control must remain compact.
  button.className = "modular-diary-date-row modular-diary-timeline-date-control"
  button.textContent = `${date}${weekday ? ` ${weekday}` : ""}`
  button.setAttribute("aria-label", t("editTimelineDateCurrent", { date }))
  button.setAttribute("aria-haspopup", "dialog")
  button.setAttribute("aria-expanded", "false")
  button.addEventListener("pointerdown", (event) => event.stopPropagation())
  button.addEventListener("click", (event) => {
    event.stopPropagation()
    openDatePopover(container, button, date, onSave)
  })
  return button
}
