import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {transformSync} from 'esbuild'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import {makeDeepAsset} from '../src/core/project-io'
import {DeepPreviewService} from '../src/core/deep-preview'
import {compositeDeepDocument,sampleDeepCompositeRegion} from '../src/core/deep-composite'
import {quantizeDeep16ToRGBA8} from '../src/shared/deep-pixels'
import {quantizeDeepScreenRGBA8} from '../src/shared/deep-screen-display'
import {EditorError,failure as errorResult,type Manifest,type RpcResult} from '../src/shared/contracts'

function fixture(width=64,height=32){
 const editor=new Editor(),id=randomUUID().toUpperCase(),file=id+'.png',data=new Uint16Array(width*height*4)
 for(let i=0;i<data.length;i+=4)data.set([Math.round((i/4%width)/(width-1)*65535),20003,31007,65535],i)
 const asset=makeDeepAsset(file,width,height,data),manifest:Manifest={format:'com.compositor.project',version:12,colorSpace:'sRGB',documentID:randomUUID(),width,height,resolution:72,activeLayerID:id,layers:[{id,name:'Deep screen',isVisible:true,isGroup:false,opacity:1,blendMode:'Normal',imageFile:file,transform:{origin:[0,0],size:[width,height],rotation:0,flipX:false,flipY:false,sampling:'Nearest'}}]}
 editor.importDocument(manifest,new Map([[file,asset]]),'Deep screen');return {editor,asset,id}
}
const request=(editor:Editor,width=editor.state().manifest.width,height=editor.state().manifest.height)=>{const state=editor.state();return {sessionId:state.sessionId,expectedRevision:state.revision,manifest:state.manifest,width,height,region:{x:0,y:0,width:state.manifest.width,height:state.manifest.height}}}

test('display-only uniform dither leaves every exact opaque RGBA8 level unchanged',()=>{
 const pixels=new Uint16Array(256*32*4)
 for(let i=0;i<pixels.length;i+=4){const v=i/4%256;pixels.set([v*257,(255-v)*257,100*257,65535],i)}
 const before=pixels.slice(),result=quantizeDeepScreenRGBA8(pixels,256,32)
 for(let i=0;i<result.length;i+=4){const v=i/4%256;assert.deepEqual([...result.subarray(i,i+4)],[v,255-v,100,255])}
 assert.deepEqual(pixels,before)
})
test('half-level ramp has only adjacent levels, unbiased uniform rounding and repeatable output',()=>{
 const width=256,height=128,pixels=new Uint16Array(width*height*4),value=Math.round(100.5*257)
 for(let i=0;i<pixels.length;i+=4)pixels.set([value,value,value,65535],i)
 const result=quantizeDeepScreenRGBA8(pixels,width,height),high=[0,0,0]
 for(let i=0;i<result.length;i+=4)for(let c=0;c<3;c++){assert.ok(result[i+c]===100||result[i+c]===101);high[c]+=result[i+c]===101?1:0}
 for(const count of high)assert.ok(Math.abs(count/(width*height)-.5)<.02)
 assert.deepEqual(quantizeDeepScreenRGBA8(pixels,width,height),result)
})
test('uniform screen ramp is bounded and unbiased across noninteger levels',()=>{
 const width=257,height=128,pixels=new Uint16Array(width*height*4)
 for(let i=0;i<pixels.length;i+=4){const value=(i/4*1999)%65536;pixels.set([value,value,value,65535],i)}
 const result=quantizeDeepScreenRGBA8(pixels,width,height);let sum=0
 for(let i=0;i<result.length;i+=4)for(let c=0;c<3;c++){const error=result[i+c]-pixels[i+c]/257;assert.ok(Math.abs(error)<1);sum+=error}
 assert.ok(Math.abs(sum/(width*height*3))<.015)
})
test('alpha never receives dither; HDR clipping and zero-alpha RGB happen only at display boundary',()=>{
 const rgba=new Uint16Array([0,0,0,0,10001,15003,20007,32768]),before=rgba.slice(),result=quantizeDeepScreenRGBA8(rgba,2,1)
 assert.deepEqual([...result.slice(0,4)],[0,0,0,0]);assert.equal(result[7],128);assert.deepEqual(rgba,before)
 const hdr=new Float32Array([-1,2,.5,1,0,0,0,0]),copy=hdr.slice(),out=quantizeDeepScreenRGBA8(hdr,2,1)
 assert.equal(out[0],0);assert.equal(out[1],255);assert.equal(out[3],255);assert.deepEqual([...out.slice(4)],[0,0,0,0]);assert.deepEqual(hdr,copy)
})
test('display validates premultiplication, dimensions, samples and nonfinite HDR before allocation',()=>{
 assert.throws(()=>quantizeDeepScreenRGBA8(new Uint16Array([101,0,0,100]),1,1),/premultiplied/)
 assert.throws(()=>quantizeDeepScreenRGBA8(new Float32Array([0,NaN,0,1]),1,1),/premultiplied/)
 assert.throws(()=>quantizeDeepScreenRGBA8(new Float32Array([1,0,0,0]),1,1),/premultiplied/)
 assert.throws(()=>quantizeDeepScreenRGBA8(new Uint16Array(4),1.5,1),/dimensions/)
 assert.throws(()=>quantizeDeepScreenRGBA8(new Uint16Array(4),32_000_001,1),/dimensions/)
})
test('screen request composes and samples original 16-bit before display; default oracle remains unchanged',()=>{
 const {editor,asset}=fixture(),service=new DeepPreviewService(),before=editor.state(),snapshot=editor.snapshot(),req=request(editor,31,17)
 const composed=compositeDeepDocument(snapshot.manifest,snapshot.assets),sampled=sampleDeepCompositeRegion(composed,req.region,req.width,req.height)
 const legacy=service.render(req,before,snapshot),screen=service.render({...req,screenQuantization:true},before,snapshot)
 assert.deepEqual(legacy.data,quantizeDeep16ToRGBA8(sampled.data,req.width,req.height))
 assert.deepEqual(screen.data,quantizeDeepScreenRGBA8(sampled.data,req.width,req.height))
 assert.notDeepEqual(screen.data,legacy.data);assert.deepEqual(editor.state(),before);assert.equal(editor.snapshot().assets.get(asset.file),asset)
})
test('new screen request and legacy request share only the unchanged high-depth composite cache',()=>{
 const {editor}=fixture(),service=new DeepPreviewService(),req=request(editor),before=editor.state(),snapshot=editor.snapshot()
 const screen=service.render({...req,screenQuantization:true},before,snapshot),retained=service.retainedWorkingBytes()
 service.render(req,before,snapshot);assert.equal(service.retainedWorkingBytes(),retained)
 assert.deepEqual(service.render({...req,screenQuantization:true},before,snapshot),screen)
})
test('registered high-depth stroke draft and committed screen retain exact preview equality',()=>{
 const {editor,asset}=fixture(),service=new DeepPreviewService(),before=editor.state(),snapshot=editor.snapshot(),changed=makeDeepAsset(asset.file,asset.width,asset.height,asset.deep!.map((v,i)=>i%4===0?Math.min(65535,v+503):v)),req=request(editor)
 const draft=structuredClone(req);draft.manifest.layers[0].imageFile=service.remember(before,changed)
 const preview=service.render({...draft,screenQuantization:true},before,snapshot)
 const commit=service.render({...req,screenQuantization:true},before,{manifest:snapshot.manifest,assets:new Map([[changed.file,changed]])})
 assert.deepEqual(preview.data,commit.data);assert.equal(editor.snapshot().assets.get(asset.file),asset)
})
test('unsupported appearance is explicitly preflighted and leaves source and cache unchanged',()=>{
 const {editor,asset}=fixture(),service=new DeepPreviewService(),before=editor.state(),snapshot=editor.snapshot(),req=request(editor)
 req.manifest.layers[0].effects={stroke:{red:1,green:0,blue:0,opacity:1,size:1,inside:false}}
 assert.throws(()=>service.render({...req,screenQuantization:true},before,snapshot),e=>e instanceof EditorError&&e.code==='UNSUPPORTED_FEATURE'&&(e.details as any).reasons[0].feature==='effects')
 assert.equal(service.retainedWorkingBytes(),0);assert.equal(editor.snapshot().assets.get(asset.file),asset);assert.deepEqual(editor.state(),before)
})

const require=createRequire(import.meta.url)
let rendererPromise:Promise<any>|undefined
function renderer(){return rendererPromise??=(async()=>{
 const kit=await require('canvaskit-wasm')({locateFile:(file:string)=>require.resolve('canvaskit-wasm/bin/'+file)})
 kit.MakeSWCanvasSurface=(element:{width:number;height:number})=>kit.MakeSurface(element.width,element.height)
 const file=resolve('src/renderer/canvas-engine.ts'),source=transformSync(readFileSync(file,'utf8'),{loader:'ts',format:'cjs'}).code,local=createRequire(file),module={exports:{} as any}
 new Function('require','module','exports',source)((name:string)=>name==='canvaskit-wasm'?()=>Promise.resolve(kit):name.endsWith('.wasm?url')?'':local(name),module,module.exports)
 return module.exports.CanvasEngine
})()}

test('real Skia renderer routes plain deep layers and drafts, renders fallback warning, preserves export/error policy',async()=>{
 const {editor,asset}=fixture(),Engine=await renderer(),engine=new Engine(),service=new DeepPreviewService(),state=editor.state(),snapshot=editor.snapshot(),windowBefore=Object.getOwnPropertyDescriptor(globalThis,'window'),fetchBefore=globalThis.fetch
 const requests:any[]=[];let failure:RpcResult|undefined
 Object.defineProperty(globalThis,'window',{configurable:true,value:{compositor:{request:async(method:string,input:any)=>{assert.equal(method,'deepCompositePreview');requests.push(input);if(failure)return failure;try{return {ok:true,value:service.render(input,state,snapshot)}}catch(e){return errorResult(e)}}}}})
 globalThis.fetch=async()=>new Response(Uint8Array.from(asset.displayBytes!).buffer)
 try{
  await engine.draw({} as HTMLCanvasElement,state,64,32);assert.equal(requests.length,1);assert.equal(requests[0].screenQuantization,true);assert.equal(engine.getDisplayWarning(),undefined)
  const expected=service.render({...request(editor),screenQuantization:true},state,snapshot);assert.deepEqual(PNG.sync.read(Buffer.from(engine.png())).data,Buffer.from(expected.data))
  const draftState=structuredClone(state);draftState.manifest.layers[0].imageFile=service.remember(state,asset);await engine.draw({} as HTMLCanvasElement,draftState,64,32);assert.equal(requests.length,2)
  engine.setScreenQuantization(false);await engine.draw({} as HTMLCanvasElement,state,64,32)
  assert.equal(requests.at(-1).screenQuantization,false)
  const hiddenPixels=PNG.sync.read(Buffer.from(engine.png())).data
  assert.deepEqual(hiddenPixels,Buffer.from(quantizeDeep16ToRGBA8(asset.deep!,64,32)))
  assert.notDeepEqual(hiddenPixels,Buffer.from(expected.data),'hidden preview must not inherit visible screen dithering')
  engine.setScreenQuantization(true)
  const fallbackState=structuredClone(state);fallbackState.manifest.layers[0].effects={stroke:{red:1,green:0,blue:0,opacity:1,size:1,inside:false}};await engine.draw({} as HTMLCanvasElement,fallbackState,64,32)
  assert.equal(engine.getDisplayWarning()?.code,'UNSUPPORTED_FEATURE');assert.ok(PNG.sync.read(Buffer.from(engine.png())).data.some(v=>v>0));assert.equal(editor.snapshot().assets.get(asset.file),asset)
  failure={ok:false,error:{code:'RESOURCE_LIMIT',message:'Display budget exceeded'}};await engine.draw({} as HTMLCanvasElement,state,64,32);assert.equal(engine.getDisplayWarning()?.code,'RESOURCE_LIMIT')
  failure={ok:false,error:{code:'SNAPSHOT_EXPIRED',message:'Changed revision'}};await assert.rejects(engine.draw({} as HTMLCanvasElement,state,64,32),e=>(e as {code?:string}).code==='SNAPSHOT_EXPIRED')
  failure=undefined;engine.setFullResolutionEffects(true);const count=requests.length;await engine.draw({} as HTMLCanvasElement,state,64,32);assert.equal(requests.length,count,'plain PNG8 export retains original route');assert.equal(engine.getDisplayWarning(),undefined)
 }finally{engine.dispose();globalThis.fetch=fetchBefore;if(windowBefore)Object.defineProperty(globalThis,'window',windowBefore);else Reflect.deleteProperty(globalThis,'window')}
})
