import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {gunzipSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {blendSampledHealing,sampleHealingDonor} from './patch-tail-model-alpha28'
interface Fixture {dataset:string;width:number;height:number;sourceSha:string;sourceRGBA:string;coverage:string;operation:{offset:[number,number]};cases:{diffusion:number;nativeRGBA:string}[]}
const oldFiles=['natural-explicit','natural-heldout','synthetic-explicit','natural-third-independent','independent-irregular-aa','independent-irregular-feather4','independent-isolated-soft-peak'].map(v=>'fixtures/parity/photoshop-27.11-patch-'+v+'-alpha26.json'),lastFiles=['slanted-aa','curved-polygon-aa','slanted-feather2','slanted-feather6','lowpeak6-feather8','lowpeak14-feather8'].map(v=>'fixtures/parity/photoshop-27.11-patch-soft-holdout-'+v+'-alpha27.json'),reports=[]
for(const file of [...oldFiles,...lastFiles]){
 const f=JSON.parse(await readFile(file,'utf8')) as Fixture,src=Uint8Array.from(gunzipSync(Buffer.from(f.sourceRGBA,'base64'))),mask=Uint8Array.from(gunzipSync(Buffer.from(f.coverage,'base64'))),native=gunzipSync(Buffer.from(f.cases.find(v=>v.diffusion===5)!.nativeRGBA,'base64')),W=f.width,H=f.height,[dx,dy]=f.operation.offset,donor=new Float32Array(src.length)
 let sharp=true;for(let y=0;y<H;y++)for(let x=0;x<W;x++){const p=y*W+x;donor.set(sampleHealingDonor(src,W,H,x+.5+dx,y+.5+dy),p*4);if(mask[p]>0&&mask[p]<128){let near=false;for(let j=-1;j<=1&&!near;j++)for(let i=-1;i<=1;i++){const xx=x+i,yy=y+j;if(xx>=0&&yy>=0&&xx<W&&yy<H&&mask[yy*W+xx]>=128)near=true}if(!near)sharp=false}}
 const models=[]
 for(const boundary of ['neumann'] as const)for(const tailContinuation of ['plane','normal-gradient'] as const){
  const actual=blendSampledHealing(src,donor,mask,W,H,{selectionCoreThreshold:128,selectionSoftTail:!sharp,tailBoundary:boundary,tailContinuation}),model=tailContinuation;let error=0,max=0,n=0,changed=0,nativeChanged=0,extra=0,missing=0,weakExtra=0,weakMissing=0,outside=0,alpha=0,weakError=0,weakN=0
  for(let p=0;p<mask.length;p++){const changedProduct=[0,1,2,3].some(c=>actual[p*4+c]!==src[p*4+c]),changedNative=[0,1,2,3].some(c=>native[p*4+c]!==src[p*4+c]);if(changedProduct){changed++;if(!mask[p])outside++;if(!changedNative){extra++;if(mask[p]>0&&mask[p]<128)weakExtra++}}if(changedNative){nativeChanged++;if(!changedProduct){missing++;if(mask[p]>0&&mask[p]<128)weakMissing++}}if(actual[p*4+3]!==src[p*4+3])alpha++;if(mask[p])for(let c=0;c<3;c++){const d=Math.abs(actual[p*4+c]-native[p*4+c]);error+=d;max=Math.max(max,d);n++;if(mask[p]<128){weakError+=d;weakN++}}}
  models.push({model,mae:error/n,max,weakMae:weakError/weakN,changed,nativeChanged,extra,missing,weakExtra,weakMissing,outside,alpha})
 }
 if(createHash('sha256').update(src).digest('hex')!==f.sourceSha)throw Error('Frozen input mutated')
 reports.push({dataset:f.dataset,classification:'All alpha26/27 datasets already disclosed: research only, no independent parity claim',sharp,models})
}
await mkdir('artifacts/alpha28-patch',{recursive:true});await writeFile('artifacts/alpha28-patch/tail-continuation-diagnostic.json',JSON.stringify(reports,null,2)+'\n');console.log(JSON.stringify(reports,null,2))
