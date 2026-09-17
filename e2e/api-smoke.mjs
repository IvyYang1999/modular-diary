/**
 * M2 (API backend) full-loop smoke with a stub transport:
 * runEntryAgentApi -> interpretResponse -> insertEntryLine -> re-parse.
 */
import esbuild from "esbuild"
import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"
import os from "node:os"

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(os.tmpdir(), "modular-diary-api-smoke")
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })

fs.writeFileSync(path.join(out, "entry.ts"), `
export { runEntryAgentApi } from "${path.join(here, "../src/agent/direct-runner")}"
export { buildSystemPrompt } from "${path.join(here, "../src/agent/prompt")}"
export { parseTimeline } from "${path.join(here, "../src/core/parser")}"
export { interpretResponse } from "${path.join(here, "../src/agent/response")}"
export { insertEntryLine } from "${path.join(here, "../src/edit/source-rewriter")}"
`)
await esbuild.build({
  entryPoints: [path.join(out, "entry.ts")],
  bundle: true, format: "cjs", platform: "node",
  outfile: path.join(out, "lib.cjs"), logLevel: "silent",
  external: ["obsidian", "electron", "node:*"],
})
const lib = await import(path.join(out, "lib.cjs"))

let captured = null
const stubHttp = async (req) => {
  captured = req
  return {
    status: 200,
    json: { choices: [{ message: { content: '{"start":"21:05","end":"21:35","type":"fitness","note":"健身"}' } }] },
  }
}

const source = "range: 7-23\n---\n09:15-12:15 math 李林线代\n"
const doc = lib.parseTimeline(source)
const system = lib.buildSystemPrompt({ typeColors: { math: "#7fd4c1", fitness: "#f6c667" }, now: new Date(), doc })

const run = await lib.runEntryAgentApi("我刚刚花了半小时健身", system, {
  provider: "openai-compatible", apiKey: "sk-test", baseUrl: "https://example.com/v4", model: "glm-4.5-air",
}, stubHttp)
if (!run.ok) { console.error("api runner failed:", run.reason); process.exit(1) }

const sent = JSON.parse(captured.body)
if (captured.url !== "https://example.com/v4/chat/completions" || !sent.messages[0].content.includes("HH:MM")) {
  console.error("bad request", captured.url); process.exit(1)
}

const result = lib.interpretResponse(run.text, doc)
if (!result.ok) { console.error("INVALID:", result.reason); process.exit(1) }
const newSource = lib.insertEntryLine(source, result.entry.sourceLine, result.entry.startMin)
if (lib.parseTimeline(newSource).errors.length > 0) { console.error("re-parse failed"); process.exit(1) }
if (!newSource.includes("21:05-21:35 fitness 健身")) { console.error("rewrite mismatch:\n" + newSource); process.exit(1) }

// error paths
const noKey = await lib.runEntryAgentApi("x", system, { provider: "openai-compatible", apiKey: "", baseUrl: "u", model: "m" }, stubHttp)
if (noKey.ok || !noKey.reason.includes("API Key")) { console.error("missing-key check failed"); process.exit(1) }
const errHttp = await lib.runEntryAgentApi("x", system, { provider: "openai-compatible", apiKey: "k", baseUrl: "u", model: "m" },
  async () => ({ status: 401, json: { error: { message: "invalid key" } } }))
if (errHttp.ok || !errHttp.reason.includes("401")) { console.error("http-error check failed"); process.exit(1) }

console.log("OK api smoke passed (stub transport)")
