import { setIcon } from "obsidian"
import { durationInputMinutes, durationInputValue, formatHours, preferredDurationUnit, type DurationInputUnit } from "../core/duration"
import type { TodoViewConfig } from "../core/types"
import { t } from "../i18n"
import { attachPointerRowSort } from "../edit/row-sort"
import { appendSixDotGrip } from "./grip"

export interface TodoViewItem {
  id: string
  title: string
  group: string
  type?: string
  completed: boolean
  weekly: boolean
  estimateMinutes: number
  actualMinutes: number
}

export interface NewTodoInput {
  title: string
  type?: string
  estimateMinutes: number
  estimateUnit?: DurationInputUnit
  /** Preserve the authored number while a draft is remounted. */
  estimateValue?: string
}
export interface TodoEditDraft { id: string; input: NewTodoInput }

export interface TodoViewDeps {
  categories: string[]
  typeColors: Record<string, string>
  view: TodoViewConfig
  onAdd: (input: NewTodoInput) => void
  onEdit: (id: string, input: NewTodoInput) => void
  onGroupMenu: (x: number, y: number) => void
  onSortMenu: (x: number, y: number) => void
  onToggle: (id: string, completed: boolean) => void | Promise<void>
  onMenu: (item: TodoViewItem, x: number, y: number, edit: () => void) => void
  onMove: (id: string, targetIndex: number) => void
  draft?: NewTodoInput | null
  onDraftChange?: (draft: NewTodoInput | null) => void
  editDraft?: TodoEditDraft | null
  onEditDraftChange?: (draft: TodoEditDraft | null) => void
}

interface TodoFormController {
  form: HTMLFormElement
  open: (value: NewTodoInput, options?: { focus?: boolean }) => void
  close: () => void
}

function createTodoForm(
  parent: HTMLElement,
  categories: string[],
  className: string,
  onSubmit: (input: NewTodoInput) => void,
  onClose?: () => void,
  onDraftChange?: (draft: NewTodoInput | null) => void,
): TodoFormController {
  const form = parent.createEl("form", { cls: `oneday-todo-form ${className}` })
  // Chromium validates before `submit`, which would replace our interaction
  // with a native step-mismatch bubble. Keep the semantic form, but validate
  // against Oneday's real Markdown contract in the handler below.
  form.noValidate = true
  form.hidden = true
  const title = form.createEl("input", { cls: "oneday-todo-title-input", attr: { type: "text", placeholder: t("todoTitle") } })
  const category = form.createEl("select", { cls: "oneday-todo-category-select", attr: { "aria-label": t("category") } })
  const fillCategories = (selected?: string): void => {
    category.replaceChildren()
    category.createEl("option", { text: t("noCategory"), attr: { value: "" } })
    if (selected && !categories.includes(selected)) category.createEl("option", { text: selected, attr: { value: selected } })
    categories.forEach((value) => category.createEl("option", { text: value, attr: { value } }))
    category.value = selected ?? ""
  }
  const estimateField = form.createDiv({ cls: "oneday-todo-estimate-field" })
  const estimate = estimateField.createEl("input", { cls: "oneday-todo-estimate-input", attr: { type: "number", step: "any", inputmode: "decimal", "aria-label": t("estimatedDuration") } })
  const estimateUnit = estimateField.createEl("select", { cls: "oneday-todo-estimate-unit-select", attr: { "aria-label": t("durationUnit") } })
  estimateUnit.createEl("option", { text: t("minutesUnit"), attr: { value: "minutes" } })
  estimateUnit.createEl("option", { text: t("hoursUnit"), attr: { value: "hours" } })
  let currentUnit: DurationInputUnit = "minutes"
  const readEstimateMinutes = (): number => durationInputMinutes(estimate.value, currentUnit)
  const syncEstimateControl = (minutes: number): void => {
    // Persistence normalizes decimals to integer minutes (0.02h -> 1min), so
    // a quarter-hour UI step would be stricter than the actual data contract.
    estimate.step = "any"
    estimate.value = durationInputValue(minutes, currentUnit)
    estimateUnit.value = currentUnit
  }
  const save = form.createEl("button", { cls: "oneday-todo-save", attr: { type: "submit", "aria-label": t("save") } })
  setIcon(save, "check")
  const error = form.createDiv({ cls: "oneday-todo-form-error", attr: { role: "status", "aria-live": "polite" } })
  error.hidden = true
  const clearError = (): void => {
    error.hidden = true
    error.textContent = ""
    title.removeAttribute("aria-invalid")
    estimate.removeAttribute("aria-invalid")
  }
  const showError = (message: string, control: HTMLInputElement): void => {
    error.textContent = message
    error.hidden = false
    control.setAttribute("aria-invalid", "true")
    control.focus({ preventScroll: true })
  }
  const close = (): void => {
    form.hidden = true
    clearError()
    onDraftChange?.(null)
    onClose?.()
  }
  const emitDraft = (): void => onDraftChange?.({
    title: title.value,
    type: category.value || undefined,
    estimateMinutes: readEstimateMinutes(),
    estimateUnit: currentUnit,
    estimateValue: estimate.value,
  })
  title.addEventListener("input", () => { clearError(); emitDraft() })
  category.addEventListener("change", emitDraft)
  estimate.addEventListener("input", () => { clearError(); emitDraft() })
  estimateUnit.addEventListener("change", () => {
    currentUnit = estimateUnit.value as DurationInputUnit
    clearError()
    emitDraft()
  })
  form.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return
    event.preventDefault()
    close()
  })
  form.addEventListener("submit", (event) => {
    event.preventDefault()
    clearError()
    if (!title.value.trim()) {
      showError(t("todoTitleRequired"), title)
      return
    }
    const enteredDuration = estimate.value.trim() === "" ? 0 : Number(estimate.value)
    if (!Number.isFinite(enteredDuration) || enteredDuration < 0) {
      showError(t("invalidDuration"), estimate)
      return
    }
    const input = { title: title.value.trim(), type: category.value || undefined, estimateMinutes: readEstimateMinutes(), estimateUnit: currentUnit }
    close()
    onSubmit(input)
  })
  return {
    form,
    open: (value, options) => {
      clearError()
      title.value = value.title
      fillCategories(value.type)
      currentUnit = value.estimateUnit ?? preferredDurationUnit(value.estimateMinutes)
      syncEstimateControl(Math.max(0, value.estimateMinutes))
      if (value.estimateValue !== undefined) estimate.value = value.estimateValue
      form.hidden = false
      emitDraft()
      if (options?.focus !== false) title.focus({ preventScroll: true })
    },
    close,
  }
}

export function renderTodosInto(slot: HTMLElement, items: TodoViewItem[], deps: TodoViewDeps): void {
  const root = slot.createDiv({ cls: "oneday-todos" })
  const canDrag = deps.view.groupBy === "none" && deps.view.sortBy === "manual"
  const header = root.createDiv({ cls: "oneday-component-header" })
  header.createEl("span", { cls: "oneday-component-title", text: t("todoList") })
  const completedAtRender = items.filter((item) => item.completed).length
  const count = header.createEl("span", { cls: "oneday-component-count", text: `${completedAtRender}/${items.length}` })
  const actions = header.createDiv({ cls: "oneday-component-actions" })
  const group = actions.createEl("button", { attr: { type: "button", "aria-label": t("todoGroupRule") } })
  setIcon(group, "list-tree")
  group.addEventListener("click", () => {
    const rect = group.getBoundingClientRect()
    deps.onGroupMenu(rect.left, rect.bottom)
  })
  const sortLabel = canDrag ? t("todoSortRule") : `${t("todoSortRule")} · ${t("todoManualSortHint")}`
  const sort = actions.createEl("button", { attr: { type: "button", "aria-label": sortLabel } })
  setIcon(sort, "arrow-up-down")
  sort.addEventListener("click", () => {
    const rect = sort.getBoundingClientRect()
    deps.onSortMenu(rect.left, rect.bottom)
  })
  const add = actions.createEl("button", { attr: { type: "button", "aria-label": t("addTodo") } })
  setIcon(add, "plus")

  const addForm = createTodoForm(root, deps.categories, "oneday-todo-add-form", deps.onAdd, undefined, deps.onDraftChange)
  add.addEventListener("click", () => addForm.form.hidden
    ? addForm.open({ title: "", estimateMinutes: 30, estimateUnit: "minutes" })
    : addForm.close())
  if (deps.draft) addForm.open(deps.draft, { focus: false })

  if (items.length === 0) {
    const empty = root.createEl("button", { cls: "oneday-component-empty", attr: { type: "button" } })
    const icon = empty.createEl("span", { cls: "oneday-component-empty-icon" })
    setIcon(icon, "plus")
    empty.createEl("span", { text: t("addFirstTodo") })
    empty.addEventListener("click", () => addForm.open({ title: "", estimateMinutes: 30, estimateUnit: "minutes" }))
    return
  }

  const list = root.createDiv({ cls: "oneday-todo-list" })
  let lastGroup = "\0"
  const displayed = items.map((item, sourceIndex) => ({ item, sourceIndex }))
  if (deps.view.sortBy === "estimate") displayed.sort((a, b) => b.item.estimateMinutes - a.item.estimateMinutes || a.sourceIndex - b.sourceIndex)
  if (deps.view.sortBy === "actual") displayed.sort((a, b) => b.item.actualMinutes - a.item.actualMinutes || a.sourceIndex - b.sourceIndex)
  const groupFor = (item: TodoViewItem): string => {
    if (deps.view.groupBy === "category") return item.type || t("noCategory")
    if (deps.view.groupBy === "status") return item.completed ? t("complete") : t("incomplete")
    return ""
  }
  if (deps.view.groupBy === "category") displayed.sort((a, b) => groupFor(a.item).localeCompare(groupFor(b.item)))
  if (deps.view.groupBy === "status") displayed.sort((a, b) => Number(a.item.completed) - Number(b.item.completed))
  displayed.forEach(({ item, sourceIndex }) => {
    const groupName = groupFor(item)
    if (deps.view.groupBy !== "none" && groupName !== lastGroup) {
      list.createEl("span", { cls: "oneday-todo-group", text: groupName })
      lastGroup = groupName
    }
    const row = list.createDiv({ cls: `oneday-todo-row${item.completed ? " is-complete" : ""}${canDrag ? " is-manual" : ""}` })
    row.tabIndex = 0
    const drag = canDrag ? row.createEl("button", { cls: "oneday-item-drag oneday-todo-drag", attr: { type: "button", "aria-label": t("dragTodo", { name: item.title }) } }) : null
    if (drag) {
      appendSixDotGrip(drag)
      attachPointerRowSort({
        list,
        row,
        handle: drag,
        rowSelector: ".oneday-todo-row",
        onMove: (targetIndex) => deps.onMove(item.id, targetIndex),
      })
    }
    const editForm = createTodoForm(
      row,
      deps.categories,
      "oneday-todo-edit-form",
      (input) => deps.onEdit(item.id, input),
      () => row.classList.remove("is-editing"),
      (draft) => deps.onEditDraftChange?.(draft ? { id: item.id, input: draft } : null),
    )
    const edit = (): void => {
      row.classList.add("is-editing")
      editForm.open({ title: item.title, type: item.type, estimateMinutes: item.estimateMinutes })
    }
    if (deps.editDraft?.id === item.id) {
      row.classList.add("is-editing")
      editForm.open(deps.editDraft.input, { focus: false })
    }
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault()
      event.stopPropagation()
      deps.onMenu(item, event.clientX, event.clientY, edit)
    })
    row.addEventListener("keydown", (event) => {
      if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") {
        event.preventDefault()
        const rect = row.getBoundingClientRect()
        deps.onMenu(item, rect.left, rect.bottom, edit)
      }
    })
    const check = row.createEl("button", { cls: "oneday-todo-check", attr: { type: "button", "aria-pressed": String(item.completed), "aria-label": item.completed ? t("markIncomplete") : t("markComplete") } })
    let completed = item.completed
    let toggleGeneration = 0
    const paintCompletion = (): void => {
      row.classList.toggle("is-complete", completed)
      check.setAttribute("aria-pressed", String(completed))
      check.setAttribute("aria-label", completed ? t("markIncomplete") : t("markComplete"))
      check.replaceChildren()
      setIcon(check, completed ? "check" : "circle")
      count.textContent = `${completedAtRender - Number(item.completed) + Number(completed)}/${items.length}`
    }
    paintCompletion()
    check.disabled = item.weekly
    check.addEventListener("click", () => {
      const previous = completed
      completed = !completed
      const generation = ++toggleGeneration
      // Paint before the Markdown write. The user sees an in-place state
      // change while Obsidian remounts the updated code block, not a dead gap.
      paintCompletion()
      void Promise.resolve(deps.onToggle(item.id, completed)).catch((error: unknown) => {
        if (generation !== toggleGeneration) return
        completed = previous
        paintCompletion()
        console.error("Oneday: failed to update todo completion", error)
      })
    })
    const body = row.createDiv({ cls: "oneday-todo-body" })
    if (item.estimateMinutes > 0 && item.type) {
      body.classList.add("oneday-schedule-source")
      body.dataset.scheduleSource = "todo"
      body.dataset.scheduleId = item.id
      body.dataset.scheduleTitle = item.title
      body.dataset.scheduleType = item.type
      body.dataset.scheduleDuration = String(item.estimateMinutes)
    }
    body.createEl("span", { cls: "oneday-item-title", text: item.title })
    const metaParts = [item.weekly ? t("weeklyGoal") : "", t("actualVsEstimate", { actual: formatHours(item.actualMinutes), estimate: formatHours(item.estimateMinutes) })].filter(Boolean)
    body.createEl("span", { cls: "oneday-item-meta", text: metaParts.join(" · ") })
    // A zero-progress track is just a full-width grey underline that reads
    // as a row divider; quiet flat rows only paint the track once there is
    // progress to show.
    if (item.estimateMinutes > 0 && item.actualMinutes > 0) {
      const track = body.createDiv({ cls: "oneday-item-progress" })
      const bar = track.createDiv({ cls: "oneday-item-progress-bar" })
      bar.style.width = `${Math.min(100, item.actualMinutes / item.estimateMinutes * 100)}%`
      bar.style.background = item.type ? (deps.typeColors[item.type] ?? "var(--interactive-accent)") : "var(--interactive-accent)"
    }
  })
}
