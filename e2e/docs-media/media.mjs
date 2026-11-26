/**
 * Screenshots and GIFs of a live page.
 *
 * GIFs: frames come from the browser's screencast (only when the page
 * changes, with timestamps, so the timing is the real one). They share one
 * palette, and each frame after the first stores only the rectangle that
 * changed, which keeps a UI recording small.
 *
 * Needs (not in package.json): npm i --no-save gifenc@1.0.3 omggif@1.0.10 pngjs@7.0.0
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { sleep } from './obsidian.mjs'

const require = createRequire(import.meta.url)
const { applyPalette, quantize } = require('gifenc')
const { GifWriter } = require('omggif')
const { PNG } = require('pngjs')

/** A drawn cursor: a screen recording does not include the real one. Pressed, it shows a ring. */
export async function installCursor(page) {
  await page.evaluate(() => {
    if (document.getElementById('docs-cursor')) return
    const cursor = document.createElement('div')
    cursor.id = 'docs-cursor'
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '22'); svg.setAttribute('height', '22')
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', 'M4 2.5 L4 19 L8.4 14.9 L11.3 21.4 L14.2 20.1 L11.4 13.8 L17.6 13.8 Z')
    path.setAttribute('fill', '#1f1f1f'); path.setAttribute('stroke', '#ffffff'); path.setAttribute('stroke-width', '1.6'); path.setAttribute('stroke-linejoin', 'round')
    svg.appendChild(path)
    const ring = document.createElement('div')
    Object.assign(ring.style, { position: 'absolute', left: '-9px', top: '-9px', width: '22px', height: '22px', borderRadius: '50%', background: 'rgba(135, 91, 239, 0.28)', border: '2px solid rgba(135, 91, 239, 0.75)', opacity: '0', transition: 'opacity 120ms' })
    cursor.append(ring, svg)
    Object.assign(cursor.style, { position: 'fixed', left: '0', top: '0', zIndex: '2147483647', pointerEvents: 'none', transform: 'translate(-200px, -200px)' })
    Object.assign(svg.style, { position: 'absolute', left: '-4px', top: '-3px', filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,.35))' })
    document.body.appendChild(cursor)
    const at = (event) => { cursor.style.transform = `translate(${event.clientX}px, ${event.clientY}px)` }
    window.addEventListener('pointermove', at, true)
    window.addEventListener('pointerdown', (event) => { at(event); ring.style.opacity = '1' }, true)
    window.addEventListener('pointerup', (event) => { at(event); ring.style.opacity = '0' }, true)
    window.addEventListener('pointercancel', () => { ring.style.opacity = '0' }, true)
  })
}

export async function hideCursor(page) {
  await page.evaluate(() => { const cursor = document.getElementById('docs-cursor'); if (cursor) cursor.style.transform = 'translate(-200px, -200px)' })
}

let pointer = { x: 0, y: 0 }
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)

/** Move the pointer like a hand: eased, over `ms`. */
export async function glide(page, x, y, ms = 500) {
  const from = { ...pointer }
  const steps = Math.max(2, Math.round(ms / 16))
  for (let step = 1; step <= steps; step++) {
    const t = ease(step / steps)
    await page.mouse.move(from.x + (x - from.x) * t, from.y + (y - from.y) * t)
    await sleep(ms / steps)
  }
  pointer = { x, y }
}

export function placePointer(x, y) { pointer = { x, y } }

export async function drag(page, from, to, { ms = 700, hold = 160 } = {}) {
  await glide(page, from.x, from.y, 450)
  await page.mouse.down()
  await sleep(hold)
  await glide(page, from.x + (to.x - from.x) * 0.08, from.y + (to.y - from.y) * 0.08, 120)
  await glide(page, to.x, to.y, ms)
  await sleep(hold)
  await page.mouse.up()
}

export async function click(page, x, y, { ms = 450, pause = 140 } = {}) {
  await glide(page, x, y, ms)
  await page.mouse.down()
  await sleep(pause)
  await page.mouse.up()
}

/** Centre of an element, in page (CSS) pixels. */
export async function centre(locator, dx = 0, dy = 0) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('element has no box')
  return { x: box.x + box.width / 2 + dx, y: box.y + box.height / 2 + dy }
}

/** Record `action` as frames of `clip` (CSS pixels). */
export async function record(page, clip, action, { lead = 700, tail = 1600 } = {}) {
  const session = await page.context().newCDPSession(page)
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  const frames = []
  session.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    frames.push({ data, t: metadata.timestamp })
    session.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
  })
  await session.send('Page.startScreencast', { format: 'png', maxWidth: viewport.width, maxHeight: viewport.height, everyNthFrame: 1 })
  await sleep(lead)
  const started = Date.now() / 1000
  await action()
  await sleep(tail)
  const ended = Date.now() / 1000
  await session.send('Page.stopScreencast')
  await session.detach().catch(() => {})
  if (!frames.length) throw new Error('no frames recorded')
  // The first frame may predate `lead`; the hold at the end is the tail.
  frames[0].t = Math.max(frames[0].t, started - lead / 1000)
  frames.push({ data: null, t: ended })
  return { frames, clip, viewport }
}

function decode(data) {
  return PNG.sync.read(Buffer.from(data, 'base64'))
}

function crop(png, clip, scale) {
  const x0 = Math.round(clip.x * scale), y0 = Math.round(clip.y * scale)
  const width = Math.round(clip.width * scale), height = Math.round(clip.height * scale)
  const out = new Uint8Array(width * height * 4)
  for (let row = 0; row < height; row++) {
    const from = ((y0 + row) * png.width + x0) * 4
    out.set(png.data.subarray(from, from + width * 4), row * width * 4)
  }
  return { width, height, data: out }
}

/** Write the recording as a GIF; frames closer than 1/fps collapse into the later one. */
export function writeGif(recording, file, { fps = 15, maxColors = 256 } = {}) {
  const { frames, clip, viewport } = recording
  const minGap = 1 / fps
  const kept = []
  for (let index = 0; index < frames.length - 1; index++) {
    const frame = frames[index]
    if (kept.length && frame.t - kept[kept.length - 1].t < minGap) kept[kept.length - 1].data = frame.data
    else kept.push({ ...frame })
  }
  const end = frames[frames.length - 1].t
  const first = decode(kept[0].data)
  const scale = first.width / viewport.width
  const images = kept.map((frame, index) => crop(index === 0 ? first : decode(frame.data), clip, scale))
  const { width, height } = images[0]
  // One palette for every frame, from a spread of frames.
  const sample = images.filter((_, index) => index % Math.max(1, Math.floor(images.length / 10)) === 0)
  const joined = new Uint8Array(sample.reduce((sum, image) => sum + image.data.length, 0))
  let offset = 0
  for (const image of sample) { joined.set(image.data, offset); offset += image.data.length }
  const palette = quantize(joined, maxColors, { format: 'rgb565' })
  while (palette.length < 256) palette.push([0, 0, 0])
  const paletteInts = palette.slice(0, 256).map(([r, g, b]) => (r << 16) | (g << 8) | b)
  const buffer = new Uint8Array(width * height * images.length + 1024 * 1024)
  const writer = new GifWriter(buffer, width, height, { palette: paletteInts, loop: 0 })
  let previous = null
  let pending = null
  const flush = (delaySeconds) => {
    if (!pending) return
    const cs = Math.max(2, Math.round(delaySeconds * 100))
    writer.addFrame(pending.x, pending.y, pending.w, pending.h, pending.pixels, { delay: cs, disposal: 1 })
    pending = null
  }
  let pendingStart = kept[0].t
  images.forEach((image, index) => {
    const indexed = applyPalette(image.data, palette.slice(0, 256), 'rgb565')
    let x = 0, y = 0, w = width, h = height
    if (previous) {
      let minX = width, minY = height, maxX = -1, maxY = -1
      for (let row = 0; row < height; row++) {
        const base = row * width
        for (let col = 0; col < width; col++) {
          if (indexed[base + col] !== previous[base + col]) {
            if (col < minX) minX = col
            if (col > maxX) maxX = col
            if (row < minY) minY = row
            if (row > maxY) maxY = row
          }
        }
      }
      if (maxX < 0) return // nothing changed: the previous frame simply lasts longer
      x = minX; y = minY; w = maxX - minX + 1; h = maxY - minY + 1
    }
    flush(kept[index].t - pendingStart)
    const pixels = new Uint8Array(w * h)
    for (let row = 0; row < h; row++) pixels.set(indexed.subarray((y + row) * width + x, (y + row) * width + x + w), row * w)
    pending = { x, y, w, h, pixels }
    pendingStart = kept[index].t
    previous = indexed
  })
  flush(end - pendingStart)
  const length = writer.end()
  fs.writeFileSync(file, Buffer.from(buffer.subarray(0, length)))
  return { file, width, height, frames: images.length, bytes: length, seconds: Math.round((end - kept[0].t) * 10) / 10 }
}

/** A crisp still of `clip` (device pixels: 2x on a Retina screen). */
export async function still(page, file, clip) {
  await page.screenshot({ path: file, clip, animations: 'disabled' })
  return file
}
