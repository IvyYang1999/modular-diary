/**
 * Plugin settings: type -> color mapping (荧光笔色号, D2) + 对话模型配置
 * （2026-08-16 拍板：设置页填 API key 直调模型）+ layout knobs.
 */
import { App, PluginSettingTab, Setting, setIcon } from "obsidian"
import type ModularDiaryPlugin from "./main"
import { ApiProvider } from "./agent/api-client"
import { DEFAULT_TYPE_COLORS } from "./core/type-colors"
import { templateProblems, templateSummary } from "./core/template"
import { t as tr } from "./i18n"
import type { HabitDefinition } from "./core/habits"
import type { WeeklyTodoDefinition } from "./core/todos"
import { renderCategorySettings, renderHabitSettings } from "./settings-editors"
import type { DailyQuoteDefinition } from "./core/daily-quotes"
import { renderDailyQuoteSettings } from "./daily-quote-settings"

export type DialogBackend = "api" | "claude-cli"

export interface ModularDiarySettings {
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
  /** New-day template as block source: shape headers and titled sections (phase 4). */
  templateSource?: string
  /** 新用户时间轴拖拽引导是否已经展示过（全局一次） */
  timelineOnboardingSeen: boolean
  /** Toolbar category list folded to two rows (opt-in, yyt 2026-09-09). */
  categoriesCollapsed: boolean
  /** Global recurring habit rules projected into matching daily blocks. */
  habits: HabitDefinition[]
  /** Weekly cumulative Todo goals shown every day until the weekly quota is reached. */
  weeklyTodos: WeeklyTodoDefinition[]
  /** Global sentence library shared by every Daily Quote component. */
  dailyQuotes: DailyQuoteDefinition[]
  /** Span category whose colour tints quote slots by default ("" = untinted). */
  dailyQuoteInk: string
  /** Tag -> category membership; a tag missing here is independent (neutral badge). */
  tagCategories: Record<string, string>
  /** On the hour, ask in the status bar what the last hour went into. */
  hourlyNudge: boolean
  /** Hours the nudge may ask about: an hour starting at or after start, ending at or before end. */
  nudgeStartHour: number
  nudgeEndHour: number
  /** Also raise a quiet system notification (reaches you while another app is in front). */
  hourlyNudgeNotify: boolean
}

export const DEFAULT_SETTINGS: ModularDiarySettings = {
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
  categoriesCollapsed: false,
  habits: [],
  weeklyTodos: [],
  dailyQuotes: [],
  dailyQuoteInk: "",
  tagCategories: {},
  hourlyNudge: true,
  nudgeStartHour: 9,
  nudgeEndHour: 24,
  hourlyNudgeNotify: false,
}

const newId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

export class ModularDiarySettingTab extends PluginSettingTab {
  /** Saves a template edit still waiting for its debounce when the tab closes. */
  private flushTemplate: (() => void) | null = null

  constructor(app: App, private plugin: ModularDiaryPlugin) {
    super(app, plugin)
  }

  hide(): void {
    this.flushTemplate?.()
    this.flushTemplate = null
  }

  display(): void {
    const { containerEl } = this
    containerEl.empty()
    containerEl.addClass("modular-diary-focused-settings")
    containerEl.addClass("modular-diary-settings-tab")
    containerEl.createEl("h2", { text: tr("settingsTitle") })

    const timelineSection = containerEl.createDiv({ cls: "modular-diary-settings-section" })
    timelineSection.dataset.settingsSection = "timeline"
    timelineSection.createEl("h3", { text: tr("timelineSettingsHeading") })
    timelineSection.createEl("p", { text: tr("timelineSettingsDescription"), cls: "setting-item-description" })
    const timelineSettingsEl = timelineSection.createDiv({ cls: "modular-diary-settings-section-editor" })

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

    new Setting(timelineSettingsEl)
      .setName(tr("hourlyNudgeSetting"))
      .setDesc(tr("hourlyNudgeSettingDescription"))
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.hourlyNudge).onChange(async (value) => {
        this.plugin.settings.hourlyNudge = value
        await this.plugin.saveSettings()
        this.plugin.refreshHourlyNudge()
      }))

    new Setting(timelineSettingsEl)
      .setName(tr("nudgeHoursSetting"))
      .setDesc(tr("nudgeHoursSettingDescription"))
      .addText((text) => text.setValue(String(this.plugin.settings.nudgeStartHour)).onChange(async (value) => {
        const n = Number(value)
        if (Number.isInteger(n) && n >= 0 && n < this.plugin.settings.nudgeEndHour) {
          this.plugin.settings.nudgeStartHour = n
          await this.plugin.saveSettings()
          this.plugin.refreshHourlyNudge()
        }
      }))
      .addText((text) => text.setValue(String(this.plugin.settings.nudgeEndHour)).onChange(async (value) => {
        const n = Number(value)
        if (Number.isInteger(n) && n <= 24 && n > this.plugin.settings.nudgeStartHour) {
          this.plugin.settings.nudgeEndHour = n
          await this.plugin.saveSettings()
          this.plugin.refreshHourlyNudge()
        }
      }))

    const templateSetting = new Setting(timelineSettingsEl)
      .setName(tr("templateSetting"))
      .setDesc(tr("templateSettingDescription"))
    templateSetting.settingEl.classList.add("modular-diary-template-setting")
    const templateArea = templateSetting.controlEl.createEl("textarea", { cls: "modular-diary-template-source", attr: { rows: "6", spellcheck: "false", placeholder: tr("templatePlaceholder"), "aria-label": tr("templateSetting") } })
    const templateInfo = templateSetting.controlEl.createDiv({ cls: "modular-diary-template-info" })
    // Always show what is in effect: a saved skeleton, or the one the legacy layout fields imply.
    templateArea.value = this.plugin.effectiveTemplateSource()
    const paintTemplateInfo = (value: string): boolean => {
      templateInfo.replaceChildren()
      const problems = value.trim() ? templateProblems(value) : []
      if (problems.length) {
        templateInfo.classList.add("is-error")
        for (const problem of problems) {
          templateInfo.createDiv({ text: problem === "fence" ? tr("templateFence") : problem === "days" ? tr("templateDays") : tr("templateLine", { detail: problem.slice(5) }) })
        }
        return false
      }
      templateInfo.classList.remove("is-error")
      const summary = templateSummary(value)
      const parts = [
        summary.sections.length ? tr("templateSections", { names: summary.sections.map((name) => name || tr("untitledSection")).join(" · ") }) : "",
        summary.todoLayout !== "list" ? tr("templateTodoLayout", { layout: summary.todoLayout === "abc" ? tr("todoLayoutAbc") : tr("todoLayoutMatrix") }) : "",
        summary.hidden.length ? tr("templateHidden", { count: String(summary.hidden.length) }) : "",
      ].filter(Boolean)
      templateInfo.textContent = (parts.length ? tr("templatePreview", { parts: parts.join("；") }) : tr("templatePreviewPlain"))
      return true
    }
    paintTemplateInfo(templateArea.value)
    let templateTimer = 0
    const saveTemplate = async (): Promise<void> => {
      activeWindow.clearTimeout(templateTimer)
      const value = templateArea.value.trim()
      if (!paintTemplateInfo(value)) return
      this.plugin.settings.templateSource = value || undefined
      await this.plugin.saveSettings()
    }
    templateArea.addEventListener("input", () => {
      activeWindow.clearTimeout(templateTimer)
      templateTimer = activeWindow.setTimeout(() => void saveTemplate(), 300)
    })
    templateArea.addEventListener("blur", () => void saveTemplate())
    this.flushTemplate = () => void saveTemplate()
    templateSetting.addExtraButton((button) => button.setIcon("rotate-ccw").setTooltip(tr("templateReset")).onClick(async () => {
      this.plugin.settings.templateSource = undefined
      this.plugin.settings.templateLayout = undefined
      this.plugin.settings.templateWidth = undefined
      this.plugin.settings.templateHasText = undefined
      await this.plugin.saveSettings()
      templateArea.value = this.plugin.effectiveTemplateSource()
      paintTemplateInfo(templateArea.value)
    }))

    new Setting(timelineSettingsEl)
      .setName(tr("nudgeNotifySetting"))
      .setDesc(tr("nudgeNotifySettingDescription"))
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.hourlyNudgeNotify).onChange(async (value) => {
        this.plugin.settings.hourlyNudgeNotify = value
        await this.plugin.saveSettings()
      }))

    for (const [scope, heading, description] of [
      ["span", tr("spanCategoriesHeading"), tr("spanCategoriesDescription")],
      ["marker", tr("markerCategoriesHeading"), tr("markerCategoriesDescription")],
    ] as const) {
      const categorySection = containerEl.createDiv({ cls: "modular-diary-settings-section" })
      categorySection.dataset.settingsSection = `${scope}-categories`
      categorySection.createEl("h3", { text: heading })
      categorySection.createEl("p", { text: description, cls: "setting-item-description" })
      renderCategorySettings(categorySection.createDiv({ cls: "modular-diary-settings-section-editor" }), this.plugin, scope)
    }

    const habitSection = containerEl.createDiv({ cls: "modular-diary-settings-section" })
    habitSection.dataset.settingsSection = "habits"
    habitSection.createEl("h3", { text: tr("habitsHeading") })
    habitSection.createEl("p", { text: tr("habitsDescription"), cls: "setting-item-description" })
    renderHabitSettings(habitSection.createDiv({ cls: "modular-diary-settings-section-editor" }), this.plugin)

    const weeklyTodoSection = containerEl.createDiv({ cls: "modular-diary-settings-section" })
    weeklyTodoSection.dataset.settingsSection = "todo-rules"
    weeklyTodoSection.createEl("h3", { text: tr("todoRulesHeading") })
    weeklyTodoSection.createEl("p", { text: tr("todoRulesDescription"), cls: "setting-item-description" })
    const weeklyTodosEl = weeklyTodoSection.createDiv({ cls: "modular-diary-rules-settings modular-diary-settings-section-editor" })
    const renderWeeklyTodos = (): void => {
      weeklyTodosEl.empty()
      const categories = Object.keys(this.plugin.settings.spanTypeColors)
      for (const todo of [...this.plugin.settings.weeklyTodos].sort((a, b) => a.order - b.order)) {
        const row = new Setting(weeklyTodosEl).setClass("modular-diary-rule-setting")
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
        cls: "modular-diary-settings-add-rule",
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

    const quoteSection = containerEl.createDiv({ cls: "modular-diary-settings-section" })
    quoteSection.dataset.settingsSection = "daily-quotes"
    quoteSection.createEl("h3", { text: tr("dailyQuoteSettings") })
    quoteSection.createEl("p", { text: tr("dailyQuoteSettingsDescription"), cls: "setting-item-description" })
    renderDailyQuoteSettings(quoteSection.createDiv({ cls: "modular-diary-settings-section-editor" }), this.plugin)

    const captureSection = containerEl.createDiv({ cls: "modular-diary-settings-section" })
    captureSection.dataset.settingsSection = "natural-language"
    captureSection.createEl("h3", { text: tr("naturalLanguageHeading") })
    const captureEl = captureSection.createDiv({ cls: "modular-diary-settings-section-editor" })

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
