/** Isolated capacity probe; run with node --expose-gc --import tsx. */
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import {selectionCoverage} from '../src/core/raster-edit'
const width=Number(process.argv[2]??10000),height=Number(process.argv[3]??10000)
assert.ok(Number.isInteger(width)&&Number.isInteger(height)&&width>20&&height>20&&width*height<=200_000_000)
function fixture(){const png=new PNG({width,height});png.data.fill(255);return PNG.sync.write(png)}
const start=performance.now(),bytes=fixture(),fixtureMs=performance.now()-start
global.gc?.()
const editor=new Editor();editor.importPNG(bytes,'ROI capacity');const id=editor.state().manifest.activeLayerID!
editor.apply({...editor.identity(),action:{type:'selection.set',selection:{inverted:false,antialiased:false,shapes:[{kind:'rectangle',operation:'replace',bounds:[2,2,10,10],feather:0}]}}})
const before=editor.snapshot(),moveStart=performance.now();editor.apply({...editor.identity(),action:{type:'selection.transform_pixels',layerId:id,transform:{origin:[20,20],size:[10,10],rotation:0,flipX:false,flipY:false,sampling:'Nearest'}}});const moveMs=performance.now()-moveStart
assert.equal(selectionCoverage(editor.state().selection,20.5,20.5),1)
global.gc?.()
function checkPixels(){const after=editor.snapshot(),layer=after.manifest.layers[0],png=PNG.sync.read(after.assets.get(layer.imageFile!)!.bytes);assert.equal(png.data[(2*width+2)*4+3],0);assert.equal(png.data[(20*width+20)*4+3],255);assert.equal(png.width,width);assert.equal(png.height,height)}
checkPixels();global.gc?.();editor.history({...editor.identity(),direction:'undo'});assert.deepEqual(editor.snapshot().assets,before.assets);editor.history({...editor.identity(),direction:'redo'});checkPixels()
const result={time:new Date().toISOString(),width,height,pixels:width*height,selection:[2,2,10,10],destination:[20,20,10,10],fixtureMs,moveMs,peakRssBytes:process.resourceUsage().maxRSS*1024,encodedBytes:bytes.length,checks:['source cleared','destination opaque','source dimensions retained','undo exact asset hash/bytes','redo pixel check'],scope:'Real full-size source PNG and small selection; whole source decoding/encoding remains. Does not validate full-canvas selection, filters, painting, export or cancellation.'}
await mkdir('artifacts/parity-capacity',{recursive:true});await writeFile(`artifacts/parity-capacity/selection-roi-${width*height}.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
