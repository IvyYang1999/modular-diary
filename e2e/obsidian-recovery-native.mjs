// Optional desktop gate: a separate Obsidian profile and synthetic vault only.
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const out=fs.mkdtempSync(path.join(os.tmpdir(),'modular-diary-native-recovery-'))
const profile=path.join(out,'profile'),vault=path.join(out,'vault'),plugins=path.join(vault,'.obsidian','plugins','modular-diary')
fs.mkdirSync(plugins,{recursive:true});fs.mkdirSync(profile)
fs.writeFileSync(path.join(profile,'obsidian.json'),JSON.stringify({vaults:{recovery:{path:vault,ts:Date.now(),open:true}}}))
fs.writeFileSync(path.join(vault,'.obsidian','app.json'),JSON.stringify({livePreview:true,showInlineTitle:false}))
fs.writeFileSync(path.join(vault,'.obsidian','community-plugins.json'),JSON.stringify(['modular-diary']))
fs.writeFileSync(path.join(vault,'.obsidian','core-plugins.json'),'[]')
fs.writeFileSync(path.join(plugins,'data.json'),JSON.stringify({spanTypeColors:{work:'#55b8d8'},timelineOnboardingSeen:true}))
for(const name of ['main.js','manifest.json','styles.css'])fs.copyFileSync(path.join(root,name),path.join(plugins,name))
const original='# Recovery\n\n```timeline\ndate: 2026-09-17\nrange: 7-12\n---\n08:00-09:00 work original note\n===\nOriginal diary text\n```\n\nEnd of fixture\n'
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
 await page.screenshot({path:path.join(out,'native-ready.png')})
 await page.locator('rect.modular-diary-block').dblclick()
 const note=page.locator('.modular-diary-note-popover input')
 await note.fill('Native saved note')
 await page.evaluate(()=>app.plugins.plugins["modular-diary"].rerenderMountedTimelines())
 assert.equal(await note.inputValue(),'Native saved note','Background refresh must preserve the body-mounted note editor')
 await note.press('Enter')
 await note.waitFor({state:'detached',timeout:10000})
 await page.waitForFunction(async()=> (await app.vault.read(app.vault.getAbstractFileByPath('Recovery.md'))).includes('Native saved note'))
 await page.locator('.modular-diary-text-host').click()
 const text=page.locator('textarea.modular-diary-text-inline')
 await text.fill('Native saved diary')
 await text.press('Control+Enter')
 await page.locator('.workspace-leaf.mod-active .view-header-title').click()
 await page.waitForFunction(async()=> (await app.vault.read(app.vault.getAbstractFileByPath('Recovery.md'))).includes('Native saved diary'))
 // Vault.read can observe its cache before the adapter finishes the file write.
 // Wait at the actual disk boundary before exercising a normal App reload.
 const diskDeadline=Date.now()+5000
 let durable=''
 while(Date.now()<diskDeadline){
   durable=fs.readFileSync(path.join(vault,'Recovery.md'),'utf8')
   if(durable.includes('Native saved note')&&durable.includes('Native saved diary'))break
   await new Promise(r=>setTimeout(r,50))
 }
 assert.ok(durable.includes('Native saved note')&&durable.includes('Native saved diary'),'Both edits must reach the real vault file: '+JSON.stringify(durable))
 await page.reload()
 await page.waitForFunction(()=>typeof app!=='undefined'&&!!app.plugins.plugins["modular-diary"],null,{timeout:15000})
 await page.evaluate(async()=>{const file=app.vault.getAbstractFileByPath('Recovery.md');const leaf=app.workspace.getLeaf(false);await leaf.openFile(file);leaf.view.editor?.setCursor({line:0,ch:0})})
 await page.waitForSelector('.modular-diary-container',{timeout:15000})
 assert.ok(await page.locator('.modular-diary-text-host').textContent().then(s=>s.includes('Native saved diary')))
 assert.ok(await page.locator('.modular-diary-note').textContent().then(s=>s.includes('Native saved note')))
 assert.equal(await page.evaluate(()=>app.plugins.enabledPlugins.has('modular-diary')),true)
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(vault,'.obsidian','community-plugins.json'),'utf8')),['modular-diary'])
 await page.screenshot({path:path.join(out,'native-persisted.png')})
 console.log(JSON.stringify({nativeAppReady:true,isolatedProfile:true,isolatedVault:true,pluginLoaded:true,noteRefreshPreserved:true,noteAndTextDurable:true,reloadPassed:true,output:out}))
}catch(error){
 if(page){
   await page.screenshot({path:path.join(out,'native-failure.png')})
   console.log(JSON.stringify({output:out,host:await page.evaluate(()=>({ready:!!globalThis.app?.vault,enabled:globalThis.app?.plugins?.enabledPlugins?.has('modular-diary'),loaded:!!globalThis.app?.plugins?.plugins?.['modular-diary'],notices:[...document.querySelectorAll('.notice')].map(e=>e.textContent)}))}))
 }
 throw error
}finally{await browser?.close();child.kill("SIGTERM")}
