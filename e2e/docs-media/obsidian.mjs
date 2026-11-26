/**
 * A separate Obsidian (own profile, own demo vault) driven over the debugging
 * port, for README screenshots and GIFs. It is started in the background and
 * its window is made transparent and click-through, so it never covers or
 * takes input from the Obsidian you are working in. Rendering keeps going
 * while hidden (the occlusion / backgrounding switches below).
 */
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const APP = '/Applications/Obsidian.app'

export async function launchObsidian({ profile, vault, port, width = 1280, height = 860, visible = false }) {
  // A previous run that is still shutting down would hold the port and the profile.
  if (spawnSync('pkill', ['-f', `--user-data-dir=${profile}`]).status === 0) await sleep(1500)
  fs.mkdirSync(profile, { recursive: true })
  fs.writeFileSync(path.join(profile, 'obsidian.json'), JSON.stringify({ vaults: { docs: { path: vault, ts: Date.now(), open: true } } }))
  // -g: do not bring Obsidian to the front; -n: a new instance with its own profile.
  execFileSync('open', ['-g', '-n', '-a', APP, '--args',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'])
  const deadline = Date.now() + 40000
  while (Date.now() < deadline) {
    try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break } catch {}
    await sleep(300)
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  const context = browser.contexts()[0]
  let page = null
  while (!page && Date.now() < deadline + 20000) {
    page = context.pages().find((candidate) => candidate.url().startsWith('app://')) ?? null
    if (!page) await sleep(300)
  }
  if (!page) throw new Error('Obsidian window not found')
  await page.waitForFunction(() => Boolean(globalThis.app?.workspace), null, { timeout: 30000 })
  await shapeWindow(page, { width, height, visible })
  return { browser, page, quit: () => quit(page, profile) }
}

/** Fixed size; unless `visible`, transparent and click-through. */
export async function shapeWindow(page, { width, height, visible }) {
  await page.evaluate(({ width, height, visible }) => {
    const electron = window.require('electron')
    const remote = electron.remote ?? window.require('@electron/remote')
    const win = remote.getCurrentWindow()
    win.setContentSize(width, height)
    if (!visible) { win.setOpacity(0); win.setIgnoreMouseEvents(true) }
  }, { width, height, visible })
}

async function quit(page, profile) {
  await page.evaluate(() => { const electron = window.require('electron'); (electron.remote ?? window.require('@electron/remote')).app.quit() }).catch(() => {})
  await sleep(800)
  // Belt and braces: anything still running with this profile.
  spawnSync('pkill', ['-f', `--user-data-dir=${profile}`])
}

/** Community plugins on, the plugin enabled, Obsidian in English; reloads once if the language had to change. */
export async function prepareApp(page, pluginId) {
  const needsReload = await page.evaluate(() => {
    if (localStorage.getItem('language') === 'en') return false
    localStorage.setItem('language', 'en')
    return true
  })
  if (needsReload) await page.evaluate(() => window.location.reload())
  await page.waitForFunction(() => Boolean(globalThis.app?.workspace?.layoutReady), null, { timeout: 30000 })
  await page.evaluate(async (id) => {
    if (!app.plugins.isEnabled?.() && app.plugins.setEnable) await app.plugins.setEnable(true)
    if (!app.plugins.plugins[id]) await app.plugins.enablePlugin(id)
  }, pluginId)
  await page.waitForFunction((id) => Boolean(app.plugins.plugins[id]), pluginId, { timeout: 20000 })
  await page.keyboard.press('Escape').catch(() => {})
}

/** Make "now" a given local wall-clock hour by picking a time zone, so the now-line sits where the demo wants it. */
export async function setLocalHour(page, hour) {
  const zones = { '-10': 'Pacific/Honolulu', '-9': 'America/Anchorage', '-8': 'America/Los_Angeles', '-7': 'America/Phoenix', '-6': 'America/Costa_Rica', '-5': 'America/Bogota', '-4': 'America/La_Paz', '-3': 'America/Argentina/Buenos_Aires', '-2': 'Atlantic/South_Georgia', '-1': 'Atlantic/Cape_Verde', '0': 'UTC', '1': 'Africa/Lagos', '2': 'Africa/Johannesburg', '3': 'Asia/Riyadh', '4': 'Asia/Dubai', '5': 'Asia/Karachi', '6': 'Asia/Dhaka', '7': 'Asia/Bangkok', '8': 'Asia/Shanghai', '9': 'Asia/Tokyo', '10': 'Australia/Brisbane', '11': 'Pacific/Guadalcanal', '12': 'Pacific/Fiji', '13': 'Pacific/Tongatapu', '14': 'Pacific/Kiritimati' }
  const utcHour = new Date().getUTCHours()
  let offset = ((hour - utcHour) % 24 + 24) % 24
  if (offset > 14) offset -= 24
  const timezoneId = zones[String(offset)]
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setTimezoneOverride', { timezoneId })
  return { timezoneId, session }
}

/** YYYY-MM-DD for a Date in a time zone. */
export function localDate(timeZone, date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}
