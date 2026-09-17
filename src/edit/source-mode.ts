import type { ParseError, TimelineDoc } from "../core/types"
import { t } from "../i18n"

export interface SourceModeSession {
  originalSource: string
  draft: string
}

export interface SourceModeDeps {
  validate(source: string): ParseError[]
  onDraftChange(source: string): void
  onApply(source: string): Promise<void>
  onCancel(): void
}

type TimelineParser = (source: string) => Pick<TimelineDoc, "errors">

/** The visual view may only be replaced by a parser-clean block body. */
export function sourceDraftCanApply(source: string, parse: TimelineParser): ParseError[] {
  return parse(source).errors
}

/** Never overwrite source that changed after the user opened source mode. */
export function sourceDraftMatchesLive(openedSource: string, liveSource: string): boolean {
  return openedSource === liveSource
}

function element<K extends keyof HTMLElementTagNameMap>(
  dom: Document,
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = dom.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/**
 * Mount an editor over the rendered block without destroying the visual DOM.
 * The fenced language lines are visible but immutable; only the block body is
 * editable, so a half-written fence can never make the Modular Diary block disappear.
 */
export function mountSourceMode(
  container: HTMLElement,
  initialDraft: string,
  deps: SourceModeDeps,
): HTMLElement {
  container.querySelector(".modular-diary-source-mode")?.remove()
  container.classList.add("is-source-mode")
  const dom = container.ownerDocument
  const overlay = element(dom, "section", "modular-diary-source-mode")
  overlay.setAttribute("role", "region")
  overlay.setAttribute("aria-label", t("sourceMode"))
  // Keep the native text context menu and prevent the block-level More menu
  // from opening underneath the source editor.
  overlay.addEventListener("contextmenu", (event) => event.stopPropagation())

  const header = element(dom, "header", "modular-diary-source-header")
  const heading = element(dom, "div", "modular-diary-source-heading")
  heading.append(
    element(dom, "strong", "modular-diary-source-title", t("sourceMode")),
    element(dom, "span", "modular-diary-source-subtitle", t("sourceModeDescription")),
  )
  header.appendChild(heading)

  const actions = element(dom, "div", "modular-diary-source-actions")
  const cancel = element(dom, "button", "modular-diary-source-cancel", t("cancel"))
  cancel.type = "button"
  const apply = element(dom, "button", "modular-diary-source-apply", t("applySource"))
  apply.type = "button"
  actions.append(cancel, apply)
  header.appendChild(actions)

  const editor = element(dom, "div", "modular-diary-source-editor")
  const openingFence = element(dom, "div", "modular-diary-source-fence", "```timeline")
  const textarea = element(dom, "textarea", "modular-diary-source-textarea")
  textarea.value = initialDraft
  textarea.spellcheck = false
  textarea.autocomplete = "off"
  textarea.setAttribute("autocapitalize", "off")
  textarea.setAttribute("aria-label", t("sourceBody"))
  const closingFence = element(dom, "div", "modular-diary-source-fence", "```")
  editor.append(openingFence, textarea, closingFence)

  const footer = element(dom, "footer", "modular-diary-source-footer")
  const feedback = element(dom, "div", "modular-diary-source-feedback")
  feedback.setAttribute("role", "status")
  feedback.setAttribute("aria-live", "polite")
  const shortcut = element(dom, "span", "modular-diary-source-shortcut", t("sourceShortcut"))
  footer.append(feedback, shortcut)

  let saving = false
  const validate = (): ParseError[] => {
    const errors = deps.validate(textarea.value)
    textarea.setAttribute("aria-invalid", String(errors.length > 0))
    apply.disabled = saving || errors.length > 0
    feedback.classList.toggle("is-error", errors.length > 0)
    feedback.textContent = errors.length > 0
      ? t("sourceLineError", { line: errors[0].line + 1, reason: errors[0].reason })
      : t("sourceReady")
    return errors
  }

  const close = (): void => {
    deps.onCancel()
    container.classList.remove("is-source-mode")
    overlay.remove()
  }

  const submit = async (): Promise<void> => {
    if (saving || validate().length > 0) return
    saving = true
    apply.disabled = true
    cancel.disabled = true
    feedback.classList.remove("is-error")
    feedback.textContent = t("savingSource")
    try {
      await deps.onApply(textarea.value)
      container.classList.remove("is-source-mode")
      overlay.remove()
    } catch (error) {
      saving = false
      cancel.disabled = false
      const errors = validate()
      feedback.classList.add("is-error")
      if (errors.length === 0) {
        feedback.textContent = error instanceof Error ? error.message : t("sourceSaveFailed")
      }
      textarea.focus({ preventScroll: true })
    }
  }

  // The plane is content-sized: the textarea reports its natural height and
  // the overlay's CSS min/max-height clamp it to [320px, block height]. When
  // the clamp wins, the textarea shrinks and scrolls inside the editor.
  const fitEditor = (): void => {
    textarea.style.height = "0px"
    textarea.style.height = `${textarea.scrollHeight}px`
  }
  textarea.addEventListener("input", () => {
    deps.onDraftChange(textarea.value)
    validate()
    fitEditor()
  })
  textarea.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.isComposing) return
    if (event.key === "Escape") {
      event.preventDefault()
      close()
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void submit()
    }
  })
  cancel.addEventListener("click", close)
  apply.addEventListener("click", () => void submit())

  overlay.append(header, editor, footer)
  container.appendChild(overlay)
  validate()
  fitEditor()
  textarea.focus({ preventScroll: true })
  return overlay
}
