// Optional desktop gate: a separate Obsidian profile and synthetic vault only.
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
// This optional gate intentionally uses OS focus. Never open a test window
// unless its operator has scheduled the foreground run explicitly.
if (!process.argv.includes('--allow-foreground')) {
 console.error('Native Obsidian smoke needs scheduled foreground permission; pass --allow-foreground after approval.')
 process.exit(2)
}
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const out=fs.mkdtempSync(path.join(os.tmpdir(),'modular-diary-native-recovery-'))
const profile=path.join(out,'profile'),vault=path.join(out,'vault'),plugins=path.join(vault,'.obsidian','plugins','modular-diary')
fs.mkdirSync(plugins,{recursive:true});fs.mkdirSync(profile)
fs.writeFileSync(path.join(profile,'obsidian.json'),JSON.stringify({vaults:{recovery:{path:vault,ts:Date.now(),open:true}}}))
fs.writeFileSync(path.join(vault,'.obsidian','app.json'),JSON.stringify({livePreview:true,showInlineTitle:false}))
fs.writeFileSync(path.join(vault,'.obsidian','community-plugins.json'),JSON.stringify(['modular-diary']))
fs.writeFileSync(path.join(vault,'.obsidian','core-plugins.json'),'[]')
fs.writeFileSync(path.join(plugins,'data.json'),JSON.stringify({spanTypeColors:{work:'#55b8d8'},timelineOnboardingSeen:true}));fs.writeFileSync(path.join(vault,'节律.md'),'# 节律\n\n- 每周 拍视频 @work 整天\n- 每天 30分钟 运动 @work\n')
for(const name of ['main.js','manifest.json','styles.css'])fs.copyFileSync(path.join(root,name),path.join(plugins,name))
const original='# Recovery\n\n```timeline\ndate: 2026-10-22\nrange: 7-12\n---\n08:00-09:00 work original note\n```\n\nEnd of fixture\n'
fs.writeFileSync(path.join(vault,'Recovery.md'),original)
// The packaged app disables Electron's Node inspector. Use its renderer CDP
// endpoint instead; the endpoint receipt is created only in this private profile.
const child=spawn('/Applications/Obsidian.app/Contents/MacOS/Obsidian',['--user-data-dir='+profile,'--remote-debugging-port=0','--disable-background-timer-throttling','--disable-renderer-backgrounding'],{stdio:'ignore'})
let browser, page
try{
 const deadline=Date.now()+15000
 while(!fs.existsSync(path.join(profile,'DevToolsActivePort')) && Date.now()<deadline){await new Promise(r=>setTimeout(r,100))}
 const port=Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0])
 assert.ok(Number.isInteger(port)&&port>0)
 browser=await chromium.connectOverCDP('http://127.0.0.1:'+port,{timeout:10000})
 while(!page && Date.now()<deadline){page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('app://obsidian.md'));if(!page)await new Promise(r=>setTimeout(r,100))}
 assert.ok(page,'isolated Obsidian renderer must be available')
 await page.bringToFront()
 await page.waitForFunction(()=>typeof app!=='undefined'&&!!app.vault,null,{timeout:20000})
 const actualVault=await page.evaluate(()=>app.vault.adapter.basePath)
 assert.equal(fs.realpathSync(actualVault),fs.realpathSync(vault),'Must stay in the synthetic vault')
 // Trust only this freshly created fixture, after asserting its exact path.
 // Depending on App startup timing the first-open prompt can arrive later.
 await page.waitForFunction(()=>!!app.plugins.plugins["modular-diary"] || [...document.querySelectorAll('button')].some(e=>e.textContent==='Trust author and enable plugins'),null,{timeout:15000})
 const trust=page.getByRole('button',{name:'Trust author and enable plugins',exact:true})
 if(await trust.isVisible())await trust.click()
 await page.waitForFunction(()=>!!app.plugins.plugins["modular-diary"],null,{timeout:15000})
 await page.evaluate(async()=>{const file=app.vault.getAbstractFileByPath('Recovery.md');const leaf=app.workspace.getLeaf(false);await leaf.openFile(file);leaf.view.editor?.setCursor({line:0,ch:0})})
 await page.waitForSelector('.modular-diary-container',{timeout:10000}).catch(async e=>{
   console.log(JSON.stringify(await page.evaluate(()=>({mode:app.workspace.activeLeaf?.view?.getMode?.(),hosts:document.querySelectorAll('.block-language-timeline').length,rawBlocks:document.querySelectorAll('.cm-line').length,containers:document.querySelectorAll('.modular-diary-container').length,pluginRecords:app.plugins.plugins["modular-diary"].timelineVisuals?.records?.size}))))
   await page.screenshot({path:path.join(out,'native-failure.png')})
   throw e
 })

 const logs=[];page.on('console',m=>logs.push(m.type()+': '+m.text().slice(0,400)));page.on('pageerror',e=>logs.push('pageerror: '+String(e.stack||e).slice(0,600)))
 await page.waitForSelector('.modular-diary-view-bar',{timeout:10000})
 await page.screenshot({path:path.join(out,'before.png')})
 const until=async(fn,ms=8000)=>{const t=Date.now();while(Date.now()-t<ms){if(await page.evaluate(fn))return Date.now()-t;await new Promise(r=>setTimeout(r,100))}return -1}
 const results=[]
 const check=(name,v)=>{results.push([name,v]);console.log('STEP',name,v)}
 const viewBtn=(i)=>page.locator('.modular-diary-view-bar .modular-diary-seg button, .modular-diary-period-toolbar .modular-diary-seg:not(.is-soft) button').nth(i)
 const addTodo=async(text)=>{await page.locator('.modular-diary-period-todos .modular-diary-component-actions button').last().click();await page.locator('.modular-diary-period-todos .modular-diary-todo-title-input').first().fill(text);await page.locator('.modular-diary-period-todos .modular-diary-todo-title-input').first().press('Enter')}
 await viewBtn(1).click()
 check('day→week ms', await until(()=>!!document.querySelector('.modular-diary-period.is-plan')))
 await addTodo('probe todo')
 check('todo row ms', await until(()=>document.querySelectorAll('.modular-diary-period-todos .modular-diary-todo-row').length===1))
 await page.locator('.modular-diary-seg.is-soft button').nth(1).click()
 check('plan→actual ms', await until(()=>!!document.querySelector('.modular-diary-period:not(.is-plan)')))
 await page.locator('.modular-diary-seg.is-soft button').nth(0).click()
 check('actual→plan ms', await until(()=>!!document.querySelector('.modular-diary-period.is-plan')))
 await addTodo('second todo')
 await viewBtn(0).click()
 check('week→day right after edit ms', await until(()=>!!document.querySelector('.modular-diary-view-bar')))
 await viewBtn(2).click()
 check('day→month ms', await until(()=>!!document.querySelector('.modular-diary-plan-month')))
 await new Promise(r=>setTimeout(r,600)); await page.screenshot({path:path.join(out,'month.png')})
 await addTodo('month todo')
 check('month todo row ms', await until(()=>document.querySelectorAll('.modular-diary-period-todos .modular-diary-todo-row').length===1))
 await viewBtn(1).click()
 check('month→week ms', await until(()=>!!document.querySelector('.modular-diary-plan-week')))
 await new Promise(r=>setTimeout(r,600)); await page.screenshot({path:path.join(out,'week.png')})
 await viewBtn(0).click()
 check('week→day ms', await until(()=>!!document.querySelector('.modular-diary-view-bar')))
 // Modals never attach to `document` in this isolated profile, so the rhythms panel is covered by e2e/period-embed-smoke.mjs instead.
 console.log('FAILED', results.filter(([,v])=>v<0).map(([n])=>n))
 await page.screenshot({path:path.join(out,'after.png')})
 const note=fs.readFileSync(path.join(vault,'Recovery.md'),'utf8')
 const periodDir=path.join(vault,'周期')
 console.log('NOTE', JSON.stringify(note))
 console.log('PERIOD_FILES', fs.existsSync(periodDir)?fs.readdirSync(periodDir).map(f=>f+': '+JSON.stringify(fs.readFileSync(path.join(periodDir,f),'utf8'))):'(no folder)')
 console.log('PERIOD_RENDERED', await page.locator('.modular-diary-period').count(), 'STUB', await page.locator('.modular-diary-period-stub').count())
 console.log('DOM', await page.evaluate(()=>document.querySelector('.modular-diary-container')?.className))
 for(const line of logs) console.log('LOG', line)
 console.log('OUT', out)
}finally{try{browser?.close()}catch{};child.kill()}
