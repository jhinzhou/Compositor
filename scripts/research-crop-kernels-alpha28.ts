/** Diagnostic analytic reconstruction families. No production mutation.
 * Run calibration first; older cohorts are regression evidence, not independent
 * holdouts. New native holdouts must stay root-owned until model freeze. */
import assert from 'node:assert/strict'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {inflateSync} from 'node:zlib'
import {PNG} from 'pngjs'
import {perspectiveCropMatrix,mapCropPoint,photoshopPerspectiveCropCorners,type CropCorners} from '../src/shared/crop-projective'
import {perspectiveCropRaster} from '../src/core/crop-actions'
import {makeAsset} from '../src/core/project-io'
import {cropMitchell,cropLanczos3,cropSourceFootprint,cropIsotropicAffineMinification,sampleCropBicubic} from '../src/core/crop-sampling'
const mode=process.argv[2]??'calibration',directory=process.argv[3]??`artifacts/alpha28-sampling-research/${mode}`;await mkdir(directory,{recursive:true})
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
const cubic=(b:number,c:number)=>(n:number)=>{const x=Math.abs(n);return x<1?((12-9*b-6*c)*x**3+(-18+12*b+6*c)*x*x+6-2*b)/6:x<2?((-b-6*c)*x**3+(6*b+30*c)*x*x+(-12*b-48*c)*x+8*b+24*c)/6:0}
const catmull=cubic(0,.5),sharper=cubic(0,.75),spline=cubic(1,0)
type Image={width:number;height:number;data:Uint8Array}
type Entry={fixture:string;name:string;source:Image;native:Image;corners:CropCorners;operation:string}
const loadPNG=async(path:string)=>{const p=PNG.sync.read(await readFile(path));return {width:p.width,height:p.height,data:p.data}}
const decode=(v:any):Image=>{const data=inflateSync(Buffer.from(v.rgbaZlib,'base64'));assert.equal(sha(data),v.sha256);return {width:v.width,height:v.height,data}}
const entries:Entry[]=[]
if(mode==='calibration'){
 const path='artifacts/alpha28-perspective/calibration-verified.json',f=JSON.parse(await readFile(path,'utf8'))
 for(const c of f.cases.filter((c:any)=>c.referenceRole==='kernel-calibration')){assert.equal(c.status,'NATIVE_OUTPUT_CAPTURED');const source=await loadPNG(c.sourcePath),native=await loadPNG(c.nativePath);assert.equal(sha(source.data),c.sourceRGBA_SHA256);assert.equal(sha(native.data),c.nativeRGBA_SHA256);entries.push({fixture:path,name:c.name,source,native,corners:c.corners,operation:c.operation})}
}else{
 const paths=[...(mode==='old-cohorts-all'?['photoshop-27.11-perspective-alpha24.json','photoshop-27.11-perspective-alpha25.json']:[]),'photoshop-27.11-perspective-calibration-alpha27.json','photoshop-27.11-perspective-affine-holdout-alpha27.json','photoshop-27.11-perspective-projective-holdout-alpha27.json','photoshop-27.11-perspective-alpha-up-holdout-alpha27.json','photoshop-27.11-perspective-gui-alpha27.json','photoshop-27.11-perspective-sampling-alpha26-actionmanager-diagnostic.json','photoshop-27.11-perspective-sampling-alpha26-ramp-actionmanager-diagnostic.json']
 for(const name of paths){const path='fixtures/parity/'+name,f=JSON.parse(await readFile(path,'utf8')),source=decode(f.source);for(const c of f.cases.filter((c:any)=>!c.requestedInterpolation||c.requestedInterpolation==='bicubicAutomatic'))entries.push({fixture:path,name:c.name,source,native:decode(c),corners:name==='photoshop-27.11-perspective-alpha24.json'||name==='photoshop-27.11-perspective-alpha25.json'?photoshopPerspectiveCropCorners(c.corners,c.width,c.height):c.corners,operation:c.operation??'perspectiveCrop'})}
}
const candidates=[
 {name:'current',kernel:cropMitchell,support:2,scale:1},
 {name:'wide-mitchell-9/8',kernel:cropMitchell,support:2,scale:1.125},
 {name:'wide-catmull-9/8',kernel:catmull,support:2,scale:1.125},
 {name:'wide-catmull-9/8-opaque-interior',kernel:catmull,support:2,scale:1.125,opaqueOnly:true},
 {name:'wide-catmull-9/8-smooth-opaque',kernel:catmull,support:2,scale:1.125,smoothOpaque:true},
 {name:'wide-catmull-5/4',kernel:catmull,support:2,scale:1.25},
 {name:'wide-lanczos3-9/8',kernel:cropLanczos3,support:3,scale:1.125},
 {name:'wide-keys-9/8',kernel:sharper,support:2,scale:1.125},
 {name:'projective-minify-spline-point',kernel:cropMitchell,support:2,scale:1,projectiveSpline:true},
 {name:'projective-minify-catmull-scaled',kernel:catmull,support:2,scale:1,minify:true},
 {name:'projective-minify-keys-scaled',kernel:sharper,support:2,scale:1,minify:true},
 {name:'projective-minify-spline-scaled',kernel:spline,support:2,scale:1,minify:true}
]
function singularMaximum(m:number[],w:number,h:number,u:number,v:number){const q=m[6]*u+m[7]*v+m[8],nx=m[0]*u+m[1]*v+m[2],ny=m[3]*u+m[4]*v+m[5],a=(m[0]*q-nx*m[6])/(q*q*w),b=(m[1]*q-nx*m[7])/(q*q*h),c=(m[3]*q-ny*m[6])/(q*q*w),d=(m[4]*q-ny*m[7])/(q*q*h),t=a*a+b*b+c*c+d*d,det=a*d-b*c;return Math.sqrt((t+Math.sqrt(Math.max(0,t*t-4*det*det)))/2)}
function sample(source:Image,u:number,v:number,fx:number,fy:number,kernel:(n:number)=>number,support:number){const px=u-.5,py=v-.5,left=Math.floor(px),top=Math.floor(py),tx=px-left,ty=py-top,rx=Math.ceil(support*fx),ry=Math.ceil(support*fy),wx:number[]=[],wy:number[]=[],out=[0,0,0,0];let nx=0,ny=0
 for(let x=1-rx;x<=rx;x++){const w=kernel((x-tx)/fx)/fx;wx.push(w);nx+=w}for(let y=1-ry;y<=ry;y++){const w=kernel((y-ty)/fy)/fy;wy.push(w);ny+=w}
 for(let dy=1-ry;dy<=ry;dy++)for(let dx=1-rx;dx<=rx;dx++){const x=left+dx,y=top+dy;if(x<0||y<0||x>=source.width||y>=source.height)continue;const p=(y*source.width+x)*4,a=source.data[p+3],w=wx[dx+rx-1]*wy[dy+ry-1]/(nx*ny);out[3]+=a*w;for(let c=0;c<3;c++)out[c]+=source.data[p+c]*a/255*w}return out}
function stats(){return {sum:0,max:0,alphaSum:0,alphaMax:0,premultSum:0,premultMax:0,count:0}}
function record(s:ReturnType<typeof stats>,a:number[],n:Uint8Array,p:number){for(let c=0;c<4;c++){const delta=Math.abs(a[c]-n[p+c]);if(c===3){s.alphaSum+=delta;s.alphaMax=Math.max(s.alphaMax,delta)}else{s.sum+=delta;s.max=Math.max(s.max,delta);const d=Math.abs(a[c]*a[3]/255-n[p+c]*n[p+3]/255);s.premultSum+=d;s.premultMax=Math.max(s.premultMax,d)}}s.count++}
const finish=(s:ReturnType<typeof stats>)=>({rgbMAE:s.sum/(s.count*3),rgbMax:s.max,alphaMAE:s.alphaSum/s.count,alphaMax:s.alphaMax,premultRGBMAE:s.premultSum/(s.count*3),premultRGBMax:s.premultMax,pixels:s.count})
const rows=[]
for(const e of entries){const {source,native}=e,w=native.width,h=native.height,m=perspectiveCropMatrix(e.corners,w,h),affine=cropIsotropicAffineMinification(m,w,h),projective=Math.abs(m[6])+Math.abs(m[7])>1e-12,results=[]
 const input=new PNG({width:source.width,height:source.height});input.data.set(source.data);const placement={origin:[0,0] as [number,number],size:[source.width,source.height] as [number,number],rotation:0,flipX:false,flipY:false,sampling:'High quality' as const},production=PNG.sync.read(perspectiveCropRaster(makeAsset('research.png',PNG.sync.write(input)),placement,e.corners,w,h,'High quality').bytes).data
 for(const candidate of candidates){const all=stats(),interior=stats(),high=stats();let changedPixels=0,alphaRegressionPixels=0
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const u=(x+.5)/w,v=(y+.5)/h,[sx,sy]=mapCropPoint(m,u,v),footprint=cropSourceFootprint(m,w,h,u,v),magnifying=singularMaximum(m,w,h,u,v)<1-1e-9
   let kernel=affine?cropLanczos3:cropMitchell,support=affine?3:2,[fx,fy]=footprint,blend=1
   if(candidate.minify&&projective&&!magnifying){kernel=candidate.kernel;support=candidate.support;changedPixels++}
   else if(candidate.projectiveSpline&&projective&&!magnifying){kernel=spline;support=2;fx=fy=1;changedPixels++}
   else if(candidate.scale!==1&&magnifying){
    const rx=Math.ceil(candidate.support*candidate.scale),left=Math.floor(sx-.5),top=Math.floor(sy-.5);let opaque=true
    if(candidate.smoothOpaque){let distance=Infinity;for(let dy=-3;dy<=4;dy++)for(let dx=-3;dx<=4;dx++){const xx=left+dx,yy=top+dy;if(xx<0||yy<0||xx>=source.width||yy>=source.height||source.data[(yy*source.width+xx)*4+3]!==255)distance=Math.min(distance,Math.max(Math.abs(xx+.5-sx),Math.abs(yy+.5-sy)))}blend=Math.max(0,Math.min(1,(distance-2.25)/.75));opaque=blend>0}
    if(candidate.opaqueOnly)for(let dy=1-rx;dy<=rx;dy++)for(let dx=1-rx;dx<=rx;dx++){const xx=left+dx,yy=top+dy;if(xx<0||yy<0||xx>=source.width||yy>=source.height||source.data[(yy*source.width+xx)*4+3]!==255)opaque=false}
    if(opaque){kernel=candidate.kernel;support=candidate.support;fx=fy=candidate.scale;changedPixels++}
   }
   const p=(y*w+x)*4,usesCandidate=kernel!==cropMitchell&&kernel!==cropLanczos3||candidate.scale!==1&&fx===candidate.scale&&magnifying
   let a=Array.from(production.subarray(p,p+4))
   if(candidate.name!=='current'&&usesCandidate){const tap=sample(source,sx,sy,fx,fy,kernel,support);if(candidate.smoothOpaque&&blend<1){const baseline=sampleCropBicubic(source.data,source.width,source.height,sx,sy,{premultiplied:false,footprint});for(let c=0;c<4;c++)tap[c]=baseline[c]+(tap[c]-baseline[c])*blend}const alpha=Math.max(0,Math.min(255,tap[3]));a=[0,0,0,Math.round(alpha)];for(let c=0;c<3;c++)a[c]=alpha?Math.round(Math.max(0,Math.min(alpha,tap[c]))*255/alpha):0}
   if(a[3]!==production[p+3])alphaRegressionPixels++;record(all,a,native.data,p);if(sx>5&&sy>5&&sx<source.width-5&&sy<source.height-5)record(interior,a,native.data,p)
   let range=0;for(let c=0;c<3;c++){let lo=255,hi=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=Math.max(0,Math.min(source.width-1,Math.floor(sx)+dx)),yy=Math.max(0,Math.min(source.height-1,Math.floor(sy)+dy)),n=source.data[(yy*source.width+xx)*4+c];lo=Math.min(lo,n);hi=Math.max(hi,n)}range=Math.max(range,hi-lo)}if(range>16)record(high,a,native.data,p)
  }
  results.push({candidate:candidate.name,changedPixels,alphaRegressionPixels,...finish(all),interior:finish(interior),highFrequency:finish(high)})
 }
 const row={fixture:e.fixture,name:e.name,operation:e.operation,width:w,height:h,sourceSHA:sha(source.data),nativeSHA:sha(native.data),affineIsotropicMinification:affine,results};rows.push(row);console.log(JSON.stringify({name:row.name,results:results.map(c=>({candidate:c.candidate,mae:c.rgbMAE,max:c.rgbMax,alphaMax:c.alphaMax}))}))
 await writeFile(directory+'/comparison.json',JSON.stringify({status:'DIAGNOSTIC',mode,productionModified:false,modelLimits:['Analytic kernels, geometry-only selection; no case-specific phase or geometry corrections','Old cohorts are regression data, not newly independent references','Current numerical accumulation is separately checked before production acceptance'],rows},null,2)+'\n')
}
