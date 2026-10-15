import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {gunzipSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import {preparePatch} from '../src/core/patch-edit'
import {preparePatch as prepareAlpha26} from './research/patch-edit-conservative-alpha26'
import type {Selection} from '../src/shared/pixel-contracts'
interface Fixture {dataset:string;classification:string;width:number;height:number;sourceSha:string;sourceRGBA:string;coverageSha:string;coverage:string;operation:{offset:[number,number]};cases:{id:string;diffusion:number;nativeRGBA:string;nativeSha:string;history:string;error?:string}[]}
const oldFiles=['natural-explicit','natural-heldout','synthetic-explicit','natural-third-independent','independent-irregular-aa','independent-irregular-feather4','independent-isolated-soft-peak'].map(v=>'fixtures/parity/photoshop-27.11-patch-'+v+'-alpha26.json'),newFiles=['slanted-aa','curved-polygon-aa','slanted-feather2','slanted-feather6','lowpeak6-feather8','lowpeak14-feather8'].map(v=>'fixtures/parity/photoshop-27.11-patch-soft-holdout-'+v+'-alpha27.json'),sha=(v:Uint8Array)=>createHash('sha256').update(v).digest('hex'),reports=[]
for(const file of [...oldFiles,...newFiles]){
 const f=JSON.parse(await readFile(file,'utf8')) as Fixture,source=Uint8Array.from(gunzipSync(Buffer.from(f.sourceRGBA,'base64'))),coverage=Uint8Array.from(gunzipSync(Buffer.from(f.coverage,'base64'))),runs:[number,number,number,number][]=[]
 if(sha(source)!==f.sourceSha||sha(coverage)!==f.coverageSha)throw Error('Frozen native source/mask hash differs')
 for(let y=0;y<f.height;y++)for(let x=0;x<f.width;){const value=coverage[y*f.width+x],start=x;while(x<f.width&&coverage[y*f.width+x]===value)x++;if(value)runs.push([y,start,x-start,value])}
 const selection:Selection={inverted:false,antialiased:false,shapes:[{kind:'raster',operation:'replace',bounds:[0,0,f.width,f.height],feather:0,raster:{width:f.width,height:f.height,transform:{origin:[0,0],size:[f.width,f.height],rotation:0,flipX:false,flipY:false},runs}}]},png=new PNG({width:f.width,height:f.height});png.data=Buffer.from(source);const editor=new Editor();editor.importPNG(PNG.sync.write(png),'Native soft Patch measurement');const snapshot=editor.snapshot(),layerId=snapshot.manifest.layers[0].id,stage={...snapshot,selection},cases=[]
 for(const sample of f.cases){const native=gunzipSync(Buffer.from(sample.nativeRGBA,'base64'));if(sha(native)!==sample.nativeSha||sample.history!=='修补选区'||sample.error)throw Error('Native effect hash/history/error invalid');const models=[]
  for(const [model,prepare] of [['alpha26-conservative',prepareAlpha26],['alpha27-soft-v1',preparePatch]] as const){const prepared=prepare(stage,{type:'layer.patch',layerId,mode:'source',offset:f.operation.offset}),actual=PNG.sync.read(prepared.png).data;let error=0,max=0,channels=0,outside=0,alphaChanged=0,weakChanged=0,nativeChanged=0
   for(let p=0;p<coverage.length;p++){const at=p*4,changed=[0,1,2,3].some(c=>actual[at+c]!==source[at+c]);if(changed&&coverage[p]>0&&coverage[p]<128)weakChanged++;if(changed&&!coverage[p])outside++;if(actual[at+3]!==source[at+3])alphaChanged++;if([0,1,2,3].some(c=>native[at+c]!==source[at+c]))nativeChanged++;if(coverage[p])for(let c=0;c<3;c++){const d=Math.abs(actual[at+c]-native[at+c]);error+=d;max=Math.max(max,d);channels++}}
   if(outside||alphaChanged)throw Error('Product changed outside coverage or alpha');models.push({model,mae:error/channels,max,changed:prepared.affectedPixels,nativeChanged,weakChanged,outside,alphaChanged})
  }cases.push({id:sample.id,diffusion:sample.diffusion,nativeSha:sample.nativeSha,models})
 }
 reports.push({dataset:f.dataset,classification:file.endsWith('alpha27.json')?f.classification:'Previously disclosed alpha26 corpus; research and regression evidence, not independent for alpha27',sourceSha:f.sourceSha,coverageSha:f.coverageSha,cases})
}
await mkdir('artifacts/alpha27',{recursive:true});await writeFile('artifacts/alpha27/patch-production-measurements.json',JSON.stringify(reports,null,2)+'\n');console.log(JSON.stringify(reports,null,2))
