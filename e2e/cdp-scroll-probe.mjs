/**
 * Live-Obsidian scroll forensics (needs `Obsidian --remote-debugging-port=9333`).
 * Reveals the first leaf with an Modular Diary block, wraps CodeMirrorx27s update /
 * measure / scrollAnchorAt and the scrollerx27s scrollTop setter, performs a
 * real create gesture at the bottom of the visible track, logs every scroll
 * decision, then removes the line it created. 2026-09-09: this is how the
 * jump-to-bottom after every write was traced to CodeMirror re-anchoring on
 * a height map that momentarily lacks the remounted widget.
 */
import { chromium } from "playwright"
const browser = await chromium.connectOverCDP("http://127.0.0.1:9333")
let page = null
for (const ctx of browser.contexts()) for (const p of ctx.pages()) { if (await p.evaluate(() => Boolean(window.app?.workspace)).catch(() => false)) { page = p; break } }
await page.evaluate(() => { let target = null; window.app.workspace.iterateAllLeaves((leaf) => { if (!target && leaf.view?.containerEl?.querySelector(".modular-diary-container")) target = leaf }); if (target) { window.app.workspace.revealLeaf(target); window.app.workspace.setActiveLeaf(target, { focus: false }) } })
await page.waitForTimeout(500)
const out = await page.evaluate(() => {
  const svg = [...document.querySelectorAll(".modular-diary-container svg.modular-diary-svg")].find((el) => el.getBoundingClientRect().width > 0)
  const r0 = svg.getBoundingClientRect(); if (r0.top < 0 || r0.bottom > innerHeight) svg.scrollIntoView({ block: "center" })
  const scroller = svg.closest(".cm-scroller")
  const cm = window.app.workspace.activeEditor.editor.cm
  const vs = cm.viewState
  const st = (tag, extra = {}) => { const c = document.querySelector(".cm-content .modular-diary-container"); const e = { tag, t: Math.round(performance.now() * 10) / 10, top: scroller.scrollTop, sh: scroller.scrollHeight, pos: vs.scrollAnchorPos, ah: Math.round(vs.scrollAnchorHeight), off: Math.round(vs.scrollOffset), toBottom: vs.scrolledToBottom, mapH: Math.round(vs.heightMap.height), wH: c ? Math.round(c.getBoundingClientRect().height) : null, ...extra }; try { e.anchorLineTop = Math.round(vs.lineBlockAt(Math.max(0, vs.scrollAnchorPos)).top); e.anchorLineFrom = vs.lineBlockAt(Math.max(0, vs.scrollAnchorPos)).from } catch {} ; return e }
  window.__log = []
  const push = (e) => window.__log.push(e)
  if (!window.__wrapped) {
    window.__wrapped = true
    const VS = Object.getPrototypeOf(vs), EV = Object.getPrototypeOf(cm)
    const oa = VS.scrollAnchorAt; VS.scrollAnchorAt = function (h) { const r = oa.call(this, h); push(st("scrollAnchorAt", { arg: Math.round(h), retFrom: r.from, retTop: Math.round(r.top), vpFrom: this.viewport.from, firstVpTop: Math.round(this.viewportLines[0]?.top ?? -1) })); return r }
    const ou = VS.update; VS.update = function (u, s) { push(st("vs.update:in", { docChanged: u.docChanged })); const r = ou.call(this, u, s); push(st("vs.update:out")); return r }
    const om = EV.measure; EV.measure = function (f) { push(st("measure:in")); const r = om.call(this, f); push(st("measure:out")); return r }
    const ovm = VS.measure; VS.measure = function (v) { const r = ovm.call(this, v); push(st("vs.measure", { flags: r })); return r }
  }
  const desc = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop")
  Object.defineProperty(Element.prototype, "scrollTop", { get: desc.get, set(v) { if (this === scroller) push(st("SET " + v)); return desc.set.call(this, v) }, configurable: true })
  window.__probe = { before: window.app.workspace.activeEditor.editor.getValue() }
  const hours = [...svg.querySelectorAll("text.modular-diary-hour")].map((t) => ({ h: t.textContent.trim(), y: t.getBoundingClientRect().top + t.getBoundingClientRect().height / 2 }))
  const track = svg.querySelector("rect.modular-diary-track").getBoundingClientRect()
  return { hours, x: track.x + track.width / 2, vh: innerHeight, scrollerTop: Math.round(scroller.getBoundingClientRect().top), first: st("pre") }
})
console.log("scroller top in viewport", out.scrollerTop, JSON.stringify(out.first))
const vis = out.hours.filter((h) => h.y > 40 && h.y < out.vh - 40); const a = vis[vis.length - 2], b = vis[vis.length - 1]
const y1 = a.y + (b.y - a.y) * 0.25, y2 = a.y + (b.y - a.y) * 0.75
await page.mouse.move(out.x, y1); await page.mouse.down(); await page.waitForTimeout(60)
for (let i = 1; i <= 6; i++) { await page.mouse.move(out.x, y1 + (y2 - y1) * i / 6); await page.waitForTimeout(30) }
await page.evaluate(() => { window.__log.length = 0 })
await page.mouse.up()
await page.waitForTimeout(1200)
const res = await page.evaluate(() => {
  const editor = window.app.workspace.activeEditor.editor
  const lines = editor.getValue().split("\n"); const beforeLines = window.__probe.before.split("\n")
  const idx = lines.findIndex((l, i) => l !== beforeLines[i]); const added = lines.filter((l) => !beforeLines.includes(l))
  if (idx >= 0 && added.length === 1) editor.replaceRange("", { line: idx, ch: 0 }, { line: idx + 1, ch: 0 })
  return { added, log: window.__log }
})
console.log("added+removed:", JSON.stringify(res.added))
for (const e of res.log) console.log(JSON.stringify(e))
await browser.close()
