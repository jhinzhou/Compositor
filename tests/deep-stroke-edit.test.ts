import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {PNG} from 'pngjs'
import {prepareDeepPaint,prepareDeepWarp,type DeepPaintAction} from '../src/core/deep-stroke-edit'
import {warpDeepPremultiplied,takeDeepPainted} from '../src/shared/deep-warp'
import {brushStrokeCoverage} from '../src/shared/brush-coverage'
import {prepareBrushStroke} from '../src/shared/brush-dynamics'
import {documentPoint,sourcePoint} from '../src/core/raster-edit'
import {makeDeepAsset,makeAsset} from '../src/core/project-io'
import {EditorError,type Layer,type Transform} from '../src/shared/contracts'
import type {PixelStage} from '../src/core/pixel-actions'
import type {RetouchAction} from '../src/core/retouch-edit'
const code=(value:string)=>(error:unknown)=>error instanceof EditorError&&error.code===value
function setup(width=8,height=8,transform:Transform={origin:[4,4],size:[width,height],rotation:0,flipX:false,flipY:false,sampling:'High quality'}){
 const id=randomUUID().toUpperCase(),file=`${id}.png`,deep=new Uint16Array(width*height*4)
 for(let p=0;p<width*height;p++)deep.set([10001+(p*717)%30000,20002+(p*337)%20000,30003+(p*193)%20000,65535],p*4)
 const asset=makeDeepAsset(file,width,height,deep),layer:Layer={id,name:'Deep',imageFile:file,isVisible:true,isGroup:false,opacity:1,blendMode:'Normal',transform},stage:PixelStage={manifest:{format:'com.compositor.project',version:12,colorSpace:'sRGB',documentID:randomUUID(),width:32,height:32,resolution:72,activeLayerID:id,layers:[layer]},assets:new Map([[file,asset]]),selection:null}
 const paint:DeepPaintAction={type:'layer.paint',layerId:id,points:[[6,6],[9,8]],size:3,color:[.9,.1,.3,.8],hardness:.5,opacity:.6,erase:false,target:'image'}
 const warp:RetouchAction={type:'layer.retouch',layerId:id,kind:'smear',points:[[6,6],[9,8]],size:4,hardness:.7,opacity:.65,protectAlpha:true,sourceMode:'this-layer',target:'image',smearMode:'smudge'}
 return {stage,layer,asset,deep,paint,warp}
}
function decode16(base64:string):Uint16Array {const bytes=Buffer.from(base64,'base64');return Uint16Array.from({length:bytes.length/2},(_,i)=>bytes.readUInt16LE(i*2))}
const reference=JSON.parse(readFileSync(new URL('../fixtures/parity/native-f01e298-deep-paint.json',import.meta.url),'utf8'))
for(const fixture of reference.rows)test(`native unchanged C deep_take_painted exact: ${fixture.name}`,()=>{
 const source=decode16(fixture.inputRGBA16LE),before=source.slice(),base=Uint8Array.from(Buffer.from(fixture.basePremultipliedRGBA8,'base64')),painted=Uint8Array.from(Buffer.from(fixture.paintedPremultipliedRGBA8,'base64'))
 assert.deepEqual(takeDeepPainted(source,base,painted,fixture.width,fixture.height),decode16(fixture.expectedRGBA16LE));assert.deepEqual(source,before)
})

test('ordinary16 brush uses shared geometry/dynamics with direct original precision compositing',()=>{
 const {stage,layer,asset,paint}=setup(),before=asset.deep!.slice(),action={...paint,flow:.27,pressures:[.3,.9],pressureSize:true,pressureOpacity:true},result=prepareDeepPaint(stage,action),prepared=prepareBrushStroke(action.points,action.size,0,action.pressures),coverage=brushStrokeCoverage({width:8,height:8,transform:layer.transform,canvasWidth:32,canvasHeight:32},prepared.points,action.size,action.hardness,{flow:action.flow,pressures:prepared.pressures,pressureSize:true,pressureOpacity:true})
 assert.equal(result.width,8);assert.equal(result.height,8);let changed=0,kept=0
 for(let at=0;at<before.length;at+=4){const alpha=coverage[at/4]/255*action.color[3]*action.opacity,expected=[0,1,2].map(c=>Math.round(action.color[c]*alpha*65535+before[at+c]*(1-alpha)));expected.push(65535);assert.deepEqual([...result.deep.subarray(at,at+4)],expected);if(alpha)changed++;else kept++}
 assert.ok(changed>0&&kept>0);assert.deepEqual(asset.deep,before);assert.deepEqual(result.transform,layer.transform)
})

test('16-bit low-opacity paint and erase change true source samples below the PNG8 threshold',()=>{
 for(const erase of [false,true]){const {stage,asset,paint}=setup();asset.deep!.set([10001,20002,30003,65535],(2*8+2)*4);const before=asset.deep!.slice(),result=prepareDeepPaint(stage,{...paint,points:[[6.5,6.5]],size:1,hardness:1,color:[0,0,0,1],opacity:.001,erase});const at=(2*8+2)*4;assert.deepEqual([...result.deep.subarray(at,at+4)],[9991,19982,29973,erase?65469:65535]);assert.deepEqual(asset.deep,before);assert.ok(result.deep[at]%257!==0)}
})

test('paint and erase selections leave alpha1/unselected channels exact and proxies immutable',()=>{
 const {stage,asset,paint}=setup(),bytes=Buffer.from(asset.bytes),display=Buffer.from(asset.displayBytes!)
 asset.deep!.set([1,0,0,1],0);stage.selection={inverted:false,shapes:[{kind:'rectangle',operation:'replace',bounds:[6,6,2,2],feather:0}]};const before=asset.deep!.slice()
 for(const erase of [false,true]){const result=prepareDeepPaint(stage,{...paint,size:6,hardness:1,erase});let changed=0;for(let y=0;y<8;y++)for(let x=0;x<8;x++){const at=(y*8+x)*4;if(x<2||x>=4||y<2||y>=4)assert.deepEqual(result.deep.subarray(at,at+4),before.subarray(at,at+4));else if(result.deep[at]!==before[at])changed++}assert.ok(changed>0);assert.equal(result.deep[3],1)}
 assert.deepEqual(asset.deep,before);assert.deepEqual(asset.bytes,bytes);assert.deepEqual(asset.displayBytes,display)
})

test('zero opacity/Flow/empty selection are strict no-ops before giant stroke growth',()=>{
 for(const mode of ['opacity','flow','selection']){const {stage,asset,paint}=setup();if(mode==='selection')stage.selection={shapes:[],inverted:false};const result=prepareDeepPaint(stage,{...paint,points:[[-2000,-2000]],size:4096,opacity:mode==='opacity'?0:1,flow:mode==='flow'?0:1});assert.equal(result.deep,asset.deep);assert.equal(result.width,8);assert.deepEqual(result.transform,stage.manifest.layers[0].transform)}
})

test('paint grows at original resolution and carries a linked grayscale mask',()=>{
 const {stage,layer,asset,paint}=setup(4,4),file=`${layer.id}.mask.png`,mask=new PNG({width:4,height:4});mask.data.fill(255);layer.maskFile=file;layer.maskLinked=true;stage.assets.set(file,makeAsset(file,PNG.sync.write(mask,{colorType:0,inputColorType:6})));const before=asset.deep!.slice(),result=prepareDeepPaint(stage,{...paint,points:[[3,5]],size:3,hardness:1,opacity:1,color:[1,0,0,1]})
 assert.ok(result.width>4);assert.equal(result.transform.size[0]/result.width,1);assert.ok(result.transform.origin[0]<4);assert.ok(result.maskPNG);const carried=PNG.sync.read(result.maskPNG!);assert.equal(carried.width,result.width);assert.equal(carried.height,result.height);assert.equal(result.maskPNG![25],0);assert.deepEqual(asset.deep,before)
})

test('trimming uses true16 alpha and keeps sub-byte border samples',()=>{
 const {stage,asset,paint}=setup();for(let x=0;x<8;x++)asset.deep!.set([0,1,0,1],x*4);const result=prepareDeepPaint(stage,{...paint,erase:true,points:[[7,7]],size:2,opacity:1,hardness:1});assert.equal(result.height,8);for(let x=0;x<8;x++)assert.equal(result.deep[x*4+3],1)
})

test('Float32 Smudge carries actual16 colors without byte quantization and keeps original immutable',()=>{
 const width=6,height=3,data=new Uint16Array(width*height*4);for(let p=0;p<width*height;p++)data.set([10001+p*1001,20002+p*701,30003+p*401,65535],p*4);const before=data.slice(),result=warpDeepPremultiplied({width,height,data},{mode:'smudge',points:[[1,1],[2,1],[3,1]],size:2,hardness:1,strength:1})
 assert.equal(result.data[(1*width+3)*4],data[(1*width+1)*4]);assert.ok(result.data[(1*width+3)*4]%257!==0);assert.deepEqual(result.dabs,[[2,1],[3,1]]);assert.deepEqual(data,before)
})

test('Liquify keeps persistent offsets and samples original once instead of progressively blurring colors',()=>{
 const width=9,height=5,data=new Uint16Array(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set([x%2?60001:10001,20002,30003,65535],(y*width+x)*4)
 const result=warpDeepPremultiplied({width,height,data},{mode:'liquify',points:[[2,2],[3,2],[4,2]],size:20,hardness:1,strength:.5}),at=(2*width+4)*4
 // Interior offsets are -.5 after dab1 and -1 after dab2, so final x4 reads
 // untouched x3 exactly. A per-dab color sampler would give 35001 instead.
 assert.equal(result.data[at],60001);assert.notEqual(result.data[at],35001);assert.equal(result.data[at+1],20002);assert.deepEqual(data.subarray(at,at+4),Uint16Array.from([10001,20002,30003,65535]))
})

test('both warp modes preserve every original16 alpha when Protect Alpha is on, including transparent and alpha1',()=>{
 for(const mode of ['smudge','liquify'] as const){const {stage,asset,warp}=setup();for(let p=0;p<64;p++){const alpha=p%4===0?0:p%4===1?1:p%4===2?30003:65535;asset.deep!.set([Math.min(alpha,10001+p*701),Math.min(alpha,20002),Math.min(alpha,30003),alpha],p*4)}const before=asset.deep!.slice(),result=prepareDeepWarp(stage,{...warp,smearMode:mode});let changed=0
  assert.equal(result.width,8);assert.equal(result.height,8);for(let at=0;at<before.length;at+=4){assert.equal(result.deep[at+3],before[at+3]);for(let c=0;c<3;c++){assert.ok(result.deep[at+c]<=before[at+3]);if(result.deep[at+c]!==before[at+c])changed++}}assert.ok(changed>0);assert.deepEqual(asset.deep,before)}
})

test('warping commits only selected hits; transformed layer unaffected samples never round-trip through doc grid',()=>{
 for(const mode of ['smudge','liquify'] as const){const transform:Transform={origin:[4.3,4.7],size:[12,9],rotation:23,flipX:true,flipY:false,sampling:'Smooth'},{stage,layer,asset,warp}=setup(8,8,transform),chosen=documentPoint(layer,3.5,4.5,8,8);stage.selection={inverted:false,shapes:[{kind:'rectangle',operation:'replace',bounds:[chosen[0]-.4,chosen[1]-.4,.8,.8],feather:0}]};const before=asset.deep!.slice(),result=prepareDeepWarp(stage,{...warp,points:[[chosen[0]-2,chosen[1]],chosen,[chosen[0]+2,chosen[1]]],size:6,smearMode:mode});let changed=0
  for(let y=0;y<8;y++)for(let x=0;x<8;x++){const at=(y*8+x)*4;if(x===3&&y===4){if(result.deep[at]!==before[at])changed++}else assert.deepEqual(result.deep.subarray(at,at+4),before.subarray(at,at+4))}assert.ok(changed>0);assert.deepEqual(result.transform,transform);assert.deepEqual(asset.deep,before)}
})

test('unprotected Smudge grows outside layer, keeps lowalpha originals, and carries linked mask',()=>{
 const {stage,asset,layer,warp}=setup(4,4),file=`${layer.id}.mask.png`,mask=new PNG({width:4,height:4});mask.data.fill(255);layer.maskFile=file;layer.maskLinked=true;stage.assets.set(file,makeAsset(file,PNG.sync.write(mask,{colorType:0,inputColorType:6})));const before=asset.deep!.slice(),result=prepareDeepWarp(stage,{...warp,points:[[5,6],[2,6]],size:3,hardness:1,opacity:1,protectAlpha:false})
 let outside=false;for(let y=0;y<result.height;y++)for(let x=0;x<result.width;x++){const at=(y*result.width+x)*4,doc=documentPoint({transform:result.transform} as Layer,x+.5,y+.5,result.width,result.height),old=sourcePoint(layer,...doc,4,4);if(old[0]<0&&result.deep[at+3]>0)outside=true}assert.ok(outside);assert.ok(result.width>4);assert.ok(result.maskPNG);assert.deepEqual(asset.deep,before)
})

test('smear stationary/zero/empty strokes do not change source; all-layers and masks explicitly refuse',()=>{
 const {stage,asset,warp}=setup();for(const points of [[[6,6]],[[6,6],[6,6]],[[6,6],[6.2,6.2]]] as [number,number][][])assert.equal(prepareDeepWarp(stage,{...warp,points}).deep,asset.deep)
 assert.equal(prepareDeepWarp(stage,{...warp,opacity:0}).deep,asset.deep);stage.selection={shapes:[],inverted:false};assert.equal(prepareDeepWarp(stage,warp).deep,asset.deep)
 for(const action of [{...warp,sourceMode:'all-layers' as const},{...warp,target:'mask' as const},{...warp,kind:'clone' as const}])assert.throws(()=>prepareDeepWarp(stage,action),code('UNSUPPORTED_FEATURE'))
})

test('warp/paint reject invalid premultiplication and enforce size/work budgets atomically',()=>{
 const {stage,asset,paint,warp}=setup();asset.deep![0]=65535;asset.deep![3]=1;const before=asset.deep!.slice();for(const run of [()=>prepareDeepPaint(stage,paint),()=>prepareDeepWarp(stage,warp)])assert.throws(run,code('INVALID_PROJECT'));assert.deepEqual(asset.deep,before)
 const large=setup();large.stage.manifest.width=8192;large.stage.manifest.height=8192;assert.throws(()=>prepareDeepWarp(large.stage,large.warp),code('RESOURCE_LIMIT'));assert.throws(()=>prepareDeepPaint(large.stage,{...large.paint,points:[[100000,100000]],size:4096}),code('RESOURCE_LIMIT'))
 const data=new Uint16Array(4);assert.throws(()=>takeDeepPainted(data,new Uint8Array(3),new Uint8Array(4),1,1),code('INVALID_ARGUMENT'));assert.throws(()=>warpDeepPremultiplied({width:1,height:1,data},{mode:'liquify',points:[[0,0],[1e6,1e6]],size:1,hardness:1,strength:1}),code('RESOURCE_LIMIT'));assert.deepEqual(data,new Uint16Array(4))
})

const warpReference=JSON.parse(readFileSync(new URL('../fixtures/parity/scalar-f01e298-deep-warp.json',import.meta.url),'utf8'))
for(const fixture of warpReference.rows)test(`independent normalized-texture Float32 scalar warp (not native GPU): ${fixture.name}`,()=>{
 const input=decode16(fixture.inputRGBA16LE),before=input.slice(),expected=decode16(fixture.expectedRGBA16LE),actual=warpDeepPremultiplied({width:fixture.width,height:fixture.height,data:input},fixture.options);let maxDelta=0
 for(let i=0;i<expected.length;i++)maxDelta=Math.max(maxDelta,Math.abs(actual.data[i]-expected[i]));assert.ok(maxDelta<=1,`rgba16Unorm scalar tolerance exceeded: ${maxDelta}`);assert.deepEqual(actual.dabs,fixture.dabs);assert.deepEqual(input,before)
})
