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
window.notices=[];window.require=n=>n==='obsidian'?obsidian:n==='node:os'?{homedir:()=>'/synthetic'}:n==='node:path'?{join:(...p)=>p.join('/')}:{};
window.__base={obsidian,cleanup};
`
const init=`
window.renderActual=async()=>{const {obsidian,cleanup}=window.__base;cleanup.splice(0).forEach(f=>f());const plugin=window.plugin||(window.plugin=new MDPlugin.default());const file=window.file||(window.file=new obsidian.TFile());file.path='synthetic.md';const host=document.querySelector('#host');host.empty();let content=await window.readDisk();const view=window.view||(window.view=new obsidian.MarkdownView());view.file=file;view.leaf=window.owner||(window.owner={});view.containerEl=host;view.getMode=()=> 'preview';view.editor={getValue:()=>content};
plugin.settings={...plugin.settings,spanTypeColors:{work:'#53b5d1'},habits:[],weeklyTodos:[],dailyQuotes:[],timelineOnboardingSeen:true,tagCategories:{},dialogBackend:'claude-cli'};
plugin.app={vault:{getAbstractFileByPath:p=>p==='synthetic.md'?file:null,read:async()=>window.readDisk(),process:async(_f,change)=>{content=change(await window.readDisk());await window.writeDisk(content);setTimeout(()=>window.mountActual(),0)}},workspace:{iterateAllLeaves:f=>f({view}),getActiveViewOfType:()=>view,getActiveFile:()=>file,getLeavesOfType:()=>[{view}],on:()=>({})},metadataCache:{getFileCache:()=>({})}};
const ctx={sourcePath:file.path,docId:'actual-plugin',getSectionInfo:()=>({lineStart:0,lineEnd:content.split('\\n').length-1}),addChild:()=>{}};const source=content.split('\\n').slice(1,-1).join('\\n');plugin.renderTimelineBlock(source,host,ctx,null);plugin.remountVisual.clear();
};let mountQueue=Promise.resolve();window.mountActual=()=>{mountQueue=mountQueue.then(()=>window.renderActual());return mountQueue};window.mountActual();
`
const css=fs.readFileSync(path.join(root,'styles.css'),'utf8')
fs.writeFileSync(path.join(out,'index.html'),`<!doctype html><meta charset="utf-8"><style>:root{--background-primary:#fff;--background-secondary:#f5f5f5;--background-modifier-border:#ccc;--background-modifier-hover:#eee;--text-normal:#222;--text-muted:#666;--text-faint:#888;--text-accent:#875bef;--interactive-accent:#875bef;--font-ui-smaller:13px}body{margin:24px;font-family:system-ui}#host{width:880px}#menu{position:fixed;left:30px;top:30px;background:#fff;border:1px solid #bbb;z-index:99999;display:flex;flex-direction:column}${css}</style><main id="host"></main><script>${setup}</script><script>${built.outputFiles[0].text}</script><script>${init}</script>`)
const browser=await chromium.launch({headless:true})
try{
 const page=await browser.newPage({viewport:{width:1100,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.stack))
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
 await page.evaluate(()=>{window.notices.length=0})
 assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.notices),[])
 console.log('PASS actual plugin menu → independent modules → disk checkbox → remount. Screenshot:',out)
} catch(e){console.error(e);process.exitCode=1}finally{await browser.close()}
