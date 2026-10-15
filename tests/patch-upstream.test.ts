import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {patchFillPremultiplied} from '../src/shared/native-patch-fill'
const fixture=JSON.parse(readFileSync('fixtures/parity/native-6aea90a-patch.json','utf8'))
for(const row of fixture.rows)test(`latest C PatchPixels ${row.name}/${row.seed}`,()=>{
 const rgba=Buffer.from(row.inputRGBA,'base64'),mask=Buffer.from(row.coverage,'base64'),before=Buffer.from(rgba),maskBefore=Buffer.from(mask)
 const result=patchFillPremultiplied(rgba,mask,row.width,row.height,{seed:row.seed})
 assert.equal(result.status,row.status);const expected=Buffer.from(row.expectedRGBA,'base64');let maximum=0,different=0;for(let i=0;i<expected.length;i++){maximum=Math.max(maximum,Math.abs(result.data[i]-expected[i]));if(result.data[i]!==expected[i])different++}
 assert.equal(maximum,0,`${different} bytes differ, maximum ${maximum}, levels ${result.levels}, work ${result.work}`)
 assert.deepEqual(rgba,before);assert.deepEqual(mask,maskBefore)
 for(let p=0;p<mask.length;p++)if(!mask[p])assert.deepEqual(result.data.subarray(p*4,p*4+4),new Uint8Array(rgba.subarray(p*4,p*4+4)))
})
import {healPremultiplied} from '../src/shared/native-heal'
const healing=JSON.parse(readFileSync('fixtures/parity/native-6aea90a-healing.json','utf8'))
for(const row of healing.rows)test(`latest C HealPixels ${row.name}/${row.mode}`,()=>{
 const input=Buffer.from(row.inputRGBA,'base64'),mask=Buffer.from(row.coverage,'base64'),before=Buffer.from(input),coverageBefore=Buffer.from(mask)
 const output=healPremultiplied(input,mask,row.width,row.height,row.opacity,row.mode,row.seed)
 assert.equal(row.status,0);assert.deepEqual(Buffer.from(output),Buffer.from(row.expectedRGBA,'base64'));assert.deepEqual(input,before);assert.deepEqual(mask,coverageBefore)
})
import {EditorError} from '../src/shared/errors'
import {contentAwareFill} from '../src/core/content-fill'
const errorCode=(code:string)=>(error:unknown)=>error instanceof EditorError&&error.code===code
test('latest default content fill uses native patch engine and preserves every unselected PNG byte',()=>{
 const row=fixture.rows[0],data=Buffer.from(row.inputRGBA,'base64'),coverage=Buffer.from(row.coverage,'base64');data.set([217,23,199,0],0)
 const before=Buffer.from(data),result=contentAwareFill({width:row.width,height:row.height,data},{width:row.width,height:row.height,coverage})
 assert.equal(result.algorithm,'compositor-multiscale-patchmatch-6aea90a');assert.deepEqual([...result.png.data.subarray(0,4)],[217,23,199,0]);assert.deepEqual(data,before)
})
test('operation and retained backing budgets reject atomically; cancellation checks protect Buffer input',()=>{
 const row=fixture.rows[0],rgba=Buffer.from(row.inputRGBA,'base64'),mask=Buffer.from(row.coverage,'base64'),before=Buffer.from(rgba),beforeMask=Buffer.from(mask)
 assert.throws(()=>patchFillPremultiplied(rgba,mask,row.width,row.height,{maximumWork:NaN}),errorCode('INVALID_ARGUMENT'))
 assert.throws(()=>patchFillPremultiplied(rgba,mask,row.width,row.height,{seed:NaN}),errorCode('INVALID_ARGUMENT'))
 assert.throws(()=>patchFillPremultiplied(rgba,mask,row.width,row.height,{maximumWork:20_000}),errorCode('RESOURCE_LIMIT'))
 assert.throws(()=>patchFillPremultiplied(rgba,mask,row.width,row.height,{signal:AbortSignal.abort()}),errorCode('CANCELED'))
 let count=0;const signal={get aborted(){return ++count>500}} as AbortSignal
 assert.throws(()=>patchFillPremultiplied(rgba,mask,row.width,row.height,{signal}),errorCode('CANCELED'))
 assert.deepEqual(rgba,before);assert.deepEqual(mask,beforeMask)
 const backing=new SharedArrayBuffer(512*1024*1024),data=new Uint8Array(backing,0,4),coverage=new Uint8Array(backing,4,1);data.set([10,20,30,255]);coverage[0]=255
 assert.throws(()=>patchFillPremultiplied(data,coverage,1,1),errorCode('RESOURCE_LIMIT'));assert.equal(coverage[0],255);assert.deepEqual([...data],[10,20,30,255])
 assert.throws(()=>contentAwareFill({width:NaN,height:1,data:rgba},{width:NaN,height:1,coverage:mask}),errorCode('INVALID_ARGUMENT'))
})
import {Editor} from '../src/core/editor'
import {PNG} from 'pngjs'
import {actionSchema} from '../src/shared/contracts'
test('default Spot Healing publishes latest kernel pixels as one undoable editor transaction',()=>{
 const row=fixture.rows.find((r:{seed:number})=>r.seed===0),png=new PNG({width:row.width,height:row.height});png.data.set(Buffer.from(row.inputRGBA,'base64'));const editor=new Editor();editor.importPNG(PNG.sync.write(png),'latest healing')
 const before=editor.snapshot(),layerId=editor.state().manifest.activeLayerID!,action=actionSchema.parse({type:'layer.retouch',layerId,kind:'spot-heal',points:[[32.5,24.5]],size:5,hardness:1,opacity:1,protectAlpha:false,healingMode:'content-aware',seed:0}),transaction=editor.apply({...editor.identity(),action}),after=editor.snapshot(),imageFile=after.manifest.layers[0].imageFile!
 assert.notDeepEqual(after.assets.get(imageFile)?.bytes,before.assets.get(imageFile)?.bytes)
 editor.history({...editor.identity(),direction:'undo',transactionId:transaction.transactionId});assert.deepEqual(editor.snapshot().manifest,before.manifest);assert.deepEqual(editor.snapshot().assets,before.assets)
 editor.history({...editor.identity(),direction:'redo'});assert.deepEqual(editor.snapshot().assets,after.assets)
})
