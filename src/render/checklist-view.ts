import { setIcon } from "obsidian"
import { appendChecklistItem, nextChecklistItemId, type ChecklistModule } from "../core/checklist-modules"
import { t } from "../i18n"

export interface ChecklistDraft { add: string; edit?: { id: string | null; text: string } }
export interface ChecklistViewDeps {
  save: (change: (module: ChecklistModule) => ChecklistModule) => Promise<ChecklistModule>
  draft?: ChecklistDraft
  onDraft: (draft: ChecklistDraft) => void
}

/** Same slot shell and grid handles as Todos; only acknowledged saves redraw the list. */
export function renderChecklistInto(slot: HTMLElement, module: ChecklistModule, deps: ChecklistViewDeps): HTMLElement {
  const root = slot.createDiv({ cls: "modular-diary-checklist" })
  let draft: ChecklistDraft = { add: deps.draft?.add ?? "", edit: deps.draft?.edit && { ...deps.draft.edit } }
  let busy = false
  const remember = (): void => deps.onDraft({ ...draft, edit: draft.edit && { ...draft.edit } })
  const header = root.createDiv({ cls: "modular-diary-component-header" })
  header.createEl("span", { cls: "modular-diary-component-title", text: module.title || "Checklist" })
  header.createEl("span", { cls: "modular-diary-component-count", text: `${module.items.filter((i) => i.checked).length}/${module.items.length}` })
  const rename = header.createEl("button", { attr: { type: "button", "aria-label": t("checklistRename") } })
  setIcon(rename, "pencil")
  const error = root.createDiv({ cls: "modular-diary-checklist-error", attr: { role: "status" } })
  const run = async (change: (c: ChecklistModule) => ChecklistModule, after?: () => void): Promise<void> => {
    if (busy) return
    busy = true
    const previousDraft = { ...draft, edit: draft.edit && { ...draft.edit } }
    error.textContent = ""
    root.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button").forEach((el) => { el.disabled = true })
    try {
      after?.()
      remember()
      const next = await deps.save(change)
      if (root.isConnected) { const replacement = renderChecklistInto(slot, next, { ...deps, draft }); replacement.scrollTop = root.scrollTop; root.remove() }
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
  const editor = root.createEl("form", { cls: "modular-diary-checklist-edit" })
  editor.hidden = !draft.edit
  const editInput = editor.createEl("input", { attr: { type: "text", "aria-label": t("checklistEditText") } })
  editInput.value = draft.edit?.text ?? ""
  editor.createEl("button", { text: t("save"), attr: { type: "submit" } })
  const cancel = editor.createEl("button", { text: t("cancel"), attr: { type: "button" } })
  const closeEditor = (): void => { draft.edit = undefined; remember(); editor.hidden = true; rename.focus() }
  cancel.addEventListener("click", closeEditor)
  editor.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); closeEditor() } })
  editInput.addEventListener("input", () => { if (draft.edit) { draft.edit.text = editInput.value; remember() } })
  const openEditor = (id: string | null, text: string): void => {
    draft.edit = { id, text }; remember(); editInput.value = text; editor.hidden = false; editInput.focus(); editInput.select()
  }
  rename.addEventListener("click", () => openEditor(null, module.title))
  editor.addEventListener("submit", (e) => {
    e.preventDefault()
    const editing = draft.edit, text = editInput.value.trim()
    if (!editing || !text) { editInput.focus(); return }
    void run((current) => {
      if (editing.id === null) {
        if (current.title !== module.title && current.title !== text) throw new Error("checklist-title-changed")
        return { ...current, title: text }
      }
      const target = current.items.find((i) => i.id === editing.id)
      if (!target || (target.text !== module.items.find((i) => i.id === editing.id)?.text && target.text !== text)) throw new Error("checklist-item-changed")
      return { ...current, items: current.items.map((i) => i.id === editing.id ? { ...i, text } : i) }
    }, () => { draft.edit = undefined })
  })
  const list = root.createDiv({ cls: "modular-diary-checklist-items" })
  if (!module.items.length) list.createEl("p", { cls: "modular-diary-checklist-empty", text: t("checklistEmpty") })
  for (const item of module.items) {
    const row = list.createDiv({ cls: "modular-diary-checklist-row" })
    row.dataset.itemId = item.id
    row.style.paddingInlineStart = `${Math.min(8, (item.indent?.length ?? 0) / 2) * 12}px`
    const label = row.createEl("label", { cls: item.checked ? "is-checked" : "" })
    const check = label.createEl("input", { attr: { type: "checkbox", "aria-label": item.text } })
    check.checked = item.checked; check.dataset.itemId = item.id
    label.createEl("span", { text: item.text })
    check.addEventListener("change", () => {
      const checked = check.checked
      void run((c) => {
        if (!c.items.some((i) => i.id === item.id)) throw new Error("checklist-item-missing")
        return { ...c, items: c.items.map((i) => i.id === item.id ? { ...i, checked } : i) }
      })
    })
    const edit = row.createEl("button", { attr: { type: "button", "aria-label": t("checklistEditItem") } })
    setIcon(edit, "pencil")
    edit.addEventListener("click", () => openEditor(item.id, item.text))
    const remove = row.createEl("button", { attr: { type: "button", "aria-label": t("checklistRemoveItem") } })
    setIcon(remove, "x")
    remove.addEventListener("click", () => void run((c) => {
      const target = c.items.find((i) => i.id === item.id)
      if (target && target.text !== item.text) throw new Error("checklist-item-changed")
      return { ...c, items: c.items.filter((i) => i.id !== item.id) }
    }))
  }
  const add = root.createEl("form", { cls: "modular-diary-checklist-add" })
  const input = add.createEl("input", { attr: { type: "text", placeholder: t("checklistAddItem"), "aria-label": t("checklistAddItem") } })
  input.value = draft.add
  input.addEventListener("input", () => { draft.add = input.value; remember() })
  add.createEl("button", { text: "+", attr: { type: "submit", "aria-label": t("checklistAddItem") } })
  add.addEventListener("submit", (e) => {
    e.preventDefault()
    const text = input.value.trim()
    if (!text) { input.focus(); return }
    // Keep one business identity across a retry after memory changed but disk acknowledgement failed.
    const id = nextChecklistItemId(module)
    void run((c) => appendChecklistItem(c, id, text), () => { draft.add = "" })
  })
  return root
}
