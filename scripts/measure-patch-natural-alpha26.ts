import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {gunzipSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import {preparePatch} from '../src/core/patch-edit'
import {preparePatch as prepareUnrestrictedPatch} from './research/patch-edit-core128-unrestricted-alpha26'
import {preparePatch as prepareSpatialPatch} from './research/patch-edit-spatial-alpha26'
import type {Selection} from '../src/shared/pixel-contracts'
const fixture=JSON.parse(await readFile(process.argv[2]??'fixtures/parity/photoshop-27.11-patch-natural-alpha26.json','utf8')),sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex'),source=gunzipSync(Buffer.from(fixture.sourceRGBA,'base64')),coverage=gunzipSync(Buffer.from(fixture.coverage,'base64')),w=fixture.width,h=fixture.height
if(sha(source)!==fixture.sourceSha||sha(coverage)!==fixture.coverageSha||source.length!==w*h*4||coverage.length!==w*h)throw Error('Native source or selection hash differs')
const runs:[number,number,number,number][]=[];for(let y=0;y<h;y++)for(let x=0;x<w;){const value=coverage[y*w+x],start=x;while(x<w&&coverage[y*w+x]===value)x++;if(value)runs.push([y,start,x-start,value])}
const selection:Selection={inverted:false,antialiased:false,shapes:[{kind:'raster',operation:'replace',bounds:[0,0,w,h],feather:0,raster:{width:w,height:h,transform:{origin:[0,0],size:[w,h],rotation:0,flipX:false,flipY:false},runs}}]}
const png=new PNG({width:w,height:h});png.data=source;const editor=new Editor();editor.importPNG(PNG.sync.write(png),'Natural Patch calibration');const snapshot=editor.snapshot(),layerId=snapshot.manifest.layers[0].id,stage={...snapshot,selection},cases=[]
for(const sample of fixture.cases){
 const native=gunzipSync(Buffer.from(sample.nativeRGBA,'base64'));if(sha(native)!==sample.nativeSha||native.length!==source.length||sample.history!=='修补选区')throw Error('Native effect hash/history differs')
 const models=[]
 for(const model of ['legacy-harmonic','unrestricted-core-128','sharp-aa-core-128','exterior-spatial-tone']){
  const diffusion=model==='legacy-harmonic'?1:model==='exterior-spatial-tone'?sample.diffusion:undefined
  const prepared=(model==='sharp-aa-core-128'?preparePatch:model==='unrestricted-core-128'?prepareUnrestrictedPatch:prepareSpatialPatch)(stage,{type:'layer.patch',layerId,mode:'source',offset:fixture.operation.offset,adaptation:1,diffusion}),product=PNG.sync.read(prepared.png);let error=0,weighted=0,weight=0,channels=0,maximum=0,outside=0,alphaChanged=0,nativeChanged=0,nativeOutside=0,nativeAlphaChanged=0,edgeError=0,edgeChannels=0,interiorError=0,interiorChannels=0,gradientError=0,gradientCount=0
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=y*w+x,at=p*4,inside=coverage[p]>0,edge=coverage[p]<255||[-w,w,-1,1].some(d=>p+d<0||p+d>=coverage.length||coverage[p+d]===0)
   if([0,1,2,3].some(c=>native[at+c]!==source[at+c])){nativeChanged++;if(!inside)nativeOutside++}if(native[at+3]!==source[at+3])nativeAlphaChanged++
   if(!inside&&[0,1,2,3].some(c=>product.data[at+c]!==source[at+c]))outside++;if(product.data[at+3]!==source[at+3])alphaChanged++
   if(inside)for(let c=0;c<3;c++){const delta=Math.abs(product.data[at+c]-native[at+c]);error+=delta;weighted+=delta*coverage[p]/255;weight+=coverage[p]/255;channels++;maximum=Math.max(maximum,delta);if(edge){edgeError+=delta;edgeChannels++}else{interiorError+=delta;interiorChannels++}for(const d of [1,w])if(p+d<coverage.length&&coverage[p]===255&&coverage[p+d]===255&&(d!==1||x+1<w)){gradientError+=Math.abs((product.data[(p+d)*4+c]-product.data[at+c])-(native[(p+d)*4+c]-native[at+c]));gradientCount++}}
  }
  if(!nativeChanged||nativeOutside||nativeAlphaChanged||outside||alphaChanged)throw Error(`Rejected outside/alpha/effect gate for ${sample.id}`)
  models.push({model,diffusion:diffusion??null,mae:error/channels,weightedMae:weighted/weight,max:maximum,edgeMae:edgeError/edgeChannels,interiorMae:interiorError/interiorChannels,gradientMae:gradientError/gradientCount,nativeChanged,productChanged:prepared.affectedPixels,nativeOutside,nativeAlphaChanged,productOutside:outside,productAlphaChanged:alphaChanged})
 }
 cases.push({id:sample.id,nativeSha:sample.nativeSha,models})
}
const report={dataset:fixture.dataset,classification:fixture.dataset==='alpha26-natural-explicit-heldout-old-wood'?fixture.classification+'; subsequently disclosed and reused for core128 research, not independent for this candidate':fixture.classification,sourceSha:fixture.sourceSha,coverageSha:fixture.coverageSha,operation:fixture.operation,cases,limitations:fixture.limitations};await mkdir('artifacts/photoshop-native/measurements/patch-alpha26',{recursive:true});await writeFile(`artifacts/photoshop-native/measurements/patch-alpha26/${fixture.dataset}.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2))
