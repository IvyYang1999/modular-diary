/**
 * Lightweight inline dialog under each timeline block (M2).
 * User types natural language -> claude CLI returns a JSON entry ->
 * plugin validates and writes it back to the markdown source (D7).
 */
import { TimelineDoc } from "../core/types"
import { OnedaySettings } from "../settings"
import { buildSystemPrompt } from "./prompt"
import { AgentAction, interpretActions } from "./response"
import { runEntryAgent } from "./runner"
import { runEntryAgentApi } from "./direct-runner"
import { obsidianTransport } from "./obsidian-transport"
import { currentLocale, t } from "../i18n"
import { setIcon } from "obsidian"

export interface DialogDeps {
  settings: OnedaySettings
  /** Persist agent actions (create/update/delete) into the note's block. */
  writeActions: (actions: AgentAction[]) => Promise<void>
  /** 未配置 API 时跳转设置页 */
  openSettings: () => void
}

export function attachDialog(container: HTMLElement, doc: TimelineDoc, deps: DialogDeps): void {
  const box = container.createDiv({ cls: "oneday-dialog" })
  box.setAttrs({ role: "region", "aria-label": t("quickRecord"), "aria-busy": "false" })
  const domWindow = box.ownerDocument.defaultView

  // 未配置 API：禁用输入框 + 配置引导（yyt 2026-08-17）
  const needsKey = deps.settings.dialogBackend === "api" && deps.settings.apiKey.trim() === ""
  if (needsKey) {
    const hint = box.createDiv({ cls: "oneday-dialog-needskey" })
    // Decorative Lucide glyph instead of a text "✦": the copy carries the meaning.
    setIcon(hint.createSpan({ cls: "oneday-dialog-icon", attr: { "aria-hidden": "true" } }), "sparkles")
    hint.createEl("span", { text: t("quickRecordNeedsApi") })
    const btn = hint.createEl("button", { text: t("configureApiKey"), attr: { type: "button" } })
    btn.addEventListener("click", () => deps.openSettings())
    return
  }

  // 自动增高的多行输入（yyt：多事件时内容长）。左侧的 sparkles 只是装饰，
  // 占位文字自己说明用途。
  const inputRow = box.createDiv({ cls: "oneday-dialog-input-row" })
  setIcon(inputRow.createSpan({ cls: "oneday-dialog-icon", attr: { "aria-hidden": "true" } }), "sparkles")
  const input = inputRow.createEl("textarea", {
    cls: "oneday-dialog-input",
    attr: { placeholder: t("quickRecordPlaceholder"), rows: "1", "aria-label": t("quickRecord") },
  }) as unknown as HTMLInputElement
  const ta = input as unknown as HTMLTextAreaElement
  const fitInput = (): void => {
    ta.style.height = "0px"
    ta.style.height = `${Math.max(32, ta.scrollHeight)}px` // 最小高度兜底（yyt：输入框扁了）
  }
  ta.addEventListener("input", fitInput)
  domWindow?.setTimeout(fitInput, 0)
  // loading 内联在输入行右侧（yyt：不占单独一行）
  const loading = inputRow.createEl("span", { cls: "oneday-dialog-loading", text: t("generating") })
  loading.setAttr("aria-hidden", "true")
  loading.style.display = "none"
  const status = box.createDiv({ cls: "oneday-dialog-status" })
  status.setAttrs({ role: "status", "aria-live": "polite" })

  // 多轮会话历史：追问的回答带着上文（yyt 2026-08-19）
  const history: Array<{ role: "user" | "assistant"; content: string }> = []
  let busy = false
  const submit = async (): Promise<void> => {
    const text = ta.value.trim()
    if (text === "" || busy) return
    busy = true
    box.setAttr("aria-busy", "true")
    ta.disabled = true
    loading.style.display = ""
    loading.setAttr("aria-hidden", "false")
    status.setText("")
    status.removeClass("oneday-dialog-error")

    const systemPrompt = buildSystemPrompt({
      typeColors: deps.settings.spanTypeColors,
      now: new Date(),
      doc,
    })
    history.push({ role: "user", content: text })
    const run = deps.settings.dialogBackend === "claude-cli"
      ? await runEntryAgent(text, systemPrompt)
      : await runEntryAgentApi(
          text,
          systemPrompt,
          {
            provider: deps.settings.provider,
            apiKey: deps.settings.apiKey,
            baseUrl: deps.settings.baseUrl,
            model: deps.settings.model,
          },
          obsidianTransport,
          history.slice(0, -1)
        )

    if (!run.ok) {
      loading.style.display = "none"
      loading.setAttr("aria-hidden", "true")
      status.setText(run.reason)
      status.addClass("oneday-dialog-error")
      busy = false
      box.setAttr("aria-busy", "false")
      ta.disabled = false
      return
    }

    const result = interpretActions(run.text, doc, text)
    if (!result.ok) {
      loading.style.display = "none"
      loading.setAttr("aria-hidden", "true")
      history.push({ role: "assistant", content: run.text }) // 追问留在历史里
      status.setText(result.reason)
      status.addClass("oneday-dialog-error")
      busy = false
      box.setAttr("aria-busy", "false")
      ta.disabled = false
      ta.value = ""
      fitInput()
      ta.placeholder = t("answerFollowup")
      return
    }
    // 成功：本轮任务完成，重置会话
    history.length = 0
    ta.placeholder = t("quickRecordPlaceholder")

    loading.style.display = "none"
    loading.setAttr("aria-hidden", "true")
    try {
      await deps.writeActions(result.actions)
      ta.value = ""
      fitInput()
      const rawCost = "costUsd" in run ? run.costUsd : undefined
      const locale = currentLocale()
      const cost = typeof rawCost === "number"
        ? locale === "zh" ? `（$${rawCost.toFixed(4)}）` : ` ($${rawCost.toFixed(4)})`
        : ""
      const kinds = { create: 0, update: 0, delete: 0 }
      for (const a of result.actions) kinds[a.kind]++
      const parts = [
        kinds.create && t("actionCreate", { count: kinds.create }),
        kinds.update && t("actionUpdate", { count: kinds.update }),
        kinds.delete && t("actionDelete", { count: kinds.delete }),
      ].filter((part): part is string => typeof part === "string")
      status.setText(t("actionsSaved", { actions: parts.join(locale === "zh" ? "、" : ", "), cost }))
    } catch (error) {
      status.setText(t("writeFailed", { reason: error instanceof Error ? error.message : String(error) }))
      status.addClass("oneday-dialog-error")
    }
    busy = false
    box.setAttr("aria-busy", "false")
    ta.disabled = false
  }

  ta.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  })
}
