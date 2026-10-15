/** Disclosed alpha26 corpus only. Bounded mathematical hypotheses, never imported by product. */
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {gunzipSync} from 'node:zlib'
import {healMembrane} from '../../src/shared/native-membrane'
interface Fixture {dataset:string;width:number;height:number;sourceRGBA:string;coverage:string;operation:{offset:[number,number]};cases:{diffusion:number;nativeRGBA:string}[]}
const legacyFiles=['natural-explicit','natural-heldout','synthetic-explicit','natural-third-independent','independent-irregular-aa','independent-irregular-feather4','independent-isolated-soft-peak'].map(v=>'fixtures/parity/photoshop-27.11-patch-'+v+'-alpha26.json')
const files=process.argv[2]==='holdout'?['slanted-aa','curved-polygon-aa','slanted-feather2','slanted-feather6','lowpeak6-feather8','lowpeak14-feather8'].map(v=>'fixtures/parity/photoshop-27.11-patch-soft-holdout-'+v+'-alpha27.json'):legacyFiles
const reports=[]
for(const file of files){
 const f=JSON.parse(await readFile(file,'utf8')) as Fixture,src=Uint8Array.from(gunzipSync(Buffer.from(f.sourceRGBA,'base64'))),mask=Uint8Array.from(gunzipSync(Buffer.from(f.coverage,'base64'))),sample=f.cases.find(v=>v.diffusion===5)!,native=gunzipSync(Buffer.from(sample.nativeRGBA,'base64')),W=f.width,H=f.height,[dx,dy]=f.operation.offset
 let left=W,top=H,right=0,bottom=0,coreLeft=W,coreTop=H,coreRight=0,coreBottom=0,sharp=true
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){const p=y*W+x;if(mask[p]){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1)}if(mask[p]>=128){coreLeft=Math.min(coreLeft,x);coreTop=Math.min(coreTop,y);coreRight=Math.max(coreRight,x+1);coreBottom=Math.max(coreBottom,y+1)}else if(mask[p]){let near=false;for(let j=-1;j<=1&&!near;j++)for(let i=-1;i<=1;i++){const xx=x+i,yy=y+j;if(xx>=0&&yy>=0&&xx<W&&yy<H&&mask[yy*W+xx]>=128)near=true}if(!near)sharp=false}}
 left=Math.max(0,left-2);top=Math.max(0,top-2);right=Math.min(W,right+2);bottom=Math.min(H,bottom+2);const w=right-left,h=bottom-top,hasCore=coreRight>coreLeft,models=[]
 for(const model of ['legacy','current','raw-no-core','core-neumann-tail','rect-core-clamped-tail','core-all-mask']){
  const threshold=model==='legacy'||model==='raw-no-core'||model==='current'&&!sharp?1:128,value=new Float32Array(w*h*4),roles=new Uint8Array(w*h),means=[0,0,0];let ringCount=0,work=0
  const selected=(x:number,y:number)=>model==='rect-core-clamped-tail'?x+left>=coreLeft&&x+left<coreRight&&y+top>=coreTop&&y+top<coreBottom:mask[(y+top)*W+x+left]>=threshold
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=(y+top)*W+x+left,q=y*w+x;if(selected(x,y)){roles[q]=2;continue}let near=false;for(let j=-2;j<=2&&!near;j++)for(let i=-2;i<=2;i++){const xx=x+i,yy=y+j;if(xx>=0&&yy>=0&&xx<w&&yy<h&&selected(xx,yy))near=true}if(near){roles[q]=1;ringCount++;const donor=((y+top+dy)*W+x+left+dx)*4;for(let c=0;c<3;c++)means[c]+=value[q*4+c]=src[p*4+c]-src[donor+c]}}
  if(ringCount&&hasCore||ringCount&&(model==='legacy'||model==='current')){for(let q=0;q<roles.length;q++)if(roles[q]===2)for(let c=0;c<3;c++)value[q*4+c]=means[c]/ringCount;healMembrane(value,roles,w,h,0,n=>{work+=n})}
  if(model==='core-neumann-tail'&&hasCore){const extensionRoles=new Uint8Array(w*h);for(let q=0;q<roles.length;q++){const p=(Math.floor(q/w)+top)*W+q%w+left;if(mask[p]>=128)extensionRoles[q]=1;else if(mask[p]){extensionRoles[q]=2;for(let c=0;c<3;c++)value[q*4+c]=means[c]/Math.max(1,ringCount)}}healMembrane(value,extensionRoles,w,h,0,n=>{work+=n})}
  const product=Uint8Array.from(src);let sum=0,max=0,channels=0,changed=0,nativeChanged=0
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=(y+top)*W+x+left,q=y*w+x;if(!mask[p])continue;const source=((y+top+dy)*W+x+left+dx)*4,at=p*4
   const oldSoft=model==='legacy'||model==='current'&&!sharp||model==='raw-no-core',edit=!sharp||mask[p]>=128||oldSoft
   if(edit)for(let c=0;c<3;c++){let tone=0;if(hasCore||model==='legacy'||model==='current'){if(model==='rect-core-clamped-tail'){const xx=Math.max(coreLeft,Math.min(coreRight-1,x+left))-left,yy=Math.max(coreTop,Math.min(coreBottom-1,y+top))-top;tone=value[(yy*w+xx)*4+c]}else tone=value[q*4+c]}product[at+c]=Math.round(src[at+c]*(1-mask[p]/255)+Math.max(0,Math.min(255,src[source+c]+tone))*mask[p]/255)}
  }
  for(let p=0;p<mask.length;p++){if([0,1,2].some(c=>product[p*4+c]!==src[p*4+c]))changed++;if([0,1,2].some(c=>native[p*4+c]!==src[p*4+c]))nativeChanged++;if(mask[p])for(let c=0;c<3;c++){const d=Math.abs(product[p*4+c]-native[p*4+c]);sum+=d;max=Math.max(max,d);channels++}}
  models.push({model,mae:sum/channels,max,changed,nativeChanged,work})
 }
 reports.push({dataset:f.dataset,classification:process.argv[2]==='holdout'?'Independent soft-v1 frozen hypothesis; no retuning after disclosure':'Previously disclosed alpha26 samples; research only, no independent outcome claim',sharp,hasCore,models})
}
await mkdir('artifacts/alpha27',{recursive:true});await writeFile('artifacts/alpha27/patch-soft-domain-'+(process.argv[2]==='holdout'?'holdout':'diagnostic')+'.json',JSON.stringify(reports,null,2)+'\n');console.log(JSON.stringify(reports,null,2))
