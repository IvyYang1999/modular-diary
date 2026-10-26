/**
 * The rhythms panel: a form per rhythm instead of hand-editing `节律.md`.
 * Every change is written back to the note at once (the note stays the
 * truth, so the dialog agent and hand edits keep working); rows can be
 * dragged into the order the protocol board shows.
 */
import { App, Modal, Notice, setIcon } from "obsidian"
import { RHYTHM_ZONES, type Rhythm, type RhythmCadence, type RhythmDraft, type RhythmZone } from "./core/rhythms"
import { t } from "./i18n"

export interface RhythmEditorHost {
  items: () => Rhythm[]
  save: (drafts: RhythmDraft[]) => Promise<void>
  openNote: () => void
  categories: () => string[]
  typeColors: () => Record<string, string>
}

const CADENCES: readonly RhythmCadence[] = ["daily", "weekdays", "weekly", "biweekly", "monthly"]
/** Monday first, matching the week views; values are JS weekdays. */
const WEEKDAY_VALUES = [1, 2, 3, 4, 5, 6, 0]

export function toDraft(rhythm: Rhythm): RhythmDraft {
  const { id: _id, line: _line, ...draft } = rhythm
  return { ...draft, quota: { ...rhythm.quota }, span: { ...rhythm.span }, tags: [...rhythm.tags] }
}

export function blankDraft(): RhythmDraft {
  return { name: "", cadence: "weekly", quota: { kind: "count", count: 1 }, span: { kind: "slot" }, tags: [] }
}

const clock = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
const parseClock = (value: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const minutes = Number(match[1]) * 60 + Number(match[2])
  return minutes <= 24 * 60 ? minutes : null
}

export class RhythmEditorModal extends Modal {
  private drafts: RhythmDraft[] = []
  private list!: HTMLElement
  private saveTimer = 0
  private dirty = false

  constructor(app: App, private readonly host: RhythmEditorHost) {
    super(app)
  }

  onOpen(): void {
    this.setTitle(t("rhythmEditorTitle"))
    this.modalEl.classList.add("modular-diary-settings-modal", "modular-diary-rhythm-modal")
    this.contentEl.classList.add("modular-diary-focused-settings")
    this.contentEl.createEl("p", { cls: "modular-diary-settings-modal-description", text: t("rhythmEditorDescription") })
    this.drafts = this.host.items().map(toDraft)
    this.list = this.contentEl.createDiv({ cls: "modular-diary-rhythm-editor" })
    const footer = this.contentEl.createDiv({ cls: "modular-diary-rhythm-editor-footer" })
    const add = footer.createEl("button", { cls: "mod-cta", text: t("rhythmAdd"), attr: { type: "button" } })
    add.addEventListener("click", () => {
      this.drafts.push(blankDraft())
      this.render()
      const inputs = this.list.querySelectorAll<HTMLInputElement>(".modular-diary-rhythm-name-input")
      inputs[inputs.length - 1]?.focus()
    })
    const open = footer.createEl("button", { text: t("rhythmEditorOpenNote"), attr: { type: "button" } })
    open.addEventListener("click", () => { this.close(); this.host.openNote() })
    this.render()
  }

  onClose(): void {
    if (this.saveTimer) { window.clearTimeout(this.saveTimer); this.saveTimer = 0 }
    if (this.dirty) void this.flush()
    this.contentEl.empty()
  }

  /** Coalesce a burst of edits into one write; selects commit at once, text on change. */
  private commit(): void {
    this.dirty = true
    if (this.saveTimer) window.clearTimeout(this.saveTimer)
    this.saveTimer = window.setTimeout(() => { this.saveTimer = 0; void this.flush() }, 150)
  }

  private async flush(): Promise<void> {
    this.dirty = false
    try { await this.host.save(this.drafts.map((draft) => ({ ...draft, tags: draft.tags.filter(Boolean) }))) }
    catch (error) { console.error("Modular Diary: failed to save the rhythms", error); new Notice(t("rhythmSaveFailed")) }
  }

  private render(): void {
    this.list.empty()
    if (!this.drafts.length) {
      this.list.createEl("p", { cls: "modular-diary-rhythm-editor-empty", text: t("rhythmEditorEmpty") })
      return
    }
    this.drafts.forEach((draft, index) => this.list.appendChild(this.row(draft, index)))
  }

  private select(parent: HTMLElement, options: Array<[string, string]>, value: string, onChange: (value: string) => void, label: string): HTMLSelectElement {
    const select = parent.createEl("select", { attr: { "aria-label": label } })
    for (const [optionValue, text] of options) select.createEl("option", { text, attr: { value: optionValue } })
    select.value = value
    select.addEventListener("change", () => onChange(select.value))
    return select
  }

  private number(parent: HTMLElement, value: number, min: number, step: number, onChange: (value: number) => void, label: string): HTMLInputElement {
    const input = parent.createEl("input", { attr: { type: "number", min: String(min), step: String(step), inputmode: "decimal", "aria-label": label } })
    input.value = String(value)
    input.addEventListener("change", () => {
      const next = Number(input.value)
      if (Number.isFinite(next) && next >= min) onChange(next)
      else input.value = String(value)
    })
    return input
  }

  private row(draft: RhythmDraft, index: number): HTMLElement {
    const row = this.list.ownerDocument.createElement("section")
    row.className = "modular-diary-rhythm-item"
    row.dataset.index = String(index)
    const replace = (): void => { const next = this.row(this.drafts[index], index); row.replaceWith(next) }
    const set = (patch: Partial<RhythmDraft>, structural = false): void => {
      Object.assign(this.drafts[index], patch)
      this.commit()
      if (structural) replace()
    }

    // Line 1: what and when.
    const head = row.createDiv({ cls: "modular-diary-rhythm-line is-head" })
    const grip = head.createEl("span", { cls: "modular-diary-rhythm-grip", attr: { title: t("rhythmReorder"), "aria-label": t("rhythmReorder"), role: "button", tabindex: "0" } })
    setIcon(grip, "grip-vertical")
    this.attachReorder(row, grip)
    this.select(head, CADENCES.map((cadence) => [cadence, t(`rhythmCadence_${cadence}`)]), draft.cadence, (value) => {
      const cadence = value as RhythmCadence
      set({ cadence, weekday: cadence === "weekly" || cadence === "biweekly" ? draft.weekday : undefined, anchor: cadence === "biweekly" ? draft.anchor : undefined }, true)
    }, t("rhythmCadence_weekly")).classList.add("modular-diary-rhythm-cadence-select")
    if (draft.cadence === "weekly" || draft.cadence === "biweekly") {
      const names = t("weekdayNames").split(" ")
      this.select(head, [["", t("rhythmWeekdayAny")], ...WEEKDAY_VALUES.map((day): [string, string] => [String(day), `${t("weekdayPrefix")}${names[day]}`])], draft.weekday === undefined ? "" : String(draft.weekday), (value) => set({ weekday: value === "" ? undefined : Number(value) }), t("rhythmWeekdayAny")).classList.add("modular-diary-rhythm-weekday-select")
    }
    const name = head.createEl("input", { cls: "modular-diary-rhythm-name-input", attr: { type: "text", placeholder: t("rhythmName"), "aria-label": t("rhythmName") } })
    name.value = draft.name
    if (!draft.name.trim()) name.setAttribute("aria-invalid", "true")
    name.addEventListener("change", () => { name.toggleAttribute("aria-invalid", !name.value.trim()); set({ name: name.value.trim() }) })
    name.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); name.blur() } })
    const picker = head.createEl("span", { cls: "modular-diary-category-picker modular-diary-rhythm-category" })
    const dot = picker.createEl("span", { cls: "modular-diary-category-picker-dot", attr: { "aria-hidden": "true" } })
    const categories = [...new Set([...(draft.type ? [draft.type] : []), ...this.host.categories()])]
    const paintDot = (type: string | undefined): void => { dot.style.setProperty("--modular-diary-category-color", (type && this.host.typeColors()[type]) || "var(--text-faint)") }
    paintDot(draft.type)
    this.select(picker, [["", t("noCategory")], ...categories.map((type): [string, string] => [type, type])], draft.type ?? "", (value) => { paintDot(value || undefined); set({ type: value || undefined }) }, t("category"))
    const remove = head.createEl("button", { cls: "modular-diary-settings-icon-button modular-diary-rhythm-delete", attr: { type: "button", "aria-label": t("rhythmDelete"), title: t("rhythmDelete") } })
    setIcon(remove, "trash-2")
    remove.addEventListener("click", () => { this.drafts.splice(index, 1); this.commit(); this.render() })

    // Line 2: how much, which part of the day, how long it stretches, a fixed time.
    const details = row.createDiv({ cls: "modular-diary-rhythm-line is-details" })
    const field = (label: string, cls = ""): HTMLElement => {
      const wrap = details.createEl("label", { cls: `modular-diary-rhythm-field ${cls}`.trim() })
      wrap.createEl("span", { cls: "modular-diary-rhythm-field-label", text: label })
      return wrap.createDiv({ cls: "modular-diary-rhythm-field-control" })
    }
    const quota = field(t("rhythmQuota"), "is-quota")
    this.select(quota, [["count", t("rhythmQuotaCount")], ["duration", t("rhythmQuotaDuration")]], draft.quota.kind, (value) => {
      set({ quota: value === "count" ? { kind: "count", count: 1 } : { kind: "duration", minutes: 30 } }, true)
    }, t("rhythmQuota"))
    if (draft.quota.kind === "count") {
      this.number(quota, draft.quota.count, 1, 1, (value) => set({ quota: { kind: "count", count: Math.round(value) } }), t("rhythmQuotaCount"))
      quota.createEl("span", { cls: "modular-diary-rhythm-unit", text: t("timesUnit") })
    } else {
      const minutes = draft.quota.minutes
      const hours = minutes >= 60 && minutes % 15 === 0
      const input = this.number(quota, hours ? minutes / 60 : minutes, hours ? 0.25 : 5, hours ? 0.25 : 5, (value) => {
        set({ quota: { kind: "duration", minutes: Math.max(5, Math.round(unit.value === "hours" ? value * 60 : value)) } })
      }, t("rhythmQuotaDuration"))
      const unit = this.select(quota, [["minutes", t("minutesUnit")], ["hours", t("hoursUnit")]], hours ? "hours" : "minutes", (value) => {
        const current = this.drafts[index].quota
        if (current.kind !== "duration") return
        input.value = value === "hours" ? String(+(current.minutes / 60).toFixed(2)) : String(current.minutes)
        input.step = value === "hours" ? "0.25" : "5"
      }, t("rhythmQuotaDuration"))
      unit.classList.add("modular-diary-rhythm-unit-select")
    }
    const zone = field(t("rhythmZone"), "is-zone")
    const zoneKeys: Record<RhythmZone, "zoneAm" | "zonePm" | "zoneEv"> = { am: "zoneAm", pm: "zonePm", ev: "zoneEv" }
    this.select(zone, [["", t("rhythmZoneAny")], ...RHYTHM_ZONES.map((value): [string, string] => [value, t(zoneKeys[value])])], draft.zone ?? "", (value) => set({ zone: (value || undefined) as RhythmZone | undefined }), t("rhythmZone"))
    const span = field(t("rhythmSpan"), "is-span")
    this.select(span, [["slot", t("rhythmSpanSlot")], ["allDay", t("rhythmSpanAllDay")], ["days", t("rhythmSpanDays")]], draft.span.kind, (value) => {
      set({ span: value === "days" ? { kind: "days", min: 2, max: 3 } : value === "allDay" ? { kind: "allDay" } : { kind: "slot" } }, true)
    }, t("rhythmSpan"))
    if (draft.span.kind === "days") {
      const current = draft.span
      const minInput = this.number(span, current.min, 1, 1, (value) => { const max = Math.max(Math.round(value), (this.drafts[index].span as { max: number }).max); set({ span: { kind: "days", min: Math.round(value), max } }, true) }, t("rhythmSpanDays"))
      minInput.classList.add("is-days")
      span.createEl("span", { cls: "modular-diary-rhythm-unit", text: "–" })
      this.number(span, current.max, 1, 1, (value) => { const min = Math.min(Math.round(value), (this.drafts[index].span as { min: number }).min); set({ span: { kind: "days", min, max: Math.round(value) } }, true) }, t("rhythmSpanDays")).classList.add("is-days")
      span.createEl("span", { cls: "modular-diary-rhythm-unit", text: t("rhythmSpanDaysUnit") })
    }
    const time = field(t("rhythmTime"), "is-time")
    const start = time.createEl("input", { attr: { type: "time", "aria-label": t("rhythmTime") } })
    time.createEl("span", { cls: "modular-diary-rhythm-unit", text: "–" })
    const end = time.createEl("input", { attr: { type: "time", "aria-label": t("rhythmTime") } })
    if (draft.startMin !== undefined && draft.endMin !== undefined) { start.value = clock(draft.startMin); end.value = clock(draft.endMin) }
    const commitTime = (): void => {
      const a = parseClock(start.value), b = parseClock(end.value)
      if (a !== null && b !== null && b > a) set({ startMin: a, endMin: b })
      else if (!start.value && !end.value) set({ startMin: undefined, endMin: undefined })
    }
    start.addEventListener("change", commitTime)
    end.addEventListener("change", commitTime)
    if (draft.cadence === "biweekly") {
      const anchor = field(t("rhythmAnchor"), "is-anchor")
      const date = anchor.createEl("input", { attr: { type: "date", "aria-label": t("rhythmAnchor") } })
      date.value = draft.anchor ?? ""
      date.addEventListener("change", () => set({ anchor: /^\d{4}-\d{2}-\d{2}$/.test(date.value) ? date.value : undefined }))
    }
    const tags = field(t("rhythmTags"), "is-tags")
    const tagInput = tags.createEl("input", { attr: { type: "text", placeholder: t("rhythmTagsPlaceholder"), "aria-label": t("rhythmTags") } })
    tagInput.value = draft.tags.map((tag) => `#${tag}`).join(" ")
    tagInput.addEventListener("change", () => set({ tags: tagInput.value.split(/[\s,，]+/).map((tag) => tag.replace(/^#/, "").trim()).filter(Boolean) }))

    const note = row.createEl("input", { cls: "modular-diary-rhythm-note-input", attr: { type: "text", placeholder: t("rhythmNotePlaceholder"), "aria-label": t("rhythmNotePlaceholder") } })
    note.value = draft.note ?? ""
    note.addEventListener("change", () => set({ note: note.value.trim() || undefined }))
    return row
  }

  /** Drag a row by its grip; the drop position is the row under the pointer. */
  private attachReorder(row: HTMLElement, grip: HTMLElement): void {
    grip.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return
      event.preventDefault()
      const from = Number(row.dataset.index)
      let target: { index: number; before: boolean } | null = null
      let marked: HTMLElement | null = null
      const clear = (): void => { marked?.classList.remove("is-drop-before", "is-drop-after"); marked = null }
      const move = (e: PointerEvent): void => {
        row.classList.add("is-dragging")
        const under = (this.list.ownerDocument.elementFromPoint(e.clientX, e.clientY)?.closest(".modular-diary-rhythm-item") ?? null) as HTMLElement | null
        clear()
        if (!under || under === row) { target = null; return }
        const rect = under.getBoundingClientRect()
        const before = e.clientY < rect.top + rect.height / 2
        target = { index: Number(under.dataset.index), before }
        marked = under
        under.classList.add(before ? "is-drop-before" : "is-drop-after")
      }
      const up = (): void => {
        grip.removeEventListener("pointermove", move)
        grip.removeEventListener("pointerup", up)
        grip.removeEventListener("pointercancel", up)
        row.classList.remove("is-dragging")
        clear()
        if (!target) return
        const [moving] = this.drafts.splice(from, 1)
        let at = target.index + (target.before ? 0 : 1)
        if (from < at) at -= 1
        this.drafts.splice(at, 0, moving)
        this.commit()
        this.render()
      }
      grip.setPointerCapture(event.pointerId)
      grip.addEventListener("pointermove", move)
      grip.addEventListener("pointerup", up)
      grip.addEventListener("pointercancel", up)
    })
    grip.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
      event.preventDefault()
      const from = Number(row.dataset.index)
      const to = event.key === "ArrowUp" ? from - 1 : from + 1
      if (to < 0 || to >= this.drafts.length) return
      const [moving] = this.drafts.splice(from, 1)
      this.drafts.splice(to, 0, moving)
      this.commit()
      this.render()
      this.list.querySelectorAll<HTMLElement>(".modular-diary-rhythm-grip")[to]?.focus()
    })
  }
}
