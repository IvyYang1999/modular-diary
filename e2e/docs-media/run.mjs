#!/usr/bin/env node
/**
 * README media from a real Obsidian: an isolated profile and demo vault
 * (e2e/docs-media/vault.mjs), English UI, the built plugin from this repo.
 * The window is invisible and click-through; nothing touches your own vault.
 *
 *   npm run bundle
 *   npm i --no-save gifenc@1.0.3 omggif@1.0.10 pngjs@7.0.0
 *   node e2e/docs-media/run.mjs [stills] [hero] [modules] [week] [event]   (default: all)
 *
 * Output: docs/media/*.png and *.gif
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchObsidian, localDate, prepareApp, sleep } from './obsidian.mjs'
import { centre, click, drag, glide, hideCursor, installCursor, placePointer, record, still, writeGif } from './media.mjs'
import { writeDemoVault } from './vault.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = path.join(ROOT, 'docs', 'media')
const WORK = path.join(os.tmpdir(), 'modular-diary-docs')
const WIDTH = 1180, HEIGHT = 800
const HOUR = 18 // the demo's "now": late afternoon, most of the day recorded
const scenes = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
const want = (name) => scenes.length === 0 || scenes.includes(name)
fs.mkdirSync(OUT, { recursive: true })

/** A zone where it is now about HOUR o'clock, so "today" and the now-line look like a working afternoon. */
function zoneForHour(hour) {
  const zones = { '-10': 'Pacific/Honolulu', '-9': 'America/Anchorage', '-8': 'America/Los_Angeles', '-7': 'America/Phoenix', '-6': 'America/Costa_Rica', '-5': 'America/Bogota', '-4': 'America/La_Paz', '-3': 'America/Argentina/Buenos_Aires', '-2': 'Atlantic/South_Georgia', '-1': 'Atlantic/Cape_Verde', '0': 'UTC', '1': 'Africa/Lagos', '2': 'Africa/Johannesburg', '3': 'Asia/Riyadh', '4': 'Asia/Dubai', '5': 'Asia/Karachi', '6': 'Asia/Dhaka', '7': 'Asia/Bangkok', '8': 'Asia/Shanghai', '9': 'Asia/Tokyo', '10': 'Australia/Brisbane', '11': 'Pacific/Guadalcanal', '12': 'Pacific/Fiji', '13': 'Pacific/Tongatapu', '14': 'Pacific/Kiritimati' }
  let offset = ((hour - new Date().getUTCHours()) % 24 + 24) % 24
  if (offset > 14) offset -= 24
  return zones[String(offset)]
}

const zone = zoneForHour(HOUR)
const today = localDate(zone)
const vault = path.join(WORK, 'vault')

/** A fresh vault and Obsidian, today's note open, the cursor drawn. */
async function session() {
  writeDemoVault(vault, { today, pluginFiles: ROOT })
  const app = await launchObsidian({ profile: path.join(WORK, 'profile'), vault, port: 9471, width: WIDTH, height: HEIGHT, visible: process.argv.includes('--visible') })
  const { page } = app
  await prepareApp(page, 'modular-diary')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setTimezoneOverride', { timezoneId: zone })
  await page.evaluate(() => { app.workspace.leftSplit?.collapse(); app.workspace.rightSplit?.collapse() })
  await openToday(page)
  await installCursor(page)
  return app
}

async function openToday(page) {
  await page.evaluate((file) => app.workspace.openLinkText(file, '', false), `Journal/${today}`)
  await page.waitForSelector('.modular-diary-container .modular-diary-view-bar', { state: 'attached', timeout: 20000 })
  await sleep(1200)
}

/** The note's scroller and the block's box. */
async function blockBox(page) {
  return page.locator('.workspace-leaf.mod-active .modular-diary-container:visible').first().boundingBox()
}

async function scrollNote(page, top) {
  await page.evaluate((top) => {
    const scroller = document.querySelector('.workspace-leaf.mod-active .markdown-preview-view, .workspace-leaf.mod-active .cm-scroller')
    if (scroller) scroller.scrollTop = top
  }, top)
  await sleep(300)
}

async function switchView(page, label) {
  await page.locator('.workspace-leaf.mod-active .modular-diary-seg button:visible', { hasText: new RegExp(`^${label}$`) }).first().click()
  await sleep(1600)
}

/** Clip of the block, inside the window. */
async function blockClip(page, { top = 0, height } = {}) {
  const box = await blockBox(page)
  const y = Math.max(0, box.y + top)
  return { x: Math.max(0, box.x - 8), y, width: Math.min(WIDTH, box.width + 16), height: Math.min(height ?? HEIGHT - y, HEIGHT - y) }
}

/** Park the pointer somewhere neutral and hide the drawn cursor, for a still. */
async function park(page) {
  await page.mouse.move(WIDTH - 4, 52)
  placePointer(WIDTH - 4, 52)
  await hideCursor(page)
  await sleep(250)
}

/** Page y of a clock time on the day timeline, from the hour labels. */
async function timeY(page, hours) {
  const labels = await page.locator('.workspace-leaf.mod-active svg.modular-diary-svg text.modular-diary-hour:visible').evaluateAll((nodes) => nodes.map((node) => { const box = node.getBoundingClientRect(); return { hour: Number(node.textContent), y: box.y + box.height / 2 } }))
  const a = labels.find((label) => label.hour === Math.floor(hours)), b = labels.find((label) => label.hour === Math.floor(hours) + 1)
  if (!a || !b) throw new Error(`no hour labels around ${hours}`)
  return a.y + (b.y - a.y) * (hours - Math.floor(hours))
}

async function trackX(page) {
  const box = await page.locator('.workspace-leaf.mod-active rect.modular-diary-block:visible').first().boundingBox()
  return box.x + box.width / 2
}

const scenesToRun = []
if (want('stills')) scenesToRun.push(['stills', async (page) => {
  await scrollNote(page, 0)
  await park(page)
  const full = { x: 0, y: 0, width: WIDTH, height: HEIGHT }
  const out = [await still(page, path.join(OUT, 'day.png'), full)]
  // Full-window sources for the banner (banner.mjs), kept out of the repo.
  await still(page, path.join(WORK, 'banner-day.png'), full)
  // The period views are shorter than the window: stop just under the block.
  const periodClip = async () => {
    const period = await page.locator('.workspace-leaf.mod-active .modular-diary-container:visible').first().boundingBox()
    const top = Math.max(0, Math.floor(period.y - 14))
    return { x: 0, y: top, width: WIDTH, height: Math.min(HEIGHT, Math.ceil(period.y + period.height + 16)) - top }
  }
  await switchView(page, 'Week')
  await park(page)
  out.push(await still(page, path.join(OUT, 'week.png'), await periodClip()))
  // What actually happened: the week on an hour axis, the month as a strip per day.
  await switchView(page, 'Actual')
  await park(page)
  out.push(await still(page, path.join(OUT, 'week-actual.png'), await periodClip()))
  await still(page, path.join(WORK, 'banner-week.png'), full)
  await switchView(page, 'Month')
  await park(page)
  // The calendar only: the month's grid of days.
  const main = await page.locator('.workspace-leaf.mod-active .modular-diary-period-main:visible').first().boundingBox()
  out.push(await still(page, path.join(OUT, 'month.png'), { x: main.x, y: main.y, width: main.width, height: Math.min(HEIGHT - main.y, main.height) }))
  return out
}])

if (want('hero')) scenesToRun.push(['hero', async (page) => {
  await scrollNote(page, 0)
  const box = await blockBox(page)
  const clip = { x: 0, y: box.y - 10, width: WIDTH, height: HEIGHT - (box.y - 10) }
  placePointer(WIDTH * 0.45, HEIGHT * 0.55)
  const recording = await record(page, clip, async () => {
    await glide(page, WIDTH * 0.45, HEIGHT * 0.55, 200)
    // Pick a category, then draw what actually happened over the plan.
    await click(page, ...Object.values(await centre(page.locator('.workspace-leaf.mod-active .modular-diary-slot-toolbar button:visible', { hasText: /^Exercise$/ }).first())))
    const x = await trackX(page)
    await drag(page, { x, y: await timeY(page, 17.25) }, { x, y: await timeY(page, 17.75) }, { ms: 900 })
    // Let the note write and the block redraw before the next gesture.
    await glide(page, WIDTH * 0.35, HEIGHT * 0.45, 700)
    await sleep(1400)
    // A todo dragged onto the timeline becomes a plan block of its length.
    const source = page.locator('.workspace-leaf.mod-active .modular-diary-slot-todos .modular-diary-todo-row:visible', { hasText: 'Reply to design feedback' }).locator('.modular-diary-schedule-source').first()
    await drag(page, await centre(source), { x, y: await timeY(page, 19.25) }, { ms: 1100 })
    await sleep(900)
    // And a tick.
    const check = page.locator('.workspace-leaf.mod-active .modular-diary-slot-todos .modular-diary-todo-row:visible', { hasText: 'Book the dentist' }).locator('.modular-diary-todo-check').first()
    await click(page, ...Object.values(await centre(check)))
    await sleep(600)
    await glide(page, WIDTH * 0.5, HEIGHT * 0.5, 500)
  })
  return [writeGif(recording, path.join(OUT, 'hero.gif'))]
}])

if (scenes.includes('drop')) scenesToRun.push(['drop', async (page) => {
  page.on('console', (message) => { if (message.type() === 'error' || message.text().includes('Modular')) console.log('console:', message.text().slice(0, 300)) })
  await scrollNote(page, 0)
  const x = await trackX(page)
  const y = await timeY(page, 19.25)
  const row = page.locator('.workspace-leaf.mod-active .modular-diary-slot-todos .modular-diary-todo-row:visible', { hasText: 'Reply to design feedback' })
  const source = row.locator('.modular-diary-schedule-source').first()
  console.log('rows', await row.count(), 'sources', await row.locator('.modular-diary-schedule-source').count(), 'box', JSON.stringify(await source.boundingBox()), 'target', x, y)
  placePointer(400, 300)
  await drag(page, await centre(source), { x, y }, { ms: 1100 })
  await sleep(1500)
  await page.screenshot({ path: path.join(WORK, 'drop.png') })
  return []
}])

if (want('modules')) scenesToRun.push(['modules', async (page) => {
  await scrollNote(page, 0)
  const habits = page.locator('.workspace-leaf.mod-active .modular-diary-slot-habits:visible').first()
  const todos = page.locator('.workspace-leaf.mod-active .modular-diary-slot-todos:visible').first()
  // The left column of the block: from the quick-capture box down, stopping short of the timeline.
  const block = await blockBox(page)
  const dialog = await page.locator('.workspace-leaf.mod-active .modular-diary-slot-dialog:visible').first().boundingBox()
  const timeline = await page.locator('.workspace-leaf.mod-active .modular-diary-slot-timeline:visible').first().boundingBox()
  const clip = { x: block.x + 2, y: dialog.y - 14, width: timeline.x - block.x - 10, height: HEIGHT - dialog.y + 14 }
  const habitsBox = await habits.boundingBox()
  const todosBox = await todos.boundingBox()
  placePointer(habitsBox.x + 200, habitsBox.y + 40)
  const recording = await record(page, clip, async () => {
    await glide(page, habitsBox.x + 120, habitsBox.y + 30, 500)
    await sleep(400)
    const grip = habits.locator('.modular-diary-slot-grip').first()
    const from = await centre(grip)
    await drag(page, from, { x: from.x + 4, y: todosBox.y + 6 }, { ms: 1300, hold: 260 })
    await sleep(900)
    await glide(page, from.x + 220, todosBox.y + 160, 600)
  })
  return [writeGif(recording, path.join(OUT, 'modules.gif'))]
}])

if (want('week')) scenesToRun.push(['week', async (page) => {
  await scrollNote(page, 0)
  const clip = { x: 0, y: 44, width: WIDTH, height: HEIGHT - 44 }
  placePointer(WIDTH * 0.5, HEIGHT * 0.4)
  clip.height = Math.min(clip.height, 575)
  const recording = await record(page, clip, async () => {
    const weekButton = page.locator('.workspace-leaf.mod-active .modular-diary-seg button:visible', { hasText: /^Week$/ }).first()
    await click(page, ...Object.values(await centre(weekButton)))
    await sleep(1800)
    const row = page.locator('.workspace-leaf.mod-active .modular-diary-period-rail .modular-diary-todo-row:visible', { hasText: 'A note on distributed' }).first()
    const sunday = page.locator('.workspace-leaf.mod-active .modular-diary-plan-band[data-zone$="@am"]:visible').last()
    await drag(page, await centre(row, 30), await centre(sunday, 0, 10), { ms: 1400 })
    await sleep(1200)
    // A pill moves like the row: Tuesday's dentist goes to Wednesday afternoon.
    const pill = page.locator('.workspace-leaf.mod-active .modular-diary-plan-pill:visible', { hasText: 'Dentist' }).first()
    const wednesday = page.locator('.workspace-leaf.mod-active .modular-diary-plan-band[data-zone$="@pm"]:visible').nth(2)
    await drag(page, await centre(pill), await centre(wednesday, 0, 12), { ms: 1100 })
    await sleep(1000)
    await glide(page, WIDTH * 0.7, HEIGHT * 0.75, 500)
  })
  return [writeGif(recording, path.join(OUT, 'week.gif'))]
}])

if (want('event')) scenesToRun.push(['event', async (page) => {
  await scrollNote(page, 0)
  await switchView(page, 'Week')
  await park(page)
  const period = await page.locator('.workspace-leaf.mod-active .modular-diary-period:visible').first().boundingBox()
  const clip = { x: 0, y: 44, width: WIDTH, height: Math.min(HEIGHT - 44, period.y + period.height + 12 - 44) }
  placePointer(WIDTH * 0.5, HEIGHT * 0.5)
  const recording = await record(page, clip, async () => {
    const add = page.locator('.workspace-leaf.mod-active .modular-diary-period-icon[aria-label="New event"]:visible').first()
    await click(page, ...Object.values(await centre(add)))
    await page.waitForSelector('.modular-diary-quick-schedule-input')
    await sleep(500)
    await page.keyboard.type('Fri 7pm dinner with Sam @Meals 2h', { delay: 70 })
    await sleep(1400)
    await page.keyboard.press('Enter')
    await sleep(1600)
    await glide(page, WIDTH * 0.78, HEIGHT * 0.7, 600)
  })
  return [writeGif(recording, path.join(OUT, 'event.gif'))]
}])

const results = []
for (const [name, scene] of scenesToRun) {
  const app = await session()
  try {
    const out = await scene(app.page)
    results.push(...out)
    // What each scene left in the notes, for a quick check.
    if (process.argv.includes('--dump')) console.log(name, fs.readFileSync(path.join(vault, 'Journal', `${today}.md`), 'utf8').split('\n').filter((line) => /^(plan )?\d|todo:/.test(line)).slice(-6).join('\n'))
  } catch (error) {
    console.error(`scene ${name} failed`, error)
    await app.page.screenshot({ path: path.join(WORK, `failed-${name}.png`) }).catch(() => {})
    process.exitCode = 1
  } finally {
    await app.quit()
  }
}
console.log(JSON.stringify(results, null, 1))
