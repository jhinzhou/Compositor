/** Diagnostic only: compare scalar initial-condition and finite-diffusion hypotheses.
 * No production edits, Adobe parameter mapping, fixture edits or fitted constants. */
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {inflateSync} from 'node:zlib'
const f=JSON.parse(await readFile('fixtures/parity/photoshop-27.11-patch-alpha25.json','utf8')),src=inflateSync(Buffer.from(f.sourceRGBA,'base64')),reports=[]
for(const sample of f.cases){const native=inflateSync(Buffer.from(sample.nativeRGBA,'base64')),[left,top,w,h]=sample.operation.selection, [dx,dy]=sample.operation.offset,W=w+4,H=h+4,candidates=[]
 for(const initial of ['boundary-mean','destination-difference'] as const)for(const sor of [1,1.4,1.8,1.95]){
  const field=new Float64Array(W*H*3),donor=new Float64Array(W*H*3),mean=[0,0,0];let count=0
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const p=y*W+x,at=((top+y-2)*f.width+left+x-2)*4,sa=((top+y-2+dy)*f.width+left+x-2+dx)*4,ring=x<2||x>=W-2||y<2||y>=H-2;for(let c=0;c<3;c++){donor[p*3+c]=src[sa+c];field[p*3+c]=src[at+c]-src[sa+c];if(ring)mean[c]+=field[p*3+c]}if(ring)count++}
  if(initial==='boundary-mean')for(let y=2;y<H-2;y++)for(let x=2;x<W-2;x++)for(let c=0;c<3;c++)field[(y*W+x)*3+c]=mean[c]/count
  const checkpoints=new Set([0,1,2,4,8,12,16,24,32,48,64,128,256,512])
  for(let iteration=0;iteration<=512;iteration++){
   if(checkpoints.has(iteration)){let abs=0,max=0;for(let y=2;y<H-2;y++)for(let x=2;x<W-2;x++){const p=y*W+x,at=((top+y-2)*f.width+left+x-2)*4;for(let c=0;c<3;c++){const v=Math.round(Math.max(0,Math.min(255,donor[p*3+c]+field[p*3+c]))),d=Math.abs(v-native[at+c]);abs+=d;max=Math.max(max,d)}}candidates.push({initial,sor,iteration,mae:abs/(w*h*3),max})}
   for(let y=2;y<H-2;y++)for(let x=2;x<W-2;x++){const p=y*W+x;for(let c=0;c<3;c++)field[p*3+c]+=sor*((field[(p-1)*3+c]+field[(p+1)*3+c]+field[(p-W)*3+c]+field[(p+W)*3+c])/4-field[p*3+c])}
  }
 }
 candidates.sort((a,b)=>a.mae-b.mae);reports.push({id:sample.id,best:candidates.slice(0,15),limitation:'Exploratory scalar finite-diffusion sweep; a best row is not an Adobe Diffusion mapping or independent evidence.'})
}
await mkdir('artifacts/photoshop-native/measurements/patch-alpha26',{recursive:true});await writeFile('artifacts/photoshop-native/measurements/patch-alpha26/initial-conditions.json',JSON.stringify(reports,null,2));console.log(JSON.stringify(reports,null,2))
