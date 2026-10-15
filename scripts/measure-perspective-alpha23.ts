import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {inflateSync} from 'node:zlib'
import {PNG} from 'pngjs'
import {mapCropPoint,perspectiveCropMatrix,type CropCorners} from '../src/shared/crop-projective'
import {cropMitchell} from '../src/core/crop-sampling'

// Research only: no production kernel/matrix change, no fixture replacement.
// Optional argument is a cohort JSON with {sourcePath,cases:[{name,nativePath,
// corners,width,height,geometryVerified?}]} for independently captured references.
const fixture=JSON.parse(await readFile('fixtures/parity/photoshop-27.11-crop-alpha21-ui.json','utf8'))
const bytes=inflateSync(Buffer.from(fixture.source.rgbaZlib,'base64'))
const sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex')
assert.equal(sha(bytes),fixture.source.rgbaSHA256)
type Reference={name:string;nativePath:string;corners:CropCorners;width:number;height:number;geometryVerified:boolean}
let source:{width:number;height:number;data:Uint8Array}={width:fixture.sourceWidth as number,height:fixture.sourceHeight as number,data:bytes},references:Reference[]=[
 {name:'alpha21-controlled-348x223',nativePath:fixture.perspective.nativePath,corners:fixture.perspective.corners,width:348,height:223,geometryVerified:false},
 {name:'alpha21-auto-387x257',nativePath:'artifacts/photoshop-native/outputs/crop-alpha21-ui/capture-1791856412697.png',corners:fixture.perspective.corners,width:387,height:257,geometryVerified:false}
]
if(process.argv[2]){const cohort=JSON.parse(await readFile(process.argv[2],'utf8'));source=PNG.sync.read(await readFile(cohort.sourcePath));references=cohort.cases}
const output=process.argv[3]??'artifacts/photoshop-native/measurements/perspective-alpha23'
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
 const raw=await readFile(reference.nativePath),native=PNG.sync.read(raw);assert.equal(native.width,reference.width);assert.equal(native.height,reference.height)
 const matrix=perspectiveCropMatrix(reference.corners,reference.width,reference.height),rows=[]
 for(const [kernelName,kernel] of Object.entries(kernels))for(const phase of ['centers','endpoints'] as const)for(const [shiftX,shiftY] of phase==='centers'?[-.5,0,.5].flatMap(x=>[-.5,0,.5].map(y=>[x,y])):[[0,0]]){
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
 const nativeHash=sha(native.data);if(reference.name==='alpha21-controlled-348x223')assert.equal(nativeHash,fixture.perspective.native.rgbaSHA256)
 results.push({...reference,nativePNGHash:sha(raw),nativeRGBAHash:nativeHash,baseline:rows.find(r=>r.kernel==='mitchell'&&r.phase==='centers'&&!r.shiftX&&!r.shiftY),unchangedMapping:rows.filter(r=>r.phase==='centers'&&!r.shiftX&&!r.shiftY),diagnostics:rows.sort((a,b)=>a.mae-b.mae)})
}
const report={source:{width:source.width,height:source.height,rgbaSHA256:sha(source.data)},nativeOutputs:references.length,independentGeometryFamilies:process.argv[2]?null:1,productionChanged:false,limits:['Archived GUI corners may differ from intended pointer coordinates; no recorded transform matrix.','Two archived output sizes share one quadrilateral and are not independent geometry validation.','Post-source half-pixel shifts and endpoint mappings are diagnostic only, not eligible product fixes.','Native RGB8 only; no RGB16/HDR interpolation equivalence claim.'],results}
await writeFile(output+'/comparison.json',JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({nativeOutputs:report.nativeOutputs,productionChanged:false,rows:results.map(r=>({name:r.name,baseline:r.baseline,unchangedMapping:r.unchangedMapping,bestDiagnostic:r.diagnostics[0]}))},null,2))
