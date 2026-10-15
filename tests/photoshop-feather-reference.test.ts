import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {inflateSync} from 'node:zlib'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Editor} from '../src/core/editor'
import {appendSelectionFeather,appendSelectionShape} from '../src/shared/selection-composition'
import {selectionFeatherHalo} from '../src/shared/selection-gaussian'
import {selectionSchema,type Selection} from '../src/shared/pixel-contracts'
import {coverageBytes,coverageError,featherFixture,referenceAlpha,referenceSelection} from './helpers/photoshop-feather-reference'
const sha=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex')
test('feather references preserve actual Photoshop output provenance and exclude cancelled output',()=>{
 const p=featherFixture.provenance;assert.equal(p.application,'Adobe Photoshop 27.11.0');assert.equal(featherFixture.rows.length,21);assert.equal(sha(p.nativeLog),p.nativeLogSHA256);assert.equal(sha(readFileSync(p.scriptPath)),p.scriptSHA256);assert.equal(sha(inflateSync(Buffer.from(p.source.rgbaZlib,'base64'))),p.source.rgbaSHA256);assert.ok(!featherFixture.rows.some(row=>row.name==='full-f20'));assert.match(p.nativeLog,/full-f20\tFAIL/)
})
for(const row of featherFixture.rows)test(`actual Photoshop selection alpha: ${row.name}`,()=>{
 const expected=referenceAlpha(row);assert.equal(expected.length,row.width*row.height);assert.equal(sha(expected),row.alphaSHA256)
 const ps=coverageBytes(selectionSchema.parse(referenceSelection(row,'photoshop')),row.width,row.height),legacy=coverageBytes(referenceSelection(row),row.width,row.height),error=coverageError(ps,expected)
 // Per-case ceilings are recorded from the independent Photoshop run. Broad
 // Gaussian similarity is insufficient; canvas edges, holes and repeats differ.
 assert.ok(error.max<=row.measuredPhotoshop.max,`${row.name}: max ${error.max}`);assert.ok(error.mae<=row.measuredPhotoshop.MAE+1e-10,`${row.name}: MAE ${error.mae}`)
 assert.equal(sha(legacy),row.measuredLegacy.coverageSHA256,'Untagged saved projects retain exact prior coverage')
 assert.deepEqual(coverageBytes(referenceSelection(row,'compositor'),row.width,row.height),legacy)
})
test('profile conversion preserves old sigma, including shape-only legacy feather and explicit zero action',()=>{
 const row=featherFixture.rows.find(row=>row.name==='center-f10')!,legacy=referenceSelection(row),bytes=coverageBytes(legacy,row.width,row.height)
 const migrated=appendSelectionFeather(legacy,row.width,row.height,0,'photoshop');assert.equal(migrated.feather,5);assert.equal(migrated.featherModel,'photoshop');assert.deepEqual(coverageBytes(migrated,row.width,row.height),bytes)
 const shapeOnly={...legacy,feather:undefined,shapes:legacy.shapes.map(shape=>({...shape,feather:10}))};const combined=appendSelectionFeather(shapeOnly,row.width,row.height,3,'photoshop');assert.equal(combined.feather,Math.hypot(5,3));assert.deepEqual(coverageBytes(combined,row.width,row.height),coverageBytes({...referenceSelection(row,'photoshop'),feather:Math.hypot(5,3)},row.width,row.height))
})
test('Photoshop creation, composition and ROI preserve final coverage independently from old model',()=>{
 const previous:Selection={inverted:false,feather:10,canvasSize:[256,192],shapes:[{kind:'rectangle',operation:'replace',bounds:[32,32,80,80],feather:0}]},newShape:Selection['shapes'][number]={kind:'ellipse',operation:'replace',feather:10,bounds:[64,48,100,96]},original=structuredClone(previous),a=coverageBytes(previous,256,192),b=coverageBytes(appendSelectionShape(null,newShape,256,192,true,'photoshop'),256,192)
 for(const operation of ['add','subtract','intersect'] as const){const output=appendSelectionShape(previous,{...newShape,operation},256,192,true,'photoshop'),bytes=coverageBytes(output,256,192);for(let at=0;at<bytes.length;at++){const expected=operation==='add'?Math.max(a[at],b[at]):operation==='subtract'?Math.round(a[at]*(1-b[at]/255)):Math.round(a[at]*b[at]/255);assert.ok(Math.abs(bytes[at]-expected)<=1,`${operation}/${at}`)}assert.equal(output.featherModel,'photoshop')}
 assert.deepEqual(previous,original);assert.equal(selectionFeatherHalo({...previous,featherModel:'photoshop'}),41);assert.equal(selectionFeatherHalo(previous),21)
 const sparse=appendSelectionShape(null,{kind:'rectangle',operation:'add',bounds:[500,500,8,8],feather:40},10000,10000,false,'photoshop');assert.equal(sparse.shapes[0].raster?.width,330);assert.equal(sparse.shapes[0].raster?.height,330)
})
test('switching away from a large Photoshop radius bakes old coverage before applying legacy blur',()=>{
 const row=featherFixture.rows.find(row=>row.name==='center-f20')!,previous={...referenceSelection(row,'photoshop'),feather:150},expected=coverageBytes(previous,row.width,row.height),result=appendSelectionFeather(previous,row.width,row.height,0,'compositor');assert.equal(result.featherModel,'compositor');assert.equal(result.feather,0);assert.equal(result.shapes[0].kind,'raster');assert.deepEqual(coverageBytes(result,row.width,row.height),expected)
})
test('Photoshop feather repeated action supports Undo/Redo, named selection and reopening without image mutation',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'photoshop-feather-'));try{
  const row=featherFixture.rows.find(row=>row.name==='repeat-f10')!,editor=new Editor();editor.create(row.width,row.height);const assets=editor.state().assets.map(asset=>[asset.file,asset.hash]);const first={...referenceSelection(row,'photoshop'),feather:10};editor.apply({...editor.identity(),action:{type:'selection.set',selection:first}});const firstBytes=coverageBytes(editor.state().selection,row.width,row.height)
  editor.apply({...editor.identity(),action:{type:'selection.modify',operation:'feather',amount:10,featherModel:'photoshop'}});const repeated=coverageBytes(editor.state().selection,row.width,row.height);assert.deepEqual(repeated,coverageBytes(referenceSelection(row,'photoshop'),row.width,row.height));assert.ok(coverageError(repeated,referenceAlpha(row)).max<=2)
  editor.history({...editor.identity(),direction:'undo'});assert.deepEqual(coverageBytes(editor.state().selection,row.width,row.height),firstBytes);editor.history({...editor.identity(),direction:'redo'});assert.deepEqual(coverageBytes(editor.state().selection,row.width,row.height),repeated)
  editor.apply({...editor.identity(),action:{type:'selection.save_named',name:'PS feather'}});const file=join(directory,'Photoshop feather.comp');await editor.saveAs(file);const reopened=new Editor();await reopened.open(file);reopened.apply({...reopened.identity(),action:{type:'selection.load_named',name:'PS feather'}});assert.deepEqual(coverageBytes(reopened.state().selection,row.width,row.height),repeated);assert.deepEqual(reopened.state().assets.map(asset=>[asset.file,asset.hash]),assets)
 }finally{await rm(directory,{recursive:true,force:true})}
})
