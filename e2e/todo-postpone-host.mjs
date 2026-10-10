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
const Base=class {},TFile=class {},MarkdownView=class {}
const obsidian=new Proxy({Plugin:Base,PluginSettingTab:Base,Modal:Base,MarkdownRenderChild:Base,TFile,MarkdownView,Notice:class{},normalizePath:p=>p},{get:(o,k)=>o[k]??Base})
const context={module:{exports:{}},exports:{},require:n=>n==='obsidian'?obsidian:require(n),console,setTimeout,clearTimeout}
vm.runInNewContext(built.outputFiles[0].text,context)
const Plugin=context.module.exports.default
const source='date: 2026-10-10\n- [/] todo: id="a" estimate=30 category="work" group="" title="尾巴" note="保留备注" difficulty=3 priority="马上"\n---\n09:00-10:00 work 做过的部分 [todo:a]'
const fence=s=>'```timeline\n'+s+'\n```\n'
export function createPostponeHost({targetContent=null,copyFail=false,staleSource=false,unsavedTarget=false,removeFail=false,sourceValue=source,id="a"}={}){
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'modular-diary-postpone-host-')),files=new Map()
 const write=(name,content)=>{const file=new TFile();file.path=name;files.set(name,file);fs.writeFileSync(path.join(out,path.basename(name)),content);return file}
 const read=file=>fs.readFileSync(path.join(out,path.basename(file.path)),'utf8')
 const sourceFile=write('daily/2026-10-10.md',fence(sourceValue))
 if(targetContent!==null)write('daily/2026-10-11.md',targetContent)
 const view=new MarkdownView();view.file=sourceFile;view.leaf={};view.containerEl={contains:()=>false};view.getMode=()=> 'preview';view.editor={getValue:()=>read(sourceFile)}
 const targetView=new MarkdownView();targetView.file=files.get('daily/2026-10-11.md');targetView.getMode=()=> 'source';targetView.editor={getValue:()=>unsavedTarget?'unsaved new words':read(targetView.file)}
 let copies=0,sourceWrites=0
 const plugin=new Plugin()
 plugin.app={vault:{getAbstractFileByPath:p=>files.get(p)??null,read:async f=>read(f),create:async(p,content)=>{copies++;if(copyFail)throw Error('disk-copy-failed');return write(p,content)},process:async(f,fn)=>{
   if(f.path===sourceFile.path){sourceWrites++;if(removeFail)throw Error('disk-remove-failed')}
   else{copies++;if(copyFail)throw Error('disk-copy-failed')}
   const next=fn(read(f));fs.writeFileSync(path.join(out,path.basename(f.path)),next)
   if(staleSource&&f.path!==sourceFile.path)fs.writeFileSync(path.join(out,path.basename(sourceFile.path)),fence(source.replace('尾巴','新的标题')))
 }},workspace:{iterateAllLeaves:fn=>{fn({view});if(targetView.file)fn({view:targetView})},getActiveViewOfType:()=>view}}
 plugin.captureScroll=()=>({internal:{},viewport:null})
 const host={isConnected:false,closest:()=>null,querySelector:()=>null}
 const ctx={sourcePath:sourceFile.path,docId:'postpone',getSectionInfo:()=>null}
 return {plugin,readSource:()=>read(sourceFile),readTarget:()=>read(files.get('daily/2026-10-11.md')),get copies(){return copies},get sourceWrites(){return sourceWrites},run:()=>plugin.postponeTodoToTomorrow(host,ctx,sourceValue,id,'2026-10-10')}
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
console.log('PASS production Todo postpone host: durable disk copy, source/reading writes, coalescing, retries, conflict/unsaved guards')

}
