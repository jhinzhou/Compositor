import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {resolve} from 'node:path'
import {parse,compileScript,compileTemplate} from '@vue/compiler-sfc'
import {transformSync} from 'esbuild'
import * as Vue from 'vue'
import ts from 'typescript'
import {TOOL_GROUPS,toolGroup,toolGroupForTool,selectedToolGroupEntry,toolGroupMenuPosition,type ToolGroupId} from '../src/renderer/tool-groups'

test('registry contains all implemented alpha24 variants and no placeholders for the remaining missing tools',()=>{
 assert.deepEqual(TOOL_GROUPS.map(g=>[g.id,g.entries.length]),[['M',4],['L',4],['W',3],['C',3],['J',6],['K',1],['P',1],['A',2],['O',3],['Y',2],['B',3],['G',2],['E',3],['I',3]])
 const entries=TOOL_GROUPS.flatMap(g=>g.entries)
 assert.equal(new Set(entries.map(e=>e.id)).size,entries.length)
 assert.deepEqual(toolGroup('J').entries.map(e=>e.retouchMode),['spot-heal',undefined,'heal',undefined,undefined,undefined])
 assert.deepEqual(toolGroup('L').entries.map(e=>e.tool),['selection-brush','lasso','lasso','lasso'])
 assert.deepEqual(toolGroup('W').entries.map(e=>e.tool),['object','quick-selection','magic'])
 assert.deepEqual(toolGroup('I').entries.map(e=>e.tool),['eyedropper','color-sampler','ruler'])
 assert.equal(toolGroup('J').entries[3].tool,'patch')
 assert.equal(entries.some(e=>/slice|note|count|blur/.test(e.id)),false)
 assert.equal(toolGroupForTool('selection-brush')?.id,'L')
 assert.equal(toolGroupForTool('smear'),undefined)
 assert.ok(Object.isFrozen(TOOL_GROUPS)&&Object.isFrozen(entries[0]))
})
test('current modes resolve precisely, and legacy blur is not misleadingly marked as healing',()=>{
 assert.equal(selectedToolGroupEntry('M',{tool:'marquee'})?.id,'rectangle')
 assert.equal(selectedToolGroupEntry('M',{tool:'marquee',ellipseSelection:true})?.id,'ellipse')
 assert.equal(selectedToolGroupEntry('L',{tool:'lasso',lassoMode:'polygon'})?.id,'lasso-polygon')
 assert.equal(selectedToolGroupEntry('C',{tool:'crop',cropMode:'perspective'})?.id,'perspective-crop')
 assert.equal(selectedToolGroupEntry('J',{tool:'heal',retouchMode:'blur'}),undefined)
 assert.equal(selectedToolGroupEntry('W',{tool:'object'})?.id,'object')
 assert.equal(selectedToolGroupEntry('I',{tool:'eyedropper'})?.id,'eyedropper')
 assert.equal(selectedToolGroupEntry('C',{tool:'text'}),undefined)
 assert.equal(selectedToolGroupEntry('L',{tool:'lasso',lassoMode:'magnetic'})?.id,'lasso-magnetic')
 assert.equal(selectedToolGroupEntry('W',{tool:'quick-selection'})?.id,'quick')
 assert.equal(selectedToolGroupEntry('J',{tool:'patch'})?.id,'patch')
 assert.equal(selectedToolGroupEntry('I',{tool:'color-sampler'})?.id,'color-sampler')
 assert.equal(selectedToolGroupEntry('I',{tool:'ruler'})?.id,'ruler')
})
test('popover is beside the left toolbar, clamps at viewport edges and accepts malformed geometry safely',()=>{
 assert.deepEqual(toolGroupMenuPosition({left:8,top:180,width:36,height:36},{width:240,height:114},{width:900,height:600}),{left:50,top:180})
 assert.deepEqual(toolGroupMenuPosition({left:8,top:590,width:36,height:36},{width:240,height:114},{width:900,height:600}),{left:50,top:480})
 assert.deepEqual(toolGroupMenuPosition({left:500,top:-30,width:36,height:36},{width:240,height:114},{width:250,height:140}),{left:6,top:6})
 assert.deepEqual(toolGroupMenuPosition({left:NaN,top:Infinity,width:NaN,height:1},{width:240,height:114},{width:0,height:0}),{left:6,top:6})
})

function menu(group:ToolGroupId='C',selected='straighten'){
 const filename=resolve('src/renderer/ToolGroupMenu.vue'),{descriptor}=parse(readFileSync(filename,'utf8'),{filename}),module={exports:{} as any},localRequire=createRequire(filename)
 const mounted:(()=>void)[]=[],unmounted:(()=>void)[]=[],listeners=new Map<string,(event?:any)=>void>(),focused:number[]=[],emitted:{name:string;value:unknown}[]=[]
 const oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),oldDocument=Object.getOwnPropertyDescriptor(globalThis,'document')
 const surface=(prefix:string)=>({addEventListener:(name:string,fn:(event:any)=>void)=>listeners.set(`${prefix}:${name}`,fn),removeEventListener:(name:string,fn:(event:any)=>void)=>{if(listeners.get(`${prefix}:${name}`)===fn)listeners.delete(`${prefix}:${name}`)}})
 Object.defineProperty(globalThis,'window',{configurable:true,value:{innerWidth:900,innerHeight:600,...surface('window')}})
 Object.defineProperty(globalThis,'document',{configurable:true,value:surface('document')})
 const require=(specifier:string)=>specifier==='vue'?{...Vue,onMounted:(fn:()=>void)=>mounted.push(fn),onBeforeUnmount:(fn:()=>void)=>unmounted.push(fn)}:specifier.endsWith('.vue')?{}:specifier==='./i18n'?{useI18n:()=>({t:(s:string)=>s})}:localRequire(specifier)
 const code=transformSync(compileScript(descriptor,{id:'tool-group-menu-test'}).content,{loader:'ts',format:'cjs'}).code
 new Function('module','exports','require',code)(module,module.exports,require)
 const props=Vue.reactive({open:true,group,selected,anchor:{left:8,top:180,width:36,height:36},disabled:false}),scope=Vue.effectScope()
 const setup=scope.run(()=>module.exports.default.setup(props,{expose(){},emit:(name:string,value:unknown)=>emitted.push({name,value})}))
 const inside={},root={offsetWidth:240,offsetHeight:114,contains:(target:unknown)=>target===inside,querySelector:(query:string)=>({focus:()=>focused.push(Number(query.match(/\d+/)?.[0]))})}
 setup.root.value=root
 mounted.forEach(fn=>fn())
 const key=(value:string)=>{const event={key:value,prevented:false,stopped:false,preventDefault(){this.prevented=true},stopPropagation(){this.stopped=true}};setup.keydown(event);return event}
 return {props,setup,focused,emitted,listeners,inside,key,descriptor,dispose(){unmounted.forEach(fn=>fn());scope.stop();for(const [name,prior] of [['window',oldWindow],['document',oldDocument]] as const){if(prior)Object.defineProperty(globalThis,name,prior);else Reflect.deleteProperty(globalThis,name)}}}
}
test('actual menu handlers focus selected item, wrap Up/Down, implement Home/End and emit a variant without mutating controlled state',async()=>{
 const m=menu()
 try{
  await Vue.nextTick();assert.equal(m.setup.active.value,2);assert.equal(m.focused.at(-1),2)
  assert.equal(m.key('ArrowDown').prevented,true);assert.equal(m.setup.active.value,0)
  m.key('ArrowUp');assert.equal(m.setup.active.value,2)
  m.key('Home');assert.equal(m.setup.active.value,0)
  m.key('End');assert.equal(m.setup.active.value,2)
  const event=m.key('Enter');assert.ok(event.prevented&&event.stopped)
  assert.deepEqual(m.emitted,[{name:'select',value:toolGroup('C').entries[2]},{name:'close',value:undefined}])
  assert.equal(m.props.open,true);assert.equal(m.props.selected,'straighten')
 }finally{m.dispose()}
})
test('outside click, Escape, Tab and loss of window focus close without applying; listeners are cleaned up',async()=>{
 const m=menu('L','lasso-freehand')
 try{
  await Vue.nextTick();m.listeners.get('document:pointerdown')!({target:m.inside});assert.equal(m.emitted.length,0)
  m.listeners.get('document:pointerdown')!({target:{}});assert.equal(m.emitted[0].name,'close')
  assert.equal(m.key('Escape').prevented,true);assert.equal(m.key('Tab').prevented,false)
  m.listeners.get('window:blur')!();assert.deepEqual(m.emitted.map(e=>e.name),['close','close','close','close'])
  m.props.open=false;await Vue.nextTick();m.listeners.get('document:pointerdown')!({target:{}});assert.equal(m.emitted.length,4)
 }finally{m.dispose()}
 assert.equal(m.listeners.size,0)
})
test('group changes and reopening follow parent selection, disabled menus cannot apply, stale focus cannot outlive close',async()=>{
 const m=menu()
 try{
  await Vue.nextTick();m.props.group='J';m.props.selected='heal';await Vue.nextTick();await Vue.nextTick();assert.equal(m.setup.active.value,2)
  m.props.disabled=true;await Vue.nextTick();m.key('Enter');m.setup.choose(0);assert.equal(m.emitted.length,0)
  m.key('Escape');assert.equal(m.emitted.length,1)
  m.props.open=false;await Vue.nextTick();m.props.disabled=false;m.props.selected='spot-heal';m.props.open=true;await Vue.nextTick();await Vue.nextTick();assert.equal(m.setup.active.value,0)
  m.key(' ');assert.deepEqual(m.emitted[1].value,toolGroup('J').entries[0])
  const before=m.focused.length;m.props.open=false;await Vue.nextTick();await Vue.nextTick();assert.equal(m.focused.length,before)
 }finally{m.dispose()}
})
test('menu template compiles with semantic radio items, roving focus and pointer isolation',()=>{
 const m=menu()
 try{
  const result=compileTemplate({source:m.descriptor.template!.content,filename:'ToolGroupMenu.vue',id:'tool-group-menu-test'})
  assert.deepEqual(result.errors,[])
  assert.match(m.descriptor.template!.content,/role="menu"/);assert.match(m.descriptor.template!.content,/role="menuitemradio"/)
  assert.match(m.descriptor.template!.content,/@pointerdown\.stop/);assert.match(m.descriptor.template!.content,/:tabindex="active===index\?0:-1"/)
 }finally{m.dispose()}
})

test('every L4 / W3 / J6 / I3 variant is selectable through the actual menu handler with the exact registry payload',async()=>{
 for(const group of ['L','W','J','I','A'] as const){
  const m=menu(group,toolGroup(group).entries[0].id)
  try{
   await Vue.nextTick()
   for(let index=0;index<toolGroup(group).entries.length;index++){
    m.setup.choose(index)
    assert.deepEqual(m.emitted.at(-2),{name:'select',value:toolGroup(group).entries[index]})
    assert.deepEqual(m.emitted.at(-1),{name:'close',value:undefined})
   }
   m.key('End');assert.equal(m.setup.active.value,toolGroup(group).entries.length-1);m.key('ArrowDown');assert.equal(m.setup.active.value,0)
  }finally{m.dispose()}
 }
})

test('actual App Shift group handler visits every L4 / W3 / J6 / I3 entry, wraps and respects interaction guards',async()=>{
 const {descriptor}=parse(readFileSync('src/renderer/App.vue','utf8')),source=ts.createSourceFile('App.ts',descriptor.scriptSetup!.content,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
 const declaration=source.statements.find(statement=>ts.isFunctionDeclaration(statement)&&statement.name?.text==='cyclePhotoshopGroup');assert.ok(declaration)
 const code=transformSync(declaration.getText(source),{loader:'ts',format:'cjs'}).code
 const tool=Vue.ref('text'),ellipseSelection=Vue.ref(false),lassoMode=Vue.ref('freehand'),cropMode=Vue.ref('crop'),retouchMode=Vue.ref('spot-heal'),busy=Vue.ref(false),captured:string[]=[]
 const refs={tool,ellipseSelection,lassoMode,cropMode,retouchMode,busy,marqueeAxis:Vue.ref('area')}
 const chooseToolGroupEntry=async(entry:ReturnType<typeof toolGroup>['entries'][number])=>{captured.push(entry.id);tool.value=entry.tool;if(entry.ellipseSelection!==undefined)ellipseSelection.value=entry.ellipseSelection;if(entry.lassoMode)lassoMode.value=entry.lassoMode;if(entry.cropMode)cropMode.value=entry.cropMode;if(entry.retouchMode)retouchMode.value=entry.retouchMode}
 const create=new Function('deps',`const {toolGroup,selectedToolGroupEntry,tool,ellipseSelection,marqueeAxis,lassoMode,cropMode,retouchMode,busy,chooseToolGroupEntry}=deps;let drag=deps.drag;${code};return cyclePhotoshopGroup`)
 for(const group of ['L','W','J','I','A'] as const){
  const cycle=create({toolGroup,selectedToolGroupEntry,...refs,chooseToolGroupEntry,drag:undefined}) as (key:string)=>Promise<void>
  tool.value='text';captured.length=0
  for(let index=0;index<=toolGroup(group).entries.length;index++)await cycle(group.toLowerCase())
  assert.deepEqual(captured,[...toolGroup(group).entries.map(entry=>entry.id),toolGroup(group).entries[0].id])
  busy.value=true;const before=captured.length;await cycle(group.toLowerCase());assert.equal(captured.length,before);busy.value=false
  const blocked=create({toolGroup,selectedToolGroupEntry,...refs,chooseToolGroupEntry,drag:{mode:'raster'}}) as (key:string)=>Promise<void>;await blocked(group.toLowerCase());assert.equal(captured.length,before)
 }
})
