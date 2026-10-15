import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {Editor} from '../src/core/editor'
import {blankPNG,encodeRaster} from '../src/core/raster-edit'
import {makeAsset} from '../src/core/project-io'
import {applyMaskOperation} from '../src/core/mask-operations'
import type {PixelStage} from '../src/core/pixel-actions'
import {selectionCoverage} from '../src/shared/selection-coverage'
import {mergeSelectionPlan,selectionBounds} from '../src/core/layer-operations'
import {alignLayers,distributeLayers} from '../src/core/layer-layout'
import {clientToDocument,documentToClient,rotatedViewport} from '../src/renderer/rotated-view'
import {planViewportRender} from '../src/renderer/viewport-render'
import {loadInteractionProfile,profileCommands,thumbnailSelectionOperation} from '../src/renderer/interaction-profile'
import {commandForKey,eventChord,shortcutProblem,type WorkspaceCommand} from '../src/renderer/command-shortcuts'
const apply=(editor:Editor,action:unknown)=>editor.apply({...editor.identity(),action})
function setup(){const e=new Editor();e.create(24,16);for(const name of ['Bottom','Middle','Top'])e.contentRaster(e.identity(),encodeRaster(blankPNG(4,4,255)),{name});return e}

test('Photoshop is the new default, while legacy profile and custom keys remain separate',()=>{
 assert.equal(loadInteractionProfile({getItem:()=>null}),'photoshop');assert.equal(loadInteractionProfile({getItem:()=> 'compositor'}),'compositor')
 const commands:WorkspaceCommand[]=[{id:'cycle-tool',title:'Cycle',shortcut:'tab'},{id:'export-as',title:'Export',shortcut:'Primary+Shift+e'},{id:'merge-visible',title:'Merge Visible'},{id:'toggle-panels',title:'Panels'},{id:'toggle-side-panels',title:'Side Panels'},{id:'tool:smear',title:'Smear',shortcut:'r'},{id:'tool:rotate-view',title:'Rotate View'},{id:'cycle-shape',title:'Shape',shortcut:'Shift+u'},{id:'cycle-group:u',title:'Shapes'},{id:'flow:2',title:'Flow 20'}]
 const ps=profileCommands(commands,'photoshop');assert.equal(shortcutProblem(ps,{}),undefined)
 const event={key:'E',metaKey:true,ctrlKey:false,altKey:false,shiftKey:true}
 assert.equal(commandForKey(ps,{},event,'mac')?.id,'merge-visible')
 assert.equal(commandForKey(profileCommands(commands,'compositor'),{},event,'mac')?.id,'export-as')
 assert.equal(commandForKey(ps,{'export-as':'Primary+Shift+p'},{...event,key:'P'},'mac')?.id,'export-as')
 assert.equal(eventChord({key:'!',metaKey:false,ctrlKey:false,altKey:false,shiftKey:true},'mac'),'Shift+1')
 assert.equal(commandForKey(ps,{}, {...event,key:'Tab',metaKey:false,shiftKey:false},'mac')?.id,'toggle-panels')
 assert.equal(shortcutProblem(profileCommands(commands,'compositor'),{}),undefined)
 const repeat=[{id:'repeat-filter',title:'Repeat'}];assert.equal(commandForKey(profileCommands(repeat,'photoshop',{},'mac'),{},{...event,key:'f',shiftKey:false,ctrlKey:true},'mac')?.id,'repeat-filter');assert.equal(commandForKey(profileCommands(repeat,'photoshop',{},'other'),{},{...event,key:'f',metaKey:false,ctrlKey:true,shiftKey:false,altKey:true},'other')?.id,'repeat-filter')
 assert.equal(commandForKey(ps,{}, {...event,key:'@',metaKey:false,shiftKey:true},'mac')?.id,'flow:2')
 const custom={'export-as':'Primary+Shift+e'}
 const withCustom=profileCommands(commands,'photoshop',custom)
 assert.equal(shortcutProblem(withCustom,custom),undefined)
 assert.equal(commandForKey(withCustom,custom,event,'mac')?.id,'export-as')
 assert.deepEqual(custom,{'export-as':'Primary+Shift+e'})
})
test('thumbnail modifiers support replace, add, subtract and triple-key intersection',()=>{
 assert.equal(thumbnailSelectionOperation({altKey:false,shiftKey:false}),'replace');assert.equal(thumbnailSelectionOperation({altKey:false,shiftKey:true}),'add');assert.equal(thumbnailSelectionOperation({altKey:true,shiftKey:false}),'subtract');assert.equal(thumbnailSelectionOperation({altKey:true,shiftKey:true}),'intersect')
})
test('Photoshop mask loading retains four gray coverages including empty and full masks',()=>{
 const e=setup(),id=e.state().manifest.layers[0].id;apply(e,{type:'layer.mask',layerId:id,operation:'reveal'})
 const stage:PixelStage={...e.snapshot(),selection:e.state().selection??null},layer=stage.manifest.layers[0],png=blankPNG(4,1)
 for(let x=0;x<4;x++){const v=[0,64,128,255][x];png.data.set([v,v,v,255],x*4)}
 stage.assets.set(layer.maskFile!,makeAsset(layer.maskFile!,encodeRaster(png,true)));layer.maskPlacement={...layer.transform,origin:[0,0],size:[4,1]}
 applyMaskOperation(stage,{type:'selection.from_mask',layerId:id,coverage:'visible',operation:'replace'})
 assert.deepEqual([0,1,2,3].map(x=>Math.round(selectionCoverage(stage.selection,x+.5,.5)*255)),[0,64,128,255])
 applyMaskOperation(stage,{type:'selection.from_mask',layerId:id,coverage:'hidden',operation:'replace'})
 assert.deepEqual([0,1,2,3].map(x=>Math.round(selectionCoverage(stage.selection,x+.5,.5)*255)),[255,255,0,0])
 png.data.fill(0);stage.assets.set(layer.maskFile!,makeAsset(layer.maskFile!,encodeRaster(png,true)))
 applyMaskOperation(stage,{type:'selection.from_mask',layerId:id,coverage:'visible',operation:'replace'});assert.equal(selectionCoverage(stage.selection,.5,.5),0)
})
test('alpha thumbnail subtract/intersect combine against the existing selection',()=>{
 const e=setup(),id=e.state().manifest.layers[0].id,layer=e.state().manifest.layers[0]
 apply(e,{type:'selection.set',selection:{inverted:false,shapes:[{kind:'rectangle',operation:'replace',feather:0,bounds:[0,0,24,16]}]}})
 apply(e,{type:'selection.from_alpha',layerId:id,operation:'subtract'})
 assert.equal(selectionCoverage(e.state().selection,layer.transform.origin[0]+.5,layer.transform.origin[1]+.5),0);assert.equal(selectionCoverage(e.state().selection,.5,.5),1)
 apply(e,{type:'selection.from_alpha',layerId:id,operation:'intersect'});assert.equal(selectionCoverage(e.state().selection,.5,.5),0)
})
test('stamp preserves source layers, is idempotent, and undoes as one transaction',()=>{
 const e=setup(),before=e.snapshot(),plan=mergeSelectionPlan(before.manifest,[],'stamp-visible'),request=e.identity(),bytes=encodeRaster(blankPNG(24,16,200))
 const result=e.merge(request,bytes,plan);assert.equal(e.state().manifest.layers.length,4);assert.deepEqual(e.state().manifest.layers.slice(0,3),before.manifest.layers)
 assert.deepEqual(e.merge(request,bytes,plan),result)
 e.history({...e.identity(),direction:'undo'});assert.deepEqual(e.snapshot(),before)
 e.history({...e.identity(),direction:'redo'});assert.equal(e.state().manifest.layers.length,4)
})
test('merge visible preserves hidden groups, hidden children and their saved pixels',()=>{
 const e=setup();apply(e,{type:'group.add',name:'Folder'});const group=e.state().manifest.activeLayerID!,[a,b,c]=e.state().manifest.layers
 apply(e,{type:'layer.set_parent',layerId:a.id,parentId:group});apply(e,{type:'layer.set_parent',layerId:b.id,parentId:group});apply(e,{type:'layer.set_visibility',layerId:b.id,visible:false})
 const before=e.snapshot(),plan=mergeSelectionPlan(before.manifest,[],'visible');assert.ok(plan.includedIds.includes(a.id));assert.ok(plan.includedIds.includes(c.id));assert.ok(!plan.includedIds.includes(b.id));assert.ok(!plan.includedIds.includes(group))
 e.merge(e.identity(),encodeRaster(blankPNG(24,16,150)),plan)
 assert.ok(e.state().manifest.layers.some(l=>l.id===b.id&&!l.isVisible&&l.parentID===group));assert.ok(e.state().manifest.layers.some(l=>l.id===group));assert.deepEqual(e.snapshot().assets.get(b.imageFile!),before.assets.get(b.imageFile!))
 e.history({...e.identity(),direction:'undo'});assert.deepEqual(e.snapshot(),before)
})
test('full locks reject pixel writes, mask writes, floating pixels and destructive merge',()=>{
 const e=setup(),id=e.state().manifest.layers[0].id;apply(e,{type:'layer.set_lock',layerId:id,lock:'all',locked:true});const before=e.snapshot(),revision=e.state().revision
 for(const action of [{type:'layer.fill',layerId:id,color:[1,0,0,1]},{type:'selection.subject',layerId:id,removeBackground:true},{type:'selection.transform_pixels',layerId:id,transform:e.state().manifest.layers[0].transform},{type:'layer.mask',layerId:id,operation:'reveal'}])assert.throws(()=>apply(e,action),/locked/)
 assert.throws(()=>e.merge(e.identity(),encodeRaster(blankPNG(24,16,255)),mergeSelectionPlan(e.state().manifest,[],'visible')),/locked/)
 assert.throws(()=>e.contentRaster(e.identity(),encodeRaster(blankPNG(4,4)),{name:'New',layerId:id}),/locked/)
 assert.deepEqual(e.snapshot(),before);assert.equal(e.state().revision,revision)
 assert.doesNotThrow(()=>apply(e,{type:'selection.from_alpha',layerId:id}))
})
test('position locks allow painting but reject movement and explicit text placement',()=>{
 const e=setup(),layer=e.state().manifest.layers[0];apply(e,{type:'layer.set_lock',layerId:layer.id,lock:'position',locked:true})
 assert.doesNotThrow(()=>apply(e,{type:'layer.fill',layerId:layer.id,color:[1,0,0,1]}))
 assert.throws(()=>apply(e,{type:'layer.set_transform',layerId:layer.id,transform:{...layer.transform,origin:[100,100]}}),/locked/)
 assert.throws(()=>e.contentRaster(e.identity(),encodeRaster(blankPNG(4,4)),{name:'New',layerId:layer.id,text:{content:'X'},transform:{...layer.transform,origin:[100,100]}}),/locked/)
})
test('locked folder protects descendants; failed batches are atomic, unlock+edit works',()=>{
 const e=setup(),id=e.state().manifest.layers[0].id;apply(e,{type:'group.add',name:'Folder'});const folder=e.state().manifest.activeLayerID!;apply(e,{type:'layer.set_parent',layerId:id,parentId:folder});apply(e,{type:'layer.set_lock',layerId:folder,lock:'all',locked:true})
 const before=e.snapshot();assert.throws(()=>e.applyBatch({...e.identity(),actions:[{type:'layer.rename',layerId:id,name:'Changed'},{type:'layer.fill',layerId:id,color:[1,0,0,1]}]}),/locked/);assert.deepEqual(e.snapshot(),before)
 const outside=e.state().manifest.layers.find(layer=>!layer.isGroup&&layer.id!==id)!.id
 assert.throws(()=>apply(e,{type:'layer.set_parent',layerId:outside,parentId:folder}),/locked/)
 assert.throws(()=>apply(e,{type:'layer.move',layerIds:[outside],parentId:folder,beforeLayerId:null}),/locked/)
 assert.deepEqual(e.snapshot(),before)
 assert.doesNotThrow(()=>e.applyBatch({...e.identity(),actions:[{type:'layer.set_lock',layerId:folder,lock:'all',locked:false},{type:'layer.fill',layerId:id,color:[1,0,0,1]}]}))
})
test('locks and stamps survive project save/open',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'photoshop-workflow-'));try{const e=setup(),id=e.state().manifest.layers[0].id;apply(e,{type:'layer.set_lock',layerId:id,lock:'position',locked:true});e.merge(e.identity(),encodeRaster(blankPNG(24,16,255)),mergeSelectionPlan(e.state().manifest,[],'stamp-visible'));await e.saveAs(join(dir,'test.comp'));const reopened=new Editor();await reopened.open(join(dir,'test.comp'));assert.deepEqual(reopened.snapshot().assets,e.snapshot().assets);assert.deepEqual(reopened.snapshot().manifest,JSON.parse(JSON.stringify(e.snapshot().manifest)));assert.equal(reopened.state().manifest.layers[0].positionLocked,true)}finally{await rm(dir,{recursive:true,force:true})}
})
test('align/distribute uses rotated bounds and moves grouped descendants once',()=>{
 const e=setup(),[a,b,c]=e.state().manifest.layers;apply(e,{type:'layer.set_transform',layerId:a.id,transform:{...a.transform,origin:[1,1],rotation:30}});apply(e,{type:'layer.set_transform',layerId:b.id,transform:{...b.transform,origin:[5,7]}});apply(e,{type:'layer.set_transform',layerId:c.id,transform:{...c.transform,origin:[19,4]}})
 e.applyBatch({...e.identity(),actions:alignLayers(e.state().manifest,[a.id,b.id,c.id],'top')});const bounds=e.state().manifest.layers.map(l=>selectionBounds(e.state().manifest,[l.id])!);assert.ok(bounds.every(r=>Math.abs(r.y-bounds[0].y)<1e-8))
 e.applyBatch({...e.identity(),actions:distributeLayers(e.state().manifest,[a.id,b.id,c.id],'horizontal')});const centers=e.state().manifest.layers.map(l=>{const r=selectionBounds(e.state().manifest,[l.id])!;return r.x+r.width/2}).sort((x,y)=>x-y);assert.ok(Math.abs(centers[1]-(centers[0]+centers[2])/2)<1e-8)
})
test('rotated view maps pointer coordinates exactly and bounds the visible raster budget',()=>{
 for(const angle of [0,15,45,90,180,-125]){const view={width:12000,height:8000,zoom:.7,angle,center:{x:400,y:300}},world={x:20,y:50},screen=documentToClient(world,view),inverse=clientToDocument(screen,view);assert.ok(Math.abs(inverse.x-world.x)<1e-8&&Math.abs(inverse.y-world.y)<1e-8);const rotated=rotatedViewport({left:0,top:0,width:1000,height:800},view),plan=planViewportRender({document:view,viewport:rotated,origin:rotated.origin,zoom:view.zoom});assert.ok(plan.width*plan.height<=16_010_000)}
})
