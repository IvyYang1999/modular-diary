import assert from 'node:assert/strict'
import { createChecklistHost } from './checklist-host.mjs'
const initial='# Work\n- [ ] Target\n# Notes\nKeep this prose\n'
for(const mode of ['source','preview']){
 const h=createChecklistHost('date: 2026-10-22\n---',mode);h.setContent(initial)
 let processCalls=0,editorCalls=0,saveCalls=0
 const process=h.plugin.app.vault.process,replace=h.view.editor.replaceRange,save=h.view.save
 h.plugin.app.vault.process=async(...args)=>{processCalls++;return process(...args)}
 h.view.editor.replaceRange=(...args)=>{editorCalls++;return replace(...args)}
 h.view.save=async()=>{saveCalls++;return save()}
 if(mode==='source') h.view.editor.replaceRange('Unsaved prose\n',{line:3,ch:0},{line:4,ch:0})
 editorCalls=0
 await h.plugin.applyBodyTodoEdit(h.view.file.path,s=>s.replace('- [ ] Target','- [x] Target'),h.host)
 assert.match(h.read(),/- \[x\] Target/)
 assert.equal(processCalls,mode==='preview'?1:0,'source mode must keep the editor transaction')
 assert.equal(editorCalls,mode==='source'?1:0,'reading mode must never edit its detached Editor')
 assert.equal(saveCalls,mode==='source'?1:0)
 if(mode==='source') assert.match(h.read(),/Unsaved prose/)
}
{
 const h=createChecklistHost('date: 2026-10-22\n---','preview');h.setContent(initial)
 const peer=new h.view.constructor();peer.file=h.view.file;peer.getMode=()=> 'source';peer.containerEl={contains:()=>false};peer.editor={getValue:()=>initial+'unsaved'}
 h.view.containerEl.contains=()=>true
 h.plugin.app.workspace.iterateAllLeaves=fn=>{fn({view:h.view});fn({view:peer})}
 await assert.rejects(h.plugin.applyBodyTodoEdit(h.view.file.path,s=>s.replace('Target','Changed'),h.host))
 assert.equal(h.read(),initial,'reading write with an editable peer must fail closed')
}
{
 const h=createChecklistHost('date: 2026-10-22\n---','source');h.setContent(initial)
 const peer=new h.view.constructor();Object.assign(peer,h.view);peer.containerEl={contains:()=>false}
 h.plugin.app.workspace.iterateAllLeaves=fn=>{fn({view:h.view});fn({view:peer})}
 await assert.rejects(h.plugin.applyBodyTodoEdit(h.view.file.path,s=>s.replace('Target','Changed'),h.host))
 assert.equal(h.read(),initial,'ambiguous source panes must not receive a file write')
}
console.log('PASS body Todo production writes: source transaction/draft retention, reading persistence and peer guards')
