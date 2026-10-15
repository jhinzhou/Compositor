import assert from 'node:assert/strict'
import test from 'node:test'
import {randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {transformSync} from 'esbuild'
import {PNG} from 'pngjs'
import {readPsd,writePsdBuffer,type PixelData,type Psd} from 'ag-psd'
import {decodePhotoshop,encodePhotoshop} from '../src/core/photoshop-io'
import type {EditorState} from '../src/shared/contracts'

const require=createRequire(import.meta.url)
type Imported=ReturnType<typeof decodePhotoshop>
async function render(document:Imported):Promise<Buffer>{
 const kit=await require('canvaskit-wasm')({locateFile:(file:string)=>require.resolve('canvaskit-wasm/bin/'+file)})
 kit.MakeSWCanvasSurface=(element:{width:number;height:number})=>kit.MakeSurface(element.width,element.height)
 const file=resolve('src/renderer/canvas-engine.ts'),source=transformSync(readFileSync(file,'utf8'),{loader:'ts',format:'cjs'}).code,local=createRequire(file),module={exports:{} as any}
 new Function('require','module','exports',source)((specifier:string)=>specifier==='canvaskit-wasm'?()=>Promise.resolve(kit):specifier.endsWith('.wasm?url')?'':local(specifier),module,module.exports)
 const manifest=structuredClone(document.manifest),assets=[...document.assets.values()].map(asset=>{const file='data:image/png;base64,'+asset.bytes.toString('base64');for(const layer of manifest.layers){if(layer.imageFile===asset.file)layer.imageFile=file;if(layer.maskFile===asset.file)layer.maskFile=file}return {file,width:asset.width,height:asset.height,hash:asset.hash}})
 const state:EditorState={sessionId:randomUUID(),revision:0,manifest,assets,title:'Complex PSD regression',modified:false,canUndo:false,canRedo:false,warnings:document.warnings,activity:[]},engine=new module.exports.CanvasEngine()
 engine.setFullResolutionEffects(true)
 try{await engine.draw({} as HTMLCanvasElement,state,manifest.width,manifest.height);return Buffer.from(engine.png())}finally{engine.dispose()}
}
function raster(width:number,height:number,color:[number,number,number,number]):PixelData{const data=new Uint8ClampedArray(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set([Math.min(255,color[0]+x),Math.min(255,color[1]+y),color[2],color[3]],(y*width+x)*4);return {width,height,data}}
function fixture():Psd{
 const mask=raster(20,16,[255,255,255,255]);for(let y=0;y<16;y++)for(let x=0;x<20;x++){const gray=x<5?0:x<10?64:x<15?128:255;mask.data.set([gray,gray,gray,255],(y*20+x)*4)}
 return {width:64,height:48,imageResources:{globalAngle:90,resolutionInfo:{horizontalResolution:300,horizontalResolutionUnit:'PPI',widthUnit:'Inches',verticalResolution:300,verticalResolutionUnit:'PPI',heightUnit:'Inches'}},children:[
  {name:'Levels',adjustment:{type:'levels',rgb:{shadowInput:5,highlightInput:250,shadowOutput:0,highlightOutput:255,midtoneInput:1.2}},opacity:.8},
  {name:'Composite folder',blendMode:'pass through',opacity:.75,mask:{left:8,top:6,right:28,bottom:22,defaultColor:0,imageData:mask},children:[
   {name:'Editable text',imageData:raster(10,5,[200,100,80,180]),left:12,top:9,text:{text:'PSD test',left:0,top:0,right:10,bottom:5,transform:[1,0,0,1,12,14],style:{font:{name:'ArialMT'},fontSize:12,fillColor:{r:200,g:100,b:80}}}},
   {name:'Clipped pixels',imageData:raster(12,8,[20,180,40,160]),left:10,top:8,clipping:true,blendMode:'screen'},
   {name:'Masked base with styles',imageData:raster(12,8,[100,40,180,220]),left:10,top:8,mask:{left:10,top:8,right:22,bottom:16,defaultColor:255,imageData:raster(12,8,[128,128,128,255])},effects:{dropShadow:[{enabled:true,color:{r:0,g:0,b:0},opacity:.5,blendMode:'normal',angle:90,distance:{units:'Pixels',value:3},size:{units:'Pixels',value:2},useGlobalLight:true}],solidFill:[{enabled:true,color:{r:30,g:90,b:150},opacity:.2,blendMode:'normal'}]},protected:{position:true}}
  ]},
  {name:'Background',imageData:raster(64,48,[30,50,70,255]),protected:{transparency:true,position:true,composite:true}}
 ]}
}
test('nested masked/clipped/effected/text/adjustment PSD and PSB preserve editable structure and real Skia composite across round-trip',async()=>{
 const original=decodePhotoshop(writePsdBuffer(fixture(),{noBackground:true})),composite=await render(original),reference=PNG.sync.read(composite)
 assert.ok(new Set(reference.data).size>40,'fixture must exercise actual nonuniform rendered pixels')
 for(const psb of [false,true]){
  const bytes=encodePhotoshop(original.manifest,original.assets,{psb,compositePNG:composite}),psd=readPsd(bytes,{useImageData:true,skipThumbnail:true})
  assert.deepEqual([...psd.imageData!.data],[...reference.data]);assert.equal(psd.imageResources!.resolutionInfo!.horizontalResolution,300)
  const imported=decodePhotoshop(bytes),byName=new Map(imported.manifest.layers.map(layer=>[layer.name,layer])),folder=byName.get('Composite folder')!,base=byName.get('Masked base with styles')!
  assert.equal(imported.manifest.layers.length,6);assert.ok(folder.maskFile);assert.equal(base.parentID,folder.id);assert.ok(base.maskFile);assert.ok(base.effects);assert.equal(base.positionLocked,true);assert.equal(byName.get('Background')!.locked,true);assert.equal(byName.get('Clipped pixels')!.maskSourceID,base.id);assert.ok(byName.get('Editable text')!.text);assert.ok(byName.get('Levels')!.adjustment)
  const actual=PNG.sync.read(await render(imported));let max=0;for(let index=0;index<actual.data.length;index++)max=Math.max(max,Math.abs(actual.data[index]-reference.data[index]));assert.ok(max<=1,`Skia RGBA maximum round-trip difference ${max}`)
 }
})
