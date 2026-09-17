/**
 * End-to-end smoke of the M2 dialog loop (minus Obsidian UI), with a stub
 * claude CLI emitting a canned --output-format json payload. Verifies:
 * spawn -> parse -> interpretResponse validation -> insertEntryLine write-back.
 * (Real-CLI smoke is blocked by the local proxy 403; credentials are 人做的事.)
 */
import esbuild from "esbuild"
import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"
import os from "node:os"

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(os.tmpdir(), "modular-diary-agent-smoke")
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })

// Stub claude CLI: prints a canned result payload regardless of args.
const stub = path.join(out, "claude-stub")
fs.writeFileSync(stub, `#!/bin/sh
cat <<'JSON'
{"type":"result","subtype":"success","is_error":false,"result":"{\\"start\\":\\"21:05\\",\\"end\\":\\"21:35\\",\\"type\\":\\"fitness\\",\\"note\\":\\"健身\\"}","total_cost_usd":0.003}
JSON
`)
fs.chmodSync(stub, 0o755)

fs.writeFileSync(path.join(out, "entry.ts"), `
export { runEntryAgent } from "${path.join(here, "../src/agent/runner")}"
export { buildSystemPrompt } from "${path.join(here, "../src/agent/prompt")}"
export { parseTimeline } from "${path.join(here, "../src/core/parser")}"
export { interpretResponse } from "${path.join(here, "../src/agent/response")}"
export { insertEntryLine } from "${path.join(here, "../src/edit/source-rewriter")}"
export const DEFAULTS = { math: "#7fd4c1", fitness: "#f6c667", misc: "#bdbdbd" }
`)
await esbuild.build({
  entryPoints: [path.join(out, "entry.ts")],
  bundle: true, format: "cjs", platform: "node",
  outfile: path.join(out, "lib.cjs"), logLevel: "silent",
  external: ["obsidian", "electron", "node:*"],
})
const lib = await import(path.join(out, "lib.cjs"))

const source = "range: 7-23\n---\n09:15-12:15 math 李林线代\n"
const doc = lib.parseTimeline(source)
const system = lib.buildSystemPrompt({ typeColors: lib.DEFAULTS, now: new Date(), doc })

const run = await lib.runEntryAgent("我刚刚花了半小时健身", system, { binaryPath: stub })
if (!run.ok) { console.error("runner failed:", run.reason); process.exit(1) }
console.log("runner ok, cost:", run.costUsd)

const result = lib.interpretResponse(run.text, doc)
if (!result.ok) { console.error("INVALID:", result.reason); process.exit(1) }
console.log("validated:", result.entry.sourceLine)

const newSource = lib.insertEntryLine(source, result.entry.sourceLine, result.entry.startMin)
const expected = "range: 7-23\n---\n09:15-12:15 math 李林线代\n21:05-21:35 fitness 健身\n"
if (newSource !== expected) { console.error("rewrite mismatch:\n" + newSource); process.exit(1) }
const recheck = lib.parseTimeline(newSource)
if (recheck.errors.length > 0) { console.error("re-parse errors:", recheck.errors); process.exit(1) }
console.log("OK agent smoke passed (stub CLI)")
