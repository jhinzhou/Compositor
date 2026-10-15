import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {createRequire} from 'node:module'
import {parse,compileScript} from '@vue/compiler-sfc'
import {transformSync} from 'esbuild'
import * as Vue from 'vue'
import {renderToString} from '@vue/server-renderer'
import {TOOL_GROUPS,toolGroup,displayedToolGroupEntry,toolGroupIconProps} from '../src/renderer/tool-groups'
import {editorToolIcon} from '../src/renderer/editor-tool-icons'
function component(name:string,inlineTemplate=true){
 const filename=resolve(`src/renderer/${name}.vue`),{descriptor}=parse(readFileSync(filename,'utf8'),{filename}),module={exports:{} as any},require=createRequire(filename)
 const code=transformSync(compileScript(descriptor,{id:'toolbar-alpha24-'+name,inlineTemplate}).content,{loader:'ts',format:'cjs'}).code
 new Function('module','exports','require',code)(module,module.exports,(id:string)=>id==='vue'?{...Vue,onMounted(){},onBeforeUnmount(){}}:id==='./i18n'?{useI18n:()=>({t:(text:string)=>text})}:id==='./EditorToolIcon.vue'?component('EditorToolIcon'):require(id))
 return module.exports.default
}
test('inactive rail groups retain their last tool; defaults and invalid remembered IDs resolve to a real registry entry',()=>{
 const state={tool:'move'};for(const group of TOOL_GROUPS){assert.equal(displayedToolGroupEntry(group.id,state),group.entries[0]);for(const entry of group.entries)assert.equal(displayedToolGroupEntry(group.id,state,entry),entry)}
 assert.equal(displayedToolGroupEntry('L',{tool:'lasso',lassoMode:'magnetic'},toolGroup('L').entries[0]).id,'lasso-magnetic')
 assert.equal(displayedToolGroupEntry('J',state,{id:'no-longer-exists'}).id,'spot-heal');assert.equal(displayedToolGroupEntry('I',state,{id:'patch'}).id,'eyedropper')
 assert.deepEqual(toolGroup('J').entries.map(entry=>entry.id),['spot-heal','remove','heal','patch','content-move','red-eye'])
 assert.equal(toolGroup('J').entries.filter(entry=>entry.retouchMode).length,2)
})
test('every submenu variant has distinct nonempty vector geometry and real SVG markup at compact glyph size',async()=>{
 const icon=component('EditorToolIcon'),keys=new Set<string>(),geometries=new Set<string>()
 for(const group of TOOL_GROUPS)for(const entry of group.entries){const props=toolGroupIconProps(entry),geometry=editorToolIcon(props.tool,props.variant);assert.ok(geometry,entry.id);assert.ok(geometry.strokes.length);assert.ok(geometry.strokes.every(path=>path.d.length>3));assert.equal(keys.has(geometry.key),false,entry.id);keys.add(geometry.key);const signature=JSON.stringify(geometry.strokes);assert.equal(geometries.has(signature),false,entry.id);geometries.add(signature)
  const html=await renderToString(Vue.createSSRApp(icon,{...props,size:17}));assert.match(html,/width="17" height="17"/);assert.ok(html.includes(`data-tool-icon="${geometry.key}"`));assert.match(html,/<path[^>]+d="/)
 }
 assert.equal(editorToolIcon('unknown'),undefined)
})
test('actual menu opening highlights its checked remembered entry; hover and keyboard navigation do not change checkmark',async()=>{
 const previousWindow=Object.getOwnPropertyDescriptor(globalThis,'window');Object.defineProperty(globalThis,'window',{value:{innerWidth:1280,innerHeight:800},configurable:true})
 const scope=Vue.effectScope();try{const menu=component('ToolGroupMenu',false),props=Vue.reactive({open:true,group:'J',selected:'content-move',anchor:{left:0,top:80,width:44,height:28},disabled:false}),events:unknown[][]=[]
  const setup=scope.run(()=>menu.setup(props,{expose(){},emit:(...args:unknown[])=>events.push(args)}))
  await Vue.nextTick();await Vue.nextTick();assert.equal(setup.checkedId.value,'content-move');assert.equal(setup.active.value,4)
  setup.active.value=1;assert.equal(setup.checkedId.value,'content-move');const key=(key:string)=>setup.keydown({key,stopPropagation(){},preventDefault(){}});key('ArrowDown');assert.equal(setup.active.value,2);assert.equal(setup.checkedId.value,'content-move');key('Enter');assert.deepEqual(events[0],['select',toolGroup('J').entries[2]])
  props.open=false;await Vue.nextTick();props.open=true;await Vue.nextTick();await Vue.nextTick();assert.equal(setup.active.value,4)
  props.selected=undefined as unknown as string;await Vue.nextTick();await Vue.nextTick();assert.equal(setup.checkedId.value,'spot-heal');assert.equal(setup.active.value,0)
 }finally{scope.stop();if(previousWindow)Object.defineProperty(globalThis,'window',previousWindow);else Reflect.deleteProperty(globalThis,'window')}
})
test('actual submenu renders one correct radio check and an icon for each J tool',async()=>{
 const previousWindow=Object.getOwnPropertyDescriptor(globalThis,'window');Object.defineProperty(globalThis,'window',{value:{innerWidth:1280,innerHeight:800},configurable:true})
 try{const context:{teleports?:Record<string,string>}={};await renderToString(Vue.createSSRApp(component('ToolGroupMenu'),{open:true,group:'J',selected:'red-eye',anchor:{left:0,top:80,width:44,height:28}}),context);const html=context.teleports?.body??''
  assert.equal((html.match(/role="menuitemradio"/g)??[]).length,6);assert.equal((html.match(/aria-checked="true"/g)??[]).length,1);assert.match(html,/aria-checked="true"[^>]*data-tool-entry="red-eye"/);assert.equal((html.match(/data-tool-icon="/g)??[]).length,6)
 }finally{await Vue.nextTick();if(previousWindow)Object.defineProperty(globalThis,'window',previousWindow);else Reflect.deleteProperty(globalThis,'window')}
})
