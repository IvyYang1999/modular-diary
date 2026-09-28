/** Product contract for `#` completion: an @-style picker whose options are the badges they become. */
import esbuild from "esbuild"
import { chromium } from "playwright"
import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"
import os from "node:os"

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(os.tmpdir(), "modular-diary-tag-suggest-smoke")
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })
fs.writeFileSync(path.join(out, "entry.ts"), `
import { attachTagSuggest } from "${path.join(here, "../src/edit/tag-suggest")}"
const input = document.querySelector<HTMLInputElement>("#title")!
window.__saves = []
input.addEventListener("keydown", (e) => { if (e.key === "Enter") window.__saves.push(input.value) })
attachTagSuggest(input, { tags: () => ["官网", "模块日记", "飞搜", "opentrends"], tagStyle: (tag) => tag === "模块日记" ? { background: "#dbeafe", color: "#1f78c8" } : null })
`)
await esbuild.build({ entryPoints: [path.join(out, "entry.ts")], bundle: true, format: "iife", outfile: path.join(out, "bundle.js"), logLevel: "silent" })
const css = fs.readFileSync(path.join(here, "../styles.css"), "utf8")
fs.writeFileSync(path.join(out, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body style="margin:24px"><input id="title" style="width:320px;height:30px"><script>${fs.readFileSync(path.join(out, "bundle.js"), "utf8")}</script></body></html>`)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
page.on("pageerror", (error) => { console.error("pageerror:", error.message); process.exit(1) })
await page.goto("file://" + path.join(out, "index.html"))
const input = page.locator("#title")
const list = () => page.evaluate(() => [...document.querySelectorAll(".modular-diary-tag-suggest-item")].map((el) => [el.textContent, el.classList.contains("is-active"), el.querySelector(".modular-diary-tag.has-category") !== null]))
await input.click()
await page.keyboard.type("写 #模")
const afterPrefix = await list()
await page.keyboard.press("Enter")
const valueAfterPick = await input.inputValue()
const openAfterPick = await page.evaluate(() => document.querySelectorAll(".modular-diary-tag-suggest").length)
const savesAfterPick = await page.evaluate(() => window.__saves)
await page.keyboard.type("#")
const all = await list()
await page.keyboard.press("ArrowDown")
await page.keyboard.press("ArrowDown")
const afterArrow = await list()
await page.keyboard.press("Tab")
const valueAfterTab = await input.inputValue()
await page.keyboard.type("#zz")
const noMatch = await page.evaluate(() => document.querySelectorAll(".modular-diary-tag-suggest").length)
await page.keyboard.type(" #o")
await page.keyboard.press("Escape")
const afterEscape = await page.evaluate(() => document.querySelectorAll(".modular-diary-tag-suggest").length)
await page.keyboard.press("Enter")
const saves = await page.evaluate(() => window.__saves)
await browser.close()

const errors = []
if (afterPrefix.length !== 1 || afterPrefix[0][0] !== "#模块日记" || !afterPrefix[0][1] || !afterPrefix[0][2]) errors.push("prefix query must list the one matching tag as an active, coloured badge: " + JSON.stringify(afterPrefix))
if (valueAfterPick !== "写 #模块日记 ") errors.push("Enter must replace the token with the tag and a space: " + JSON.stringify(valueAfterPick))
if (openAfterPick !== 0 || savesAfterPick.length !== 0) errors.push("picking must close the list and swallow the Enter")
if (all.length !== 4 || all[0][1] !== true) errors.push("a bare # lists every known tag with the first active: " + JSON.stringify(all))
if (!afterArrow[2][1]) errors.push("ArrowDown must move the active item")
if (valueAfterTab !== "写 #模块日记 #飞搜 ") errors.push("Tab must pick the active item: " + JSON.stringify(valueAfterTab))
if (noMatch !== 0) errors.push("no match must show no list")
if (afterEscape !== 0 || saves.length !== 1) errors.push("Escape closes the list and the next Enter reaches the form")
if (errors.length) { console.error("TAG SUGGEST CONTRACT FAILED", errors); process.exit(1) }
console.log("OK tag suggest smoke passed")
