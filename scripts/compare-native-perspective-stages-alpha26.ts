import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {inflateSync} from 'node:zlib'
import assert from 'node:assert/strict'
import {PNG} from 'pngjs'

const directPath=process.argv[2]??'fixtures/parity/photoshop-27.11-perspective-sampling-alpha26-actionmanager-diagnostic.json',stagedPath=process.argv[3]??'fixtures/parity/photoshop-27.11-perspective-sampling-alpha26-two-stage-diagnostic.json',output=process.argv[4]??'artifacts/alpha26-sampling/two-stage-native-comparison.json'
const direct=JSON.parse(await readFile(directPath,'utf8')),staged=JSON.parse(await readFile(stagedPath,'utf8'))
assert.equal(direct.referenceKind,'native-actionmanager');assert.equal(staged.referenceKind,'native-actionmanager');assert.equal(direct.sourcePath,staged.sourcePath);assert.equal(direct.source.sha256,staged.source.sha256);assert.equal(direct.source.width,staged.source.width);assert.equal(direct.source.height,staged.source.height)
const hash=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex'),results=[]
const decode=async(entry:{rgbaZlib?:string;sha256?:string;width:number;height:number;nativePath?:string})=>{if(!entry.rgbaZlib)return PNG.sync.read(await readFile(entry.nativePath!));const bytes=inflateSync(Buffer.from(entry.rgbaZlib,'base64'));assert.equal(hash(bytes),entry.sha256);assert.equal(bytes.length,entry.width*entry.height*4);return {width:entry.width,height:entry.height,data:bytes}}
for(const reference of direct.cases){
 const counterpart=staged.cases.find((entry:{name:string})=>entry.name===reference.name);assert.ok(counterpart);assert.deepEqual(counterpart.corners,reference.corners)
 const a=await decode(reference),b=await decode(counterpart);assert.equal(a.width,reference.width);assert.equal(a.height,reference.height);assert.equal(b.width,a.width);assert.equal(b.height,a.height)
 let sum=0,max=0,alphaSum=0,alphaMax=0,pixelsChanged=0
 for(let i=0;i<a.data.length;i+=4){let changed=false;for(let c=0;c<4;c++){const delta=Math.abs(a.data[i+c]-b.data[i+c]);changed||=!!delta;if(c===3){alphaSum+=delta;alphaMax=Math.max(alphaMax,delta)}else{sum+=delta;max=Math.max(max,delta)}}if(changed)pixelsChanged++}
 results.push({name:reference.name,width:a.width,height:a.height,intermediate:counterpart.intermediate,directRGBAHash:hash(a.data),stagedRGBAHash:hash(b.data),hashIdentical:hash(a.data)===hash(b.data),rgbMAE:sum/(a.width*a.height*3),rgbMax:max,alphaMAE:alphaSum/(a.width*a.height),alphaMax,pixelsChanged})
}
await mkdir('artifacts/alpha26-sampling',{recursive:true});const report={referenceKind:'native-actionmanager',comparison:'Native explicit-target Perspective Crop versus native automatic Perspective Crop followed by native Automatic Image Size',productionChanged:false,limits:['This isolates two native operations. It does not establish all Photoshop internal implementation stages.','Only matching source, corners and output dimensions are compared.'],results};await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(results,null,2))
