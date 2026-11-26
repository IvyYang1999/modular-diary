/**
 * Single-turn headless claude CLI runner for the dialog (D7 裁剪版 swob
 * 模式：不维护 resume、不要工具权限、JSON 出结构化条目).
 */
import { resolveClaudeBinary } from "./cli-resolver"
import { nodeChildProcess } from "./node"
import { t } from "../i18n"

export type AgentRunResult =
  | { ok: true; text: string; costUsd?: number }
  | { ok: false; reason: string }

const TIMEOUT_MS = 60_000

export interface RunOptions {
  /** Override CLI path (settings / tests). */
  binaryPath?: string
}

export async function runEntryAgent(userText: string, systemPrompt: string, opts: RunOptions = {}): Promise<AgentRunResult> {
  const binary = opts.binaryPath ?? (await resolveClaudeBinary())
  if (!binary) {
    return { ok: false, reason: t("missingClaudeCli") }
  }

  return new Promise((resolve) => {
    let child
    try {
      child = nodeChildProcess().spawn(
        binary,
        ["-p", userText, "--output-format", "json", "--append-system-prompt", systemPrompt],
        { stdio: ["ignore", "pipe", "pipe"] }
      )
    } catch (error) {
      resolve({ ok: false, reason: t("launchFailed", { reason: error instanceof Error ? error.message : String(error) }) })
      return
    }

    let stdout = ""
    let stderrTail = ""
    child.stdout.setEncoding("utf-8")
    child.stdout.on("data", (c: string) => (stdout += c))
    child.stderr.setEncoding("utf-8")
    child.stderr.on("data", (c: string) => (stderrTail = (stderrTail + c).slice(-2000)))

    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM")
      } catch {
        /* already gone */
      }
      resolve({ ok: false, reason: t("generationTimeout") })
    }, TIMEOUT_MS)

    child.on("error", (error) => {
      clearTimeout(timer)
      resolve({ ok: false, reason: t("processError", { reason: error.message }) })
    })

    child.on("close", (code) => {
      clearTimeout(timer)
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(stdout)
      } catch {
        resolve({ ok: false, reason: t("cliParseFailed", { code: code ?? "?", detail: stderrTail.trim().slice(-300) }) })
        return
      }
      if (parsed.is_error === true || code !== 0) {
        const msg = typeof parsed.result === "string" ? parsed.result : stderrTail.trim().slice(-300)
        resolve({ ok: false, reason: t("generationFailed", { reason: msg }) })
        return
      }
      const text = typeof parsed.result === "string" ? parsed.result : ""
      const costUsd = typeof parsed.total_cost_usd === "number" ? parsed.total_cost_usd : undefined
      resolve({ ok: true, text, costUsd })
    })
  })
}
