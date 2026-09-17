import { parseQuoteLibrary, serializeQuoteLibrary, type DailyQuoteDefinition } from "./core/daily-quotes"
import { t } from "./i18n"

export interface DailyQuoteSettingsHost {
  settings: {
    dailyQuotes: DailyQuoteDefinition[]
    /** Global highlighter (span category name) used when a sentence names none. */
    dailyQuoteInk: string
    spanTypeColors: Record<string, string>
  }
  saveSettings(options?: { rerender?: boolean }): Promise<void>
}

/**
 * The whole editor: one textarea (a sentence per line, `—— 出处` and `#分类`
 * optional) and one row of highlighter dots for the default tint. It saves
 * itself on blur, on ⌘/Ctrl+Enter, and whenever a dot is picked; every block
 * re-renders afterwards so the sentence of the day updates in place.
 */
export function renderDailyQuoteSettings(container: HTMLElement, host: DailyQuoteSettingsHost): void {
  container.empty()
  container.classList.add("modular-diary-quote-settings")
  container.createEl("p", { cls: "setting-item-description modular-diary-quote-library-hint", text: t("quoteLibraryHint") })
  // No aria-label here: Obsidian turns aria-label into a hover tooltip, which
  // floated a stray "句库" bubble over the box. The hint above labels it.
  const hint = container.querySelector<HTMLElement>(".modular-diary-quote-library-hint")!
  hint.id = hint.id || `modular-diary-quote-hint-${Math.random().toString(36).slice(2, 8)}`
  const textarea = container.createEl("textarea", {
    cls: "modular-diary-quote-library",
    attr: { rows: "6", spellcheck: "false", "aria-labelledby": hint.id, placeholder: t("quoteLibraryPlaceholder") },
  })
  textarea.value = serializeQuoteLibrary(host.settings.dailyQuotes)

  const inkRow = container.createDiv({ cls: "modular-diary-quote-ink-row" })
  inkRow.createEl("span", { cls: "modular-diary-quote-ink-label", text: t("quoteInk") })
  const dots = inkRow.createDiv({ cls: "modular-diary-quote-ink-dots", attr: { role: "radiogroup" } })
  const status = container.createDiv({ cls: "modular-diary-quote-status", attr: { "aria-live": "polite" } })
  container.createEl("p", { cls: "setting-item-description modular-diary-quote-save-hint", text: t("quoteSaveShortcut") })

  let dirty = false
  let saving: Promise<void> | null = null
  const save = (): Promise<void> => {
    if (saving) return saving
    status.textContent = t("saving")
    host.settings.dailyQuotes = parseQuoteLibrary(textarea.value, host.settings.dailyQuotes)
    dirty = false
    saving = host.saveSettings({ rerender: true })
      .then(() => { status.textContent = t("saved") })
      .catch(() => { status.textContent = t("saveFailed"); dirty = true })
      .finally(() => { saving = null })
    return saving
  }

  const renderDots = (): void => {
    dots.empty()
    const options: Array<[string, string, string]> = [
      ["", t("quoteInkNone"), ""],
      ...Object.entries(host.settings.spanTypeColors).map(([name, color]) => [name, name, color] as [string, string, string]),
    ]
    for (const [name, label, color] of options) {
      const checked = host.settings.dailyQuoteInk === name
      // Same vocabulary as the toolbar palette: a colour dot with the
      // category name, the chosen one ringed in the accent colour.
      const dot = dots.createEl("button", {
        cls: `modular-diary-quote-ink-dot${checked ? " is-checked" : ""}${name ? "" : " is-none"}`,
        attr: { type: "button", role: "radio", "aria-checked": String(checked) },
      })
      const mark = dot.createSpan({ cls: "modular-diary-quote-ink-mark" })
      if (color) mark.style.setProperty("--c", color)
      dot.createSpan({ cls: "modular-diary-quote-ink-name", text: label })
      dot.addEventListener("click", () => {
        if (host.settings.dailyQuoteInk === name) return
        host.settings.dailyQuoteInk = name
        renderDots()
        void save()
      })
    }
  }
  renderDots()

  textarea.addEventListener("input", () => { dirty = true; status.textContent = "" })
  textarea.addEventListener("blur", () => { if (dirty) void save() })
  textarea.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault()
      void save()
    }
  })
}
