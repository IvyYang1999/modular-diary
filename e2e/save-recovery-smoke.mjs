import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import esbuild from 'esbuild'
import { chromium } from 'playwright'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'modular-diary-save-recovery-'))
const require = createRequire(import.meta.url)
// Exercise the real plugin write paths. Only the host editor and vault IO are
// replaced; source location, ownership, transactions and persistence are real.
const built = await esbuild.build({ entryPoints: [path.join(root, 'src/main.ts')], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['obsidian'] })
const Base = class {}
const obsidian = new Proxy({ Plugin: Base, PluginSettingTab: Base, Modal: Base, MarkdownRenderChild: Base, TFile: class {}, MarkdownView: class {}, Notice: class {} }, { get: (o, k) => o[k] ?? Base })
const context = { module: { exports: {} }, exports: {}, require: n => n === 'obsidian' ? obsidian : require(n), console, setTimeout, clearTimeout }
vm.runInNewContext(built.outputFiles[0].text, context)
const Plugin = context.module.exports.default
const fence = s => '```timeline\n' + s + '\n```'
function fixture(initial) {
  let content = initial, persisted = initial, writes = 0
  const plugin = new Plugin()
  const file = new obsidian.TFile()
  const host = { isConnected: false, closest: () => null, querySelector: () => null }
  const view = new obsidian.MarkdownView()
  // 'source' covers both source mode and Live Preview: the editable panes a
  // block mutation may be written through. Reading view reports 'preview' and
  // is excluded, because its editor never reaches disk.
  view.file = { path: 'synthetic.md' }; view.leaf = {}; view.containerEl = { contains: () => false }
  view.getMode = () => 'source'
  view.editor = {
    getValue: () => content, getLine: n => content.split('\n')[n],
    replaceRange: (insert, from, to) => {
      const offset = pos => content.split('\n').slice(0, pos.line).reduce((n, s) => n + s.length + 1, 0) + pos.ch
      content = content.slice(0, offset(from)) + insert + content.slice(offset(to)); writes++
    },
  }
  view.save = async () => { persisted = content }
  plugin.app = { vault: { getAbstractFileByPath: () => file, read: async () => persisted, process: async (_f, fn) => { content = persisted = fn(content); writes++ } }, workspace: { iterateAllLeaves: fn => fn({ view }), getActiveViewOfType: () => view } }
  plugin.captureScroll = () => ({ internal: {}, viewport: null })
  return { plugin, host, view, get content() { return content }, get persisted() { return persisted }, get writes() { return writes }, setContent: value => { content = persisted = value }, ctx: { sourcePath: 'synthetic.md', docId: 'test', getSectionInfo: () => null } }
}
const original = '08:00-09:00 work\n===\nbefore'
const f = fixture(fence(original))
await f.plugin.applyBlockTransform(f.host, f.ctx, original, s => s.replace('work', 'work note'))
assert.equal(f.persisted, fence(original.replace('work', 'work note')))
const g = fixture(fence(original))
const key = { owner: g.view.leaf, path: 'synthetic.md', docId: 'test', lineStart: -1, blockOrdinal: -1, source: original }
await g.plugin.applyTextBlockTransform(key, s => s.replace('before', 'after'))
assert.equal(g.persisted, fence(original.replace('before', 'after')))
// A stale ordinal must not write the newly inserted first block.
g.setContent(fence('different') + '\n' + g.content)
await g.plugin.applyTextBlockTransform(key, s => s.replace('after', 'final'))
assert.equal(g.persisted, fence('different') + '\n' + fence(original.replace('before', 'final')))
const beforeReject = g.writes
g.setContent(fence('replacement'))
await assert.rejects(g.plugin.applyTextBlockTransform(key, s => s + '\nwrong'))
assert.equal(g.writes, beforeReject)
// Failed disk acknowledgement remains retryable even if the editor mutation
// already applied; a retry must perform a save, not return at a no-op transform.
const h = fixture(fence(original))
const retryKey = { ...key, owner: h.view.leaf, source: original }
h.view.save = async () => { throw new Error('synthetic disk failure') }
await assert.rejects(h.plugin.applyTextBlockTransform(retryKey, s => s.replace('before', 'pending')))
let retrySaves = 0
h.view.save = async () => { retrySaves++; h.setContent(h.content) }
await h.plugin.applyTextBlockTransform(retryKey, s => s.replace('before', 'pending'))
assert.equal(retrySaves, 1)
assert.equal(h.persisted, fence(original.replace('before', 'pending')))
const duplicate = fixture(fence(original) + '\n' + fence(original))
await duplicate.plugin.applyTextBlockTransform({ ...key, owner: duplicate.view.leaf, source: original, section: () => ({ lineStart: 5, lineEnd: 9 }) }, s => s.replace('before', 'second-only'))
assert.equal(duplicate.persisted, fence(original) + '\n' + fence(original.replace('before', 'second-only')))
console.log('PASS real plugin writes: lost section, invalid ordinal, moved block, deletion guard, persistence retry')

const ui = await esbuild.build({ stdin: { resolveDir: root, loader: 'ts', contents: `
import { attachInlineTextEditor, flushInlineTextEditors, disposeInlineTextEditors } from './src/render/timeline-view'
import { openNotePopover } from './src/edit/note-popover'
import { createPointerRedrawGate } from './src/edit/pointer-interaction'
HTMLElement.prototype.empty = function() { this.replaceChildren() }
HTMLElement.prototype.createEl = function(tag, opts = {}) { const el = document.createElement(tag); if(opts.cls) el.className=opts.cls; if(opts.text) el.textContent=opts.text; this.append(el); return el }
HTMLElement.prototype.createDiv = function(opts) { return this.createEl('div',opts) }
window.state = { attempts: 0, draft: null, fail: true, noteAttempts: 0, redraws: 0 }
window.mountText = () => {
 const pane = document.createElement('div'); pane.className='modular-diary-text-pane'; pane.id='text'; document.body.append(pane)
 attachInlineTextEditor(pane, 'original', { renderMarkdown:(el,text)=>el.textContent=text, onSave:()=>{state.attempts++; if(state.fail)throw Error('synthetic failure')}, get initialDraft(){return state.draft},onDraftChange:d=>state.draft=d })
}
window.disposeText = async () => { const p=document.querySelector('#text'); await flushInlineTextEditors(p); disposeInlineTextEditors(p); p.remove() }
window.mountNote = () => {
 const c=document.querySelector('.modular-diary-container'); const anchor=c.querySelector('button');
 openNotePopover(c,anchor,anchor.getBoundingClientRect(),'original',async()=>{state.noteAttempts++; if(state.fail)throw Error('synthetic failure')})
}
window.gate = createPointerRedrawGate()
` }, bundle: true, write: false, format: 'iife' })
const browser = await chromium.launch({ headless: true })
try {
 const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
 await page.setContent('<html><body><div class="modular-diary-container"><button id="anchor">Time block</button></div><button id="outside">Outside</button></body></html>')
 await page.addStyleTag({ path: path.join(root, 'styles.css') })
 await page.addStyleTag({ content: 'body{background:#fafafa;color:#222;font:16px sans-serif;padding:30px}.modular-diary-text-pane{width:400px;height:180px;margin:20px}.modular-diary-note-popover{background:#fff}button{padding:8px}' })
 await page.addScriptTag({ content: ui.outputFiles[0].text })
 await page.evaluate(() => window.mountText())
 await page.locator('#text').click(); await page.locator('#text textarea').fill('draft to preserve')
 await page.locator('#text textarea').press('Control+Enter')
 await page.waitForFunction(() => state.attempts === 1 && state.draft?.saveFailed)
 for(let i=0;i<4;i++) { await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.waitForTimeout(20) }
 assert.equal(await page.evaluate(() => state.attempts), 1)
 await page.evaluate(() => window.disposeText())
 await page.evaluate(() => window.dispatchEvent(new Event('blur')))
 assert.equal(await page.evaluate(() => state.attempts), 1)
 assert.equal(await page.evaluate(() => state.draft.value), 'draft to preserve')
 await page.evaluate(() => window.mountText())
 await page.evaluate(() => window.dispatchEvent(new Event('blur')))
 assert.equal(await page.evaluate(() => state.attempts), 1)
 await page.screenshot({ path: path.join(out, 'text-retry.png') })
 await page.evaluate(() => { state.fail=false })
 await page.locator('#text .modular-diary-save-retry').click()
 await page.waitForFunction(() => state.attempts===2 && state.draft===null)
 await page.evaluate(() => { state.fail=true; window.mountNote() })
 await page.locator('.modular-diary-note-popover input').fill('note to preserve')
 const allowed = await page.evaluate(() => gate.run(document.querySelector('.modular-diary-container'),()=>state.redraws++))
 assert.equal(allowed, false)
 await page.locator('.modular-diary-note-popover input').press('Enter')
 await page.waitForFunction(() => state.noteAttempts===1 && !document.querySelector('.modular-diary-save-retry[hidden]'))
 for(let i=0;i<3;i++) { await page.locator('#outside').click(); await page.locator('.modular-diary-note-popover input').click() }
 assert.equal(await page.evaluate(() => state.noteAttempts), 1)
 await page.evaluate(() => window.mountNote())
 assert.equal(await page.locator('.modular-diary-note-popover input').inputValue(), 'note to preserve')
 await page.screenshot({ path: path.join(out, 'note-retry.png') })
 // Failed editor stays visible when its anchor reaches the viewport edge.
 await page.evaluate(() => { const a=document.querySelector('#anchor'); a.style.position='fixed'; a.style.right='0'; a.style.bottom='0'; window.dispatchEvent(new Event('resize')) })
 await page.waitForTimeout(40)
 const bounds = await page.locator('.modular-diary-note-popover').boundingBox()
 assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 900 && bounds.y + bounds.height <= 700)
 await page.locator('.modular-diary-note-popover .modular-diary-save-retry').hover()
 await page.screenshot({ path: path.join(out, 'note-retry-edge.png') })
 await page.addStyleTag({ content:'body{background:#202020;color:#eee}.modular-diary-note-popover{background:#303030;color:#eee}input,textarea,button{color:inherit;background:#303030}' })
 await page.screenshot({ path: path.join(out, 'note-retry-dark.png') })
 await page.evaluate(() => { state.fail=false })
 await page.locator('.modular-diary-note-popover .modular-diary-save-retry').click()
 await page.waitForFunction(() => !document.querySelector('.modular-diary-note-popover') && state.redraws===1)
 assert.equal(await page.evaluate(() => state.noteAttempts), 2)
 console.log('PASS browser: failed draft survives detach/remount, no automatic retries, manual recovery, external edit blocks redraw')
 console.log('Visual evidence: ' + out)
} finally { await browser.close() }
