import { chromium } from "playwright"
const browser = await chromium.connectOverCDP("http://127.0.0.1:9333")
const page = browser.contexts()[0].pages()[0]

const leaves = await page.evaluate(() => {
  const out = []
  app.workspace.iterateAllLeaves((l) => {
    const f = l.view?.file?.path
    if (f) out.push({ file: f, id: l.id })
  })
  return out
})
console.log("leaves:", JSON.stringify(leaves))

for (const leaf of leaves) {
  if (!leaf.file.includes("示例")) continue
  await page.evaluate((id) => {
    app.workspace.iterateAllLeaves((l) => {
      if (l.id === id) app.workspace.revealLeaf(l)
    })
  }, leaf.id)
  await page.waitForTimeout(800)
  const probe = await page.evaluate(() => {
    return [...document.querySelectorAll(".workspace-leaf:not(.is-hidden)")].map((leafEl) => {
      const host = leafEl.querySelector(".modular-diary-host")
      if (!host) return null
      const r = host.getBoundingClientRect()
      const body = host.querySelector(".modular-diary-body")?.getBoundingClientRect()
      const slot = host.querySelector(".modular-diary-slot")?.getBoundingClientRect()
      return {
        file: leafEl.querySelector(".view-header-title")?.textContent,
        hostW: Math.round(r.width), hostInlineW: host.style.width,
        bodyW: Math.round(body?.width ?? -1),
        slotW: Math.round(slot?.width ?? -1),
      }
    }).filter(Boolean)
  })
  console.log(leaf.file, "->", JSON.stringify(probe))
}
await browser.close()
