import test from 'node:test'
import assert from 'node:assert/strict'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import {applyPixelAction} from '../src/core/pixel-actions'
import {blankPNG,documentPoint,encodeRaster,sourcePoint} from '../src/core/raster-edit'
import {makeAsset} from '../src/core/project-io'
import type {EditAction,Transform} from '../src/shared/contracts'

const placement:Transform={origin:[2,2],size:[2,2],rotation:0,flipX:false,flipY:false,sampling:'Nearest'}
function fixture(width=8,height=6,transform=placement){const editor=new Editor();editor.create(width,height);const source=blankPNG(4,4);for(let i=0;i<source.data.length;i+=4)source.data.set([10,100,200,255],i);editor.importPNG(encodeRaster(source),'Small image');const id=editor.state().manifest.activeLayerID!;edit(editor,{type:'document.canvas_size',width,height,anchor:'top-left'});edit(editor,{type:'layer.set_transform',layerId:id,transform});return {editor,id}}
function edit(editor:Editor,action:EditAction){return editor.apply({...editor.identity(),action})}
function gradient(id:string,options:Partial<Extract<EditAction,{type:'layer.gradient'}>>={}):Extract<EditAction,{type:'layer.gradient'}>{return {type:'layer.gradient',layerId:id,start:[0,0],end:[8,0],from:[1,0,0,1],to:[1,0,0,0],radial:false,...options}}
function sample(png:PNG,transform:Transform,point:[number,number]):number[]{const [x,y]=sourcePoint({transform},...point,png.width,png.height),at=(Math.floor(y)*png.width+Math.floor(x))*4;return [...png.data.subarray(at,at+4)]}
function pixels(editor:Editor){const snapshot=editor.snapshot(),layer=snapshot.manifest.layers[0];return {layer,png:PNG.sync.read(snapshot.assets.get(layer.imageFile!)!.bytes),snapshot}}

test('gradient grows a scaled image to the canvas at its original resolution, fills blank space and undoes atomically',()=>{
  const {editor,id}=fixture(),before=editor.snapshot(),revision=editor.state().revision,result=edit(editor,gradient(id)),{png,layer}=pixels(editor)
  assert.equal(png.width,16);assert.equal(png.height,12);assert.deepEqual(layer.transform,{...placement,origin:[0,0],size:[8,6]})
  assert.deepEqual(sample(png,layer.transform,[.25,.25]),[255,0,0,247])
  assert.deepEqual(sample(png,layer.transform,[7.75,5.75]),[255,0,0,8])
  const alpha=1-2.25/8
  assert.deepEqual(sample(png,layer.transform,[2.25,2.25]),[Math.round((alpha+10/255*(1-alpha))*255),Math.round(100*(1-alpha)),Math.round(200*(1-alpha)),255])
  assert.equal(editor.state().revision,revision+1)
  const after=editor.snapshot();editor.history({...editor.identity(),direction:'undo',transactionId:result.transactionId});assert.deepEqual(editor.snapshot(),before)
  editor.history({...editor.identity(),direction:'redo'});assert.deepEqual(editor.snapshot(),after)
})

test('gradient preserves off-canvas pixels, including rotated and flipped source grids',()=>{
  for(const transform of [{...placement,origin:[-1,-1] as [number,number],size:[4,4] as [number,number]}, {...placement,origin:[-1,-1] as [number,number],size:[4,4] as [number,number],rotation:37,flipX:true,flipY:true}]){
    const {editor,id}=fixture(3,3,transform);edit(editor,gradient(id,{from:[1,0,0,1],to:[1,0,0,1]}));const {png,layer}=pixels(editor)
    let inside=0,outside=0
    for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){
      const p=documentPoint(layer,x+.5,y+.5,png.width,png.height),color=[...png.data.subarray((y*png.width+x)*4,(y*png.width+x)*4+4)]
      if(p[0]>=0&&p[1]>=0&&p[0]<3&&p[1]<3){inside++;assert.deepEqual(color,[255,0,0,255])}
      else {outside++;const [sx,sy]=sourcePoint({transform},...p,4,4);assert.deepEqual(color,sx>=0&&sy>=0&&sx<4&&sy<4?[10,100,200,255]:[0,0,0,0])}
    }
    assert.ok(inside>0);assert.ok(outside>0);assert.equal(layer.transform.rotation,transform.rotation);assert.equal(layer.transform.flipX,transform.flipX)
  }
})

test('selection restricts new gradient coverage in expanded canvas space',()=>{
  const {editor,id}=fixture();edit(editor,{type:'selection.set',selection:{inverted:false,shapes:[{kind:'rectangle',operation:'replace',bounds:[0,0,1,6],feather:0}]}})
  edit(editor,gradient(id,{from:[1,0,0,1],to:[1,0,0,1]}));const {png,layer}=pixels(editor)
  assert.deepEqual(sample(png,layer.transform,[.25,5.75]),[255,0,0,255]);assert.deepEqual(sample(png,layer.transform,[1.25,5.75]),[0,0,0,0]);assert.deepEqual(sample(png,layer.transform,[2.25,2.25]),[10,100,200,255])
})

test('linked mask coverage remains aligned when gradient grows image, while independent placement stays fixed',()=>{
  for(const independent of [false,true]){
    const {editor,id}=fixture(),stage={...editor.snapshot(),selection:null},layer=stage.manifest.layers[0],mask=blankPNG(4,4,0),maskName=`${id}.mask.png`
    mask.data.set([0,0,0,255],0);mask.data.set([80,80,80,255],(1*4+1)*4)
    stage.assets.set(maskName,makeAsset(maskName,encodeRaster(mask,true)));layer.maskFile=maskName;layer.maskEnabled=true;layer.maskLinked=!independent
    const maskBytes=stage.assets.get(maskName)!.bytes
    applyPixelAction(stage,gradient(id));const after=PNG.sync.read(stage.assets.get(maskName)!.bytes)
    if(independent){assert.deepEqual(layer.maskPlacement,placement);assert.deepEqual(stage.assets.get(maskName)!.bytes,maskBytes)}
    else {assert.equal(layer.maskPlacement,undefined);assert.equal(after.width,16);assert.equal(after.height,12);assert.equal(sample(after,layer.transform,[2.25,2.25])[0],0);assert.equal(sample(after,layer.transform,[2.75,2.75])[0],80);assert.equal(sample(after,layer.transform,[.25,.25])[0],255)}
  }
  const {editor,id}=fixture(),stage={...editor.snapshot(),selection:null},layer=stage.manifest.layers[0],mask=blankPNG(2,2,90),maskName=`${id}.mask.png`,fixed={...placement,origin:[6,1] as [number,number],size:[1,2] as [number,number]}
  layer.maskFile=maskName;layer.maskPlacement=fixed;layer.maskLinked=true;stage.assets.set(maskName,makeAsset(maskName,encodeRaster(mask,true)));const bytes=stage.assets.get(maskName)!.bytes
  applyPixelAction(stage,gradient(id));assert.deepEqual(layer.maskPlacement,fixed);assert.deepEqual(stage.assets.get(maskName)!.bytes,bytes)
})

test('gradient on a mask grows its own placement using the native perimeter background without moving image',()=>{
  const {editor,id}=fixture();edit(editor,{type:'layer.mask',layerId:id,operation:'hide'});const imageBefore=pixels(editor)
  edit(editor,gradient(id,{target:'mask',from:[1,1,1,1],to:[1,1,1,0]}));const snapshot=editor.snapshot(),layer=snapshot.manifest.layers[0],mask=PNG.sync.read(snapshot.assets.get(layer.maskFile!)!.bytes)
  assert.deepEqual(layer.transform,imageBefore.layer.transform);assert.deepEqual(snapshot.assets.get(layer.imageFile!)!.bytes,imageBefore.snapshot.assets.get(imageBefore.layer.imageFile!)!.bytes)
  assert.deepEqual(layer.maskPlacement,{...placement,origin:[0,0],size:[8,6]});assert.equal(mask.width,8);assert.equal(mask.height,6)
  assert.equal(sample(mask,layer.maskPlacement!,[.5,.5])[0],239);assert.equal(sample(mask,layer.maskPlacement!,[7.5,5.5])[0],15)
  for(const operation of ['hide','reveal'] as const){
    const other=fixture();edit(other.editor,{type:'layer.mask',layerId:other.id,operation});edit(other.editor,{type:'selection.set',selection:{inverted:false,shapes:[{kind:'rectangle',operation:'replace',bounds:[0,0,1,1],feather:0}]}})
    edit(other.editor,gradient(other.id,{target:'mask',from:[.5,.5,.5,1],to:[.5,.5,.5,1]}));const result=other.editor.snapshot(),target=result.manifest.layers[0],grown=PNG.sync.read(result.assets.get(target.maskFile!)!.bytes)
    assert.equal(sample(grown,target.maskPlacement!,[7.5,5.5])[0],operation==='hide'?0:255)
  }
})

test('a gradient exceeding the source-resolution working budget fails without changing the document',()=>{
  const {editor,id}=fixture(30_000,1,{...placement,origin:[0,0],size:[1,1]}),before=editor.snapshot()
  assert.throws(()=>edit(editor,gradient(id)),/working budget/);assert.deepEqual(editor.snapshot(),before)
})

test('gradient image commit trims empty expanded space without stretching surviving pixels',()=>{
  const {editor,id}=fixture();edit(editor,gradient(id,{end:[1,0]}));const {layer,png}=pixels(editor)
  assert.deepEqual(layer.transform,{...placement,origin:[0,0],size:[4,6]});assert.equal(png.width,8);assert.equal(png.height,12)
  assert.deepEqual(sample(png,layer.transform,[.25,5.75]),[255,0,0,191]);assert.deepEqual(sample(png,layer.transform,[1.25,5.75]),[0,0,0,0]);assert.deepEqual(sample(png,layer.transform,[2.25,2.25]),[10,100,200,255])
})

test('a solid linked hide mask preserves its old restriction and reveals newly grown image area',()=>{
  const {editor,id}=fixture();edit(editor,{type:'layer.mask',layerId:id,operation:'hide'});edit(editor,gradient(id));const {layer,snapshot}=pixels(editor),mask=PNG.sync.read(snapshot.assets.get(layer.maskFile!)!.bytes)
  assert.equal(mask.width,16);assert.equal(mask.height,12);assert.equal(sample(mask,layer.transform,[2.25,2.25])[0],0);assert.equal(sample(mask,layer.transform,[.25,.25])[0],255)
})
