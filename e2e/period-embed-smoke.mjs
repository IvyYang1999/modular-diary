/**
 * Actual plugin, in-memory vault: a day block switches to its week, the
 * plugin-managed period note appears with rhythm slots, a slot drags into a
 * day's afternoon band, the face flips to actual, and 日 switches back.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import esbuild from 'esbuild'
import {chromium} from 'playwright'
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),out=fs.mkdtempSync(path.join(os.tmpdir(),'modular-diary-period-embed-'))
const built=await esbuild.build({entryPoints:[path.join(root,'src/main.ts')],bundle:true,write:false,platform:'browser',format:'iife',globalName:'MDPlugin',external:['obsidian','node:*','child_process']})
const daySource='date: 2026-10-22\nrange: 9-11\nlayout: toolbar@0,0,6,3 timeline@6,0,6,14\noff: dialog stats\n---\n09:00-10:00 work'
const rhythms='# 节律\n\n- 每周 拍视频 @work 整天\n- 每周 2次 散步 @study 下午\n- 每天 30分钟 运动 @study\n- 每月 旅游 @study 2-3天\n'
const setup=`
for(const [method,tag] of [['createDiv','div'],['createSpan','span'],['createEl',null]])HTMLElement.prototype[method]=function(a={},b={}){const opts=tag?a:b,el=document.createElement(tag||a);if(opts.cls)el.className=Array.isArray(opts.cls)?opts.cls.join(' '):opts.cls;if(opts.text)el.textContent=opts.text;for(const [k,v] of Object.entries(opts.attr||{}))el.setAttribute(k,v);this.append(el);return el}
HTMLElement.prototype.empty=function(){this.replaceChildren()};HTMLElement.prototype.addClass=function(...c){this.classList.add(...c)};HTMLElement.prototype.removeClass=function(...c){this.classList.remove(...c)};HTMLElement.prototype.toggleClass=function(c,v){this.classList.toggle(c,v)};HTMLElement.prototype.setText=function(t){this.textContent=t};
const cleanup=[];class Base{registerDomEvent(target,name,cb,opts){target.addEventListener(name,cb,opts);cleanup.push(()=>target.removeEventListener(name,cb,opts))}registerEvent(){}register(){}addChild(){}}
class TFile{constructor(p){this.path=p;this.basename=p.split('/').pop().replace(/\\.md$/,'');this.extension='md'}};class TFolder{};class MarkdownView{};
class Modal{constructor(app){this.app=app;this.modalEl=document.createElement('div');this.modalEl.className='modal';this.titleEl=document.createElement('h2');this.contentEl=document.createElement('div');this.modalEl.append(this.titleEl,this.contentEl);document.body.appendChild(this.modalEl);this.modalEl.__modal=this}setTitle(v){this.titleEl.textContent=v;return this}open(){this.onOpen()}close(){this.onClose();this.modalEl.remove()}onOpen(){}onClose(){}}
class Menu{constructor(){this.items=[]}addItem(cb){let title='',handler=()=>{};const item=new Proxy({setTitle:t=>{title=t;return item},onClick:cb=>{handler=cb;return item}},{get:(o,k)=>o[k]||(()=>item)});cb(item);this.items.push({title,handler});return this}addSeparator(){return this}showAtPosition(){document.querySelector('#menu')?.remove();const m=document.body.createDiv({});m.id='menu';m.setAttribute('role','menu');for(const i of this.items){const b=m.createEl('button',{text:i.title,attr:{type:'button'}});b.onclick=()=>{m.remove();i.handler()}}}}
const obsidian=new Proxy({Plugin:Base,PluginSettingTab:Base,Modal,MarkdownRenderChild:Base,FuzzySuggestModal:Base,TFile,TFolder,MarkdownView,Menu,Platform:{isDesktopApp:false,isMobile:false},getLanguage:()=> 'zh',normalizePath:p=>p.replace(/^\\/+/,''),setIcon:(el,name)=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.innerHTML='<path d="M5 12h14M12 5v14" stroke="currentColor"/>';el.append(svg)},MarkdownRenderer:{render:async(_a,text,el)=>{el.textContent=text}},Notice:class{constructor(text){window.notices.push(text)}},moment:()=>({format:()=> '2026-10-22'})},{get:(o,k)=>o[k]??Base});
window.activeWindow=window;window.activeDocument=document;window.notices=[];window.require=n=>n==='obsidian'?obsidian:n==='node:os'?{homedir:()=>'/synthetic'}:n==='node:path'?{join:(...p)=>p.join('/')}:{};
window.__base={obsidian,cleanup};
window.files={'synthetic.md':${JSON.stringify('```timeline\n'+daySource+'\n```')},'节律.md':${JSON.stringify(rhythms)}};
`
const init=`
window.renderActual=async()=>{const {obsidian,cleanup}=window.__base;cleanup.splice(0).forEach(f=>f());const plugin=window.plugin||(window.plugin=new MDPlugin.default());const tfiles=new Map();const tfile=p=>{if(!tfiles.has(p))tfiles.set(p,new obsidian.TFile(p));return tfiles.get(p)};const file=tfile('synthetic.md');const host=document.querySelector('#host');host.empty();const view=window.view||(window.view=new obsidian.MarkdownView());view.file=file;view.leaf=window.owner||(window.owner={});view.containerEl=host;view.getMode=()=> 'preview';view.editor={getValue:()=>window.files['synthetic.md']};
plugin.saveData=async()=>{};plugin.settings={...plugin.settings,spanTypeColors:{work:'#53b5d1',study:'#c085db'},habits:[],weeklyTodos:[],dailyQuotes:[],timelineOnboardingSeen:true,tagCategories:{},dialogBackend:'claude-cli',rhythmsFile:'节律.md',periodFolder:'周期',upcomingFile:'Upcoming.md'};
plugin.app={vault:{getAbstractFileByPath:p=>window.files[p]!==undefined?tfile(p):(p==='周期'?{}:null),read:async f=>window.files[f.path],cachedRead:async f=>window.files[f.path],getMarkdownFiles:()=>Object.keys(window.files).map(tfile),create:async(p,c)=>{window.files[p]=c;return tfile(p)},createFolder:async()=>{},process:async(f,change)=>{const next=change(window.files[f.path]);window.files[f.path]=next;if(f.path==='synthetic.md')setTimeout(()=>window.mountActual(),0);return next},on:()=>({})},workspace:{iterateAllLeaves:f=>f({view}),getActiveViewOfType:()=>view,getActiveFile:()=>file,getLeavesOfType:()=>[{view}],on:()=>({}),onLayoutReady:f=>f(),getLeaf:()=>({openFile:async()=>{}})},metadataCache:{getFileCache:()=>({}),getFirstLinkpathDest:()=>null},fileManager:{}};
await plugin.rhythms.load();
const content=window.files['synthetic.md'];const ctx={sourcePath:file.path,docId:'actual-plugin',getSectionInfo:()=>({text:content,lineStart:0,lineEnd:content.split('\\n').findIndex((line,index)=>index>0&&line==='\`\`\`')}),addChild:()=>{}};const source=content.match(/\`\`\`timeline\\n([\\s\\S]*?)\\n\`\`\`/)[1];plugin.renderTimelineBlock(source,host,ctx,null);plugin.remountVisual.clear();
};let mountQueue=Promise.resolve();window.mountActual=()=>{mountQueue=mountQueue.then(()=>window.renderActual());return mountQueue};window.mountActual();
`
const css=fs.readFileSync(path.join(root,'styles.css'),'utf8')
fs.writeFileSync(path.join(out,'index.html'),`<!doctype html><meta charset="utf-8"><style>:root{--background-primary:#fff;--background-secondary:#f5f5f5;--background-modifier-border:#ccc;--background-modifier-hover:#eee;--text-normal:#222;--text-muted:#666;--text-faint:#888;--text-accent:#875bef;--interactive-accent:#875bef;--text-on-accent:#fff;--font-ui-smaller:13px}body{margin:24px;font-family:system-ui}#host{width:1000px}#menu{position:fixed;left:30px;top:30px;background:#fff;border:1px solid #bbb;z-index:99999;display:flex;flex-direction:column}${css}</style><main id="host"></main><script>${setup}</script><script>${built.outputFiles[0].text}</script><script>${init}</script>`)
const browser=await chromium.launch({headless:true})
try{
 const page=await browser.newPage({viewport:{width:1200,height:900},timezoneId:'Asia/Shanghai'}),errors=[];page.on('pageerror',e=>errors.push(e.stack))
 await page.goto('file://'+path.join(out,'index.html'))
 await page.waitForFunction(()=>window.plugin)
 await page.locator('.modular-diary-view-bar').waitFor()
 if(errors.length)throw Error(errors.join('\n'))
 // 1. 日 → 周: the day block writes `view: week`, the week note is created with slots, and renders in place.
 await page.locator('.modular-diary-view-bar button',{hasText:'周'}).click()
 await page.waitForFunction(()=>window.files['synthetic.md'].includes('view: week'))
 await page.waitForFunction(()=>Object.keys(window.files).includes('周期/2026-W43.md'))
 await page.waitForFunction(()=>window.files['周期/2026-W43.md'].includes('rhythm="散步"'))
 await page.evaluate(()=>window.mountActual())
 await page.locator('.modular-diary-period.is-plan').waitFor()
 const weekNote=await page.evaluate(()=>window.files['周期/2026-W43.md'])
 assert.ok(weekNote.includes('days: 2026-10-19..2026-10-25') && weekNote.includes('scope: week'),weekNote)
 assert.equal((weekNote.match(/rhythm="散步"/g)||[]).length,2,'two slots for a 2次 rhythm')
 assert.ok(!weekNote.includes('rhythm="旅游"'),'monthly rhythms get no weekly slot')
 const board=await page.locator('.modular-diary-plan-board').evaluate(el=>({
   title:el.querySelector('.modular-diary-component-title')?.textContent,
   rows:[...el.querySelectorAll('.modular-diary-plan-row')].map(r=>r.className.replace(/modular-diary-plan-row|modular-diary-period-draggable/g,'').trim()+':'+r.querySelector('.modular-diary-plan-name')?.textContent)}))
 assert.equal(board.title,'本周协议')
 assert.deepEqual(board.rows,['is-unplaced:拍视频','is-unplaced:散步 1','is-unplaced:散步 2','is-measured:运动'],JSON.stringify(board))
 assert.equal(await page.locator('.modular-diary-seg button[aria-pressed="true"]',{hasText:'周'}).count(),1)
 assert.equal(await page.locator('.modular-diary-plan-cell').count(),7)
 // 2. Drag the first 散步 slot into Thursday afternoon: the slot gets day= and zone=pm in the week note.
 const row=page.locator('.modular-diary-plan-row',{hasText:'散步 1'})
 const band=page.locator('.modular-diary-plan-band[data-zone="2026-10-22@pm"]')
 const from=await row.boundingBox(),to=await band.boundingBox()
 await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down()
 await page.mouse.move(from.x+40,from.y+10);await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:8});await page.mouse.up()
 await page.waitForFunction(()=>/rhythm="散步"[^\n]*\n/.test(window.files['周期/2026-W43.md']) && window.files['周期/2026-W43.md'].includes('day=2026-10-22') && window.files['周期/2026-W43.md'].includes('zone=pm'))
 await page.evaluate(()=>window.mountActual())
 await page.locator('.modular-diary-plan-band[data-zone="2026-10-22@pm"] .modular-diary-plan-pill',{hasText:'散步'}).waitFor()
 assert.equal(await page.locator('.modular-diary-plan-row.is-placed',{hasText:'散步'}).count(),1)
 await page.screenshot({path:path.join(out,'week-plan-embedded.png')})
 // 3. 计划 → 实际 flips the note's face; 日 removes the day block's view header.
 await page.locator('.modular-diary-seg.is-soft button',{hasText:'实际'}).click()
 await page.waitForFunction(()=>window.files['周期/2026-W43.md'].includes('face: actual'))
 await page.evaluate(()=>window.mountActual())
 await page.locator('.modular-diary-period-cal').waitFor()
 assert.equal(await page.locator('.modular-diary-period.is-plan').count(),0)
 await page.locator('.modular-diary-seg button',{hasText:'日'}).first().click()
 await page.waitForFunction(()=>!window.files['synthetic.md'].includes('view:'))
 await page.evaluate(()=>window.mountActual())
 await page.locator('.modular-diary-view-bar').waitFor()
 assert.equal(await page.locator('.modular-diary-period').count(),0)
 // 4. 月 renders the month note with the monthly rhythm.
 await page.locator('.modular-diary-view-bar button',{hasText:'月'}).click()
 await page.waitForFunction(()=>Object.keys(window.files).includes('周期/2026-10.md')&&window.files['周期/2026-10.md'].includes('rhythm="旅游"'))
 await page.evaluate(()=>window.mountActual())
 await page.locator('.modular-diary-plan-month').waitFor()
 assert.equal(await page.locator('.modular-diary-plan-month-cell:not(.is-outside)').count(),31)
 // 5. The board's pencil opens the rhythms panel (forms, not markdown); edits write back to 节律.md.
 await page.locator('.modular-diary-plan-board .modular-diary-component-actions button').nth(1).click()
 await page.locator('.modular-diary-rhythm-modal .modular-diary-rhythm-item').nth(3).waitFor()
 assert.equal(await page.locator('.modular-diary-rhythm-item').count(),4)
 const nameInput=page.locator('.modular-diary-rhythm-item').nth(3).locator('.modular-diary-rhythm-name-input')
 assert.equal(await nameInput.inputValue(),'旅游')
 await nameInput.fill('远行');await nameInput.press('Enter')
 await page.waitForFunction(()=>window.files['节律.md'].includes('- 每月 远行 @study 2-3天'))
 await page.locator('.modular-diary-rhythm-item').nth(3).locator('.modular-diary-rhythm-grip').focus();await page.keyboard.press('ArrowUp')
 await page.waitForFunction(()=>window.files['节律.md'].indexOf('远行')<window.files['节律.md'].indexOf('- 每天 30分钟 运动'))
 const note=await page.evaluate(()=>window.files['节律.md'])
 assert.ok(note.startsWith('# 节律\n\n- 每周 拍视频 @work 整天\n- 每周 2次 散步 @study 下午\n- 每月 远行 @study 2-3天\n- 每天 30分钟 运动 @study\n'),note)
 await page.evaluate(()=>document.querySelector('.modular-diary-rhythm-modal').__modal.close())
 await page.evaluate(()=>window.mountActual())
 await page.locator('.modular-diary-plan-row',{hasText:'远行'}).waitFor()
 // 6. Hour targets live on the board: "+" opens the form; the saved goal is a board row, not a section of its own.
 await page.locator('.modular-diary-plan-board .modular-diary-component-actions button').nth(0).click()
 await page.locator('.modular-diary-plan-board .modular-diary-period-goal-form').waitFor()
 await page.locator('.modular-diary-period-goal-key select').selectOption('work')
 await page.locator('.modular-diary-period-goal-target input').fill('2')
 await page.locator('.modular-diary-period-goal-form').evaluate(f=>f.requestSubmit())
 await page.waitForFunction(()=>window.files['周期/2026-10.md'].includes('goal: type="work" target=120'))
 await page.evaluate(()=>window.mountActual())
 await page.locator('.modular-diary-plan-row.is-goal',{hasText:'work'}).waitFor()
 assert.equal(await page.locator('.modular-diary-period-goals').count(),0,'no separate goals section on the plan face')
 // 7. Embedded views keep one fixed height; the bottom handle's arrow step persists it.
 assert.equal(await page.locator('.modular-diary-period.is-fixed-height').count(),1)
 await page.locator('.modular-diary-period-height-handle').focus();await page.keyboard.press('ArrowDown')
 await page.waitForFunction(()=>window.plugin.settings.periodHeight===624)
 await page.screenshot({path:path.join(out,'month-plan-embedded.png')})
 assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.notices),[])
 console.log('PASS day block → embedded week/month notes with rhythm slots, band drop, face flip. Screenshot:',out)
}catch(e){console.error(e);process.exitCode=1}finally{await browser.close()}
