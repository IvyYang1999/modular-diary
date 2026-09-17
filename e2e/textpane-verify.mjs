import { chromium } from "playwright"
const browser = await chromium.connectOverCDP("http://127.0.0.1:9333")
const page = browser.contexts()[0].pages()[0]
await page.reload()
await page.waitForTimeout(4000)
await page.evaluate(async () => {
  const file = app.vault.getAbstractFileByPath("日记/2026.5毕业之前/2026.8.19.md")
  if (file) await app.workspace.getLeaf(false).openFile(file)
})
await page.waitForTimeout(2000)
const m = await page.evaluate(() => {
  const host = document.querySelector(".modular-diary-text-host")
  if (!host) return { error: "no host" }
  return {
    pWhiteSpace: getComputedStyle(host.querySelector("p")).whiteSpace,
    paras: [...host.children].map((c) => ({
      tag: c.tagName,
      breaks: c.querySelectorAll("br").length,
      mt: getComputedStyle(c).marginTop,
      text: (c.textContent || "").slice(0, 12),
      h: Math.round(c.getBoundingClientRect().height),
    })),
  }
})
console.log(JSON.stringify(m, null, 1))
await browser.close()
