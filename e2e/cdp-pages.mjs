import { chromium } from "playwright"
const browser = await chromium.connectOverCDP("http://127.0.0.1:9333")
for (const ctx of browser.contexts()) {
  for (const page of ctx.pages()) {
    const hosts = await page.evaluate(() => {
      return [...document.querySelectorAll(".modular-diary-host")].map((h) => {
        let hiddenAncestor = null
        let el = h
        while (el) {
          const cs = getComputedStyle(el)
          if (cs.display === "none" || cs.visibility === "hidden") { hiddenAncestor = (el.className || "").toString().slice(0, 50); break }
          el = el.parentElement
        }
        const r = h.getBoundingClientRect()
        return {
          w: Math.round(r.width), h: Math.round(r.height),
          offsetParent: h.offsetParent ? "yes" : "NULL(display:none链)",
          hiddenAncestor,
          inLP: !!h.closest(".cm-editor"),
          inReading: !!h.closest(".markdown-reading-view"),
        }
      })
    }).catch(() => null)
    if (hosts && hosts.length) console.log(page.title ? "" : "", JSON.stringify(hosts, null, 1))
  }
}
await browser.close()
