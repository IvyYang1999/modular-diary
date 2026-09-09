/** Hot-reload the oneday plugin inside a running Obsidian (debug port 9333). */
import { chromium } from "playwright"
const browser = await chromium.connectOverCDP("http://127.0.0.1:9333")
let page = null
for (const ctx of browser.contexts()) for (const p of ctx.pages()) { if (await p.evaluate(() => Boolean(window.app?.plugins)).catch(() => false)) { page = p; break } }
const r = await page.evaluate(async () => { const pl = window.app.plugins; await pl.disablePlugin("oneday"); await pl.enablePlugin("oneday"); return { enabled: pl.enabledPlugins.has("oneday"), loaded: Boolean(pl.plugins.oneday) } })
console.log("reloaded", JSON.stringify(r))
await browser.close()
