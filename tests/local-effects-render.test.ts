import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {resolve} from 'node:path'
import {transformSync} from 'esbuild'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import type {EditorState,Layer,Transform} from '../src/shared/contracts'
import type {LayerEffects} from '../src/shared/layer-effects'
const require=createRequire(import.meta.url)
const effectSources:{width:number;height:number;scale:number}[]=[]
let engineClass:Promise<any>|undefined
function renderer():Promise<any>{return engineClass??=(async()=>{
 const kit=await require('canvaskit-wasm')({locateFile:(file:string)=>require.resolve('canvaskit-wasm/bin/'+file)})
 // Real Skia raster renderer, with only the DOM canvas allocation replaced by its same CPU surface backend.
 kit.MakeSWCanvasSurface=(element:{width:number;height:number})=>kit.MakeSurface(element.width,element.height)
 const filename=resolve('src/renderer/canvas-engine.ts'),source=transformSync(readFileSync(filename,'utf8'),{loader:'ts',format:'cjs'}).code,local=createRequire(filename),module={exports:{} as any}
 const load=(specifier:string)=>{if(specifier==='canvaskit-wasm')return ()=>Promise.resolve(kit);if(specifier.endsWith('.wasm?url'))return '';const module=local(specifier);if(specifier==='../shared/layer-effects')return {...module,renderLayerEffects:(image:any,effects:any,mask:any,scale=1)=>{effectSources.push({width:image.width,height:image.height,scale});return module.renderLayerEffects(image,effects,mask,scale)}};return module}
 new Function('require','module','exports',source)(load,module,module.exports)
 return module.exports.CanvasEngine
 })()}
function fixture(effects:LayerEffects,transform?:Partial<Transform>,mask=false,sourceSize:[number,number]=[4,4]):EditorState{
 const editor=new Editor();editor.create(32,32);const png=new PNG({width:sourceSize[0],height:sourceSize[1]});png.data.fill(255)
 editor.contentRaster(editor.identity(),PNG.sync.write(png),{name:'Source'})
 const state=structuredClone(editor.state()),layer=state.manifest.layers[0];layer.effects=effects;layer.transform={...layer.transform,origin:[10,10],size:[8,8],sampling:'Nearest',...transform}
 const bytes=PNG.sync.write(png),url='data:image/png;base64,'+bytes.toString('base64');layer.imageFile=url;state.assets[0].file=url
 if(mask){const black=new PNG({width:1,height:1});black.data.set([0,0,0,255]);const maskUrl='data:image/png;base64,'+PNG.sync.write(black).toString('base64');layer.maskFile=maskUrl;state.assets.push({file:maskUrl,hash:'uniform-black-mask',width:1,height:1})}
 return state
}
async function render(state:EditorState,region?:{x:number;y:number;width:number;height:number},full=false){const Engine=await renderer(),engine=new Engine();engine.setFullResolutionEffects(full);try{await engine.draw({} as HTMLCanvasElement,state,region?.width??32,region?.height??32,region);return PNG.sync.read(Buffer.from(engine.png()))}finally{engine.dispose()}}
const pixel=(png:PNG,x:number,y:number)=>[...png.data.subarray((y*png.width+x)*4,(y*png.width+x)*4+4)]
const red={red:1,green:0,blue:0,opacity:1}
test('real Skia local stroke scales with the layer and survives viewport cropping',async()=>{
 const state=fixture({stroke:{...red,size:1,inside:false}}),full=await render(state),crop=await render(state,{x:6,y:6,width:18,height:18})
 assert.deepEqual(pixel(full,8,13),[255,0,0,255]);assert.deepEqual(pixel(full,7,13),[0,0,0,0]);assert.deepEqual(pixel(full,10,13),[255,255,255,255])
 for(let y=0;y<18;y++)for(let x=0;x<18;x++)assert.deepEqual(pixel(crop,x,y),pixel(full,x+6,y+6))
})
test('real Skia local shadow rotates and flips with the layer rather than keeping a world direction',async()=>{
 const state=fixture({shadow:{...red,angle:0,distance:4,blur:0}},{rotation:90}),normal=await render(state),flipped=await render(fixture({shadow:{...red,angle:0,distance:4,blur:0}},{rotation:90,flipX:true}))
 assert.deepEqual(pixel(normal,13,5),[255,0,0,255]);assert.deepEqual(pixel(normal,5,13),[0,0,0,0])
 assert.deepEqual(pixel(flipped,13,22),[255,0,0,255]);assert.deepEqual(pixel(flipped,13,5),[0,0,0,0])
})
test('mask coverage suppresses source before local stroke and shadow are rendered',async()=>{
 const png=await render(fixture({stroke:{...red,size:1,inside:false},shadow:{...red,angle:90,distance:2,blur:0}},undefined,true))
 assert.ok(png.data.every(value=>value===0))
})

test('disabled and zero-opacity effect metadata leaves the base high-quality sampling unchanged',async()=>{
 const transform={rotation:23,size:[11.2,7.8] as [number,number],sampling:'High quality' as const}
 const base=await render(fixture({},transform)),disabled=await render(fixture({stroke:{...red,size:2,inside:false,enabled:false}},transform)),zero=await render(fixture({shadow:{...red,opacity:0,angle:0,distance:4,blur:2}},transform))
 assert.deepEqual(disabled.data,base.data);assert.deepEqual(zero.data,base.data)
})

test('full-resolution export evaluates effects on the original source grid while viewport remains bounded',async()=>{
 const state=fixture({stroke:{...red,size:1,inside:false}},undefined,false,[4000,4])
 await render(state);const preview=effectSources.at(-1)!;assert.ok(preview.width<4000);assert.ok(preview.scale<1)
 await render(state,undefined,true);assert.deepEqual(effectSources.at(-1),{width:4000,height:4,scale:1})
})
test('full-resolution effects reject oversized working planes instead of silently reducing export quality',async()=>{
 const state=fixture({shadow:{...red,angle:90,distance:5000,blur:500}})
 await assert.rejects(render(state,undefined,true),error=>error instanceof Error&&/budget|MiB/.test(error.message))
})
