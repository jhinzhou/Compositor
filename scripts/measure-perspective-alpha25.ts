import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {inflateSync} from 'node:zlib'
import {PNG} from 'pngjs'
import {perspectiveCropSize,photoshopPerspectiveCropCorners,type CropCorners} from '../src/shared/crop-projective'
import {perspectiveCropRaster} from '../src/core/crop-actions'
import {makeAsset} from '../src/core/project-io'

/** Independent native holdouts. No dimensions or transforms are inferred from
 * image appearance. A cohort must record the actual pointer quad separately. */
const sourceFixture=JSON.parse(await readFile('fixtures/parity/photoshop-27.11-perspective-alpha24.json','utf8'))
const cohort=JSON.parse(await readFile(process.argv[2]??'fixtures/parity/photoshop-27.11-perspective-alpha25.json','utf8'))
const sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex')
const load=async(input:{rgbaZlib?:string;sha256?:string;path?:string;nativePath?:string;width:number;height:number})=>{
 if(input.rgbaZlib){const data=inflateSync(Buffer.from(input.rgbaZlib,'base64'));assert.equal(sha(data),input.sha256);assert.equal(data.length,input.width*input.height*4);return {width:input.width,height:input.height,data}}
 const path=input.nativePath??input.path;assert.ok(path,'Native/source path is required');const png=PNG.sync.read(await readFile(path));assert.equal(png.width,input.width);assert.equal(png.height,input.height);if(input.sha256)assert.equal(sha(png.data),input.sha256);return png
}
const source=await load(cohort.source??sourceFixture.source),sourcePNG=new PNG({width:source.width,height:source.height});sourcePNG.data.set(source.data)
const asset=makeAsset('reference.png',PNG.sync.write(sourcePNG)),placement={origin:[0,0] as [number,number],size:[source.width,source.height] as [number,number],rotation:0,flipX:false,flipY:false,sampling:'High quality' as const}
const output=process.argv[3]??'artifacts/photoshop-native/measurements/perspective-alpha25';await mkdir(output,{recursive:true})
const results=[]
for(const reference of cohort.cases){
 const native=await load(reference),corners=reference.corners.map((p:number[]|{x:number;y:number})=>Array.isArray(p)?p:[p.x,p.y]) as CropCorners,length=(a:number[],b:number[])=>Math.hypot(a[0]-b[0],a[1]-b[1]),w=Math.max(length(corners[0],corners[1]),length(corners[3],corners[2])),h=Math.max(length(corners[0],corners[3]),length(corners[1],corners[2])),models={legacyMean:perspectiveCropSize(corners),longestRoundInclusive:{width:Math.round(w)+1,height:Math.round(h)+1},longestFloorInclusive:{width:Math.floor(w)+1,height:Math.floor(h)+1},longestCeilInclusive:{width:Math.ceil(w)+1,height:Math.ceil(h)+1}}
 const sameSize=(s:{width:number;height:number})=>s.width===native.width&&s.height===native.height
 const result=PNG.sync.read(perspectiveCropRaster(asset,placement,photoshopPerspectiveCropCorners(corners,native.width,native.height),native.width,native.height,'High quality').bytes)
 let sum=0,squared=0,max=0,alphaMax=0;for(let i=0;i<native.data.length;i++){const delta=Math.abs(result.data[i]-native.data[i]);if(i%4===3)alphaMax=Math.max(alphaMax,delta);else{sum+=delta;squared+=delta*delta;max=Math.max(max,delta)}}
 const channels=native.width*native.height*3
 await writeFile(`${output}/${reference.name}-production-fixed-native-size.png`,PNG.sync.write(result))
 results.push({name:reference.name,corners,geometryVerified:reference.geometryVerified,actualNative:{width:native.width,height:native.height,rgbaSHA256:sha(native.data)},longestEdges:{width:w,height:h},models:Object.entries(models).map(([name,size])=>({name,...size,matchesNative:sameSize(size)})),fixedNativeSizeSampling:{rgbMAE:sum/channels,rgbRMSE:Math.sqrt(squared/channels),rgbMax:max,alphaMax}})
}
const verified=results.filter(r=>r.geometryVerified===true),modelSupport=['legacyMean','longestRoundInclusive','longestFloorInclusive','longestCeilInclusive'].map(name=>({name,verifiedCases:verified.length,matches:verified.filter(r=>r.models.find(m=>m.name===name)?.matchesNative).length}))
const report={source:{width:source.width,height:source.height,rgbaSHA256:sha(source.data)},nativeOutputs:results.length,verifiedGeometries:verified.length,modelSupport,productionSizeChanged:false,limits:['Size candidates are geometry-only diagnostics until independent native holdouts agree.','Sampling comparisons explicitly use native output size and are not evidence that automatic size matches.','Native RGB8 observations do not imply Photoshop RGB16/HDR equivalence.'],results}
await writeFile(output+'/comparison.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2))
