/** Production plugin methods with synthetic disk-backed Editor/Vault seams. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import esbuild from 'esbuild'
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),require=createRequire(import.meta.url)
const built=await esbuild.build({entryPoints:[path.join(root,'src/main.ts')],bundle:true,write:false,platform:'node',format:'cjs',external:['obsidian']})
const Base=class{},TFile=class{},MarkdownView=class{}
const obsidian=new Proxy({Plugin:Base,PluginSettingTab:Base,Modal:Base,MarkdownRenderChild:Base,TFile,MarkdownView,Notice:Base},{get:(o,k)=>o[k]??Base})
const ctx={module:{exports:{}},exports:{},require:n=>n==='obsidian'?obsidian:require(n),console,setTimeout,clearTimeout}
vm.runInNewContext(built.outputFiles[0].text,ctx)
export function createChecklistHost(initial,mode='preview'){
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'modular-diary-checklist-host-')),filename=path.join(out,'synthetic.md')
 const fence=s=>'Before the block\n```timeline\n'+s+'\n```\nAfter the block'
 fs.writeFileSync(filename,fence(initial));let memory=fs.readFileSync(filename,'utf8'),fail=false
 const read=()=>fs.readFileSync(filename,'utf8'),file=new TFile();file.path='synthetic.md'
 const source=()=>read().split('```timeline\n')[1].split('\n```')[0]
 const plugin=new ctx.module.exports.default(),host={isConnected:false,closest:()=>null,querySelector:()=>null}
 const view=new MarkdownView();view.file=file;view.leaf={};view.containerEl={contains:()=>false};view.getMode=()=>mode
 view.editor={getValue:()=>memory,getLine:n=>memory.split('\n')[n],replaceRange:(value,from,to)=>{
  const offset=p=>memory.split('\n').slice(0,p.line).reduce((n,s)=>n+s.length+1,0)+p.ch
  memory=memory.slice(0,offset(from))+value+memory.slice(offset(to))
 }}
 view.save=async()=>{if(fail)throw Error('synthetic-write-failed');fs.writeFileSync(filename,memory)}
 plugin.app={vault:{getAbstractFileByPath:()=>file,read:async()=>read(),process:async(_f,change)=>{
  if(fail)throw Error('synthetic-write-failed');memory=change(read());fs.writeFileSync(filename,memory)
 }},workspace:{iterateAllLeaves:fn=>fn({view}),getActiveViewOfType:()=>view}}
 plugin.captureScroll=()=>({internal:{},viewport:null})
 const context={sourcePath:file.path,docId:'checklist-test',getSectionInfo:()=>null}
 const commit=async(displayed,change)=>{await plugin.applyBlockTransform(host,context,displayed,change);return source()}
 const slotsContainer=items=>({querySelector:()=>({querySelectorAll:()=>items.map(it=>({dataset:{slot:it.id,x:it.x,y:it.y,w:it.w,h:it.h}}))})})
 return {filename,read,source,plugin,host,context,view,setFail:value=>{fail=value},setContent:value=>{memory=value;fs.writeFileSync(filename,value)},
  add:async(displayed,items=[],template)=>commit(displayed,s=>plugin.addChecklistComponent(s,plugin.parse(s),slotsContainer(items),template)),
  save:async(displayed,id,next)=>{await plugin.saveChecklistModule(host,context,displayed,id,()=>next);return source()},
  layout:(displayed,items)=>commit(displayed,s=>{
   const line='layout: '+items.map(i=>i.id+'@'+[i.x,i.y,i.w,i.h].join(',')).join(' ')
   return /^layout:.*$/m.test(s)?s.replace(/^layout:.*$/m,line):line+'\n'+s
  })}
}
