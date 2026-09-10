import { App, Modal } from "obsidian"
import type OnedayPlugin from "./main"
import { t } from "./i18n"
import { renderCategorySettings, renderHabitSettings } from "./settings-editors"
import type { TimelineDrawTool } from "./core/types"
import { renderDailyQuoteSettings } from "./daily-quote-settings"

abstract class FocusedSettingsModal extends Modal {
  constructor(app: App, protected readonly plugin: OnedayPlugin) {
    super(app)
  }

  protected prepare(title: string, description: string): HTMLElement {
    this.setTitle(title)
    this.modalEl.classList.add("oneday-settings-modal")
    this.contentEl.classList.add("oneday-focused-settings")
    this.contentEl.createEl("p", { cls: "oneday-settings-modal-description", text: description })
    return this.contentEl.createDiv({ cls: "oneday-settings-modal-editor" })
  }
}

export class CategorySettingsModal extends FocusedSettingsModal {
  constructor(app: App, plugin: OnedayPlugin, private categoryScope: TimelineDrawTool = "span") {
    super(app, plugin)
  }

  onOpen(): void {
    const editor = this.prepare(t("categorySettings"), t("categoriesDescription"))
    const tabs = this.contentEl.createDiv({ cls: "oneday-category-scope-tabs" })
    const render = (): void => {
      tabs.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
        const selected = button.dataset.scope === this.categoryScope
        button.classList.toggle("is-active", selected)
        button.setAttribute("aria-pressed", String(selected))
      })
      renderCategorySettings(editor, this.plugin, this.categoryScope)
    }
    for (const [scope, label] of [["span", t("spanCategoriesHeading")], ["marker", t("markerCategoriesHeading")]] as const) {
      const button = tabs.createEl("button", { text: label, attr: { type: "button", "data-scope": scope } })
      button.addEventListener("click", () => { this.categoryScope = scope; render() })
    }
    this.contentEl.insertBefore(tabs, editor)
    render()
  }

  onClose(): void {
    this.contentEl.empty()
  }
}

export class HabitSettingsModal extends FocusedSettingsModal {
  onOpen(): void {
    const editor = this.prepare(t("habitSettings"), t("habitsDescription"))
    renderHabitSettings(editor, this.plugin)
  }

  onClose(): void {
    this.contentEl.empty()
  }
}

export class DailyQuoteSettingsModal extends FocusedSettingsModal {
  onOpen(): void {
    const editor = this.prepare(t("dailyQuoteSettings"), t("dailyQuoteSettingsDescription"))
    renderDailyQuoteSettings(editor, this.plugin)
    editor.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true })
  }

  onClose(): void { this.contentEl.empty() }
}
