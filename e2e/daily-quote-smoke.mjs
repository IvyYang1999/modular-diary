/** Product contracts for the Daily Quote element block and its shared settings editor. */
import esbuild from "esbuild"
import { chromium } from "playwright"
import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"
import os from "node:os"

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(os.tmpdir(), "oneday-daily-quote-smoke")
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })

fs.writeFileSync(path.join(out, "obsidian-stub.ts"), `
export function setIcon(el: HTMLElement, name: string): void {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.dataset.icon = name
  svg.setAttribute("viewBox", "0 0 24 24")
  el.appendChild(svg)
}
`)

fs.writeFileSync(path.join(out, "entry.ts"), `
import { renderDailyQuoteInto } from "${path.join(here, "../src/render/daily-quote-view")}" 
import { renderDailyQuoteSettings } from "${path.join(here, "../src/daily-quote-settings")}" 
import { applyDailyQuoteAppearanceToCurrentAndFuture, applyDailyQuoteTheme } from "${path.join(here, "../src/core/daily-quotes")}" 
import { configureI18n } from "${path.join(here, "../src/i18n")}" 

HTMLElement.prototype.empty = function () { this.replaceChildren() }
HTMLElement.prototype.createDiv = function (opts: any = {}) {
  const el = document.createElement("div")
  if (opts.cls) el.className = opts.cls
  if (opts.text !== undefined) el.textContent = opts.text
  if (opts.attr) for (const [key, value] of Object.entries(opts.attr)) el.setAttribute(key, String(value))
  this.appendChild(el); return el
}
HTMLElement.prototype.createSpan = function (opts: any = {}) {
  const el = document.createElement("span")
  if (opts.cls) el.className = opts.cls
  if (opts.text !== undefined) el.textContent = opts.text
  if (opts.attr) for (const [key, value] of Object.entries(opts.attr)) el.setAttribute(key, String(value))
  this.appendChild(el); return el
}
HTMLElement.prototype.createEl = function (tag: string, opts: any = {}) {
  const el = document.createElement(tag)
  if (opts.cls) el.className = opts.cls
  if (opts.text !== undefined) el.textContent = opts.text
  if (opts.attr) for (const [key, value] of Object.entries(opts.attr)) el.setAttribute(key, String(value))
  this.appendChild(el); return el
}

configureI18n(() => "zh")
window.__events = []
window.__quoteEventLeaks = []
window.__saves = 0
window.__failNextSave = false
window.__appearanceChanges = []
const quote = { id: "one", text: "我们先塑造习惯，然后习惯塑造我们。", author: "John Dryden", order: 0 }
const quoteTwo = { id: "two", text: "今天也要留一点时间给自己。", author: "", order: 1 }
const quotes = [quote, quoteTwo]
const appearance = applyDailyQuoteTheme("paper")
const populated = document.querySelector<HTMLElement>("#populated")!
const quoteScrollHost = document.querySelector<HTMLElement>("#quote-scroll-host")!
window.__quoteScrollHost = quoteScrollHost
window.__quoteSpacer = quoteScrollHost.querySelector(".quote-scroll-spacer")
let quoteIndex = 0
const paintPopulatedQuote = () => renderDailyQuoteInto(populated, quotes[quoteIndex], appearance, {
  onNext: () => {
    window.__events.push("next")
    quoteIndex = (quoteIndex + 1) % quotes.length
    paintPopulatedQuote()
  },
  onEdit: () => window.__events.push("edit"),
  resolveBackgroundImage: (value) => value === "assets/quote.jpg" ? "app://local/quote.jpg" : value,
})
paintPopulatedQuote()
for (const type of ["pointerdown", "mousedown", "click", "keydown"]) {
  quoteScrollHost.addEventListener(type, (event) => {
    if (!(event.target as Element).closest(".oneday-daily-quote-card")) return
    window.__quoteEventLeaks.push(type)
    quoteScrollHost.scrollTop = 0
  })
}
const empty = document.querySelector<HTMLElement>("#empty")!
renderDailyQuoteInto(empty, null, applyDailyQuoteTheme("timeline"), {
  onNext: () => window.__events.push("unexpected-next"),
  onEdit: () => window.__events.push("empty-edit"),
})
const settings = {
  dailyQuotes: quotes,
  dailyQuoteDefaults: appearance,
}
const host = {
  settings,
  saveSettings: async () => {
    window.__saves += 1
    if (window.__failNextSave) { window.__failNextSave = false; throw new Error("fixture save failure") }
  },
  resolveDailyQuoteBackgroundImage: (value: string) => value.startsWith(".oneday/assets/")
    ? "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    : value,
  importDailyQuoteBackgroundImage: async () => ".oneday/assets/daily-quotes/imported.png",
  listDailyQuoteBackgroundImages: () => [{ path: ".oneday/assets/daily-quotes/imported.png", name: "imported" }],
}
const settingsOptions = {
  appearance,
  previewQuote: quote,
  scope: "block-and-defaults",
  onApply: async (value) => applyDailyQuoteAppearanceToCurrentAndFuture(
    settings,
    value,
    (next) => { window.__appearanceChanges.push(next) },
    () => host.saveSettings()
  ),
  onCancel: () => window.__events.push("cancel-settings"),
} as const
window.__quoteSettings = settings
window.__renderQuoteSettings = () => renderDailyQuoteSettings(document.querySelector<HTMLElement>("#settings")!, host as any, settingsOptions)
window.__renderQuoteSettings()
`)

await esbuild.build({
  entryPoints: [path.join(out, "entry.ts")],
  bundle: true,
  format: "iife",
  outfile: path.join(out, "bundle.js"),
  logLevel: "silent",
  plugins: [{ name: "obsidian-stub", setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: path.join(out, "obsidian-stub.ts") }))
  } }],
})

fs.copyFileSync(path.join(here, "../styles.css"), path.join(out, "styles.css"))
fs.writeFileSync(path.join(out, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="styles.css"><style>
#fixture{display:grid;gap:24px;max-width:980px;margin:24px auto}#quote-scroll-host{height:210px;overflow:auto}.quote-scroll-spacer{height:40px}.oneday-slot-quote{position:relative!important;inset:auto!important;width:auto!important;height:190px!important;padding:16px!important}#settings{position:relative;padding:16px;border:1px solid var(--background-modifier-border);border-radius:10px}
</style></head><body>
<main id="fixture">
  <div id="quote-scroll-host"><div class="quote-scroll-spacer"></div><section id="populated" class="oneday-slot oneday-slot-quote"></section></div>
  <section id="empty" class="oneday-slot oneday-slot-quote"></section>
  <section id="settings" class="oneday-settings-modal oneday-focused-settings"></section>
</main><script src="bundle.js"></script></body></html>`)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1080, height: 980 }, deviceScaleFactor: 1 })
page.on("pageerror", (error) => console.error("DAILY QUOTE PAGE ERROR", error))
await page.goto("file://" + path.join(out, "index.html"))
await page.evaluate(() => {
  const root = document.documentElement.style
  root.setProperty("--background-primary", "#ffffff")
  root.setProperty("--background-secondary", "#f2f2f2")
  root.setProperty("--background-modifier-border", "#d9d9d9")
  root.setProperty("--background-modifier-hover", "#ececec")
  root.setProperty("--background-modifier-form-field", "#ffffff")
  root.setProperty("--interactive-accent", "#9567e8")
  root.setProperty("--text-normal", "#252525")
  root.setProperty("--text-muted", "#707070")
  root.setProperty("--text-faint", "#999999")
  root.setProperty("--button-radius", "7px")
})

const populated = page.locator("#populated")
const empty = page.locator("#empty")
await page.locator("#quote-scroll-host").evaluate((host) => { host.scrollTop = host.scrollHeight - host.clientHeight })
const quoteScrollBeforeClick = await page.locator("#quote-scroll-host").evaluate((host) => host.scrollTop)
await populated.locator(".oneday-daily-quote-card").click()
const quoteScrollAfterClick = await page.locator("#quote-scroll-host").evaluate((host) => host.scrollTop)
await populated.locator(".oneday-daily-quote-card").focus()
await populated.locator(".oneday-daily-quote-card").press("Enter")
const quoteScrollAfterKeyboard = await page.locator("#quote-scroll-host").evaluate((host) => host.scrollTop)
await populated.locator(".oneday-component-icon-button").click()
await empty.locator(".oneday-daily-quote-empty").click()
const themeButtons = page.locator("#settings .oneday-quote-theme-grid button")
await themeButtons.filter({ hasText: "午夜" }).click()
await page.evaluate(() => {
  window.__fontSizeRange = document.querySelector("#settings .oneday-quote-setting-field.is-font-size input[type=range]")
})
await page.locator("#settings .oneday-quote-setting-field.is-font-size input[type=range]").evaluate((input) => {
  input.value = "31"
  input.dispatchEvent(new Event("input", { bubbles: true }))
})
const liveFontSize = await page.evaluate(() => ({
  preview: document.querySelector("#settings .oneday-daily-quote-card")?.style.getPropertyValue("--oneday-quote-font-size") ?? "",
  output: document.querySelector("#settings .oneday-quote-setting-field.is-font-size output")?.textContent ?? "",
  stable: window.__fontSizeRange === document.querySelector("#settings .oneday-quote-setting-field.is-font-size input[type=range]") && window.__fontSizeRange?.isConnected,
}))
const changesBeforeApply = await page.evaluate(() => window.__appearanceChanges.length)
await page.locator("#settings button", { hasText: "应用并设为新卡片默认" }).click()
await page.locator("#settings button[role=tab]", { hasText: "句库" }).click()
await page.locator("#settings .oneday-quote-add").click()
const savesBeforeQuote = await page.evaluate(() => window.__saves)
await page.locator("#settings .oneday-quote-composer textarea").fill("新句子")
await page.locator("#settings .oneday-quote-composer input[type=text]").fill("出处")
await page.locator("#settings .oneday-quote-composer button", { hasText: "保存句子" }).click()
const quoteRowsAfterSave = await page.locator("#settings .oneday-quote-library-row").count()
const quoteOrderBeforeDrag = await page.locator("#settings .oneday-quote-library-row").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-quote-id")))
const savesBeforeCancelledDrag = await page.evaluate(() => window.__saves)
const firstGrip = page.locator("#settings .oneday-quote-library-grip").first()
const lastRow = page.locator("#settings .oneday-quote-library-row").last()
const firstGripBox = await firstGrip.boundingBox()
const lastRowBox = await lastRow.boundingBox()
if (firstGripBox && lastRowBox) {
  await page.mouse.move(firstGripBox.x + firstGripBox.width / 2, firstGripBox.y + firstGripBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(firstGripBox.x + firstGripBox.width / 2, lastRowBox.y + lastRowBox.height + 4, { steps: 5 })
  await page.keyboard.press("Escape")
  await page.mouse.up()
}
const quoteOrderAfterCancel = await page.locator("#settings .oneday-quote-library-row").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-quote-id")))
const savesAfterCancelledDrag = await page.evaluate(() => window.__saves)
const dragGripBox = await page.locator("#settings .oneday-quote-library-grip").first().boundingBox()
const dragTargetBox = await page.locator("#settings .oneday-quote-library-row").last().boundingBox()
if (dragGripBox && dragTargetBox) {
  await page.mouse.move(dragGripBox.x + dragGripBox.width / 2, dragGripBox.y + dragGripBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(dragGripBox.x + dragGripBox.width / 2, dragTargetBox.y + dragTargetBox.height + 4, { steps: 6 })
  await page.mouse.up()
}
const quoteOrderAfterDrag = await page.locator("#settings .oneday-quote-library-row").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-quote-id")))
const persistedQuoteOrder = await page.evaluate(() => window.__quoteSettings.dailyQuotes.map((quote) => quote.id))
const savesAfterDrag = await page.evaluate(() => window.__saves)
await page.evaluate(() => window.__renderQuoteSettings())
await page.locator("#settings button[role=tab]", { hasText: "句库" }).click()
const quoteOrderAfterReload = await page.locator("#settings .oneday-quote-library-row").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-quote-id")))
await page.locator("#settings .oneday-quote-library-row").nth(1).hover()
await page.locator("#settings").screenshot({ path: path.join(out, "daily-quote-library.png") })
await page.evaluate(() => { window.__failNextSave = true })
const failedGripBox = await page.locator("#settings .oneday-quote-library-grip").first().boundingBox()
const failedTargetBox = await page.locator("#settings .oneday-quote-library-row").last().boundingBox()
if (failedGripBox && failedTargetBox) {
  await page.mouse.move(failedGripBox.x + failedGripBox.width / 2, failedGripBox.y + failedGripBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(failedGripBox.x + failedGripBox.width / 2, failedTargetBox.y + failedTargetBox.height + 4, { steps: 6 })
  await page.mouse.up()
}
await page.waitForTimeout(20)
const quoteOrderAfterFailedSave = await page.locator("#settings .oneday-quote-library-row").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-quote-id")))
const settingsOrderAfterFailedSave = await page.evaluate(() => window.__quoteSettings.dailyQuotes.map((quote) => quote.id))
const savesAfterFailedDrag = await page.evaluate(() => window.__saves)
await page.locator("#settings button[role=tab]", { hasText: "卡片设计" }).click()
await page.locator("#settings .oneday-quote-file-input").setInputFiles({
  name: "cover.png",
  mimeType: "image/png",
  buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
})
await page.locator("#settings button", { hasText: "调整取景" }).click()
await page.evaluate(() => {
  window.__cropCard = document.querySelector("#settings .oneday-daily-quote-card.is-cropping")
  window.__cropRange = document.querySelector("#settings .oneday-quote-crop-actions input[type=range]")
  window.__cropStart = window.__cropCard?.querySelector(".oneday-daily-quote-media img")?.style.objectPosition ?? ""
})
const cropBox = await page.locator("#settings .oneday-daily-quote-card.is-cropping").boundingBox()
if (cropBox) {
  await page.mouse.move(cropBox.x + cropBox.width / 2, cropBox.y + cropBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(cropBox.x + cropBox.width / 2 + 24, cropBox.y + cropBox.height / 2 + 12, { steps: 4 })
  await page.mouse.up()
}
await page.locator("#settings .oneday-quote-crop-actions input[type=range]").evaluate((input) => {
  input.value = "1.5"
  input.dispatchEvent(new Event("input", { bubbles: true }))
})

const state = await page.evaluate(() => {
  const card = document.querySelector("#populated .oneday-daily-quote-card")
  const blockquote = card.querySelector("blockquote")
  const caption = card.querySelector("figcaption")
  const emptyAction = document.querySelector("#empty .oneday-daily-quote-empty")
  const emptyStyle = getComputedStyle(emptyAction)
  const selectedThemes = [...document.querySelectorAll("#settings .oneday-quote-theme-grid button")]
    .filter((button) => button.getAttribute("aria-checked") === "true")
    .map((button) => button.dataset.theme)
  const editButton = document.querySelector("#populated .oneday-component-icon-button")
  const editIcon = editButton.querySelector("svg")
  return {
    editButtonHeight: editButton.getBoundingClientRect().height,
    editIconSize: [editIcon.getBoundingClientRect().width, editIcon.getBoundingClientRect().height],
    events: window.__events,
    quoteEventLeaks: window.__quoteEventLeaks,
    saves: window.__saves,
    changes: window.__appearanceChanges,
    futureCardDefault: window.__quoteSettings.dailyQuoteDefaults,
    quoteText: blockquote?.textContent ?? "",
    author: caption?.textContent ?? "",
    semantics: [card?.tagName, blockquote?.tagName, caption?.tagName],
    emptyText: emptyAction?.textContent ?? "",
    emptyBorderStyle: emptyStyle.borderStyle,
    emptyBackground: emptyStyle.backgroundColor,
    selectedThemes,
    cropVisible: Boolean(document.querySelector("#settings .oneday-daily-quote-card.is-cropping")),
    importedImage: Boolean(document.querySelector("#settings .oneday-quote-media-thumb img")),
    cropCardStable: window.__cropCard === document.querySelector("#settings .oneday-daily-quote-card.is-cropping") && window.__cropCard?.isConnected,
    cropRangeStable: window.__cropRange === document.querySelector("#settings .oneday-quote-crop-actions input[type=range]") && window.__cropRange?.isConnected,
    cropPositionChanged: window.__cropStart !== document.querySelector("#settings .oneday-daily-quote-media img")?.style.objectPosition,
    cropZoom: document.querySelector("#settings .oneday-daily-quote-media img")?.style.transform ?? "",
    settingsWidth: document.querySelector("#settings")?.getBoundingClientRect().width ?? 0,
    statusIsLast: document.querySelector("#settings")?.lastElementChild?.classList.contains("oneday-quote-settings-status") ?? false,
    slotLocalShellStable: window.__quoteScrollHost === document.querySelector("#quote-scroll-host")
      && window.__quoteSpacer === document.querySelector("#quote-scroll-host .quote-scroll-spacer")
      && window.__quoteSpacer?.isConnected,
  }
})
await page.locator("#fixture").screenshot({ path: path.join(out, "daily-quote-light.png") })
await page.evaluate(() => {
  const root = document.documentElement.style
  root.setProperty("--background-primary", "#202020")
  root.setProperty("--background-secondary", "#292929")
  root.setProperty("--background-modifier-border", "#454545")
  root.setProperty("--background-modifier-hover", "#343434")
  root.setProperty("--background-modifier-form-field", "#292929")
  root.setProperty("--text-normal", "#e6e6e6")
  root.setProperty("--text-muted", "#aaaaaa")
  root.setProperty("--text-faint", "#777777")
  document.body.style.background = "#202020"
})
await page.locator("#fixture").screenshot({ path: path.join(out, "daily-quote-dark.png") })
await page.setViewportSize({ width: 520, height: 980 })
await page.locator("#fixture").screenshot({ path: path.join(out, "daily-quote-narrow.png") })
await browser.close()

const errors = []
if (state.quoteText !== "我们先塑造习惯，然后习惯塑造我们。" || state.author !== "— John Dryden") errors.push("quote copy or attribution is missing")
// The quote header pencil is the same 22px action with a 14px glyph as the
// Habit and Todo header actions, not a 24px icon of its own.
if (state.editButtonHeight !== 22 || state.editIconSize.join("x") !== "14x14") errors.push(`quote header action diverged from the component header tier (${state.editButtonHeight}px, icon ${state.editIconSize.join("x")})`)
if (state.semantics.join("|") !== "FIGURE|BLOCKQUOTE|FIGCAPTION") errors.push("quote card lost its semantic figure structure")
if (state.events.join("|") !== "next|next|edit|empty-edit") errors.push("card cycling and focused editing are not independently reachable")
if (state.quoteEventLeaks.length || quoteScrollBeforeClick <= 0 || quoteScrollAfterClick !== quoteScrollBeforeClick || quoteScrollAfterKeyboard !== quoteScrollBeforeClick) errors.push(`quote card interaction leaks into the editor host or changes its scroll position (before=${quoteScrollBeforeClick}, click=${quoteScrollAfterClick}, keyboard=${quoteScrollAfterKeyboard}, leaks=${state.quoteEventLeaks.join("|")})`)
if (!state.slotLocalShellStable) errors.push("switching a quote replaces the surrounding scroll shell instead of repainting only the quote slot")
if (!state.emptyText.includes("添加第一句") || state.emptyBorderStyle !== "dashed" || state.emptyBackground !== "rgba(0, 0, 0, 0)") errors.push("empty quote component lost the shared dashed transparent language")
if (changesBeforeApply !== 0 || state.changes.at(-1)?.theme !== "midnight" || state.changes.at(-1)?.fontSize !== 31) errors.push("appearance draft writes before Apply or fails to apply")
if (state.futureCardDefault?.theme !== "midnight" || state.futureCardDefault?.fontSize !== 31) errors.push("an appearance applied to the visible card is not persisted as the future-card default")
if (liveFontSize.preview !== "31px" || liveFontSize.output !== "31 px" || !liveFontSize.stable) errors.push("font-size slider fails to update the live preview continuously")
if (savesBeforeQuote !== 1 || quoteRowsAfterSave !== 3 || state.saves !== savesAfterFailedDrag) errors.push("appearance/default persistence or quote-library saving occurs an unexpected number of times")
if (quoteOrderAfterCancel.join("|") !== quoteOrderBeforeDrag.join("|") || savesAfterCancelledDrag !== savesBeforeCancelledDrag) errors.push("cancelled quote drag changes order or persists")
if (quoteOrderAfterDrag.join("|") !== quoteOrderBeforeDrag.slice(1).concat(quoteOrderBeforeDrag[0]).join("|") || persistedQuoteOrder.join("|") !== quoteOrderAfterDrag.join("|") || savesAfterDrag !== savesAfterCancelledDrag + 1) errors.push("quote drag does not move the whole row and persist exactly once")
if (quoteOrderAfterReload.join("|") !== quoteOrderAfterDrag.join("|")) errors.push("quote order does not survive a settings rerender")
if (quoteOrderAfterFailedSave.join("|") !== quoteOrderAfterDrag.join("|") || settingsOrderAfterFailedSave.join("|") !== quoteOrderAfterDrag.join("|") || savesAfterFailedDrag !== savesAfterDrag + 1) errors.push("failed quote-order save does not roll the UI and settings back")
if (state.settingsWidth < 900 || state.settingsWidth > 960 || !state.statusIsLast) errors.push("quote settings keeps the oversized workbench or reserves a blank status band above the tabs")
if (!state.cropVisible || !state.importedImage) errors.push("imported media cannot enter non-destructive crop mode")
if (!state.cropCardStable || !state.cropRangeStable || !state.cropPositionChanged || state.cropZoom !== "scale(1.5)") errors.push("crop pan or zoom rebuilds the active control and interrupts its gesture")
if (errors.length) {
  console.error("DAILY QUOTE CONTRACT FAILED", { errors, state, screenshots: out })
  process.exit(1)
}
console.log(JSON.stringify({ ok: true, state, screenshots: out }, null, 2))
