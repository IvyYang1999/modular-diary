/** hosts=0?! 笔记开了却没有块——查插件是否被禁用（你禁用测试后没重开？）+ CPU 归因 */
import { chromium } from "playwright"
const browser = await chromium.connectOverCDP("http://127.0.0.1:9333")
const page = browser.contexts()[0].pages()[0]
const info = await page.evaluate(() => ({
  modularDiaryEnabled: app.plugins.enabledPlugins.has("modular-diary"),
  manifestLoaded: !!app.plugins.manifests?.["modular-diary"],
  enabledCount: app.plugins.enabledPlugins.size,
  enabledList: [...app.plugins.enabledPlugins],
}))
console.log(JSON.stringify(info, null, 1))
await browser.close()
