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
 onEdit:(id,i)=>persist(s=>updateTodo(s,id,{title:i.title,type:i.type,estimateMin:i.estimateMinutes,note:i.note,difficulty:i.difficulty,priority:i.priority,attach:i.attach})),
 attachments:{imageSrc:t=>t.endsWith('.png')?'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%2210%22%3E%3Crect width=%2210%22 height=%2210%22 fill=%22teal%22/%3E%3C/svg%3E':null,open:a=>(window.opened=window.opened||[]).push(a.target),saveImage:async()=>'[[附件/pasted.png]]'},
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
window.loadSource=value=>persist(()=>value)
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
 // A textarea normalizes CR/CRLF to LF. Editing only a title must not
 // silently rewrite an untouched note, including after draft remount.
 for(const rawNote of ['note="第一行\\r\\n第二行"','note="第一行\\r第二行"']){
   const value='date: 2026-10-10\n- [ ] todo: id="newline" estimate=0 category="" group="" title="原标题" '+rawNote+'\n---'
   await page.evaluate(value=>window.loadSource(value),value)
   await row('newline').click({button:'right'});await page.getByRole('button',{name:'编辑',exact:true}).click()
   assert.equal(await row('newline').locator('textarea').inputValue(),'第一行\n第二行')
   await row('newline').getByRole('textbox',{name:'待办内容'}).fill('只改标题')
   await page.evaluate(()=>window.remount())
   await row('newline').getByRole('button',{name:'保存',exact:true}).click();await page.evaluate(()=>window.whenSaved())
   const saved=fs.readFileSync(sourceFile,'utf8')
   assert.ok(saved.includes('title="只改标题"'),'save must actually change the title')
   assert.ok(saved.includes(rawNote),'untouched CR/CRLF note token must remain exact through the form and remount')
   await row('newline').click({button:'right'});await page.getByRole('button',{name:'编辑',exact:true}).click()
   assert.equal(await row('newline').locator('textarea').inputValue(),'第一行\n第二行')
   await row('newline').locator('textarea').fill('明确修改\n备注')
   await row('newline').getByRole('button',{name:'保存',exact:true}).click();await page.evaluate(()=>window.whenSaved())
   assert.ok(fs.readFileSync(sourceFile,'utf8').includes('note="明确修改\\n备注"'),'intentional note edits must still save')
 }
 await page.evaluate(value=>window.loadSource(value),initial)
 await row('low').click({button:'right'});await page.getByRole('button',{name:'编辑',exact:true}).click()
 const form=row('low').locator('.modular-diary-todo-edit-form')
 assert.equal(await form.locator('textarea').inputValue(),'  备注\n第二行  ')
 assert.equal(await form.getByRole('button',{name:'1 星',exact:true}).getAttribute('aria-pressed'),'true')
 assert.equal(await form.locator('select.modular-diary-todo-difficulty,select.modular-diary-todo-priority').count(),0)
 assert.equal(await form.locator('.modular-diary-todo-star').count(),5)
 const starBounds=await form.locator('.modular-diary-todo-star').evaluateAll(buttons=>buttons.map(b=>{const r=b.getBoundingClientRect();return {top:r.top,width:r.width,height:r.height}}))
 assert.ok(starBounds.every(b=>b.top===starBounds[0].top && b.width>=24 && b.height>=24),'five stars must remain on one row with usable hit targets')
 assert.equal(await form.getByRole('button',{name:'随时',exact:true}).getAttribute('aria-pressed'),'true')
 await form.getByRole('textbox',{name:'待办内容'}).fill('只改标题')
 await form.getByRole('button',{name:'保存',exact:true}).click();await page.evaluate(()=>window.whenSaved())
 assert.ok(fs.readFileSync(sourceFile,'utf8').includes(authoredNote))
 await row('low').click({button:'right'});await page.getByRole('button',{name:'编辑',exact:true}).click()
 assert.equal(await row('low').locator('textarea').inputValue(),'  备注\n第二行  ')
 await page.evaluate(()=>window.remount())
 assert.equal(await row('low').locator('textarea').inputValue(),'  备注\n第二行  ')
 await row('low').locator('textarea').fill('修改后的多行\n备注')
 await row('low').getByRole('button',{name:'3 星',exact:true}).click()
 await row('low').getByRole('button',{name:'马上',exact:true}).click()
 await row('low').getByRole('button',{name:'5 星',exact:true}).hover()
 assert.equal(await row('low').locator('.modular-diary-todo-star.is-filled').count(),5)
 assert.equal(await row('low').getByRole('button',{name:'3 星',exact:true}).getAttribute('aria-pressed'),'true')
 await row('low').locator('textarea').hover()
 assert.equal(await row('low').locator('.modular-diary-todo-star.is-filled').count(),3)
 await page.screenshot({path:path.join(out,'todo-editor-light.png')})
 await row('low').getByRole('button',{name:'保存',exact:true}).click();await page.evaluate(()=>window.whenSaved())
 assert.ok(fs.readFileSync(sourceFile,'utf8').includes('note="修改后的多行\\n备注" difficulty=3 priority="马上"'))
 // Row meta leads with a priority badge and difficulty stars, ahead of the numbers.
 const lowMeta=row('low').locator('.modular-diary-item-meta')
 assert.equal(await lowMeta.locator('.modular-diary-todo-priority-badge').textContent(),'马上')
 assert.equal(await lowMeta.getByRole('img',{name:'难度 3',exact:true}).textContent(),'★★★')
 assert.doesNotMatch(await lowMeta.locator('.modular-diary-item-meta-numbers').textContent(),/难度|马上/)
 assert.equal(await row('unset').locator('.modular-diary-todo-priority-badge,.modular-diary-todo-difficulty-stars').count(),0)
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
 // Pressing the selected star / priority again clears it; there is no separate clear control.
 assert.equal(await row('low').locator('.modular-diary-todo-rank-clear').count(),0)
 await row('low').getByRole('button',{name:'3 星',exact:true}).click()
 assert.equal(await row('low').getByRole('button',{name:'3 星',exact:true}).getAttribute('aria-pressed'),'false')
 await row('low').locator('textarea').hover()
 assert.equal(await row('low').locator('.modular-diary-todo-star.is-filled').count(),0)
 await row('low').getByRole('button',{name:'马上',exact:true}).click()
 assert.equal(await row('low').getByRole('button',{name:'马上',exact:true}).getAttribute('aria-pressed'),'false')
 await row('low').locator('textarea').fill('')
 await row('low').getByRole('button',{name:'保存',exact:true}).click();await page.evaluate(()=>window.whenSaved())
 const savedRow=fs.readFileSync(sourceFile,'utf8').split('\n').find(l=>l.includes('id="low"'))
 assert.doesNotMatch(savedRow,/note=|difficulty=|priority=/)
 await page.setViewportSize({width:360,height:600})
 await page.evaluate(()=>{document.querySelector('#host').style.width='320px';const s=document.documentElement.style;s.setProperty('--background-primary','#222');s.setProperty('--background-modifier-form-field','#333');s.setProperty('--text-normal','#eee');s.setProperty('--text-muted','#bbb');s.setProperty('--text-faint','#aaa');s.setProperty('--interactive-accent','#b6a0ff');s.setProperty('--background-modifier-hover','#383838');s.setProperty('--background-secondary','#2b2b2b');s.setProperty('--background-modifier-border','#666');document.body.style.background='#222';document.body.style.color='#eee'})
 await page.waitForFunction(()=>Math.abs(document.querySelector('#host').getBoundingClientRect().width-320)<1)
 await row('high').press('Shift+F10');await page.getByRole('button',{name:'编辑',exact:true}).click()
 await row('high').locator('textarea').fill('窄侧栏备注，测试滚动与换行')
 const bounds=await row('high').locator('.modular-diary-todo-edit-form').evaluate(f=>({width:f.getBoundingClientRect().width,scroll:f.scrollWidth}))
 assert.ok(bounds.scroll<=bounds.width+1,JSON.stringify(bounds))
 // Keyboard activation must change the selection, survive remount and save.
 assert.equal(await row('high').getByRole('button',{name:'P0',exact:true}).getAttribute('aria-pressed'),'false')
 await row('high').getByRole('button',{name:'4 星',exact:true}).focus()
 await row('high').getByRole('button',{name:'4 星',exact:true}).press('Space')
 await row('high').getByRole('button',{name:'P0',exact:true}).focus()
 await row('high').getByRole('button',{name:'P0',exact:true}).press('Enter')
 assert.equal(await row('high').getByRole('button',{name:'4 星',exact:true}).getAttribute('aria-pressed'),'true')
 assert.equal(await row('high').getByRole('button',{name:'P0',exact:true}).getAttribute('aria-pressed'),'true')
 await page.evaluate(()=>window.remount())
 assert.equal(await row('high').getByRole('button',{name:'P0',exact:true}).getAttribute('aria-pressed'),'true')
 await row('high').getByRole('button',{name:'P0',exact:true}).focus()
 await page.screenshot({path:path.join(out,'todo-editor-narrow-dark.png')})
 await row('high').getByRole('button',{name:'保存',exact:true}).click();await page.evaluate(()=>window.whenSaved())
 assert.ok(fs.readFileSync(sourceFile,'utf8').includes('difficulty=4 priority="P0"'))
 await row('high').click({button:'right'});await page.getByRole('button',{name:'编辑',exact:true}).click()
 assert.equal(await row('high').getByRole('button',{name:'4 星',exact:true}).getAttribute('aria-pressed'),'true')
 assert.equal(await row('high').getByRole('button',{name:'P0',exact:true}).getAttribute('aria-pressed'),'true')
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
 // New Todos use the same picker and persist explicit values from an unset start.
 await page.getByRole('button',{name:'添加待办',exact:true}).click()
 const addForm=page.locator('.modular-diary-todo-add-form')
 assert.equal(await addForm.locator('.modular-diary-todo-rank-row [aria-pressed="true"]').count(),0,'a new task starts with no difficulty or priority')
 await addForm.getByRole('textbox',{name:'待办内容',exact:true}).fill('新建点选测试')
 await addForm.getByRole('button',{name:'2 星',exact:true}).click()
 await addForm.getByRole('button',{name:'P0',exact:true}).click()
 await addForm.getByRole('button',{name:'保存',exact:true}).click();await page.evaluate(()=>window.whenSaved())
 const addedRow=fs.readFileSync(sourceFile,'utf8').split('\n').find(line=>line.includes('id="new"'))
 for(const field of ['title="新建点选测试"','difficulty=2','priority="P0"'])assert.ok(addedRow.includes(field),'new task must persist '+field)
 // Attachments: paste a link and an image into the edit form; they save as one attach field and show as a compact strip.
 await row('new').click({button:'right'});await page.getByRole('button',{name:'编辑',exact:true}).click()
 const attachInput=row('new').getByRole('textbox',{name:'附件和链接',exact:true})
 await attachInput.fill('https://example.com/spec');await attachInput.press('Enter')
 await attachInput.evaluate(el=>{const data=new DataTransfer();data.items.add(new File([new Uint8Array([137,80,78,71])],'image.png',{type:'image/png'}));el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))})
 await row('new').locator('.modular-diary-todo-attach-chip.is-image').waitFor()
 assert.equal(await row('new').locator('.modular-diary-todo-attach-chip').count(),2)
 await row('new').getByRole('button',{name:'保存',exact:true}).click();await page.evaluate(()=>window.whenSaved())
 const attachedRow=fs.readFileSync(sourceFile,'utf8').split('\n').find(line=>line.includes('id="new"'))
 assert.ok(attachedRow.includes('attach="https://example.com/spec\\n[[附件/pasted.png]]"'),attachedRow)
 assert.equal(await row('new').locator('.modular-diary-todo-attachment').count(),2)
 assert.equal(await row('new').locator('.modular-diary-todo-attachment img').count(),1,'a vault image shows as a thumbnail')
 const rowHeight=await row('new').evaluate(r=>r.getBoundingClientRect().height)
 assert.ok(rowHeight<60,'attachments must not make the row tall: '+rowHeight)
 await row('new').getByRole('button',{name:'example.com/spec',exact:true}).click()
 assert.deepEqual(await page.evaluate(()=>window.opened),['https://example.com/spec'])
 await page.screenshot({path:path.join(out,'todo-attachments-light.png')})
 // Exercise both branches together through the renderer and durable file adapter.
 const combined='date: 2026-10-10\n'
   +'- [/] todo: id="low" estimate=30 category="work" group="" title="#alpha First" note="Retained note" difficulty=2 priority="P2"\n'
   +'- [ ] todo: id="high" estimate=30 category="work" group="" title="#alpha Second" difficulty=5 priority="P0"\n'
   +'- [ ] todo: id="beta" estimate=20 category="work" group="" title="#beta Third"\ntodo-view: group=category sort=manual group2=tag\n---'
 await page.evaluate(value=>window.loadSource(value),combined)
 assert.equal(await page.locator('.modular-diary-todo-group-section.is-sub').count(),2)
 assert.equal(await page.locator('.modular-diary-item-title .modular-diary-tag').count(),3)
 assert.deepEqual(await order(),['low','high','beta'])
 await page.evaluate(()=>window.sortTodos('difficulty'))
 assert.deepEqual(await order(),['high','low','beta'],'ranked sorting must work inside tag groups')
 assert.ok(fs.readFileSync(sourceFile,'utf8').includes('group2=tag'),'sorting must retain the secondary grouping rule')
 await row('low').click({button:'right'});await page.getByRole('button',{name:'编辑',exact:true}).click()
 assert.equal(await row('low').locator('textarea').inputValue(),'Retained note')
 assert.equal(await row('low').getByRole('button',{name:'P2',exact:true}).getAttribute('aria-pressed'),'true')
 await row('low').getByRole('textbox',{name:'待办内容'}).fill('#alpha Renamed')
 await row('low').getByRole('button',{name:'保存',exact:true}).click();await page.evaluate(()=>window.whenSaved())
 const combinedSaved=fs.readFileSync(sourceFile,'utf8')
 assert.ok(combinedSaved.includes('title="#alpha Renamed"'),'save must change the title')
 for(const field of ['note="Retained note"','difficulty=2','priority="P2"'])assert.ok(combinedSaved.includes(field),'editing a grouped row must retain '+field)
 assert.ok(combinedSaved.includes('- [/] todo: id="low"'))
 assert.equal(await row('low').locator('.modular-diary-tag').textContent(),'#alpha')
 await row('low').hover();await page.screenshot({path:path.join(out,'combined-groups-narrow-dark.png')})
 await page.setViewportSize({width:650,height:600})
 await page.evaluate(()=>{document.querySelector('#host').style.width='500px';const s=document.documentElement.style;s.setProperty('--background-primary','#fff');s.setProperty('--background-modifier-form-field','#fff');s.setProperty('--text-normal','#222');s.setProperty('--text-muted','#666');s.setProperty('--text-faint','#777');s.setProperty('--interactive-accent','#555');s.setProperty('--background-modifier-hover','#eee');s.setProperty('--background-secondary','#f5f5f5');s.setProperty('--background-modifier-border','#ccc');document.body.style.background='#fff';document.body.style.color='#222'})
 await page.screenshot({path:path.join(out,'combined-groups-light.png')})
 assert.deepEqual(errors,[])
 console.log('OK Todo file-backed UI contracts; synthetic screenshots:',out)
} finally {await browser.close()}
