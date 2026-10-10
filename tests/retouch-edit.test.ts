import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import {actionSchema,EditorError,type EditAction,type Layer} from '../src/shared/contracts'
import {healPremultiplied} from '../src/shared/native-heal'
import {warpPremultiplied} from '../src/shared/native-warp'
import {prepareRetouch,type RetouchAction} from '../src/core/retouch-edit'
import {blankPNG,encodeRaster,documentPoint,sourcePoint} from '../src/core/raster-edit'
import {compactStroke,type StrokePoint} from '../src/shared/stroke-compaction'
function action(id:string,fields:Record<string,unknown>):RetouchAction{return actionSchema.parse({type:'layer.retouch',layerId:id,kind:'clone',points:[[15.5,4.5]],sourceAnchor:[1.5,4.5],size:1,hardness:1,opacity:1,protectAlpha:false,...fields}) as RetouchAction}
function setup(){const editor=new Editor(),png=blankPNG(24,16);for(let y=0;y<16;y++)for(let x=0;x<24;x++)png.data.set([x*10,y*10,10,255],(y*24+x)*4);editor.importPNG(encodeRaster(png),'retouch');return {editor,id:editor.state().manifest.activeLayerID!,png}}
function apply(editor:Editor,action:EditAction){return editor.apply({...editor.identity(),action})}
test('Spot Healing matches nine independently compiled native C references, including three modes, opacity/alpha and multiscale solve',async()=>{
 const fixtures=JSON.parse(await readFile('fixtures/parity/native-1.4.8-healing.json','utf8'));assert.equal(fixtures.rows.length,9)
 for(const row of fixtures.rows){const input=Uint8Array.from(row.rgba),before=new Uint8Array(input),result=healPremultiplied(input,Uint8Array.from(row.coverage),row.width,row.height,row.opacity,row.mode,row.seed);assert.deepEqual(result,Uint8Array.from(row.expected),`${row.mode}/${row.width}/${row.opacity}`);assert.deepEqual(input,before)}
})
test('Smudge carried brush and Liquify inverse field match independently executed native CPU WarpStroke references',async()=>{
 const fixture=JSON.parse(await readFile('fixtures/parity/native-1.4.8-warp.json','utf8'));assert.equal(fixture.rows.length,16)
 for(const row of fixture.rows){const input=Uint8Array.from(row.rgba),before=new Uint8Array(input),result=warpPremultiplied({width:row.width,height:row.height,data:input},row);let maximum=0;for(let i=0;i<result.length;i++)maximum=Math.max(maximum,Math.abs(result[i]-row.expected[i]));assert.ok(maximum<=1,`${row.mode}/${row.strength}/${row.hardness}: ${maximum}`);assert.deepEqual(input,before)}
})
test('aligned Clone retains an explicit document offset while nonaligned starts again at source; whole stroke opacity is capped',()=>{
 const {editor,id}=setup(),stage=editor.snapshot(),aligned=PNG.sync.read(prepareRetouch({...stage,selection:null},action(id,{sourceOffset:[-5,0],aligned:true})).png),nonaligned=PNG.sync.read(prepareRetouch({...stage,selection:null},action(id,{sourceOffset:[-5,0],aligned:false})).png)
 assert.equal(aligned.data[(4*24+15)*4],100);assert.equal(nonaligned.data[(4*24+15)*4],10)
 const capped=PNG.sync.read(prepareRetouch({...stage,selection:null},action(id,{opacity:.5,points:[[15.5,4.5],[15.5,4.5],[15.5,4.5]]})).png);assert.equal(capped.data[(4*24+15)*4],80)
})
test('Clone All Layers samples the exact document composite and handles rotated/flipped destination geometry without mutating snapshots',()=>{
 const {editor,id,png}=setup(),transform={origin:[20,30] as [number,number],size:[48,32] as [number,number],rotation:27,flipX:true,flipY:false,sampling:'High quality' as const};editor.create(100,100);editor.importPNG(encodeRaster(png),'target');const targetId=editor.state().manifest.activeLayerID!;apply(editor,{type:'document.canvas_size',width:100,height:100,anchor:'top-left'});apply(editor,{type:'layer.set_transform',layerId:targetId,transform});const stage=editor.snapshot(),layer=stage.manifest.layers[0],point=documentPoint({transform} as Layer,15.5,4.5,24,16),composite=blankPNG(100,100);for(let at=0;at<composite.data.length;at+=4)composite.data.set([17,201,73,255],at)
 const input=action(targetId,{points:[point],size:2,sourceAnchor:[point[0]-5,point[1]],sourceMode:'all-layers'});const before=Buffer.from(composite.data),result=prepareRetouch({...stage,selection:null},input,composite),output=PNG.sync.read(result.png),pixel=sourcePoint({transform:result.transform},...point,output.width,output.height),at=(Math.floor(pixel[1])*output.width+Math.floor(pixel[0]))*4;assert.deepEqual([...output.data.subarray(at,at+4)],[17,201,73,255]);assert.deepEqual(composite.data,before);assert.deepEqual(stage.manifest.layers[0].transform,layer.transform)
 assert.throws(()=>prepareRetouch({...stage,selection:null},input),e=>e instanceof EditorError&&e.code==='ASYNC_OPERATION_REQUIRED');assert.throws(()=>apply(editor,input),e=>e instanceof EditorError&&e.code==='ASYNC_OPERATION_REQUIRED');void id
})
test('Gaussian Blur paints a radius-controlled frozen sample once, including gray masks, and exact editor undo restores both pixels and metadata',()=>{
 const {editor,id}=setup();apply(editor,{type:'layer.mask',layerId:id,operation:'reveal'});apply(editor,{type:'layer.paint',layerId:id,target:'mask',points:[[12,8]],color:[0,0,0,1],size:3,hardness:1,opacity:1,erase:false});const before=editor.snapshot(),maskFile=before.manifest.layers[0].maskFile!,blur=action(id,{kind:'blur',target:'mask',points:[[12,8],[12,8]],size:10,blurRadius:2,sourceAnchor:undefined}),prepared=prepareRetouch({...before,selection:null},blur),transaction=apply(editor,blur),after=editor.snapshot(),stored=after.assets.get(maskFile)!,actual=PNG.sync.read(stored.bytes);assert.deepEqual(stored.bytes,prepared.png);assert.equal(stored.bytes[25],0);assert.ok(actual.data.some((v,i)=>i%4===0&&v>0&&v<255));assert.deepEqual(after.assets.get(before.manifest.layers[0].imageFile!),before.assets.get(before.manifest.layers[0].imageFile!));editor.history({...editor.identity(),direction:'undo',transactionId:transaction.transactionId});assert.deepEqual(editor.snapshot().assets.get(maskFile),before.assets.get(maskFile));editor.history({...editor.identity(),direction:'redo'});assert.deepEqual(editor.snapshot().assets.get(maskFile),stored)
 const stage={...before,selection:null},once=prepareRetouch(stage,action(id,{kind:'blur',points:[[12,8]],size:10,blurRadius:1})),repeated=prepareRetouch(stage,action(id,{kind:'blur',points:[[12,8],[12,8],[12,8]],size:10,blurRadius:1}));assert.deepEqual(once.png,repeated.png)
 assert.throws(()=>prepareRetouch(stage,action(id,{kind:'smear',target:'mask'})),/image pixels/)
})
test('retouch growth preserves rotated/flipped source placement and carries linked masks; selection clips edits in document coordinates',()=>{
 const {editor,id}=setup();apply(editor,{type:'layer.mask',layerId:id,operation:'reveal'});apply(editor,{type:'layer.paint',layerId:id,target:'mask',points:[[12,8]],color:[0,0,0,1],size:3,hardness:1,opacity:1,erase:false});apply(editor,{type:'document.canvas_size',width:100,height:100,anchor:'top-left'});apply(editor,{type:'layer.set_transform',layerId:id,transform:{origin:[20,20],size:[24,16],rotation:0,flipX:false,flipY:false,sampling:'High quality'}});const stage=editor.snapshot(),point:[number,number]=[17.5,24.5],input=action(id,{points:[point],sourceAnchor:[24.5,24.5],size:3}),result=prepareRetouch({...stage,selection:null},input),output=PNG.sync.read(result.png);assert.ok(output.width>24);assert.ok(result.transform.origin[0]<20);assert.ok(result.maskPNG);const newPixel=sourcePoint({transform:result.transform},...point,output.width,output.height),at=(Math.floor(newPixel[1])*output.width+Math.floor(newPixel[0]))*4;assert.equal(output.data[at+3],255);assert.equal(output.data[at],40)
 const rotated={origin:[30,30] as [number,number],size:[24,16] as [number,number],rotation:31,flipX:true,flipY:true,sampling:'High quality' as const};apply(editor,{type:'layer.set_transform',layerId:id,transform:rotated});const rotatedStage=editor.snapshot(),outside=documentPoint({transform:rotated} as Layer,-2.5,4.5,24,16),sourceDoc=documentPoint({transform:rotated} as Layer,4.5,4.5,24,16),grown=prepareRetouch({...rotatedStage,selection:null},action(id,{points:[outside],sourceAnchor:sourceDoc,size:3})),grownPNG=PNG.sync.read(grown.png),oldDoc=documentPoint({transform:rotated} as Layer,12.5,8.5,24,16),oldPixel=sourcePoint({transform:grown.transform},...oldDoc,grownPNG.width,grownPNG.height),restored=documentPoint({transform:grown.transform} as Layer,...oldPixel,grownPNG.width,grownPNG.height);assert.ok(Math.abs(restored[0]-oldDoc[0])<1e-9);assert.ok(Math.abs(restored[1]-oldDoc[1])<1e-9);assert.deepEqual([...grownPNG.data.subarray((Math.floor(oldPixel[1])*grownPNG.width+Math.floor(oldPixel[0]))*4,(Math.floor(oldPixel[1])*grownPNG.width+Math.floor(oldPixel[0]))*4+4)],[120,80,10,255]);assert.ok(grown.maskPNG)
 const clipped=prepareRetouch({...stage,selection:{inverted:false,shapes:[{kind:'rectangle',bounds:[0,0,1,1],operation:'replace',feather:0}]}},action(id,{points:[[35.5,24.5]],sourceAnchor:[21.5,24.5]}));assert.deepEqual(PNG.sync.read(clipped.png).data,PNG.sync.read(stage.assets.get(stage.manifest.layers[0].imageFile!)!.bytes).data)
})
test('Editor Healing Brush accepts a retained >2048-point reversal path, reaches its final tip and undoes as one transaction',()=>{
 const editor=new Editor(),png=blankPNG(24,16)
 for(let y=0;y<16;y++)for(let x=0;x<24;x++)png.data.set([x*10,y*10,(x+y)%3*80,255],(y*24+x)*4)
 editor.importPNG(encodeRaster(png),'healing long stroke');const id=editor.state().manifest.activeLayerID!,before=editor.snapshot(),beforeState=editor.state()
 const points:[number,number][]=Array.from({length:4097},(_,i)=>i%2?[17.5,7.5]:[16.5,6.5]);points.push([20.5,6.5])
 const result=apply(editor,action(id,{kind:'heal',points,sourceAnchor:[2.5,3.5],size:1,protectAlpha:true})),after=editor.snapshot(),out=PNG.sync.read(after.assets.get(after.manifest.layers[0].imageFile!)!.bytes)
 assert.equal(result.status,'applied');assert.equal(editor.state().revision,beforeState.revision+1);assert.equal(out.width,24);assert.equal(out.height,16)
 assert.notDeepEqual([...out.data.subarray((6*24+20)*4,(6*24+20)*4+3)],[...png.data.subarray((6*24+20)*4,(6*24+20)*4+3)],'The tail beyond every repeated reversal must be painted')
 assert.equal(out.data[(6*24+20)*4+2],20,'The final tip samples the source with the initial mean-color healing offset')
 editor.history({...editor.identity(),direction:'undo',transactionId:result.transactionId});assert.deepEqual(editor.snapshot().manifest,before.manifest);assert.deepEqual(editor.snapshot().assets,before.assets)
})
test('Editor Smudge preserves collinear return travel: >2048 dense vertices equal the complete short path pixel for pixel',()=>{
 const critical:StrokePoint[]=[[6,8],[18,8],[6,8],[18,8]],dense:StrokePoint[]=[[6,8]]
 for(let leg=0;leg<3;leg++)for(let step=1;step<=1000;step++)dense.push([leg%2?18-12*step/1000:6+12*step/1000,8])
 assert.ok(dense.length>2048);assert.deepEqual(compactStroke(critical),critical);assert.deepEqual(compactStroke(dense),critical)
 function execute(points:StrokePoint[]){
  const {editor,id}=setup(),before=editor.snapshot(),state=editor.state(),result=apply(editor,action(id,{kind:'smear',smearMode:'smudge',points,size:4,hardness:1,opacity:.7,protectAlpha:true,sourceAnchor:undefined})),snapshot=editor.snapshot(),layer=snapshot.manifest.layers[0],out=PNG.sync.read(snapshot.assets.get(layer.imageFile!)!.bytes)
  assert.equal(result.status,'applied');assert.equal(editor.state().revision,state.revision+1)
  editor.history({...editor.identity(),direction:'undo',transactionId:result.transactionId});assert.deepEqual(editor.snapshot().manifest,before.manifest);assert.deepEqual(editor.snapshot().assets,before.assets)
  return {out,transform:layer.transform}
 }
 const short=execute(critical),long=execute(dense),singlePass=execute(critical.slice(0,2))
 assert.deepEqual(long.out.data,short.out.data);assert.deepEqual(long.transform,short.transform)
 assert.notDeepEqual(short.out.data,singlePass.out.data,'Returning with a carried brush must differ from dropping both return legs')
})
test('Editor Healing Brush accepts 100000 oversampled input vertices without dropping the last pixel',()=>{
 const editor=new Editor(),png=blankPNG(24,16)
 for(let y=0;y<16;y++)for(let x=0;x<24;x++)png.data.set([x*10,y*10,(x+y)%3*80,255],(y*24+x)*4)
 editor.importPNG(encodeRaster(png),'healing dense stroke');const id=editor.state().manifest.activeLayerID!
 const points:[number,number][]=Array.from({length:100_000},(_,i)=>[16.5+4*i/99_999,6.5]),request=action(id,{kind:'heal',points,sourceAnchor:[2.5,3.5],size:1,protectAlpha:true})
 assert.equal(request.points.length,100_000);const result=apply(editor,request),snapshot=editor.snapshot(),out=PNG.sync.read(snapshot.assets.get(snapshot.manifest.layers[0].imageFile!)!.bytes)
 assert.equal(result.status,'applied');assert.equal(out.data[(6*24+20)*4+2],20)
})
test('Editor Healing Brush rejects a legal 100000-vertex path exceeding the stamp budget with the whole state preserved',()=>{
 const {editor,id}=setup(),before=editor.snapshot(),state=editor.state()
 const points:[number,number][]=Array.from({length:100_000},(_,i)=>i===99_999?[20.5,6.5]:i%2?[17.5,7.5]:[16.5,6.5]),request=action(id,{kind:'heal',points,sourceAnchor:[2.5,3.5],size:1,protectAlpha:true})
 assert.equal(request.points.length,100_000)
 assert.throws(()=>apply(editor,request),error=>error instanceof EditorError&&error.code==='RESOURCE_LIMIT'&&error.message.includes('sample budget'))
 assert.deepEqual(editor.snapshot(),before);assert.deepEqual(editor.state(),state)
})
