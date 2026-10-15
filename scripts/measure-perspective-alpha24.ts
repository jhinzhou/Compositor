import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {inflateSync} from 'node:zlib'
import {PNG} from 'pngjs'
import {mapCropPoint,perspectiveCropMatrix,photoshopPerspectiveCropCorners,type CropCorners} from '../src/shared/crop-projective'
import {perspectiveCropRaster} from '../src/core/crop-actions'
import {makeAsset} from '../src/core/project-io'
import {cropMitchell} from '../src/core/crop-sampling'

// Recompute the actual production mapping from immutable native fixtures.
// Optional cohort argument can add independent archived PNGs.
const fixture=JSON.parse(await readFile('fixtures/parity/photoshop-27.11-perspective-alpha24.json','utf8'))
const bytes=inflateSync(Buffer.from(fixture.source.rgbaZlib,'base64'))
const sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex')
assert.equal(sha(bytes),fixture.source.sha256)
type Reference={name:string;nativePath:string;corners:CropCorners;width:number;height:number;geometryVerified:boolean;rgbaZlib?:string;sha256?:string;pngSHA256?:string}
let source:{width:number;height:number;data:Uint8Array}={width:fixture.source.width,height:fixture.source.height,data:bytes},references:Reference[]=fixture.cases
if(process.argv[2]){const cohort=JSON.parse(await readFile(process.argv[2],'utf8'));source=PNG.sync.read(await readFile(cohort.sourcePath));references=cohort.cases}
const output=process.argv[3]??'artifacts/photoshop-native/measurements/perspective-alpha24'
await mkdir(output,{recursive:true})
const cubic=(b:number,c:number)=>(n:number)=>{const x=Math.abs(n);return x<1?((12-9*b-6*c)*x**3+(-18+12*b+6*c)*x*x+6-2*b)/6:x<2?((-b-6*c)*x**3+(6*b+30*c)*x*x+(-12*b-48*c)*x+8*b+24*c)/6:0}
const kernels={mitchell:cropMitchell,catmullRom:cubic(0,.5),bSpline:cubic(1,0),bilinear:(x:number)=>Math.max(0,1-Math.abs(x))}
const sample=(u:number,v:number,kernel:(x:number)=>number):number[]=>{
 const left=Math.floor(u-.5),top=Math.floor(v-.5),fx=u-.5-left,fy=v-.5-top,result=[0,0,0,0]
 for(let dy=-1;dy<=2;dy++)for(let dx=-1;dx<=2;dx++){
  const x=left+dx,y=top+dy;if(x<0||y<0||x>=source.width||y>=source.height)continue
  const at=(y*source.width+x)*4,weight=kernel(dx-fx)*kernel(dy-fy),alpha=source.data[at+3]/255
  result[3]+=source.data[at+3]*weight;for(let c=0;c<3;c++)result[c]+=source.data[at+c]*alpha*weight
 }
 const alpha=Math.max(0,Math.min(255,result[3]));return result.map((v,c)=>c===3?Math.round(alpha):alpha?Math.round(Math.max(0,Math.min(alpha,v))*255/alpha):0)
}
type Stats={channels:number;sum:number;squares:number;max:number;alphaMax:number}
const empty=():Stats=>({channels:0,sum:0,squares:0,max:0,alphaMax:0})
const finish=(s:Stats)=>({channels:s.channels,mae:s.sum/Math.max(1,s.channels),rmse:Math.sqrt(s.squares/Math.max(1,s.channels)),max:s.max,alphaMax:s.alphaMax})
const results=[]
for(const reference of references){
 let raw:Buffer
 if(reference.rgbaZlib){const data=inflateSync(Buffer.from(reference.rgbaZlib,'base64'));assert.equal(sha(data),reference.sha256);const png=new PNG({width:reference.width,height:reference.height});png.data.set(data);raw=PNG.sync.write(png)}else raw=await readFile(reference.nativePath)
 const native=PNG.sync.read(raw);assert.equal(native.width,reference.width);assert.equal(native.height,reference.height)
 const matrix=perspectiveCropMatrix(reference.corners,reference.width,reference.height),rows=[]
 for(const [kernelName,kernel] of Object.entries(kernels))for(const phase of ['centers','endpoints'] as const)for(const [shiftX,shiftY] of [[0,0],[.5,.5]]){
  const all=empty(),lowFrequency=empty(),highFrequency=empty(),actual=new PNG({width:reference.width,height:reference.height})
  for(let y=0;y<reference.height;y++)for(let x=0;x<reference.width;x++){
   const [u,v]=mapCropPoint(matrix,phase==='centers'?(x+.5)/reference.width:x/Math.max(1,reference.width-1),phase==='centers'?(y+.5)/reference.height:y/Math.max(1,reference.height-1)),color=sample(u+shiftX,v+shiftY,kernel),at=(y*reference.width+x)*4
   actual.data.set(color,at);let localRange=0
   const sx=Math.floor(u),sy=Math.floor(v)
   for(let c=0;c<3;c++){let minimum=255,maximum=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=Math.max(0,Math.min(source.width-1,sx+dx)),yy=Math.max(0,Math.min(source.height-1,sy+dy)),value=source.data[(yy*source.width+xx)*4+c];minimum=Math.min(minimum,value);maximum=Math.max(maximum,value)}localRange=Math.max(localRange,maximum-minimum)}
   const category=localRange<24?lowFrequency:highFrequency
   for(let c=0;c<4;c++){const delta=Math.abs(color[c]-native.data[at+c]);for(const s of [all,category])if(c===3)s.alphaMax=Math.max(s.alphaMax,delta);else{s.channels++;s.sum+=delta;s.squares+=delta*delta;s.max=Math.max(s.max,delta)}}
  }
  rows.push({kernel:kernelName,phase,shiftX,shiftY,...finish(all),lowFrequency:finish(lowFrequency),highFrequency:finish(highFrequency)})
  if(phase==='centers'&&!shiftX&&!shiftY)await writeFile(`${output}/${reference.name}-${kernelName}.png`,PNG.sync.write(actual))
 }
 const sourcePNG=new PNG({width:source.width,height:source.height});sourcePNG.data.set(source.data)
 const correctedAsset=perspectiveCropRaster(makeAsset('reference.png',PNG.sync.write(sourcePNG)),{origin:[0,0],size:[source.width,source.height],rotation:0,flipX:false,flipY:false,sampling:'High quality'},photoshopPerspectiveCropCorners(reference.corners,reference.width,reference.height),reference.width,reference.height,'High quality'),corrected=PNG.sync.read(correctedAsset.bytes),correctedStats=empty()
 for(let i=0;i<native.data.length;i++){const delta=Math.abs(corrected.data[i]-native.data[i]);if(i%4===3)correctedStats.alphaMax=Math.max(correctedStats.alphaMax,delta);else{correctedStats.channels++;correctedStats.sum+=delta;correctedStats.squares+=delta*delta;correctedStats.max=Math.max(correctedStats.max,delta)}}
 await writeFile(`${output}/${reference.name}-photoshop-ui-corrected.png`,correctedAsset.bytes)
 const nativeHash=sha(native.data)
 const {rgbaZlib,...metadata}=reference
 results.push({...metadata,photoshopUIProduction:finish(correctedStats),nativePNGHash:reference.pngSHA256??sha(raw),nativeRGBAHash:nativeHash,baseline:rows.find(r=>r.kernel==='mitchell'&&r.phase==='centers'&&!r.shiftX&&!r.shiftY),unchangedMapping:rows.filter(r=>r.phase==='centers'&&!r.shiftX&&!r.shiftY),diagnostics:rows.sort((a,b)=>a.mae-b.mae)})
}
const report={source:{width:source.width,height:source.height,rgbaSHA256:sha(source.data)},nativeOutputs:references.length,independentGeometryFamilies:process.argv[2]?null:2,productionChanged:true,limits:['Archived GUI corners may differ from intended pointer coordinates; no recorded transform matrix.','This cohort contains an independent integer rectangle and opposite-tilt quadrilateral.','Endpoint source-center mapping is a candidate Photoshop UI input convention; preserve the existing public edge-coordinate contract.','Native RGB8 only; no RGB16/HDR interpolation equivalence claim.'],results}
await writeFile(output+'/comparison.json',JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({nativeOutputs:report.nativeOutputs,productionChanged:true,rows:results.map(r=>({name:r.name,baseline:r.baseline,unchangedMapping:r.unchangedMapping,photoshopUIProduction:r.photoshopUIProduction,bestDiagnostic:r.diagnostics[0]}))},null,2))
