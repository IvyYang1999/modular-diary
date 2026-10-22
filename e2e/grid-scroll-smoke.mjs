/**
 * Resizing or moving a component must not scroll the page by itself.
 *
 * The block sits in a scroll pane that imitates CodeMirror's scroll anchoring:
 * when the block grows or shrinks, the pane shifts scrollTop by the same amount
 * (CodeMirror keeps a line *below* the block fixed). Without a hold the block
 * slides under the pointer, the handle chases it and the page keeps scrolling.
 * Contract: mid-screen the block stays put; near the pane's bottom edge the page
 * scrolls smoothly; dragging one component down past another swaps them.
 */
import esbuild from "esbuild"
import { chromium } from "playwright"
import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"
import os from "node:os"
const here = path.dirname(fileURLToPath(import.meta.url))
const out = fs.mkdtempSync(path.join(os.tmpdir(), "modular-diary-grid-scroll-"))
fs.writeFileSync(path.join(out, "entry.ts"), `
import { applyGridToBody, attachGridInteract, applyItemToSlot } from "${path.join(here, "../src/edit/grid-interact")}"
const body = document.getElementById("body")
const items = [
  { id: "todos", x: 0, y: 0, w: 12, h: 6 },
  { id: "habits", x: 0, y: 6, w: 12, h: 6 },
]
for (const it of items) {
  const slot = document.createElement("div")
  slot.className = "modular-diary-slot"
  slot.dataset.slot = it.id
  slot.dataset.x = it.x; slot.dataset.y = it.y; slot.dataset.w = it.w; slot.dataset.h = it.h
  slot.textContent = it.id
  applyItemToSlot(slot, it)
  body.appendChild(slot)
}
applyGridToBody(body, items)
body.style.height = "240px"
window.__commits = []
attachGridInteract(body, (next) => window.__commits.push(next))
// CodeMirror-like anchoring: keep the content below the block where it was.
const pane = document.getElementById("pane")
let lastHeight = body.offsetHeight
new ResizeObserver(() => {
  const height = body.offsetHeight
  const delta = height - lastHeight
  lastHeight = height
  if (delta) requestAnimationFrame(() => { pane.scrollTop += delta })
}).observe(body)
`)
await esbuild.build({ entryPoints: [path.join(out, "entry.ts")], bundle: true, format: "iife", logLevel: "silent", outfile: path.join(out, "bundle.js") })
const css = fs.readFileSync(path.join(here, "../styles.css"), "utf8")
fs.writeFileSync(path.join(out, "index.html"), `<!doctype html><html><head><style>${css}
html, body { margin: 0; overflow: hidden; }
#pane { position: absolute; inset: 0; overflow: auto; }
.filler { height: 900px; background: repeating-linear-gradient(#fff 0 19px, #eee 19px 20px); }
#shell { width: 600px; }
#body { position: relative; }
.modular-diary-slot { background: #dde; }
</style></head><body><div id="pane"><div class="filler"></div><div id="shell" class="modular-diary-container"><div id="body" class="modular-diary-body"></div></div><div class="filler"></div></div>
<script>${fs.readFileSync(path.join(out, "bundle.js"), "utf8")}</script></body></html>`)

const browser = await chromium.launch({ headless: true })
const fail = (message, detail) => { console.error(message, JSON.stringify(detail)); process.exit(1) }
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
  page.on("pageerror", (e) => fail("pageerror", e.message))
  await page.goto("file://" + path.join(out, "index.html"))
  // Block top 40px above the pane: the editor's anchor line is below the block.
  await page.evaluate(() => { const pane = document.getElementById("pane"); pane.scrollTop = document.getElementById("shell").offsetTop + 40 })
  const top = () => page.evaluate(() => document.getElementById("body").getBoundingClientRect().top)
  const frames = (n) => page.evaluate((n) => new Promise((done) => { let i = 0; const f = () => (++i >= n ? done() : requestAnimationFrame(f)); requestAnimationFrame(f) }), n)

  // 1. Resize the lower component's bottom edge in the middle of the screen.
  const habits = page.locator('.modular-diary-slot[data-slot="habits"]')
  await habits.hover()
  const handle = await page.locator('.modular-diary-slot[data-slot="habits"] .modular-diary-handle-s').boundingBox()
  const startTop = await top()
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  const tops = []
  for (let step = 1; step <= 6; step++) {
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + step * 12)
    await frames(4)
    tops.push(await top())
  }
  await frames(10)
  tops.push(await top())
  if (tops.some((t) => Math.abs(t - startTop) > 1)) fail("resizing mid-screen must not scroll the page", { startTop, tops })

  // 2. Near the bottom edge the page scrolls by itself, and the component keeps growing.
  const scrollBefore = await page.evaluate(() => document.getElementById("pane").scrollTop)
  const heightBefore = await habits.evaluate((s) => +s.dataset.h)
  await page.mouse.move(handle.x + handle.width / 2, 590, { steps: 4 })
  await frames(30)
  const edge = await page.evaluate(() => document.getElementById("pane").scrollTop)
  const heightAtEdge = await habits.evaluate((s) => +s.dataset.h)
  // Back to the middle: scrolling stops.
  await page.mouse.move(handle.x + handle.width / 2, 300, { steps: 4 })
  await frames(6)
  const settled = await page.evaluate(() => document.getElementById("pane").scrollTop)
  await frames(20)
  const still = await page.evaluate(() => document.getElementById("pane").scrollTop)
  await page.mouse.up()
  if (edge <= scrollBefore + 40) fail("holding the pointer at the bottom edge must scroll the page", { scrollBefore, edge })
  if (heightAtEdge <= heightBefore) fail("edge scrolling must keep resizing under the pointer", { heightBefore, heightAtEdge })
  if (Math.abs(still - settled) > 1) fail("scrolling must stop once the pointer leaves the edge", { settled, still })

  // 3. Dragging the upper component down past the lower one's middle swaps them.
  await page.evaluate(() => { const pane = document.getElementById("pane"); pane.scrollTop = document.getElementById("shell").offsetTop - 100 })
  const before = await page.evaluate(() => window.__commits.length)
  const layout = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".modular-diary-slot")].map((s) => [s.dataset.slot, { y: +s.dataset.y, h: +s.dataset.h }])))
  const grip = await page.locator('.modular-diary-slot[data-slot="todos"] .modular-diary-slot-grip').boundingBox()
  const drop = (layout.habits.y + layout.habits.h / 2 - layout.todos.h / 2 + 1) * 20
  await page.mouse.move(grip.x + 4, grip.y + 4)
  await page.mouse.down()
  await page.mouse.move(grip.x + 4, grip.y + 4 + drop, { steps: 10 })
  await frames(4)
  await page.mouse.up()
  const commits = await page.evaluate(() => window.__commits)
  const swapped = commits.length > before ? commits[commits.length - 1] : null
  const y = (id) => swapped?.find((i) => i.id === id)?.y
  if (!swapped || !(y("habits") < y("todos"))) fail("dragging down past a neighbour's middle must swap the two", { layout, drop, swapped })
  console.log("OK grid scroll smoke passed", JSON.stringify({ tops, scrollBefore, edge, swapped }))
} finally {
  await browser.close()
}
