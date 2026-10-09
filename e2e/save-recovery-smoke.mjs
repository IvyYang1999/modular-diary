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
const out = process.env.MD_SAVE_RECOVERY_OUT ?? fs.mkdtempSync(path.join(os.tmpdir(), 'modular-diary-save-recovery-'))
fs.mkdirSync(out, { recursive: true })
const require = createRequire(import.meta.url)
const rewritesBuild = await esbuild.build({ entryPoints: [path.join(root, 'src/edit/source-rewriter.ts')], bundle: true, write: false, platform: 'node', format: 'cjs' })
const rewritesContext = { module: { exports: {} }, exports: {} }
vm.runInNewContext(rewritesBuild.outputFiles[0].text, rewritesContext)
const { setHeaderValue, updateTodo, setTextSection } = rewritesContext.module.exports
// Exercise the real plugin write paths. Only the host editor and vault IO are
// replaced; source location, ownership, transactions and persistence are real.
const built = await esbuild.build({ entryPoints: [path.join(root, 'src/main.ts')], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['obsidian'] })
const notices = []
const Base = class {}
const obsidian = new Proxy({ Plugin: Base, PluginSettingTab: Base, Modal: Base, MarkdownRenderChild: Base, TFile: class {}, MarkdownView: class {}, Notice: class { constructor(message) { notices.push(message) } hide() {} } }, { get: (o, k) => o[k] ?? Base })
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
  view.file = { path: 'synthetic.md' }; view.leaf = {}; view.containerEl = { contains: () => false }
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
// Obsidian exposes an Editor in reading mode, but mutating it and calling
// MarkdownView.save() does not write the note. File-backed writes must use
// Vault.process, and an open source pane must block that route.
const reading = fixture(fence(original))
reading.view.getMode = () => 'preview'
reading.view.editor.replaceRange = () => { throw new Error('reading editor must not be written') }
reading.view.save = async () => { throw new Error('reading view save must not be used') }
await reading.plugin.applyBlockTransform(reading.host, reading.ctx, original, s => s.replace('work', 'reading'))
assert.equal(reading.persisted, fence(original.replace('work', 'reading')))
const readingText = fixture(fence(original))
readingText.view.getMode = () => 'preview'
readingText.view.editor.replaceRange = () => { throw new Error('reading editor must not be written') }
readingText.view.save = async () => { throw new Error('reading view save must not be used') }
await readingText.plugin.applyTextBlockTransform({ ...key, owner: readingText.view.leaf, source: original }, s => s.replace('before', 'reading'))
assert.equal(readingText.persisted, fence(original.replace('before', 'reading')))
const readingDelete = fixture(fence(original) + '\nnext paragraph')
readingDelete.view.getMode = () => 'preview'
readingDelete.view.editor.replaceRange = () => { throw new Error('reading editor must not be written') }
readingDelete.view.save = async () => { throw new Error('reading view save must not be used') }
readingDelete.plugin.blockSources.set(readingDelete.host, original)
readingDelete.ctx.getSectionInfo = () => ({ lineStart: 0, lineEnd: 4 })
await readingDelete.plugin.deleteTimelineBlock(readingDelete.host, readingDelete.ctx)
assert.equal(readingDelete.persisted, 'next paragraph')
const mixed = fixture(fence(original))
mixed.view.getMode = () => 'preview'
mixed.view.containerEl.contains = () => true
const sourcePeer = new obsidian.MarkdownView()
sourcePeer.file = { path: 'synthetic.md' }
sourcePeer.getMode = () => 'source'
sourcePeer.containerEl = { contains: () => false }
mixed.plugin.app.workspace.iterateAllLeaves = fn => { fn({ view: mixed.view }); fn({ view: sourcePeer }) }
await assert.rejects(mixed.plugin.applyBlockTransform(mixed.host, mixed.ctx, original, s => s.replace('work', 'unsafe')))
assert.equal(mixed.persisted, fence(original))
// Freeze the interleaving matrix at the real production write boundary.
for (const mode of ['source', 'preview']) {
 for (const action of ['resize', 'layout', 'todo', 'timer', 'timeline', 'other-text']) {
  for (const order of ['action-first', 'text-first', 'parallel']) {
  const base = 'date: 2026-10-09\nblock-size: 700x500\ntodo: id="task" done=false estimate=60 category="work" group="" title="Task"\n---\n08:00-09:00 work\n===\nfirst\n===\nsecond'
  const x = fixture(fence(base)); x.view.getMode = () => mode
  const textKey = { ...key, owner: x.view.leaf, source: base }
  const update = s => action === 'resize' ? setHeaderValue(s, 'block-size', '900x650')
   : action === 'layout' ? setHeaderValue(s, 'layout', 'text@0,0,6,6')
   : action === 'todo' ? updateTodo(s, 'task', { completed: true })
   : action === 'timer' ? s.replace('09:00', '10:00')
   : action === 'timeline' ? s.replace('work', 'work updated')
   : setTextSection(s, 'second saved', 1)
  assert.notEqual(update(base), base, 'The action must actually change source')
  assert.equal(x.plugin.parse(update(base)).errors.length, 0, 'The matrix must use valid product source')
  // Captured from one render; use stale callbacks in all three orderings.
  const change = () => x.plugin.applyBlockTransform(x.host, x.ctx, base, update)
  const save = () => x.plugin.applyTextBlockTransform(textKey, s => s, { index: 0, baseText: 'first', text: 'first saved' })
  if (order === 'action-first') { await change(); await save() }
  else if (order === 'text-first') { await save(); await change() }
  else await Promise.all([change(), save()])
  assert.equal(x.persisted, fence(update(base).replace('first', 'first saved')), mode + '/' + action + '/' + order)
  }
 }
}

const simultaneous = fixture(fence(original + '\n===\nsecond'))
const simultaneousBase = original + '\n===\nsecond'
const k1 = { ...key, owner: simultaneous.view.leaf, source: simultaneousBase }
const k2 = { ...k1 }
await Promise.all([
 simultaneous.plugin.applyTextBlockTransform(k1, s => s.replace('before', 'one'), { index: 0, baseText: 'before', text: 'one' }),
 simultaneous.plugin.applyTextBlockTransform(k2, s => s.replace('second', 'two'), { index: 1, baseText: 'second', text: 'two' }),
])
assert.equal(simultaneous.persisted, fence(original.replace('before', 'one') + '\n===\ntwo'))
const externalConflict = fixture(fence(original))
externalConflict.setContent(fence(original.replace('before', 'external')))
await assert.rejects(externalConflict.plugin.applyTextBlockTransform({ ...key, owner: externalConflict.view.leaf, source: original }, s => s.replace('external', 'draft'), { index: 0, baseText: 'before', text: 'draft' }))
assert.equal(externalConflict.writes, 0)
assert.equal(externalConflict.persisted, fence(original.replace('before', 'external')))
// Ambiguous local lineage cannot fall back to the unchanged duplicate.
const lineageDuplicate = fixture(fence(original) + '\n' + fence(original))
const changedDuplicate = 'block-size: 900x650\n' + original + '\n===\nsecond'
lineageDuplicate.plugin.sourceRevisions.remember(lineageDuplicate.view.leaf, 'synthetic.md', original, changedDuplicate)
lineageDuplicate.setContent(fence(original) + '\n' + fence(changedDuplicate))
await assert.rejects(lineageDuplicate.plugin.applyTextBlockTransform({ ...key, owner: lineageDuplicate.view.leaf, source: original }, s => s, { index: 0, baseText: 'before', text: 'draft' }))
assert.equal(lineageDuplicate.writes, 0)
// Separate fences in the same file: the first write moves the second fence.
const separate = fixture(fence(original) + '\n' + fence('===\nsecond fence'))
await separate.plugin.applyTextBlockTransform({ ...key, owner: separate.view.leaf, source: original }, s => s, { index: 0, baseText: 'before', text: 'one\nextra line' })
await separate.plugin.applyTextBlockTransform({ ...key, owner: separate.view.leaf, source: '===\nsecond fence' }, s => s, { index: 0, baseText: 'second fence', text: 'two' })
assert.equal(separate.persisted, fence(original.replace('before', 'one\nextra line')) + '\n' + fence('===\ntwo'))
// Disposed renderers keep newer typing and its in-memory applied baseline.
const pending = fixture(fence(original))
const pendingKey = { ...key, owner: pending.view.leaf, source: original }
const pendingDraftKey = { ...pendingKey, blockOrdinal: 0, index: 0 }
pending.plugin.textDrafts.set(pendingDraftKey, { baseText: 'before', value: 'submitted', editing: true, shouldFocus: true })
let releaseSave
const gate = new Promise(resolve => { releaseSave = resolve })
pending.view.save = async () => { await gate; pending.setContent(pending.content) }
const firstSave = pending.plugin.saveTextDraft(pendingDraftKey, pendingKey, 'before', 'submitted')
await new Promise(resolve => setTimeout(resolve, 0))
assert.equal(pending.plugin.textDrafts.get(pendingDraftKey).baseText, 'submitted')
pending.plugin.textDrafts.set(pendingDraftKey, { ...pending.plugin.textDrafts.get(pendingDraftKey), value: 'submitted newest' })
// Simulate a metadata/modify roundtrip and a second component write while saving.
const resizedPending = pending.plugin.applyBlockTransform(pending.host, pending.ctx, original, s => 'block-size: 900x650\n' + s)
const newestSave = pending.plugin.saveTextDraft(pendingDraftKey, { ...pendingKey }, 'before', 'submitted newest')
releaseSave()
await Promise.all([firstSave, newestSave, resizedPending])
assert.equal(pending.persisted, fence('block-size: 900x650\n' + original.replace('before', 'submitted newest')))
assert.equal(pending.plugin.textDrafts.get(pendingDraftKey).value, 'submitted newest')
assert.equal(pending.plugin.textDrafts.get(pendingDraftKey).baseText, 'submitted newest')

// Multiple conflict failures retain drafts and share a single notice.
const conflicted = fixture(fence(original.replace('before', 'external')))
const conflictKey = { ...key, owner: conflicted.view.leaf, source: original }
const conflictDraftKey = { ...conflictKey, blockOrdinal: 0, index: 0 }
conflicted.plugin.textDrafts.set(conflictDraftKey, { baseText: 'before', value: 'draft', editing: true, shouldFocus: false })
const noticesBefore = notices.length
for (let i = 0; i < 12; i++) await assert.rejects(conflicted.plugin.saveTextDraft(conflictDraftKey, conflictKey, 'before', 'draft'))
assert.equal(notices.length - noticesBefore, 1)
assert.equal(conflicted.plugin.textDrafts.get(conflictDraftKey).value, 'draft')
assert.equal(conflicted.persisted, fence(original.replace('before', 'external')))
// Restoration or manual source reconciliation allows the existing local retry.
conflicted.setContent(fence(original))
await conflicted.plugin.saveTextDraft(conflictDraftKey, conflictKey, 'before', 'draft')
assert.equal(conflicted.persisted, fence(original.replace('before', 'draft')))
console.log('PASS production host adapters: source/reading interleavings, parallel text slots, delayed save + resize + newest input, conflict retention/coalescing, retry, ownership/deletion guards')
if (process.argv.includes('--writes-only')) process.exit(0)

const ui = await esbuild.build({ stdin: { resolveDir: root, loader: 'ts', contents: `
import { attachInlineTextEditor, flushInlineTextEditors, disposeInlineTextEditors, renderTimelineInto } from './src/render/timeline-view'
import { parseTimeline } from './src/core/parser'
import { attachBlockResize } from './src/edit/block-resize'
import { openNotePopover } from './src/edit/note-popover'
import { createPointerRedrawGate } from './src/edit/pointer-interaction'
HTMLElement.prototype.empty = function() { this.replaceChildren() }
HTMLElement.prototype.createEl = function(tag, opts = {}) { const el = document.createElement(tag); if(opts.cls) el.className=opts.cls; if(opts.text) el.textContent=opts.text; this.append(el); return el }
HTMLElement.prototype.createDiv = function(opts) { return this.createEl('div',opts) }
window.state = { attempts: 0, draft: null, fail: true, noteAttempts: 0, redraws: 0, rendered: 'original' }
window.mountText = () => {
 const pane = document.createElement('div'); pane.className='modular-diary-text-pane'; pane.id='text'; document.body.append(pane)
 attachInlineTextEditor(pane, state.rendered, { renderMarkdown:(el,text)=>el.textContent=text, onSave:()=>{state.attempts++; if(state.fail)throw Error('synthetic failure')}, get initialDraft(){return state.draft},onDraftChange:d=>state.draft=d })
}
window.disposeText = async () => { const p=document.querySelector('#text'); await flushInlineTextEditors(p); disposeInlineTextEditors(p); p.remove() }
window.mountNote = () => {
 const c=document.querySelector('.modular-diary-container'); const anchor=c.querySelector('button');
 openNotePopover(c,anchor,anchor.getBoundingClientRect(),'original',async()=>{state.noteAttempts++; if(state.fail)throw Error('synthetic failure')})
}
window.gate = createPointerRedrawGate()
window.mountProduction = (source) => {
 const host=document.createElement('div');host.id='production';document.body.append(host)
 const doc=parseTimeline(source);state.productionDraft=null;state.resizeDone=false
 const container=renderTimelineInto(host,doc,{typeColors:{}},{
  renderMarkdown:(el,text)=>el.textContent=text,
  onDraftChange:(_index,draft)=>{state.productionDraft=draft?{...draft,baseText:state.productionDraft?.baseText??draft.baseText}:null},
  onSave:async(index,text)=>{
   const result=await window.productionSave(index,text,state.productionDraft)
   if(state.productionDraft)state.productionDraft.baseText=result.baseText
  },
 })
 attachBlockResize(container,container.querySelector('.modular-diary-body'),{
  initialSize:doc.blockSize,
  onCommit:(size,canvasWidth)=>{window.productionResize(size,canvasWidth).then(()=>state.resizeDone=true)},
 })
}
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
 await page.evaluate(() => { state.rendered='external source change'; window.mountText() })
 assert.equal(await page.evaluate(() => state.draft.baseText), 'original', 'Remount must preserve the edit baseline, not adopt external source')
 await page.evaluate(() => window.dispatchEvent(new Event('blur')))
 assert.equal(await page.evaluate(() => state.attempts), 1)
 await page.screenshot({ path: path.join(out, 'text-retry.png') })
 await page.evaluate(() => { state.fail=false })
 await page.locator('#text .modular-diary-save-retry').click()
 await page.waitForFunction(() => state.attempts===2 && state.draft===null)
 await page.evaluate(async () => {
   await window.disposeText()
   state.draft={baseText:'original',value:'unsaved',editing:true,shouldFocus:true,saveFailed:true}
   state.rendered='external current text'; window.mountText()
 })
 await page.locator('#text textarea').press('Escape')
 assert.equal(await page.locator('#text .modular-diary-text-host').textContent(),'external current text','Cancelling a restored draft must show the live rendered source')
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
 // Mounted public UI -> production plugin write methods -> editor/vault
 // adapter, crossing an asynchronous binding rather than mocking save success.
 const mountedSource='block-size: 600x360\nlayout: text@0,0,12,16\noff: toolbar timeline stats dialog\n===\nOriginal mounted diary'
 const mounted=fixture(fence(mountedSource))
 const mountedKey={...key,owner:mounted.view.leaf,blockOrdinal:0,source:mountedSource}
 await page.exposeFunction('productionSave',async(index,text,draft)=>{
  const draftKey={...mountedKey,index}
  mounted.plugin.textDrafts.set(draftKey,draft)
  await mounted.plugin.saveTextDraft(draftKey,mountedKey,'Original mounted diary',text)
  return mounted.plugin.textDrafts.get(draftKey)
 })
 await page.exposeFunction('productionResize',async(size,canvasWidth)=>{
  await mounted.plugin.applyBlockTransform(mounted.host,mounted.ctx,mountedSource,s=>setHeaderValue(setHeaderValue(s,'block-size',size.width+'x'+size.height),'canvas-width',String(canvasWidth)))
 })
 await page.evaluate(source=>window.mountProduction(source),mountedSource)
 const production=page.locator('#production .modular-diary-container')
 await production.locator('.modular-diary-text-pane').click()
 await production.locator('textarea').fill('Mounted saved draft after resize')
 const grip=production.locator('.modular-diary-block-resize-se')
 await grip.scrollIntoViewIfNeeded()
 const beforeBounds=await production.boundingBox(),gripBounds=await grip.boundingBox()
 const beforePersisted=mounted.persisted,noticesAtResize=notices.length
 await page.mouse.move(gripBounds.x+gripBounds.width/2,gripBounds.y+gripBounds.height/2)
 await page.mouse.down()
 await page.mouse.move(gripBounds.x+gripBounds.width/2-80,gripBounds.y+gripBounds.height/2-60,{steps:8})
 await page.mouse.up()
 await page.waitForFunction(()=>state.resizeDone)
 const afterBounds=await production.boundingBox()
 assert.ok(Math.abs(afterBounds.width-beforeBounds.width)>40 && Math.abs(afterBounds.height-beforeBounds.height)>30,'Both actual dimensions must change')
 assert.notEqual(mounted.persisted,beforePersisted,'Resize must reach backing storage')
 await production.locator('textarea').press('Control+Enter')
 await page.waitForFunction(()=>state.productionDraft===null)
 assert.ok(mounted.persisted.includes('Mounted saved draft after resize'))
 assert.ok(mounted.persisted.includes('block-size: '+Math.round(afterBounds.width)+'x'+Math.round(afterBounds.height)))
 assert.equal(await production.locator('.modular-diary-save-retry:not([hidden])').count(),0)
 assert.equal(notices.length,noticesAtResize)
 await production.hover()
 await page.screenshot({path:path.join(out,'mounted-resize-saved-dark.png')})
 await page.addStyleTag({content:'body{background:#fafafa;color:#222}input,textarea,button{color:inherit;background:#fafafa}'})
 await page.screenshot({path:path.join(out,'mounted-resize-saved-light.png')})
 console.log('PASS browser: failed draft survives detach/remount, no automatic retries, manual recovery, external edit blocks redraw')
 console.log('Visual evidence: ' + out)
} finally { await browser.close() }
