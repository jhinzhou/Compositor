import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {gunzipSync} from 'node:zlib'
import {createHash} from 'node:crypto'
const sha=(v:Uint8Array)=>createHash('sha256').update(v).digest('hex'),reports=[]
for(const name of ['photoshop-27.11-patch-natural-explicit-alpha26.json','photoshop-27.11-patch-natural-heldout-alpha26.json','photoshop-27.11-patch-synthetic-explicit-alpha26.json']){
 const f=JSON.parse(await readFile('fixtures/parity/'+name,'utf8')),source=gunzipSync(Buffer.from(f.sourceRGBA,'base64')),mask=gunzipSync(Buffer.from(f.coverage,'base64'))
 if(sha(source)!==f.sourceSha||sha(mask)!==f.coverageSha)throw Error('Invalid native source/coverage hash')
 const cases=[]
 for(const c of f.cases){const native=gunzipSync(Buffer.from(c.nativeRGBA,'base64'));if(sha(native)!==c.nativeSha)throw Error('Invalid native output hash');const bins=[{id:'weak-1-127',count:0,changed:0,max:0},{id:'strong-soft-128-254',count:0,changed:0,max:0},{id:'full-255',count:0,changed:0,max:0}];for(let p=0;p<mask.length;p++){if(!mask[p])continue;const bin=bins[mask[p]<128?0:mask[p]<255?1:2];bin.count++;let delta=0;for(let channel=0;channel<4;channel++)delta=Math.max(delta,Math.abs(native[p*4+channel]-source[p*4+channel]));if(delta)bin.changed++;bin.max=Math.max(bin.max,delta)}cases.push({id:c.id,diffusion:c.diffusion,bins})}
 reports.push({fixture:name,sourceSha:f.sourceSha,coverageSha:f.coverageSha,cases})
}
await mkdir('artifacts/photoshop-native/measurements/patch-alpha26',{recursive:true});await writeFile('artifacts/photoshop-native/measurements/patch-alpha26/native-weak-rates.json',JSON.stringify(reports,null,2)+'\n');console.log(JSON.stringify(reports,null,2))
