import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {resolve,join,basename} from 'node:path'
import {createHash} from 'node:crypto'
import {promisify} from 'node:util'
import {execFile} from 'node:child_process'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
import {PNG} from 'pngjs'
import {decodePhotoshop,encodePhotoshop} from '../../src/core/photoshop-io'
import {Editor} from '../../src/core/editor'
import {EditorError} from '../../src/shared/contracts'
import {inspectRasterPSD} from './independent-raster-reader'
import {renderCorpusDocument} from './render'
import {visibleMetrics} from './metrics'

export interface CorpusRecord {
 id:string;name:string;origin:string;generator:string;source:string;file:string;reference:string;license:string
 expected:{width:number;height:number;layerCount:number;bitsPerChannel:number}
 layerValidation:{valid:boolean;errors:string[]}
 sha256:{source:string;file:string;reference:string}
}
const exec=promisify(execFile)
function localFile(directory:string,file:string){if(file!==basename(file)||!file)throw new Error('Corpus files must be local basenames');return join(directory,file)}
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex')
function rasterSummary(document:ReturnType<typeof decodePhotoshop>){return document.manifest.layers.map(layer=>({name:layer.name,isGroup:layer.isGroup,opacity:layer.opacity,blendMode:layer.blendMode,transform:layer.transform,raster:layer.imageFile?hash(PNG.sync.read(document.assets.get(layer.imageFile)!.bytes).data):null}))}
export async function checkCorpusRecord(record:CorpusRecord,directory:string,output:string){
 const files={source:await readFile(localFile(directory,record.source)),file:await readFile(localFile(directory,record.file)),reference:await readFile(localFile(directory,record.reference))}
 for(const key of ['source','file','reference'] as const)assert.equal(hash(files[key]),record.sha256[key],`${record.id}: provenance hash ${key}`)
 assert.ok(record.license&&record.origin==='independent-application','An explicit independent origin and image license is required')
 const independent=inspectRasterPSD(files.file),validationErrors=independent.layers.flatMap(layer=>layer.errors)
 assert.equal(validationErrors.length===0,record.layerValidation.valid,'Source validity changed; update provenance after independently investigating')
 let document:ReturnType<typeof decodePhotoshop>
 try{document=decodePhotoshop(files.file)}catch(error){
  if(validationErrors.length&&error instanceof EditorError&&error.code==='INVALID_IMAGE')return {id:record.id,name:record.name,origin:record.origin,sourceHash:hash(files.file),sourceIntegrity:'pass',independentLayerValidity:{status:'malformed',errors:validationErrors},projectRead:{status:'rejected-malformed',code:error.code,error:error.message,acceptedMalformedWithoutWarning:false},sourceReferenceRender:{status:'not-run-malformed-source'},unmodifiedRoundtrip:{status:'not-run-rejected-input'},modifiedRecompute:{status:'not-run-rejected-input'},independentModifiedOutput:{status:'not-run-rejected-input'},photoshopVisualAcceptance:'not-run'}
  throw error
 }
 assert.equal(document.manifest.width,record.expected.width);assert.equal(document.manifest.height,record.expected.height);assert.equal(document.manifest.layers.length,record.expected.layerCount)
 const originalRender=await renderCorpusDocument(document),unmodifiedBytes=encodePhotoshop(document.manifest,document.assets,{compositePNG:originalRender}),reimported=decodePhotoshop(unmodifiedBytes)
 assert.deepEqual(rasterSummary(reimported),rasterSummary(document),'Unmodified pixels/geometry/opacity must remain stable')
 const unmodifiedRender=await renderCorpusDocument(reimported),projectRoundtrip=visibleMetrics(unmodifiedRender,originalRender)
 assert.ok(projectRoundtrip.maxPremultipliedRGBError<=1&&projectRoundtrip.maxAlphaError<=1,'Project roundtrip render exceeds one byte')
 const editor=new Editor();editor.importDocument(document.manifest,document.assets,record.name,document.warnings)
 const id=editor.state().manifest.layers[0].id
 editor.apply({...editor.identity(),action:{type:'layer.set_opacity',layerId:id,opacity:.5}})
 editor.apply({...editor.identity(),action:{type:'layer.paint',layerId:id,points:[[4,3]],color:[1,0,1,1],size:2,hardness:1,opacity:1,erase:false,target:'image'}})
 const modified=editor.snapshot(),modifiedRender=await renderCorpusDocument({...modified,warnings:[]}),modifiedBytes=encodePhotoshop(modified.manifest,modified.assets,{compositePNG:modifiedRender}),modifiedReimport=decodePhotoshop(modifiedBytes)
 assert.equal(modifiedReimport.manifest.layers[0].opacity,128/255,'PSD encodes opacity as a byte')
 const modifiedAgain=await renderCorpusDocument(modifiedReimport),modifiedProjectRoundtrip=visibleMetrics(modifiedAgain,modifiedRender)
 assert.ok(modifiedProjectRoundtrip.maxPremultipliedRGBError<=1&&modifiedProjectRoundtrip.maxAlphaError<=1)
 assert.notEqual(hash(modified.assets.values().next().value!.bytes),hash(document.assets.values().next().value!.bytes),'Paint must modify the actual asset')
 await mkdir(output,{recursive:true})
 const unchangedPSD=join(output,`${record.id}.unmodified.psd`),editedPSD=join(output,`${record.id}.modified.psd`)
 await writeFile(unchangedPSD,unmodifiedBytes);await writeFile(editedPSD,modifiedBytes);await writeFile(join(output,`${record.id}.project.png`),originalRender)
 let externalModified:{status:string;metrics?:ReturnType<typeof visibleMetrics>;reason?:string}={status:'not-run',reason:'Requires installed macOS sips; committed reference still allows independent-source comparison.'}
 if(process.platform==='darwin'){
  const png=join(output,`${record.id}.modified.imageio.png`)
  await exec('/usr/bin/sips',['-s','format','png',editedPSD,'--out',png])
  const metrics=visibleMetrics(await readFile(png),modifiedRender)
  externalModified={status:metrics.maxPremultipliedRGBError<=1&&metrics.maxAlphaError<=1?'pass':'different',metrics,reason:'Apple ImageIO reads the stored composite; this does not verify independent recomposition of editable layers. Alpha/profile handling must be investigated before attributing differences.'}
 }
 return {id:record.id,name:record.name,origin:record.origin,sourceHash:hash(files.file),sourceIntegrity:'pass',independentLayerValidity:{status:validationErrors.length?'malformed':'pass',errors:validationErrors},projectRead:{status:'pass',warnings:document.warnings,acceptedMalformedWithoutWarning:!!validationErrors.length&&!document.warnings.length},sourceReferenceRender:{status:validationErrors.length?'blocked-malformed-source':'measured',metrics:visibleMetrics(originalRender,files.reference)},unmodifiedRoundtrip:{status:'pass-project-only',metrics:projectRoundtrip},modifiedRecompute:{status:'pass-project-only',metrics:modifiedProjectRoundtrip},independentModifiedOutput:externalModified,photoshopVisualAcceptance:'not-run'}
}
export async function runCorpus(directory=resolve('fixtures/photoshop-corpus/imageio'),output=resolve('artifacts/photoshop-corpus')){
 const provenance=JSON.parse(await readFile(join(directory,'provenance.json'),'utf8')) as {generatorVersion:string;system:string;records:CorpusRecord[]}
 const records=[]
 for(const record of provenance.records){try{records.push(await checkCorpusRecord(record,directory,output))}catch(error){records.push({id:record.id,name:record.name,status:'error',error:error instanceof Error?error.message:String(error)})}}
 const report={schemaVersion:1,generatedAt:new Date().toISOString(),generatorVersion:provenance.generatorVersion,system:provenance.system,currentPlatform:process.platform,validIndependentInputCount:records.filter(record=>'independentLayerValidity'in record&&record.independentLayerValidity.status==='pass').length,malformedIndependentInputCount:records.filter(record=>'independentLayerValidity'in record&&record.independentLayerValidity.status==='malformed').length,photoshopAuthoredFileCount:0,records}
 await mkdir(output,{recursive:true});await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n')
 return report
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const report=await runCorpus();console.log(JSON.stringify(report,null,2));if(report.records.some(record=>'status'in record&&record.status==='error'))process.exitCode=1;else if(process.argv.includes('--strict')&&(report.validIndependentInputCount!==report.records.length||report.records.some(record=>'independentModifiedOutput'in record&&record.independentModifiedOutput.status!=='pass')))process.exitCode=2}
