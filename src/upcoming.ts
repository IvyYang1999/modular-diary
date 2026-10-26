/**
 * Future schedule (Upcoming.md) in Obsidian: read/write the note through the
 * vault, reload it when it changes, copy into a daily note right after it is
 * created, and the "add future schedule" form. The copying itself lives in
 * core/upcoming-schedule.
 */
import { App, Modal, Notice, normalizePath, TFile, type EventRef } from "obsidian"
import { UpcomingSchedule } from "./core/upcoming-schedule"
import type { UpcomingItem } from "./core/upcoming"
import { t } from "./i18n"

export interface UpcomingVaultOptions {
  /** Read lazily: the plugin's app is set after this object is built. */
  app: () => App
  notePath: () => string
  /** The daily note path for a date (whether or not it exists). */
  pathForDate: (date: string) => Promise<string>
  writeToDay: (date: string, transform: (blockSource: string) => string) => Promise<unknown>
  onChange: () => void
}

/** The schedule wired to the vault. */
export function createUpcomingSchedule(options: UpcomingVaultOptions): UpcomingSchedule {
  const vault = () => options.app().vault
  const file = (): TFile | null => {
    const found = vault().getAbstractFileByPath(normalizePath(options.notePath()))
    return found instanceof TFile ? found : null
  }
  return new UpcomingSchedule({
    readNote: async () => { const note = file(); return note ? vault().cachedRead(note) : null },
    writeNote: async (change) => {
      let note = file()
      if (!note) {
        const path = normalizePath(options.notePath())
        const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""
        if (folder && !vault().getAbstractFileByPath(folder)) await vault().createFolder(folder)
        note = await vault().create(path, "")
      }
      await vault().process(note, change)
    },
    dayExists: async (date) => Boolean(vault().getAbstractFileByPath(normalizePath(await options.pathForDate(date)))),
    writeToDay: options.writeToDay,
    onChange: options.onChange,
  })
}

/** Reload when the note changes; copy into a daily note right after it is created. */
export function watchUpcoming(schedule: UpcomingSchedule, options: UpcomingVaultOptions, register: (ref: EventRef) => void, isDailyNote: (path: string) => boolean): void {
  const vault = options.app().vault
  const reloadIf = (path: string): void => {
    if (normalizePath(path) !== normalizePath(options.notePath())) return
    void schedule.load().then(() => options.onChange())
  }
  register(vault.on("modify", (file) => reloadIf(file.path)))
  register(vault.on("delete", (file) => reloadIf(file.path)))
  register(vault.on("rename", (file, oldPath) => { reloadIf(file.path); reloadIf(oldPath) }))
  register(vault.on("create", (file) => {
    reloadIf(file.path)
    if (!(file instanceof TFile) || !isDailyNote(file.path)) return
    // Daily Notes / Templater fill a new note first (same wait as daily checklists).
    activeWindow.setTimeout(() => {
      void (async () => {
        await schedule.load()
        for (const date of new Set(schedule.items.filter((item) => !item.done).map((item) => item.date))) {
          if (normalizePath(await options.pathForDate(date)) === normalizePath(file.path)) await schedule.copyInto(date)
        }
      })()
    }, 1600)
  }))
}

/** Date, optional time span, category and text; validates before handing the item over. */
export class AddUpcomingModal extends Modal {
  constructor(app: App, private readonly categories: string[], private readonly defaultDate: string, private readonly onSubmit: (item: Omit<UpcomingItem, "line" | "done">) => Promise<void>) {
    super(app)
  }

  onOpen(): void {
    this.setTitle(t("addUpcoming"))
    this.modalEl.classList.add("modular-diary-upcoming-modal")
    const form = this.contentEl.createEl("form", { cls: "modular-diary-upcoming-form" })
    const field = (label: string): HTMLElement => {
      const row = form.createEl("label", { cls: "modular-diary-upcoming-field" })
      row.createEl("span", { text: label })
      return row
    }
    const date = field(t("upcomingDate")).createEl("input", { attr: { type: "date", required: "true" } })
    date.value = this.defaultDate
    const timeRow = field(t("upcomingTime"))
    const start = timeRow.createEl("input", { attr: { type: "time", "aria-label": t("upcomingStart") } })
    timeRow.createEl("span", { cls: "modular-diary-upcoming-dash", text: "–" })
    const end = timeRow.createEl("input", { attr: { type: "time", "aria-label": t("upcomingEnd") } })
    const category = field(t("category")).createEl("select")
    for (const value of this.categories) category.createEl("option", { text: value, attr: { value } })
    const zone = field(t("upcomingZone")).createEl("select", { attr: { "aria-label": t("upcomingZone") } })
    zone.createEl("option", { text: t("allDay"), attr: { value: "" } })
    for (const [value, label] of [["am", t("zoneAm")], ["pm", t("zonePm")], ["ev", t("zoneEv")]] as const) zone.createEl("option", { text: label, attr: { value } })
    const text = field(t("upcomingText")).createEl("input", { attr: { type: "text", placeholder: t("upcomingTextPlaceholder") } })
    const hint = form.createEl("p", { cls: "modular-diary-upcoming-hint", text: t("upcomingHint") })
    const error = form.createEl("p", { cls: "modular-diary-upcoming-error", attr: { role: "status" } })
    const submit = form.createEl("button", { cls: "mod-cta", text: t("save"), attr: { type: "submit" } })
    const sync = (): void => { category.disabled = !start.value; zone.disabled = Boolean(start.value); hint.hidden = Boolean(start.value) }
    start.addEventListener("input", sync)
    sync()
    form.addEventListener("submit", (event) => {
      event.preventDefault()
      error.textContent = ""
      const minutes = (value: string): number => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5))
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date.value)) { error.textContent = t("upcomingNeedDate"); return }
      if (Boolean(start.value) !== Boolean(end.value) || (start.value && minutes(end.value) <= minutes(start.value))) { error.textContent = t("upcomingNeedSpan"); return }
      if (!start.value && !text.value.trim()) { error.textContent = t("upcomingNeedText"); return }
      if (start.value && !category.value) { error.textContent = t("upcomingNeedCategory"); return }
      submit.disabled = true
      const item = start.value
        ? { date: date.value, startMin: minutes(start.value), endMin: minutes(end.value), type: category.value, text: text.value.trim() }
        : { date: date.value, text: text.value.trim(), ...(zone.value ? { zone: zone.value as "am" | "pm" | "ev" } : {}) }
      void this.onSubmit(item).then(() => {
        new Notice(t("upcomingAdded", { date: date.value }))
        this.close()
      }, (reason) => {
        submit.disabled = false
        error.textContent = t("saveFailed")
        console.error("Modular Diary: failed to add upcoming item", reason)
      })
    })
    queueMicrotask(() => text.focus())
  }

  onClose(): void { this.contentEl.empty() }
}
