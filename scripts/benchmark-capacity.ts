import {PNG} from 'pngjs'
import {mkdir,rm,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {performance} from 'node:perf_hooks'
import {Editor} from '../src/core/editor'
const directory=resolve('artifacts/capacity');await mkdir(directory,{recursive:true});const measures:Record<string,number>={}
let start=performance.now();const pixels=new PNG({width:10000,height:10000});pixels.data.fill(255)
// Generated solid surface with a distinct 32-pixel center block for magnified viewport pixel checks.
for(let y=4984;y<5016;y++)for(let x=4984;x<5016;x++)pixels.data.set([255,0,0,255],(y*10000+x)*4)
const encoded=PNG.sync.write(pixels);measures.encodeMs=Math.round(performance.now()-start)
start=performance.now();const editor=new Editor();editor.importPNG(encoded,'100MP capacity surface');measures.importMs=Math.round(performance.now()-start);const state=editor.state(),layerId=state.manifest.layers[0].id
start=performance.now();editor.apply({...editor.identity(),action:{type:'layer.set_transform',layerId,transform:{...state.manifest.layers[0].transform,origin:[1,1]}}});editor.history({...editor.identity(),direction:'undo'});measures.transformUndoMs=Math.round(performance.now()-start)
if(editor.state().assets[0].hash!==state.assets[0].hash)throw new Error('Metadata undo changed raster bytes.')
const path=join(directory,'100mp.comp');await rm(path,{recursive:true,force:true});start=performance.now();await editor.saveAs(path);measures.saveAndReadValidationMs=Math.round(performance.now()-start)
await writeFile(join(directory,'core.json'),JSON.stringify({status:'PASS',generated:true,width:10000,height:10000,pixels:100_000_000,pngBytes:encoded.length,assetHash:state.assets[0].hash,measures,peakRSSMiB:Math.round(process.resourceUsage().maxRSS/1024),scope:'Actual 100MP PNG decode/import, immutable metadata transform+undo, save and core read validation. Desktop/GPU is a separate result.'},null,2));console.log(JSON.stringify({status:'PASS',measures,pngBytes:encoded.length,peakRSSMiB:Math.round(process.resourceUsage().maxRSS/1024)}))
