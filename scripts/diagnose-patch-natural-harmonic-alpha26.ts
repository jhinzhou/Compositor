/** Research only: distinguish solver convergence from selection-mask boundary semantics. */
import {readFile,writeFile} from 'node:fs/promises'
import {gunzipSync} from 'node:zlib'
const f=JSON.parse(await readFile('fixtures/parity/photoshop-27.11-patch-natural-alpha26.json','utf8')),src=gunzipSync(Buffer.from(f.sourceRGBA,'base64')),mask=gunzipSync(Buffer.from(f.coverage,'base64')),native=gunzipSync(Buffer.from(f.cases[0].nativeRGBA,'base64')),w=f.width,h=f.height,[dx,dy]=f.operation.offset,results=[]
for(const threshold of [1,128,255]){
 const field=new Float64Array(w*h*3),hole=new Uint8Array(w*h),means=[0,0,0];let ring=0
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=y*w+x;if(mask[p]>=threshold){hole[p]=1;continue}if(![-w,w,-1,1].some(d=>p+d>=0&&p+d<mask.length&&mask[p+d]>=threshold))continue;const donor=((y+dy)*w+x+dx)*4;if(x+dx<0||x+dx>=w||y+dy<0||y+dy>=h)continue;ring++;for(let c=0;c<3;c++)means[c]+=field[p*3+c]=src[p*4+c]-src[donor+c]}
 for(let p=0;p<hole.length;p++)if(hole[p])for(let c=0;c<3;c++)field[p*3+c]=means[c]/ring
 for(let it=0;it<=320;it++){
  if([0,8,16,24,40,80,160,320].includes(it)){let abs=0,count=0,max=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=y*w+x;if(!mask[p])continue;const at=p*4,donor=((y+dy)*w+x+dx)*4;for(let c=0;c<3;c++){const correction=hole[p]?field[p*3+c]:src[at+c]-src[donor+c],out=Math.round(src[at+c]*(1-mask[p]/255)+(src[donor+c]+correction)*mask[p]/255),delta=Math.abs(out-native[at+c]);abs+=delta;count++;max=Math.max(max,delta)}}results.push({threshold,iterations:it,mae:abs/count,max})}
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const p=y*w+x;if(!hole[p])continue;for(let c=0;c<3;c++)field[p*3+c]+=1.8*((field[(p-1)*3+c]+field[(p+1)*3+c]+field[(p-w)*3+c]+field[(p+w)*3+c])/4-field[p*3+c])}
 }
}
await writeFile('artifacts/photoshop-native/measurements/patch-alpha26/natural-harmonic-diagnostic.json',JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results,null,2))
