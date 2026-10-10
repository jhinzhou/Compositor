import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {createRequire} from 'node:module'
import {parse,compileScript} from '@vue/compiler-sfc'
import {transformSync} from 'esbuild'
import * as Vue from 'vue'
function panel(initialKind='shadow'){
 const filename=resolve('src/renderer/EffectsPanel.vue'),{descriptor}=parse(readFileSync(filename,'utf8'),{filename}),source=transformSync(compileScript(descriptor,{id:'effects-parity'}).content,{loader:'ts',format:'cjs'}).code,requireLocal=createRequire(filename),module={exports:{} as any},events:{event:string;value:unknown}[]=[],props=Vue.reactive({effects:{stroke:{red:1,green:0,blue:0,opacity:1,size:4,inside:false}},initialKind,layerId:'layer'});let exposed:any
 new Function('require','module','exports',source)((specifier:string)=>specifier==='vue'?Vue:specifier.endsWith('.vue')?{}:requireLocal(specifier),module,module.exports)
 const setup=module.exports.default.setup(props,{expose:(value:unknown)=>exposed=value,emit:(event:string,value:unknown)=>events.push({event,value})})
 return {setup,events,exposed,props}
}
test('effect badge target opens the requested parameter kind while retaining other effects',async()=>{
 const instance=panel();assert.equal(instance.setup.selected.value,'shadow');assert.equal(instance.setup.effects.value.stroke.size,4);assert.equal(instance.setup.effects.value.shadow.distance,20)
 instance.props.initialKind='innerGlow';await Vue.nextTick();assert.equal(instance.setup.selected.value,'innerGlow');assert.ok(instance.setup.effects.value.shadow)
})
test('scrub and numeric parameters preview locally and explicit apply is the only commit',async()=>{
 const instance=panel();instance.setup.parameter('distance','35');await Vue.nextTick();assert.equal(instance.setup.current.value.distance,35);assert.equal(instance.events.filter(event=>event.event==='commit').length,0)
 instance.setup.parameter('distance','');assert.equal(instance.setup.current.value.distance,35)
 instance.exposed.commit();assert.equal(instance.events.filter(event=>event.event==='commit').length,1)
 instance.exposed.cancel();assert.equal(instance.events.at(-1)?.event,'cancel');assert.equal(instance.events.at(-2)?.value,null)
})
