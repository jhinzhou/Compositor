import test from 'node:test'
import assert from 'node:assert/strict'
import {inflateSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {cameraRawShadowsPremultiplied,cameraRawShadowsTables,cameraRawShadowsCoefficients} from '../src/shared/camera-raw-shadows'
import {CAMERA_RAW_SHADOWS_RESOURCE_BASE64,CAMERA_RAW_SHADOWS_SOURCE_SHA256} from '../src/shared/camera-raw-shadows-data'
import {applyImageFilter,applyCameraRawPreview,imageFilterSchema} from '../src/shared/image-filters'
import {cameraRawLightColor,cameraRawBrightness,cameraRawStages} from '../src/shared/camera-raw-adaptive'
import {runDeepFilter} from '../src/shared/deep-filter-run'
import {prepareHighDepthFilter} from '../src/core/high-depth-filter'
import {makeDeepAsset,makeHDRAsset} from '../src/core/project-io'
import {Editor} from '../src/core/editor'

type Packed={rgbaZlib:string;sha256:string}
const fixture=JSON.parse(readFileSync(new URL('../fixtures/parity/native-735c2cc-camera-raw-shadows-alpha27.json',import.meta.url),'utf8'))
const decode=(entry:Packed)=>{const bytes=inflateSync(Buffer.from(entry.rgbaZlib,'base64'));assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);return new Uint8Array(bytes)}
test('pinned MIT CRS2 resource identity, dimensions, amounts and malformed-data rejection',()=>{
 const bytes=Buffer.from(CAMERA_RAW_SHADOWS_RESOURCE_BASE64,'base64'),table=cameraRawShadowsTables()
 assert.equal(createHash('sha256').update(bytes).digest('hex'),fixture.resourceSHA256);assert.equal(CAMERA_RAW_SHADOWS_SOURCE_SHA256,fixture.resourceSHA256)
 assert.deepEqual([table.normalFrom,table.xCount,table.kCount,table.xLow,table.xStep,table.kLow,table.kStep],[1020,35,6,-14,.5,-11,2]);assert.deepEqual(table.amounts,[-100,-50,25,50,100])
 assert.ok(cameraRawShadowsCoefficients(0,0).every(v=>v===0))
 for(const offset of [0,4,6,8,10,12]){const bad=Buffer.from(bytes);bad[offset]^=127;assert.throws(()=>cameraRawShadowsTables(bad),/Invalid Camera Raw/)}
 const bad=Buffer.from(bytes);bad.writeFloatLE(NaN,18);assert.throws(()=>cameraRawShadowsTables(bad),/Invalid Camera Raw/)
 assert.throws(()=>cameraRawShadowsTables(bytes.subarray(0,bytes.length-1)),/Invalid Camera Raw/)
 assert.throws(()=>cameraRawShadowsCoefficients(NaN,0),/Invalid Camera Raw/)
})
for(const reference of fixture.cases)test(`actual upstream C adaptive Shadows: ${reference.name}`,()=>{
 const source=decode(reference.source),before=source.slice(),native=decode(reference.expected),actual=cameraRawShadowsPremultiplied(source,reference.width,reference.height,reference.amount,reference.samplingScale)
 let max=0
 for(let i=0;i<actual.length;i++){if(i%4===3)assert.equal(actual[i],native[i]);else max=Math.max(max,Math.abs(actual[i]-native[i]))}
 assert.ok(max<=1,`upstream C RGBA8 maximum delta ${max}; not Photoshop equivalence`);assert.deepEqual(source,before)
})
for(const reference of fixture.pipelineCases)test(`exact native C stage-order gray reference: ${reference.name}`,()=>{
 const source=decode(reference.source),native=decode(reference.expected),image={width:reference.width,height:reference.height,data:Uint8ClampedArray.from(source)}
 assert.deepEqual(applyImageFilter(image,{kind:'cameraRaw',...reference.settings}).data,Uint8ClampedArray.from(native))
 assert.deepEqual(image.data,Uint8ClampedArray.from(source))
})
test('mixed Highlights -90 then Shadows 80 retains the eight measured native one-level quantization drops, exact alpha and immutable source',()=>{
 const reference=(fixture.pipelineCases as {width:number;height:number;settings:{shadows:number;highlights?:number};source:Packed;expected:Packed;nativeFalls:number[][]}[]).find(row=>row.settings.shadows===80&&row.settings.highlights===-90)!
 assert.ok(reference,'Requires the independent actual C mixed-stage capture')
 const source=decode(reference.source),native=decode(reference.expected),image={width:reference.width,height:reference.height,data:Uint8ClampedArray.from(source)},before=image.data.slice(),actual=applyImageFilter(image,{kind:'cameraRaw',...reference.settings}).data,falls:number[][]=[]
 assert.deepEqual(actual,Uint8ClampedArray.from(native),'No widened native tolerance for the changed mixed-stage contract')
 for(let x=1;x<reference.width;x++)if(actual[x*4]<actual[(x-1)*4])falls.push([x,actual[(x-1)*4],actual[x*4]])
 assert.deepEqual(falls,reference.nativeFalls)
 assert.deepEqual(falls.map(row=>row[0]),[86,99,105,114,125,133,153,162])
 assert.deepEqual(falls.map(row=>row[2]-row[1]),Array(8).fill(-1))
 for(let at=3;at<actual.length;at+=4)assert.equal(actual[at],source[at])
 assert.deepEqual(image.data,before)
})
test('runtime sampling scale chooses original layer size for both Camera Raw entry points without persistence',()=>{
 const reference=fixture.cases[0],premult=decode(reference.source),straight=new Uint8ClampedArray(premult.length)
 for(let at=0;at<straight.length;at+=4){const a=premult[at+3];straight[at+3]=a;for(let c=0;c<3;c++)straight[at+c]=a?Math.min(255,Math.round(premult[at+c]*255/a)):0}
 const source={width:reference.width,height:reference.height,data:straight},spec=imageFilterSchema.parse({kind:'cameraRaw',shadows:100})
 const small=applyImageFilter(source,spec),normal=applyImageFilter(source,spec,undefined,.05)
 assert.notDeepEqual(small.data,normal.data);assert.deepEqual(applyCameraRawPreview(source,spec,{samplingScale:.05}).data,normal.data)
 assert.throws(()=>applyCameraRawPreview(source,spec,{samplingScale:0}));assert.equal(imageFilterSchema.safeParse({...spec,samplingScale:.05}).success,false)
 assert.deepEqual(applyImageFilter(source,{kind:'cameraRaw',shadows:0}).data,source.data)
})
test('Shadows executes between before/after stages, then folds remaining color edits',()=>{
 const reference=fixture.cases[0],input=decode(reference.source),source={width:reference.width,height:reference.height,data:Uint8ClampedArray.from(input)},spec=imageFilterSchema.parse({kind:'cameraRaw',exposure:.5,contrast:30,highlights:-25,shadows:60,whites:20,blacks:-10,saturation:15})
 assert.equal(spec.kind,'cameraRaw');if(spec.kind!=='cameraRaw')return
 const bright=cameraRawBrightness(source),before=cameraRawStages(spec,bright,'beforeShadows'),after=cameraRawStages(spec,bright,'afterShadows')
 assert.deepEqual(cameraRawStages(spec,bright),[...before,...after]);assert.equal(before.length,3);assert.equal(after.length,3)
 const actual=cameraRawLightColor(source,spec)
 assert.notDeepEqual(actual.data,cameraRawLightColor(source,{...spec,shadows:0}).data)
 // Remaining color edits stay on the after-pass, never a replacement for the spatial pass.
 assert.notDeepEqual(cameraRawLightColor(source,{...spec,mixer:{hue:[35,0,0,0,0,0,0,0],saturation:Array(8).fill(0),luminance:Array(8).fill(0),points:[]}},undefined,true).data,actual.data)
})
test('RGB16 and HDR remain typed with source precision, preserved alpha, undo-safe immutable backing',()=>{
 const width=24,height=16,deep=new Uint16Array(width*height*4),hdr=new Float32Array(deep.length)
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const at=(y*width+x)*4,a=40001,v=y<8?24011:1001+(x*317+y*151)%5000;deep.set([v,v+97,v+193,a],at);hdr.set([y<8?1.625:.01337,y<8?-.137:.03125,.625,.625],at)}
 const beforeDeep=deep.slice(),beforeHDR=hdr.slice(),filtered=runDeepFilter(deep,width,height,{kind:'cameraRaw',shadows:50})
 assert.ok(filtered instanceof Uint16Array);assert.notDeepEqual(filtered,deep);assert.ok([...filtered].some((v,i)=>i%4!==3&&v%257!==0),'result must not be a single flattened RGBA8 image')
 // Source alpha quantization in the native probe architecture is pre-existing; do not claim exact deep alpha.
 for(let at=0;at<filtered.length;at+=4)assert.equal(filtered[at+3],Math.round(deep[at+3]*255/65535)*257)
 for(const asset of [makeDeepAsset('depth.png',width,height,deep),makeHDRAsset('depth.exr',width,height,hdr)]){
  const editor=new Editor();editor.importImageAsset(asset,'Depth');const snapshot=editor.snapshot(),layer=snapshot.manifest.layers[0],filter=imageFilterSchema.parse({kind:'cameraRaw',shadows:50})
  const result=prepareHighDepthFilter({...snapshot,selection:null},{type:'layer.filter',layerId:layer.id,filter})
  assert.equal(!!result.hdr,!!asset.hdr);assert.equal(!!result.deep,!!asset.deep)
  const values=result.hdr??result.deep!;assert.ok(values.every(Number.isFinite))
  if(result.hdr)assert.ok(result.hdr.some((v,i)=>i%4!==3&&(v<0||v>1)),'HDR extended values must survive normalization/restoration')
  const original=snapshot.assets.get(layer.imageFile!)!
  editor.apply({...editor.identity(),action:{type:'layer.filter',layerId:layer.id,filter}})
  const changed=editor.snapshot().assets.get(editor.state().manifest.layers[0].imageFile!)!
  assert.deepEqual(changed.hdr??changed.deep,result.hdr??result.deep)
  editor.history({...editor.identity(),direction:'undo'})
  const restored=editor.snapshot().assets.get(editor.state().manifest.layers[0].imageFile!)!
  assert.deepEqual(restored.hdr??restored.deep,original.hdr??original.deep)
  editor.history({...editor.identity(),direction:'redo'})
  assert.deepEqual(editor.snapshot().assets.get(editor.state().manifest.layers[0].imageFile!)!.hdr??editor.snapshot().assets.get(editor.state().manifest.layers[0].imageFile!)!.deep,changed.hdr??changed.deep)
 }
 assert.deepEqual(deep,beforeDeep);assert.deepEqual(hdr,beforeHDR)
})
