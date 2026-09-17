import { chromium } from "playwright"
const browser = await chromium.connectOverCDP("http://127.0.0.1:9333")
const page = browser.contexts()[0].pages()[0]
await page.reload()
await page.waitForTimeout(5000)
const leaves = await page.evaluate(() => {
  const out = []
  app.workspace.iterateAllLeaves((l) => { if (l.view?.file?.path) out.push(l.view.file.path) })
  return out
})
console.log("leaves:", JSON.stringify(leaves))
const target = leaves.find((f) => f.includes("示例-图文混排")) ?? "项目/开发项目/日历小插件/示例-图文混排.md"
await page.evaluate(async (p) => {
  const file = app.vault.getAbstractFileByPath(p)
  if (file) await app.workspace.getLeaf(false).openFile(file)
}, target)
await page.waitForTimeout(2000)
const probe = await page.evaluate(() => {
  const hosts = [...document.querySelectorAll(".modular-diary-host")].filter((h) => h.offsetParent !== null)
  return hosts.map((host) => {
    const wrap = host.closest(".cm-embed-block")
    return {
      hostW: Math.round(host.getBoundingClientRect().width),
      wrapW: wrap ? Math.round(wrap.getBoundingClientRect().width) : null,
      clippedSlots: [...host.querySelectorAll(".modular-diary-slot")].filter((s) => s.scrollHeight > s.clientHeight + 2).map((s) => s.dataset.slot),
    }
  })
})
console.log(JSON.stringify(probe, null, 1))
await browser.close()
