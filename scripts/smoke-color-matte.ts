import assert from 'node:assert/strict'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {PNG} from 'pngjs'
import {SubjectSegmenter} from '../src/core/subject-segmentation'
import {refineSubjectMatte} from '../src/shared/subject-matte'

// Real photographic input, local pinned U²-NetP. Does not upload images, edit a
// user document, or call Photoshop. The output is functional evidence, not a
// benchmark against Adobe's segmentation or hand-labelled hair ground truth.
const photo=resolve(process.argv[2]??'artifacts/subject-photo.png'),directory=resolve('artifacts/color-matte')
const image=PNG.sync.read(await readFile(photo)),data=new Uint8Array(image.data),source={width:image.width,height:image.height,data}
const segmenter=new SubjectSegmenter({cacheDir:resolve('artifacts/subject-model-cache'),bundledModelPath:resolve('fixtures/models/u2netp.onnx')})
await mkdir(directory,{recursive:true})
try{
 const coarse=await segmenter.select(source),settings={quality:'advanced' as const,refineEdges:4,matteContrast:0,shiftEdge:0,feather:0}
 const start=performance.now(),color=refineSubjectMatte(coarse,source,{...settings,edgeMode:'color'}),elapsedMs=performance.now()-start
 const native=refineSubjectMatte(coarse,source,{...settings,edgeMode:'native'}),feathered=refineSubjectMatte(coarse,source,{...settings,edgeMode:'color',feather:1.5})
 const panels=[coarse,native,color,feathered],comparison=new PNG({width:image.width*5,height:image.height}),metrics=[]
 for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){
  const i=y*image.width+x,at=i*4;comparison.data.set(image.data.subarray(at,at+4),(y*comparison.width+x)*4)
  for(let p=0;p<panels.length;p++){
   const alpha=panels[p].coverage[i]/255,checker=(Math.floor(x/12)+Math.floor(y/12))%2?55:100,target=(y*comparison.width+(p+1)*image.width+x)*4
   for(let c=0;c<3;c++)comparison.data[target+c]=Math.round(data[at+c]*alpha+checker*(1-alpha));comparison.data[target+3]=255
  }
 }
 for(let p=0;p<panels.length;p++){
  const mask=panels[p],png=new PNG({width:image.width,height:image.height});let fractional=0,foreground=0,changed=0
  for(let i=0;i<mask.coverage.length;i++){const a=mask.coverage[i];png.data.set([a,a,a,255],i*4);if(a>0&&a<255)fractional++;if(a>=128)foreground++;if(a!==coarse.coverage[i])changed++}
  assert.ok(foreground>0&&foreground<mask.coverage.length);metrics.push({mode:['coarse','native','color','color-feather'][p],foreground,fractional,changedFromCoarse:changed});await writeFile(resolve(directory,`${metrics[p].mode}.png`),PNG.sync.write(png))
 }
 assert.deepEqual(new Uint8Array(image.data),data);assert.ok(metrics[2].fractional>0)
 await writeFile(resolve(directory,'comparison.png'),PNG.sync.write(comparison))
 const report={status:'PASS',photo,width:image.width,height:image.height,model:coarse.modelId,inferenceMs:coarse.elapsedMs,colorRefineMs:elapsedMs,settings,metrics,comparisonPanels:['source','coarse','native','color','color + feather 1.5px'],scope:'Real-photo local runtime and parameter output check. No manual ground truth or Photoshop pixel/quality comparison.'}
 await writeFile(resolve(directory,'acceptance.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}finally{await segmenter.dispose()}
