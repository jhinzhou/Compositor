import {readFile,writeFile} from 'node:fs/promises'
import {gunzipSync} from 'node:zlib'
const f=JSON.parse(await readFile('fixtures/parity/photoshop-27.11-patch-natural-explicit-alpha26.json','utf8')),src=gunzipSync(Buffer.from(f.sourceRGBA,'base64')),mask=gunzipSync(Buffer.from(f.coverage,'base64')),w=f.width,h=f.height,[dx,dy]=f.operation.offset,result=[]
for(const sample of f.cases){const native=gunzipSync(Buffer.from(sample.nativeRGBA,'base64')),field=new Float64Array(w*h*3);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=y*w+x,donor=((y+dy)*w+x+dx)*4;if(x+dx>=0&&x+dx<w&&y+dy>=0&&y+dy<h)for(let c=0;c<3;c++)field[p*3+c]=native[p*4+c]-src[donor+c]}
 const means=[0,0,0],variance=[0,0,0],lapAbs=[0,0,0],samples=[];let n=0;for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const p=y*w+x;if([p,p-1,p+1,p-w,p+w].some(q=>mask[q]!==255))continue;n++;for(let c=0;c<3;c++){const v=field[p*3+c];means[c]+=v;variance[c]+=v*v;lapAbs[c]+=Math.abs(4*v-field[(p-1)*3+c]-field[(p+1)*3+c]-field[(p-w)*3+c]-field[(p+w)*3+c])}}for(const [x,y] of [[200,110],[210,125],[195,130],[220,110]]){const p=y*w+x;samples.push({point:[x,y],rgb:Array.from(native.subarray(p*4,p*4+3)),tone:Array.from(field.subarray(p*3,p*3+3))})}
 result.push({diffusion:sample.diffusion,n,means:means.map(v=>v/n),stdev:variance.map((v,c)=>Math.sqrt(v/n-(means[c]/n)**2)),lapAbs:lapAbs.map(v=>v/n),samples})
}
await writeFile('artifacts/photoshop-native/measurements/patch-alpha26/native-field.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2))
