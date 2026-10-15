import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {createRequire} from 'node:module'
import {parse,compileScript} from '@vue/compiler-sfc'
import {transformSync} from 'esbuild'
import * as Vue from 'vue'
import {emptyDocumentInfo} from '../src/shared/document-info'
// Executes the actual SFC's event handlers and reactive gates. This is component
// evidence, not browser hit-testing; the Electron smoke keeps the overlapping
// sample [20,24] / new ruler [20,20] to verify actual click-through separately.
function overlay(){
 const filename=resolve('src/renderer/InfoToolsOverlay.vue'),{descriptor}=parse(readFileSync(filename,'utf8'),{filename}),module={exports:{} as any},localRequire=createRequire(filename),events:unknown[][]=[]
 const code=transformSync(compileScript(descriptor,{id:'info-tools-overlay-gates'}).content,{loader:'ts',format:'cjs'}).code
 new Function('require','module','exports',code)((id:string)=>id==='./i18n'?{useI18n:()=>({locale:Vue.ref('en')})}:localRequire(id),module,module.exports)
 const props=Vue.reactive({info:{...emptyDocumentInfo(),samples:[{id:1,position:[20,24]}],ruler:{start:[20,20],end:[60,50]}},width:128,height:128,zoom:1,interactive:true,sampleInteractive:false as boolean|undefined,rulerInteractive:true as boolean|undefined})
 const setup=module.exports.default.setup(props,{expose(){},emit:(...args:unknown[])=>events.push(args)})
 return {props,setup,events}
}
test('actual Overlay independently gates nearby sample markers and ruler handles before emitting',()=>{
 const f=overlay(),event={pointerId:1} as PointerEvent
 assert.equal(f.setup.canSample.value,false);assert.equal(f.setup.canRuler.value,true)
 f.setup.sampleDown(event,1);f.setup.rulerDown(event,'line');assert.deepEqual(f.events,[['ruler-down',event,'line']])
 f.props.sampleInteractive=true;f.props.rulerInteractive=false;f.events.length=0;f.setup.sampleDown(event,1);f.setup.rulerDown(event,'end');assert.deepEqual(f.events,[['sample-down',event,1]])
 f.props.interactive=false;f.events.length=0;f.setup.sampleDown(event,1);f.setup.rulerDown(event,'third');assert.deepEqual(f.events,[])
})
test('omitted variant gates preserve prior interactive behavior without overriding a disabled overlay',()=>{
 const f=overlay();f.props.sampleInteractive=undefined;f.props.rulerInteractive=undefined
 assert.equal(f.setup.canSample.value,true);assert.equal(f.setup.canRuler.value,true)
 f.props.interactive=false;assert.equal(f.setup.canSample.value,false);assert.equal(f.setup.canRuler.value,false)
})
