/** Diagnostic only: additive vs relative-contrast harmonic transfer; no production parameter fit. */
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {inflateSync} from 'node:zlib'
import {healMembrane} from '../src/shared/native-membrane'
const fixture=JSON.parse(await readFile('fixtures/parity/photoshop-27.11-patch-alpha25.json','utf8')),original=inflateSync(Buffer.from(fixture.sourceRGBA,'base64')),reports=[]
for(const sample of fixture.cases){const [left,top,w,h]=sample.operation.selection,[dx,dy]=sample.operation.offset,W=w+4,H=h+4,roles=new Uint8Array(W*H),source=new Float32Array(W*H*4),native=inflateSync(Buffer.from(sample.nativeRGBA,'base64')),cases=[]
 for(const model of ['additive','log-ratio'] as const){const values=new Float32Array(W*H*4),mean=[0,0,0];let count=0
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const q=y*W+x,at=((top+y-2)*fixture.width+left+x-2)*4,donor=((top+y-2+dy)*fixture.width+left+x-2+dx)*4,ring=x<2||y<2||x>=W-2||y>=H-2;roles[q]=ring?1:2;for(let c=0;c<3;c++){source[q*4+c]=original[donor+c];values[q*4+c]=model==='additive'?original[at+c]-original[donor+c]:Math.log((original[at+c]+1)/(original[donor+c]+1));if(ring)mean[c]+=values[q*4+c]}if(ring)count++}
  for(let q=0;q<roles.length;q++)if(roles[q]===2)for(let c=0;c<3;c++)values[q*4+c]=mean[c]/count;healMembrane(values,roles,W,H)
  let absolute=0,max=0;for(let y=2;y<H-2;y++)for(let x=2;x<W-2;x++){const q=y*W+x,at=((top+y-2)*fixture.width+left+x-2)*4;for(let c=0;c<3;c++){const color=model==='additive'?source[q*4+c]+values[q*4+c]:(source[q*4+c]+1)*Math.exp(values[q*4+c])-1,delta=Math.abs(Math.round(Math.max(0,Math.min(255,color)))-native[at+c]);absolute+=delta;max=Math.max(max,delta)}}cases.push({model,mae:absolute/(w*h*3),max})
 }
 reports.push({id:sample.id,cases})
}
await mkdir('artifacts/photoshop-native/measurements/patch-alpha26',{recursive:true});await writeFile('artifacts/photoshop-native/measurements/patch-alpha26/luminance.json',JSON.stringify(reports,null,2));console.log(JSON.stringify(reports,null,2))
