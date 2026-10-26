/**
 * The rhythms note (`节律.md`) in Obsidian: read it, migrate the old habit
 * and weekly-todo settings into it once, keep it in step with the vault, and
 * expose daily / weekly rhythms as the habit rules the day block measures.
 */
import { App, Notice, Setting, TFile, normalizePath, type EventRef } from "obsidian"
import type { HabitDefinition } from "./core/habits"
import { parseRhythms, rhythmLinesFromSettings, rhythmToHabit, type Rhythm } from "./core/rhythms"
import type { WeeklyTodoDefinition } from "./core/todos"
import { t } from "./i18n"

export interface RhythmsHost {
  /** Read lazily: the plugin's app and settings are set after this object is built. */
  app: () => App
  settings: () => { rhythmsFile: string; habits: HabitDefinition[]; weeklyTodos: WeeklyTodoDefinition[] }
  saveSettings: () => Promise<void>
  /** Redraw mounted blocks after the rhythms changed. */
  onChange: () => void
}

export const DEFAULT_RHYTHMS_FILE = "节律.md"

export class RhythmsNote {
  items: Rhythm[] = []
  /** Set when the note could not be read; shown in settings. */
  private migrated = false

  constructor(private readonly host: RhythmsHost) {}

  path(): string {
    const value = this.host.settings().rhythmsFile.trim() || DEFAULT_RHYTHMS_FILE
    return normalizePath(value.endsWith(".md") ? value : `${value}.md`)
  }

  private file(): TFile | null {
    const found = this.host.app().vault.getAbstractFileByPath(this.path())
    return found instanceof TFile ? found : null
  }

  /** Read the note; without one, write the old settings into a new note first (once). */
  async load(): Promise<void> {
    let file = this.file()
    if (!file && !this.migrated && (this.host.settings().habits.length || this.host.settings().weeklyTodos.length)) {
      this.migrated = true
      file = await this.create(rhythmLinesFromSettings(this.host.settings().habits, this.host.settings().weeklyTodos))
      // Weekly todos now live in the note as weekly rhythms.
      this.host.settings().weeklyTodos = []
      await this.host.saveSettings()
    }
    this.items = file ? parseRhythms(await this.host.app().vault.cachedRead(file)) : []
    this.host.settings().habits = this.habits()
  }

  /** Daily and weekly rhythms as habit rules, in note order. */
  habits(): HabitDefinition[] {
    return this.items.map((rhythm, order) => rhythmToHabit(rhythm, order)).filter((habit): habit is HabitDefinition => habit !== null)
  }

  private async create(content: string): Promise<TFile> {
    const path = this.path()
    const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""
    if (folder && !this.host.app().vault.getAbstractFileByPath(folder)) await this.host.app().vault.createFolder(folder)
    return this.host.app().vault.create(path, content)
  }

  watch(register: (ref: EventRef) => void): void {
    const reloadIf = (path: string): void => {
      if (normalizePath(path) !== this.path()) return
      void this.load().then(() => this.host.onChange())
    }
    const vault = this.host.app().vault
    register(vault.on("modify", (file) => reloadIf(file.path)))
    register(vault.on("create", (file) => reloadIf(file.path)))
    register(vault.on("delete", (file) => reloadIf(file.path)))
    register(vault.on("rename", (file, oldPath) => { reloadIf(file.path); reloadIf(oldPath) }))
  }

  /** Open the note to edit it, creating a starter note when there is none. */
  async open(): Promise<void> {
    let file = this.file()
    if (!file) file = await this.create(`# 节律\n\n${t("rhythmsStarter")}\n`)
    await this.host.app().workspace.getLeaf(true).openFile(file)
  }

  /** Settings: where the note is, what it currently says, and how to write a line. */
  renderSettings(container: HTMLElement): void {
    new Setting(container)
      .setName(t("rhythmsFile"))
      .setDesc(t("rhythmsFileDescription"))
      .addText((control) => {
        control.setPlaceholder(DEFAULT_RHYTHMS_FILE).setValue(this.host.settings().rhythmsFile)
        control.inputEl.addEventListener("blur", async () => {
          const value = control.inputEl.value.trim() || DEFAULT_RHYTHMS_FILE
          if (value === this.host.settings().rhythmsFile) return
          this.host.settings().rhythmsFile = value
          await this.host.saveSettings()
          await this.load()
          this.host.onChange()
          this.renderSettings(container)
        })
      })
      .addButton((button) => button.setButtonText(t("rhythmsOpen")).onClick(() => void this.open().catch(() => new Notice(t("saveFailed")))))
    const list = container.querySelector(".modular-diary-rhythm-list") ?? container.createDiv({ cls: "modular-diary-rhythm-list" })
    list.empty()
    if (!this.items.length) {
      list.createEl("p", { cls: "setting-item-description", text: t("rhythmsEmpty") })
    } else {
      for (const rhythm of this.items) {
        const row = list.createDiv({ cls: "modular-diary-rhythm-row" })
        row.createEl("span", { cls: "modular-diary-rhythm-cadence", text: t(`rhythmCadence_${rhythm.cadence}`) })
        row.createEl("span", { cls: "modular-diary-rhythm-name", text: rhythm.name })
        row.createEl("span", { cls: "modular-diary-rhythm-meta", text: [
          rhythm.quota.kind === "duration" ? `${rhythm.quota.minutes >= 60 ? `${rhythm.quota.minutes / 60}h` : `${rhythm.quota.minutes}m`}` : `${rhythm.quota.count}×`,
          rhythm.type ? `@${rhythm.type}` : "",
        ].filter(Boolean).join(" · ") })
      }
    }
    const hint = container.querySelector(".modular-diary-rhythm-hint") ?? container.createEl("pre", { cls: "modular-diary-rhythm-hint" })
    hint.textContent = t("rhythmsGrammar")
  }
}
