import { setIcon } from "obsidian"
import { appendChecklistItem, nextChecklistItemId, type ChecklistModule } from "../core/checklist-modules"
import { t } from "../i18n"

/** `edit.id === null` edits the title; `adding` keeps the add row open across redraws. */
export interface ChecklistDraft { add: string; adding?: boolean; edit?: { id: string | null; text: string } }
export interface ChecklistViewDeps {
  save: (change: (module: ChecklistModule) => ChecklistModule) => Promise<ChecklistModule>
  draft?: ChecklistDraft
  onDraft: (draft: ChecklistDraft) => void
  /** Module actions (save as template, …) at x, y; the header shows ⋯ only when given. */
  onMenu?: (x: number, y: number) => void
}

/**
 * Same slot shell and grid handles as Todos; only acknowledged saves redraw the list.
 * Everything is edited in place: click the title or an item to rewrite it, and the
 * add row stays open after Enter so a list can be typed out in one go.
 */
export function renderChecklistInto(slot: HTMLElement, module: ChecklistModule, deps: ChecklistViewDeps): HTMLElement {
  const root = slot.createDiv({ cls: "modular-diary-checklist" })
  let draft: ChecklistDraft = { add: deps.draft?.add ?? "", adding: deps.draft?.adding, edit: deps.draft?.edit && { ...deps.draft.edit } }
  let busy = false
  // Set once this root has been replaced: removing a focused field fires blur, which must not redraw again.
  let replaced = false
  const remember = (): void => deps.onDraft({ ...draft, edit: draft.edit && { ...draft.edit } })
  const title = module.title || t("checklistDefaultName")
  const done = module.items.filter((i) => i.checked).length

  const run = async (change: (c: ChecklistModule) => ChecklistModule, after?: () => void): Promise<void> => {
    if (busy) return
    busy = true
    const previousDraft = { ...draft, edit: draft.edit && { ...draft.edit } }
    const refocusAdd = Boolean(draft.adding)
    error.textContent = ""
    root.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button").forEach((el) => { el.disabled = true })
    try {
      after?.()
      remember()
      const next = await deps.save(change)
      if (root.isConnected && !replaced) {
        replaced = true
        const replacement = renderChecklistInto(slot, next, { ...deps, draft })
        replacement.scrollTop = root.scrollTop
        root.remove()
        if (refocusAdd) replacement.querySelector<HTMLInputElement>(".modular-diary-checklist-add input")?.focus()
      }
    } catch {
      draft = previousDraft
      remember()
      error.textContent = t("saveFailed")
      // Native checkboxes may have changed before a rejected write. Restore the committed state.
      root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((el) => {
        el.checked = module.items.find((i) => i.id === el.dataset.itemId)?.checked ?? false
      })
    } finally {
      busy = false
      root.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button").forEach((el) => { el.disabled = false })
    }
  }

  const movesWithin = (e: FocusEvent): boolean => e.relatedTarget instanceof Node && root.contains(e.relatedTarget)
  /** One inline text field: Enter or leaving the field saves, Escape restores the text. */
  const inlineEditor = (parent: HTMLElement, cls: string, label: string, original: string, commit: (text: string) => void, cancel: () => void): HTMLInputElement => {
    const form = parent.createEl("form", { cls: `modular-diary-checklist-inline ${cls}` })
    const input = form.createEl("input", { attr: { type: "text", "aria-label": label } })
    input.value = draft.edit?.text ?? original
    let settled = false
    const finish = (save: boolean, quiet = false): void => {
      if (settled) return
      const text = input.value.trim()
      settled = true
      if (save && text && text !== original) commit(text)
      // Focus moved to another control here: drop the edit without redrawing so that click still lands.
      else if (quiet) { draft.edit = undefined; remember() }
      else cancel()
    }
    input.addEventListener("input", () => { if (draft.edit) { draft.edit.text = input.value; remember() } })
    input.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); finish(false) } })
    input.addEventListener("blur", (e) => { if (!busy && !replaced) finish(true, movesWithin(e)) })
    form.addEventListener("submit", (e) => { e.preventDefault(); finish(true) })
    return input
  }
  const redraw = (): void => {
    if (!root.isConnected || replaced) return
    replaced = true
    const replacement = renderChecklistInto(slot, module, { ...deps, draft })
    replacement.scrollTop = root.scrollTop
    root.remove()
  }
  const startEdit = (id: string | null, text: string): void => {
    draft.edit = { id, text }
    remember()
    redraw()
    const input = slot.querySelector<HTMLInputElement>(".modular-diary-checklist-inline input")
    input?.focus()
    input?.select()
  }
  const stopEdit = (): void => { draft.edit = undefined; remember(); redraw() }

  const header = root.createDiv({ cls: "modular-diary-component-header" })
  if (draft.edit?.id === null) {
    inlineEditor(header, "is-title", t("checklistRename"), title, (text) => void run((current) => {
      if (current.title !== module.title && current.title !== text) throw new Error("checklist-title-changed")
      return { ...current, title: text }
    }, () => { draft.edit = undefined }), stopEdit)
  } else {
    const titleButton = header.createEl("button", { cls: "modular-diary-component-title modular-diary-checklist-title", text: title, attr: { type: "button", title: t("checklistRenameHint") } })
    titleButton.addEventListener("click", () => startEdit(null, title))
  }
  if (module.items.length) header.createEl("span", { cls: `modular-diary-component-count${done === module.items.length ? " is-complete" : ""}`, text: `${done}/${module.items.length}` })
  if (deps.onMenu) {
    const actions = header.createDiv({ cls: "modular-diary-component-actions" })
    const more = actions.createEl("button", { cls: "modular-diary-checklist-more", attr: { type: "button", "aria-label": t("checklistActions"), title: t("checklistActions"), "aria-haspopup": "menu" } })
    setIcon(more, "ellipsis")
    more.addEventListener("click", (event) => { event.stopPropagation(); const rect = more.getBoundingClientRect(); deps.onMenu?.(rect.left, rect.bottom) })
    header.addEventListener("contextmenu", (event) => {
      if ((event.target as HTMLElement).closest("input")) return
      event.preventDefault(); event.stopPropagation(); deps.onMenu?.(event.clientX, event.clientY)
    })
  }
  const error = root.createDiv({ cls: "modular-diary-checklist-error", attr: { role: "status" } })

  const list = root.createDiv({ cls: "modular-diary-checklist-items" })
  for (const item of module.items) {
    const row = list.createDiv({ cls: `modular-diary-checklist-row${item.checked ? " is-checked" : ""}` })
    row.dataset.itemId = item.id
    row.style.paddingInlineStart = `${Math.min(8, (item.indent?.length ?? 0) / 2) * 18}px`
    const check = row.createEl("input", { cls: "task-list-item-checkbox", attr: { type: "checkbox", "aria-label": item.text } })
    check.checked = item.checked
    check.dataset.itemId = item.id
    check.addEventListener("change", () => {
      const checked = check.checked
      row.classList.toggle("is-checked", checked)
      void run((c) => {
        if (!c.items.some((i) => i.id === item.id)) throw new Error("checklist-item-missing")
        return { ...c, items: c.items.map((i) => i.id === item.id ? { ...i, checked } : i) }
      })
    })
    if (draft.edit?.id === item.id) {
      inlineEditor(row, "is-item", t("checklistEditItem"), item.text, (text) => void run((current) => {
        const target = current.items.find((i) => i.id === item.id)
        if (!target || (target.text !== item.text && target.text !== text)) throw new Error("checklist-item-changed")
        return { ...current, items: current.items.map((i) => i.id === item.id ? { ...i, text } : i) }
      }, () => { draft.edit = undefined }), stopEdit)
    } else {
      const text = row.createEl("button", { cls: "modular-diary-checklist-text", text: item.text, attr: { type: "button", title: t("checklistEditHint") } })
      text.addEventListener("click", () => startEdit(item.id, item.text))
    }
    const remove = row.createEl("button", { cls: "modular-diary-checklist-remove", attr: { type: "button", "aria-label": t("checklistRemoveItem"), title: t("checklistRemoveItem") } })
    setIcon(remove, "x")
    remove.addEventListener("click", () => void run((c) => {
      const target = c.items.find((i) => i.id === item.id)
      if (target && target.text !== item.text) throw new Error("checklist-item-changed")
      return { ...c, items: c.items.filter((i) => i.id !== item.id) }
    }))
  }

  // The add row sits where the next item will appear, aligned with item text.
  if (draft.adding || draft.add) {
    const add = list.createEl("form", { cls: "modular-diary-checklist-row modular-diary-checklist-add" })
    add.createEl("span", { cls: "modular-diary-checklist-ghost-box", attr: { "aria-hidden": "true" } })
    const input = add.createEl("input", { attr: { type: "text", placeholder: t("checklistAddPlaceholder"), "aria-label": t("checklistAddItem") } })
    input.value = draft.add
    input.addEventListener("input", () => { draft.add = input.value; remember() })
    const close = (): void => { draft.adding = false; draft.add = ""; remember(); redraw() }
    input.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); close() } })
    input.addEventListener("blur", (e) => {
      if (busy || replaced || input.value.trim()) return
      if (movesWithin(e)) { draft.adding = false; remember() } else close()
    })
    add.addEventListener("submit", (e) => {
      e.preventDefault()
      const text = input.value.trim()
      if (!text) { input.focus(); return }
      // Keep one business identity across a retry after memory changed but disk acknowledgement failed.
      const id = nextChecklistItemId(module)
      void run((c) => appendChecklistItem(c, id, text), () => { draft.add = ""; draft.adding = true })
    })
  } else {
    const open = list.createEl("button", { cls: "modular-diary-checklist-row modular-diary-checklist-add-trigger", attr: { type: "button" } })
    const icon = open.createEl("span", { cls: "modular-diary-checklist-ghost-box", attr: { "aria-hidden": "true" } })
    setIcon(icon, "plus")
    open.createEl("span", { text: module.items.length ? t("checklistAddItemShort") : t("checklistAddFirst") })
    open.addEventListener("click", () => {
      draft.adding = true
      remember()
      redraw()
      slot.querySelector<HTMLInputElement>(".modular-diary-checklist-add input")?.focus()
    })
  }
  return root
}
