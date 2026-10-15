/** Research only: native field residuals, donor geometry, color space and boundary width.
 * The old wood sample was already opened after freeze; it is no longer a blind holdout.
 * No caller parameters are fitted here and no product source imports this script. */
import {readFile,writeFile} from 'node:fs/promises'
import {gunzipSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {healMembrane} from '../src/shared/native-membrane'
interface FieldResidual {space:string;donorShift:number[];interiorChannels:number;laplacianMae:number;laplacianRms:number;fieldGradientMae:number}
const sha=(v:Uint8Array)=>createHash('sha256').update(v).digest('hex')
const files=['photoshop-27.11-patch-natural-explicit-alpha26.json','photoshop-27.11-patch-natural-heldout-alpha26.json','photoshop-27.11-patch-synthetic-explicit-alpha26.json'],linear=(v:number)=>{v/=255;return 255*(v<=.04045?v/12.92:((v+.055)/1.055)**2.4)},encoded=(v:number)=>{v=Math.max(0,Math.min(1,v/255));return 255*(v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055)},reports=[]
for(const filename of files){
 const f=JSON.parse(await readFile('fixtures/parity/'+filename,'utf8')),src=gunzipSync(Buffer.from(f.sourceRGBA,'base64')),mask=gunzipSync(Buffer.from(f.coverage,'base64')),native=gunzipSync(Buffer.from(f.cases.find((sample:any)=>sample.diffusion===5).nativeRGBA,'base64')),W=f.width,H=f.height,[dx,dy]=f.operation.offset;let bx=W,by=H,ex=0,ey=0;for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(mask[y*W+x]){bx=Math.min(bx,x);by=Math.min(by,y);ex=Math.max(ex,x+1);ey=Math.max(ey,y+1)}
 const convert=(v:number,space:string)=>space==='linear-sRGB'?linear(v):v,sample=(x:number,y:number,c:number,space:string)=>{const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;let value=0;for(let j=0;j<2;j++)for(let i=0;i<2;i++){const xx=ix+i,yy=iy+j;if(xx>=0&&yy>=0&&xx<W&&yy<H)value+=convert(src[(yy*W+xx)*4+c],space)*(i?fx:1-fx)*(j?fy:1-fy)}return value},residuals:FieldResidual[]=[],candidates=[]
 for(const space of ['encoded-RGB8','linear-sRGB'])for(const sx of [-1,-.5,0,.5,1])for(const sy of [-1,-.5,0,.5,1]){let lap=0,lapSquared=0,n=0,gradient=0;const field=(x:number,y:number,c:number)=>convert(native[(y*W+x)*4+c],space)-sample(x+dx+sx,y+dy+sy,c,space)
  for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){const p=y*W+x;if([p,p-1,p+1,p-W,p+W].some(q=>mask[q]!==255))continue;for(let c=0;c<3;c++){const value=field(x,y,c),l=4*value-field(x-1,y,c)-field(x+1,y,c)-field(x,y-1,c)-field(x,y+1,c);lap+=Math.abs(l);lapSquared+=l*l;gradient+=Math.abs(value-field(x+1,y,c))+Math.abs(value-field(x,y+1,c));n++}}
  residuals.push({space,donorShift:[sx,sy],interiorChannels:n,laplacianMae:lap/n,laplacianRms:Math.sqrt(lapSquared/n),fieldGradientMae:gradient/(n*2)})
 }
 for(const space of ['encoded-RGB8','linear-sRGB'])for(const ring of [1,2])for(const solver of ['legacy-multigrid','converged-SOR']){
  const left=bx-ring,top=by-ring,w=ex-bx+ring*2,h=ey-by+ring*2,roles=new Uint8Array(w*h),value=new Float32Array(w*h*4),means=[0,0,0];let ringCount=0,work=0
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=(top+y)*W+left+x,q=y*w+x;if(mask[p]){roles[q]=2;continue}let near=false;for(let j=-ring;j<=ring&&!near;j++)for(let i=-ring;i<=ring;i++){const xx=x+i,yy=y+j;if(xx>=0&&yy>=0&&xx<w&&yy<h&&mask[(top+yy)*W+left+xx]){near=true;break}}if(near){roles[q]=1;ringCount++;for(let c=0;c<3;c++)means[c]+=value[q*4+c]=convert(src[p*4+c],space)-sample(left+x+dx,top+y+dy,c,space)}}
  for(let q=0;q<roles.length;q++)if(roles[q]===2)for(let c=0;c<3;c++)value[q*4+c]=means[c]/ringCount
  if(solver==='legacy-multigrid')healMembrane(value,roles,w,h,0,n=>{work+=n});else for(let it=0;it<512;it++){let maximum=0;work+=w*h;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=y*w+x;if(roles[p]!==2)continue;const neighbors=[x>0?p-1:-1,x+1<w?p+1:-1,y>0?p-w:-1,y+1<h?p+w:-1].filter(q=>q>=0&&roles[q]);for(let c=0;c<3;c++){const delta=1.8*(neighbors.reduce((sum,q)=>sum+value[q*4+c],0)/neighbors.length-value[p*4+c]);value[p*4+c]+=delta;maximum=Math.max(maximum,Math.abs(delta))}}if(maximum<.00001)break}
  let abs=0,n=0,max=0,outside=0,alpha=0,gradient=0,gradientN=0;const output=Uint8Array.from(src);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=(top+y)*W+left+x,q=y*w+x;if(!mask[p])continue;for(let c=0;c<3;c++){const tone=Math.max(0,Math.min(255,sample(left+x+dx,top+y+dy,c,space)+value[q*4+c])),mixed=convert(src[p*4+c],space)*(1-mask[p]/255)+tone*mask[p]/255;output[p*4+c]=Math.round(space==='linear-sRGB'?encoded(mixed):mixed)}}
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const p=y*W+x,at=p*4;if(!mask[p]&&[0,1,2,3].some(c=>output[at+c]!==src[at+c]))outside++;if(output[at+3]!==src[at+3])alpha++;if(mask[p])for(let c=0;c<3;c++){const d=Math.abs(output[at+c]-native[at+c]);abs+=d;n++;max=Math.max(max,d);for(const offset of [1,W])if(p+offset<mask.length&&mask[p]===255&&mask[p+offset]===255&&(offset!==1||x+1<W)){gradient+=Math.abs((output[(p+offset)*4+c]-output[at+c])-(native[(p+offset)*4+c]-native[at+c]));gradientN++}}}
  if(sha(src)!==f.sourceSha)throw Error('Diagnostic mutated frozen source bytes')
  candidates.push({space,ring,solver,work,mae:abs/n,max,gradientMae:gradient/gradientN,outside,alpha})
 }
 reports.push({filename,dataset:f.dataset,classification:f.classification,sourceSha:f.sourceSha,coverageSha:f.coverageSha,nativeDiffusion:5,geometryResiduals:residuals,zeroOffsetResiduals:residuals.filter(item=>item.donorShift.every(v=>v===0)),minimumResidualPerSpace:['encoded-RGB8','linear-sRGB'].map(space=>residuals.filter(item=>item.space===space).sort((a,b)=>a.laplacianMae-b.laplacianMae)[0]),candidates})
}
await writeFile('artifacts/photoshop-native/measurements/patch-alpha26/gradient-diagnostic.json',JSON.stringify(reports,null,2)+'\n');console.log(JSON.stringify(reports.map(({geometryResiduals,...rest})=>rest),null,2))
