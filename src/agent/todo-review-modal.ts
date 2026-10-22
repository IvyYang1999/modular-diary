import { App, Component, MarkdownRenderer, Modal } from "obsidian"
import { t } from "../i18n"

/** Shows a todo review: a loading line first, then the model's Markdown answer. */
export class TodoReviewModal extends Modal {
  private readonly body: HTMLElement
  private readonly component = new Component()

  constructor(app: App, title: string, private readonly sourcePath: string) {
    super(app)
    this.setTitle(title)
    this.modalEl.classList.add("modular-diary-review-modal")
    this.body = this.contentEl.createDiv({ cls: "modular-diary-review-body" })
    this.body.createEl("p", { cls: "modular-diary-review-loading", text: t("todoReviewRunning") })
  }

  onOpen(): void { this.component.load() }

  onClose(): void { this.component.unload() }

  show(markdown: string): void {
    this.body.replaceChildren()
    void MarkdownRenderer.render(this.app, markdown, this.body, this.sourcePath, this.component)
  }

  fail(reason: string): void {
    this.body.replaceChildren()
    this.body.createEl("p", { cls: "modular-diary-review-error", text: t("todoReviewFailed", { reason }) })
  }
}
