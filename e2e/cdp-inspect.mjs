/** Attach to Obsidian via CDP and inspect the modular-diary block render state. */
import { chromium } from "playwright"

const browser = await chromium.connectOverCDP("http://127.0.0.1:9333")
const contexts = browser.contexts()
let found = null
for (const ctx of contexts) {
  for (const page of ctx.pages()) {
    const has = await page.evaluate(() => document.querySelector(".modular-diary-host, .modular-diary-container") !== null).catch(() => false)
    if (has) { found = page; break }
  }
  if (found) break
}
if (!found) {
  // dump page list for diagnosis
  for (const ctx of contexts) for (const p of ctx.pages()) console.log("page:", p.url())
  console.error("no modular-diary block found in any page")
  process.exit(1)
}
const state = await found.evaluate(() => {
  const host = document.querySelector(".modular-diary-host")
  const body = document.querySelector(".modular-diary-body")
  return {
    hostExists: !!host,
    hostSize: host ? { w: host.getBoundingClientRect().width, h: host.getBoundingClientRect().height } : null,
    bodyHeight: body?.style.height ?? null,
    slotCount: document.querySelectorAll(".modular-diary-slot").length,
    slotSample: [...document.querySelectorAll(".modular-diary-slot")].slice(0, 6).map((s) => ({
      id: s.dataset.slot,
      style: s.getAttribute("style"),
      contentLen: s.innerHTML.length,
      visible: s.getBoundingClientRect().width > 0 && s.getBoundingClientRect().height > 0,
    })),
    errors: [...document.querySelectorAll(".modular-diary-errors")].map((e) => e.textContent),
  }
})
console.log(JSON.stringify(state, null, 2))
await browser.close()
