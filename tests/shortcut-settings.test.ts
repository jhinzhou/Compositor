import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {resolve} from 'node:path'
import {parse,compileScript} from '@vue/compiler-sfc'
import {transformSync} from 'esbuild'
import * as Vue from 'vue'
import {profileCommands} from '../src/renderer/interaction-profile'
import {shortcutFor,type WorkspaceCommand} from '../src/renderer/command-shortcuts'

function dialog(overrides:Record<string,string>={},open=true){
 const raw:WorkspaceCommand[]=[{id:'delete',title:'删除当前目标',shortcut:'backspace'},{id:'fill-foreground',title:'以前景色填充'},{id:'export-as',title:'导出',shortcut:'Primary+Shift+e'},{id:'merge-visible',title:'合并可见图层'},{id:'text:tracking',title:'字间距',shortcut:'Alt+arrowright'}]
 const filename=resolve('src/renderer/ShortcutSettings.vue'),{descriptor}=parse(readFileSync(filename,'utf8'),{filename}),module={exports:{} as any},localRequire=createRequire(filename)
 const require=(specifier:string)=>specifier==='./i18n'?{useI18n:()=>({t:(s:string)=>s,tm:(s:string)=>s})}:localRequire(specifier)
 const code=transformSync(compileScript(descriptor,{id:'shortcut-settings-test'}).content,{loader:'ts',format:'cjs'}).code
 new Function('module','exports','require',code)(module,module.exports,require)
 const props=Vue.reactive({open,commands:profileCommands(raw,'photoshop',overrides,'mac'),defaultCommands:raw,overrides,platform:'mac',profile:'photoshop'}),emitted:{name:string;value:unknown}[]=[],scope=Vue.effectScope()
 const setup=scope.run(()=>module.exports.default.setup(props,{expose(){},emit:(name:string,value:unknown)=>emitted.push({name,value})}))
 const event=(key:string,changes:Record<string,unknown>={})=>({key,metaKey:false,ctrlKey:false,altKey:false,shiftKey:false,preventDefault(){},stopPropagation(){},...changes})
 return {setup,props,emitted,event,raw,dispose:()=>scope.stop()}
}
test('actual recorder captures bare Delete/Backspace and modified fill keys; Clear and Reset are separate',()=>{
 const d=dialog()
 try{const target=d.raw[0];for(const [key,changes,expected] of [['Backspace',{},'backspace'],['Delete',{},'delete'],['Backspace',{metaKey:true},'Primary+backspace'],['Delete',{altKey:true},'Alt+delete']] as const){d.setup.recording.value=target.id;d.setup.record(d.event(key,changes),target);assert.equal(d.setup.draft.value[target.id],expected);assert.equal(d.setup.recording.value,undefined)}
  d.setup.clear(target);assert.equal(d.setup.draft.value[target.id],'');assert.equal(shortcutFor(d.setup.effectiveCommands.value[0],d.setup.draft.value,'mac'),undefined)
  d.setup.reset(target);assert.equal(Object.hasOwn(d.setup.draft.value,target.id),false);assert.equal(shortcutFor(d.setup.effectiveCommands.value[0],d.setup.draft.value,'mac'),'backspace')
 }finally{d.dispose()}
})
test('actual draft recomputes displaced defaults and Restore Defaults restores them without changing translated titles',()=>{
 const d=dialog({'export-as':'Primary+Shift+e'})
 try{assert.equal(d.setup.effectiveCommands.value.find((c:WorkspaceCommand)=>c.id==='merge-visible').shortcut,'')
  d.setup.reset(d.raw.find(c=>c.id==='export-as'));assert.equal(d.setup.effectiveCommands.value.find((c:WorkspaceCommand)=>c.id==='merge-visible').shortcut,'Primary+Shift+e')
  assert.equal(d.setup.effectiveCommands.value.find((c:WorkspaceCommand)=>c.id==='merge-visible').title,'合并可见图层')
  d.setup.recording.value='export-as';d.setup.record(d.event('E',{metaKey:true,shiftKey:true}),d.raw.find(c=>c.id==='export-as'))
  assert.equal(d.setup.problem.value,undefined);assert.equal(d.setup.effectiveCommands.value.find((c:WorkspaceCommand)=>c.id==='merge-visible').shortcut,'')
  d.setup.restoreDefaults();assert.deepEqual(d.setup.draft.value,{});assert.equal(d.setup.effectiveCommands.value.find((c:WorkspaceCommand)=>c.id==='merge-visible').shortcut,'Primary+Shift+e')
 }finally{d.dispose()}
})
test('recording Escape cancels only recording, dead keys wait, dialog Escape closes, and conflicts cannot emit Save',()=>{
 const d=dialog()
 try{d.setup.recording.value='delete';d.setup.record(d.event('Dead',{code:'KeyE',altKey:true}),d.raw[0]);assert.equal(d.setup.recording.value,'delete')
  d.setup.record(d.event('Escape'),d.raw[0]);assert.equal(d.setup.recording.value,undefined);assert.equal(d.emitted.length,0)
  d.setup.draft.value={'text:tracking':'b'};d.setup.save();assert.equal(d.emitted.length,0);assert.match(d.setup.problem.value,/Invalid/)
  d.setup.dialogKeydown(d.event('Escape'));assert.deepEqual(d.emitted.map(e=>e.name),['close'])
  d.setup.restoreDefaults();d.setup.clear(d.raw[0]);d.setup.save();assert.deepEqual(d.emitted.map(e=>e.name),['close','save','close']);assert.deepEqual(d.emitted[1].value,{delete:''})
 }finally{d.dispose()}
})
test('reopening discards cancelled local changes and restores saved overrides',async()=>{
 const d=dialog({delete:''},false)
 try{d.props.open=true;await Vue.nextTick();assert.deepEqual(d.setup.draft.value,{delete:''});d.setup.draft.value.delete='Primary+k';d.setup.recording.value='delete';d.props.open=false;await Vue.nextTick();assert.equal(d.setup.recording.value,undefined)
  d.props.open=true;await Vue.nextTick();assert.deepEqual(d.setup.draft.value,{delete:''});assert.equal(d.emitted.length,0)
 }finally{d.dispose()}
})
