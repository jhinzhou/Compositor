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
for(const filter of [{kind:'levels',ranges:[{black:12,white:239,gamma:1.4,outputBlack:3,outputWhite:250},{black:0,white:255,gamma:1,outputBlack:0,outputWhite:255},{black:0,white:255,gamma:1,outputBlack:0,outputWhite:255},{black:0,white:255,gamma:1,outputBlack:0,outputWhite:255}]},{kind:'curves',channels:[[{x:0,y:0},{x:110,y:140},{x:255,y:255}],[{x:0,y:0},{x:255,y:255}],[{x:0,y:0},{x:255,y:255}],[{x:0,y:0},{x:255,y:255}]]},{kind:'exposure',exposure:.7},{kind:'invert'},{kind:'hsl',hue:25,saturation:12},{kind:'blackWhite'},{kind:'colorBalance',midtones:[12,-8,5]},{kind:'gradientMap',shadows:'#152539',highlights:'#f8dfa0'}]){
 test(`A2 ${filter.kind} stages and commits identical deep/source/display and exact Undo/Redo`,()=>{
  const {editor,id,asset}=fixture(),action:EditAction={type:'layer.filter',layerId:id,filter:imageFilterSchema.parse(filter)},snapshot=editor.snapshot(),stage={manifest:snapshot.manifest,assets:snapshot.assets,selection:null}
  applyPixelAction(stage,action);const preview=stage.assets.get(stage.manifest.layers[0].imageFile!)!,before=editor.state().revision
  apply(editor,action);const after=image(editor);assert.equal(editor.state().revision,before+1);assert.equal(after.bitDepth,16);assert.deepEqual(after.deep,preview.deep);assert.deepEqual(after.bytes,preview.bytes);assert.deepEqual(after.displayBytes,preview.displayBytes);assert.equal(after.bytes[24],16);assert.ok(after.deep!.some(v=>v%257!==0));for(let p=3;p<after.deep!.length;p+=4)assert.equal(after.deep![p],asset.deep![p]);undo(editor,'undo');assert.equal(image(editor),asset);undo(editor,'redo');assert.equal(image(editor),after)
 })
}
test('A2 selection blends deep samples in document space and an empty selection keeps original asset identity',()=>{
 const {editor,id,asset}=fixture();apply(editor,{type:'selection.set',selection:{inverted:false,shapes:[{kind:'rectangle',operation:'replace',bounds:[0,0,6,10],feather:0}]}});apply(editor,{type:'layer.filter',layerId:id,filter:{kind:'invert'}});const edited=image(editor);for(let y=0;y<10;y++)for(let x=6;x<12;x++)assert.deepEqual(edited.deep!.slice((y*12+x)*4,(y*12+x+1)*4),asset.deep!.slice((y*12+x)*4,(y*12+x+1)*4));undo(editor,'undo');apply(editor,{type:'selection.set',selection:{inverted:false,shapes:[]}});const before=editor.state();assert.equal(apply(editor,{type:'layer.filter',layerId:id,filter:{kind:'invert'}}).status,'no_change');assert.deepEqual(editor.state(),before);assert.equal(image(editor),asset)
})
test('A2 blur keeps alpha and exact snapshot history through repeated strokes, saving and reopening',async()=>{
 const {editor,id,asset}=fixture(),action:EditAction={type:'layer.retouch',layerId:id,kind:'blur',points:[[6,5]],size:8,hardness:1,opacity:.6,protectAlpha:true,blurRadius:1.5},dir=await mkdtemp(join(tmpdir(),'deep-edit-'))
 try{apply(editor,action);const first=image(editor);assert.notDeepEqual(first.deep,asset.deep);assert.ok(first.deep!.some(v=>v%257!==0));for(let p=3;p<first.deep!.length;p+=4)assert.equal(first.deep![p],asset.deep![p]);apply(editor,action);const second=image(editor);assert.notDeepEqual(second.deep,first.deep);undo(editor,'undo');assert.equal(image(editor),first);undo(editor,'undo');assert.equal(image(editor),asset);undo(editor,'redo');assert.equal(image(editor),first);await editor.saveAs(join(dir,'Edited.comp'));const loaded=await loadProject(join(dir,'Edited.comp')),reopened=loaded.assets.get(first.file)!;assert.equal(loaded.manifest.version,12);assert.deepEqual(reopened.bytes,first.bytes);assert.deepEqual(reopened.deep,first.deep);assert.deepEqual(reopened.displayBytes,first.displayBytes)}finally{await rm(dir,{recursive:true,force:true})}
})
test('A2 supported color then unsupported all-layers Smudge in one batch remains fully atomic',()=>{
 const {editor,id,asset}=fixture(),before=editor.state();assert.throws(()=>editor.applyBatch({...editor.identity(),actions:[{type:'layer.filter',layerId:id,filter:{kind:'invert'}},{type:'layer.retouch',layerId:id,kind:'smear',sourceMode:'all-layers',points:[[2,2],[5,5]],size:5,hardness:1,opacity:1,protectAlpha:true}],label:'Must stay atomic'}),e=>e instanceof EditorError&&e.code==='UNSUPPORTED_FEATURE');assert.deepEqual(editor.state(),before);assert.equal(image(editor),asset)
})
