/** Disclosed alpha26 corpus only. Bounded mathematical hypotheses, never imported by product. */
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {gunzipSync} from 'node:zlib'
// Compositor HealPixels.c membrane port; MIT notice: licenses/Compositor-MIT.txt.
const OUTSIDE=0,RING=1,HOLE=2,F=Math.fround
function membrane(value:Float32Array,role:Uint8Array,w:number,h:number,bilinear:boolean,depth=0,charge?:(work:number)=>void):void {
 let iterations=300
 if(w>32&&h>32&&depth<16){const cw=Math.ceil(w/2),ch=Math.ceil(h/2),coarse=new Float32Array(cw*ch*4),coarseRole=new Uint8Array(cw*ch)
  for(let y=0;y<ch;y++)for(let x=0;x<cw;x++){let known=0,hole=0;const ks=new Float32Array(4),hs=new Float32Array(4);for(let j=0;j<2;j++)for(let i=0;i<2;i++){const fx=x*2+i,fy=y*2+j;if(fx>=w||fy>=h)continue;const p=fy*w+fx;if(role[p]===RING){known++;for(let c=0;c<4;c++)ks[c]+=value[p*4+c]}else if(role[p]===HOLE){hole++;for(let c=0;c<4;c++)hs[c]+=value[p*4+c]}}
   const q=y*cw+x;if(known){coarseRole[q]=RING;for(let c=0;c<4;c++)coarse[q*4+c]=ks[c]/known}else if(hole){coarseRole[q]=HOLE;for(let c=0;c<4;c++)coarse[q*4+c]=hs[c]/hole}}
  membrane(coarse,coarseRole,cw,ch,bilinear,depth+1,charge);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=y*w+x,q=Math.floor(y/2)*cw+Math.floor(x/2);if(role[p]===HOLE){if(!bilinear){if(coarseRole[q]===HOLE)for(let c=0;c<4;c++)value[p*4+c]=coarse[q*4+c]}else{const xx=(x+.5)/2-.5,yy=(y+.5)/2-.5,x0=Math.floor(xx),y0=Math.floor(yy),fx=xx-x0,fy=yy-y0;for(let c=0;c<4;c++){let sum=0,weight=0;for(let j=0;j<2;j++)for(let i=0;i<2;i++){const cx=Math.max(0,Math.min(cw-1,x0+i)),cy=Math.max(0,Math.min(ch-1,y0+j)),cp=cy*cw+cx;if(!coarseRole[cp])continue;const a=(i?fx:1-fx)*(j?fy:1-fy);sum+=coarse[cp*4+c]*a;weight+=a}if(weight)value[p*4+c]=sum/weight}}}}iterations=40
 }
 const sum=new Float32Array(4)
 for(let it=0;it<iterations;it++){charge?.(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=y*w+x;if(role[p]!==HOLE)continue;sum.fill(0);let n=0;for(const [nx,ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){if(nx<0||ny<0||nx>=w||ny>=h)continue;const q=ny*w+nx;if(role[q]===OUTSIDE)continue;for(let c=0;c<4;c++)sum[c]+=value[q*4+c];n++}if(n)for(let c=0;c<4;c++)value[p*4+c]+=F(F(1.8)*F(F(sum[c]/n)-value[p*4+c]))}
}
}

interface Fixture {dataset:string;width:number;height:number;sourceRGBA:string;coverage:string;operation:{offset:[number,number]};cases:{diffusion:number;nativeRGBA:string}[]}
const legacyFiles=['natural-explicit','natural-heldout','synthetic-explicit','natural-third-independent','independent-irregular-aa','independent-irregular-feather4','independent-isolated-soft-peak'].map(v=>'fixtures/parity/photoshop-27.11-patch-'+v+'-alpha26.json')
const files=legacyFiles.filter(v=>!v.includes('feather4')&&!v.includes('soft-peak'))
const reports=[]
for(const file of files){
 const f=JSON.parse(await readFile(file,'utf8')) as Fixture,src=Uint8Array.from(gunzipSync(Buffer.from(f.sourceRGBA,'base64'))),mask=Uint8Array.from(gunzipSync(Buffer.from(f.coverage,'base64'))),sample=f.cases.find(v=>v.diffusion===5)!,native=gunzipSync(Buffer.from(sample.nativeRGBA,'base64')),W=f.width,H=f.height,[dx,dy]=f.operation.offset
 let left=W,top=H,right=0,bottom=0,coreLeft=W,coreTop=H,coreRight=0,coreBottom=0,sharp=true
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){const p=y*W+x;if(mask[p]){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1)}if(mask[p]>=128){coreLeft=Math.min(coreLeft,x);coreTop=Math.min(coreTop,y);coreRight=Math.max(coreRight,x+1);coreBottom=Math.max(coreBottom,y+1)}else if(mask[p]){let near=false;for(let j=-1;j<=1&&!near;j++)for(let i=-1;i<=1;i++){const xx=x+i,yy=y+j;if(xx>=0&&yy>=0&&xx<W&&yy<H&&mask[yy*W+xx]>=128)near=true}if(!near)sharp=false}}
 left=Math.max(0,left-2);top=Math.max(0,top-2);right=Math.min(W,right+2);bottom=Math.min(H,bottom+2);const outerLeft=left,outerTop=top,outerRight=right,outerBottom=bottom,hasCore=coreRight>coreLeft,models=[]
 for(const model of ['mask-box-nearest','mask-box-bilinear','core-box-nearest','core-box-bilinear']){
  const L=model.startsWith('core-box')?Math.max(0,coreLeft-2):outerLeft,T=model.startsWith('core-box')?Math.max(0,coreTop-2):outerTop,R=model.startsWith('core-box')?Math.min(W,coreRight+2):outerRight,B=model.startsWith('core-box')?Math.min(H,coreBottom+2):outerBottom;const left=L,top=T,w=R-L,h=B-T;const threshold=128,value=new Float32Array(w*h*4),roles=new Uint8Array(w*h),means=[0,0,0];let ringCount=0,work=0
  const selected=(x:number,y:number)=>model==='rect-core-clamped-tail'?x+left>=coreLeft&&x+left<coreRight&&y+top>=coreTop&&y+top<coreBottom:mask[(y+top)*W+x+left]>=threshold
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=(y+top)*W+x+left,q=y*w+x;if(selected(x,y)){roles[q]=2;continue}let near=false;for(let j=-2;j<=2&&!near;j++)for(let i=-2;i<=2;i++){const xx=x+i,yy=y+j;if(xx>=0&&yy>=0&&xx<w&&yy<h&&selected(xx,yy))near=true}if(near){roles[q]=1;ringCount++;const donor=((y+top+dy)*W+x+left+dx)*4;for(let c=0;c<3;c++)means[c]+=value[q*4+c]=src[p*4+c]-src[donor+c]}}
  if(ringCount&&hasCore||ringCount&&(model==='legacy'||model==='current')){for(let q=0;q<roles.length;q++)if(roles[q]===2)for(let c=0;c<3;c++)value[q*4+c]=means[c]/ringCount;membrane(value,roles,w,h,model.endsWith('bilinear'),0,n=>{work+=n})}
  if(model==='core-neumann-tail'&&hasCore){const extensionRoles=new Uint8Array(w*h);for(let q=0;q<roles.length;q++){const p=(Math.floor(q/w)+top)*W+q%w+left;if(mask[p]>=128)extensionRoles[q]=1;else if(mask[p]){extensionRoles[q]=2;for(let c=0;c<3;c++)value[q*4+c]=means[c]/Math.max(1,ringCount)}}membrane(value,extensionRoles,w,h,model.endsWith('bilinear'),0,n=>{work+=n})}
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
await mkdir('artifacts/alpha27',{recursive:true});await writeFile('artifacts/alpha27/patch-aa-multigrid-diagnostic.json',JSON.stringify(reports,null,2)+'\n');console.log(JSON.stringify(reports,null,2))
