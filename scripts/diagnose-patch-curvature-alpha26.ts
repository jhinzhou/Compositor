/** Diagnostic only; bounded clamped biharmonic correction against existing synthetic oracles. */
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {inflateSync} from 'node:zlib'
const f=JSON.parse(await readFile('fixtures/parity/photoshop-27.11-patch-alpha25.json','utf8')),src=inflateSync(Buffer.from(f.sourceRGBA,'base64')),results=[]
for(const item of f.cases){const [left,top,w,h]=item.operation.selection,[dx,dy]=item.operation.offset,W=w+4,H=h+4,field=new Float64Array(W*H*3),source=new Float64Array(W*H*3),native=inflateSync(Buffer.from(item.nativeRGBA,'base64')),holes=[] as number[],lookup=new Int32Array(W*H).fill(-1),mean=[0,0,0];let ring=0
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){const q=y*W+x,at=((top+y-2)*f.width+left+x-2)*4,donor=((top+y-2+dy)*f.width+left+x-2+dx)*4;for(let c=0;c<3;c++){source[q*3+c]=src[donor+c];field[q*3+c]=src[at+c]-src[donor+c];if(x<2||y<2||x>=W-2||y>=H-2)mean[c]+=field[q*3+c]}if(x<2||y<2||x>=W-2||y>=H-2)ring++;else{lookup[q]=holes.length;holes.push(q)}}
 for(const p of holes)for(let c=0;c<3;c++)field[p*3+c]=mean[c]/ring
 for(let it=0;it<512;it++)for(const p of holes)for(let c=0;c<3;c++)field[p*3+c]+=1.8*((field[(p-1)*3+c]+field[(p+1)*3+c]+field[(p-W)*3+c]+field[(p+W)*3+c])/4-field[p*3+c])
 const harmonic=field.slice(),stencil:[[number,number],...Array<[number,number]>]=[[0,20],[-1,-8],[1,-8],[-W,-8],[W,-8],[-W-1,2],[-W+1,2],[W-1,2],[W+1,2],[-2,1],[2,1],[-W*2,1],[W*2,1]],N=holes.length
 const multiply=(v:Float64Array,out:Float64Array)=>{for(let i=0;i<N;i++){let value=0;for(const [offset,weight] of stencil){const j=lookup[holes[i]+offset];if(j>=0)value+=weight*v[j]}out[i]=value}},channels=[]
 for(let c=0;c<3;c++){const x=Float64Array.from(holes,p=>field[p*3+c]),b=new Float64Array(N),r=new Float64Array(N),p=new Float64Array(N),ap=new Float64Array(N);for(let i=0;i<N;i++)for(const [offset,weight] of stencil)if(lookup[holes[i]+offset]<0)b[i]-=weight*field[(holes[i]+offset)*3+c];multiply(x,ap);for(let i=0;i<N;i++)p[i]=r[i]=b[i]-ap[i];let rr=r.reduce((s,v)=>s+v*v,0),iteration=0
  for(;iteration<1024&&rr>1e-10;iteration++){multiply(p,ap);const pAp=p.reduce((s,v,i)=>s+v*ap[i],0);if(pAp<=0)throw Error('Curvature matrix must be positive');const step=rr/pAp;for(let i=0;i<N;i++){x[i]+=step*p[i];r[i]-=step*ap[i]}const next=r.reduce((s,v)=>s+v*v,0),beta=next/rr;for(let i=0;i<N;i++)p[i]=r[i]+beta*p[i];rr=next}channels.push({channel:c,iteration,residual:rr});for(let i=0;i<N;i++)field[holes[i]*3+c]=x[i]
 }
 const candidates=[]
 for(const amount of [0,.25,.5,2/3,.75,1]){let abs=0,max=0;for(const p of holes){const x=p%W+left-2,y=Math.floor(p/W)+top-2,at=(y*f.width+x)*4;for(let c=0;c<3;c++){const v=Math.round(Math.max(0,Math.min(255,source[p*3+c]+harmonic[p*3+c]*(1-amount)+field[p*3+c]*amount))),delta=Math.abs(v-native[at+c]);abs+=delta;max=Math.max(max,delta)}}candidates.push({biharmonicAmount:amount,mae:abs/(N*3),max})}
 results.push({id:item.id,channels,candidates})
}
await mkdir('artifacts/photoshop-native/measurements/patch-alpha26',{recursive:true});await writeFile('artifacts/photoshop-native/measurements/patch-alpha26/curvature.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2))
