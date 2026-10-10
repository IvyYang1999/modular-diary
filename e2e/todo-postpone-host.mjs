/** Real plugin postponement/write methods against a synthetic disk-backed Vault. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import esbuild from 'esbuild'
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),require=createRequire(import.meta.url)
const built=await esbuild.build({entryPoints:[path.join(root,'src/main.ts')],bundle:true,write:false,platform:'node',format:'cjs',external:['obsidian']})
const Base=class {},TFile=class {},TFolder=class {},MarkdownView=class {}
const obsidian=new Proxy({Plugin:Base,PluginSettingTab:Base,Modal:Base,MarkdownRenderChild:Base,TFile,TFolder,MarkdownView,moment:require("moment"),Notice:class{},normalizePath:p=>p},{get:(o,k)=>o[k]??Base})
const context={module:{exports:{}},exports:{},require:n=>n==='obsidian'?obsidian:require(n),console,setTimeout,clearTimeout}
vm.runInNewContext(built.outputFiles[0].text,context)
const Plugin=context.module.exports.default
const source='date: 2026-10-10\n- [/] todo: id="a" estimate=30 category="work" group="" title="尾巴" note="保留备注" difficulty=3 priority="马上"\n---\n09:00-10:00 work 做过的部分 [todo:a]'
const fence=s=>'```timeline\n'+s+'\n```\n'
export function createPostponeHost({targetContent=null,copyFail=false,staleSource=false,unsavedTarget=false,removeFail=false,sourceValue=source,id="a",dailyNotes={folder:"daily",format:"YYYY-MM-DD"},dailyNotesEnabled=true,folderFail=false,folderCollision=false}={}){
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'modular-diary-postpone-host-')),files=new Map()
 const filePath=name=>path.join(out,name)
 const setupFolder=name=>{if(!name||name==='.')return;setupFolder(path.posix.dirname(name));if(!files.has(name)){const folder=new TFolder();folder.path=name;files.set(name,folder);fs.mkdirSync(filePath(name))}}
 const write=(name,content)=>{const file=new TFile();file.path=name;files.set(name,file);fs.writeFileSync(filePath(name),content);return file}
 const read=file=>fs.readFileSync(filePath(file.path),'utf8')
 setupFolder('daily')
 const sourceFile=write('daily/2026-10-10.md',fence(sourceValue))
 const destination=dailyNotes && typeof dailyNotes.folder==='string' && typeof dailyNotes.format==='string' ? [dailyNotes.folder,require('moment')('2026-10-11').format(dailyNotes.format)].filter(Boolean).join('/').replace(/\/+/g,'/') : '2026-10-11'
 const targetPath=destination.endsWith('.md')?destination:destination+'.md'
 if(targetContent!==null){setupFolder(path.posix.dirname(targetPath));write(targetPath,targetContent)}
 if(folderCollision){const segment=targetPath.split('/')[0];write(segment,'not a folder')}
 const view=new MarkdownView();view.file=sourceFile;view.leaf={};view.containerEl={contains:()=>false};view.getMode=()=> 'preview';view.editor={getValue:()=>read(sourceFile)}
 const targetView=new MarkdownView();targetView.file=files.get(targetPath);targetView.getMode=()=> 'source';targetView.editor={getValue:()=>unsavedTarget?'unsaved new words':read(targetView.file)}
 let copies=0,sourceWrites=0
 const plugin=new Plugin()
 plugin.app={internalPlugins:{getEnabledPluginById:name=>name==='daily-notes'&&dailyNotesEnabled?{options:dailyNotes}:undefined},vault:{getAbstractFileByPath:p=>files.get(p)??null,read:async f=>read(f),createFolder:async p=>{if(folderFail)throw Error('folder-create-failed');if(files.has(p))throw Error('already-exists');setupFolder(p)},create:async(p,content)=>{copies++;if(copyFail)throw Error('disk-copy-failed');if(files.has(p))throw Error('already-exists');if(path.posix.dirname(p)!=='.'&&!(files.get(path.posix.dirname(p)) instanceof TFolder))throw Error('missing-parent');return write(p,content)},process:async(f,fn)=>{
   if(f.path===sourceFile.path){sourceWrites++;if(removeFail)throw Error('disk-remove-failed')}
   else{copies++;if(copyFail)throw Error('disk-copy-failed')}
   const next=fn(read(f));fs.writeFileSync(filePath(f.path),next)
   if(staleSource&&f.path!==sourceFile.path)fs.writeFileSync(filePath(sourceFile.path),fence(source.replace('尾巴','新的标题')))
 }},workspace:{iterateAllLeaves:fn=>{fn({view});if(targetView.file)fn({view:targetView})},getActiveViewOfType:()=>view}}
 plugin.captureScroll=()=>({internal:{},viewport:null})
 const host={isConnected:false,closest:()=>null,querySelector:()=>null}
 const ctx={sourcePath:sourceFile.path,docId:'postpone',getSectionInfo:()=>null}
 return {plugin,targetPath,exists:p=>files.has(p),destination:()=>plugin.tomorrowTodoPath('2026-10-10'),readSource:()=>read(sourceFile),readTarget:()=>read(files.get(targetPath)),get copies(){return copies},get sourceWrites(){return sourceWrites},run:displayedTarget=>plugin.postponeTodoToTomorrow(host,ctx,sourceValue,id,'2026-10-10',displayedTarget)}
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
const fresh=createPostponeHost(),first=fresh.run(),second=fresh.run()
assert.equal(first,second,'same business key coalesces distinct invocations')
await first
assert.equal(fresh.copies,1);assert.equal(fresh.sourceWrites,1)
assert.ok(!fresh.readSource().includes('- [/] todo:'))
assert.ok(fresh.readSource().includes('做过的部分 [todo:a]'))
for(const field of ['- [/] todo:','note="保留备注"','difficulty=3','priority="马上"'])assert.ok(fresh.readTarget().includes(field))
const existing=createPostponeHost({targetContent:'# Existing\n\n```timeline\ndate: 2026-10-11\n---\n10:00-11:00 work Existing\n```\nKeep prose\n'})
await existing.run();assert.ok(existing.readTarget().includes('Keep prose'));assert.ok(existing.readTarget().includes('10:00-11:00 work Existing'))
for(const options of [{copyFail:true},{copyFail:true,targetContent:'# Tomorrow'},{unsavedTarget:true,targetContent:'# Saved'},{removeFail:true}]){
 const f=createPostponeHost(options);await assert.rejects(f.run());assert.equal(f.readSource(),fence(source),'a failed copy/removal cannot lose the persisted source')
}
const stale=createPostponeHost({staleSource:true,targetContent:'# Tomorrow'})
await assert.rejects(stale.run());assert.ok(stale.readSource().includes('新的标题'));assert.ok(stale.readTarget().includes('title="尾巴"'))
// A copy that survived a failed original write must not be duplicated on an explicit retry.
const retry=createPostponeHost({targetContent:fresh.readTarget()});await retry.run()
assert.equal((retry.readTarget().match(/id="a"/g)||[]).length,1)
// The configured directory and naming are deliberately different from the original note.
const configured=createPostponeHost({dailyNotes:{folder:'Journal',format:'YYYY/MM/[日记] DD'}})
assert.equal(configured.destination(),'Journal/2026/10/日记 11.md')
assert.equal(configured.exists(configured.targetPath),false)
await configured.run()
assert.equal(configured.exists('daily/2026-10-11.md'),false,'must not use the source directory')
assert.ok(configured.readTarget().includes('- [/] todo:'));assert.ok(!configured.readSource().includes('- [/] todo:'))
const configuredExisting=createPostponeHost({dailyNotes:{folder:'Journal',format:'YYYY/MM/[日记] DD'},targetContent:'# Existing custom daily note'})
await configuredExisting.run();assert.ok(configuredExisting.readTarget().startsWith('# Existing custom daily note'))
const changedSettings=createPostponeHost({dailyNotes:{folder:'Journal',format:'YYYY-MM-DD'}})
await assert.rejects(changedSettings.run('previous-folder/2026-10-11.md'));assert.equal(changedSettings.copies,0);assert.equal(changedSettings.readSource(),fence(source))
const rootDefault=createPostponeHost({dailyNotes:{}});await rootDefault.run();assert.equal(rootDefault.destination(),'2026-10-11.md')
for(const options of [
 {dailyNotesEnabled:false},{dailyNotes:null},{dailyNotes:{folder:'../outside',format:'YYYY-MM-DD'}},
 {dailyNotes:{folder:'Journal',format:'YYYY/MM/DD'},folderFail:true},
 {dailyNotes:{folder:'Journal',format:'YYYY/MM/DD'},folderCollision:true},
 {dailyNotes:{folder:'daily',format:'[2026-10-10]'}}
]){
 const host=createPostponeHost(options);await assert.rejects(host.run());assert.equal(host.readSource(),fence(source));assert.equal(host.copies,0)
}
console.log('PASS production Todo postpone host: durable disk copy, source/reading writes, coalescing, retries, conflict/unsaved guards')

}
