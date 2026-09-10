import { setIcon } from "obsidian"
import type { DailyQuoteDefinition } from "../core/daily-quotes"
import { t } from "../i18n"

export interface DailyQuoteViewDeps {
  onEdit: () => void
}

export interface DailyQuoteViewOptions {
  /** Resolved highlighter colour for the slot background; null keeps it untinted. */
  inkColor: string | null
}

/**
 * Keep controls rendered inside a Markdown code-block widget from handing the
 * same pointer gesture to CodeMirror.  CodeMirror may otherwise move/reveal
 * its selection after the widget has written new source, overriding the
 * scroll snapshot that belongs to that write.
 */
function bindEditorIsolatedClick(element: HTMLElement, action: () => void): void {
  const isolatePointer = (event: Event): void => {
    event.preventDefault()
    event.stopPropagation()
  }
  element.addEventListener("pointerdown", isolatePointer)
  element.addEventListener("mousedown", isolatePointer)
  element.addEventListener("click", (event) => {
    isolatePointer(event)
    action()
  })
}

/**
 * A quiet line, not a card: the slot itself carries the highlighter tint,
 * the sentence sits in the block's body type, the source in caption type.
 * The only action is the pencil (open the library); the sentence of the day
 * is decided by the date, never by clicking.
 */
export function renderDailyQuoteInto(
  slot: HTMLElement,
  quote: DailyQuoteDefinition | null,
  options: DailyQuoteViewOptions,
  deps: DailyQuoteViewDeps
): void {
  slot.empty()
  slot.classList.add("oneday-quote-slot")
  if (options.inkColor) {
    slot.style.setProperty("--oneday-quote-ink", options.inkColor)
    slot.classList.add("has-ink")
  } else {
    slot.style.removeProperty("--oneday-quote-ink")
    slot.classList.remove("has-ink")
  }
  const root = slot.createDiv({ cls: "oneday-daily-quote" })
  const header = root.createDiv({ cls: "oneday-component-header" })
  header.createEl("strong", { cls: "oneday-component-title", text: t("dailyQuote") })
  const edit = header.createEl("button", {
    cls: "oneday-component-icon-button clickable-icon",
    attr: { type: "button", "aria-label": t("editDailyQuote") },
  })
  setIcon(edit, "pencil")
  bindEditorIsolatedClick(edit, deps.onEdit)

  if (!quote) {
    const empty = root.createEl("button", {
      cls: "oneday-daily-quote-empty",
      attr: { type: "button", "aria-label": t("addFirstQuote") },
    })
    setIcon(empty.createSpan({ cls: "oneday-daily-quote-empty-icon" }), "quote")
    empty.createSpan({ text: t("addFirstQuote") })
    bindEditorIsolatedClick(empty, deps.onEdit)
    return
  }

  const body = root.createDiv({ cls: "oneday-daily-quote-body" })
  body.createEl("p", { cls: "oneday-daily-quote-text", text: quote.text.trim() })
  if (quote.author.trim()) body.createEl("span", { cls: "oneday-daily-quote-author", text: quote.author.trim() })
}
