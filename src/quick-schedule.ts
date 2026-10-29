/**
 * 新建日程: one text field. The line is parsed as it is typed and the result is
 * shown underneath; Enter writes a todo into that date's week note.
 */
import { App, Modal } from "obsidian"
import { formatHours } from "./core/duration"
import { parseScheduleLine, type ParsedSchedule, type ScheduleZone } from "./core/schedule-parse"
import { t } from "./i18n"
import { clock, shortDate, weekday } from "./render/period-view"

export interface QuickScheduleDefaults {
  /** Used when the line names no date (a cell or a day the form was opened from). */
  date?: string
  /** Used when the line names neither a time nor a part of the day. */
  zone?: ScheduleZone
}

const zoneLabel = (zone: ScheduleZone): string => zone === "am" ? t("zoneAm") : zone === "pm" ? t("zonePm") : t("zoneEv")

/** 周六 11.15 · 15:00 · 2h · 出门 · 参加演出 */
export function describeSchedule(parsed: ParsedSchedule): string {
  const parts = [`${weekday(parsed.date)} ${shortDate(parsed.date)}`]
  if (parsed.at !== undefined) parts.push(clock(parsed.at))
  else if (parsed.zone) parts.push(zoneLabel(parsed.zone))
  if (parsed.estimateMin) parts.push(formatHours(parsed.estimateMin))
  if (parsed.type) parts.push(parsed.type)
  parts.push(parsed.title)
  return parts.join(" · ")
}

/** Fill in what the line left out from the defaults the form was opened with. */
export function resolveSchedule(line: string, today: string, defaults: QuickScheduleDefaults): ParsedSchedule | null {
  const parsed = parseScheduleLine(line, today)
  if (!parsed) return null
  if (!parsed.dateExplicit && defaults.date) parsed.date = defaults.date
  if (parsed.at === undefined && !parsed.zone && defaults.zone) parsed.zone = defaults.zone
  return parsed
}

export class QuickScheduleModal extends Modal {
  constructor(app: App, private readonly today: string, private readonly defaults: QuickScheduleDefaults, private readonly onSubmit: (parsed: ParsedSchedule) => Promise<void>) {
    super(app)
  }

  onOpen(): void {
    this.setTitle(t("quickSchedule"))
    this.modalEl.classList.add("modular-diary-upcoming-modal", "modular-diary-quick-schedule")
    const form = this.contentEl.createEl("form", { cls: "modular-diary-upcoming-form" })
    const input = form.createEl("input", { cls: "modular-diary-quick-schedule-input", attr: { type: "text", placeholder: t("quickSchedulePlaceholder"), "aria-label": t("quickSchedule") } })
    const preview = form.createEl("p", { cls: "modular-diary-quick-schedule-preview" })
    form.createEl("p", { cls: "modular-diary-upcoming-hint", text: t("quickScheduleHint") })
    const error = form.createEl("p", { cls: "modular-diary-upcoming-error", attr: { role: "status" } })
    const submit = form.createEl("button", { cls: "mod-cta", text: t("save"), attr: { type: "submit" } })
    const render = (): void => {
      const parsed = resolveSchedule(input.value, this.today, this.defaults)
      preview.textContent = parsed ? describeSchedule(parsed) : this.defaults.date ? `${weekday(this.defaults.date)} ${shortDate(this.defaults.date)}${this.defaults.zone ? ` · ${zoneLabel(this.defaults.zone)}` : ""}` : ""
      preview.classList.toggle("is-empty", !parsed)
      error.textContent = ""
    }
    input.addEventListener("input", render)
    render()
    form.addEventListener("submit", (event) => {
      event.preventDefault()
      const parsed = resolveSchedule(input.value, this.today, this.defaults)
      if (!parsed) { error.textContent = t("quickScheduleNeedTitle"); input.focus(); return }
      submit.disabled = true
      void this.onSubmit(parsed).then(() => this.close(), (reason) => {
        submit.disabled = false
        error.textContent = t("saveFailed")
        console.error("Modular Diary: failed to schedule", reason)
      })
    })
    queueMicrotask(() => input.focus())
  }

  onClose(): void { this.contentEl.empty() }
}
