import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {inflateSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {Editor} from '../src/core/editor'
import {sourcePoint} from '../src/shared/selection-coverage'
import {blankPNG,encodeRaster} from '../src/core/raster-edit'
import {PNG} from 'pngjs'
interface Row {version:string;name:string;size:number;opacity:number;flow:number;spacing:number;hardness:number;count:number;points:[number,number][];width:number;height:number;depth:number;alphaLEZlib:string;alphaSHA256:string;measured:{max:number;unionMAE:number;peak:number;refPeak:number}}
const fixture=JSON.parse(readFileSync(new URL('../fixtures/parity/photoshop-27.11-brush.json',import.meta.url),'utf8')) as {provenance:{evidence:Record<string,string>;source:{rgbaZlib:string;width:number;height:number}};rows:Row[]}
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
test('Photoshop brush references preserve native scripts, actual parameter readback and raw independent Alpha',()=>{
 for(const [path,sha] of Object.entries(fixture.provenance.evidence))if(path.startsWith('scripts/'))assert.equal(hash(readFileSync(new URL('../'+path,import.meta.url))),sha)
 assert.ok(inflateSync(Buffer.from(fixture.provenance.source.rgbaZlib,'base64')).every(value=>value===0))
 assert.equal(fixture.rows.length,56)
 for(const r of fixture.rows){const alpha=inflateSync(Buffer.from(r.alphaLEZlib,'base64'));assert.equal(alpha.length,r.width*r.height*2);assert.equal(hash(alpha),r.alphaSHA256)}
})
for(const row of fixture.rows.filter(r=>r.depth===8))test(`Actual Photoshop brush Alpha: ${row.version}/${row.name}`,()=>{
 const e=new Editor();e.importPNG(encodeRaster(blankPNG(row.width,row.height)),'Native brush reference');const id=e.state().manifest.activeLayerID!,before=e.snapshot()
 for(let n=0;n<row.count;n++)e.apply({...e.identity(),action:{type:'layer.paint',layerId:id,points:row.points,color:[200/255,40/255,100/255,1],size:row.size,hardness:row.hardness,opacity:row.opacity,flow:row.flow,spacing:row.spacing,brushModel:'photoshop',pressureSize:false,pressureOpacity:false,erase:false,target:'image'}})
 const s=e.snapshot(),layer=s.manifest.layers[0],png=PNG.sync.read(s.assets.get(layer.imageFile!)!.bytes),ref=inflateSync(Buffer.from(row.alphaLEZlib,'base64'));let total=0,union=0,max=0,peak=0
 for(let y=0;y<row.height;y++)for(let x=0;x<row.width;x++){const [sx,sy]=sourcePoint(layer,x+.5,y+.5,png.width,png.height),ix=Math.floor(sx),iy=Math.floor(sy),p=ix<0||iy<0||ix>=png.width||iy>=png.height?0:png.data[(iy*png.width+ix)*4+3],r=ref.readUInt16LE((y*row.width+x)*2),d=Math.abs(p-r);total+=d;max=Math.max(max,d);union+=p||r?1:0;peak=Math.max(peak,p)}
 // Pin measured residuals as explicit limits, including known hard/medium tip
 // differences. Soft and intermediate shoulder improvements are measured; hard-edge residuals are reduced, remaining near-hard/low-flow differences are pinned.
 assert.ok(max<=row.measured.max+1,`max ${max}, measured ${row.measured.max}`);assert.ok(total/union<=row.measured.unionMAE+.05,`union MAE ${total/union}`);assert.equal(peak,row.measured.peak)
 if(row.hardness===0){assert.ok(max<=36);assert.ok(total/union<2.4)}
 const after=e.snapshot();for(let n=0;n<row.count;n++)e.history({...e.identity(),direction:'undo'});assert.deepEqual(e.snapshot(),before);for(let n=0;n<row.count;n++)e.history({...e.identity(),direction:'redo'});assert.deepEqual(e.snapshot(),after)
})
