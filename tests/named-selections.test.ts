import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {z} from 'zod'
import {Editor} from '../src/core/editor'
import {validateManifest} from '../src/core/manifest'
import {actionSchema,mutationSchema,batchSchema,EditorError} from '../src/shared/contracts'
import {namedSelectionsSchema,NAMED_SELECTION_LIMITS,type NamedSelection} from '../src/shared/named-selections'
import {namedSelectionAsSelection} from '../src/core/named-selections'
import {selectionCoverage} from '../src/shared/selection-coverage'
import type {Selection} from '../src/shared/pixel-contracts'

const apply=(editor:Editor,action:unknown)=>editor.apply({...editor.identity(),action})
function create(width=4,height=1):Editor{const editor=new Editor();editor.create(width,height);return editor}
function gray(values:number[],height=1):Selection{
 const width=values.length/height,runs:NamedSelection['runs']=[]
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const value=values[y*width+x];if(value)runs.push([y,x,1,value])}
 return namedSelectionAsSelection({name:'Sample',width,height,runs})
}
function set(editor:Editor,values:number[],height=1):void{apply(editor,{type:'selection.set',selection:gray(values,height)})}
function coverage(editor:Editor):number[]{const {manifest,selection}=editor.state();return Array.from({length:manifest.width*manifest.height},(_,i)=>Math.round(selectionCoverage(selection,i%manifest.width+.5,Math.floor(i/manifest.width)+.5)*255))}
function save(editor:Editor,name='Original'):void{apply(editor,{type:'selection.save_named',name})}
function load(editor:Editor,name='Original',operation='replace'):void{apply(editor,{type:'selection.load_named',name,operation})}

test('named grayscale channels preserve 0, 64, 128 and 255 coverage without thresholding or double feathering',()=>{
 const editor=create();set(editor,[0,64,128,255]);save(editor);apply(editor,{type:'selection.set',selection:null});load(editor)
 assert.deepEqual(coverage(editor),[0,64,128,255]);assert.equal(editor.state().selection?.feather,0);assert.equal(editor.state().manifest.namedSelections?.[0].runs.length,3)
})
test('capture freezes actual feather, curved antialias and inverse coverage at pixel centers',()=>{
 const editor=create(12,8),selection:Selection={shapes:[{kind:'ellipse',bounds:[2.25,1.5,6,4],operation:'replace',feather:0}],inverted:true,antialiased:true,feather:1.5,canvasSize:[12,8]}
 apply(editor,{type:'selection.set',selection});const before=coverage(editor);assert.ok(before.some(value=>value>0&&value<255));save(editor);load(editor);assert.deepEqual(coverage(editor),before)
})
test('replace/add/subtract/intersect combine actual gray values and preserve existing feathered coverage',()=>{
 const editor=create();set(editor,[0,64,128,255]);save(editor)
 for(const [operation,expected] of [['replace',[0,64,128,255]],['add',[128,128,128,255]],['subtract',[128,96,64,0]],['intersect',[0,32,64,128]]] as const){set(editor,[128,128,128,128]);load(editor,'Original',operation);assert.deepEqual(coverage(editor),expected)}
 apply(editor,{type:'selection.set',selection:null});load(editor,'Original','subtract');assert.deepEqual(coverage(editor),[0,0,0,0])
 apply(editor,{type:'selection.set',selection:null});load(editor,'Original','add');assert.deepEqual(coverage(editor),[0,64,128,255])
})
test('combining loaded selection keeps inverted and feathered current coverage instead of discarding its softness',()=>{
 const editor=create(12,8);apply(editor,{type:'selection.set',selection:{inverted:false,shapes:[{kind:'rectangle',operation:'replace',feather:0,bounds:[0,0,6,8]}]}});save(editor)
 apply(editor,{type:'selection.set',selection:{inverted:true,feather:1.2,canvasSize:[12,8],shapes:[{kind:'ellipse',operation:'replace',feather:0,bounds:[2,1,7,5]}]}})
 const before=coverage(editor);load(editor,'Original','intersect');assert.deepEqual(coverage(editor),before.map((value,i)=>i%12<6?value:0))
})
test('empty and full defined selections can be saved; deselection cannot accidentally become a full channel',()=>{
 const editor=create();assert.throws(()=>save(editor),/Create a selection/)
 apply(editor,{type:'selection.set',selection:{shapes:[],inverted:false}});save(editor,'Empty');load(editor,'Empty');assert.deepEqual(coverage(editor),[0,0,0,0])
 apply(editor,{type:'selection.invert'});save(editor,'Full');load(editor,'Full');assert.deepEqual(coverage(editor),[255,255,255,255])
})
test('names are trimmed, duplicate saves require explicit overwrite, rename collision is atomic',()=>{
 const editor=create();set(editor,[0,64,128,255]);save(editor,'  原始  ');save(editor,'Other');assert.equal(editor.state().manifest.namedSelections?.[0].name,'原始')
 const before=editor.snapshot();assert.throws(()=>save(editor,'原始'),/already uses/);assert.throws(()=>apply(editor,{type:'selection.rename_named',name:'原始',newName:'Other'}),/already uses/);assert.deepEqual(editor.snapshot(),before)
 set(editor,[255,0,0,0]);apply(editor,{type:'selection.save_named',name:'原始',overwrite:true});load(editor,'原始');assert.deepEqual(coverage(editor),[255,0,0,0])
 apply(editor,{type:'selection.rename_named',name:'原始',newName:'Renamed'});assert.equal(editor.state().manifest.namedSelections?.[0].name,'Renamed')
 assert.throws(()=>load(editor,'原始'),/no longer exists/);apply(editor,{type:'selection.delete_named',name:'Renamed'});assert.equal(editor.state().manifest.namedSelections?.length,1)
 apply(editor,{type:'selection.delete_named',name:'Other'});assert.equal(editor.state().manifest.namedSelections,undefined)
})
test('save/load/rename/delete use single undo transactions; retries are idempotent and redo restores channels',()=>{
 const editor=create();set(editor,[0,64,128,255]);const initial=editor.snapshot(),request={...editor.identity(),action:{type:'selection.save_named',name:'Original'}}
 const result=editor.apply(request);assert.deepEqual(editor.apply(request),result);assert.equal(editor.state().manifest.namedSelections?.length,1)
 editor.history({...editor.identity(),direction:'undo'});assert.deepEqual(editor.snapshot(),initial);editor.history({...editor.identity(),direction:'redo'});assert.equal(editor.state().manifest.namedSelections?.length,1)
 apply(editor,{type:'selection.rename_named',name:'Original',newName:'New'});editor.history({...editor.identity(),direction:'undo'});assert.equal(editor.state().manifest.namedSelections?.[0].name,'Original')
 apply(editor,{type:'selection.set',selection:null});load(editor);assert.deepEqual(coverage(editor),[0,64,128,255]);editor.history({...editor.identity(),direction:'undo'});assert.equal(editor.state().selection,null)
 apply(editor,{type:'selection.delete_named',name:'Original'});editor.history({...editor.identity(),direction:'undo'});assert.equal(editor.state().manifest.namedSelections?.[0].name,'Original')
})
test('MCP mutation and atomic batch schemas expose all four named actions as representable JSON schemas',()=>{
 const schema=z.toJSONSchema(mutationSchema),serialized=JSON.stringify(schema);for(const type of ['selection.save_named','selection.load_named','selection.rename_named','selection.delete_named'])assert.ok(serialized.includes(type))
 const editor=create();set(editor,[0,64,128,255]);const request={...editor.identity(),actions:[{type:'selection.save_named',name:'Original'},{type:'selection.set',selection:null},{type:'selection.load_named',name:'Original'},{type:'selection.rename_named',name:'Original',newName:'New'}]}
 assert.doesNotThrow(()=>batchSchema.parse(request));editor.applyBatch(request);assert.deepEqual(coverage(editor),[0,64,128,255]);assert.equal(editor.state().manifest.namedSelections?.[0].name,'New')
 const before=editor.snapshot();assert.throws(()=>editor.applyBatch({...editor.identity(),actions:[{type:'selection.delete_named',name:'New'},{type:'selection.load_named',name:'Missing'}]}),/no longer exists/);assert.deepEqual(editor.snapshot(),before)
})
test('named selections survive project save/reopen, load is selection-only while rename marks the project dirty',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'named-selections-'));try{
  const editor=create();set(editor,[0,64,128,255]);save(editor,'保存的灰度');const path=join(directory,'Named.comp');await editor.saveAs(path)
  const reopened=new Editor({journalDirectory:join(directory,'journal')});await reopened.open(path);assert.equal(reopened.state().selection,null);assert.deepEqual(reopened.state().manifest.namedSelections,editor.state().manifest.namedSelections)
  load(reopened,'保存的灰度');assert.deepEqual(coverage(reopened),[0,64,128,255]);assert.equal(reopened.state().modified,false)
  apply(reopened,{type:'selection.rename_named',name:'保存的灰度',newName:'Changed'});assert.equal(reopened.state().modified,true);await reopened.save()
  const manifest=JSON.parse(await readFile(join(path,'manifest.json'),'utf8'));assert.equal(manifest.namedSelections[0].name,'Changed');assert.equal(manifest.namedSelections[0].runs[1][3],128)
 }finally{await rm(directory,{recursive:true,force:true})}
})
test('crop and canvas anchoring shift and clip named channels and undo restores the original grid',()=>{
 const editor=create(4,2);set(editor,[64,128,0,255,255,0,128,64],2);save(editor);const before=editor.snapshot()
 apply(editor,{type:'document.crop',x:1,y:0,width:2,height:2});load(editor);assert.deepEqual(coverage(editor),[128,0,0,128]);editor.history({...editor.identity(),direction:'undo'});editor.history({...editor.identity(),direction:'undo'});assert.deepEqual(editor.snapshot(),before)
 apply(editor,{type:'document.canvas_size',width:6,height:4,anchor:'bottom-right'});load(editor);assert.deepEqual(coverage(editor),[0,0,0,0,0,0,0,0,0,0,0,0,0,0,64,128,0,255,0,0,255,0,128,64])
})
test('quarter turns and flips preserve exact gray values and dimensions',()=>{
 const editor=create(3,2);set(editor,[10,20,30,40,50,60],2);save(editor)
 apply(editor,{type:'document.rotate',clockwise:true});load(editor);assert.deepEqual(coverage(editor),[40,10,50,20,60,30]);assert.equal(editor.state().manifest.namedSelections?.[0].width,2)
 apply(editor,{type:'document.rotate',clockwise:false});load(editor);assert.deepEqual(coverage(editor),[10,20,30,40,50,60])
 apply(editor,{type:'document.flip',axis:'horizontal'});load(editor);assert.deepEqual(coverage(editor),[30,20,10,60,50,40])
 apply(editor,{type:'document.flip',axis:'vertical'});load(editor);assert.deepEqual(coverage(editor),[60,50,40,30,20,10])
})
test('image resizing follows native channel sampling and DPI-only edits retain original channel pixels',()=>{
 const editor=create(2,1);set(editor,[64,255]);save(editor)
 apply(editor,{type:'document.image_size',width:4,height:2,resolution:144,resample:true,sampling:'Nearest'});load(editor);assert.deepEqual(coverage(editor),[64,64,255,255,64,64,255,255])
 const channel=editor.state().manifest.namedSelections;apply(editor,{type:'document.image_size',width:999,height:999,resolution:300,resample:false,sampling:'Smooth'});assert.deepEqual(editor.state().manifest.namedSelections,channel)
})
test('schema rejects malformed runs, duplicate names, controls, oversize names and dimension mismatches',()=>{
 const valid:NamedSelection={name:'Valid',width:4,height:2,runs:[[0,0,2,128],[1,2,2,255]]}
 assert.ok(namedSelectionsSchema.safeParse([valid]).success)
 for(const runs of [[[0,3,2,255]],[[0,0,3,255],[0,2,1,128]],[[1,0,1,255],[0,0,1,255]],[[2,0,1,255]],[[0,0,1,0]]])assert.equal(namedSelectionsSchema.safeParse([{...valid,runs}]).success,false)
 assert.equal(namedSelectionsSchema.safeParse([valid,valid]).success,false)
 for(const name of ['', '  ', 'Bad\nName','X'.repeat(129)])assert.equal(actionSchema.safeParse({type:'selection.save_named',name}).success,false)
 const manifest=create(4,2).snapshot().manifest;assert.throws(()=>validateManifest({...manifest,namedSelections:[{...valid,width:5}]}),/match the document canvas/)
})
test('smooth channel resampling clamps source edges so a full selection remains full, rather than introducing transparent borders',()=>{
 const editor=create(2,1);set(editor,[64,255]);save(editor)
 apply(editor,{type:'document.image_size',width:4,height:2,resolution:72,resample:true,sampling:'Smooth'});load(editor);assert.deepEqual(coverage(editor),[64,112,207,255,64,112,207,255])
 const full=create(1,1);set(full,[255]);save(full);apply(full,{type:'document.image_size',width:4,height:3,resolution:72,resample:true,sampling:'High quality'});load(full);assert.ok(coverage(full).every(value=>value===255))
})
test('count, aggregate pixels and run limits reject changes atomically before retention grows',()=>{
 const editor=create(1,1);set(editor,[128]);for(let index=0;index<32;index++)save(editor,`S${index}`)
 const before=editor.snapshot();assert.throws(()=>save(editor,'Too many'),error=>error instanceof EditorError&&error.code==='RESOURCE_LIMIT');assert.deepEqual(editor.snapshot(),before)
 apply(editor,{type:'selection.save_named',name:'S0',overwrite:true});assert.equal(editor.state().manifest.namedSelections?.length,32)
 const channel:NamedSelection={name:'Large',width:10000,height:6000,runs:[]};assert.equal(namedSelectionsSchema.safeParse([channel,{...channel,name:'Other'}]).success,false)
 const runs=Array.from({length:60000},(_,i)=>[Math.floor(i/15000),i%15000*2,1,255] as [number,number,number,number]);assert.equal(namedSelectionsSchema.safeParse([{name:'One',width:30000,height:4,runs},{name:'Two',width:30000,height:4,runs}]).success,false)
 assert.equal(NAMED_SELECTION_LIMITS.maxBytes,2097152)
})
test('unrepresentable named selection capture rolls back the batch without modifying an earlier action',()=>{
 const editor=create(30000,4),runs=Array.from({length:100000},(_,i)=>[Math.floor(i/25000),i%25000,1,i%2?64:128] as [number,number,number,number]);set(editor,[255])
 const selection:Selection={inverted:false,shapes:[{kind:'raster',operation:'replace',feather:0,bounds:[0,0,30000,4],raster:{width:30000,height:4,transform:{origin:[0,0],size:[30000,4],rotation:0,flipX:false,flipY:false},runs}},{kind:'rectangle',operation:'add',feather:0,bounds:[29000,0,1,4]}]}
 apply(editor,{type:'selection.set',selection});const before=editor.snapshot()
 assert.throws(()=>editor.applyBatch({...editor.identity(),actions:[{type:'document.guides',guides:[]},{type:'selection.save_named',name:'Too detailed'}]}),/coverage run budget/);assert.deepEqual(editor.snapshot(),before)
})
test('combined manifest bytes budget prevents named selections from creating an unsaveable project',()=>{
 const editor=create(1,1),manifest=editor.snapshot().manifest;manifest.opaqueMetadata='x'.repeat(4*1024*1024-JSON.stringify(manifest).length-20)
 editor.restore(manifest,new Map(),'Budget');set(editor,[255]);const before=editor.snapshot();assert.throws(()=>save(editor),/4 MiB limit/);assert.deepEqual(editor.snapshot(),before)
})
test('geometry growth rejects aggregate named channel pixel budgets and leaves document dimensions unchanged',()=>{
 const editor=create(2,2);set(editor,[0,64,128,255],2);save(editor);const before=editor.snapshot();assert.throws(()=>apply(editor,{type:'document.canvas_size',width:10000,height:10000,anchor:'center'}),/coverage pixel budget/);assert.deepEqual(editor.snapshot(),before)
})
