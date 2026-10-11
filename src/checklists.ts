/**
 * Checklist module glue: templates are Markdown files in a Vault folder, a copy
 * goes into the diary as plain task boxes. Daily templates are added when a new
 * daily note appears; others through "Add checklist".
 */
import { App, Editor, EventRef, FuzzySuggestModal, moment, normalizePath, Notice, Setting, setIcon, TFile, TFolder } from "obsidian"
import type momentFactory from "moment"
import { appendChecklists, checklistInsertion, checklistTemplateStarter, hasChecklist, isDailyNotePath, parseChecklistTemplate, type ChecklistTemplate } from "./core/checklists"
import { t } from "./i18n"

export interface ChecklistHost {
  app: App
  settings: { checklistFolder: string }
  saveSettings(options?: { rerender?: boolean }): Promise<void>
}

export const DEFAULT_CHECKLIST_FOLDER = "Checklists"

export function checklistFolderPath(host: ChecklistHost): string {
  return normalizePath(host.settings.checklistFolder.trim() || DEFAULT_CHECKLIST_FOLDER)
}

function templateFiles(host: ChecklistHost): TFile[] {
  const folder = host.app.vault.getAbstractFileByPath(checklistFolderPath(host))
  if (!(folder instanceof TFolder)) return []
  return folder.children
    .filter((file): file is TFile => file instanceof TFile && file.extension === "md")
    .sort((a, b) => a.basename.localeCompare(b.basename))
}

export async function loadChecklistTemplates(host: ChecklistHost): Promise<Array<{ file: TFile; template: ChecklistTemplate }>> {
  return Promise.all(templateFiles(host).map(async (file) => ({
    file,
    template: parseChecklistTemplate(file.basename, await host.app.vault.cachedRead(file)),
  })))
}

function dailyNotesOptions(app: App): unknown {
  // Core plugin options are not exposed in Obsidian's public TypeScript declarations.
  const internal = (app as unknown as {
    internalPlugins?: { getEnabledPluginById?: (id: string) => { options?: unknown } | undefined }
  }).internalPlugins
  return internal?.getEnabledPluginById?.("daily-notes")?.options
}

export function isDailyNote(app: App, path: string): boolean {
  return isDailyNotePath(path, dailyNotesOptions(app) ?? {}, (value, format) =>
    (moment as unknown as typeof momentFactory)(value, format, true).isValid())
}

/** Append every daily template the note is still missing; returns the names added. */
export async function addDailyChecklists(host: ChecklistHost, file: TFile): Promise<string[]> {
  if (file.path.startsWith(checklistFolderPath(host) + "/")) return []
  const daily = (await loadChecklistTemplates(host)).map(({ template }) => template).filter((template) => template.daily && template.items.length)
  if (!daily.length) return []
  let added: string[] = []
  await host.app.vault.process(file, (content) => {
    added = daily.filter((template) => !hasChecklist(content, template.name)).map((template) => template.name)
    return appendChecklists(content, daily)
  })
  return added
}

/**
 * New daily notes get their daily checklists. Daily Notes / Templater fill the
 * file right after creating it, so wait for that before appending.
 */
export function watchNewDailyNotes(host: ChecklistHost & { registerEvent: (ref: EventRef) => void }): void {
  host.app.workspace.onLayoutReady(() => {
    host.registerEvent(host.app.vault.on("create", (file) => {
      if (!(file instanceof TFile) || !isDailyNote(host.app, file.path)) return
      activeWindow.setTimeout(() => {
        if (host.app.vault.getAbstractFileByPath(file.path) !== file) return
        addDailyChecklists(host, file).catch((error) => console.error("Modular Diary: failed to add daily checklists", error))
      }, 1500)
    }))
  })
}

class ChecklistSuggestModal extends FuzzySuggestModal<ChecklistTemplate> {
  constructor(app: App, private templates: ChecklistTemplate[], private choose: (template: ChecklistTemplate) => void) {
    super(app)
    this.setPlaceholder(t("chooseChecklist"))
  }
  getItems(): ChecklistTemplate[] { return this.templates }
  getItemText(template: ChecklistTemplate): string { return template.name }
  onChooseItem(template: ChecklistTemplate): void { this.choose(template) }
}

/** "Add checklist": pick a template and insert its copy at the cursor. */
export async function chooseChecklistForEditor(host: ChecklistHost, editor: Editor): Promise<void> {
  const templates = (await loadChecklistTemplates(host)).map(({ template }) => template).filter((template) => template.items.length)
  if (!templates.length) {
    new Notice(t("noChecklists", { folder: checklistFolderPath(host) }))
    return
  }
  new ChecklistSuggestModal(host.app, templates, (template) => {
    if (hasChecklist(editor.getValue(), template.name)) {
      new Notice(t("checklistAlreadyAdded", { name: template.name }))
      return
    }
    const cursor = editor.getCursor()
    const line = editor.getLine(cursor.line)
    const at = { line: cursor.line, ch: line.length }
    const text = checklistInsertion(template, line)
    editor.replaceRange(text, at)
    const lines = text.split("\n")
    editor.setCursor({ line: at.line + lines.length - 1, ch: 0 })
  }).open()
}

async function createChecklistTemplate(host: ChecklistHost): Promise<TFile> {
  const folder = checklistFolderPath(host)
  if (!host.app.vault.getAbstractFileByPath(folder)) await host.app.vault.createFolder(folder)
  const base = t("newChecklistName")
  let path = `${folder}/${base}.md`
  for (let n = 2; host.app.vault.getAbstractFileByPath(path); n += 1) path = `${folder}/${base} ${n}.md`
  return host.app.vault.create(path, checklistTemplateStarter(false, [t("checklistSampleItem")]))
}

/** Settings: folder, every template with its "add daily" switch, and "New checklist". */
export function renderChecklistSettings(container: HTMLElement, host: ChecklistHost): void {
  const render = async (): Promise<void> => {
    container.empty()
    new Setting(container)
      .setName(t("checklistFolder"))
      .setDesc(t("checklistFolderDescription"))
      .addText((control) => {
        control.setPlaceholder(DEFAULT_CHECKLIST_FOLDER).setValue(host.settings.checklistFolder)
        control.inputEl.addEventListener("blur", async () => {
          const value = control.inputEl.value.trim()
          if (value === host.settings.checklistFolder) return
          host.settings.checklistFolder = value
          await host.saveSettings()
          void render()
        })
      })
    const list = container.createDiv({ cls: "modular-diary-checklist-settings" })
    const entries = await loadChecklistTemplates(host)
    if (!entries.length) list.createEl("p", { cls: "setting-item-description", text: t("noChecklistsYet") })
    for (const { file, template } of entries) {
      new Setting(list)
        .setClass("modular-diary-checklist-setting")
        .setName(template.name)
        .setDesc(t("checklistItemCount", { count: String(template.items.length) }))
        .addToggle((toggle) => {
          toggle.setTooltip(t("checklistDaily")).setValue(template.daily).onChange(async (value) => {
            await host.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => { frontmatter.daily = value })
          })
          const label = toggle.toggleEl.ownerDocument.createElement("span")
          label.className = "modular-diary-checklist-daily-label"
          label.textContent = t("checklistDaily")
          toggle.toggleEl.insertAdjacentElement("beforebegin", label)
        })
        .addExtraButton((button) => button.setIcon("pencil").setTooltip(t("editChecklist")).onClick(() => {
          void host.app.workspace.getLeaf("tab").openFile(file)
        }))
    }
    const add = container.createEl("button", { cls: "modular-diary-settings-add-rule", attr: { type: "button" } })
    setIcon(add, "plus")
    add.createEl("span", { text: t("newChecklist") })
    add.addEventListener("click", async () => {
      try {
        const file = await createChecklistTemplate(host)
        await host.app.workspace.getLeaf("tab").openFile(file)
        void render()
      } catch (error) {
        console.error("Modular Diary: failed to create a checklist", error)
        new Notice(t("checklistCreateFailed"))
      }
    })
  }
  void render()
}
