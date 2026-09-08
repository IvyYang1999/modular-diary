import esbuild from "esbuild"
import { chromium } from "playwright"
import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"
import os from "node:os"

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(os.tmpdir(), "oneday-source-mode-smoke")
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })

fs.writeFileSync(path.join(out, "entry.ts"), `
import { parseTimeline } from "${path.join(here, "../src/core/parser")}" 
import { configureI18n } from "${path.join(here, "../src/i18n")}" 
import { mountSourceMode, sourceDraftCanApply } from "${path.join(here, "../src/edit/source-mode")}" 

configureI18n(() => "zh")
const container = document.querySelector<HTMLElement>(".oneday-container")!
window.__events = []
window.__mount = (source = "date: 2026-08-24\\n---\\n09:00-10:00 develop 写代码") => mountSourceMode(container, source, {
  validate: (draft) => sourceDraftCanApply(draft, parseTimeline),
  onDraftChange: (draft) => window.__events.push("draft:" + draft),
  onApply: async (draft) => { window.__events.push("apply:" + draft) },
  onCancel: () => window.__events.push("cancel"),
})
window.__mount()
`)

await esbuild.build({
  entryPoints: [path.join(out, "entry.ts")],
  bundle: true,
  format: "iife",
  outfile: path.join(out, "bundle.js"),
  logLevel: "silent",
})

const css = fs.readFileSync(path.join(here, "../styles.css"), "utf8")
fs.writeFileSync(path.join(out, "index.html"), `<!doctype html><html><head><style>${css}</style></head><body><main class="oneday-container"><div class="oneday-block-scroll underlay">visual timeline underlay</div></main><script>${fs.readFileSync(path.join(out, "bundle.js"), "utf8")}</script></body></html>`)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 920, height: 620 }, deviceScaleFactor: 1 })
page.on("pageerror", (error) => { console.error("pageerror:", error.message); process.exitCode = 1 })
await page.goto("file://" + path.join(out, "index.html"))
await page.evaluate(() => {
  const root = document.documentElement.style
  root.setProperty("--background-primary", "#1e1e1e")
  root.setProperty("--background-secondary", "#252525")
  root.setProperty("--background-modifier-border", "#3d3d3d")
  root.setProperty("--interactive-accent", "#8b5cf6")
  root.setProperty("--text-normal", "#dddddd")
  root.setProperty("--text-muted", "#a5a5a5")
  root.setProperty("--text-faint", "#777777")
  root.setProperty("--text-error", "#ff6b6b")
  root.setProperty("--text-on-accent", "#ffffff")
  root.setProperty("--button-radius", "7px")
  document.body.style.background = "#171717"
  const container = document.querySelector(".oneday-container")
  container.style.width = "720px"
  container.style.height = "420px"
  container.style.margin = "60px auto"
})
await page.waitForTimeout(50)

const initial = await page.evaluate(() => {
  const container = document.querySelector(".oneday-container")
  const overlay = document.querySelector(".oneday-source-mode")
  const textarea = document.querySelector(".oneday-source-textarea")
  const c = container.getBoundingClientRect()
  const o = overlay.getBoundingClientRect()
  return {
    fences: [...document.querySelectorAll(".oneday-source-fence")].map((node) => node.textContent),
    value: textarea.value,
    focused: document.activeElement === textarea,
    fullWidth: Math.abs((c.width - 8) - o.width) <= 1,
    topAnchored: Math.abs(o.top - (c.top + 4)) <= 1,
    // A three-line draft is content-sized: the 320px floor, not the block.
    floorHeight: Math.abs(o.height - 320) <= 1 && o.height < c.height - 8,
    textareaScrolls: textarea.scrollHeight > textarea.clientHeight + 1,
    underlayCovered: getComputedStyle(overlay).backgroundColor !== "rgba(0, 0, 0, 0)",
    underlayInert: getComputedStyle(container.querySelector(".oneday-block-scroll")).pointerEvents === "none",
  }
})
if (JSON.stringify(initial.fences) !== JSON.stringify(["```timeline", "```"]) || !initial.value.includes("09:00-10:00") || !initial.focused || !initial.fullWidth || !initial.topAnchored || !initial.floorHeight || initial.textareaScrolls || !initial.underlayCovered || !initial.underlayInert) {
  console.error("source mode plane is not top-anchored and content-sized", initial); process.exit(1)
}
await page.screenshot({ path: path.join(out, "source-mode-dark.png") })

// A long draft grows the plane up to the block height, then scrolls inside
// the editor instead of pushing the footer out of the block.
const longDraft = await page.evaluate(() => {
  const textarea = document.querySelector(".oneday-source-textarea")
  const lines = Array.from({ length: 40 }, (_, index) => `${String(9 + Math.floor(index / 4)).padStart(2, "0")}:${String((index % 4) * 15).padStart(2, "0")}-${String(9 + Math.floor((index + 1) / 4)).padStart(2, "0")}:${String(((index + 1) % 4) * 15).padStart(2, "0")} develop 第${index + 1}行`)
  textarea.value = "date: 2026-08-24\n---\n" + lines.join("\n")
  textarea.dispatchEvent(new Event("input", { bubbles: true }))
  const container = document.querySelector(".oneday-container")
  const overlay = document.querySelector(".oneday-source-mode")
  const footer = document.querySelector(".oneday-source-footer")
  const c = container.getBoundingClientRect()
  const o = overlay.getBoundingClientRect()
  return {
    fillsBlock: Math.abs((c.height - 8) - o.height) <= 1,
    footerInside: footer.getBoundingClientRect().bottom <= o.bottom + 0.5,
    textareaScrolls: textarea.scrollHeight > textarea.clientHeight + 1,
    overlayScrolls: overlay.scrollHeight > overlay.clientHeight + 1,
  }
})
if (!longDraft.fillsBlock || !longDraft.footerInside || !longDraft.textareaScrolls || longDraft.overlayScrolls) {
  console.error("long source draft did not stay inside the block with an internal scroller", longDraft); process.exit(1)
}

await page.evaluate(() => {
  const textarea = document.querySelector(".oneday-source-textarea")
  textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, isComposing: true, bubbles: true }))
})
if ((await page.evaluate(() => window.__events)).some((event) => event.startsWith("apply:"))) {
  console.error("IME composing Enter applied source mode"); process.exit(1)
}

await page.locator(".oneday-source-textarea").fill("date: 2026/08/24\n---\n09:00-10:00 develop")
const invalid = await page.evaluate(() => ({
  disabled: document.querySelector(".oneday-source-apply").disabled,
  invalid: document.querySelector(".oneday-source-textarea").getAttribute("aria-invalid"),
  feedback: document.querySelector(".oneday-source-feedback").textContent,
}))
if (!invalid.disabled || invalid.invalid !== "true" || !invalid.feedback.includes("第 1 行")) {
  console.error("invalid source was not kept in the editor", invalid); process.exit(1)
}

const corrected = "date: 2026-08-24\n---\n09:00-10:30 develop 修复源码模式"
await page.locator(".oneday-source-textarea").fill(corrected)
await page.locator(".oneday-source-textarea").press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter")
await page.waitForFunction(() => !document.querySelector(".oneday-source-mode"))
const applied = await page.evaluate(() => window.__events.filter((event) => event.startsWith("apply:")))
if (applied.length !== 1 || applied[0] !== "apply:" + corrected) {
  console.error("source apply did not produce one complete transaction intent", applied); process.exit(1)
}

await page.evaluate(() => window.__mount("range: 7-23\n---\n10:00-11:00 reading"))
await page.locator(".oneday-source-textarea").press("Escape")
const cancelled = await page.evaluate(() => ({
  overlay: Boolean(document.querySelector(".oneday-source-mode")),
  count: window.__events.filter((event) => event === "cancel").length,
}))
if (cancelled.overlay || cancelled.count !== 1) {
  console.error("source cancel did not return to the visual block", cancelled); process.exit(1)
}

await browser.close()
console.log("source mode contract passed; screenshot:", path.join(out, "source-mode-dark.png"))
