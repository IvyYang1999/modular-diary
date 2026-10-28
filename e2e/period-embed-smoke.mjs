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
const daySource='date: 2026-10-22\nrange: 9-11\nlayout: toolbar@0,0,6,3 todos@0,3,6,8 timeline@6,0,6,14\noff: dialog stats\n---\n09:00-10:00 work'
const rhythms='# 节律\n\n- 每周 拍视频 @work 整天\n- 每周 2次 散步 @study 下午\n- 每天 30分钟 运动 @study\n- 每月 旅游 @study 2-3天\n- 每周 2小时 阅读 @study\n'
const setup=`
for(const [method,tag] of [['createDiv','div'],['createSpan','span'],['createEl',null]])HTMLElement.prototype[method]=function(a={},b={}){const opts=tag?a:b,el=document.createElement(tag||a);if(opts.cls)el.className=Array.isArray(opts.cls)?opts.cls.join(' '):opts.cls;if(opts.text)el.textContent=opts.text;for(const [k,v] of Object.entries(opts.attr||{}))el.setAttribute(k,v);this.append(el);return el}
HTMLElement.prototype.empty=function(){this.replaceChildren()};HTMLElement.prototype.addClass=function(...c){this.classList.add(...c)};HTMLElement.prototype.removeClass=function(...c){this.classList.remove(...c)};HTMLElement.prototype.toggleClass=function(c,v){this.classList.toggle(c,v)};HTMLElement.prototype.setText=function(t){this.textContent=t};
const cleanup=[];class Base{registerDomEvent(target,name,cb,opts){target.addEventListener(name,cb,opts);cleanup.push(()=>target.removeEventListener(name,cb,opts))}registerEvent(){}register(){}addChild(){}}
class TFile{constructor(p){this.path=p;this.basename=p.split('/').pop().replace(/\\.md$/,'');this.extension='md'}};class TFolder{};class MarkdownView{};
class Modal{constructor(app){this.app=app;this.modalEl=document.createElement('div');this.modalEl.className='modal';this.titleEl=document.createElement('h2');this.contentEl=document.createElement('div');this.modalEl.append(this.titleEl,this.contentEl);document.body.appendChild(this.modalEl);this.modalEl.__modal=this}setTitle(v){this.titleEl.textContent=v;return this}open(){this.onOpen()}close(){this.onClose();this.modalEl.remove()}onOpen(){}onClose(){}}
class Menu{constructor(){this.items=[]}addItem(cb){let title='',handler=()=>{},sub=null;const item=new Proxy({setTitle:t=>{title=t;return item},onClick:cb=>{handler=cb;return item},setSubmenu:()=>{sub=new Menu();return sub}},{get:(o,k)=>o[k]||(()=>item)});cb(item);this.items.push({get title(){return title},handler,get sub(){return sub}});return this}addSeparator(){return this}flat(){return this.items.flatMap(i=>i.sub?i.sub.flat():[i])}showAtPosition(){document.querySelector('#menu')?.remove();const m=document.body.createDiv({});m.id='menu';m.setAttribute('role','menu');for(const i of this.flat()){const b=m.createEl('button',{text:i.title,attr:{type:'button'}});b.onclick=()=>{m.remove();i.handler()}}}}
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
const window_files_has_face=(text)=>/^face:/m.test(text)
const browser=await chromium.launch({headless:true})
try{
 const page=await browser.newPage({viewport:{width:1200,height:900},timezoneId:'Asia/Shanghai'}),errors=[];page.on('pageerror',e=>errors.push(e.stack))
 await page.goto('file://'+path.join(out,'index.html'))
 await page.waitForFunction(()=>window.plugin)
 await page.locator('.modular-diary-view-bar').waitFor()
 if(errors.length)throw Error(errors.join('\n'))
 // 0. The day view's bar carries the same chrome as the period toolbar: a day back/forward, the date, and (not today) 今天.
 assert.equal(await page.locator('.modular-diary-view-bar .modular-diary-view-bar-date').textContent(),'周四2026.10.22')
 assert.equal(await page.locator('.modular-diary-timeline-topbar .modular-diary-timeline-date-control').count(),0,'the timeline no longer carries its own date control')
 assert.equal(await page.locator('.modular-diary-view-bar .modular-diary-period-icon').count(),2)
 assert.equal(await page.locator('.modular-diary-view-bar .modular-diary-period-text-button',{hasText:'今天'}).count(),1)
 // 1. 日 → 周: the day block writes `view: week`, the week note is created with slots, and renders in place.
 await page.locator('.modular-diary-view-bar .modular-diary-seg button',{hasText:'周'}).click()
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
 assert.deepEqual(board.rows,['is-unplaced:拍视频','is-unplaced:散步 1','is-unplaced:散步 2','is-measured  is-session-source:阅读','is-measured:运动'],JSON.stringify(board))
 // 2a. An accumulation row (每周 2小时 阅读) drags like a todo: the drop makes a todo of that rhythm placed on that day and part of the day (no clock time); the row stays.
 const reading=page.locator('.modular-diary-plan-row.is-session-source',{hasText:'阅读'})
 const fromR=await reading.boundingBox(),toR=await page.locator('.modular-diary-plan-band[data-zone="2026-10-21@pm"]').boundingBox()
 await page.mouse.move(fromR.x+fromR.width/2,fromR.y+fromR.height/2);await page.mouse.down()
 await page.mouse.move(fromR.x+40,fromR.y+10);await page.mouse.move(toR.x+toR.width/2,toR.y+toR.height/2,{steps:8});await page.mouse.up()
 await page.waitForFunction(()=>{const w=window.files['周期/2026-W43.md'];return /todo: id="todo-[^"]+"[^\n]*category="study"[^\n]*day=2026-10-21 under="阅读" zone=pm title="阅读"/.test(w)})
 assert.ok(!(await page.evaluate(()=>Object.keys(window.files))).some((p)=>/^2026-10-21\.md$/.test(p)),'no day note is written for a band drop')
 await page.evaluate(()=>window.mountActual())
 await page.locator('.modular-diary-plan-row.is-session-source',{hasText:'阅读'}).waitFor()
 assert.equal(await page.locator('.modular-diary-plan-board .modular-diary-plan-subs .modular-diary-todo-row',{hasText:'阅读'}).count(),1,'the new todo hangs under the row')
 assert.equal(await page.locator('.modular-diary-plan-band[data-zone="2026-10-21@pm"] .modular-diary-plan-pill',{hasText:'阅读'}).count(),1,'and sits on the day as a pill')
 assert.ok((await page.locator('.modular-diary-plan-row.is-session-source',{hasText:'阅读'}).innerText()).includes('已安排 1h'),'the row counts it as planned')

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
 assert.equal(await page.locator('.modular-diary-plan-pill.is-ghost').count(),0,'no ghost left after a drop')
 // A redraw in the middle of a drag (a vault event, a settings save) must not strand the ghost: the drop still lands.
 const row2=page.locator('.modular-diary-plan-row',{hasText:'散步 2'})
 const from2=await row2.boundingBox()
 await page.mouse.move(from2.x+from2.width/2,from2.y+from2.height/2);await page.mouse.down()
 await page.mouse.move(from2.x+40,from2.y+10)
 assert.equal(await page.locator('.modular-diary-plan-pill.is-ghost').count(),1)
 await page.evaluate(()=>window.mountActual())
 const band2=page.locator('.modular-diary-plan-band[data-zone="2026-10-23@ev"]')
 const to2=await band2.boundingBox()
 await page.mouse.move(to2.x+to2.width/2,to2.y+to2.height/2,{steps:6});await page.mouse.up()
 await page.waitForFunction(()=>(window.files['周期/2026-W43.md'].match(/day=2026-10-23/g)||[]).length===1)
 assert.equal(await page.locator('.modular-diary-plan-pill.is-ghost').count(),0,'ghost removed even when the handle was replaced mid-drag')
 await page.evaluate(()=>window.mountActual())
 await page.locator('.modular-diary-plan-band[data-zone="2026-10-23@ev"] .modular-diary-plan-pill',{hasText:'散步'}).waitFor()
 await page.screenshot({path:path.join(out,'week-plan-embedded.png')})
 // 2b. A plain period todo: added from the rail, listed under 待安排, dragged as a whole row into Friday morning.
 await page.locator('.modular-diary-period-todos .modular-diary-component-actions button').last().click()
 await page.locator('.modular-diary-period-todos .modular-diary-todo-title-input').first().fill('买菜')
 await page.locator('.modular-diary-period-todos .modular-diary-todo-title-input').first().press('Enter')
 await page.waitForFunction(()=>window.files['周期/2026-W43.md'].includes('title="买菜"'))
 await page.evaluate(()=>window.mountActual())
 const todoRow=page.locator('.modular-diary-period-todos .modular-diary-todo-row',{hasText:'买菜'})
 await todoRow.waitFor()
 assert.equal(await page.locator('.modular-diary-period-todos .modular-diary-todo-group-name',{hasText:'待安排'}).count(),1,'period todos group by placement by default')
 assert.equal(await page.locator('.modular-diary-period-todos .modular-diary-todo-drag').count(),0,'no sort grips in the period rail: the row itself drags')
 const fromT=await todoRow.boundingBox(),toT=await page.locator('.modular-diary-plan-band[data-zone="2026-10-23@am"]').boundingBox()
 await page.mouse.move(fromT.x+fromT.width*0.6,fromT.y+fromT.height/2);await page.mouse.down()
 await page.mouse.move(fromT.x+60,fromT.y+10);await page.mouse.move(toT.x+toT.width/2,toT.y+toT.height/2,{steps:8});await page.mouse.up()
 await page.waitForFunction(()=>/title="买菜"/.test(window.files['周期/2026-W43.md']) && /day=2026-10-23 zone=am[^\n]*title="买菜"|title="买菜"[^\n]*day=2026-10-23/.test(window.files['周期/2026-W43.md']))
 await page.evaluate(()=>window.mountActual())
 await page.locator('.modular-diary-plan-band[data-zone="2026-10-23@am"] .modular-diary-plan-pill',{hasText:'买菜'}).waitFor()
 assert.equal(await page.locator('.modular-diary-period-todos .modular-diary-todo-group-name',{hasText:'已安排'}).count(),1)
 // 2c. 挂到…: the todo goes under the 阅读 rhythm (taking its category) and hangs off that row; unbound it returns to the list.
 await page.locator('.modular-diary-period-todos .modular-diary-todo-row',{hasText:'买菜'}).click({button:'right'})
 await page.locator('#menu button',{hasText:'阅读'}).click()
 await page.waitForFunction(()=>/under="阅读"[^\n]*title="买菜"|title="买菜"[^\n]*under="阅读"/.test(window.files['周期/2026-W43.md']) && /category="study"[^\n]*title="买菜"/.test(window.files['周期/2026-W43.md']))
 await page.evaluate(()=>window.mountActual())
 await page.locator('.modular-diary-plan-board .modular-diary-plan-subs .modular-diary-todo-row',{hasText:'买菜'}).waitFor()
 assert.equal(await page.locator('.modular-diary-plan-board .modular-diary-plan-subs .modular-diary-todo-row',{hasText:'买菜'}).locator('.modular-diary-item-meta-numbers').count(),1,'a bound row keeps its numbers')
 assert.equal(await page.locator('.modular-diary-period-todos .modular-diary-todo-row',{hasText:'买菜'}).count(),0,'a bound todo leaves the plain list')
 // 2d. 推到下周: the todo moves to next week's note (binding kept), a shadow stays here.
 await page.locator('.modular-diary-plan-board .modular-diary-plan-subs .modular-diary-todo-row',{hasText:'买菜'}).click({button:'right'})
 await page.locator('#menu button',{hasText:'推到下周'}).click()
 await page.waitForFunction(()=>window.files['周期/2026-W44.md']&&/under="阅读"[^\n]*title="买菜"|title="买菜"[^\n]*under="阅读"/.test(window.files['周期/2026-W44.md']) && /moved=2026-10-26[^\n]*title="买菜"/.test(window.files['周期/2026-W43.md']))
 await page.evaluate(()=>window.mountActual())
 assert.equal(await page.locator('.modular-diary-plan-board .modular-diary-plan-subs .modular-diary-todo-row',{hasText:'买菜'}).count(),0,'the pushed todo is gone from this week')
 // 3. 计划 → 实际 flips the note's face; 日 removes the day block's view header.
 // The face is one setting for every embedded period, so paging never flips it; the week's actual face shows records only.
 await page.locator('.modular-diary-period-toolbar .modular-diary-seg.is-soft button',{hasText:'实际'}).click()
 await page.waitForFunction(()=>window.plugin.settings.periodFace==='actual')
 assert.ok(!window_files_has_face(await page.evaluate(()=>window.files['周期/2026-W43.md'])),'the face is not written into the note')
 await page.evaluate(()=>window.mountActual())
 await page.locator('.modular-diary-period-cal').waitFor()
 assert.equal(await page.locator('.modular-diary-period.is-plan').count(),0)
 assert.equal(await page.locator('.modular-diary-period-gutter-label').count(),0,'no all-day band on the actual face')
 assert.equal(await page.locator('.modular-diary-period-block.is-plan').count(),0,'no plan blocks on the actual face')
 await page.locator('.modular-diary-period-toolbar .modular-diary-seg.is-soft button',{hasText:'计划'}).click()
 await page.waitForFunction(()=>window.plugin.settings.periodFace==='plan')
 await page.evaluate(()=>window.mountActual())
 await page.locator('.modular-diary-period.is-plan').waitFor()
 await page.locator('.modular-diary-seg button',{hasText:'日'}).first().click()
 await page.waitForFunction(()=>!window.files['synthetic.md'].includes('view:'))
 await page.evaluate(()=>window.mountActual())
 await page.locator('.modular-diary-view-bar').waitFor()
 assert.equal(await page.locator('.modular-diary-period').count(),0)
 // 3b. The day (10-22) lists the slot the week placed on it; ticking it writes the week note. The bar has 计划 / 记录.
 assert.equal(await page.locator('.modular-diary-view-bar .modular-diary-seg.is-soft button').count(),2)
 const arrival=page.locator('.modular-diary-slot-todos .modular-diary-todo-row',{hasText:'散步'})
 await arrival.waitFor()
 assert.equal(await arrival.locator('.modular-diary-todo-flag.is-period').count(),1)
 // A period row has a day todo's powers: it drags to the timeline, and its menu edits, half-completes, pushes to tomorrow, deletes.
 assert.equal(await arrival.locator('.modular-diary-schedule-source').count(),1,'a period row drags to the timeline')
 await arrival.click({button:'right'})
 const arrivalMenu=await page.locator('#menu button').allInnerTexts()
 for(const label of ['编辑','标为半完成','推到明天','退回待安排','删除'])assert.ok(arrivalMenu.some((text)=>text.includes(label)),label+' in '+JSON.stringify(arrivalMenu))
 await page.locator('#menu button',{hasText:'标为半完成'}).click()
 await page.waitForFunction(()=>/- \[\/\] todo: id="r-[a-z0-9]+-1"[^\n]*day=2026-10-22/.test(window.files['周期/2026-W43.md']))
 await page.evaluate(()=>window.mountActual())
 await arrival.waitFor()
 await arrival.locator('button.modular-diary-todo-check').click()
 await page.waitForFunction(()=>/- \[x\] todo: id="r-[a-z0-9]+-1"[^\n]*day=2026-10-22/.test(window.files['周期/2026-W43.md']))
 // 4. 月 renders the month note with the monthly rhythm.
 await page.locator('.modular-diary-view-bar .modular-diary-seg button',{hasText:'月'}).click()
 await page.waitForFunction(()=>Object.keys(window.files).includes('周期/2026-10.md')&&window.files['周期/2026-10.md'].includes('rhythm="旅游"'))
 await page.evaluate(()=>window.mountActual())
 await page.locator('.modular-diary-plan-month').waitFor()
 assert.equal(await page.locator('.modular-diary-plan-month-cell:not(.is-outside)').count(),31)
 assert.equal(await page.locator('.modular-diary-period-toolbar .modular-diary-period-text-button.is-toggle',{hasText:'待办'}).count(),1,'month plan has the todos toggle')
 // The month board lists every rhythm: the monthly slot plus the weekly and daily ones summed over the month.
 const monthRows=await page.locator('.modular-diary-plan-board .modular-diary-plan-row').evaluateAll(rows=>rows.map(r=>r.querySelector('.modular-diary-plan-name')?.textContent+'|'+(r.querySelector('.modular-diary-plan-meta')?.textContent??'')))
 assert.ok(monthRows.some(r=>r.startsWith('旅游|')),JSON.stringify(monthRows))
 assert.ok(monthRows.some(r=>r.startsWith('拍视频|')),JSON.stringify(monthRows))
 assert.ok(monthRows.some(r=>/^运动\|.* 天$/.test(r)),JSON.stringify(monthRows))
 // The week's placed slot (散步 on 10-22) shows in the month as a read-only item from that week.
 await page.locator('.modular-diary-plan-month-cell[data-zone="2026-10-22"] .modular-diary-plan-pill.is-foreign',{hasText:'散步'}).waitFor()
 // A written goal with a note, ticked from the rail.
 await page.locator('.modular-diary-period-text-goals .modular-diary-component-actions button').click()
 await page.locator('.modular-diary-period-goal-form.is-text .modular-diary-period-goal-title').fill('把月视图做完')
 await page.locator('.modular-diary-period-goal-form.is-text .modular-diary-period-goal-note').fill('纵向时间轴')
 await page.locator('.modular-diary-period-goal-form.is-text').evaluate(f=>f.requestSubmit())
 await page.waitForFunction(()=>window.files['周期/2026-10.md'].includes('goal: text="把月视图做完" note="纵向时间轴"'))
 await page.evaluate(()=>window.mountActual())
 await page.locator('.modular-diary-text-goal',{hasText:'把月视图做完'}).waitFor()
 await page.locator('.modular-diary-text-goal input[type="checkbox"]').check()
 await page.waitForFunction(()=>window.files['周期/2026-10.md'].includes('goal: text="把月视图做完" note="纵向时间轴" done=true'))
 await page.evaluate(()=>window.mountActual())
 await page.locator('.modular-diary-text-goal.is-done').waitFor()
 // 5. The board's pencil opens the rhythms panel (forms, not markdown); edits write back to 节律.md.
 await page.locator('.modular-diary-plan-board .modular-diary-component-actions button').nth(1).click()
 await page.locator('.modular-diary-rhythm-modal .modular-diary-rhythm-item').nth(3).waitFor()
 assert.equal(await page.locator('.modular-diary-rhythm-item').count(),5)
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
