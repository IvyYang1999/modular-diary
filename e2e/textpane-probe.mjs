import { chromium } from "playwright"
const browser = await chromium.connectOverCDP("http://127.0.0.1:9333")
const page = browser.contexts()[0].pages()[0]
await page.evaluate(async () => {
  const file = app.vault.getAbstractFileByPath("日记/2026.5毕业之前/2026.8.19.md")
  if (file) await app.workspace.getLeaf(false).openFile(file)
})
await page.waitForTimeout(2500)
const probe = await page.evaluate(() => {
  const host = document.querySelector(".modular-diary-text-host")
  if (!host) return { error: "no text host found" }
  const cs = getComputedStyle(host)
  return {
    hostFontSize: cs.fontSize,
    children: [...host.children].map((c) => {
      const ccs = getComputedStyle(c)
      return {
        tag: c.tagName,
        cls: (c.className || "").toString().slice(0, 30),
        text: (c.textContent || "").slice(0, 20),
        inner: c.innerHTML.slice(0, 120),
        marginTop: ccs.marginTop,
        whiteSpace: ccs.whiteSpace,
        h: Math.round(c.getBoundingClientRect().height),
      }
    }),
  }
})
console.log(JSON.stringify(probe, null, 1))
await browser.close()
