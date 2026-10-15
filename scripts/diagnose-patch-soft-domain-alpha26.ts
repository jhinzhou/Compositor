/** Independent diagnostic of soft-selection boundaries; never imported by product. */
import {readFile,writeFile} from 'node:fs/promises'
import {gunzipSync} from 'node:zlib'
import {healMembrane} from '../src/shared/native-membrane'
const reports:unknown[]=[];for(const filename of ['photoshop-27.11-patch-natural-explicit-alpha26.json','photoshop-27.11-patch-natural-heldout-alpha26.json','photoshop-27.11-patch-synthetic-explicit-alpha26.json']){
const f=JSON.parse(await readFile('fixtures/parity/'+filename,'utf8')),src=gunzipSync(Buffer.from(f.sourceRGBA,'base64')),mask=gunzipSync(Buffer.from(f.coverage,'base64')),W=f.width,H=f.height,[dx,dy]=f.operation.offset,results:unknown[]=[];let left=W,top=H,right=0,bottom=0
for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(mask[y*W+x]){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1)}left-=2;top-=2;right+=2;bottom+=2;const w=right-left,h=bottom-top
for(const threshold of [1,32,64,128,192,255]){
 const value=new Float32Array(w*h*4),roles=new Uint8Array(w*h),mean=[0,0,0];let ring=0,work=0
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=(top+y)*W+left+x,q=y*w+x;if(mask[p]>=threshold){roles[q]=2;continue}let near=false;for(let j=-2;j<=2&&!near;j++)for(let i=-2;i<=2;i++){const xx=x+i,yy=y+j;if(xx>=0&&yy>=0&&xx<w&&yy<h&&mask[(top+yy)*W+left+xx]>=threshold){near=true;break}}if(near){roles[q]=1;ring++;const at=p*4,donor=((top+y+dy)*W+left+x+dx)*4;for(let c=0;c<3;c++)mean[c]+=value[q*4+c]=src[at+c]-src[donor+c]}}
 for(let q=0;q<roles.length;q++)if(roles[q]===2)for(let c=0;c<3;c++)value[q*4+c]=mean[c]/ring
 healMembrane(value,roles,w,h,0,n=>{work+=n});
 const product=Uint8Array.from(src);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=(top+y)*W+left+x,q=y*w+x;if(!mask[p]||roles[q]!==2)continue;const at=p*4,donor=((top+y+dy)*W+left+x+dx)*4;for(let c=0;c<3;c++)product[at+c]=Math.round(src[at+c]*(1-mask[p]/255)+Math.max(0,Math.min(255,src[donor+c]+value[q*4+c]))*mask[p]/255)}
 const measurements=[];for(const sample of f.cases){const native=gunzipSync(Buffer.from(sample.nativeRGBA,'base64'));let abs=0,count=0,max=0;for(let p=0;p<mask.length;p++)if(mask[p])for(let c=0;c<3;c++){const d=Math.abs(product[p*4+c]-native[p*4+c]);abs+=d;count++;max=Math.max(max,d)}measurements.push({diffusion:sample.diffusion,mae:abs/count,max})}results.push({threshold,work,measurements})
}
reports.push({filename,dataset:f.dataset,classification:'All three datasets now disclosed; research, not independent holdout',results})}
await writeFile('artifacts/photoshop-native/measurements/patch-alpha26/soft-domain-diagnostic.json',JSON.stringify(reports,null,2)+'\n');console.log(JSON.stringify(reports,null,2))
