import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import esbuild from 'esbuild'
import {chromium} from 'playwright'
import {createChecklistHost} from './checklist-host.mjs'
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const out=fs.mkdtempSync(path.join(os.tmpdir(),'modular-diary-checklist-ui-'))
const original='date: 2026-10-22\nlayout: todos@0,0,6,3 timeline@6,0,6,14 toolbar@0,3,6,2\noff: stats dialog\n- [ ] todo: id="keep" estimate=0 category="" group="" title="#keep Todo" difficulty=3 priority="P0"\n---\n09:00-10:00 work Keep\n=== Notes\nUntouched prose'
const template={name:'Evening',daily:true,items:[{indent:'',text:'First item'},{indent:'  ',text:'A long nested item that must wrap without covering the buttons'}]}
// Both production write paths must roundtrip; an exposed Editor in preview must remain unused.
for(const mode of ['source','preview']){
 const host=createChecklistHost(original,mode),added=await host.add(original,[],template)
 const module=JSON.parse(added.split('\n').find(l=>l.startsWith('checklist:')).slice(10))
 assert.equal(module.items[0].checked,false)
 module.items[0].checked=true
 const saved=await host.save(added,module.id,module)
 assert.notEqual(added,saved);assert.ok(host.read().includes('"checked":true'))
 assert.ok(host.read().startsWith('Before the block'));assert.ok(host.read().endsWith('After the block'))
 assert.ok(saved.includes('title="#keep Todo" difficulty=3 priority="P0"'));assert.ok(saved.includes('=== Notes\nUntouched prose'))
 host.setFail(true);module.title='Must not save';await assert.rejects(host.save(saved,module.id,module));assert.equal(host.source(),saved)
}
const host=createChecklistHost(original)
fs.writeFileSync(path.join(out,'obsidian.ts'),`export function setIcon(el,name){el.textContent=({pencil:'✎',x:'×'})[name]||'⋮'};export const Platform={isMobile:false};`)
const entry=`
import {parseTimeline} from '${root}/src/core/parser'
import {resolveGrid,serializeLayoutHeader} from '${root}/src/core/grid-layout'
import {renderChecklistInto} from '${root}/src/render/checklist-view'
import {attachGridInteract,applyGridToBody} from '${root}/src/edit/grid-interact'
for(const [method,tag] of [['createDiv','div'],['createEl',null]])HTMLElement.prototype[method]=function(a={},b={}){const opts=tag?a:b,el=document.createElement(tag||a);if(opts.cls)el.className=opts.cls;if(opts.text)el.textContent=opts.text;for(const [k,v] of Object.entries(opts.attr||{}))el.setAttribute(k,v);this.append(el);return el}
let source=${JSON.stringify(original)},queue=Promise.resolve();const drafts=new Map();const host=document.querySelector('#host');window.fail=false
const items=()=>[...document.querySelectorAll('.modular-diary-slot')].map(s=>({id:s.dataset.slot,x:+s.dataset.x,y:+s.dataset.y,w:+s.dataset.w,h:+s.dataset.h}))
function mount(){host.replaceChildren();const doc=parseTimeline(source);if(doc.errors.length)throw Error(JSON.stringify(doc.errors));const body=host.createDiv({cls:'modular-diary-body'});body.style.cssText='position:relative;width:100%;height:600px';
 const layout=resolveGrid(doc.layout||null,0,doc.side,14,doc.hiddenSlots,1,false,(doc.checklists||[]).map(c=>({id:c.id,x:0,y:0,w:6,h:9})));
 for(const item of layout){const slot=body.createDiv({cls:'modular-diary-slot modular-diary-slot-'+item.id});for(const k of ['x','y','w','h'])slot.dataset[k]=item[k];slot.dataset.slot=item.id;
 const module=doc.checklists?.find(c=>c.id===item.id);if(module)renderChecklistInto(slot,module,{draft:drafts.get(item.id),onDraft:d=>drafts.set(item.id,d),save:async change=>{if(window.fail)throw Error('synthetic failure');const live=parseTimeline(source).checklists.find(c=>c.id===module.id);const next=change(live);source=await window.saveSource(source,module.id,next);return next}});else slot.textContent=item.id;
 }applyGridToBody(body,layout);attachGridInteract(body,layout=>{queue=queue.then(async()=>{source=await window.layoutSource(source,layout);mount()})});
}
window.createChecklist=async(template)=>{source=await window.addSource(source,items(),template);mount()}
window.remount=mount;window.whenSaved=()=>queue;window.source=()=>source;window.parsed=()=>parseTimeline(source);mount();
`
const built=await esbuild.build({stdin:{contents:entry,resolveDir:root,loader:'ts'},bundle:true,write:false,format:'iife',alias:{obsidian:path.join(out,'obsidian.ts')}})
const css=fs.readFileSync(path.join(root,'styles.css'),'utf8')
fs.writeFileSync(path.join(out,'index.html'),`<!doctype html><meta charset="utf-8"><style>:root{--background-primary:#fff;--background-secondary:#f5f5f5;--background-modifier-hover:#eee;--background-modifier-border:#bbb;--text-normal:#222;--text-muted:#666;--text-faint:#777;--interactive-accent:#875bef;--text-error:#c33;--button-radius:5px;--background-modifier-border-focus:#875bef}body{font-family:system-ui;margin:20px;background:var(--background-primary);color:var(--text-normal)}#host{position:relative;width:780px;height:630px;overflow:auto;border:1px solid #bbb}.modular-diary-slot{position:absolute;box-sizing:border-box;border:1px solid #ddd;overflow:auto}${css}</style><main class="modular-diary-container" id="host"></main><script>${built.outputFiles[0].text}</script>`)
const browser=await chromium.launch({headless:true})
try{
 const page=await browser.newPage({viewport:{width:1000,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.exposeFunction('addSource',(s,items,t)=>host.add(s,items,t))
 await page.exposeFunction('saveSource',(s,id,next)=>host.save(s,id,next))
 await page.exposeFunction('layoutSource',(s,items)=>host.layout(s,items))
 await page.goto('file://'+path.join(out,'index.html'))
 assert.equal(await page.locator('.modular-diary-checklist').count(),0)
 await page.evaluate(t=>window.createChecklist(t),template)
 await page.evaluate(()=>window.createChecklist())
 assert.equal(await page.locator('.modular-diary-checklist').count(),2)
 const slot=id=>page.locator('[data-slot="'+id+'"]'),first=slot('checklist1'),second=slot('checklist2')
 assert.equal(await first.getByRole('checkbox',{name:'First item',exact:true}).isChecked(),false)
 await first.getByRole('checkbox',{name:'First item',exact:true}).check()
 await page.waitForFunction(()=>window.parsed().checklists[0].items[0].checked)
 assert.ok(host.read().includes('"checked":true'))
 await page.evaluate(()=>window.remount())
 assert.equal(await first.getByRole('checkbox',{name:'First item',exact:true}).isChecked(),true)
 await first.getByRole('textbox',{name:'添加清单项',exact:true}).fill('Pending draft')
 await page.evaluate(()=>window.remount())
 assert.equal(await first.getByRole('textbox',{name:'添加清单项',exact:true}).inputValue(),'Pending draft')
 await page.evaluate(()=>window.fail=true)
 await first.getByRole('button',{name:'添加清单项',exact:true}).click()
 assert.equal(await first.getByRole('textbox',{name:'添加清单项',exact:true}).inputValue(),'Pending draft')
 assert.equal(await first.getByRole('status').textContent(),'保存失败，请重试')
 await page.evaluate(()=>window.fail=false)
 await first.getByRole('button',{name:'添加清单项',exact:true}).click()
 await first.getByRole('checkbox',{name:'Pending draft',exact:true}).waitFor()
 assert.equal((host.read().match(/Pending draft/g)||[]).length,1)
 const edited=first.locator('.modular-diary-checklist-row').filter({hasText:'Pending draft'})
 await edited.getByRole('button',{name:'编辑清单项',exact:true}).click()
 await first.getByRole('textbox',{name:'清单名称或项目内容',exact:true}).fill('Edited item')
 await first.getByRole('button',{name:'保存',exact:true}).click()
 await first.getByRole('checkbox',{name:'Edited item',exact:true}).waitFor()
 assert.ok(host.read().includes('Edited item'));assert.ok(!host.read().includes('Pending draft'))
 await first.getByRole('textbox',{name:'添加清单项',exact:true}).fill('Remove only this item')
 await first.getByRole('button',{name:'添加清单项',exact:true}).click()
 const toRemove=first.locator('.modular-diary-checklist-row').filter({hasText:'Remove only this item'})
 await toRemove.getByRole('button',{name:'删除清单项',exact:true}).click()
 await page.waitForFunction(()=>!window.source().includes('Remove only this item'))
 assert.equal(await first.getByRole('checkbox',{name:'First item',exact:true}).isChecked(),true)
 await second.getByRole('button',{name:'重命名清单',exact:true}).click()
 await second.getByRole('textbox',{name:'清单名称或项目内容',exact:true}).fill('Second independent list')
 await second.getByRole('button',{name:'保存',exact:true}).click()
 await second.getByText('Second independent list',{exact:true}).waitFor()
 await first.hover();await page.screenshot({path:path.join(out,'checklists-light.png')})
 // A real pointer drag must leave the initial geometry and survive disk/reload.
 const initialDiskLayout=await page.evaluate(()=>JSON.stringify(window.parsed().layout))
 const initial=await first.evaluate(s=>({x:+s.dataset.x,y:+s.dataset.y}))
 const grip=first.locator('.modular-diary-slot-grip');await grip.scrollIntoViewIfNeeded();const b=await grip.boundingBox()
 await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+400,b.y+100,{steps:14});await page.mouse.up();await page.evaluate(()=>window.whenSaved())
 const moved=await first.evaluate(s=>({x:+s.dataset.x,y:+s.dataset.y}));assert.notDeepEqual(moved,initial,'drag cannot be a no-op')
 const savedLayout=await page.evaluate(()=>window.parsed().layout)
 assert.notEqual(JSON.stringify(savedLayout),initialDiskLayout,'drag must change the stored layout')
 assert.ok(host.read().includes('layout: '+savedLayout.map(i=>i.id+'@'+[i.x,i.y,i.w,i.h].join(',')).join(' ')))
 await page.evaluate(()=>window.remount());assert.deepEqual(await first.evaluate(s=>({x:+s.dataset.x,y:+s.dataset.y})),moved)
 // The shared resize handle must change dimensions and persist that change.
 const sizeBefore=await first.evaluate(s=>({w:+s.dataset.w,h:+s.dataset.h}))
 const resize=first.locator('.modular-diary-handle-se');await first.hover();await resize.scrollIntoViewIfNeeded();const rb=await resize.boundingBox()
 await page.mouse.move(rb.x+rb.width/2,rb.y+rb.height/2);await page.mouse.down();await page.mouse.move(rb.x+70,rb.y+70,{steps:10});await page.mouse.up();await page.evaluate(()=>window.whenSaved())
 const sizeAfter=await first.evaluate(s=>({w:+s.dataset.w,h:+s.dataset.h}));assert.notDeepEqual(sizeAfter,sizeBefore,'resize must change dimensions')
 const persistedSize=await page.evaluate(()=>window.parsed().layout.find(i=>i.id==='checklist1'));assert.deepEqual({w:persistedSize.w,h:persistedSize.h},sizeAfter)
 await page.setViewportSize({width:400,height:720});await page.evaluate(()=>{document.querySelector('#host').style.width='340px';for(const [k,v] of Object.entries({'--background-primary':'#222','--background-secondary':'#292929','--background-modifier-hover':'#383838','--text-normal':'#eee','--text-muted':'#bbb'}))document.documentElement.style.setProperty(k,v)})
 await first.scrollIntoViewIfNeeded();await first.getByRole('checkbox',{name:'Edited item',exact:true}).focus()
 assert.ok(await first.evaluate(s=>s.scrollWidth<=s.clientWidth+1),'module must fit its narrow slot')
 await page.screenshot({path:path.join(out,'checklists-narrow-dark.png')})
 assert.ok(host.read().includes('title="#keep Todo" difficulty=3 priority="P0"'));assert.ok(host.read().includes('=== Notes\nUntouched prose'))
 assert.deepEqual(errors,[]);console.log('PASS independent Checklists: real source/reading persistence, separate modules, drafts/retry, pointer layout/disk roundtrip. Screenshots:',out)
}finally{await browser.close()}
