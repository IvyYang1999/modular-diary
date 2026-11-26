/**
 * Lazy access to Node built-ins. The bundle must not `require("node:…")` at module
 * scope: Obsidian mobile has no Node, that require throws, and the whole plugin
 * fails to load. Only the desktop Claude Code CLI path calls these, inside functions.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- Defer Node built-ins until the desktop-only CLI path runs, so mobile can load the plugin. */
export const nodeChildProcess = (): typeof import("node:child_process") => require("node:child_process") as typeof import("node:child_process")
export const nodeFs = (): typeof import("node:fs") => require("node:fs") as typeof import("node:fs")
export const nodeOs = (): typeof import("node:os") => require("node:os") as typeof import("node:os")
export const nodePath = (): typeof import("node:path") => require("node:path") as typeof import("node:path")
/* eslint-enable @typescript-eslint/no-require-imports -- Restore the rule after the lazy Node helpers. */
