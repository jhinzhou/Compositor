import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Editor} from '../src/core/editor'
import {makeDeepAsset,loadProject} from '../src/core/project-io'
import {applyPixelAction} from '../src/core/pixel-actions'
import {imageFilterSchema} from '../src/shared/image-filters'
import {EditorError,type EditAction,type Manifest} from '../src/shared/contracts'
function fixture(){
 const editor=new Editor(),id=randomUUID().toUpperCase(),width=12,height=10,file=`${id}.png`,deep=new Uint16Array(width*height*4)
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=(y*width+x)*4,a=[65535,43001,17003][(x+y)%3];deep.set([Math.round(((x*4001+y*601)%65536)*a/65535),Math.round(((y*5003+x*257)%65536)*a/65535),Math.round(((x*3007+y*997)%65536)*a/65535),a],p)}
 const manifest:Manifest={format:'com.compositor.project',version:12,colorSpace:'sRGB',documentID:randomUUID(),width,height,resolution:72,activeLayerID:id,layers:[{id,name:'Deep test',imageFile:file,isVisible:true,isGroup:false,opacity:1,blendMode:'Normal',transform:{origin:[0,0],size:[width,height],rotation:0,flipX:false,flipY:false,sampling:'High quality'}}]}
 const asset=makeDeepAsset(file,width,height,deep);editor.importDocument(manifest,new Map([[file,asset]]),'Deep test');return {editor,id,file,asset}
}
function apply(editor:Editor,action:EditAction){return editor.apply({...editor.identity(),action})}
function image(editor:Editor){const snapshot=editor.snapshot(),layer=snapshot.manifest.layers[0];return snapshot.assets.get(layer.imageFile!)!}
function undo(editor:Editor,direction:'undo'|'redo'){return editor.history({...editor.identity(),direction})}

for(const action of [
 {type:'layer.paint',points:[[3,3],[7,6]],color:[.8,.1,.5,1],size:4,hardness:.6,opacity:.8,flow:.4,pressures:[.3,.9],pressureSize:true,pressureOpacity:true,erase:false,target:'image'},
 {type:'layer.paint',points:[[3,3],[7,6]],color:[0,0,0,1],size:4,hardness:.6,opacity:.5,erase:true,target:'image'},
 ...(['smudge','liquify'] as const).flatMap(smearMode=>[true,false].map(protectAlpha=>({type:'layer.retouch',kind:'smear',smearMode,points:[[3,3],[7,6]],size:5,hardness:.6,opacity:.7,protectAlpha,sourceMode:'this-layer'})))
])test(`Deep tools ${action.type} ${'smearMode' in action?action.smearMode:action.erase?'Erase':'Paint'} ${'protectAlpha' in action?action.protectAlpha:''}: preview, source, exact transaction Undo/Redo`,()=>{
 const {editor,id,asset}=fixture(),edit={...action,layerId:id} as EditAction,snapshot=editor.snapshot(),stage={...snapshot,selection:null};applyPixelAction(stage,edit);const expected=stage.assets.get(stage.manifest.layers[0].imageFile!)!;apply(editor,edit);const actual=image(editor);assert.equal(actual.bitDepth,16);assert.deepEqual(actual.deep,expected.deep);assert.deepEqual(actual.bytes,expected.bytes);assert.notDeepEqual(actual.deep,asset.deep);assert.ok(actual.deep!.some(value=>value%257!==0));if('protectAlpha' in action&&action.protectAlpha)for(let i=3;i<asset.deep!.length;i+=4)assert.equal(actual.deep![i],asset.deep![i]);undo(editor,'undo');assert.equal(image(editor),asset);undo(editor,'redo');assert.equal(image(editor),actual)
})
test('Zero Flow and stationary warp preserve source buffers and no history',()=>{const {editor,id,asset}=fixture(),before=editor.state();apply(editor,{type:'layer.paint',layerId:id,points:[[2,2]],color:[1,0,0,1],size:5,hardness:1,opacity:1,flow:0,erase:false,target:'image'});assert.deepEqual(editor.state(),before);assert.equal(image(editor),asset);apply(editor,{type:'layer.retouch',layerId:id,kind:'smear',smearMode:'liquify',points:[[2,2]],size:5,hardness:1,opacity:1,protectAlpha:true});assert.deepEqual(editor.state(),before);assert.equal(image(editor),asset)})
test('sub-byte 16-bit brush edits survive preview and exact Undo/Redo; locked layers still reject atomically',()=>{
 const {editor,id,asset}=fixture(),action:EditAction={type:'layer.paint',layerId:id,points:[[3.5,3.5]],size:1,hardness:1,color:[0,0,0,1],opacity:.001,erase:true,target:'image'},before=editor.snapshot(),stage={...before,selection:null};applyPixelAction(stage,action);apply(editor,action);const actual=image(editor),at=(3*12+3)*4;assert.equal(actual.deep![at+3],Math.round(asset.deep![at+3]*.999));assert.notEqual(actual.deep![at+3],asset.deep![at+3]);assert.deepEqual(actual.bytes,stage.assets.get(stage.manifest.layers[0].imageFile!)!.bytes);undo(editor,'undo');assert.equal(image(editor),asset);undo(editor,'redo');assert.equal(image(editor),actual)
 apply(editor,{type:'layer.set_lock',layerId:id,lock:'all',locked:true});const locked=editor.state();assert.throws(()=>apply(editor,action),e=>e instanceof EditorError&&e.code==='INVALID_ARGUMENT');assert.deepEqual(editor.state(),locked);assert.equal(image(editor),actual)
})
for(const sampling of ['Nearest','Smooth','High quality'] as const)test(`Deep Image Size ${sampling} retains16 and named channels, exact metadata Undo/Redo`,()=>{const {editor,asset}=fixture();apply(editor,{type:'selection.set',selection:{inverted:false,shapes:[{kind:'rectangle',operation:'replace',bounds:[1,1,4,4],feather:0}]}});apply(editor,{type:'selection.save_named',name:'Deep resize selection',overwrite:false});const original=editor.state();apply(editor,{type:'document.image_size',width:7,height:5,resolution:96,resample:true,sampling});const after=editor.state(),result=image(editor);assert.equal(result.bitDepth,16);assert.equal(after.manifest.width,7);assert.equal(after.manifest.height,5);assert.equal(after.selection,null);assert.notDeepEqual(after.manifest.namedSelections,original.manifest.namedSelections);assert.ok(result.deep!.some(value=>value%257!==0));undo(editor,'undo');assert.deepEqual(editor.state().manifest,original.manifest);assert.deepEqual(editor.state().selection,original.selection);assert.equal(image(editor),asset);undo(editor,'redo');assert.equal(image(editor),result)})
test('Deep image-size oversized output rejects before committing metadata, history, assets or selection',()=>{const {editor,asset}=fixture(),before=editor.state();assert.throws(()=>apply(editor,{type:'document.image_size',width:10000,height:10000,resolution:300,resample:true,sampling:'High quality'}),error=>error instanceof EditorError&&error.code==='RESOURCE_LIMIT');assert.deepEqual(editor.state(),before);assert.equal(image(editor),asset)})
test('Unsupported all-layers deep smudge still rejects atomically',()=>{const {editor,id,asset}=fixture(),before=editor.state();assert.throws(()=>apply(editor,{type:'layer.retouch',layerId:id,kind:'smear',smearMode:'smudge',sourceMode:'all-layers',points:[[2,2],[5,5]],size:5,hardness:1,opacity:1,protectAlpha:true}),e=>e instanceof EditorError&&e.code==='UNSUPPORTED_FEATURE');assert.deepEqual(editor.state(),before);assert.equal(image(editor),asset)})
