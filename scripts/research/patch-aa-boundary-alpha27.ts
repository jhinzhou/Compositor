/** Alpha26 disclosed sharp-AA datasets only; checks subpixel Dirichlet hypotheses. */
import {readFile,writeFile} from 'node:fs/promises'
import {gunzipSync} from 'node:zlib'
interface Fixture {dataset:string;width:number;height:number;sourceRGBA:string;coverage:string;operation:{offset:[number,number]};cases:{diffusion:number;nativeRGBA:string}[]}
const files=['natural-explicit','natural-heldout','synthetic-explicit','natural-third-independent','independent-irregular-aa'].map(v=>'fixtures/parity/photoshop-27.11-patch-'+v+'-alpha26.json'),reports=[]
for(const file of files){
 const f=JSON.parse(await readFile(file,'utf8')) as Fixture,src=Uint8Array.from(gunzipSync(Buffer.from(f.sourceRGBA,'base64'))),mask=Uint8Array.from(gunzipSync(Buffer.from(f.coverage,'base64'))),native=gunzipSync(Buffer.from(f.cases.find(v=>v.diffusion===5)!.nativeRGBA,'base64')),W=f.width,H=f.height,[dx,dy]=f.operation.offset
 let left=W,top=H,right=0,bottom=0;for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(mask[y*W+x]>=128){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1)}left--;top--;right++;bottom++;const w=right-left,h=bottom-top,models=[]
 const difference=(x:number,y:number,c:number)=>src[(y*W+x)*4+c]-src[((y+dy)*W+x+dx)*4+c]
 for(const model of ['converged-center','boundary-midpoint','boundary-coverage','boundary-coverage-center-value']){
  const field=new Float64Array(w*h*3),hole=new Uint8Array(w*h);let mean=[0,0,0],n=0
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=(y+top)*W+x+left,q=y*w+x;hole[q]=mask[p]>=128?1:0;if(!hole[q]){for(let c=0;c<3;c++)mean[c]+=field[q*3+c]=difference(x+left,y+top,c);n++}}
  for(let q=0;q<hole.length;q++)if(hole[q])for(let c=0;c<3;c++)field[q*3+c]=mean[c]/n
  let iterations=0
  for(;iterations<1000;iterations++){let maxDelta=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const q=y*w+x,p=(y+top)*W+x+left;if(!hole[q])continue;for(let c=0;c<3;c++){let sum=0,weights=0;for(const [nx,ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){if(nx<0||ny<0||nx>=w||ny>=h)continue;const z=ny*w+nx,r=(ny+top)*W+nx+left;if(hole[z]){sum+=field[z*3+c];weights++;continue}const t=model==='boundary-midpoint'?.5:model==='converged-center'?1:Math.max(.01,(mask[p]-127.5)/(mask[p]-mask[r])),boundary=model==='converged-center'||model==='boundary-coverage-center-value'?field[z*3+c]:difference(x+left,y+top,c)*(1-t)+field[z*3+c]*t;sum+=boundary/t;weights+=1/t}const delta=1.6*(sum/weights-field[q*3+c]);field[q*3+c]+=delta;maxDelta=Math.max(maxDelta,Math.abs(delta))}}if(maxDelta<.000001)break}
  const product=Uint8Array.from(src);let sum=0,max=0,channels=0,changed=0
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const q=y*w+x,p=(y+top)*W+x+left;if(!hole[q])continue;for(let c=0;c<3;c++){const donor=src[((y+top+dy)*W+x+left+dx)*4+c],color=Math.max(0,Math.min(255,donor+field[q*3+c]));product[p*4+c]=Math.round(src[p*4+c]*(1-mask[p]/255)+color*mask[p]/255)}}
  for(let p=0;p<mask.length;p++){if([0,1,2].some(c=>product[p*4+c]!==src[p*4+c]))changed++;if(mask[p])for(let c=0;c<3;c++){const d=Math.abs(product[p*4+c]-native[p*4+c]);sum+=d;max=Math.max(max,d);channels++}}models.push({model,mae:sum/channels,max,changed,iterations})
 }
 reports.push({dataset:f.dataset,classification:'Disclosed alpha26 research only',models})
}
await writeFile('artifacts/alpha27/patch-aa-boundary-diagnostic.json',JSON.stringify(reports,null,2)+'\n');console.log(JSON.stringify(reports,null,2))
