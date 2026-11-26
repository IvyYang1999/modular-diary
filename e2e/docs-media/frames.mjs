#!/usr/bin/env node
/** Review a GIF: write N evenly spaced, fully composited frames as PNGs. node frames.mjs <gif> <outDir> [n] */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { GifReader } = require('omggif')
const { PNG } = require('pngjs')
const [file, outDir, count = '8'] = process.argv.slice(2)
const reader = new GifReader(fs.readFileSync(file))
const { width, height } = reader
const canvas = new Uint8Array(width * height * 4)
const total = reader.numFrames()
const picks = new Set(Array.from({ length: Number(count) }, (_, index) => Math.round((index * (total - 1)) / Math.max(1, Number(count) - 1))))
fs.mkdirSync(outDir, { recursive: true })
let time = 0
for (let index = 0; index < total; index++) {
  reader.decodeAndBlitFrameRGBA(index, canvas)
  const info = reader.frameInfo(index)
  if (picks.has(index)) {
    const png = new PNG({ width, height })
    png.data = Buffer.from(canvas)
    const name = path.join(outDir, `${path.basename(file, '.gif')}-${String(index).padStart(3, '0')}-${(time / 100).toFixed(1)}s.png`)
    fs.writeFileSync(name, PNG.sync.write(png))
    console.log(name)
  }
  time += info.delay
}
console.log(`frames ${total}, ${(time / 100).toFixed(1)}s`)
