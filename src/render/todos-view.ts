import { setIcon } from "obsidian"
import { durationInputMinutes, durationInputValue, formatHours, preferredDurationUnit, type DurationInputUnit } from "../core/duration"
import type { TodoViewConfig } from "../core/types"
import { t } from "../i18n"
import { attachPointerRowSort } from "../edit/row-sort"
import { appendSixDotGrip } from "./grip"
import { TAG_RE } from "../core/tags"
import { groupTodoTree, TODO_BUCKETS } from "../core/todos"
import { attachTagSuggest, type TagSuggestDeps } from "../edit/tag-suggest"

export interface TodoViewItem {
  id: string
  title: string
  group: string
  type?: string
  completed: boolean
  weekly: boolean
  estimateMinutes: number
  actualMinutes: number
  /** `#tags` from the title; grouping by tag reads the first one. */
  tags?: string[]
  /** Free-text note shown in small type under the title. */
  note?: string
  /** Pushed to another day: shown here as a shadow, not counted, not schedulable. */
  movedTo?: string
  /** Cell in the ABC / four-quadrant layouts. */
  bucket?: string
  /** Quiet status pills after the title (a period todo's placement, its deadline). */
  flags?: Array<{ text: string; tone?: "placed" | "due" | "elsewhere" }>
}

export interface NewTodoInput {
  title: string
  /** Cell to add into (ABC / quadrants), when added from a cell's own "+". */
  bucket?: string
  type?: string
  estimateMinutes: number
  estimateUnit?: DurationInputUnit
  /** Small-print note under the title. */
  note?: string
  /** Preserve the authored number while a draft is remounted. */
  estimateValue?: string
}
export interface TodoEditDraft { id: string; input: NewTodoInput }

export interface TodoViewDeps {
  /** Header title; defaults to the day todo list's name. */
  title?: string
  /**
   * Narrow-rail layout (period block): flags lead the second line, and a zero
   * actual is not spelled out. Day todo lists keep their original meta line.
   */
  compactMeta?: boolean
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
  /** Dragged group order (`todo-groups:` header) for grouped views. */
  groupOrder?: string[]
  /** Reorder a group among its same-level siblings (key = composite group key). */
  onMoveGroup?: (key: string, targetIndex: number) => void
  /** Move a todo to a cell of the ABC / quadrant layout ("" = no cell), before another todo or at the cell's end. */
  onSetBucket?: (id: string, bucket: string, beforeId?: string | null) => void
  /** Open the layout picker (list / ABC / quadrants); the button shows only when given. */
  onLayoutMenu?: (x: number, y: number) => void
  /** Badge colours for a `#tag`; null paints the neutral, independent badge. */
  tagStyle?: (tag: string) => { background: string; color: string } | null
  /** `#` autocomplete for the title inputs. */
  tagSuggest?: TagSuggestDeps
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

export function createTodoForm(
  parent: HTMLElement,
  categories: string[],
  className: string,
  onSubmit: (input: NewTodoInput) => void,
  onClose?: () => void,
  onDraftChange?: (draft: NewTodoInput | null) => void,
  tagSuggest?: TagSuggestDeps,
): TodoFormController {
  const form = parent.createEl("form", { cls: `modular-diary-todo-form ${className}` })
  // Chromium validates before `submit`, which would replace our interaction
  // with a native step-mismatch bubble. Keep the semantic form, but validate
  // against Modular Diary's real Markdown contract in the handler below.
  form.noValidate = true
  form.hidden = true
  const title = form.createEl("input", { cls: "modular-diary-todo-title-input", attr: { type: "text", placeholder: t("todoTitle") } })
  if (tagSuggest) attachTagSuggest(title, tagSuggest)
  const category = form.createEl("select", { cls: "modular-diary-todo-category-select", attr: { "aria-label": t("category") } })
  const fillCategories = (selected?: string): void => {
    category.replaceChildren()
    category.createEl("option", { text: t("noCategory"), attr: { value: "" } })
    if (selected && !categories.includes(selected)) category.createEl("option", { text: selected, attr: { value: selected } })
    categories.forEach((value) => category.createEl("option", { text: value, attr: { value } }))
    category.value = selected ?? ""
  }
  const estimateField = form.createDiv({ cls: "modular-diary-todo-estimate-field" })
  const estimate = estimateField.createEl("input", { cls: "modular-diary-todo-estimate-input", attr: { type: "number", step: "any", inputmode: "decimal", "aria-label": t("estimatedDuration") } })
  const estimateUnit = estimateField.createEl("select", { cls: "modular-diary-todo-estimate-unit-select", attr: { "aria-label": t("durationUnit") } })
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
  const save = form.createEl("button", { cls: "modular-diary-todo-save", attr: { type: "submit", "aria-label": t("save") } })
  setIcon(save, "check")
  const error = form.createDiv({ cls: "modular-diary-todo-form-error", attr: { role: "status", "aria-live": "polite" } })
  error.hidden = true
  // The note field is the form's quiet second row (full grid width).
  const note = form.createEl("input", { cls: "modular-diary-todo-note-input", attr: { type: "text", placeholder: t("todoNotePlaceholder"), "aria-label": t("note") } })
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
    note: note.value,
  })
  title.addEventListener("input", () => { clearError(); emitDraft() })
  note.addEventListener("input", emitDraft)
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
    const input = { title: title.value.trim(), type: category.value || undefined, estimateMinutes: readEstimateMinutes(), estimateUnit: currentUnit, ...(note.value.trim() ? { note: note.value.trim() } : {}) }
    close()
    onSubmit(input)
  })
  return {
    form,
    open: (value, options) => {
      clearError()
      title.value = value.title
      note.value = value.note ?? ""
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

/** `#tags` inside free text become badges; the text around them is untouched. */
export function renderTitleWithTags(el: HTMLElement, text: string, tagStyle?: (tag: string) => { background: string; color: string } | null): void {
  let cursor = 0
  for (const match of text.matchAll(TAG_RE)) {
    const start = match.index ?? 0
    if (start > cursor) el.appendChild(el.ownerDocument.createTextNode(text.slice(cursor, start)))
    const badge = el.createEl("span", { cls: "modular-diary-tag", text: match[0] })
    const style = tagStyle?.(match[1]) ?? null
    if (style) {
      badge.classList.add("has-category")
      badge.style.setProperty("--modular-diary-tag-bg", style.background)
      badge.style.setProperty("--modular-diary-tag-fg", style.color)
    }
    cursor = start + match[0].length
  }
  if (cursor < text.length) el.appendChild(el.ownerDocument.createTextNode(text.slice(cursor)))
}

export function renderTodosInto(slot: HTMLElement, items: TodoViewItem[], deps: TodoViewDeps): void {
  const root = slot.createDiv({ cls: "modular-diary-todos" })
  const manualSort = deps.view.sortBy === "manual"
  const header = root.createDiv({ cls: "modular-diary-component-header" })
  header.createEl("span", { cls: "modular-diary-component-title", text: deps.title ?? t("todoList") })
  const counted = items.filter((item) => !item.movedTo)
  const completedAtRender = counted.filter((item) => item.completed).length
  const count = header.createEl("span", { cls: "modular-diary-component-count", text: `${completedAtRender}/${counted.length}` })
  const actions = header.createDiv({ cls: "modular-diary-component-actions" })
  const layout = deps.view.layout ?? "list"
  const buckets = layout === "list" ? null : TODO_BUCKETS[layout]
  if (deps.onLayoutMenu) {
    const layoutButton = actions.createEl("button", { attr: { type: "button", "aria-label": t("todoLayoutRule") } })
    setIcon(layoutButton, layout === "matrix" ? "grid-2x2" : layout === "abc" ? "columns-3" : "list")
    layoutButton.addEventListener("click", () => {
      const rect = layoutButton.getBoundingClientRect()
      deps.onLayoutMenu?.(rect.left, rect.bottom)
    })
  }
  // Grouping has no meaning once the cells are the groups.
  const group = actions.createEl("button", { attr: { type: "button", "aria-label": t("todoGroupRule") } })
  setIcon(group, "list-tree")
  group.hidden = Boolean(buckets)
  group.addEventListener("click", () => {
    const rect = group.getBoundingClientRect()
    deps.onGroupMenu(rect.left, rect.bottom)
  })
  const sortLabel = manualSort ? t("todoSortRule") : `${t("todoSortRule")} · ${t("todoManualSortHint")}`
  const sort = actions.createEl("button", { attr: { type: "button", "aria-label": sortLabel } })
  setIcon(sort, "arrow-up-down")
  sort.addEventListener("click", () => {
    const rect = sort.getBoundingClientRect()
    deps.onSortMenu(rect.left, rect.bottom)
  })
  const add = actions.createEl("button", { attr: { type: "button", "aria-label": t("addTodo") } })
  setIcon(add, "plus")

  let addIntoBucket: string | undefined
  const addForm = createTodoForm(root, deps.categories, "modular-diary-todo-add-form", (input) => deps.onAdd(addIntoBucket ? { ...input, bucket: addIntoBucket } : input), undefined, deps.onDraftChange, deps.tagSuggest)
  add.addEventListener("click", () => {
    addIntoBucket = undefined
    if (addForm.form.hidden) addForm.open({ title: "", estimateMinutes: 30, estimateUnit: "minutes" })
    else addForm.close()
  })
  if (deps.draft) addForm.open(deps.draft, { focus: false })

  // With cells, an empty day still shows them: filling the cells is the point.
  if (items.length === 0 && !buckets) {
    const empty = root.createEl("button", { cls: "modular-diary-component-empty", attr: { type: "button" } })
    const icon = empty.createEl("span", { cls: "modular-diary-component-empty-icon" })
    setIcon(icon, "plus")
    empty.createEl("span", { text: t("addFirstTodo") })
    empty.addEventListener("click", () => addForm.open({ title: "", estimateMinutes: 30, estimateUnit: "minutes" }))
    return
  }

  const dom = root.ownerDocument
  const list = root.createDiv({ cls: `modular-diary-todo-list${buckets ? ` is-bucketed is-${layout}` : ""}` })
  // ABC / quadrants: each cell is its own little list; todos without a known cell wait below.
  const cellLists = new Map<string, HTMLElement>()
  const makeCell = (key: string, label: string, extraCls = ""): HTMLElement => {
    const cell = dom.createElement("section")
    cell.className = `modular-diary-todo-bucket${extraCls}`
    // Todos still waiting for a cell come first: that is the pile to sort.
    if (key === "") list.prepend(cell)
    else list.appendChild(cell)
    cell.dataset.bucket = key
    const head = cell.createDiv({ cls: "modular-diary-todo-bucket-head" })
    head.createEl("span", { cls: "modular-diary-todo-bucket-name", text: label })
    head.createEl("span", { cls: "modular-diary-todo-bucket-count" })
    if (key !== "") {
      const plus = head.createEl("button", { cls: "modular-diary-todo-bucket-add", attr: { type: "button", "aria-label": t("addTodoTo", { cell: label }) } })
      setIcon(plus, "plus")
      plus.addEventListener("click", () => {
        addIntoBucket = key
        addForm.open({ title: "", estimateMinutes: 30, estimateUnit: "minutes" })
      })
    }
    const rows = cell.createDiv({ cls: "modular-diary-todo-bucket-list", attr: { "data-empty": key === "" ? t("dropHere") : t("addOrDropHere") } })
    cellLists.set(key, rows)
    return rows
  }
  if (buckets) for (const [key, labelKey] of buckets) makeCell(key, t(labelKey))
  const knownCells = new Set<string>(buckets ? buckets.map(([key]) => key) : [])
  const listFor = (item: TodoViewItem): HTMLElement => {
    if (!buckets) return list
    const key = item.bucket && knownCells.has(item.bucket) ? item.bucket : ""
    return cellLists.get(key) ?? makeCell("", t("bucketNone"), " is-unassigned")
  }
  const grouped = !buckets && deps.view.groupBy !== "none"
  const displayed = items.map((item, sourceIndex) => ({ item, sourceIndex }))
  if (deps.view.sortBy === "estimate") displayed.sort((a, b) => b.item.estimateMinutes - a.item.estimateMinutes || a.sourceIndex - b.sourceIndex)
  if (deps.view.sortBy === "actual") displayed.sort((a, b) => b.item.actualMinutes - a.item.actualMinutes || a.sourceIndex - b.sourceIndex)
  // Drag targets are indexes into the block-owned rows in source order;
  // weekly goals live in settings and keep their own ordering there.
  const ownedIds = items.filter((item) => !item.weekly).map((item) => item.id)
  /** A drop at position `targetIndex` within one group's rows, mapped onto the owned todos. */
  const mapContainerMove = (containerIds: string[], draggedId: string, targetIndex: number): number => {
    const remaining = containerIds.filter((id) => id !== draggedId)
    const without = ownedIds.filter((id) => id !== draggedId)
    const nextOwned = remaining.slice(targetIndex).find((id) => without.includes(id))
    if (nextOwned) return without.indexOf(nextOwned)
    const prevOwned = [...remaining.slice(0, targetIndex)].reverse().find((id) => without.includes(id))
    return prevOwned ? without.indexOf(prevOwned) + 1 : 0
  }
  /** A group section: header (draggable when onMoveGroup is wired) with rows appended by the caller. */
  const renderGroupSection = (container: HTMLElement, key: string, label: string, sub: boolean): HTMLElement => {
    const section = dom.createElement("section")
    section.className = `modular-diary-todo-group-section${sub ? " is-sub" : ""}`
    section.dataset.groupKey = key
    container.appendChild(section)
    const header = section.createDiv({ cls: "modular-diary-todo-group" })
    if (deps.onMoveGroup) {
      const grip = header.createEl("button", { cls: "modular-diary-item-drag modular-diary-todo-group-drag", attr: { type: "button", "aria-label": t("dragGroup", { name: label }) } })
      // One Tab stop per group: the grip stays a pointer affordance, the header reorders with Alt+↑/↓.
      grip.tabIndex = -1
      appendSixDotGrip(grip)
      attachPointerRowSort({
        list: container,
        row: section,
        handle: grip,
        rowSelector: ".modular-diary-todo-group-section",
        ghostElement: () => {
          const ghost = dom.createElement("div")
          ghost.className = "modular-diary-todo-group"
          ghost.textContent = label
          return ghost
        },
        onMove: (targetIndex) => deps.onMoveGroup?.(key, targetIndex),
      })
      header.tabIndex = 0
      header.addEventListener("keydown", (event) => {
        if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown") || event.target !== header) return
        event.preventDefault()
        const siblings = Array.from(container.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child.matches(".modular-diary-todo-group-section"))
        const at = siblings.indexOf(section)
        const target = at + (event.key === "ArrowUp" ? -1 : 1)
        if (at < 0 || target < 0 || target >= siblings.length) return
        deps.onMoveGroup?.(key, target)
      })
    }
    header.createEl("span", { cls: "modular-diary-todo-group-name", text: label })
    return section
  }
  const renderRow = (item: TodoViewItem, sourceIndex: number, host: HTMLElement, containerIds: string[] | null): void => {
    const rowDraggable = buckets ? !item.weekly && Boolean(deps.onSetBucket) : manualSort && (!grouped || !item.weekly)
    const row = host.createDiv({ cls: `modular-diary-todo-row${item.completed ? " is-complete" : ""}${rowDraggable ? " is-manual" : ""}${item.movedTo ? " is-moved" : ""}` })
    row.tabIndex = 0
    row.dataset.todoId = item.id
    const drag = rowDraggable ? row.createEl("button", { cls: "modular-diary-item-drag modular-diary-todo-drag", attr: { type: "button", "aria-label": t("dragTodo", { name: item.title }) } }) : null
    if (drag) {
      // One Tab stop per row: the grip stays a pointer affordance, the row reorders with Alt+↑/↓.
      drag.tabIndex = -1
      appendSixDotGrip(drag)
      if (buckets) attachBucketDrag(list, row, drag, (key, beforeId) => deps.onSetBucket?.(item.id, key, beforeId), item.bucket && knownCells.has(item.bucket) ? item.bucket : "")
      else attachPointerRowSort({
        list: host,
        row,
        handle: drag,
        rowSelector: ".modular-diary-todo-row",
        onMove: (targetIndex) => deps.onMove(item.id, grouped && containerIds ? mapContainerMove(containerIds, item.id, targetIndex) : targetIndex),
      })
    }
    const editForm = createTodoForm(
      row,
      deps.categories,
      "modular-diary-todo-edit-form",
      (input) => deps.onEdit(item.id, input),
      () => row.classList.remove("is-editing"),
      (draft) => deps.onEditDraftChange?.(draft ? { id: item.id, input: draft } : null),
      deps.tagSuggest,
    )
    const edit = (): void => {
      row.classList.add("is-editing")
      editForm.open({ title: item.title, type: item.type, estimateMinutes: item.estimateMinutes })
    }
    // Lets a sibling surface (a period block's calendar pill) open this row's editor.
    row.addEventListener("modular-diary-edit", edit)
    if (buckets && rowDraggable) row.addEventListener("keydown", (event) => {
      if (!event.altKey || event.target !== row) return
      const cellKey = item.bucket && knownCells.has(item.bucket) ? item.bucket : ""
      const siblings = Array.from(row.parentElement?.querySelectorAll<HTMLElement>(":scope > .modular-diary-todo-row") ?? [])
      const at = siblings.indexOf(row)
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        // Up and down stay inside the cell.
        event.preventDefault()
        const neighbour = siblings[at + (event.key === "ArrowUp" ? -1 : 1)]
        if (!neighbour) return
        const beforeId = event.key === "ArrowUp" ? neighbour.dataset.todoId : siblings[at + 2]?.dataset.todoId ?? null
        deps.onSetBucket?.(item.id, cellKey, beforeId ?? null)
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        // Left and right step to the neighbouring cell (reading order).
        event.preventDefault()
        const keys = buckets.map(([key]) => key as string)
        const from = keys.indexOf(cellKey)
        const next = keys[from < 0 ? 0 : from + (event.key === "ArrowLeft" ? -1 : 1)]
        if (next !== undefined && next !== cellKey) deps.onSetBucket?.(item.id, next, null)
      }
    })
    else if (grouped && rowDraggable) row.addEventListener("keydown", (event) => {
      if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown") || event.target !== row || !containerIds) return
      event.preventDefault()
      const siblings = Array.from(host.querySelectorAll<HTMLElement>(":scope > .modular-diary-todo-row"))
      const at = siblings.indexOf(row)
      const target = at + (event.key === "ArrowUp" ? -1 : 1)
      if (at < 0 || target < 0 || target >= siblings.length) return
      deps.onMove(item.id, mapContainerMove(containerIds, item.id, target))
    })
    else if (manualSort && !grouped) row.addEventListener("keydown", (event) => {
      if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown") || event.target !== row) return
      event.preventDefault()
      const target = sourceIndex + (event.key === "ArrowUp" ? -1 : 1)
      if (target < 0 || target >= items.length) return
      deps.onMove(item.id, target)
    })
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
    const check = row.createEl("button", { cls: "modular-diary-todo-check", attr: { type: "button", "aria-pressed": String(item.completed), "aria-label": item.completed ? t("markIncomplete") : t("markComplete") } })
    let completed = item.completed
    let toggleGeneration = 0
    const paintCompletion = (): void => {
      row.classList.toggle("is-complete", completed)
      check.setAttribute("aria-pressed", String(completed))
      check.setAttribute("aria-label", completed ? t("markIncomplete") : t("markComplete"))
      check.replaceChildren()
      setIcon(check, completed ? "check" : "circle")
      count.textContent = `${completedAtRender - Number(item.completed) + Number(completed)}/${counted.length}`
    }
    paintCompletion()
    check.disabled = item.weekly || Boolean(item.movedTo)
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
        console.error("Modular Diary: failed to update todo completion", error)
      })
    })
    const body = row.createDiv({ cls: "modular-diary-todo-body" })
    if (item.estimateMinutes > 0 && item.type && !item.movedTo) {
      body.classList.add("modular-diary-schedule-source")
      body.dataset.scheduleSource = "todo"
      body.dataset.scheduleId = item.id
      body.dataset.scheduleTitle = item.title
      body.dataset.scheduleType = item.type
      body.dataset.scheduleDuration = String(item.estimateMinutes)
    }
    const titleEl = body.createEl("span", { cls: "modular-diary-item-title" })
    renderTitleWithTags(titleEl, item.title, deps.tagStyle)
    if (item.movedTo) titleEl.createEl("span", { cls: "modular-diary-todo-moved", text: t("movedToBadge", { date: item.movedTo.slice(5).replace("-", ".") }) })
    if (!deps.compactMeta) for (const flag of item.flags ?? []) titleEl.createEl("span", { cls: `modular-diary-todo-flag is-${flag.tone ?? "placed"}`, text: flag.text })
    const metaParts = [item.weekly ? t("weeklyGoal") : "", t("actualVsEstimate", { actual: formatHours(item.actualMinutes), estimate: formatHours(item.estimateMinutes) })].filter(Boolean)
    if (deps.compactMeta) {
      const meta = body.createEl("span", { cls: "modular-diary-item-meta is-compact" })
      for (const flag of item.flags ?? []) meta.createEl("span", { cls: `modular-diary-todo-flag is-${flag.tone ?? "placed"}`, text: flag.text })
      const numbers = item.actualMinutes > 0
        ? t("actualVsEstimate", { actual: formatHours(item.actualMinutes), estimate: formatHours(item.estimateMinutes) })
        : t("estimateOnly", { estimate: formatHours(item.estimateMinutes) })
      meta.createEl("span", { cls: "modular-diary-item-meta-numbers", text: numbers })
    } else body.createEl("span", { cls: "modular-diary-item-meta", text: metaParts.join(" · ") })
    // The note sits on its own full-width row under title + meta.
    if (item.note) body.createDiv({ cls: "modular-diary-todo-note", text: item.note, attr: { title: item.note } })
    // A zero-progress track is just a full-width grey underline that reads
    // as a row divider; quiet flat rows only paint the track once there is
    // progress to show.
    if (item.estimateMinutes > 0 && item.actualMinutes > 0) {
      const track = body.createDiv({ cls: "modular-diary-item-progress" })
      const bar = track.createDiv({ cls: "modular-diary-item-progress-bar" })
      bar.style.width = `${Math.min(100, item.actualMinutes / item.estimateMinutes * 100)}%`
      bar.style.background = item.type ? (deps.typeColors[item.type] ?? "var(--interactive-accent)") : "var(--interactive-accent)"
    }
  }
  if (grouped) {
    const tree = groupTodoTree(displayed.map(({ item, sourceIndex }) => ({ ...item, sourceIndex })), deps.view, deps.groupOrder ?? [])
    for (const node of tree) {
      const section = renderGroupSection(list, node.key, node.label, false)
      if (node.subs.length === 0) {
        const rows = section.createDiv({ cls: "modular-diary-todo-group-rows" })
        for (const leaf of node.items) renderRow(leaf, leaf.sourceIndex, rows, node.items.map((entry) => entry.id))
      } else {
        const subsHost = section.createDiv({ cls: "modular-diary-todo-subs" })
        for (const sub of node.subs) {
          const subSection = renderGroupSection(subsHost, sub.key, sub.label, true)
          const subRows = subSection.createDiv({ cls: "modular-diary-todo-group-rows" })
          for (const leaf of sub.items) renderRow(leaf, leaf.sourceIndex, subRows, sub.items.map((entry) => entry.id))
        }
      }
    }
  } else {
    for (const { item, sourceIndex } of displayed) renderRow(item, sourceIndex, listFor(item), null)
  }
  // Same count as the component header: done/total, shadows of pushed todos not counted.
  if (buckets) list.querySelectorAll<HTMLElement>(".modular-diary-todo-bucket").forEach((cell) => {
    const rows = Array.from(cell.querySelectorAll<HTMLElement>(".modular-diary-todo-row")).filter((row) => !row.classList.contains("is-moved"))
    const done = rows.filter((row) => row.classList.contains("is-complete")).length
    cell.querySelector(".modular-diary-todo-bucket-count")!.textContent = rows.length ? `${done}/${rows.length}` : ""
  })
}

/**
 * Drag a row by its grip into a cell of the ABC / quadrant layout, at a
 * position inside it. The ghost matches the list's own row ghost (same width,
 * type and columns); an insertion line shows where it lands. The row itself
 * never moves in the DOM mid-drag. Esc cancels.
 */
function attachBucketDrag(list: HTMLElement, row: HTMLElement, handle: HTMLElement, onDrop: (bucket: string, beforeId: string | null) => void, from: string): void {
  handle.addEventListener("pointerdown", (event: PointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const dom = row.ownerDocument
    const rect = row.getBoundingClientRect()
    const style = dom.defaultView?.getComputedStyle(row)
    const offsetX = event.clientX - rect.left, offsetY = event.clientY - rect.top
    let ghost: HTMLElement | null = null
    let over: HTMLElement | null = null
    let beforeId: string | null = null
    const marker = dom.createElement("div")
    marker.className = "modular-diary-todo-insert-line"
    const move = (e: PointerEvent): void => {
      if (!ghost) {
        ghost = row.cloneNode(true) as HTMLElement
        ghost.classList.add("modular-diary-item-sort-ghost")
        ghost.setAttribute("aria-hidden", "true")
        ghost.removeAttribute("tabindex")
        ghost.querySelectorAll<HTMLElement>("button, input, select, textarea, [tabindex]").forEach((element) => { element.tabIndex = -1 })
        ghost.style.width = `${rect.width}px`
        ghost.style.height = `${rect.height}px`
        if (style) {
          ghost.style.gridTemplateColumns = style.gridTemplateColumns
          ghost.style.fontFamily = style.fontFamily
          ghost.style.fontSize = style.fontSize
          ghost.style.lineHeight = style.lineHeight
          ghost.style.borderRadius = style.borderRadius
        }
        dom.body.appendChild(ghost)
        row.classList.add("is-drag-source")
        list.classList.add("is-dragging")
      }
      ghost.style.left = `${e.clientX - offsetX}px`
      ghost.style.top = `${e.clientY - offsetY}px`
      const cell = dom.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>(".modular-diary-todo-bucket") ?? null
      const target = cell && list.contains(cell) ? cell : null
      if (target !== over) { over?.classList.remove("is-over"); over = target; over?.classList.add("is-over") }
      if (!target) { marker.remove(); beforeId = null; return }
      // The row whose middle is below the pointer is the one we land before.
      const rowsIn = Array.from(target.querySelectorAll<HTMLElement>(".modular-diary-todo-bucket-list > .modular-diary-todo-row")).filter((r) => r !== row)
      const next = rowsIn.find((r) => { const b = r.getBoundingClientRect(); return e.clientY < b.top + b.height / 2 }) ?? null
      beforeId = next?.dataset.todoId ?? null
      const holder = target.querySelector<HTMLElement>(".modular-diary-todo-bucket-list")!
      if (next) holder.insertBefore(marker, next)
      else holder.appendChild(marker)
    }
    const end = (commit: boolean): void => {
      handle.removeEventListener("pointermove", move)
      handle.removeEventListener("pointerup", up)
      handle.removeEventListener("pointercancel", cancel)
      dom.removeEventListener("keydown", key, true)
      const dragged = ghost !== null
      ghost?.remove()
      marker.remove()
      row.classList.remove("is-drag-source")
      list.classList.remove("is-dragging")
      const target = over
      over?.classList.remove("is-over")
      if (!commit || !dragged || !target) return
      const bucket = target.dataset.bucket ?? ""
      // Same cell and same place: nothing to write.
      const siblings = Array.from(target.querySelectorAll<HTMLElement>(".modular-diary-todo-bucket-list > .modular-diary-todo-row"))
      const at = siblings.indexOf(row)
      if (bucket === from && at >= 0 && (siblings[at + 1]?.dataset.todoId ?? null) === beforeId) return
      onDrop(bucket, beforeId)
    }
    const up = (): void => end(true)
    const cancel = (): void => end(false)
    const key = (e: KeyboardEvent): void => { if (e.key === "Escape") { e.preventDefault(); end(false) } }
    handle.setPointerCapture(event.pointerId)
    handle.addEventListener("pointermove", move)
    handle.addEventListener("pointerup", up)
    handle.addEventListener("pointercancel", cancel)
    dom.addEventListener("keydown", key, true)
  })
}
