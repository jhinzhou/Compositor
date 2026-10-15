import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {resolve} from 'node:path'
import {parse,compileScript} from '@vue/compiler-sfc'
import {transformSync} from 'esbuild'
import * as Vue from 'vue'
import {mapVectorPath,type VectorPath} from '../src/shared/vector-path'
function overlay(name:'VectorPathOverlay'|'FrameOverlay'|'FrameCreationOverlay',input:any){
 const filename=resolve(`src/renderer/${name}.vue`),{descriptor}=parse(readFileSync(filename,'utf8'),{filename}),module={exports:{} as any},localRequire=createRequire(filename),mounted:(()=>void)[]=[],unmounted:(()=>void)[]=[],listeners=new Map<string,Function>(),emitted:{event:string;value:any}[]=[],previous={window:globalThis.window,document:globalThis.document}
 Object.assign(globalThis,{window:{addEventListener:(name:string,fn:Function)=>listeners.set(name,fn),removeEventListener:(name:string)=>listeners.delete(name)},document:{addEventListener:(name:string,fn:Function)=>listeners.set(name,fn),removeEventListener:(name:string)=>listeners.delete(name)}})
 const require=(id:string)=>id==='vue'?{...Vue,onMounted:(fn:()=>void)=>mounted.push(fn),onBeforeUnmount:(fn:()=>void)=>unmounted.push(fn)}:id.endsWith('.vue')?{}:localRequire(id)
 new Function('module','exports','require',transformSync(compileScript(descriptor,{id:'vector-frame-test'}).content,{loader:'ts',format:'cjs'}).code)(module,module.exports,require)
 const props=Vue.reactive(input),captures=new Set<number>();let api:any
 const setup=module.exports.default.setup(props,{expose:(value:any)=>api=value,emit:(event:string,value:any)=>{emitted.push({event,value});if(event==='update')props.path=value;if(event==='boundary')props.frame=value;if(event==='content')props.contentTransform=value}})
 for(const fn of mounted)fn()
 const target={setPointerCapture:(id:number)=>captures.add(id),hasPointerCapture:(id:number)=>captures.has(id),releasePointerCapture:(id:number)=>captures.delete(id)},event=(id:number,x=20,y=20)=>({button:0,pointerId:id,clientX:x,clientY:y,currentTarget:target,altKey:false,preventDefault(){}})
 return {props,setup,api,captures,listeners,emitted,event,restore(){for(const fn of unmounted)fn();Object.assign(globalThis,previous)}}
}
const path=():VectorPath=>({fillRule:'nonzero',subpaths:[{id:'open',closed:false,knots:[{id:'a',point:[10,10],outHandle:[20,10]},{id:'b',point:[30,20],inHandle:[20,20]},{id:'c',point:[40,40]}]}]})
const options=(p=path(),mode='edit')=>({path:p,width:100,height:80,zoom:2,mode,mapClientPoint:(x:number,y:number)=>[x/2,y/2]})
test('actual vector SFC node drag is pointer-owned, translates handles with anchor and commits only after releasing interaction',()=>{
 const a=overlay('VectorPathOverlay',options());try{
  a.setup.anchor(a.event(1,20,20),'a');a.setup.move(a.event(2,40,50));assert.deepEqual(a.props.path.subpaths[0].knots[0].point,[10,10]);a.setup.move(a.event(1,40,50));assert.deepEqual(a.props.path.subpaths[0].knots[0].point,[20,25]);assert.deepEqual(a.props.path.subpaths[0].knots[0].outHandle,[30,25])
  a.setup.finish(a.event(2));assert.equal(a.captures.size,1);a.setup.finish(a.event(1,40,50));assert.equal(a.captures.size,0);assert.deepEqual(a.emitted.slice(-2).map(item=>item.event),['interaction','commit'])
 }finally{a.restore()}
})
test('black Path Selection translates every compound subpath and cubic handle without changing shape; cancel restores all coordinates',()=>{
 const original=path();original.subpaths.push({id:'second',closed:true,knots:[{id:'d',point:[60,10],inHandle:[55,5],outHandle:[65,15]},{id:'e',point:[70,30],inHandle:[75,35]}]});const a=overlay('VectorPathOverlay',options(original,'path'));try{
  a.setup.pathStart(a.event(1,20,20));a.setup.move(a.event(2,40,50));assert.deepEqual(a.props.path,original);a.setup.move(a.event(1,40,50));assert.deepEqual(a.props.path,mapVectorPath(original,([x,y])=>[x+10,y+15]));assert.equal(a.setup.selected.value,undefined)
  a.listeners.get('blur')!();assert.deepEqual(a.props.path,original);assert.equal(a.captures.size,0);assert.equal(a.emitted.some(item=>item.event==='commit'),false)
  a.setup.pathStart(a.event(3,20,20));a.setup.finish(a.event(3,40,50));assert.deepEqual(a.props.path,mapVectorPath(original,([x,y])=>[x+10,y+15]));assert.deepEqual(a.emitted.slice(-2).map(item=>item.event),['interaction','commit']);assert.equal(a.captures.size,0)
 }finally{a.restore()}
})
test('black arrow deletes the selected named path and forbids anchor Add/Delete/Convert; Delete during drag only cancels',()=>{
 const original=path(),a=overlay('VectorPathOverlay',options(original,'path')),key=()=>({key:'Delete',preventDefault(){},stopImmediatePropagation(){}});try{
  a.setup.selected.value='a';a.setup.add(a.event(1));a.setup.anchor(a.event(1),'a');a.setup.handle(a.event(1),'a','outHandle');a.api.splitSelected();a.api.deleteSelected();a.api.convertSelected();assert.equal(a.api.canSplitSelected.value,false);assert.equal(a.captures.size,0);assert.deepEqual(a.props.path,original);assert.equal(a.emitted.length,0)
  a.listeners.get('keydown')!(key());assert.deepEqual(a.emitted.map(item=>item.event),['deletePath']);assert.deepEqual(a.props.path,original)
  a.setup.pathStart(a.event(2));a.setup.move(a.event(2,40,50));a.listeners.get('keydown')!(key());assert.deepEqual(a.props.path,original);assert.equal(a.emitted.filter(item=>item.event==='deletePath').length,1);assert.equal(a.emitted.some(item=>item.event==='commit'),false);assert.equal(a.captures.size,0)
 }finally{a.restore()}
})
test('white Direct Selection edits only one anchor and switching to black cancels and clears its node target',()=>{
 const original=path(),a=overlay('VectorPathOverlay',options(original,'edit'));try{
  a.setup.anchor(a.event(1,20,20),'a');a.setup.move(a.event(1,40,50));assert.deepEqual(a.props.path.subpaths[0].knots.slice(1),original.subpaths[0].knots.slice(1));a.props.mode='path';assert.deepEqual(a.props.path,original);assert.equal(a.captures.size,0);assert.equal(a.setup.selected.value,undefined);assert.equal(a.emitted.some(item=>item.event==='commit'),false)
  a.props.mode='edit';a.setup.anchor(a.event(2,20,20),'a');a.setup.finish(a.event(2,40,50));assert.deepEqual(a.props.path.subpaths[0].knots[0].point,[20,25]);assert.deepEqual(a.props.path.subpaths[0].knots[0].outHandle,[30,25]);assert.deepEqual(a.props.path.subpaths[0].knots.slice(1),original.subpaths[0].knots.slice(1));a.listeners.get('keydown')!({key:'Delete',preventDefault(){},stopImmediatePropagation(){}});assert.equal(a.props.path.subpaths[0].knots.length,2);assert.equal(a.emitted.some(item=>item.event==='deletePath'),false)
 }finally{a.restore()}
})
test('actual Pen creates anchor/handles by drag, closes contour by first-anchor click and cancels draft on blur/Escape',()=>{
 const a=overlay('VectorPathOverlay',options({fillRule:'nonzero',subpaths:[]},'pen'));try{
  a.setup.add(a.event(1,20,40));a.setup.finish(a.event(1,40,60));const first=a.props.path.subpaths[0].knots[0];assert.deepEqual(first.point,[10,20]);assert.deepEqual(first.outHandle,[20,30]);assert.deepEqual(first.inHandle,[0,10])
  a.setup.add(a.event(2,80,40));a.setup.finish(a.event(2,80,40));a.setup.anchor(a.event(3,20,40),first.id);assert.equal(a.props.path.subpaths[0].closed,true)
  const before=structuredClone(Vue.toRaw(a.props.path));a.setup.add(a.event(4,120,100));assert.equal(a.props.path.subpaths.length,2);a.listeners.get('blur')!();assert.deepEqual(a.props.path,before);assert.equal(a.captures.size,0)
  a.setup.anchor(a.event(5,20,40),first.id);a.setup.move(a.event(5,50,60));a.listeners.get('keydown')!({key:'Escape',preventDefault(){}});assert.deepEqual(a.props.path,before)
 }finally{a.restore()}
})
test('actual vector SFC Alt breaks symmetric handles; split/delete/convert actions change editable path rather than pixels',()=>{
 const a=overlay('VectorPathOverlay',options());try{
  a.setup.handle(a.event(1,40,20),'a','outHandle');a.setup.finish({...a.event(1,50,30),altKey:true});assert.deepEqual(a.props.path.subpaths[0].knots[0].outHandle,[25,15]);assert.equal(a.props.path.subpaths[0].knots[0].inHandle,undefined)
  a.api.splitSelected();assert.equal(a.props.path.subpaths[0].knots.length,4);a.api.convertSelected();assert.equal(a.props.path.subpaths[0].knots[0].outHandle,undefined);a.api.deleteSelected();assert.equal(a.props.path.subpaths[0].knots.length,3)
  a.props.spacePan=true;a.setup.add(a.event(2));a.setup.anchor(a.event(2),'b');assert.equal(a.captures.size,0)
 }finally{a.restore()}
})
test('actual frame content drag preserves independent frame bounds and cancels after pointer/blur loss',()=>{
 const frame={kind:'ellipse',bounds:[10,20,30,40]},transform={origin:[4,16],size:[60,40],rotation:0,flipX:false,flipY:false,sampling:'High quality'},a=overlay('FrameOverlay',{frame,contentTransform:transform,mode:'content',zoom:2,viewAngle:90});try{
  a.setup.start(a.event(1,20,20));a.setup.move(a.event(2,40,20));assert.deepEqual(a.props.contentTransform.origin,[4,16]);a.setup.move(a.event(1,40,20));assert.ok(Math.abs(a.props.contentTransform.origin[0]-4)<1e-10);assert.equal(a.props.contentTransform.origin[1],6);assert.deepEqual(a.props.frame,frame)
  a.listeners.get('blur')!();assert.deepEqual(a.props.contentTransform,transform);assert.equal(a.captures.size,0);assert.equal(a.emitted.some(item=>item.event==='commit'),false)
  a.setup.start(a.event(3));a.setup.finish(a.event(3,40,20));assert.equal(a.emitted.at(-1)!.event,'commit')
 }finally{a.restore()}
})
test('path endpoints cannot split a nonexistent segment, and changing paths clears stale deletion targets',async()=>{
 const a=overlay('VectorPathOverlay',options());try{
  a.setup.anchor(a.event(1,80,80),'c');a.setup.finish(a.event(1,80,80));assert.equal(a.api.canSplitSelected.value,false);a.api.splitSelected();assert.equal(a.props.path.subpaths[0].knots.length,3)
  a.props.path={fillRule:'nonzero',subpaths:[{id:'new',closed:false,knots:[{id:'fresh',point:[1,2]}]}]};await Vue.nextTick();a.api.deleteSelected();assert.equal(a.props.path.subpaths[0].knots[0].id,'fresh')
 }finally{a.restore()}
})
test('switching frame content/boundary modes cancels the owned pointer before a child can commit its draft',()=>{
 const initial={origin:[4,16],size:[60,40],rotation:0,flipX:false,flipY:false,sampling:'High quality'},a=overlay('FrameOverlay',{frame:{kind:'rectangle',bounds:[1,2,30,40]},contentTransform:initial,mode:'content',zoom:2,viewAngle:0});try{
  a.setup.start(a.event(1,20,20));a.setup.move(a.event(1,40,40));assert.deepEqual(a.props.contentTransform.origin,[14,26]);a.props.mode='frame';assert.equal(a.captures.size,0);assert.deepEqual(a.props.contentTransform,initial);assert.equal(a.emitted.some(item=>item.event==='commit'),false)
  a.props.mode='content';a.setup.start(a.event(2,20,20));a.setup.move(a.event(2,30,40));a.api.finish(true);assert.equal(a.captures.size,0);assert.deepEqual(a.props.contentTransform,initial)
 }finally{a.restore()}
})

test('actual Frame creation zero click cancels without commit; first held update remains under the same owned pointer',()=>{
 const a=overlay('FrameCreationOverlay',{width:100,height:80,zoom:2,kind:'ellipse',mapClientPoint:(x:number,y:number)=>[x/2,y/2]});try{
  a.setup.start(a.event(1,20,20));a.setup.finish(a.event(1,20,20));assert.equal(a.emitted.some(item=>item.event==='commit'),false);assert.equal(a.captures.size,0)
  a.setup.start(a.event(2,20,20));a.setup.move(a.event(99,80,60));assert.equal(a.setup.draft.value,undefined);a.setup.move(a.event(2,80,60));assert.deepEqual(a.setup.draft.value,{kind:'ellipse',bounds:[10,10,30,20]});assert.equal(a.captures.size,1);a.setup.finish(a.event(99));assert.equal(a.captures.size,1);a.setup.finish(a.event(2,80,60));assert.deepEqual(a.emitted.at(-1)!.value,{kind:'ellipse',bounds:[10,10,30,20]})
 }finally{a.restore()}
})
test('actual Frame creation Escape/explicit tool cancellation restores empty draft and releases its exact lease',()=>{
 const a=overlay('FrameCreationOverlay',{width:100,height:80,zoom:2,kind:'rectangle',mapClientPoint:(x:number,y:number)=>[x/2,y/2]});try{
  a.setup.start(a.event(1,20,20));a.setup.move(a.event(1,80,60));a.listeners.get('keydown')!({key:'Escape',preventDefault(){},stopImmediatePropagation(){}});assert.equal(a.captures.size,0);assert.equal(a.setup.draft.value,undefined);assert.equal(a.emitted.some(item=>item.event==='commit'),false)
  a.setup.start(a.event(2,20,20));a.setup.move(a.event(2,80,60));a.api.finish(true);assert.equal(a.captures.size,0);assert.equal(a.emitted.at(-1)!.event,'interaction');assert.equal(a.emitted.at(-1)!.value,false)
 }finally{a.restore()}
})
