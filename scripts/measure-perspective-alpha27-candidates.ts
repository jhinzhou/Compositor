/** Bounded diagnostic only. No source/production mutation; no root-heldout reads by default. */
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {inflateSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {PNG} from 'pngjs'
import {mapCropPoint,perspectiveCropMatrix,photoshopPerspectiveCropCorners,type CropCorners} from '../src/shared/crop-projective'
import {cropSourceFootprint,sampleCropBicubic,cropIsotropicAffineMinification} from '../src/core/crop-sampling'
import {perspectiveCropRaster} from '../src/core/crop-actions'
import {makeAsset} from '../src/core/project-io'
const fixturePath=process.argv[2]??'fixtures/parity/photoshop-27.11-perspective-calibration-alpha27.json',output=process.argv[3]??'artifacts/alpha27-perspective/candidates';await mkdir(output,{recursive:true})
type Image={width:number;height:number;sha256:string;rgbaZlib:string}
type Reference=Image&{name:string;corners:CropCorners;requestedInterpolation?:string;referenceRole?:string}
const fixture=JSON.parse(await readFile(fixturePath,'utf8')) as {source:Image;cases:Reference[]},sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex'),decode=(entry:Image)=>{const data=inflateSync(Buffer.from(entry.rgbaZlib,'base64'));assert.equal(sha(data),entry.sha256);return {width:entry.width,height:entry.height,data}}
const source=decode(fixture.source),png=new PNG({width:source.width,height:source.height});png.data.set(source.data);const asset=makeAsset('candidate.png',PNG.sync.write(png)),placement={origin:[0,0] as [number,number],size:[source.width,source.height] as [number,number],rotation:0,flipX:false,flipY:false,sampling:'High quality' as const}
const sinc=(x:number)=>Math.abs(x)<1e-12?1:Math.sin(Math.PI*x)/(Math.PI*x),lanczos=(x:number)=>Math.abs(x)<3?sinc(x)*sinc(x/3):0
const stats=(a:Uint8Array,b:Uint8Array)=>{let rgbSum=0,rgbMax=0,alphaSum=0,alphaMax=0;for(let i=0;i<a.length;i++){const delta=Math.abs(a[i]-b[i]);if(i%4===3){alphaSum+=delta;alphaMax=Math.max(alphaMax,delta)}else{rgbSum+=delta;rgbMax=Math.max(rgbMax,delta)}}return {rgbMAE:rgbSum/(a.length/4*3),rgbMax,alphaMAE:alphaSum/(a.length/4),alphaMax}}
function lanczosSample(u:number,v:number,footprint:[number,number]):number[]{
 const [scaleX,scaleY]=footprint,px=u-.5,py=v-.5,left=Math.floor(px),top=Math.floor(py),tx=px-left,ty=py-top,rx=Math.ceil(3*scaleX),ry=Math.ceil(3*scaleY),out=[0,0,0,0];let norm=0
 for(let dy=1-ry;dy<=ry;dy++)for(let dx=1-rx;dx<=rx;dx++){const weight=lanczos((dx-tx)/scaleX)*lanczos((dy-ty)/scaleY);norm+=weight;const x=left+dx,y=top+dy;if(x<0||y<0||x>=source.width||y>=source.height)continue;const at=(y*source.width+x)*4,alpha=source.data[at+3];out[3]+=alpha*weight;for(let c=0;c<3;c++)out[c]+=source.data[at+c]*alpha/255*weight}
 return out.map(v=>v/norm)
}
const rows=[]
for(const reference of fixture.cases.filter(c=>!c.requestedInterpolation||c.requestedInterpolation==='bicubicAutomatic')){
 const native=decode(reference),width=native.width,height=native.height,corners=process.argv[4]==='--legacy-inclusive-centers'?photoshopPerspectiveCropCorners(reference.corners,width,height):reference.corners,matrix=perspectiveCropMatrix(corners,width,height),production=PNG.sync.read(perspectiveCropRaster(asset,placement,corners,width,height,'High quality').bytes),candidates=[]
 for(const strategy of ['current','alpha26-Mitchell','lanczos3-affine-isotropic-minify','pixel-integral-2','pixel-integral-4','pixel-integral-4-two-axis','pixel-integral-2-two-axis'] as const){
  const image=new PNG({width,height});let selectedPixels=0
  if(strategy==='current')image.data.set(production.data)
  else for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const u=(x+.5)/width,v=(y+.5)/height,[sx,sy]=mapCropPoint(matrix,u,v),footprint=cropSourceFootprint(matrix,width,height,u,v),isotropicAffine=cropIsotropicAffineMinification(matrix,width,height),minifying=footprint.some(d=>d>1+1e-9)
   const denominator=matrix[6]*u+matrix[7]*v+1,nx=matrix[0]*u+matrix[1]*v+matrix[2],ny=matrix[3]*u+matrix[4]*v+matrix[5],a=(matrix[0]*denominator-nx*matrix[6])/(denominator**2*width),b=(matrix[1]*denominator-nx*matrix[7])/(denominator**2*height),c=(matrix[3]*denominator-ny*matrix[6])/(denominator**2*width),d=(matrix[4]*denominator-ny*matrix[7])/(denominator**2*height),trace=a*a+b*b+c*c+d*d,det=a*d-b*c,minSingularSquared=(trace-Math.sqrt(Math.max(0,trace*trace-4*det*det)))/2
   let values:number[]
   if(strategy==='lanczos3-affine-isotropic-minify'&&isotropicAffine&&minifying){values=lanczosSample(sx,sy,footprint);selectedPixels++}
   else if(strategy.startsWith('pixel-integral-')&&minifying&&(!strategy.endsWith('two-axis')||minSingularSquared>1+1e-9&&(Math.abs(matrix[6])+Math.abs(matrix[7])>1e-12))){
    const count=strategy.startsWith('pixel-integral-2')?2:4,samples:Array<{u:number;v:number;footprint:[number,number]}> = []
    for(let dy=0;dy<count;dy++)for(let dx=0;dx<count;dx++){
     const pu=(x+(dx+.5)/count)/width,pv=(y+(dy+.5)/count)/height,[a,b]=mapCropPoint(matrix,pu,pv),local=cropSourceFootprint(matrix,width,height,pu,pv)
     samples.push({u:a,v:b,footprint:strategy==='pixel-integral-2-two-axis'?[Math.max(1,local[0]/count),Math.max(1,local[1]/count)]:[1,1]})
    }
    if(strategy==='pixel-integral-2-two-axis'&&!samples.every(sample=>{const [fx,fy]=sample.footprint,minified=fx>1+1e-9||fy>1+1e-9,rx=minified?Math.ceil(2*fx):2,ry=minified?Math.ceil(2*fy):2,left=Math.floor(sample.u-.5),top=Math.floor(sample.v-.5);return left+1-rx>=0&&top+1-ry>=0&&left+rx<source.width&&top+ry<source.height})){
     image.data.set(production.data.subarray((y*width+x)*4,(y*width+x)*4+4),(y*width+x)*4);continue
    }
    values=[0,0,0,0];for(const sample of samples){const tap=sampleCropBicubic(source.data,source.width,source.height,sample.u,sample.v,{premultiplied:false,footprint:sample.footprint});for(let c=0;c<4;c++)values[c]+=tap[c]/samples.length}selectedPixels++
   }
   else if(strategy.endsWith('two-axis')){image.data.set(production.data.subarray((y*width+x)*4,(y*width+x)*4+4),(y*width+x)*4);continue}
   else values=sampleCropBicubic(source.data,source.width,source.height,sx,sy,{premultiplied:false,footprint})
   const at=(y*width+x)*4,alpha=Math.max(0,Math.min(255,values[3]));image.data[at+3]=Math.round(alpha);for(let c=0;c<3;c++)image.data[at+c]=alpha?Math.round(Math.max(0,Math.min(alpha,values[c]))*255/alpha):0
  }
  if(strategy==='current')assert.deepEqual(image.data,production.data)
  candidates.push({strategy,selectedPixels,...stats(image.data,native.data)});await writeFile(`${output}/${reference.name}-${strategy}.png`,PNG.sync.write(image))
 }
 rows.push({name:reference.name,nativeRGBA_SHA256:reference.sha256,actualProduction:stats(production.data,native.data),candidates});console.log(JSON.stringify(rows.at(-1)))
}
await writeFile(output+'/comparison.json',JSON.stringify({status:'DIAGNOSTIC',fixture:fixturePath,sourceRGBA_SHA256:fixture.source.sha256,limits:['Candidate strategy only uses homography/source footprint, never case identity.','No fixed phase offset or fitted native output dimension is used.','No native RGB16/HDR equivalence or production acceptance is claimed.'],rows},null,2)+'\n')
