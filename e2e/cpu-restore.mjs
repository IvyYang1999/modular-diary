import { chromium } from "playwright"
const browser = await chromium.connectOverCDP("http://127.0.0.1:9333")
const page = browser.contexts()[0].pages()[0]
const restored = await page.evaluate(async () => {
  const want = ["better-export-pdf","calendar","cmdr","copilot","easy-tracker","file-explorer-plus","homepage","image-converter","notebook-navigator","obsidian-admonition","obsidian-excalidraw-plugin","obsidian-icon-folder","obsidian-inline-comments","obsidian-link-embed","obsidian-local-rest-api","omnisearch","open-terminal-here","pdf-plus","quickadd","realclaudian","recent-files-obsidian","settings-search","tag-wrangler","termy","widgets","workbench-drag-path","workbench-explorer-sort","modular-diary"]
  for (const id of want) { try { await app.plugins.enablePlugin(id) } catch {} }
  return app.plugins.enabledPlugins.size
})
console.log("恢复后启用插件数:", restored)
await browser.close()
