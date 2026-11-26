#!/usr/bin/env node
/**
 * The README header image: brand stripe, logo, name, tagline, and a collage of
 * the real screenshots (run `run.mjs stills` first: it leaves full-window
 * captures in the work folder). Rendered from HTML at 2x.
 *   node e2e/docs-media/banner.mjs  →  docs/media/banner.png
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const MEDIA = path.join(ROOT, 'docs', 'media')
const logo = fs.readFileSync(path.join(ROOT, 'site', 'logo.svg'), 'utf8')
const WORK = path.join(os.tmpdir(), 'modular-diary-docs')
const url = (file) => `file://${path.join(WORK, file)}`
const W = 1280, H = 560
const colors = { red: '#f47b74', amber: '#f4a437', green: '#a0c849', blue: '#53a3f2', violet: '#ae7ee2' }
const chips = [['Timeline', colors.blue], ['Todos', colors.amber], ['Rhythms', colors.green], ['Week & month', colors.violet]]

const html = `<!doctype html><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body { width: ${W}px; height: ${H}px; overflow: hidden; background: #fff; font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif; color: #1f1f1f; position: relative; }
  .rule { position: absolute; inset: 0 0 auto 0; height: 8px; display: flex; }
  .rule i { flex: 1; }
  .copy { position: absolute; left: 72px; top: 92px; width: 500px; }
  .brand { display: flex; align-items: center; gap: 18px; }
  .brand svg { width: 72px; height: 72px; }
  h1 { font-size: 54px; font-weight: 650; letter-spacing: -0.02em; }
  .tag { margin-top: 34px; font-size: 30px; font-weight: 600; letter-spacing: -0.01em; line-height: 1.25; }
  .sub { margin-top: 14px; font-size: 18px; line-height: 1.55; color: #5f5f5f; }
  .chips { margin-top: 30px; display: flex; gap: 9px; }
  .chip { display: inline-flex; align-items: center; gap: 8px; padding: 6px 13px; border: 1px solid #e6e6e6; border-radius: 999px; font-size: 14px; color: #333; background: #fff; white-space: nowrap; }
  .chip i { width: 9px; height: 9px; border-radius: 50%; }
  .shot { position: absolute; border-radius: 14px; background-color: #fff; background-repeat: no-repeat; border: 1px solid #e7e7e7; box-shadow: 0 24px 60px rgba(30, 30, 40, 0.14), 0 4px 14px rgba(30, 30, 40, 0.06); }
  .back { left: 690px; top: 46px; width: 640px; height: 330px; background-image: url("${url('banner-week.png')}"); background-size: ${1180 * 0.62}px auto; background-position: -${300 * 0.62}px -${105 * 0.62}px; transform: rotate(2.2deg); opacity: 0.96; }
  .front { left: 600px; top: 176px; width: 620px; height: 420px; background-image: url("${url('banner-day.png')}"); background-size: ${1180 * 0.74}px auto; background-position: -${28 * 0.74}px -${58 * 0.74}px; }
</style>
<div class="rule">${Object.values(colors).map((c) => `<i style="background:${c}"></i>`).join('')}</div>
<div class="copy">
  <div class="brand">${logo}<h1>Modular Diary</h1></div>
  <p class="tag">One page for your day.<br>Make it yours.</p>
  <p class="sub">A timeline you draw on, modules you arrange, and a week and month planned around it. All of it plain Markdown in your vault.</p>
  <div class="chips">${chips.map(([name, c]) => `<span class="chip"><i style="background:${c}"></i>${name}</span>`).join('')}</div>
</div>
<div class="shot back"></div>
<div class="shot front"></div>`

const file = path.join(MEDIA, 'banner.html')
fs.writeFileSync(file, html)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 })
  await page.goto(`file://${file}`)
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(MEDIA, 'banner.png') })
} finally {
  await browser.close()
  fs.rmSync(file)
}
console.log(path.join(MEDIA, 'banner.png'))
