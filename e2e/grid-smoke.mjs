/**
 * Grid interact smoke: move (clone + snapped placeholder) and resize
 * (e-handle) with grid snapping + push-down, asserted via onCommit items.
 */
import esbuild from "esbuild"
import { chromium } from "playwright"
import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"
import os from "node:os"

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(os.tmpdir(), "modular-diary-grid-smoke")
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })

fs.writeFileSync(path.join(out, "entry.ts"), `
import { applyGridToBody, attachGridInteract, applyItemToSlot } from "${path.join(here, "../src/edit/grid-interact")}"
import { beginRemountVisual, RemountVisualRegistry } from "${path.join(here, "../src/edit/remount-visual")}"
const body = document.getElementById("body")
const items = [
  { id: "toolbar", x: 0, y: 0, w: 12, h: 2 },
  { id: "timeline", x: 0, y: 2, w: 12, h: 10 },
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
window.__committed = []
window.__gridVisualCommits = []
window.__lastPointerId = null
document.addEventListener("pointerdown", (event) => { window.__lastPointerId = event.pointerId }, true)
const gridVisualRegistry = new RemountVisualRegistry()
const gridVisualOwner = {}
attachGridInteract(body, (items) => {
  window.__committed.push(items)
  const started = beginRemountVisual(gridVisualRegistry, {
    owner: gridVisualOwner,
    path: "grid.md",
    blockOrdinal: 0,
    docId: "grid",
    lineStart: 0,
  }, document.getElementById("base"), "live-preview")
  window.__gridVisualCommits.push({
    started,
    overlays: document.querySelectorAll(".modular-diary-remount-overlay").length,
    sourceVisible: getComputedStyle(document.getElementById("base")).visibility !== "hidden",
  })
})

const wide = document.getElementById("wide")
const wideItems = [
  { id: "toolbar", x: 0, y: 0, w: 6, h: 5 },
  { id: "timeline", x: 6, y: 0, w: 6, h: 5 },
]
for (const it of wideItems) {
  const slot = document.createElement("div")
  slot.className = "modular-diary-slot"
  slot.dataset.slot = it.id
  slot.dataset.x = it.x; slot.dataset.y = it.y; slot.dataset.w = it.w; slot.dataset.h = it.h
  slot.textContent = it.id
  wide.appendChild(slot)
}
applyGridToBody(wide, wideItems)
wide.style.height = "100px"
window.__wideCommitted = []
attachGridInteract(wide, (items) => window.__wideCommitted.push(items))

const relocate = document.getElementById("relocate")
const relocateItems = [
  { id: "stats", x: 0, y: 0, w: 6, h: 4 },
  { id: "toolbar", x: 0, y: 4, w: 6, h: 3 },
  { id: "dialog", x: 0, y: 7, w: 6, h: 4 },
  { id: "timeline", x: 6, y: 0, w: 6, h: 10 },
]
for (const it of relocateItems) {
  const slot = document.createElement("div")
  slot.className = "modular-diary-slot"
  slot.dataset.slot = it.id
  slot.dataset.x = it.x; slot.dataset.y = it.y; slot.dataset.w = it.w; slot.dataset.h = it.h
  slot.textContent = it.id
  relocate.appendChild(slot)
}
applyGridToBody(relocate, relocateItems)
relocate.style.height = "220px"
window.__relocateCommitted = []
attachGridInteract(relocate, (items) => window.__relocateCommitted.push(items))
`)
await esbuild.build({
  entryPoints: [path.join(out, "entry.ts")],
  bundle: true, format: "iife", logLevel: "silent",
  outfile: path.join(out, "bundle.js"),
})
const css = fs.readFileSync(path.join(here, "../styles.css"), "utf8")
const html = `<!doctype html><html><head><style>${css}
:root { --interactive-accent: rgb(120, 80, 220); --text-accent: rgb(120, 80, 220); }
#base { width: 600px; }
#body { position: relative; width: 100%; }
#scroll { width: 600px; margin-top: 260px; }
#wide { position: relative; }
#relocate-shell { width: 600px; margin-top: 40px; }
#relocate { position: relative; }
.modular-diary-slot { background: #eee; }
</style></head><body><div id="base" class="modular-diary-container"><div id="body"></div></div><div id="scroll" class="modular-diary-container"><div id="wide" class="modular-diary-body"></div></div><div id="relocate-shell" class="modular-diary-container"><div id="relocate" class="modular-diary-body"></div></div><script>${fs.readFileSync(path.join(out, "bundle.js"), "utf8")}</script></body></html>`
fs.writeFileSync(path.join(out, "index.html"), html)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 800, height: 500 } })
page.on("pageerror", (e) => { console.error("pageerror:", e.message); process.exit(1) })
await page.goto("file://" + path.join(out, "index.html"))
await page.waitForSelector(".modular-diary-slot-grip")

const edgeHandle = page.locator('#body .modular-diary-slot[data-slot="toolbar"] .modular-diary-handle-e')
await edgeHandle.hover()
const edgeHandleHoverBackground = await edgeHandle.evaluate((handle) => getComputedStyle(handle).backgroundColor)
if (edgeHandleHoverBackground !== "rgba(0, 0, 0, 0)") {
  console.error("edge resize handle became visible", edgeHandleHoverBackground); process.exit(1)
}

const bodyBox = await page.locator("#body").boundingBox()
// cellW = 600/12 = 50, rowH = 20

// 1. move toolbar (grip) down ~5 rows: y 0 -> 5; timeline (y2,h10) should push below? toolbar h2 at y5 overlaps timeline(y2..12) -> timeline pushed to 7
const grip = await page.locator('#body .modular-diary-slot[data-slot="toolbar"] .modular-diary-slot-grip').boundingBox()
await page.mouse.move(grip.x + 4, grip.y + 4)
await page.mouse.down()
const movePointerContract = await page.evaluate(() => {
  const handle = document.querySelector('#body .modular-diary-slot[data-slot="toolbar"] .modular-diary-slot-grip')
  return {
    pointerId: window.__lastPointerId,
    captured: handle?.hasPointerCapture(window.__lastPointerId) ?? false,
    redrawBlocked: document.querySelector("#base")?.dataset.modularDiaryPointerActive === "1",
  }
})
if (!movePointerContract.captured || !movePointerContract.redrawBlocked) {
  console.error("grid move did not own the pointer/redraw lifecycle", movePointerContract); process.exit(1)
}
// A foreign pointer ending must not finish the held mouse move. In Obsidian a
// trackpad/touch stream can coexist with the mouse pointer that owns the grip.
await page.evaluate(() => document.dispatchEvent(new PointerEvent("pointerup", {
  bubbles: true,
  pointerId: 91234,
  pointerType: "touch",
})))
const moveAfterForeignPointer = await page.evaluate(() => ({
  active: document.querySelector('#body .modular-diary-slot[data-slot="toolbar"]')?.classList.contains("is-placeholder"),
  commits: window.__committed.length,
}))
if (!moveAfterForeignPointer.active || moveAfterForeignPointer.commits !== 0) {
  console.error("an unrelated pointer ended the active grid move", moveAfterForeignPointer); process.exit(1)
}
await page.mouse.move(grip.x + 4, grip.y + 4 + 100, { steps: 4 })
const during = await page.evaluate(() => ({
  clone: document.querySelector(".modular-diary-drag-clone") !== null,
  placeholder: document.querySelector('.modular-diary-slot[data-slot="toolbar"]')?.classList.contains("is-placeholder") ?? false,
}))
if (!during.clone || !during.placeholder) { console.error("missing clone/placeholder", during); process.exit(1) }
await page.mouse.up()
const movePointerReleased = await page.evaluate(() => ({
  active: document.querySelector("#base")?.dataset.modularDiaryPointerActive ?? "",
  captured: document.querySelector('#body .modular-diary-slot[data-slot="toolbar"] .modular-diary-slot-grip')?.hasPointerCapture(window.__lastPointerId) ?? false,
}))
if (movePointerReleased.active || movePointerReleased.captured) {
  console.error("grid move did not release its interaction ownership", movePointerReleased); process.exit(1)
}

// 1b. The real regression: move a left-column Stats block across the timeline
// and place it directly below that timeline. The whole held gesture must
// survive the long cross-component route and persist the destination.
const relocateBody = page.locator("#relocate")
await relocateBody.scrollIntoViewIfNeeded()
const relocateBodyBox = await relocateBody.boundingBox()
const statsGrip = await page.locator('#relocate .modular-diary-slot[data-slot="stats"] .modular-diary-slot-grip').boundingBox()
await page.mouse.move(statsGrip.x + 4, statsGrip.y + 4)
await page.mouse.down()
await page.mouse.move(
  statsGrip.x + 4 + relocateBodyBox.width / 2,
  statsGrip.y + 4 + 10 * 20,
  { steps: 12 },
)
const relocateDuring = await page.evaluate(() => ({
  active: document.querySelector("#relocate-shell")?.dataset.modularDiaryPointerActive === "1",
  placeholder: document.querySelector('#relocate .modular-diary-slot[data-slot="stats"]')?.classList.contains("is-placeholder") ?? false,
  clone: document.querySelector(".modular-diary-drag-clone") !== null,
}))
if (!relocateDuring.active || !relocateDuring.placeholder || !relocateDuring.clone) {
  console.error("Stats relocation ended before pointer release", relocateDuring); process.exit(1)
}
await page.locator("#relocate-shell").screenshot({ path: path.join(out, "stats-below-timeline-preview.png") })
await page.mouse.up()
const relocateAfter = await page.evaluate(() => {
  const stats = document.querySelector('#relocate .modular-diary-slot[data-slot="stats"]')
  const timeline = document.querySelector('#relocate .modular-diary-slot[data-slot="timeline"]')
  return {
    stats: { x: Number(stats?.dataset.x), y: Number(stats?.dataset.y) },
    timeline: { x: Number(timeline?.dataset.x), bottom: Number(timeline?.dataset.y) + Number(timeline?.dataset.h) },
    commits: window.__relocateCommitted.length,
  }
})
if (relocateAfter.commits !== 1
  || relocateAfter.stats.x !== relocateAfter.timeline.x
  || relocateAfter.stats.y < relocateAfter.timeline.bottom) {
  console.error("Stats did not persist below the timeline", relocateAfter); process.exit(1)
}
await page.locator("#relocate-shell").screenshot({ path: path.join(out, "stats-below-timeline-final.png") })

// 2. resize timeline via e-handle: w 12 -> 6 (drag left edge of right side)
await page.locator("#body").scrollIntoViewIfNeeded()
const tl = await page.locator('#body .modular-diary-slot[data-slot="timeline"]').boundingBox()
await page.mouse.move(tl.x + tl.width - 2, tl.y + tl.height / 2)
await page.mouse.down()
const resizePointerContract = await page.evaluate(() => {
  const handle = document.querySelector('#body .modular-diary-slot[data-slot="timeline"] .modular-diary-handle-e')
  return {
    pointerId: window.__lastPointerId,
    captured: handle?.hasPointerCapture(window.__lastPointerId) ?? false,
  }
})
if (!resizePointerContract.captured) {
  console.error("grid resize did not capture its pointer", resizePointerContract); process.exit(1)
}
// A second pointer ending must not terminate the active mouse resize. This
// guards trackpads/touch input and unrelated pointer streams in Obsidian.
await page.evaluate(() => document.dispatchEvent(new PointerEvent("pointerup", {
  bubbles: true,
  pointerId: 91234,
  pointerType: "touch",
})))
const afterForeignPointer = await page.evaluate(() => ({
  active: document.querySelector('#body .modular-diary-slot[data-slot="timeline"]')?.classList.contains("is-resizing"),
  commits: window.__committed.length,
}))
if (!afterForeignPointer.active || afterForeignPointer.commits !== 1) {
  console.error("an unrelated pointer ended the active grid resize", afterForeignPointer); process.exit(1)
}
// Repeatedly cross the moving edge in both directions while the original
// button remains held. Capture must keep one uninterrupted resize session.
for (const x of [tl.x + 500, tl.x + 250, tl.x + 460, tl.x + 280, tl.x + 300]) {
  await page.mouse.move(x, tl.y + tl.height / 2, { steps: 3 })
  const active = await page.locator('#body .modular-diary-slot[data-slot="timeline"]').evaluate((slot) => slot.classList.contains("is-resizing"))
  if (!active) { console.error("grid resize ended during a held zig-zag drag", x); process.exit(1) }
}
await page.mouse.up()
const resizeVisualHandoff = await page.evaluate(() => window.__gridVisualCommits.at(-1))
if (resizeVisualHandoff.started || resizeVisualHandoff.overlays !== 0 || !resizeVisualHandoff.sourceVisible) {
  console.error("grid resize spawned a second whole-block visual during commit", resizeVisualHandoff); process.exit(1)
}

// A genuine cancellation must roll the preview back and must never persist a
// half-finished layout. Releasing the physical button afterwards is a no-op.
const cancelSlot = page.locator('#body .modular-diary-slot[data-slot="toolbar"]')
const cancelBefore = await cancelSlot.evaluate((slot) => ({
  x: slot.dataset.x,
  y: slot.dataset.y,
  w: slot.dataset.w,
  h: slot.dataset.h,
}))
const cancelBox = await cancelSlot.boundingBox()
await page.mouse.move(cancelBox.x + cancelBox.width - 2, cancelBox.y + cancelBox.height / 2)
await page.mouse.down()
await page.mouse.move(cancelBox.x + cancelBox.width - 120, cancelBox.y + cancelBox.height / 2, { steps: 3 })
await page.evaluate(() => document.dispatchEvent(new PointerEvent("pointercancel", {
  bubbles: true,
  pointerId: window.__lastPointerId,
  pointerType: "mouse",
})))
await page.mouse.up()
const cancelAfter = await page.evaluate(() => {
  const slot = document.querySelector('#body .modular-diary-slot[data-slot="toolbar"]')
  return {
    active: slot.classList.contains("is-resizing"),
    commits: window.__committed.length,
    item: { x: slot.dataset.x, y: slot.dataset.y, w: slot.dataset.w, h: slot.dataset.h },
  }
})
if (cancelAfter.active || cancelAfter.commits !== 2 || JSON.stringify(cancelAfter.item) !== JSON.stringify(cancelBefore)) {
  console.error("cancelled grid resize was persisted instead of rolled back", { cancelBefore, cancelAfter }); process.exit(1)
}

// 3. Two half-width peers fill one row. Growing the left peer by two columns
// must expand the internal canvas and move the right peer horizontally, not
// push it down.
await page.locator('#wide .modular-diary-slot[data-slot="toolbar"]').scrollIntoViewIfNeeded()
const wideBodyBefore = await page.locator("#wide").boundingBox()
const wideLeft = await page.locator('#wide .modular-diary-slot[data-slot="toolbar"]').boundingBox()
const wideCell = wideBodyBefore.width / 12
await page.mouse.move(wideLeft.x + wideLeft.width - 2, wideLeft.y + wideLeft.height / 2)
await page.mouse.down()
await page.mouse.move(wideLeft.x + wideLeft.width + wideCell * 2, wideLeft.y + wideLeft.height / 2, { steps: 4 })
const topEdgeResizePreview = await page.locator('#wide .modular-diary-slot[data-slot="toolbar"]').evaluate((slot) => {
  const body = slot.parentElement
  const rect = slot.getBoundingClientRect()
  const bodyRect = body.getBoundingClientRect()
  const style = getComputedStyle(slot)
  return {
    active: slot.classList.contains("is-resizing"),
    topDelta: rect.top - bodyRect.top,
    leftDelta: rect.left - bodyRect.left,
    outlineStyle: style.outlineStyle,
    outlineWidth: style.outlineWidth,
    outlineOffset: style.outlineOffset,
  }
})
await page.locator("#scroll").screenshot({ path: path.join(out, "resize-preview-top-light.png") })
await page.evaluate(() => {
  document.body.style.background = "rgb(30, 30, 30)"
  document.documentElement.style.setProperty("--text-accent", "rgb(166, 126, 255)")
  document.documentElement.style.setProperty("--background-primary", "rgb(30, 30, 30)")
})
await page.locator("#scroll").screenshot({ path: path.join(out, "resize-preview-top-dark.png") })
await page.mouse.up()

const commits = await page.evaluate(() => window.__committed)
const wideState = await page.evaluate(() => ({
  commits: window.__wideCommitted,
  columns: Number(document.querySelector("#wide").dataset.gridCols),
  bodyWidth: document.querySelector("#wide").getBoundingClientRect().width,
  viewportWidth: document.querySelector("#scroll").clientWidth,
  scrollWidth: document.querySelector("#scroll").scrollWidth,
}))
await browser.close()
console.log("commits:", JSON.stringify(commits))
if (commits.length !== 2) { console.error("expected 2 commits"); process.exit(1) }
const [move, resize] = commits
const mvToolbar = move.find((i) => i.id === "toolbar")
const mvTimeline = move.find((i) => i.id === "timeline")
if (mvToolbar.y !== 5) { console.error("move y mismatch", mvToolbar); process.exit(1) }
if (mvTimeline.y !== 7) { console.error("push-down mismatch", mvTimeline); process.exit(1) }
const rzTimeline = resize.find((i) => i.id === "timeline")
if (rzTimeline.w !== 6) { console.error("resize w mismatch", rzTimeline); process.exit(1) }
const wideCommit = wideState.commits.at(-1)
const wideLeftItem = wideCommit?.find((i) => i.id === "toolbar")
const wideRightItem = wideCommit?.find((i) => i.id === "timeline")
if (!wideLeftItem || wideLeftItem.w !== 8 || wideLeftItem.y !== 0) { console.error("wide left resize mismatch", wideState); process.exit(1) }
if (!wideRightItem || wideRightItem.x !== 8 || wideRightItem.y !== 0) { console.error("wide peer moved vertically", wideState); process.exit(1) }
if (!topEdgeResizePreview.active || Math.abs(topEdgeResizePreview.topDelta) > 0.5 || Math.abs(topEdgeResizePreview.leftDelta) > 0.5 || topEdgeResizePreview.outlineStyle !== "dashed" || topEdgeResizePreview.outlineWidth !== "2px" || topEdgeResizePreview.outlineOffset !== "-2px") {
  console.error("top-edge resize preview can escape or shift its slot", topEdgeResizePreview); process.exit(1)
}
if (wideState.columns !== 14 || wideState.scrollWidth <= wideState.viewportWidth || wideState.bodyWidth <= wideState.viewportWidth) {
  console.error("wide canvas did not become scrollable", wideState); process.exit(1)
}
console.log("OK grid smoke passed")
