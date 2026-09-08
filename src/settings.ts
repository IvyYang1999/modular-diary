/**
 * Plugin settings: type -> color mapping (荧光笔色号, D2) + 对话模型配置
 * （2026-08-16 拍板：设置页填 API key 直调模型）+ layout knobs.
 */
import { App, PluginSettingTab, Setting, setIcon } from "obsidian"
import type OnedayPlugin from "./main"
import { ApiProvider } from "./agent/api-client"
import { DEFAULT_TYPE_COLORS } from "./core/type-colors"
import { t as tr } from "./i18n"
import type { HabitDefinition } from "./core/habits"
import type { WeeklyTodoDefinition } from "./core/todos"
import { renderCategorySettings, renderHabitSettings } from "./settings-editors"
import { DEFAULT_DAILY_QUOTE_APPEARANCE, type DailyQuoteAppearance, type DailyQuoteDefinition } from "./core/daily-quotes"
import { renderDailyQuoteSettings } from "./daily-quote-settings"

export type DialogBackend = "api" | "claude-cli"

export interface OnedaySettings {
  spanTypeColors: Record<string, string>
  markerTypeColors: Record<string, string>
  hourHeight: number
  width: number
  /** 默认时间轴起止小时（块内 range: 头可覆盖） */
  rangeStartHour: number
  rangeEndHour: number
  dialogBackend: DialogBackend
  provider: ApiProvider
  apiKey: string
  baseUrl: string
  model: string
  /** 删除/改名的类型色号存档：新建块不显示，旧块里的色块/色板仍用原色（yyt 2026-08-17） */
  spanRetiredTypeColors: Record<string, string>
  markerRetiredTypeColors: Record<string, string>
  /** 布局记忆（「设为默认布局」）：新建块按此摆放 */
  templateLayout?: string
  templateWidth?: number
  templateHasText?: boolean
  /** 新用户时间轴拖拽引导是否已经展示过（全局一次） */
  timelineOnboardingSeen: boolean
  /** Global recurring habit rules projected into matching daily blocks. */
  habits: HabitDefinition[]
  /** Weekly cumulative Todo goals shown every day until the weekly quota is reached. */
  weeklyTodos: WeeklyTodoDefinition[]
  /** Global sentence library shared by every Daily Quote component. */
  dailyQuotes: DailyQuoteDefinition[]
  /** Appearance copied into a new Daily Quote component. */
  dailyQuoteDefaults: DailyQuoteAppearance
}

export const DEFAULT_SETTINGS: OnedaySettings = {
  spanTypeColors: DEFAULT_TYPE_COLORS,
  markerTypeColors: {},
  hourHeight: 48,
  width: 200,
  rangeStartHour: 7,
  rangeEndHour: 23,
  spanRetiredTypeColors: {},
  markerRetiredTypeColors: {},
  dialogBackend: "api",
  provider: "openai-compatible",
  apiKey: "",
  baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  model: "glm-4.5-air",
  timelineOnboardingSeen: false,
  habits: [],
  weeklyTodos: [],
  dailyQuotes: [],
  dailyQuoteDefaults: { ...DEFAULT_DAILY_QUOTE_APPEARANCE },
}

const newId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

export class OnedaySettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: OnedayPlugin) {
    super(app, plugin)
  }

  display(): void {
    const { containerEl } = this
    containerEl.empty()
    containerEl.addClass("oneday-focused-settings")
    containerEl.addClass("oneday-settings-tab")
    containerEl.createEl("h2", { text: tr("settingsTitle") })

    const timelineSection = containerEl.createDiv({ cls: "oneday-settings-section" })
    timelineSection.dataset.settingsSection = "timeline"
    timelineSection.createEl("h3", { text: tr("timelineSettingsHeading") })
    timelineSection.createEl("p", { text: tr("timelineSettingsDescription"), cls: "setting-item-description" })
    const timelineSettingsEl = timelineSection.createDiv({ cls: "oneday-settings-section-editor" })

    new Setting(timelineSettingsEl)
      .setName(tr("defaultRange"))
      .setDesc(tr("defaultRangeDescription"))
      .addText((t) =>
        t.setValue(String(this.plugin.settings.rangeStartHour)).onChange(async (v) => {
          const n = Number(v)
          if (Number.isInteger(n) && n >= 0 && n <= 23 && n < this.plugin.settings.rangeEndHour) {
            this.plugin.settings.rangeStartHour = n
            await this.plugin.saveSettings({ rerender: true })
          }
        })
      )
      .addText((t) =>
        t.setValue(String(this.plugin.settings.rangeEndHour)).onChange(async (v) => {
          const n = Number(v)
          if (Number.isInteger(n) && n >= 1 && n <= 24 && n > this.plugin.settings.rangeStartHour) {
            this.plugin.settings.rangeEndHour = n
            await this.plugin.saveSettings({ rerender: true })
          }
        })
      )

    new Setting(timelineSettingsEl)
      .setName(tr("hourHeight"))
      .addText((t) =>
        t.setValue(String(this.plugin.settings.hourHeight)).onChange(async (v) => {
          const n = Number(v)
          if (Number.isFinite(n) && n >= 24 && n <= 200) {
            this.plugin.settings.hourHeight = n
            await this.plugin.saveSettings({ rerender: true })
          }
        })
      )

    for (const [scope, heading, description] of [
      ["span", tr("spanCategoriesHeading"), tr("spanCategoriesDescription")],
      ["marker", tr("markerCategoriesHeading"), tr("markerCategoriesDescription")],
    ] as const) {
      const categorySection = containerEl.createDiv({ cls: "oneday-settings-section" })
      categorySection.dataset.settingsSection = `${scope}-categories`
      categorySection.createEl("h3", { text: heading })
      categorySection.createEl("p", { text: description, cls: "setting-item-description" })
      renderCategorySettings(categorySection.createDiv({ cls: "oneday-settings-section-editor" }), this.plugin, scope)
    }

    const habitSection = containerEl.createDiv({ cls: "oneday-settings-section" })
    habitSection.dataset.settingsSection = "habits"
    habitSection.createEl("h3", { text: tr("habitsHeading") })
    habitSection.createEl("p", { text: tr("habitsDescription"), cls: "setting-item-description" })
    renderHabitSettings(habitSection.createDiv({ cls: "oneday-settings-section-editor" }), this.plugin)

    const weeklyTodoSection = containerEl.createDiv({ cls: "oneday-settings-section" })
    weeklyTodoSection.dataset.settingsSection = "todo-rules"
    weeklyTodoSection.createEl("h3", { text: tr("todoRulesHeading") })
    weeklyTodoSection.createEl("p", { text: tr("todoRulesDescription"), cls: "setting-item-description" })
    const weeklyTodosEl = weeklyTodoSection.createDiv({ cls: "oneday-rules-settings oneday-settings-section-editor" })
    const renderWeeklyTodos = (): void => {
      weeklyTodosEl.empty()
      const categories = Object.keys(this.plugin.settings.spanTypeColors)
      for (const todo of [...this.plugin.settings.weeklyTodos].sort((a, b) => a.order - b.order)) {
        const row = new Setting(weeklyTodosEl).setClass("oneday-rule-setting")
        row.addText((control) => control.setValue(todo.title).setPlaceholder(tr("todoTitle")).onChange(async (value) => {
          todo.title = value.trim(); await this.plugin.saveSettings({ rerender: true })
        }))
        row.addDropdown((control) => {
          control.addOption("", tr("noCategory")); categories.forEach((category) => control.addOption(category, category))
          control.setValue(todo.type ?? "").onChange(async (value) => {
            todo.type = value || undefined; await this.plugin.saveSettings({ rerender: true })
          })
        })
        row.addText((control) => {
          control.inputEl.type = "number"; control.inputEl.min = "5"; control.inputEl.step = "5"
          control.setValue(String(todo.targetMinutes)).setPlaceholder(tr("targetMinutes")).onChange(async (value) => {
            todo.targetMinutes = Math.max(5, Number(value) || 5); await this.plugin.saveSettings({ rerender: true })
          })
        })
        row.addExtraButton((button) => button.setIcon("trash").setTooltip(tr("delete")).onClick(async () => {
          this.plugin.settings.weeklyTodos = this.plugin.settings.weeklyTodos.filter((item) => item.id !== todo.id)
          await this.plugin.saveSettings({ rerender: true }); renderWeeklyTodos()
        }))
      }
      const add = weeklyTodosEl.createEl("button", {
        cls: "oneday-settings-add-rule",
        attr: { type: "button", "aria-label": tr("addWeeklyTodo") },
      })
      setIcon(add, "plus")
      add.createEl("span", { text: tr("addWeeklyTodo") })
      add.addEventListener("click", async () => {
        this.plugin.settings.weeklyTodos.push({
          id: newId("weekly"), title: tr("addWeeklyTodo"), group: "", targetMinutes: 120,
          order: this.plugin.settings.weeklyTodos.length,
        })
        await this.plugin.saveSettings({ rerender: true })
        renderWeeklyTodos()
      })
    }
    renderWeeklyTodos()

    // The designer is an 800px workbench; on the global page it stays folded
    // behind one disclosure and renders on first open. The component pencil
    // opens the same renderer expanded inside DailyQuoteSettingsModal.
    const quoteSection = containerEl.createDiv({ cls: "oneday-settings-section" })
    quoteSection.dataset.settingsSection = "daily-quotes"
    quoteSection.createEl("h3", { text: tr("dailyQuoteSettings") })
    quoteSection.createEl("p", { text: tr("dailyQuoteSettingsDescription"), cls: "setting-item-description" })
    const quoteDetails = quoteSection.createEl("details", { cls: "oneday-settings-collapsible" })
    quoteDetails.createEl("summary", { text: tr("quoteDesignerToggle") })
    const quoteEditor = quoteDetails.createDiv({ cls: "oneday-settings-section-editor" })
    let quoteRendered = false
    quoteDetails.addEventListener("toggle", () => {
      if (!quoteDetails.open || quoteRendered) return
      quoteRendered = true
      renderDailyQuoteSettings(quoteEditor, this.plugin, {
        appearance: this.plugin.settings.dailyQuoteDefaults,
        scope: "defaults",
        onApply: async (appearance) => {
          this.plugin.settings.dailyQuoteDefaults = appearance
          await this.plugin.saveSettings({ rerender: true })
        },
      })
    })

    const captureSection = containerEl.createDiv({ cls: "oneday-settings-section" })
    captureSection.dataset.settingsSection = "natural-language"
    captureSection.createEl("h3", { text: tr("naturalLanguageHeading") })
    const captureEl = captureSection.createDiv({ cls: "oneday-settings-section-editor" })

    new Setting(captureEl)
      .setName(tr("backend"))
      .setDesc(tr("backendDescription"))
      .addDropdown((d) =>
        d
          .addOption("api", tr("apiDirect"))
          .addOption("claude-cli", tr("localClaudeCli"))
          .setValue(this.plugin.settings.dialogBackend)
          .onChange(async (v) => {
            this.plugin.settings.dialogBackend = v as DialogBackend
            await this.plugin.saveSettings()
          })
      )

    new Setting(captureEl)
      .setName(tr("apiProtocol"))
      .setDesc(tr("apiProtocolDescription"))
      .addDropdown((d) =>
        d
          .addOption("openai-compatible", tr("openaiCompatible"))
          .addOption("anthropic", "Anthropic")
          .setValue(this.plugin.settings.provider)
          .onChange(async (v) => {
            this.plugin.settings.provider = v as ApiProvider
            await this.plugin.saveSettings()
          })
      )

    new Setting(captureEl)
      .setName("API Key")
      .setDesc(tr("apiKeyDescription"))
      .addText((t) => {
        t.inputEl.type = "password"
        t.setPlaceholder("sk-…")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (v) => {
            this.plugin.settings.apiKey = v.trim()
            await this.plugin.saveSettings()
          })
      })

    new Setting(captureEl)
      .setName("Base URL")
      .setDesc(tr("baseUrlDescription"))
      .addText((t) =>
        t.setValue(this.plugin.settings.baseUrl).onChange(async (v) => {
          this.plugin.settings.baseUrl = v.trim()
          await this.plugin.saveSettings()
        })
      )

    new Setting(captureEl)
      .setName(tr("model"))
      .setDesc(tr("modelDescription"))
      .addText((t) =>
        t.setValue(this.plugin.settings.model).onChange(async (v) => {
          this.plugin.settings.model = v.trim()
          await this.plugin.saveSettings()
        })
      )
  }
}
