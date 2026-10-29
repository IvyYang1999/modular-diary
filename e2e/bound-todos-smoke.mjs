/**
 * Actual plugin, in-memory vault: todos hung under written goals and rhythms.
 * A goal's menu adds a todo straight under it; a daily rhythm takes todos too;
 * the bound lists group by day and a row dragged into another day's group moves
 * there; goals reorder by their grip; with grouping off, bound rows reorder.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import esbuild from 'esbuild'
import {chromium} from 'playwright'
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),out=fs.mkdtempSync(path.join(os.tmpdir(),'modular-diary-bound-todos-'))
const built=await esbuild.build({entryPoints:[path.join(root,'src/main.ts')],bundle:true,write:false,platform:'browser',format:'iife',globalName:'MDPlugin',external:['obsidian','node:*','child_process']})
const daySource='date: 2026-10-22\nrange: 9-11\nview: week\n---\n09:00-10:00 work'
const rhythms='# 节律\n\n- 每周 拍视频 @work 整天\n- 每天 30分钟 运动 @study\n'
const weekSource=['days: 2026-10-19..2026-10-25','scope: week','goal: text="目标甲" id="g-a" subs="day"','goal: text="目标乙" id="g-b"',
 '- [ ] todo: id="t-a1" estimate=30 category="work" group="" day=2026-10-19 goal="g-a" title="甲一"',
 '- [ ] todo: id="t-a2" estimate=60 category="work" group="" day=2026-10-21 goal="g-a" title="甲二"',
 '- [ ] todo: id="t-a3" estimate=30 category="work" group="" goal="g-a" title="甲三"',
 '- [ ] todo: id="t-b1" estimate=30 category="study" group="" day=2026-10-20 goal="g-b" title="乙一"',
 '---'].join('\n')
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
window.files={'synthetic.md':${JSON.stringify('```timeline\n'+daySource+'\n```')},'节律.md':${JSON.stringify(rhythms)},'周期/2026-W43.md':${JSON.stringify('```timeline\n'+weekSource+'\n```')}};
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
const week=()=>'周期/2026-W43.md'
const drag=async(page,from,to,steps=8)=>{await page.mouse.move(from.x+from.width*0.6,from.y+from.height/2);await page.mouse.down();await page.mouse.move(from.x+40,from.y+10);await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps});await page.mouse.up()}
const browser=await chromium.launch({headless:true})
try{
 const page=await browser.newPage({viewport:{width:1200,height:1000},timezoneId:'Asia/Shanghai'}),errors=[];page.on('pageerror',e=>errors.push(e.stack))
 await page.goto('file://'+path.join(out,'index.html'))
 await page.waitForFunction(()=>window.plugin)
 await page.waitForFunction(()=>window.files['周期/2026-W43.md'].includes('rhythm="拍视频"'))
 await page.evaluate(()=>window.mountActual())
 await page.locator('.modular-diary-period.is-plan').waitFor()
 if(errors.length)throw Error(errors.join('\n'))
 // 1. Goals render as groups (goal + its todos) with a grip; the bound list groups by day, days in order, 未安排 last.
 const goalA=page.locator('.modular-diary-text-goal-group',{has:page.locator('.modular-diary-text-goal-title',{hasText:'目标甲'})})
 assert.equal(await page.locator('.modular-diary-text-goal-group').count(),2)
 assert.equal(await goalA.locator('.modular-diary-text-goal-grip').count(),1,'a goal has a drag grip')
 const groupsA=await goalA.locator('.modular-diary-plan-subs .modular-diary-todo-group-section').evaluateAll(list=>list.map(s=>s.dataset.groupKey+'|'+s.dataset.zone+'|'+s.querySelector('.modular-diary-todo-group-name')?.textContent))
 assert.deepEqual(groupsA,['d:2026-10-19|2026-10-19|周一 10.19','d:2026-10-21|2026-10-21|周三 10.21','d:|pool|未安排'],JSON.stringify(groupsA))
 assert.equal(await goalA.locator('.modular-diary-plan-subs .modular-diary-todo-row',{hasText:'甲一'}).locator('.modular-diary-todo-flag').count(),0,'grouped by day, the row shows no day flag')
 const goalB0=page.locator('.modular-diary-text-goal-group',{has:page.locator('.modular-diary-text-goal-title',{hasText:'目标乙'})})
 assert.equal(await goalB0.locator('.modular-diary-todo-group-section').count(),0,'each goal groups its own list')
 // The daily rhythm row has a (still empty) list of its own; the add form is not shown until asked for.
 const dailyRow=page.locator('.modular-diary-plan-board .modular-diary-plan-row',{hasText:'运动'})
 assert.equal(await dailyRow.locator('xpath=following-sibling::*[1]').evaluate(el=>el.className),'modular-diary-plan-subs')
 assert.equal(await page.locator('.modular-diary-plan-subs .modular-diary-todo-add-form:not([hidden])').count(),0)
 await page.screenshot({path:path.join(out,'bound-by-day.png')})
 // 2. The goal's menu: 添加子待办 opens the add form under that goal; the new todo is bound to it.
 await goalA.locator('.modular-diary-text-goal').click({button:'right'})
 const goalMenu=await page.locator('#menu button').allInnerTexts()
 for(const label of ['添加子待办','添加子目标','不分组','按天','按标签','删除目标'])assert.ok(goalMenu.includes(label),label+' in '+JSON.stringify(goalMenu))
 await page.locator('#menu button',{hasText:'添加子待办'}).click()
 const formA=goalA.locator('.modular-diary-plan-subs .modular-diary-todo-add-form:not([hidden])')
 await formA.waitFor()
 await formA.locator('.modular-diary-todo-title-input').fill('甲四')
 await formA.locator('.modular-diary-todo-title-input').press('Enter')
 await page.waitForFunction(()=>/goal="g-a"[^\n]*title="甲四"|title="甲四"[^\n]*goal="g-a"/.test(window.files['周期/2026-W43.md']))
 await page.evaluate(()=>window.mountActual())
 await page.locator('.modular-diary-text-goal-group .modular-diary-todo-row',{hasText:'甲四'}).waitFor()
 // 3. A daily rhythm's menu adds a todo under it (taking the rhythm's category); it hangs off the daily row.
 await dailyRow.click({button:'right'})
 const dailyMenu=await page.locator('#menu button').allInnerTexts()
 assert.ok(dailyMenu.includes('添加子待办'),JSON.stringify(dailyMenu))
 await page.locator('#menu button',{hasText:'添加子待办'}).click()
 const formD=page.locator('.modular-diary-plan-board .modular-diary-plan-subs .modular-diary-todo-add-form:not([hidden])')
 await formD.waitFor()
 await formD.locator('.modular-diary-todo-title-input').fill('周二跑步')
 await formD.locator('.modular-diary-todo-title-input').press('Enter')
 await page.waitForFunction(()=>/category="study"[^\n]*under="运动"[^\n]*title="周二跑步"/.test(window.files['周期/2026-W43.md']))
 await page.evaluate(()=>window.mountActual())
 const dailySubs=page.locator('.modular-diary-plan-board .modular-diary-plan-row',{hasText:'运动'}).locator('xpath=following-sibling::*[1]')
 await dailySubs.locator('.modular-diary-todo-row',{hasText:'周二跑步'}).waitFor()
 // 4. A row dragged into another day's group moves to that day; into 未安排 it comes off the day.
 const rowA1=page.locator('.modular-diary-text-goal-group .modular-diary-todo-row',{hasText:'甲一'})
 const wedGroup=page.locator('.modular-diary-text-goal-group .modular-diary-todo-group-section[data-group-key="d:2026-10-21"]')
 await drag(page,await rowA1.boundingBox(),await wedGroup.locator('.modular-diary-todo-row').first().boundingBox())
 await page.waitForFunction(()=>/day=2026-10-21[^\n]*title="甲一"/.test(window.files['周期/2026-W43.md']))
 await page.evaluate(()=>window.mountActual())
 await page.locator('.modular-diary-todo-group-section[data-group-key="d:2026-10-21"] .modular-diary-todo-row',{hasText:'甲一'}).waitFor()
 const poolGroup=page.locator('.modular-diary-text-goal-group .modular-diary-todo-group-section[data-group-key="d:"]').first()
 await drag(page,await page.locator('.modular-diary-text-goal-group .modular-diary-todo-row',{hasText:'甲二'}).boundingBox(),await poolGroup.boundingBox())
 await page.waitForFunction(()=>!/day=[^\n]*title="甲二"/.test(window.files['周期/2026-W43.md']))
 await page.evaluate(()=>window.mountActual())
 await page.locator('.modular-diary-todo-group-section[data-group-key="d:"] .modular-diary-todo-row',{hasText:'甲二'}).waitFor()
 // 5. Goals reorder by their grip: 乙 dragged above 甲 swaps the goal lines.
 const goalB=page.locator('.modular-diary-text-goal-group',{has:page.locator('.modular-diary-text-goal-title',{hasText:'目标乙'})})
 const gripB=await goalB.locator('.modular-diary-text-goal-grip').boundingBox(),goalABox=await goalA.boundingBox()
 await page.mouse.move(gripB.x+gripB.width/2,gripB.y+gripB.height/2);await page.mouse.down();await page.mouse.move(gripB.x+2,gripB.y-20);await page.mouse.move(goalABox.x+100,goalABox.y+4,{steps:8});await page.mouse.up()
 await page.waitForFunction(()=>window.files['周期/2026-W43.md'].indexOf('goal: text="目标乙"')<window.files['周期/2026-W43.md'].indexOf('goal: text="目标甲"'))
 await page.evaluate(()=>window.mountActual())
 assert.ok((await page.locator('.modular-diary-text-goal-group').first().locator('.modular-diary-text-goal-title').textContent()).startsWith('目标乙'))
 // 6. Grouping off (from the goal's menu): bound rows reorder among themselves by dragging.
 await page.locator('.modular-diary-text-goal-group',{has:page.locator('.modular-diary-text-goal-title',{hasText:'目标甲'})}).first().locator('.modular-diary-text-goal').first().click({button:'right'})
 await page.locator('#menu button',{hasText:'不分组'}).click()
 await page.waitForFunction(()=>/goal: text="目标甲" id="g-a"(?! subs=)/.test(window.files['周期/2026-W43.md']))
 await page.evaluate(()=>window.mountActual())
 const listA=page.locator('.modular-diary-text-goal-group',{has:page.locator('.modular-diary-text-goal-title',{hasText:'目标甲'})}).locator('.modular-diary-plan-subs')
 await listA.locator('.modular-diary-todo-row',{hasText:'甲四'}).waitFor()
 assert.equal(await listA.locator('.modular-diary-todo-group-section').count(),0,'no day groups once grouping is off')
 const before=await listA.locator('.modular-diary-todo-row .modular-diary-item-title').allInnerTexts()
 assert.deepEqual(before,['甲一','甲二','甲三','甲四'],JSON.stringify(before))
 const r4=await listA.locator('.modular-diary-todo-row',{hasText:'甲四'}).boundingBox(),r1=await listA.locator('.modular-diary-todo-row',{hasText:'甲一'}).boundingBox()
 await page.mouse.move(r4.x+r4.width*0.6,r4.y+r4.height/2);await page.mouse.down();await page.mouse.move(r4.x+40,r4.y-10);await page.mouse.move(r1.x+r1.width/2,r1.y+3,{steps:8});await page.mouse.up()
 await page.waitForFunction(()=>window.files['周期/2026-W43.md'].indexOf('title="甲四"')<window.files['周期/2026-W43.md'].indexOf('title="甲一"'))
 await page.evaluate(()=>window.mountActual())
 const after=await page.locator('.modular-diary-text-goal-group',{has:page.locator('.modular-diary-text-goal-title',{hasText:'目标甲'})}).locator('.modular-diary-todo-row .modular-diary-item-title').allInnerTexts()
 assert.deepEqual(after,['甲四','甲一','甲二','甲三'],JSON.stringify(after))
 await page.screenshot({path:path.join(out,'bound-reordered.png')})
 // 7. A sub-goal from the goal's menu: it sits under the goal, points at it, and carries its own todo list.
 const goalA7=page.locator('.modular-diary-text-goal-group',{has:page.locator('.modular-diary-text-goal-title',{hasText:'目标甲'})}).first()
 await goalA7.locator('.modular-diary-text-goal').first().click({button:'right'})
 await page.locator('#menu button',{hasText:'添加子目标'}).click()
 const subForm=goalA7.locator('.modular-diary-text-goal-children .modular-diary-period-goal-form.is-text')
 await subForm.waitFor()
 await subForm.locator('.modular-diary-period-goal-title').fill('甲子')
 await subForm.evaluate(f=>f.requestSubmit())
 await page.waitForFunction(()=>window.files['周期/2026-W43.md'].includes('goal: text="甲子" parent="g-a"'))
 await page.evaluate(()=>window.mountActual())
 const subGoal=page.locator('.modular-diary-text-goal-group.is-sub',{has:page.locator('.modular-diary-text-goal-title',{hasText:'甲子'})})
 await subGoal.waitFor()
 assert.equal(await subGoal.locator('xpath=ancestor::*[contains(@class,"modular-diary-text-goal-group")][1]//span[contains(@class,"modular-diary-text-goal-title")]').first().innerText().then(t=>t.startsWith('目标甲')),true,'the sub-goal renders inside its parent')
 // Ticking the only sub-goal does not tick the parent while the parent still has open todos.
 await subGoal.locator('input[type="checkbox"]').check()
 await page.waitForFunction(()=>/goal: text="甲子" parent="g-a" done=true/.test(window.files['周期/2026-W43.md']))
 assert.ok(!/goal: text="目标甲"[^\n]*done=true/.test(await page.evaluate(()=>window.files['周期/2026-W43.md'])),'parent stays open: its todos are not done')
 // 8. A sub-todo under a bound todo, from the row's menu.
 await page.evaluate(()=>window.mountActual())
 const rowA1b=page.locator('.modular-diary-text-goal-group .modular-diary-todo-row',{hasText:'甲一'}).first()
 await rowA1b.waitFor()
 await rowA1b.click({button:'right'})
 await page.locator('#menu button',{hasText:'添加子待办'}).click()
 const childForm=page.locator('.modular-diary-text-goal-group .modular-diary-todo-add-form.is-child:not([hidden])')
 await childForm.waitFor()
 await childForm.locator('.modular-diary-todo-title-input').fill('甲一甲')
 await childForm.locator('.modular-diary-todo-title-input').press('Enter')
 await page.waitForFunction(()=>/parent="t-a1"[^\n]*title="甲一甲"/.test(window.files['周期/2026-W43.md']))
 await page.evaluate(()=>window.mountActual())
 await page.locator('.modular-diary-text-goal-group .modular-diary-todo-row',{hasText:'甲一甲'}).waitFor()
 // The add form has a cancel button that closes it.
 await page.locator('.modular-diary-text-goal-group .modular-diary-todo-row',{hasText:'甲二'}).first().click({button:'right'})
 await page.locator('#menu button',{hasText:'添加子待办'}).click()
 const openForm=page.locator('.modular-diary-todo-add-form:not([hidden])').first()
 await openForm.waitFor()
 await openForm.locator('.modular-diary-todo-cancel').click()
 assert.equal(await page.locator('.modular-diary-todo-add-form:not([hidden])').count(),0,'cancel closes the form')
 await page.screenshot({path:path.join(out,'sub-goal.png')})
 // 9. 设定时刻… on a placed row writes `at=`: the week draws it in the right band with its time, no day note written;
 //    the day view draws the same block from the week note, and its menu can take the time away again.
 const rowB1=page.locator('.modular-diary-text-goal-group .modular-diary-todo-row',{hasText:'乙一'}).first()
 await rowB1.click({button:'right'})
 await page.locator('#menu button',{hasText:'设定时刻'}).click()
 const timeInput=page.locator('.modular-diary-point-time-popover input')
 await timeInput.waitFor()
 await timeInput.fill('15:00');await timeInput.press('Enter')
 await page.waitForFunction(()=>/day=2026-10-20[^\n]*at=15:00[^\n]*title="乙一"/.test(window.files['周期/2026-W43.md']))
 assert.ok(!Object.keys(await page.evaluate(()=>window.files)).some((p)=>/2026-10-20/.test(p)&&!p.startsWith('周期/')),'no day note is written for a timed todo')
 // The harness day moves to Tuesday first, so the day view later shows the timed todo's own day.
 await page.evaluate(()=>{window.files['synthetic.md']=window.files['synthetic.md'].replace('date: 2026-10-22','date: 2026-10-20')})
 await page.evaluate(()=>window.mountActual())
 const timedPill=page.locator('.modular-diary-plan-band[data-zone="2026-10-20@pm"] .modular-diary-plan-pill',{hasText:'乙一'})
 await timedPill.waitFor()
 assert.ok((await timedPill.innerText()).includes('15:00'),'the pill shows its time in the afternoon band')
 // The same todo seen from its day: move the harness day to Tuesday and switch to the day view.
 await page.locator('.modular-diary-seg button',{hasText:'日'}).first().click()
 await page.waitForFunction(()=>!window.files['synthetic.md'].includes('view:'))
 await page.evaluate(()=>window.mountActual())
 await page.locator('.modular-diary-view-bar').waitFor()
 const virtualBlock=page.locator('rect.modular-diary-block[data-line^="-"]')
 await virtualBlock.first().waitFor()
 assert.equal(await virtualBlock.count(),1,'the timed todo is one plan block on the day timeline')
 await virtualBlock.first().evaluate((el)=>{const r=el.getBoundingClientRect();el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,button:2}))})
 const blockMenu=await page.locator('#menu button').allInnerTexts()
 assert.ok(blockMenu.some((text)=>text.includes('取消定时')),JSON.stringify(blockMenu))
 await page.locator('#menu button',{hasText:'取消定时'}).click()
 await page.waitForFunction(()=>!/at=\d\d:\d\d[^\n]*title="乙一"/.test(window.files['周期/2026-W43.md']) && /day=2026-10-20[^\n]*title="乙一"/.test(window.files['周期/2026-W43.md']))
 await page.screenshot({path:path.join(out,'timed-day.png')})
 // 10. 新建日程: one line → a todo in that date's week note, timed and categorised; the preview says what will be written.
 await page.evaluate(()=>window.plugin.openQuickSchedule())
 const quick=page.locator('.modular-diary-quick-schedule-input')
 await quick.waitFor()
 await quick.fill('10月23日 下午3点 参加演出 @work 2小时')
 const previewText=await page.locator('.modular-diary-quick-schedule-preview').innerText()
 assert.ok(previewText.includes('15:00')&&previewText.includes('参加演出')&&previewText.includes('work'),previewText)
 await quick.press('Enter')
 await page.waitForFunction(()=>/estimate=120 category="work"[^\n]*day=2026-10-23[^\n]*at=15:00[^\n]*title="参加演出"/.test(window.files['周期/2026-W43.md']))
 // Opened from a cell: the line without a date lands on that day and part of it.
 await page.evaluate(()=>window.plugin.openQuickSchedule({date:'2026-10-24',zone:'pm'}))
 const quick2=page.locator('.modular-diary-quick-schedule-input')
 await quick2.waitFor()
 await quick2.fill('买花')
 await quick2.press('Enter')
 await page.waitForFunction(()=>/day=2026-10-24[^\n]*zone=pm[^\n]*title="买花"/.test(window.files['周期/2026-W43.md']))
 await page.evaluate(()=>{window.notices.length=0})
 assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.notices),[])
 console.log('PASS bound todos: goal menu adds, daily rhythms take todos, day groups move, goals and rows reorder. Screenshots:',out)
}catch(e){console.error(e);process.exitCode=1}finally{await browser.close()}
