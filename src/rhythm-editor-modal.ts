/**
 * The rhythms panel: a form per rhythm instead of hand-editing `节律.md`.
 * Every change is written back to the note at once (the note stays the
 * truth, so the dialog agent and hand edits keep working); rows can be
 * dragged into the order the protocol board shows.
 *
 * Each card reads top-down: what and how often (with the counting-from
 * date of a biweekly rhythm right beside its weekday); how much; when (one
 * of: any time, a part of the day, a fixed time, all day, several days);
 * then tags and a note, which stay quiet until used.
 */
import { App, Modal, Notice, setIcon } from "obsidian"
import { parseRhythms, RHYTHM_ZONES, type Rhythm, type RhythmCadence, type RhythmDraft, type RhythmZone } from "./core/rhythms"
import { attachTagSuggest, type TagSuggestDeps } from "./edit/tag-suggest"
import { t } from "./i18n"

export interface RhythmEditorHost {
  items: () => Rhythm[]
  save: (drafts: RhythmDraft[]) => Promise<void>
  openNote: () => void
  categories: () => string[]
  typeColors: () => Record<string, string>
  tagSuggest?: () => TagSuggestDeps
}

const CADENCES: readonly RhythmCadence[] = ["daily", "weekdays", "weekly", "biweekly", "monthly"]
/** Monday first, matching the week views; values are JS weekdays. */
const WEEKDAY_VALUES = [1, 2, 3, 4, 5, 6, 0]
const ZONE_KEYS: Record<RhythmZone, "zoneAm" | "zonePm" | "zoneEv"> = { am: "zoneAm", pm: "zonePm", ev: "zoneEv" }

/** The one way a rhythm asks for time; the modes replace each other. */
export type When = "any" | "zone" | "time" | "allDay" | "days"
const WHENS: readonly When[] = ["any", "zone", "time", "allDay", "days"]
const WHEN_KEYS: Record<When, "rhythmWhenAny" | "rhythmWhenZone" | "rhythmWhenTime" | "rhythmWhenAllDay" | "rhythmWhenDays"> = {
  any: "rhythmWhenAny", zone: "rhythmWhenZone", time: "rhythmWhenTime", allDay: "rhythmWhenAllDay", days: "rhythmWhenDays",
}
type QuotaUnit = "count" | "minutes" | "hours"

export function whenOf(draft: RhythmDraft): When {
  if (draft.startMin !== undefined && draft.endMin !== undefined) return "time"
  if (draft.span.kind === "days") return "days"
  if (draft.span.kind === "allDay") return "allDay"
  if (draft.zone) return "zone"
  return "any"
}

/** Switch the "when" mode: the other modes' fields are cleared, the new one gets a sensible start. */
export function withWhen(draft: RhythmDraft, when: When): RhythmDraft {
  const base: RhythmDraft = { ...draft, startMin: undefined, endMin: undefined, zone: undefined, zoneEnd: undefined, span: { kind: "slot" } }
  switch (when) {
    case "zone": return { ...base, zone: draft.zone ?? "am", zoneEnd: draft.zoneEnd }
    case "time": return { ...base, startMin: draft.startMin ?? 9 * 60, endMin: draft.endMin ?? 10 * 60 }
    case "allDay": return { ...base, span: { kind: "allDay" } }
    case "days": return { ...base, span: draft.span.kind === "days" ? draft.span : { kind: "days", min: 2, max: 3 } }
    default: return base
  }
}

/** Toggle one part of the day in the contiguous range; the range never empties. */
export function toggleZone(draft: Pick<RhythmDraft, "zone" | "zoneEnd">, zone: RhythmZone): { zone: RhythmZone; zoneEnd?: RhythmZone } {
  const index = (value: RhythmZone): number => RHYTHM_ZONES.indexOf(value)
  const lo = draft.zone ? index(draft.zone) : index(zone)
  const hi = draft.zoneEnd ? index(draft.zoneEnd) : lo
  const at = index(zone)
  let next: [number, number]
  if (at < lo) next = [at, hi]
  else if (at > hi) next = [lo, at]
  else if (lo === hi) next = [lo, hi]
  else if (at === lo) next = [lo + 1, hi]
  else if (at === hi) next = [lo, hi - 1]
  else next = [at, at]
  return { zone: RHYTHM_ZONES[next[0]], ...(next[1] > next[0] ? { zoneEnd: RHYTHM_ZONES[next[1]] } : {}) }
}

/** The number and unit a quota shows: the unit it was written in, or hours for whole hours. */
export function quotaField(quota: RhythmDraft["quota"]): { value: number; unit: QuotaUnit } {
  if (quota.kind === "count") return { value: quota.count, unit: "count" }
  const hours = quota.unit === "hours" || (quota.unit === undefined && quota.minutes >= 60 && quota.minutes % 60 === 0)
  return hours ? { value: +(quota.minutes / 60).toFixed(2), unit: "hours" } : { value: quota.minutes, unit: "minutes" }
}

/** The quota for a typed number read in a unit: the number is the user's, the unit says what it means. */
export function quotaFrom(value: number, unit: QuotaUnit): RhythmDraft["quota"] {
  if (unit === "count") return { kind: "count", count: Math.max(1, Math.round(value)) }
  if (unit === "hours") return { kind: "duration", minutes: Math.max(5, Math.round(value * 60)), unit: "hours" }
  return { kind: "duration", minutes: Math.max(5, Math.round(value)), unit: "minutes" }
}

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
const localToday = (): string => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

export class RhythmEditorModal extends Modal {
  private drafts: RhythmDraft[] = []
  private list!: HTMLElement
  private status!: HTMLElement
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
      inputs[inputs.length - 1]?.scrollIntoView({ block: "nearest" })
    })
    const open = footer.createEl("button", { text: t("rhythmEditorOpenNote"), attr: { type: "button" } })
    open.addEventListener("click", () => { this.close(); this.host.openNote() })
    this.status = footer.createEl("span", { cls: "modular-diary-rhythm-status", attr: { role: "status" } })
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
    this.status.textContent = t("rhythmSaving")
    this.status.classList.remove("is-error")
    if (this.saveTimer) window.clearTimeout(this.saveTimer)
    this.saveTimer = window.setTimeout(() => { this.saveTimer = 0; void this.flush() }, 150)
  }

  private async flush(): Promise<void> {
    this.dirty = false
    try {
      // Unnamed cards stay on screen but are not written: the note never gets a nameless line.
      await this.host.save(this.drafts.filter((draft) => draft.name.trim()).map((draft) => ({ ...draft, tags: draft.tags.filter(Boolean) })))
      if (this.status.isConnected) { this.status.textContent = t("rhythmSaved"); this.status.classList.remove("is-error") }
    } catch (error) {
      console.error("Modular Diary: failed to save the rhythms", error)
      if (this.status.isConnected) { this.status.textContent = t("rhythmSaveFailed"); this.status.classList.add("is-error") }
      else new Notice(t("rhythmSaveFailed"))
    }
  }

  private render(): void {
    this.list.empty()
    if (!this.drafts.length) {
      const empty = this.list.createDiv({ cls: "modular-diary-rhythm-editor-empty" })
      empty.createEl("p", { text: t("rhythmEditorEmpty") })
      const sample = empty.createEl("button", { text: t("rhythmStartFromSample"), attr: { type: "button" } })
      sample.addEventListener("click", () => {
        this.drafts = parseRhythms(t("rhythmsStarter")).map(toDraft)
        this.commit()
        this.render()
      })
      return
    }
    this.drafts.forEach((draft, index) => this.list.appendChild(this.row(draft, index)))
  }

  /* ── small controls ── */

  private select(parent: HTMLElement, options: Array<[string, string]>, value: string, onChange: (value: string) => void, label: string): HTMLSelectElement {
    const select = parent.createEl("select", { cls: "dropdown", attr: { "aria-label": label } })
    for (const [optionValue, text] of options) select.createEl("option", { text, attr: { value: optionValue } })
    select.value = value
    select.addEventListener("change", () => onChange(select.value))
    return select
  }

  /** A one-of control: one tab stop, ← → move the choice. */
  private seg(parent: HTMLElement, options: Array<[string, string]>, value: string, onChange: (value: string) => void, label: string): HTMLElement {
    const seg = parent.createDiv({ cls: "modular-diary-rhythm-seg", attr: { role: "radiogroup", "aria-label": label } })
    const buttons: HTMLButtonElement[] = []
    const choose = (button: HTMLButtonElement, optionValue: string): void => {
      buttons.forEach((other) => { other.setAttribute("aria-checked", String(other === button)); other.tabIndex = other === button ? 0 : -1 })
      button.focus()
      onChange(optionValue)
    }
    options.forEach(([optionValue, text]) => {
      const button = seg.createEl("button", { text, attr: { type: "button", role: "radio", "aria-checked": String(optionValue === value), tabindex: optionValue === value ? "0" : "-1" } })
      buttons.push(button)
      button.addEventListener("click", () => { if (optionValue !== value) choose(button, optionValue) })
      button.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
        event.preventDefault()
        const index = buttons.indexOf(button)
        const next = buttons[(index + (event.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length]
        choose(next, options[buttons.indexOf(next)][0])
      })
    })
    return seg
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

  private error(parent: HTMLElement, text: string): HTMLElement {
    return parent.createEl("span", { cls: "modular-diary-rhythm-field-error", text, attr: { role: "alert" } })
  }

  /* ── one rhythm ── */

  private row(draft: RhythmDraft, index: number): HTMLElement {
    const row = this.list.ownerDocument.createElement("section")
    row.className = "modular-diary-rhythm-item"
    row.dataset.index = String(index)
    const replace = (): void => { row.replaceWith(this.row(this.drafts[index], index)) }
    const set = (patch: Partial<RhythmDraft>, structural = false): void => {
      Object.assign(this.drafts[index], patch)
      this.commit()
      if (structural) replace()
    }
    const current = (): RhythmDraft => this.drafts[index]

    // Line 1: what, and how often.
    const head = row.createDiv({ cls: `modular-diary-rhythm-line is-head${draft.cadence === "weekly" || draft.cadence === "biweekly" ? " has-weekday" : ""}${draft.cadence === "biweekly" || draft.cadence === "weekly" ? " has-anchor" : ""}` })
    const grip = head.createEl("span", { cls: "modular-diary-rhythm-grip", attr: { title: t("rhythmReorder"), "aria-label": t("rhythmReorder"), role: "button", tabindex: "0" } })
    setIcon(grip, "grip-vertical")
    this.attachReorder(row, grip)
    this.select(head, CADENCES.map((cadence) => [cadence, t(`rhythmCadence_${cadence}`)]), draft.cadence, (value) => {
      const cadence = value as RhythmCadence
      const keepsWeekday = cadence === "weekly" || cadence === "biweekly"
      set({ cadence, weekday: keepsWeekday ? current().weekday : undefined, anchor: keepsWeekday ? current().anchor : undefined }, true)
    }, t("rhythmCadence_weekly")).classList.add("modular-diary-rhythm-cadence-select")
    if (draft.cadence === "weekly" || draft.cadence === "biweekly") {
      const names = t("weekdayNames").split(" ")
      this.select(head, [["", t("rhythmWeekdayAny")], ...WEEKDAY_VALUES.map((day): [string, string] => [String(day), `${t("weekdayPrefix")}${names[day]}`])], draft.weekday === undefined ? "" : String(draft.weekday), (value) => set({ weekday: value === "" ? undefined : Number(value) }), t("rhythmWeekdayAny")).classList.add("modular-diary-rhythm-weekday-select")
    }
    if (draft.cadence === "biweekly" || draft.cadence === "weekly") {
      // The counting-from date decides which weeks are on, so it sits with the frequency.
      const anchor = head.createDiv({ cls: "modular-diary-rhythm-anchor", attr: { title: t("rhythmAnchor") } })
      anchor.createEl("span", { cls: "modular-diary-rhythm-unit", text: t("rhythmAnchor") })
      const date = anchor.createEl("input", { attr: { type: "date", "aria-label": t("rhythmAnchor") } })
      date.value = draft.anchor ?? ""
      date.addEventListener("change", () => set({ anchor: /^\d{4}-\d{2}-\d{2}$/.test(date.value) ? date.value : undefined }))
      const thisWeek = anchor.createEl("button", { cls: "modular-diary-rhythm-chip-button", text: t("rhythmThisWeek"), attr: { type: "button" } })
      thisWeek.addEventListener("click", () => { date.value = localToday(); set({ anchor: date.value }) })
    }
    const nameWrap = head.createDiv({ cls: "modular-diary-rhythm-name" })
    const name = nameWrap.createEl("input", { cls: "modular-diary-rhythm-name-input", attr: { type: "text", placeholder: t("rhythmName"), "aria-label": t("rhythmName") } })
    name.value = draft.name
    let nameError: HTMLElement | null = null
    name.addEventListener("change", () => {
      const blank = !name.value.trim()
      name.toggleAttribute("aria-invalid", blank)
      nameError?.remove()
      nameError = blank ? this.error(nameWrap, t("rhythmErrName")) : null
      set({ name: name.value.trim() })
    })
    name.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); name.blur() } })
    const picker = head.createEl("span", { cls: "modular-diary-rhythm-category", attr: { title: t("rhythmCategoryHint") } })
    const dot = picker.createEl("span", { cls: "modular-diary-rhythm-category-dot", attr: { "aria-hidden": "true" } })
    const categories = [...new Set([...(draft.type ? [draft.type] : []), ...this.host.categories()])]
    const paintDot = (type: string | undefined): void => {
      const color = type ? this.host.typeColors()[type] : undefined
      dot.style.setProperty("--c", color ?? "transparent")
      picker.classList.toggle("is-empty", !color)
    }
    paintDot(draft.type)
    this.select(picker, [["", t("rhythmNoCategory")], ...categories.map((type): [string, string] => [type, type])], draft.type ?? "", (value) => { paintDot(value || undefined); set({ type: value || undefined }) }, t("category"))
    const remove = head.createEl("button", { cls: "modular-diary-settings-icon-button modular-diary-rhythm-delete", attr: { type: "button", "aria-label": t("rhythmDelete"), title: t("rhythmDelete") } })
    setIcon(remove, "trash-2")
    remove.addEventListener("click", () => {
      const [removed] = this.drafts.splice(index, 1)
      this.commit()
      this.render()
      // One click removes; the toast puts it back where it was.
      const notice = new Notice(t("rhythmDeleted", { name: removed.name || t("rhythmName") }), 8000)
      const undo = notice.noticeEl.createEl("button", { cls: "modular-diary-rhythm-undo", text: t("undo"), attr: { type: "button" } })
      undo.addEventListener("click", () => {
        this.drafts.splice(Math.min(index, this.drafts.length), 0, removed)
        this.commit()
        this.render()
        notice.hide()
      })
    })

    // Line 2: how much, and when.
    const details = row.createDiv({ cls: "modular-diary-rhythm-line is-details" })
    const field = (parent: HTMLElement, label: string, cls = ""): HTMLElement => {
      const wrap = parent.createDiv({ cls: `modular-diary-rhythm-field ${cls}`.trim() })
      wrap.createEl("span", { cls: "modular-diary-rhythm-field-label", text: label })
      return wrap.createDiv({ cls: "modular-diary-rhythm-field-control" })
    }
    const quota = field(details, t("rhythmQuota"), "is-quota")
    const shown = quotaField(draft.quota)
    const amount = this.number(quota, shown.value, shown.unit === "hours" ? 0.25 : 1, shown.unit === "hours" ? 0.25 : shown.unit === "minutes" ? 5 : 1, (value) => {
      set({ quota: quotaFrom(value, quotaField(current().quota).unit) })
    }, t("rhythmQuota"))
    this.select(quota, [["count", t("timesUnit")], ["minutes", t("minutesUnit")], ["hours", t("hoursUnit")]], shown.unit, (value) => {
      const unit = value as QuotaUnit
      const typed = Number(amount.value)
      amount.step = unit === "hours" ? "0.25" : unit === "minutes" ? "5" : "1"
      amount.min = unit === "hours" ? "0.25" : "1"
      set({ quota: quotaFrom(Number.isFinite(typed) && typed > 0 ? typed : 1, unit) })
    }, t("rhythmQuota")).classList.add("modular-diary-rhythm-unit-select")

    const when = field(details, t("rhythmWhen"), "is-when")
    const mode = whenOf(draft)
    this.seg(when, WHENS.map((value): [string, string] => [value, t(WHEN_KEYS[value])]), mode, (value) => {
      this.drafts[index] = withWhen(current(), value as When)
      this.commit()
      replace()
    }, t("rhythmWhen"))
    if (mode !== "any" && mode !== "allDay") {
      // The chosen option's own settings, set apart from the options themselves.
      const detail = when.createDiv({ cls: "modular-diary-rhythm-when-detail" })
      if (mode === "zone") {
        const chips = detail.createDiv({ cls: "modular-diary-rhythm-chips", attr: { role: "group", "aria-label": t("rhythmWhenZone") } })
        const lo = RHYTHM_ZONES.indexOf(draft.zone ?? "am"), hi = draft.zoneEnd ? RHYTHM_ZONES.indexOf(draft.zoneEnd) : lo
        for (const zone of RHYTHM_ZONES) {
          const on = RHYTHM_ZONES.indexOf(zone) >= lo && RHYTHM_ZONES.indexOf(zone) <= hi
          const chip = chips.createEl("button", { text: t(ZONE_KEYS[zone]), attr: { type: "button", "aria-pressed": String(on) } })
          chip.addEventListener("click", () => { set({ zoneEnd: undefined, ...toggleZone(current(), zone) }, true) })
        }
      } else if (mode === "time") {
        const start = detail.createEl("input", { attr: { type: "time", "aria-label": t("rhythmWhenTime") } })
        detail.createEl("span", { cls: "modular-diary-rhythm-unit", text: "–" })
        const end = detail.createEl("input", { attr: { type: "time", "aria-label": t("rhythmWhenTime") } })
        start.value = clock(draft.startMin ?? 9 * 60)
        end.value = clock(draft.endMin ?? 10 * 60)
        let timeError: HTMLElement | null = null
        const commitTime = (): void => {
          const a = parseClock(start.value), b = parseClock(end.value)
          if (a === null || b === null) return
          timeError?.remove(); timeError = null
          if (b <= a) { end.setAttribute("aria-invalid", "true"); timeError = this.error(when, t("rhythmErrTime")); return }
          end.removeAttribute("aria-invalid")
          set({ startMin: a, endMin: b })
        }
        start.addEventListener("change", commitTime)
        end.addEventListener("change", commitTime)
      } else if (mode === "days" && draft.span.kind === "days") {
        const span = draft.span
        this.number(detail, span.min, 1, 1, (value) => { const now = current().span as { max: number }; set({ span: { kind: "days", min: Math.round(value), max: Math.max(Math.round(value), now.max) } }, true) }, t("rhythmWhenDays")).classList.add("is-days")
        detail.createEl("span", { cls: "modular-diary-rhythm-unit", text: "–" })
        this.number(detail, span.max, 1, 1, (value) => { const now = current().span as { min: number }; set({ span: { kind: "days", min: Math.min(now.min, Math.round(value)), max: Math.round(value) } }, true) }, t("rhythmWhenDays")).classList.add("is-days")
        detail.createEl("span", { cls: "modular-diary-rhythm-unit", text: t("rhythmSpanDaysUnit") })
      }
    }

    // Line 3: tags and a note, quiet until used.
    const extras = row.createDiv({ cls: "modular-diary-rhythm-line is-extras" })
    const tags = field(extras, t("rhythmTags"), "is-tags")
    const tagInput = tags.createEl("input", { attr: { type: "text", placeholder: t("rhythmTagsPlaceholder"), "aria-label": t("rhythmTags") } })
    tagInput.value = draft.tags.map((tag) => `#${tag}`).join(" ")
    tagInput.addEventListener("change", () => set({ tags: tagInput.value.split(/[\s,，]+/).map((tag) => tag.replace(/^#/, "").trim()).filter(Boolean) }))
    const suggest = this.host.tagSuggest?.()
    if (suggest) attachTagSuggest(tagInput, suggest)
    const noteField = field(extras, t("rhythmNote"), "is-note")
    const note = noteField.createEl("input", { cls: "modular-diary-rhythm-note-input", attr: { type: "text", placeholder: t("rhythmNotePlaceholder"), "aria-label": t("rhythmNote") } })
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
