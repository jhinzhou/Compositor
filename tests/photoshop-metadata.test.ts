import assert from 'node:assert/strict'
import test from 'node:test'
import {writePsdBuffer,readPsd,type Layer as PhotoshopLayer} from 'ag-psd'
import {decodePhotoshop,encodePhotoshop} from '../src/core/photoshop-io'
import {Editor} from '../src/core/editor'
import type {EditAction} from '../src/shared/contracts'

const pixels=(width=4,height=4)=>({width,height,data:new Uint8ClampedArray(width*height*4).fill(255)})
const shadow={enabled:true,color:{r:0,g:0,b:0},blendMode:'normal' as const,opacity:.5,distance:{units:'Pixels' as const,value:3},size:{units:'Pixels' as const,value:2},angle:90}
const bevel={enabled:true,style:'inner bevel' as const,size:{units:'Pixels' as const,value:3},highlightColor:{r:255,g:255,b:255},shadowColor:{r:0,g:0,b:0}}
function create(children:PhotoshopLayer[]){const document=decodePhotoshop(writePsdBuffer({width:32,height:24,children},{noBackground:true})),editor=new Editor();editor.restore(document.manifest,document.assets,'Metadata regression');return editor}
function apply(editor:Editor,action:EditAction){return editor.apply({...editor.identity(),action})}
function output(editor:Editor){const document=editor.snapshot();return readPsd(encodePhotoshop(document.manifest,document.assets),{useImageData:true,skipCompositeImageData:true,skipThumbnail:true})}
test('editing effects and reverting their values does not resurrect unsupported source styles; undo alone restores source metadata',()=>{
 const editor=create([{name:'Styled',imageData:pixels(),effects:{dropShadow:[shadow,{...shadow,distance:{units:'Pixels',value:6}}],bevel}}]),id=editor.state().manifest.layers[0].id,effects=structuredClone(editor.state().manifest.layers[0].effects) as any
 apply(editor,{type:'layer.effects',layerId:id,effects:{...effects,shadow:{...effects.shadow,distance:8}}});apply(editor,{type:'layer.effects',layerId:id,effects})
 const edited=output(editor).children![0].effects!;assert.equal(edited.dropShadow!.length,1);assert.equal(edited.bevel,undefined)
 editor.history({...editor.identity(),direction:'undo'});editor.history({...editor.identity(),direction:'undo'});const restored=output(editor).children![0].effects!;assert.equal(restored.dropShadow!.length,2);assert.ok(restored.bevel)
})
test('clear effects removes a metadata-only unsupported bevel even when native editable effects were absent',()=>{
 const editor=create([{name:'Bevel only',imageData:pixels(),effects:{bevel}}]),id=editor.state().manifest.layers[0].id
 assert.equal(editor.state().manifest.layers[0].effects,undefined);const result=apply(editor,{type:'layer.effects',layerId:id,effects:null});assert.equal(result.status,'applied');assert.equal(output(editor).children![0].effects,undefined)
 editor.history({...editor.identity(),direction:'undo'});assert.ok(output(editor).children![0].effects?.bevel)
})
test('copying the same basic effect into a PSD layer invalidates its unsupported effect descriptors',()=>{
 const editor=create([{name:'Destination',imageData:pixels(),effects:{dropShadow:[shadow],bevel}},{name:'Source',imageData:pixels(),effects:{dropShadow:[shadow]}}]),layers=editor.state().manifest.layers,source=layers.find(layer=>layer.name==='Source')!,target=layers.find(layer=>layer.name==='Destination')!
 apply(editor,{type:'layer.copy_effect',layerId:target.id,sourceId:source.id,kind:'shadow'});assert.equal(output(editor).children!.find(layer=>layer.name==='Destination')!.effects?.bevel,undefined)
})
test('remove and add identical white masks never resurrect old density/feather or outside-default metadata',()=>{
 const editor=create([{name:'Masked',imageData:pixels(1,1),mask:{left:0,top:0,right:1,bottom:1,defaultColor:0,imageData:pixels(1,1),userMaskDensity:.5,userMaskFeather:2}}]),id=editor.state().manifest.layers[0].id,before=editor.snapshot(),oldHash=before.assets.get(before.manifest.layers[0].maskFile!)!.hash
 apply(editor,{type:'layer.mask',layerId:id,operation:'remove'});apply(editor,{type:'layer.mask',layerId:id,operation:'reveal'});const current=editor.snapshot();assert.equal(current.assets.get(current.manifest.layers[0].maskFile!)!.hash,oldHash,'same bytes must still count as an explicit new mask')
 const mask=output(editor).children![0].mask!;assert.equal(mask.userMaskDensity,undefined);assert.equal(mask.userMaskFeather,undefined);assert.equal(mask.defaultColor,255)
 editor.history({...editor.identity(),direction:'undo'});editor.history({...editor.identity(),direction:'undo'});assert.ok(output(editor).children![0].mask!.userMaskDensity!<1)
})
test('copying an identical mask drops the old destination density/feather without replacing source mask behavior',()=>{
 const mask={left:0,top:0,right:1,bottom:1,imageData:pixels(1,1),defaultColor:255},editor=create([{name:'Destination',imageData:pixels(1,1),mask:{...mask,userMaskDensity:.5,userMaskFeather:2}},{name:'Source',imageData:pixels(1,1),mask}]),layers=editor.state().manifest.layers,source=layers.find(layer=>layer.name==='Source')!,target=layers.find(layer=>layer.name==='Destination')!
 apply(editor,{type:'layer.copy_mask',layerId:target.id,sourceId:source.id});const actual=output(editor).children!.find(layer=>layer.name==='Destination')!.mask!;assert.equal(actual.userMaskDensity,undefined);assert.equal(actual.userMaskFeather,undefined);assert.equal(actual.defaultColor,255)
})
test('explicit lock and unlock never reactivate source transparency-only protection',()=>{
 const editor=create([{name:'Protected',imageData:pixels(),protected:{transparency:true,artboards:true}}]),id=editor.state().manifest.layers[0].id
 assert.equal(output(editor).children![0].protected?.transparency,true);apply(editor,{type:'layer.set_lock',layerId:id,lock:'all',locked:true});apply(editor,{type:'layer.set_lock',layerId:id,lock:'all',locked:false});assert.notEqual(output(editor).children![0].protected?.transparency,true);assert.notEqual(output(editor).children![0].protected?.artboards,true)
 editor.history({...editor.identity(),direction:'undo'});editor.history({...editor.identity(),direction:'undo'});assert.equal(output(editor).children![0].protected?.transparency,true)
})
test('an explicit native content commit never restores old text warp even when its saved pixels are unchanged',()=>{
 const editor=create([{name:'Text',imageData:pixels(),text:{text:'Hello',style:{font:{name:'ArialMT'},fontSize:14,fauxBold:true},warp:{style:'arc',value:20}}}]),snapshot=editor.snapshot(),layer=snapshot.manifest.layers[0]
 editor.contentRaster(editor.identity(),snapshot.assets.get(layer.imageFile!)!.bytes,{name:layer.name,layerId:layer.id,text:layer.text})
 const text=output(editor).children![0].text!;assert.notEqual(text.warp?.style,'arc');assert.notEqual(text.style?.fauxBold,true)
 editor.history({...editor.identity(),direction:'undo'});assert.equal(output(editor).children![0].text!.warp?.style,'arc')
})
test('painting on an unsupported source vector rasterizes its descriptor even when pixel bytes are unchanged',()=>{
 const anchors:[[number,number],[number,number],[number,number],[number,number]]=[[2,0],[4,2],[2,4],[0,2]],editor=create([{name:'Diamond fallback',imageData:pixels(),vectorFill:{type:'color',color:{r:255,g:255,b:255}},vectorMask:{paths:[{open:false,fillRule:'non-zero',knots:anchors.map(([x,y])=>({linked:true,points:[x,y,x,y,x,y]}))}]}}]),id=editor.state().manifest.layers[0].id,before=editor.snapshot()
 assert.equal(before.manifest.layers[0].shape,undefined);assert.ok(output(editor).children![0].vectorFill)
 apply(editor,{type:'layer.paint',layerId:id,target:'image',points:[[2,2]],color:[1,1,1,1],size:2,hardness:1,opacity:1,erase:false})
 const current=editor.snapshot();assert.equal(current.assets.get(current.manifest.layers[0].imageFile!)!.hash,before.assets.get(before.manifest.layers[0].imageFile!)!.hash);assert.equal(output(editor).children![0].vectorFill,undefined);assert.equal(output(editor).children![0].vectorMask,undefined)
 editor.history({...editor.identity(),direction:'undo'});assert.ok(output(editor).children![0].vectorFill)
})
