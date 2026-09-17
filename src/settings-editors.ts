import { setIcon } from "obsidian"
import type { HabitDefinition, HabitSchedule } from "./core/habits"
import { durationInputMinutes, durationInputValue, preferredDurationUnit, type DurationInputUnit } from "./core/duration"
import { t } from "./i18n"

export interface FocusedSettingsData {
  spanTypeColors: Record<string, string>
  markerTypeColors: Record<string, string>
  spanRetiredTypeColors: Record<string, string>
  markerRetiredTypeColors: Record<string, string>
  habits: HabitDefinition[]
}

export interface FocusedSettingsHost {
  settings: FocusedSettingsData
  saveSettings: (options?: { rerender?: boolean }) => Promise<void>
}

const newId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

function iconButton(parent: HTMLElement, icon: string, label: string, action: () => void): HTMLButtonElement {
  const button = parent.ownerDocument.createElement("button")
  button.type = "button"
  button.className = "modular-diary-settings-icon-button"
  button.setAttribute("aria-label", label)
  setIcon(button, icon)
  button.addEventListener("click", action)
  parent.appendChild(button)
  return button
}

function actionButton(parent: HTMLElement, label: string, action: () => void): HTMLButtonElement {
  const button = parent.ownerDocument.createElement("button")
  button.type = "button"
  button.className = "modular-diary-settings-add-button"
  const icon = parent.ownerDocument.createElement("span")
  icon.className = "modular-diary-settings-add-icon"
  setIcon(icon, "plus")
  button.append(icon, parent.ownerDocument.createTextNode(label))
  button.addEventListener("click", action)
  parent.appendChild(button)
  return button
}

function field(parent: HTMLElement, labelText: string, name: string, full = false): { root: HTMLLabelElement; control: HTMLElement } {
  const root = parent.ownerDocument.createElement("label")
  root.className = `modular-diary-rule-field${full ? " is-full" : ""}`
  root.dataset.field = name
  const label = parent.ownerDocument.createElement("span")
  label.className = "modular-diary-rule-field-label"
  label.textContent = labelText
  const control = parent.ownerDocument.createElement("span")
  control.className = "modular-diary-rule-field-control"
  root.append(label, control)
  parent.appendChild(root)
  return { root, control }
}

function selectOption(select: HTMLSelectElement, value: string, label: string): void {
  const option = select.ownerDocument.createElement("option")
  option.value = value
  option.textContent = label
  select.appendChild(option)
}

function scheduleFromValue(value: string): HabitSchedule {
  if (value === "weekly") return { kind: "weekly", weekdays: [new Date().getDay()] }
  if (value === "interval") return { kind: "interval", everyDays: 2, anchorDate: localIsoDate() }
  if (value === "dates") return { kind: "dates", dates: [localIsoDate()] }
  if (value === "weekdays") return { kind: "weekdays" }
  return { kind: "daily" }
}

function localIsoDate(date = new Date()): string {
  const part = (value: number): string => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}`
}

type HabitGoal = "any" | "daily-duration" | "daily-below" | "weekly-duration" | "weekly-count"

function habitGoalValue(habit: HabitDefinition): HabitGoal {
  if (habit.targetMetric === "count") return "weekly-count"
  if (habit.targetPeriod === "week") return "weekly-duration"
  if (habit.durationComparison === "below" && habit.targetMinutes > 0) return "daily-below"
  return habit.targetMinutes > 0 ? "daily-duration" : "any"
}

function applyHabitGoal(habit: HabitDefinition, goal: HabitGoal): void {
  if (goal === "weekly-count") {
    habit.targetMetric = "count"
    habit.targetPeriod = "week"
    habit.targetMinutes = 0
    habit.targetCount = Math.max(1, Math.round(Number(habit.targetCount) || 3))
    habit.durationComparison = undefined
    habit.schedule = { kind: "daily" }
    habit.repeatWeekly ??= true
    return
  }
  habit.targetMetric = "duration"
  habit.targetCount = undefined
  if (goal === "weekly-duration") {
    habit.targetPeriod = "week"
    habit.targetMinutes = habit.targetMinutes > 0 ? habit.targetMinutes : 120
    habit.durationComparison = "at-least"
    habit.schedule = { kind: "daily" }
    habit.repeatWeekly ??= true
    return
  }
  habit.targetPeriod = "day"
  habit.durationComparison = goal === "daily-below" ? "below" : "at-least"
  habit.targetMinutes = goal === "daily-duration" || goal === "daily-below"
    ? (habit.targetMinutes > 0 ? habit.targetMinutes : 30)
    : 0
}

function nextAvailableDate(values: string[]): string {
  const used = new Set(values)
  const candidate = new Date()
  for (let index = 0; index < 366; index += 1) {
    const value = localIsoDate(candidate)
    if (!used.has(value)) return value
    candidate.setDate(candidate.getDate() + 1)
  }
  return ""
}

export function renderCategorySettings(container: HTMLElement, host: FocusedSettingsHost, scope: "span" | "marker" = "span"): void {
  container.replaceChildren()
  container.classList.add("modular-diary-category-settings")
  container.dataset.categoryScope = scope
  const colors = scope === "marker" ? host.settings.markerTypeColors : host.settings.spanTypeColors
  const retired = scope === "marker" ? host.settings.markerRetiredTypeColors : host.settings.spanRetiredTypeColors

  const list = container.ownerDocument.createElement("div")
  list.className = "modular-diary-category-editor-list"
  container.appendChild(list)

  const render = (): void => renderCategorySettings(container, host, scope)
  for (const [type, color] of Object.entries(colors)) {
    const row = container.ownerDocument.createElement("div")
    row.className = "modular-diary-category-editor-row"

    const colorInput = container.ownerDocument.createElement("input")
    colorInput.type = "color"
    colorInput.value = color
    colorInput.className = "modular-diary-category-color-input"
    colorInput.setAttribute("aria-label", `${t("categoryColor")}: ${type}`)
    colorInput.addEventListener("input", () => {
      colors[type] = colorInput.value
      void host.saveSettings({ rerender: true })
    })

    const nameInput = container.ownerDocument.createElement("input")
    nameInput.type = "text"
    nameInput.value = type
    nameInput.placeholder = t("categoryName")
    nameInput.setAttribute("aria-label", t("categoryName"))
    const commitName = async (): Promise<void> => {
      const name = nameInput.value.trim()
      if (name === type) return
      if (!/^\S+$/.test(name) || name in colors) {
        nameInput.value = type
        return
      }
      const renamed = Object.fromEntries(Object.entries(colors).map(([key, value]) => key === type ? [name, value] : [key, value]))
      if (scope === "marker") host.settings.markerTypeColors = renamed
      else host.settings.spanTypeColors = renamed
      retired[type] ??= color
      await host.saveSettings({ rerender: true })
      render()
    }
    nameInput.addEventListener("blur", () => void commitName())
    nameInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return
      event.preventDefault()
      nameInput.blur()
    })

    const actions = container.ownerDocument.createElement("div")
    actions.className = "modular-diary-settings-row-actions"
    iconButton(actions, "trash-2", t("delete"), () => {
      retired[type] ??= colors[type]
      delete colors[type]
      void host.saveSettings({ rerender: true }).then(render)
    })

    row.append(colorInput, nameInput, actions)
    list.appendChild(row)
  }

  actionButton(container, t("addCategory"), () => {
    let index = 1
    while (`type${index}` in colors) index += 1
    colors[`type${index}`] = "#bdbdbd"
    void host.saveSettings({ rerender: true }).then(render)
  })
}

export function renderHabitSettings(container: HTMLElement, host: FocusedSettingsHost): void {
  container.replaceChildren()
  container.classList.add("modular-diary-habit-settings")
  const categories = Object.keys(host.settings.spanTypeColors)
  const list = container.ownerDocument.createElement("div")
  list.className = "modular-diary-rule-editor-list"
  container.appendChild(list)

  const render = (): void => renderHabitSettings(container, host)
  const save = (): Promise<void> => host.saveSettings({ rerender: true })

  for (const habit of [...host.settings.habits].sort((a, b) => a.order - b.order)) {
    const row = container.ownerDocument.createElement("section")
    row.className = "modular-diary-rule-editor"
    row.dataset.habitId = habit.id

    const nameField = field(row, t("habitName"), "name")
    const nameInput = container.ownerDocument.createElement("input")
    nameInput.type = "text"
    nameInput.value = habit.name
    nameInput.placeholder = t("habitName")
    nameInput.addEventListener("change", () => {
      habit.name = nameInput.value.trim() || habit.type || t("addHabit")
      nameInput.value = habit.name
      void save()
    })
    nameField.control.appendChild(nameInput)

    const categoryField = field(row, t("trackedCategory"), "category")
    const categoryPicker = container.ownerDocument.createElement("span")
    categoryPicker.className = "modular-diary-category-picker"
    const categoryDot = container.ownerDocument.createElement("span")
    categoryDot.className = "modular-diary-category-picker-dot"
    categoryDot.setAttribute("aria-hidden", "true")
    const categorySelect = container.ownerDocument.createElement("select")
    if (habit.type && !categories.includes(habit.type)) selectOption(categorySelect, habit.type, habit.type)
    if (categories.length === 0 && !habit.type) selectOption(categorySelect, "", t("noCategory"))
    categories.forEach((category) => selectOption(categorySelect, category, category))
    categorySelect.value = habit.type
    const updateCategoryColor = (): void => {
      categoryDot.style.setProperty("--modular-diary-category-color", host.settings.spanTypeColors[categorySelect.value] ?? "var(--text-faint)")
    }
    updateCategoryColor()
    categorySelect.addEventListener("change", () => {
      habit.type = categorySelect.value
      updateCategoryColor()
      void save()
    })
    categoryPicker.append(categoryDot, categorySelect)
    categoryField.control.appendChild(categoryPicker)

    const goalField = field(row, t("completionCondition"), "goal")
    const goalSelect = container.ownerDocument.createElement("select")
    selectOption(goalSelect, "any", t("anyRecordGoal"))
    selectOption(goalSelect, "daily-duration", t("dailyDurationGoal"))
    selectOption(goalSelect, "daily-below", t("dailyBelowDurationGoal"))
    selectOption(goalSelect, "weekly-duration", t("weeklyDurationGoal"))
    selectOption(goalSelect, "weekly-count", t("weeklyCountGoal"))
    goalSelect.value = habitGoalValue(habit)
    goalSelect.addEventListener("change", () => {
      applyHabitGoal(habit, goalSelect.value as HabitGoal)
      void save().then(render)
    })
    goalField.control.appendChild(goalSelect)

    if (habit.targetMetric === "count") {
      const countField = field(row, t("targetCount"), "target")
      const countControl = container.ownerDocument.createElement("span")
      countControl.className = "modular-diary-count-control"
      const countInput = container.ownerDocument.createElement("input")
      countInput.type = "number"
      countInput.min = "1"
      countInput.step = "1"
      countInput.inputMode = "numeric"
      countInput.value = String(Math.max(1, Math.round(Number(habit.targetCount) || 1)))
      const countUnit = container.ownerDocument.createElement("span")
      countUnit.className = "modular-diary-count-unit"
      countUnit.textContent = t("timesUnit")
      countInput.addEventListener("change", () => {
        habit.targetCount = Math.max(1, Math.round(Number(countInput.value) || 1))
        countInput.value = String(habit.targetCount)
        void save()
      })
      countControl.append(countInput, countUnit)
      countField.control.appendChild(countControl)
    } else if (habit.targetMinutes > 0) {
      const durationField = field(row, t("targetDuration"), "target")
      const durationControl = container.ownerDocument.createElement("span")
      durationControl.className = "modular-diary-duration-control"
      const durationInput = container.ownerDocument.createElement("input")
      durationInput.type = "number"
      durationInput.min = "0"
      durationInput.inputMode = "decimal"
      const unitSelect = container.ownerDocument.createElement("select")
      selectOption(unitSelect, "minutes", t("minutesUnit"))
      selectOption(unitSelect, "hours", t("hoursUnit"))
      let durationUnit = preferredDurationUnit(habit.targetMinutes)
      const syncDurationControl = (): void => {
        durationInput.step = durationUnit === "hours" ? "0.25" : "5"
        durationInput.value = durationInputValue(habit.targetMinutes, durationUnit)
        unitSelect.value = durationUnit
      }
      syncDurationControl()
      durationInput.addEventListener("change", () => {
        habit.targetMinutes = durationInputMinutes(durationInput.value, durationUnit)
        syncDurationControl()
        void save()
      })
      unitSelect.addEventListener("change", () => {
        durationUnit = unitSelect.value as DurationInputUnit
        syncDurationControl()
      })
      durationControl.append(durationInput, unitSelect)
      durationField.control.appendChild(durationControl)
    }

    if (habit.targetPeriod === "week") {
      const repeatField = field(row, t("repeatRule"), "repeat")
      const repeatSelect = container.ownerDocument.createElement("select")
      selectOption(repeatSelect, "repeat", t("repeatEveryWeek"))
      selectOption(repeatSelect, "once", t("onlyThisWeek"))
      repeatSelect.value = habit.repeatWeekly === false ? "once" : "repeat"
      repeatSelect.addEventListener("change", () => {
        habit.repeatWeekly = repeatSelect.value !== "once"
        if (!habit.repeatWeekly) habit.weekAnchor = localIsoDate()
        void save()
      })
      repeatField.control.appendChild(repeatSelect)
    } else {
      const repeatField = field(row, t("repeatRule"), "repeat")
      const repeatSelect = container.ownerDocument.createElement("select")
      selectOption(repeatSelect, "daily", t("everyDay"))
      selectOption(repeatSelect, "weekdays", t("workdays"))
      selectOption(repeatSelect, "weekly", t("weeklySelectedDays"))
      selectOption(repeatSelect, "interval", t("everyNDays"))
      selectOption(repeatSelect, "dates", t("specificCalendarDates"))
      repeatSelect.value = habit.schedule.kind
      repeatSelect.addEventListener("change", () => {
        habit.schedule = scheduleFromValue(repeatSelect.value)
        void save().then(render)
      })
      repeatField.control.appendChild(repeatSelect)

      if (habit.schedule.kind === "weekly") {
        const daysField = field(row, t("weeklyDays"), "weekdays", true)
        const days = container.ownerDocument.createElement("span")
        days.className = "modular-diary-weekday-control"
        ;[1, 2, 3, 4, 5, 6, 0].forEach((day, index) => {
          const button = container.ownerDocument.createElement("button")
          button.type = "button"
          button.textContent = t("weekdayShort").split("")[index]
          button.setAttribute("aria-pressed", String(habit.schedule.kind === "weekly" && habit.schedule.weekdays.includes(day)))
          button.addEventListener("click", () => {
            if (habit.schedule.kind !== "weekly") return
            const selected = habit.schedule.weekdays.includes(day)
            if (selected && habit.schedule.weekdays.length === 1) return
            const displayOrder = [1, 2, 3, 4, 5, 6, 0]
            habit.schedule.weekdays = (selected
              ? habit.schedule.weekdays.filter((value) => value !== day)
              : [...habit.schedule.weekdays, day]
            ).sort((a, b) => displayOrder.indexOf(a) - displayOrder.indexOf(b))
            void save().then(render)
          })
          days.appendChild(button)
        })
        daysField.control.appendChild(days)
      } else if (habit.schedule.kind === "interval") {
        const intervalField = field(row, t("everyNDays"), "interval", true)
        const intervalControl = container.ownerDocument.createElement("span")
        intervalControl.className = "modular-diary-interval-control"
        const everyGroup = container.ownerDocument.createElement("label")
        const everyLabel = container.ownerDocument.createElement("span")
        everyLabel.textContent = t("intervalEvery")
        const everyInput = container.ownerDocument.createElement("input")
        everyInput.type = "number"
        everyInput.min = "1"
        everyInput.step = "1"
        everyInput.inputMode = "numeric"
        everyInput.value = String(habit.schedule.everyDays)
        everyInput.addEventListener("change", () => {
          if (habit.schedule.kind !== "interval") return
          habit.schedule.everyDays = Math.max(1, Math.round(Number(everyInput.value) || 1))
          everyInput.value = String(habit.schedule.everyDays)
          void save()
        })
        everyGroup.append(everyLabel, everyInput)
        const anchorGroup = container.ownerDocument.createElement("label")
        const anchorLabel = container.ownerDocument.createElement("span")
        anchorLabel.textContent = t("intervalFrom")
        const anchorInput = container.ownerDocument.createElement("input")
        anchorInput.type = "date"
        anchorInput.value = habit.schedule.anchorDate
        anchorInput.addEventListener("change", () => {
          if (habit.schedule.kind !== "interval" || !anchorInput.value) return
          habit.schedule.anchorDate = anchorInput.value
          void save()
        })
        anchorGroup.append(anchorLabel, anchorInput)
        intervalControl.append(everyGroup, anchorGroup)
        intervalField.control.appendChild(intervalControl)
      } else if (habit.schedule.kind === "dates") {
        const datesField = field(row, t("specificCalendarDates"), "dates", true)
        const datesControl = container.ownerDocument.createElement("span")
        datesControl.className = "modular-diary-date-control"
        for (const date of habit.schedule.dates) {
          const dateItem = container.ownerDocument.createElement("span")
          dateItem.className = "modular-diary-date-item"
          const dateInput = container.ownerDocument.createElement("input")
          dateInput.type = "date"
          dateInput.value = date
          dateInput.addEventListener("change", () => {
            if (habit.schedule.kind !== "dates" || !dateInput.value) return
            habit.schedule.dates = [...new Set(habit.schedule.dates.map((value) => value === date ? dateInput.value : value))].sort()
            void save().then(render)
          })
          dateItem.appendChild(dateInput)
          const remove = iconButton(dateItem, "x", t("removeDate", { date }), () => {
            if (habit.schedule.kind !== "dates") return
            habit.schedule.dates = habit.schedule.dates.filter((value) => value !== date)
            void save().then(render)
          })
          remove.classList.add("modular-diary-date-remove")
          datesControl.appendChild(dateItem)
        }
        const addDate = container.ownerDocument.createElement("button")
        addDate.type = "button"
        addDate.className = "modular-diary-date-add"
        const addIcon = container.ownerDocument.createElement("span")
        setIcon(addIcon, "plus")
        addDate.append(addIcon, container.ownerDocument.createTextNode(t("addDate")))
        addDate.addEventListener("click", () => {
          if (habit.schedule.kind !== "dates") return
          const value = nextAvailableDate(habit.schedule.dates)
          if (value) habit.schedule.dates = [...habit.schedule.dates, value].sort()
          void save().then(render)
        })
        datesControl.appendChild(addDate)
        datesField.control.appendChild(datesControl)
      }
    }

    const actions = container.ownerDocument.createElement("div")
    actions.className = "modular-diary-settings-row-actions"
    iconButton(actions, "trash-2", t("delete"), () => {
      host.settings.habits = host.settings.habits.filter((item) => item.id !== habit.id)
      void save().then(render)
    })
    row.appendChild(actions)
    list.appendChild(row)
  }

  actionButton(container, t("addHabit"), () => {
    host.settings.habits.push({
      id: newId("habit"), name: categories[0] ?? t("addHabit"), type: categories[0] ?? "", targetMinutes: 0,
      targetPeriod: "day", targetMetric: "duration", schedule: { kind: "daily" }, order: host.settings.habits.length,
    })
    void save().then(render)
  })
}
