import {strict as assert} from 'node:assert'
import {randomUUID} from 'node:crypto'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {test} from 'node:test'
import {PNG} from 'pngjs'
import {documentInfoSchema,emptyDocumentInfo,nextSampleId,mapDocumentInfoPoints,constrainRulerEnd,rulerMeasurement,sampleRaster,type DocumentInfo} from '../src/shared/document-info'
import {editDocumentInfo,readDocumentInfoSamples} from '../src/core/document-info'
import {makeAsset,makeDeepAsset,makeHDRAsset,saveProject,loadProject,type Asset} from '../src/core/project-io'
import type {Layer,Manifest} from '../src/shared/contracts'
const pointInfo=(target:'merged'|'current'='current'):DocumentInfo=>({...emptyDocumentInfo(),samples:[{id:1,position:[.5,.5]}],sampleTarget:target})
function fixture():{manifest:Manifest;layer:Layer}{const layer:Layer={id:randomUUID().toUpperCase(),name:'source',isVisible:true,isGroup:false,opacity:1,blendMode:'Normal',transform:{origin:[0,0],size:[2,1],rotation:0,flipX:false,flipY:false,sampling:'Nearest'}};return {layer,manifest:{format:'com.compositor.project',version:13,colorSpace:'sRGB',documentID:randomUUID(),width:2,height:1,resolution:300,activeLayerID:layer.id,layers:[layer],documentInfo:pointInfo()}}}
test('persisted info rejects duplicate numbers, nonfinite points, unsupported sizes and extra fields',()=>{
 for(const info of [{...pointInfo(),samples:[{id:1,position:[0,0]},{id:1,position:[1,1]}]},{...pointInfo(),sampleSize:2},{...pointInfo(),samples:[{id:11,position:[0,0]}]},{...pointInfo(),ruler:{start:[NaN,0],end:[1,1]}},{...pointInfo(),unknown:true}])assert.equal(documentInfoSchema.safeParse(info).success,false)
 assert.equal(nextSampleId(pointInfo()),2);assert.equal(nextSampleId({...pointInfo(),samples:Array.from({length:10},(_,i)=>({id:i+1,position:[0,0]}))}),undefined)
})
test('point mapping transforms sample and both ruler arms without mutating the old metadata',()=>{
 const info={...pointInfo(),ruler:{start:[2,3] as [number,number],end:[5,7] as [number,number],third:[2,9] as [number,number]}},before=structuredClone(info)
 const mapped=mapDocumentInfoPoints(info,([x,y])=>[y*2-1,20-x*3]);assert.deepEqual(mapped.samples[0].position,[0,18.5]);assert.deepEqual(mapped.ruler,{start:[5,14],end:[13,5],third:[17,14]});assert.deepEqual(info,before)
 assert.throws(()=>mapDocumentInfoPoints(info,()=>[Infinity,0]))
})
test('ruler uses image resolution and includes a real second arm angle',()=>{
 const result=rulerMeasurement({start:[100,200],end:[400,600],third:[-300,500]},100,'in')
 assert.ok(Math.abs(result.angle+53.13010235415598)<1e-10);assert.equal(result.length,5);assert.equal(result.width,3);assert.equal(result.height,4);assert.equal(result.x,1);assert.equal(result.includedAngle,90);assert.equal(result.secondLength,5)
 assert.equal(rulerMeasurement({start:[0,0],end:[300,400]},100,'mm').length,127);assert.equal(rulerMeasurement({start:[0,0],end:[0,0]},100,'px').angle,0);assert.throws(()=>rulerMeasurement({start:[0,0],end:[1,1]},0,'px'))
})
test('Shift ruler constraint preserves radial distance and snaps into all 45 degree octants',()=>{
 for(const angle of [-170,-100,-80,-25,10,35,70,125,175]){const length=17,end:[number,number]=[4+length*Math.cos(angle*Math.PI/180),5+length*Math.sin(angle*Math.PI/180)],actual=constrainRulerEnd([4,5],end,true),dx=actual[0]-4,dy=actual[1]-5;assert.ok(Math.abs(Math.hypot(dx,dy)-17)<1e-12);assert.ok(Math.abs(Math.atan2(dy,dx)*180/Math.PI/45-Math.round(Math.atan2(dy,dx)*180/Math.PI/45))<1e-12);assert.deepEqual(constrainRulerEnd([4,5],end,false),end)}
})
test('source samples preserve all 16-bit fractional byte detail and alpha',()=>{
 const data=new Uint16Array([1001,4007,30001,65535,900,200,300,2000]),copy=data.slice(),raster={width:2,height:1,data,precision:'uint16' as const,premultiplied:true}
 assert.deepEqual(sampleRaster(raster,[.5,.5],1),{rgb:[1001,4007,30001],alpha:1,precision:'uint16',pixelCount:1,transparent:false});const second=sampleRaster(raster,[1.5,.5],1)!;assert.equal(second.rgb[0],900*65535/2000);assert.equal(second.alpha,2000/65535);assert.deepEqual(data,copy)
})
test('mean sampling clips image edges and alpha weights color instead of contaminating it with transparent black',()=>{
 const raster={width:2,height:1,data:new Uint8Array([250,50,100,255,0,0,0,0]),precision:'uint8' as const,premultiplied:false},out=sampleRaster(raster,[0,0],3)!
 assert.deepEqual(out.rgb,[250,50,100]);assert.equal(out.alpha,.5);assert.equal(out.pixelCount,2);assert.equal(sampleRaster(raster,[-.1,0],3),null);assert.equal(sampleRaster(raster,[2,0],1),null)
 assert.throws(()=>sampleRaster({...raster,precision:'uint16'},[0,0],1));assert.throws(()=>sampleRaster({...raster,data:new Uint8Array(3)},[0,0],1))
})
test('Float32 sampling retains negative and brighter-than-white extended colors',()=>{
 const result=sampleRaster({width:1,height:1,data:new Float32Array([2,-.5,.25,.5]),precision:'float32',premultiplied:true},[0,0],1)!
 assert.deepEqual(result.rgb,[4,-1,.5]);assert.equal(result.alpha,.5);assert.equal(result.precision,'float32')
})
test('current-layer sampling uses canonical PNG8, ignoring a dishonest display proxy and appearance flags',()=>{
 const {layer,manifest}=fixture(),data=Buffer.from([199,51,33,127,14,20,43,255]);layer.imageFile=layer.id+'.png';layer.opacity=.2;layer.isVisible=false
 const asset=makeAsset(layer.imageFile,PNG.sync.write({width:2,height:1,data} as PNG));asset.displayBytes=Buffer.from('not an image')
 const result=readDocumentInfoSamples(manifest,new Map([[asset.file,asset]]))[0];assert.equal(result.reading!.precision,'uint8');result.reading!.rgb.forEach((value,index)=>assert.ok(Math.abs(value-[199,51,33][index])<1e-12));assert.equal(result.reading!.alpha,127/255)
})
test('current-layer footprint is in document pixels when a layer is scaled or flipped',()=>{
 const {layer,manifest}=fixture();layer.imageFile=layer.id+'.png';layer.transform.size=[4,1];manifest.width=4;manifest.documentInfo={...pointInfo(),sampleSize:3,samples:[{id:1,position:[1.5,.5]}]}
 const asset=makeDeepAsset(layer.imageFile,2,1,new Uint16Array([1001,2003,3007,65535,4001,5003,6007,65535])),assets=new Map([[asset.file,asset]])
 let out=readDocumentInfoSamples(manifest,assets)[0].reading!;assert.equal(out.rgb[0],2001);assert.equal(out.pixelCount,3)
 layer.transform.flipX=true;out=readDocumentInfoSamples(manifest,assets)[0].reading!;assert.equal(out.rgb[0],3001)
})
test('a rotated source uses the document footprint and preserves source precision',()=>{
 const {layer,manifest}=fixture();manifest.width=manifest.height=2;layer.transform.size=[2,2];layer.transform.rotation=90;layer.imageFile=layer.id+'.png';manifest.documentInfo={...pointInfo(),samples:[{id:1,position:[.5,.5]},{id:2,position:[1.5,.5]}]}
 const asset=makeDeepAsset(layer.imageFile,2,2,new Uint16Array([1001,0,0,65535,2001,0,0,65535,3001,0,0,65535,4001,0,0,65535])),readings=readDocumentInfoSamples(manifest,new Map([[asset.file,asset]]))
 assert.equal(readings[0].reading!.rgb[0],3001);assert.equal(readings[1].reading!.rgb[0],1001)
 manifest.documentInfo={...manifest.documentInfo,sampleSize:3};assert.equal(readDocumentInfoSamples(manifest,new Map([[asset.file,asset]]))[0].reading!.rgb[0],2501)
})
test('8-bit merged sources identify their source depth separately from internal 16-bit composition',()=>{
 const {layer,manifest}=fixture();layer.imageFile=layer.id+'.png';manifest.documentInfo=pointInfo('merged');const asset=makeAsset(layer.imageFile,PNG.sync.write({width:2,height:1,data:Buffer.from([14,20,43,255,50,60,70,255])} as PNG)),out=readDocumentInfoSamples(manifest,new Map([[asset.file,asset]]))[0]
 assert.equal(out.sourcePrecision,'uint8');assert.equal(out.reading!.precision,'uint16');assert.deepEqual(out.reading!.rgb,[14*257,20*257,43*257])
})
test('merged readings use real source-over deep arithmetic rather than quantized screen colors',()=>{
 const {layer,manifest}=fixture();manifest.documentInfo=pointInfo('merged');layer.imageFile=layer.id+'.png';const lower=makeDeepAsset(layer.imageFile,2,1,new Uint16Array([1001,2003,4007,65535,5001,6003,7007,65535]))
 const upper={...structuredClone(layer),id:randomUUID().toUpperCase(),opacity:.25};upper.imageFile=upper.id+'.png';manifest.layers.push(upper)
 const top=makeDeepAsset(upper.imageFile,2,1,new Uint16Array([9001,10003,11007,65535,12001,13003,14007,65535])),before=lower.deep!.slice(),result=readDocumentInfoSamples(manifest,new Map([[lower.file,lower],[top.file,top]]))[0].reading!
 assert.deepEqual(result.rgb,[3001,4003,5757]);assert.equal(result.precision,'uint16');assert.deepEqual(lower.deep,before)
})
test('HDR merged readings retain extended Float32 values without quantizing to display PNG',()=>{
 const {layer,manifest}=fixture();manifest.documentInfo=pointInfo('merged');layer.imageFile=layer.id+'.exr';const asset=makeHDRAsset(layer.imageFile,2,1,new Float32Array([4,-1,.5,1,2,3,4,1]));const out=readDocumentInfoSamples(manifest,new Map([[asset.file,asset]]))[0].reading!
 assert.deepEqual(out.rgb,[4,-1,.5]);assert.equal(out.precision,'float32')
})
test('unsupported merged appearances and missing deep sources fail instead of claiming original precision',()=>{
 const {layer,manifest}=fixture();manifest.documentInfo=pointInfo('merged');layer.imageFile=layer.id+'.png';const asset=makeDeepAsset(layer.imageFile,2,1,new Uint16Array([1001,2003,3007,65535,0,0,0,0]));layer.effects={stroke:{red:1,green:0,blue:0,opacity:1,size:2,inside:false}}
 assert.throws(()=>readDocumentInfoSamples(manifest,new Map([[asset.file,asset]])),error=>(error as {code:string}).code==='UNSUPPORTED_FEATURE');layer.effects=undefined;manifest.documentInfo=pointInfo();const missing={...asset,deep:undefined};assert.throws(()=>readDocumentInfoSamples(manifest,new Map([[asset.file,missing]])),error=>(error as {code:string}).code==='INVALID_PROJECT')
})
test('numbered points and protractor metadata persist through an actual project save and reopen',async()=>{
 const {layer,manifest}=fixture();layer.imageFile=layer.id+'.png';const asset=makeDeepAsset(layer.imageFile,2,1,new Uint16Array([1001,2003,3007,65535,5001,6003,7007,65535]));const info={...pointInfo(),unit:'mm' as const,ruler:{start:[.5,.5] as [number,number],end:[1.5,.5] as [number,number],third:[.5,1.5] as [number,number]}},updated=editDocumentInfo(manifest,info)
 assert.notEqual(updated,manifest);assert.deepEqual(manifest.documentInfo,pointInfo());const root=await mkdtemp(join(tmpdir(),'compositor-info23-'))
 try{const path=join(root,'samples.comp');await saveProject(path,updated,new Map([[asset.file,asset]]));const reopened=await loadProject(path);assert.deepEqual(reopened.manifest.documentInfo,info);assert.deepEqual(readDocumentInfoSamples(reopened.manifest,reopened.assets),readDocumentInfoSamples(updated,new Map([[asset.file,asset]])))}finally{await rm(root,{recursive:true,force:true})}
})

test('Photoshop native ruler uses a negative angle for a downward right line',()=>{
 const measured=rulerMeasurement({start:[50,49],end:[170,119]},72,'px')
 assert.equal(measured.width,120);assert.equal(measured.height,70);assert.equal(Math.round(measured.angle*10)/10,-30.3);assert.equal(Math.round(measured.length*100)/100,138.92)
 assert.equal(Math.round(rulerMeasurement({start:[0,0],end:[10,-10]},72,'px').angle),45)
})
