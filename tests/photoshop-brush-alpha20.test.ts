import test from 'node:test'
import assert from 'node:assert/strict'
import {brushStrokeCoverage} from '../src/shared/brush-coverage'
import {actionSchema} from '../src/shared/contracts'
const grid={width:256,height:192,transform:{origin:[0,0] as [number,number],size:[256,192] as [number,number],rotation:0,flipX:false,flipY:false,sampling:'High quality' as const}}
const ps={brushModel:'photoshop' as const,flow:.2}
test('Photoshop computed-tip fractional spacing follows its single precision distance across path endpoints',()=>{
 for(const size of [32,64])for(const spacing of [.1,.2]){
  const step=Math.fround(size*spacing),count=Math.floor(160/step),last=48+count*step
  const exact=brushStrokeCoverage(grid,[[48,96],[208,96]],size,0,{...ps,spacing}),short=brushStrokeCoverage(grid,[[48,96],[last+.0001,96]],size,0,{...ps,spacing}),past=brushStrokeCoverage(grid,[[48,96],[48+(count+1)*step+.0001,96]],size,0,{...ps,spacing})
  assert.deepEqual(exact,short,'Exact length160 must not invent an extra terminal dab beyond the single precision distance')
  assert.notDeepEqual(exact,past,'Moving past the next arc length creates the next dab')
 }
 const at=96*256+208,exact=brushStrokeCoverage(grid,[[48,96],[208,96]],32,1,{...ps,spacing:.25}),short=brushStrokeCoverage(grid,[[48,96],[207.999,96]],32,1,{...ps,spacing:.25})
 assert.ok(exact[at]>short[at],'Exactly representable8px spacing retains its terminal dab')
})
test('Photoshop fractional spacing is invariant to pointer sample density and keeps the complete public ratio',()=>{
 const two:[number,number][]=[[48,96],[208,96]],dense:[number,number][]=Array.from({length:1601},(_,i)=>[48+i/10,96])
 for(const spacing of [.01,.1,.125,.2,.25,10])assert.deepEqual(brushStrokeCoverage(grid,two,32,.9,{...ps,spacing}),brushStrokeCoverage(grid,dense,32,.9,{...ps,spacing}))
 assert.notDeepEqual(brushStrokeCoverage(grid,two,32,0,{...ps,spacing:.125}),brushStrokeCoverage(grid,two,32,0,{...ps,spacing:.13}),'Public spacing is not quantized to native integer UI percent')
 for(const spacing of [.01,.125,10]){const action=actionSchema.parse({type:'selection.paint',points:two,size:32,hardness:.9,opacity:1,flow:.2,brushModel:'photoshop',spacing,value:1});assert.equal(action.type,'selection.paint');if(action.type==='selection.paint')assert.equal(action.spacing,spacing)}
})

import {readFileSync} from 'node:fs'
import {inflateSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {Editor} from '../src/core/editor'
import {applyPixelAction} from '../src/core/pixel-actions'
import {blankPNG,encodeRaster} from '../src/core/raster-edit'
const native=JSON.parse(readFileSync(new URL('../fixtures/parity/photoshop-27.11-brush-v6.json',import.meta.url),'utf8'))
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
test('v6 independent references preserve 61 actual native outputs and verified spacing rather than requested filename values',()=>{
 assert.equal(native.rows.length,61)
 assert.equal(hash(readFileSync(new URL('../scripts/native-reference/photoshop-brush-study-v6.jsx',import.meta.url))),native.provenance.nativeScriptSHA256)
 for(const row of native.rows){const bytes=inflateSync(Buffer.from(row.alphaLEZlib,'base64'));assert.equal(bytes.length,row.width*row.height*2);assert.equal(hash(bytes),row.alphaSHA256);if(row.requestedSpacing===.125)assert.equal(row.spacing,.13)}
})
for(const row of native.rows)test(`Independent native v6 brush: ${row.name}`,()=>{
 const bytes=inflateSync(Buffer.from(row.alphaLEZlib,'base64')),coverage=brushStrokeCoverage(grid,row.points,row.size,row.hardness,{...ps,flow:row.flow,spacing:row.spacing});let total=0,union=0,max=0
 for(let i=0;i<coverage.length;i++){const value=bytes.readUInt16LE(i*2),delta=Math.abs(value-coverage[i]);total+=delta;union+=value||coverage[i]?1:0;max=Math.max(max,delta)}
 // These limits are the fixed independent mathematical candidate, measured
 // before production adoption; changing product code does not regenerate them.
 assert.ok(max<=row.expectedApproximation.max+1,`maxAlpha ${max}; candidate ${row.expectedApproximation.max}`)
 assert.ok(total/union<=row.expectedApproximation.unionMAE+.05,`MAE ${total/union}; candidate ${row.expectedApproximation.unionMAE}`)
 if(row.flow===1&&((row.size===8&&[.5,.75].includes(row.hardness))||(row.size===16&&row.hardness===.75))){assert.ok(total/union<row.alpha19Before.unionMAE*.5);assert.ok(max<row.alpha19Before.max*.5)}
 if(row.flow===1&&row.hardness>=.9&&row.hardness<=.95){assert.ok(total/union<row.alpha19Before.unionMAE*.65);assert.ok(max<row.alpha19Before.max*.65)}
})
test('near-hard filtered shoulder remains continuous across its transition and hard endpoint',()=>{
 for(const size of [8,16,32,64])for(const hardness of [.75,.8,.9,.95,.999999]){
  const a=brushStrokeCoverage(grid,[[128,96]],size,hardness,{...ps,flow:1,spacing:.25}),b=brushStrokeCoverage(grid,[[128,96]],size,Math.min(1,hardness+1e-6),{...ps,flow:1,spacing:.25})
  for(let i=0;i<a.length;i++)assert.ok(Math.abs(a[i]-b[i])<=1,`size ${size} hardness ${hardness}, ${a[i]}→${b[i]}`)
 }
})
test('Photoshop near-hard low Flow preview commits identical image/mask bytes and one complete Undo/Redo',()=>{
 for(const target of ['image','mask'] as const){
  const e=new Editor();e.importPNG(encodeRaster(blankPNG(256,192)),target);const id=e.state().manifest.activeLayerID!
  if(target==='mask')e.apply({...e.identity(),action:{type:'layer.mask',layerId:id,operation:'reveal'}})
  e.apply({...e.identity(),action:{type:'selection.set',selection:{shapes:[{kind:'rectangle',bounds:[0,0,140,192],operation:'replace',feather:0}],inverted:false}}})
  const before=e.snapshot(),action=actionSchema.parse({type:'layer.paint',layerId:id,points:[[48,96],[208,96]],color:[0,0,0,1],size:32,hardness:.9,opacity:.5,flow:.2,spacing:.1,brushModel:'photoshop',target}),draft={...e.snapshot(),selection:e.state().selection??null}
  applyPixelAction(draft,action);assert.deepEqual(e.snapshot(),before);e.apply({...e.identity(),action});const after=e.snapshot();assert.deepEqual(after.manifest.layers,draft.manifest.layers);assert.deepEqual(after.assets,draft.assets)
  e.history({...e.identity(),direction:'undo'});assert.deepEqual(e.snapshot(),before);e.history({...e.identity(),direction:'redo'});assert.deepEqual(e.snapshot(),after)
 }
})

test('pixel-width AA correction joins continuously at resolved width and the soft endpoint',()=>{
 for(const hardness of [.25,.5,.75]){const size=1.5/(15/64*(1-hardness)),a=brushStrokeCoverage(grid,[[128,96]],size-1e-6,hardness,{...ps,flow:1}),b=brushStrokeCoverage(grid,[[128,96]],size+1e-6,hardness,{...ps,flow:1});for(let i=0;i<a.length;i++)assert.ok(Math.abs(a[i]-b[i])<=1)}
 for(const size of [2,4,8,16]){const a=brushStrokeCoverage(grid,[[128,96]],size,0,{...ps,flow:1}),b=brushStrokeCoverage(grid,[[128,96]],size,1e-6,{...ps,flow:1});for(let i=0;i<a.length;i++)assert.ok(Math.abs(a[i]-b[i])<=1)}
})
