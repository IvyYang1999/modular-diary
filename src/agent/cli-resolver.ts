/**
 * Locate the user's installed Claude Code CLI (ported from swob
 * claude-session-manager/src/main/agent-runner.ts, 2026-08-16).
 */
import { nodeChildProcess, nodeFs, nodeOs, nodePath } from "./node"

/** Built lazily: Node is only there on desktop. */
const cliCandidates = (): string[] => [
  nodePath().join(nodeOs().homedir(), ".local", "bin", "claude"),
  "/opt/homebrew/bin/claude",
  "/usr/local/bin/claude",
]

let cached: string | null | undefined

export function resolveClaudeBinary(): Promise<string | null> {
  if (cached !== undefined) return Promise.resolve(cached)
  const fs = nodeFs()
  for (const candidate of cliCandidates()) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      cached = candidate
      return Promise.resolve(candidate)
    } catch {
      /* try next */
    }
  }
  return new Promise((resolve) => {
    nodeChildProcess().execFile("/bin/zsh", ["-lc", "command -v claude"], { timeout: 5000 }, (error, stdout) => {
      const found = !error && stdout.trim() ? stdout.trim().split("\n")[0] : null
      cached = found
      resolve(found)
    })
  })
}

/** For tests / settings override. */
export function resetClaudeBinaryCache(): void {
  cached = undefined
}
