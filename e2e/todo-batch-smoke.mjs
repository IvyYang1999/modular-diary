/** Synthetic file-backed host adapter: production Todo renderer/parser/rewriter, headless only. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import esbuild from 'esbuild'
import { chromium } from 'playwright'
import { createPostponeHost } from './todo-postpone-host.mjs'
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'modular-diary-todo-batch-'))
const dailyNotes = {folder:'Journal',format:'YYYY/MM/[日记] DD'}
const destination = createPostponeHost({dailyNotes}).destination()
const sourceFile = path.join(out, 'synthetic.timeline')
const authoredNote = 'note="  \\u5907注\\n第二行  "'
const initial = 'date: 2026-10-10\ntodo: id="low" done=false estimate=30 category="work" group="" title="简单任务" '+ authoredNote +' difficulty=1 priority="随时"\ntodo: id="high" done=false estimate=60 category="work" group="" title="重要任务" difficulty=5 priority="马上"\ntodo: id="unset" done=false estimate=0 category="" group="" title="旧待办"\n---\n09:00-10:00 work'
fs.writeFileSync(sourceFile, initial)
fs.writeFileSync(path.join(out,'obsidian.ts'), `export function setIcon(el, name) {
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
 const shape=document.createElementNS(svg.namespaceURI,name==='check'?'path':'circle');
 if(name==='check'){shape.setAttribute('d','M5 12l4 4L19 6')}else{shape.setAttribute('cx','12');shape.setAttribute('cy','12');shape.setAttribute('r','9')}
 shape.setAttribute('stroke','currentColor');shape.setAttribute('stroke-width','2');shape.setAttribute('fill','none');svg.append(shape);el.append(svg)
}`)
const entry = `
import {renderTodosInto} from '${root}/src/render/todos-view'
import {parseTimeline} from '${root}/src/core/parser'
import {updateTodo,insertTodo,setHeaderValue} from '${root}/src/edit/source-rewriter'
import {formatTodoViewHeaderValue,todoMetrics} from '${root}/src/core/todos'
for(const [method,tag] of [['createDiv','div'],['createEl',null]]) HTMLElement.prototype[method]=function(a={},b={}){
 const opts=tag?a:b, el=document.createElement(tag||a);if(opts.cls)el.className=opts.cls;if(opts.text)el.textContent=opts.text;
 for(const [k,v] of Object.entries(opts.attr||{}))el.setAttribute(k,String(v));this.append(el);return el
}
let source=${JSON.stringify(initial)}, editDraft=null
let queue=Promise.resolve()
const persist=(transform)=>{queue=queue.then(async()=>{const next=transform(source);await window.persistSource(next);source=next;mount()});return queue}
window.errors=[]
const host=document.querySelector('#host')
function mount(){
 host.replaceChildren();const doc=parseTimeline(source);if(doc.errors.length)throw Error(JSON.stringify(doc.errors))
 renderTodosInto(host,doc.todos.map(t=>({...t,...todoMetrics(t,doc.entries),weekly:false})),{
 categories:['work'],priorities:['马上','随时'],typeColors:{work:'#777'},view:doc.todoView,editDraft,
 onEditDraftChange:d=>editDraft=d,
 onAdd:i=>persist(s=>insertTodo(s,{id:'new',title:i.title,group:'',type:i.type,estimateMin:i.estimateMinutes,completed:false,note:i.note,difficulty:i.difficulty,priority:i.priority})),
 onEdit:(id,i)=>persist(s=>updateTodo(s,id,{title:i.title,type:i.type,estimateMin:i.estimateMinutes,note:i.note,difficulty:i.difficulty,priority:i.priority})),
 onToggle:(id,completed)=>persist(s=>updateTodo(s,id,{completed,partial:false})),
 onMenu:(item,x,y,edit)=>{document.querySelector('#menu')?.remove();const menu=document.body.createDiv({});menu.id='menu';
 for(const [label,action] of [['编辑',edit],['半完成',()=>persist(s=>updateTodo(s,item.id,{completed:false,partial:true}))],[${JSON.stringify('推到明天 → ')}+${JSON.stringify(destination)},()=>{queue=queue.then(async()=>{const result=await window.postponeSource(source,item.id);source=result;mount()});return queue}]]){
 const b=menu.createEl('button',{text:label,attr:{type:'button'}});b.onclick=()=>{menu.remove();action()}
 }},
 onGroupMenu:()=>{},onSortMenu:()=>{},onMove:()=>{},
 })
}
window.sortTodos=sortBy=>persist(s=>setHeaderValue(s,'todo-view',formatTodoViewHeaderValue({...parseTimeline(s).todoView,sortBy})))
window.remount=mount
window.whenSaved=()=>queue
mount()
`
const built=await esbuild.build({stdin:{contents:entry,resolveDir:root,loader:'ts'},bundle:true,write:false,format:'iife',alias:{obsidian:path.join(out,'obsidian.ts')}})
const css=fs.readFileSync(path.join(root,'styles.css'),'utf8')
fs.writeFileSync(path.join(out,'index.html'),`<!doctype html><meta charset="utf-8"><style>
:root{--background-primary:#fff;--background-secondary:#f5f5f5;--background-modifier-border:#ccc;--background-modifier-form-field:#fff;--text-normal:#222;--text-muted:#666;--text-faint:#777;--text-accent:#555;--interactive-accent:#555;--background-modifier-hover:#eee;--text-error:#c33;--font-interface:system-ui}
body{margin:20px;font-family:system-ui} #host{position:relative;width:430px;min-height:320px} #menu{position:absolute;top:0;right:0}
${css}</style><p>隔离测试数据 · 文件写入适配器</p><main class="modular-diary-container"><div id="host" class="modular-diary-slot modular-diary-slot-todos"></div></main><script>${built.outputFiles[0].text}</script>`)
const browser=await chromium.launch({headless:true})
try {
 const page=await browser.newPage({viewport:{width:560,height:600}})
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.exposeFunction('persistSource',source=>fs.writeFileSync(sourceFile,source))
 let tomorrowContent=''
 await page.exposeFunction('postponeSource',async(source,id)=>{
   const host=createPostponeHost({sourceValue:source,id,dailyNotes});await host.run();tomorrowContent=host.readTarget()
   const updated=host.readSource().match(/^```timeline\n([\s\S]*?)\n```/)[1]
   fs.writeFileSync(sourceFile,updated);return updated
 })
 await page.goto('file://'+path.join(out,'index.html'))
 const row=id=>page.locator('[data-todo-id="'+id+'"]')
 await row('low').click({button:'right'});await page.getByRole('button',{name:'编辑',exact:true}).click()
 const form=row('low').locator('.modular-diary-todo-edit-form')
 assert.equal(await form.locator('textarea').inputValue(),'  备注\n第二行  ')
 assert.equal(await form.getByRole('combobox',{name:'难度',exact:true}).inputValue(),'1')
 assert.equal(await form.getByRole('combobox',{name:'优先级',exact:true}).inputValue(),'随时')
 await form.getByRole('textbox',{name:'待办内容'}).fill('只改标题')
 await form.getByRole('button',{name:'保存',exact:true}).click();await page.evaluate(()=>window.whenSaved())
 assert.ok(fs.readFileSync(sourceFile,'utf8').includes(authoredNote))
 await row('low').click({button:'right'});await page.getByRole('button',{name:'编辑',exact:true}).click()
 assert.equal(await row('low').locator('textarea').inputValue(),'  备注\n第二行  ')
 await page.evaluate(()=>window.remount())
 assert.equal(await row('low').locator('textarea').inputValue(),'  备注\n第二行  ')
 await row('low').locator('textarea').fill('修改后的多行\n备注')
 await row('low').getByRole('combobox',{name:'难度',exact:true}).selectOption('3')
 await row('low').getByRole('combobox',{name:'优先级',exact:true}).selectOption('马上')
 await page.screenshot({path:path.join(out,'todo-editor-light.png')})
 await row('low').getByRole('button',{name:'保存',exact:true}).click();await page.evaluate(()=>window.whenSaved())
 assert.ok(fs.readFileSync(sourceFile,'utf8').includes('note="修改后的多行\\n备注" difficulty=3 priority="马上"'))
 const order=()=>page.locator('.modular-diary-todo-row').evaluateAll(rows=>rows.map(r=>r.dataset.todoId))
 assert.deepEqual(await order(),['low','high','unset'])
 await page.evaluate(()=>window.sortTodos('difficulty'));assert.deepEqual(await order(),['high','low','unset'])
 assert.ok(fs.readFileSync(sourceFile,'utf8').includes('sort=difficulty'))
 await page.evaluate(()=>window.sortTodos('priority'));assert.deepEqual(await order(),['low','high','unset'])
 await page.evaluate(()=>window.sortTodos('manual'));assert.deepEqual(await order(),['low','high','unset'])
 await row('low').locator('.modular-diary-todo-check').click({button:'right'});await page.getByRole('button',{name:'半完成',exact:true}).click();await page.evaluate(()=>window.whenSaved())
 assert.ok(fs.readFileSync(sourceFile,'utf8').includes('- [/] todo: id="low"'))
 assert.ok(await row('low').evaluate(r=>r.classList.contains('is-partial')))
 assert.equal(await row('low').locator('.modular-diary-todo-check').getAttribute('aria-pressed'),'mixed')
 const noteLayout=await row('low').evaluate(row=>{const title=row.querySelector('.modular-diary-item-title').getBoundingClientRect(),note=row.querySelector('.modular-diary-todo-note').getBoundingClientRect();return {titleBottom:title.bottom,noteTop:note.top}})
 assert.ok(noteLayout.noteTop>=noteLayout.titleBottom,'notes must occupy a separate row beneath the title')
 await row('low').hover();await page.screenshot({path:path.join(out,'todo-partial-light.png')})
 await row('low').locator('.modular-diary-todo-check').click();await page.evaluate(()=>window.whenSaved())
 assert.ok(fs.readFileSync(sourceFile,'utf8').includes('- [x] todo: id="low"'))
 assert.equal(await row('low').evaluate(r=>r.classList.contains('is-partial')),false)
 await row('low').locator('.modular-diary-todo-check').click();await page.evaluate(()=>window.whenSaved())
 assert.ok(fs.readFileSync(sourceFile,'utf8').includes('- [ ] todo: id="low"'))
 await row('low').click({button:'right'});await page.getByRole('button',{name:'编辑',exact:true}).click()
 await row('low').getByRole('combobox',{name:'难度',exact:true}).selectOption('')
 await row('low').getByRole('combobox',{name:'优先级',exact:true}).selectOption('')
 await row('low').locator('textarea').fill('')
 await row('low').getByRole('button',{name:'保存',exact:true}).click();await page.evaluate(()=>window.whenSaved())
 const savedRow=fs.readFileSync(sourceFile,'utf8').split('\n').find(l=>l.includes('id="low"'))
 assert.doesNotMatch(savedRow,/note=|difficulty=|priority=/)
 await page.setViewportSize({width:360,height:600})
 await page.evaluate(()=>{document.querySelector('#host').style.width='320px';const s=document.documentElement.style;s.setProperty('--background-primary','#222');s.setProperty('--background-modifier-form-field','#333');s.setProperty('--text-normal','#eee');s.setProperty('--text-muted','#bbb');s.setProperty('--text-faint','#aaa');document.body.style.background='#222';document.body.style.color='#eee'})
 await page.waitForFunction(()=>Math.abs(document.querySelector('#host').getBoundingClientRect().width-320)<1)
 await row('high').press('Shift+F10');await page.getByRole('button',{name:'编辑',exact:true}).click()
 await row('high').locator('textarea').fill('窄侧栏备注，测试滚动与换行')
 const bounds=await row('high').locator('.modular-diary-todo-edit-form').evaluate(f=>({width:f.getBoundingClientRect().width,scroll:f.scrollWidth}))
 assert.ok(bounds.scroll<=bounds.width+1,JSON.stringify(bounds))
 await row('high').getByRole('button',{name:'保存',exact:true}).focus()
 await page.screenshot({path:path.join(out,'todo-editor-narrow-dark.png')})
 await row('high').locator('textarea').press('Escape')
 await row('low').click({button:'right'});await page.getByRole('button',{name:'半完成',exact:true}).click();await page.evaluate(()=>window.whenSaved())
 await row('low').click({button:'right'});assert.equal(destination,'Journal/2026/10/日记 11.md')
 await page.getByRole('button',{name:'推到明天 → '+destination,exact:true}).hover()
 await page.screenshot({path:path.join(out,'todo-daily-notes-destination.png')})
 await page.getByRole('button',{name:'推到明天 → '+destination,exact:true}).click();await page.evaluate(()=>window.whenSaved())
 assert.equal(await row('low').count(),0)
 assert.ok(!fs.readFileSync(sourceFile,'utf8').includes('id="low"'))
 assert.ok(tomorrowContent.includes('- [/] todo: id="low"'))
 assert.ok(tomorrowContent.includes('date: 2026-10-11'))
 assert.deepEqual(errors,[])
 console.log('OK Todo file-backed UI contracts; synthetic screenshots:',out)
} finally {await browser.close()}
