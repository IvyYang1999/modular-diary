/** Actual plugin renderer/menu/writer, with isolated Obsidian APIs and real disk IO. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import esbuild from 'esbuild'
import {chromium} from 'playwright'
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),out=fs.mkdtempSync(path.join(os.tmpdir(),'modular-diary-checklist-wiring-'))
const built=await esbuild.build({entryPoints:[path.join(root,'src/main.ts')],bundle:true,write:false,platform:'browser',format:'iife',globalName:'MDPlugin',external:['obsidian','node:*','child_process']})
const source='date: 2026-10-22\nrange: 9-11\nlayout: toolbar@0,0,6,3 timeline@6,0,6,14\noff: dialog stats\n---\n09:00-10:00 work'
const file=path.join(out,'synthetic.md');fs.writeFileSync(file,'```timeline\n'+source+'\n```')
const setup=`
for(const [method,tag] of [['createDiv','div'],['createSpan','span'],['createEl',null]])HTMLElement.prototype[method]=function(a={},b={}){const opts=tag?a:b,el=document.createElement(tag||a);if(opts.cls)el.className=Array.isArray(opts.cls)?opts.cls.join(' '):opts.cls;if(opts.text)el.textContent=opts.text;for(const [k,v] of Object.entries(opts.attr||{}))el.setAttribute(k,v);this.append(el);return el}
HTMLElement.prototype.empty=function(){this.replaceChildren()};HTMLElement.prototype.addClass=function(...c){this.classList.add(...c)};HTMLElement.prototype.removeClass=function(...c){this.classList.remove(...c)};HTMLElement.prototype.toggleClass=function(c,v){this.classList.toggle(c,v)};HTMLElement.prototype.setText=function(t){this.textContent=t};
const cleanup=[];class Base{registerDomEvent(target,name,cb,opts){target.addEventListener(name,cb,opts);cleanup.push(()=>target.removeEventListener(name,cb,opts))}registerEvent(){}register(){}addChild(){}}
class TFile{};class TFolder{};class MarkdownView{};
class Menu{constructor(){this.items=[]}addItem(cb){let title='',handler=()=>{},label=false,sub=null;const item=new Proxy({setTitle:t=>{title=t;return item},onClick:cb=>{handler=cb;return item},setIsLabel:()=>{label=true;return item},setSubmenu:()=>(sub=new Menu())},{get:(o,k)=>o[k]||(()=>item)});cb(item);this.items.push({title,handler,label,get sub(){return sub}});return this}addSeparator(){return this}flat(){return this.items.flatMap(i=>i.sub?[{...i,label:true},...i.sub.flat()]:[i])}showAtPosition(){document.querySelector('#menu')?.remove();const m=document.body.createDiv({});m.id='menu';m.setAttribute('role','menu');for(const i of this.flat()){const b=m.createEl('button',{text:i.title,attr:{type:'button'}});b.disabled=i.label;b.onclick=()=>{m.remove();i.handler()}}}}
const obsidian=new Proxy({Plugin:Base,PluginSettingTab:Base,Modal:Base,MarkdownRenderChild:Base,FuzzySuggestModal:Base,TFile,TFolder,MarkdownView,Menu,Platform:{isDesktopApp:false,isMobile:false},getLanguage:()=> 'zh',normalizePath:p=>p,setIcon:(el,name)=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.innerHTML='<path d="M5 12h14M12 5v14" stroke="currentColor"/>';el.append(svg)},MarkdownRenderer:{render:async(_a,text,el)=>{el.textContent=text}},Notice:class{constructor(text){window.notices.push(text)}},moment:()=>({format:()=> '2026-10-22'})},{get:(o,k)=>o[k]??Base});
window.activeWindow=window;window.activeDocument=document;window.notices=[];window.require=n=>n==='obsidian'?obsidian:n==='node:os'?{homedir:()=>'/synthetic'}:n==='node:path'?{join:(...p)=>p.join('/')}:{};
window.__base={obsidian,cleanup};
`
const init=`
window.renderActual=async()=>{const {obsidian,cleanup}=window.__base;cleanup.splice(0).forEach(f=>f());const plugin=window.plugin||(window.plugin=new MDPlugin.default());const file=window.file||(window.file=new obsidian.TFile());file.path='synthetic.md';const host=document.querySelector('#host');host.empty();let content=await window.readDisk();const view=window.view||(window.view=new obsidian.MarkdownView());view.file=file;view.leaf=window.owner||(window.owner={});view.containerEl=host;view.getMode=()=> 'preview';view.editor={getValue:()=>content};
plugin.settings={...plugin.settings,spanTypeColors:{work:'#53b5d1',study:'#c085db'},habits:[],weeklyTodos:[],dailyQuotes:[],timelineOnboardingSeen:true,tagCategories:{},dialogBackend:'claude-cli'};
plugin.app={vault:{getAbstractFileByPath:p=>p==='synthetic.md'?file:null,read:async()=>window.readDisk(),process:async(_f,change)=>{if(window.failWrite)throw Error('synthetic write failure');content=change(await window.readDisk());await window.writeDisk(content);setTimeout(()=>window.mountActual(),0)}},workspace:{iterateAllLeaves:f=>f({view}),getActiveViewOfType:()=>view,getActiveFile:()=>file,getLeavesOfType:()=>[{view}],on:()=>({})},metadataCache:{getFileCache:()=>({})}};
const ctx={sourcePath:file.path,docId:'actual-plugin',getSectionInfo:()=>({text:content,lineStart:0,lineEnd:content.split('\\n').findIndex((line,index)=>index>0&&line==='\`\`\`')}),addChild:()=>{}};const source=content.match(/\`\`\`timeline\\n([\\s\\S]*?)\\n\`\`\`/)[1];plugin.renderTimelineBlock(source,host,ctx,null);plugin.remountVisual.clear();
};let mountQueue=Promise.resolve();window.mountActual=()=>{mountQueue=mountQueue.then(()=>window.renderActual());return mountQueue};window.mountActual();
`
const css=fs.readFileSync(path.join(root,'styles.css'),'utf8')
fs.writeFileSync(path.join(out,'index.html'),`<!doctype html><meta charset="utf-8"><style>:root{--background-primary:#fff;--background-secondary:#f5f5f5;--background-modifier-border:#ccc;--background-modifier-hover:#eee;--text-normal:#222;--text-muted:#666;--text-faint:#888;--text-accent:#875bef;--interactive-accent:#875bef;--font-ui-smaller:13px}body{margin:24px;font-family:system-ui}#host{width:880px}#menu{position:fixed;left:30px;top:30px;background:#fff;border:1px solid #bbb;z-index:99999;display:flex;flex-direction:column}${css}</style><main id="host"></main><script>${setup}</script><script>${built.outputFiles[0].text}</script><script>${init}</script>`)
const browser=await chromium.launch({headless:true})
try{
 const page=await browser.newPage({viewport:{width:1100,height:900},timezoneId:'Asia/Shanghai'}),errors=[];page.on('pageerror',e=>errors.push(e.stack))
 await page.exposeFunction('readDisk',()=>fs.readFileSync(file,'utf8'))
 await page.exposeFunction('writeDisk',content=>fs.writeFileSync(file,content))
 await page.goto('file://'+path.join(out,'index.html'))
 await page.waitForFunction(()=>window.plugin)
 if(errors.length)throw Error(errors.join('\n'))
 await page.getByRole('button',{name:'添加模块',exact:true}).click()
 await page.getByRole('button',{name:'添加 Checklist',exact:true}).click()
 await page.locator('[data-slot="checklist1"]').waitFor()
 assert.ok(fs.readFileSync(file,'utf8').includes('checklist:'))
 const module=page.locator('[data-slot="checklist1"]')
 await module.getByRole('button',{name:'添加第一项',exact:true}).click()
 await module.getByRole('textbox',{name:'添加清单项',exact:true}).fill('Actual plugin checklist item')
 await module.getByRole('textbox',{name:'添加清单项',exact:true}).press('Enter')
 await module.getByRole('checkbox',{name:'Actual plugin checklist item',exact:true}).waitFor()
 await module.getByRole('checkbox',{name:'Actual plugin checklist item',exact:true}).check()
 await page.waitForFunction(async()=>(await window.readDisk()).includes('\"checked\":true'))
 assert.ok(fs.readFileSync(file,'utf8').includes('"checked":true'))
 await page.evaluate(()=>window.mountActual())
 assert.equal(await module.getByRole('checkbox',{name:'Actual plugin checklist item',exact:true}).isChecked(),true)
 await page.getByRole('button',{name:'添加模块',exact:true}).click();await page.getByRole('button',{name:'添加 Checklist',exact:true}).click()
 await page.locator('[data-slot="checklist2"]').waitFor()
 assert.equal(await page.locator('.modular-diary-checklist').count(),2)
 // Actual component context menu hides the module without dropping its data.
 const firstSlot=page.locator('[data-slot="checklist1"]')
 await firstSlot.click({button:'right',position:{x:80,y:125}})
 await page.getByRole('menuitem',{name:'隐藏',exact:true}).click()
 await page.waitForFunction(()=>!document.querySelector('[data-slot="checklist1"]'))
 assert.ok(fs.readFileSync(file,'utf8').includes('"id":"checklist1"'))
 await page.getByRole('button',{name:'添加模块',exact:true}).click()
 await page.getByRole('button',{name:'显示「清单」',exact:true}).click()
 await page.locator('[data-slot="checklist1"]').waitFor()
 assert.equal(await page.locator('[data-slot="checklist1"]').getByRole('checkbox',{name:'Actual plugin checklist item',exact:true}).isChecked(),true)
 await page.screenshot({path:path.join(out,'actual-plugin-checklists.png')})
 // A section title can be pinned, and the add menu then offers it next to the built-in components.
 await page.evaluate(()=>{window.plugin.saveData=async()=>{};window.plugin.settings.pinnedSections=[]})
 await page.getByRole('button',{name:'添加模块',exact:true}).click()
 await page.getByRole('button',{name:'阅读笔记',exact:true}).click()
 await page.getByRole('button',{name:'重命名栏目 阅读笔记',exact:true}).waitFor()
 await page.getByRole('button',{name:'重命名栏目 阅读笔记',exact:true}).click({button:'right'})
 await page.getByRole('button',{name:'固定「阅读笔记」到添加菜单',exact:true}).click()
 assert.deepEqual(await page.evaluate(()=>window.plugin.settings.pinnedSections),['阅读笔记'])
 await page.getByRole('button',{name:'添加模块',exact:true}).click()
 await page.getByRole('button',{name:'添加「阅读笔记」',exact:true}).click()
 await page.waitForFunction(()=>document.querySelectorAll('.modular-diary-text-title').length===2)
 await page.getByRole('button',{name:'重命名栏目 阅读笔记',exact:true}).first().click({button:'right'})
 await page.getByRole('button',{name:'从添加菜单取消固定「阅读笔记」',exact:true}).click()
 assert.deepEqual(await page.evaluate(()=>window.plugin.settings.pinnedSections),[])
 // The Upcoming component lists the schedule from today on, grouped by day.
 await page.evaluate(()=>{window.plugin.upcoming.items=[
   {line:3,date:'2099-01-03',text:'Untimed item',done:false},
   {line:2,date:'2099-01-02',startMin:600,endMin:660,type:'work',text:'Future item',done:false},
   {line:1,date:'2000-01-01',text:'Past item',done:false},
   {line:0,date:'2099-01-02',text:'Copied item',done:true}]})
 await page.getByRole('button',{name:'添加模块',exact:true}).click()
 await page.getByRole('button',{name:'添加 Upcoming 组件',exact:true}).click()
 await page.locator('[data-slot="upcoming"] .modular-diary-upcoming-row').first().waitFor()
 const upcoming=await page.locator('[data-slot="upcoming"]').evaluate(slot=>({
   days:[...slot.querySelectorAll('.modular-diary-upcoming-day')].map(e=>e.textContent),
   rows:[...slot.querySelectorAll('.modular-diary-upcoming-row')].map(r=>r.querySelector('.modular-diary-upcoming-time').textContent+' '+r.querySelector('.modular-diary-upcoming-text').textContent)}))
 assert.deepEqual(upcoming.rows,['10:00–11:00 work · Future item','全天 Untimed item'],JSON.stringify(upcoming))
 assert.equal(upcoming.days.length,2)
 assert.ok(fs.readFileSync(file,'utf8').includes('upcoming@'),'the component is placed in the layout')
 // Body Todo section: real renderer, native-style menu, production writer and disk.
 await page.evaluate(async()=>{
   window.plugin.settings.bodyTodoSection='Tasks'
   await window.writeDisk((await window.readDisk())+'\n\n# Tasks\n## Work\n- [ ] Body task\n# Notes\nUnrelated prose\n')
   await window.mountActual()
 })
 const bodyRow=()=>page.locator('.modular-diary-todo-row').filter({hasText:'Body task'})
 await bodyRow().waitFor()
 assert.equal(await bodyRow().locator('.modular-diary-todo-drag').count(),0,'body source order stays in the note')
 assert.equal(await bodyRow().locator('.modular-diary-item-meta-numbers').textContent(),'','untimed body todo has no zero/zero noise')
 await bodyRow().getByRole('button',{name:'标为完成',exact:true}).click()
 await page.waitForFunction(async()=>(await window.readDisk()).includes('- [x] Body task'))
 assert.ok(fs.readFileSync(file,'utf8').includes('Unrelated prose'))
 await bodyRow().getByRole('button',{name:'标为未完成',exact:true}).waitFor()
 await bodyRow().click({button:'right'})
 assert.equal(await page.getByRole('button',{name:'添加子待办',exact:true}).count(),0)
 await page.getByRole('button',{name:'编辑待办',exact:true}).click()
 const bodyForm=bodyRow().locator('.modular-diary-todo-edit-form')
 assert.equal(await bodyForm.locator('.modular-diary-todo-rank-row').isVisible(),false)
 assert.equal(await bodyForm.locator('.modular-diary-todo-attach-field').isVisible(),false)
 await bodyForm.getByRole('textbox',{name:'待办内容',exact:true}).fill('Body task renamed')
 await page.evaluate(()=>{window.failWrite=true})
 await bodyForm.getByRole('button',{name:'保存',exact:true}).click()
 await page.waitForFunction(()=>window.notices.length>0)
 assert.ok(fs.readFileSync(file,'utf8').includes('- [x] Body task\n'),'failed edit must not change disk')
 await bodyRow().locator('.modular-diary-todo-edit-form:not([hidden])').waitFor()
 assert.equal(await bodyRow().getByRole('textbox',{name:'待办内容',exact:true}).inputValue(),'Body task renamed')
 await page.evaluate(()=>{window.failWrite=false})
 await bodyRow().getByRole('button',{name:'保存',exact:true}).click()
 await page.waitForFunction(async()=>(await window.readDisk()).includes('- [x] Body task renamed'))
 await page.evaluate(()=>window.mountActual())
 assert.equal(await bodyRow().locator('.modular-diary-todo-edit-form').isVisible(),false,'acknowledged edits do not reopen drafts')
 // Resolve the current category at drag time; assert a genuinely new bound plan on disk.
 await page.getByRole('button',{name:'选择「study」分类；右键隐藏',exact:true}).click()
 const schedule=bodyRow().locator('.modular-diary-schedule-source')
 await schedule.scrollIntoViewIfNeeded()
 const sourceBounds=await schedule.boundingBox(),trackBounds=await page.locator('rect.modular-diary-track').first().boundingBox()
 const beforeSchedule=fs.readFileSync(file,'utf8')
 assert.ok(!beforeSchedule.includes('[todo:body-'))
 await page.mouse.move(sourceBounds.x+sourceBounds.width/2,sourceBounds.y+sourceBounds.height/2)
 await page.mouse.down();await page.mouse.move(trackBounds.x+trackBounds.width/2,trackBounds.y+trackBounds.height/4,{steps:10});await page.mouse.up()
 await page.waitForFunction(async()=>(await window.readDisk()).includes('[todo:body-'))
 const scheduled=fs.readFileSync(file,'utf8');assert.notEqual(scheduled,beforeSchedule);assert.match(scheduled,/study.*\[todo:body-/)
 // The now marker moves without replacing a draft or doing any file writes.
 await page.clock.setFixedTime(new Date('2026-10-22T09:20:00+08:00'))
 await page.evaluate(()=>window.plugin.refreshNowMarkers())
 const now=page.locator('g.modular-diary-now').first(),firstY=await now.locator('line').getAttribute('y1')
 await page.evaluate(()=>{window.clockDraft=document.createElement('textarea');window.clockDraft.value='retained draft';document.querySelector('#host').append(window.clockDraft)})
 await page.clock.setFixedTime(new Date('2026-10-22T09:50:00+08:00'))
 await page.evaluate(()=>window.plugin.refreshNowMarkers())
 assert.notEqual(await now.locator('line').getAttribute('y1'),firstY)
 assert.equal(await now.locator('text').textContent(),'09:50')
 assert.equal(await page.evaluate(()=>window.clockDraft.isConnected&&window.clockDraft.value==='retained draft'),true)
 assert.equal(fs.readFileSync(file,'utf8'),scheduled)
 await page.evaluate(()=>{window.clockDraft.remove()})
 await bodyRow().hover();await page.screenshot({path:path.join(out,'body-todo-now-light.png'),fullPage:true})
 await page.setViewportSize({width:420,height:760})
 await page.evaluate(()=>{document.body.classList.add('theme-dark');document.querySelector('#host').style.width='360px';document.documentElement.style.setProperty('--background-primary','#1e1e1e');Object.entries({'--background-primary':'#1e1e1e','--background-secondary':'#292929','--background-modifier-border':'#444','--background-modifier-hover':'#353535','--background-modifier-form-field':'#292929','--text-normal':'#ddd','--text-muted':'#aaa','--text-faint':'#888'}).forEach(([key,value])=>document.documentElement.style.setProperty(key,value));document.body.style.background='var(--background-primary)';document.body.style.color='var(--text-normal)'})
 await bodyRow().scrollIntoViewIfNeeded();await bodyRow().click({button:'right'});await page.getByRole('button',{name:'编辑待办',exact:true}).click()
 const bounds=await bodyRow().locator('.modular-diary-todo-save').boundingBox(),rowBounds=await bodyRow().boundingBox()
 assert.ok(bounds.x+ bounds.width<=rowBounds.x+rowBounds.width+1,'narrow save button stays inside its row')
 await page.screenshot({path:path.join(out,'body-todo-narrow-dark.png'),fullPage:true})
 await page.evaluate(()=>{window.notices.length=0})
 assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.notices),[])
 console.log('PASS actual plugin menu → independent modules → disk checkbox → remount. Screenshot:',out)
} catch(e){console.error(e);process.exitCode=1}finally{await browser.close()}
