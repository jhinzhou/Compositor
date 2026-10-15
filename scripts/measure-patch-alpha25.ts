import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {inflateSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import {preparePatch} from '../src/core/patch-edit'
const fixture=JSON.parse(await readFile(new URL('../fixtures/parity/photoshop-27.11-patch-alpha25.json',import.meta.url),'utf8')),sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex'),source=inflateSync(Buffer.from(fixture.sourceRGBA,'base64'))
if(sha(source)!==fixture.sourceSha)throw Error('Patch reference source hash mismatch')
const png=new PNG({width:fixture.width,height:fixture.height});png.data=source
const editor=new Editor();editor.importPNG(PNG.sync.write(png),'Alpha25 Patch native oracle');const snapshot=editor.snapshot(),layerId=snapshot.manifest.layers[0].id,cases=[]
for(const sample of fixture.cases){
 const native=inflateSync(Buffer.from(sample.nativeRGBA,'base64'))
 if(sha(native)!==sample.nativeSha||native.length!==source.length)throw Error(`Patch native reference hash mismatch: ${sample.id}`)
 const [left,top,w,h]=sample.operation.selection as[number,number,number,number],stage={...snapshot,selection:{inverted:false,antialiased:false,shapes:[{kind:'rectangle' as const,bounds:[left,top,w,h] as[number,number,number,number],feather:0,operation:'replace' as const}]}},prepared=preparePatch(stage,{type:'layer.patch',layerId,mode:'source',offset:sample.operation.offset,adaptation:1}),product=PNG.sync.read(prepared.png)
 let nativeChanged=0,nativeOutside=0,nativeAlpha=0,productOutside=0,absolute=0,maximum=0,channels=0
 for(let y=0;y<fixture.height;y++)for(let x=0;x<fixture.width;x++){
  const at=(y*fixture.width+x)*4,inside=x>=left&&x<left+w&&y>=top&&y<top+h,nativeDiff=[0,1,2,3].some(c=>native[at+c]!==source[at+c]),productDiff=[0,1,2,3].some(c=>product.data[at+c]!==source[at+c])
  if(nativeDiff){nativeChanged++;if(!inside)nativeOutside++}if(native[at+3]!==source[at+3])nativeAlpha++;if(productDiff&&!inside)productOutside++
  if(inside)for(let c=0;c<3;c++){const delta=Math.abs(product.data[at+c]-native[at+c]);absolute+=delta;maximum=Math.max(maximum,delta);channels++}
 }
 if(!nativeChanged||nativeOutside||nativeAlpha||productOutside||!sample.nativeEffectValid||nativeChanged!==sample.nativeChanged)throw Error(`Rejected Patch reference: ${sample.id}`)
 cases.push({id:sample.id,operation:sample.operation,sourceSha:fixture.sourceSha,nativeSha:sample.nativeSha,nativeChanged,nativeOutside,nativeAlpha,productOutside,productAdaptation:1,productChanged:prepared.affectedPixels,mae: absolute/channels,max:maximum,limitation:'Product adaptation 1 compared with native recorded Diffusion; no claim of implementing Diffusion 1-7 or natural-photo equality.'})
}
const report={version:fixture.version,cases,excludedCapture:fixture.excludedCapture,limitations:fixture.limitations}
await mkdir('artifacts/photoshop-native/measurements/patch-alpha25',{recursive:true});await writeFile('artifacts/photoshop-native/measurements/patch-alpha25/comparison.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2))
