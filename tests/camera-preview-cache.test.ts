import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {createRequire} from 'node:module'
import {parse,compileScript} from '@vue/compiler-sfc'
import {transformSync} from 'esbuild'
import * as Vue from 'vue'
import {defaultFilter} from '../src/shared/image-filters'
import * as kernels from '../src/shared/camera-raw-kernels'

// Execute the actual component setup; isolate only browser decoding/drawing.
function preview(deferred=false){
 const counts=new Map<string,number>(),pending=new Map<string,any[]>();let scopeReads=0,cleanup=()=>{}
 class TestImage{naturalWidth=4;naturalHeight=4;crossOrigin='';onload?:()=>void;onerror?:()=>void;url='';set src(url:string){this.url=url;counts.set(url,(counts.get(url)??0)+1);if(deferred){pending.set(url,[...(pending.get(url)??[]),this]);return}queueMicrotask(()=>url==='retry'&&counts.get(url)===1?this.onerror?.():this.onload?.())}}
 function surface(){let decoded:TestImage|undefined;const context:any={drawImage:(image:TestImage)=>decoded=image,getImageData:()=>({data:new Uint8ClampedArray(Array.from({length:64},(_,index)=>index%4===3?255:decoded?.url==='original'?40:decoded?.url==='next'?180:90))}),putImageData:(image:{data:Uint8ClampedArray})=>context.pixels=new Uint8ClampedArray(image.data),fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},arc(){}};return {width:4,height:4,getContext:()=>context,getBoundingClientRect:()=>({left:0,top:0,width:4,height:4}),context}}
 const previous={Image:globalThis.Image,document:globalThis.document,ImageData:globalThis.ImageData};Object.assign(globalThis,{Image:TestImage,document:{createElement:surface},ImageData:class{constructor(public data:Uint8ClampedArray,public width:number,public height:number){}}})
 const filename=resolve('src/renderer/CameraRawPreview.vue'),{descriptor}=parse(readFileSync(filename,'utf8'),{filename}),code=transformSync(compileScript(descriptor,{id:'camera-cache'}).content,{loader:'ts',format:'cjs'}).code,requireLocal=createRequire(filename),module={exports:{} as any},props={originalURL:'original',url:'preview',spec:defaultFilter('cameraRaw')},events:any[]=[]
 const load=(specifier:string)=>specifier==='vue'?{...Vue,watch:()=>{},onBeforeUnmount:(callback:()=>void)=>cleanup=callback}:specifier==='../shared/camera-raw-kernels'?{...kernels,cameraScopes:(image:any)=>{scopeReads++;return kernels.cameraScopes(image)}}:requireLocal(specifier)
 new Function('require','module','exports',code)(load,module,module.exports)
 const setup=module.exports.default.setup(props,{expose(){},emit:(event:string,value:any)=>events.push({event,value})}),canvas=surface(),scope=surface();setup.canvas.value=canvas;setup.scope.value=scope
 return {setup,props,counts,events,canvas,scope,reads:()=>scopeReads,finish:(url:string)=>{for(const image of pending.get(url)??[])image.onload?.();pending.delete(url)},unmount:()=>cleanup(),restore:()=>{cleanup();Object.assign(globalThis,previous)}}
}
test('Camera Raw shares original and concurrent URL decodes, bounds retained previews and retries a failed decode',async()=>{
 const instance=preview();try{const {setup,counts}=instance,first=setup.load('original');assert.equal(first,setup.load('original'));await first;assert.equal(counts.get('original'),1)
  await setup.load('preview');await setup.load('original');await setup.load('next');assert.equal(setup.decodedImages.size,2);assert.ok(setup.decodedImages.has('original'));assert.ok(setup.decodedImages.has('next'));assert.equal(counts.get('original'),1)
  await assert.rejects(setup.load('retry'),/decoded/);await setup.load('retry');assert.equal(counts.get('retry'),2);instance.unmount();assert.equal(setup.decodedImages.size,0)
 }finally{instance.restore()}
})
test('Camera Raw clipping and scope modes reuse statistics from graded pixels while original sampling stays unchanged',async()=>{
 const instance=preview();try{await instance.setup.refresh();assert.equal(instance.reads(),1);assert.equal(instance.counts.get('original'),1)
  instance.setup.view.value='shadows';instance.setup.paint();instance.setup.view.value='highlights';instance.setup.scopeMode.value='vectorscope';instance.setup.paint();await instance.setup.refresh();assert.equal(instance.reads(),1);assert.equal(instance.counts.get('original'),1)
  instance.props.url='next';await instance.setup.refresh();assert.equal(instance.reads(),2);assert.equal(instance.counts.get('original'),1);instance.setup.action.value='point';instance.setup.down({clientX:2,clientY:2});assert.deepEqual(instance.events.at(-1).value.points[0],kernels.cameraSamplePoint([40,40,40]))
 }finally{instance.restore()}
})
test('An obsolete or unmounted Camera Raw image decode never replaces the newest preview or updates its scope',async()=>{
 const instance=preview(true);try{const old=instance.setup.refresh();instance.props.url='next';const latest=instance.setup.refresh();instance.finish('original');instance.finish('next');await latest;assert.equal(instance.canvas.context.pixels[0],180);assert.equal(instance.reads(),1);instance.finish('preview');await old;assert.equal(instance.canvas.context.pixels[0],180);assert.equal(instance.reads(),1)
  instance.props.url='after-unmount';const closing=instance.setup.refresh();instance.unmount();instance.finish('after-unmount');await closing;assert.equal(instance.canvas.context.pixels[0],180);assert.equal(instance.reads(),1)
 }finally{instance.restore()}
})
