import test from 'node:test'
import assert from 'node:assert/strict'
import {PNG} from 'pngjs'
import {applyImageFilter,defaultFilter,imageFilterSchema,nativeAdjustmentToSpec,specToNativeAdjustment} from '../src/shared/image-filters'
import {gaussianLineConvolver,integratedGaussianKernel} from '../src/shared/image-filter-algorithms'
import {filterRaster,gaussianCanvasSides} from '../src/core/filter-edit'
import {blankPNG} from '../src/core/raster-edit'
import {Editor} from '../src/core/editor'
import type {Layer} from '../src/shared/contracts'
const transform=(x=0,y=0):Layer['transform']=>({origin:[x,y],size:[18,12],rotation:0,flipX:false,flipY:false,sampling:'High quality'})
function source():PNG{const p=blankPNG(18,12);for(let y=0;y<12;y++)for(let x=0;x<18;x++)p.data.set([211,75,39,x<3?0:x===3?1:x===4?32:255],(y*18+x)*4);return p}
test('Gaussian Preserve Transparency normalizes colors excluding hidden RGB and preserves every original alpha including one-byte samples',()=>{
 const p=source(),before=Buffer.from(p.data),s={width:p.width,height:p.height,data:new Uint8ClampedArray(p.data)},filter={kind:'gaussianBlur',radius:3,preserveTransparency:true},result=applyImageFilter(s,filter)
 for(let i=0;i<s.data.length;i+=4){assert.equal(result.data[i+3],s.data[i+3]);if(s.data[i+3])assert.deepEqual([...result.data.slice(i,i+3)],[211,75,39])}
 for(let i=0;i<s.data.length;i+=4)if(!s.data[i+3])s.data.set([0,255,0,0],i)
 assert.deepEqual(applyImageFilter(s,filter).data,result.data);assert.deepEqual(p.data,before)
 const placed=transform(20,20),r=filterRaster(p,placed,null,filter,{canvasSize:[80,60]});assert.equal(r.grew,false);assert.deepEqual(r.transform,placed);assert.equal(r.png.width,18);assert.equal(r.png.height,12)
})
test('one-sided Gaussian convolution uses the identical integrated kernel in direct and FFT paths',()=>{
 for(const sigma of [2,12,64])for(const length of [7,129])for(const sides of [{start:true,end:false},{start:false,end:true}]){const input=Float32Array.from({length},(_,i)=>(i*31+23)%256),kernel=integratedGaussianKernel(sigma),radius=(kernel.length-1)/2,result=gaussianLineConvolver(length,sigma,sides)(input);for(let x=0;x<length;x++){let expected=0;for(let d=-radius;d<=radius;d++){const p=x+d;if(p<0){if(sides.start)expected+=input[0]*kernel[d+radius]}else if(p>=length){if(sides.end)expected+=input[length-1]*kernel[d+radius]}else expected+=input[p]*kernel[d+radius]}assert.ok(Math.abs(result[x]-expected)<.00002)}}
})
test('canvas filling Gaussian remains solid with unchanged bounds; partial contact clamps only touching sides, flips map correctly and rotated layers keep expansion',()=>{
 const p=blankPNG(18,12);for(let i=0;i<p.data.length;i+=4)p.data.set([160,80,40,255],i)
 const full=filterRaster(p,transform(),null,{kind:'gaussianBlur',radius:2},{canvasSize:[18,12]});assert.deepEqual(full.png.data,p.data);assert.deepEqual(full.transform,transform());assert.equal(full.grew,false)
 const contact=filterRaster(p,transform(0,10),null,{kind:'gaussianBlur',radius:2},{canvasSize:[80,60]});assert.equal(contact.transform.origin[0],0);assert.ok(contact.transform.origin[1]<10);assert.ok(contact.png.width>18);assert.ok(contact.png.height>12);const middle=Math.floor(contact.png.height/2);assert.equal(contact.png.data[(middle*contact.png.width)*4+3],contact.png.data[(middle*contact.png.width+8)*4+3]);assert.ok(contact.png.data[(middle*contact.png.width)*4+3]>=254);assert.ok(contact.png.data[(middle*contact.png.width+contact.png.width-1)*4+3]<255)
 assert.deepEqual(gaussianCanvasSides({...transform(0,10),flipX:true},18,12,[80,60]),{left:false,right:true,top:false,bottom:false})
 const rotation=filterRaster(p,{...transform(),rotation:15},null,{kind:'gaussianBlur',radius:2},{canvasSize:[18,12]});assert.ok(rotation.png.width>18);assert.ok(rotation.png.height>12)
})
test('preserved Gaussian internal roundtrip retains the Electron adjustment extension, defaults to radius five, commits once and Undo restores source and mask exactly',()=>{
 assert.equal((defaultFilter('gaussianBlur') as {radius:number}).radius,5);const filter=imageFilterSchema.parse({kind:'gaussianBlur',radius:3,preserveTransparency:true});assert.deepEqual(nativeAdjustmentToSpec(specToNativeAdjustment(filter)),filter)
 const editor=new Editor();editor.create(80,60);editor.importPNG(PNG.sync.write(source()),'Alpha');const id=editor.state().manifest.activeLayerID!;editor.apply({...editor.identity(),action:{type:'layer.set_transform',layerId:id,transform:transform(20,20)}});editor.apply({...editor.identity(),action:{type:'layer.mask',layerId:id,operation:'reveal'}});const before=editor.snapshot(),result=editor.apply({...editor.identity(),action:{type:'layer.filter',layerId:id,filter}}),after=editor.snapshot();assert.deepEqual(after.manifest.layers[0].transform,before.manifest.layers[0].transform);assert.deepEqual(after.assets.get(before.manifest.layers[0].maskFile!),before.assets.get(before.manifest.layers[0].maskFile!));editor.history({...editor.identity(),direction:'undo',transactionId:result.transactionId});assert.deepEqual(editor.snapshot().manifest,before.manifest);assert.deepEqual(editor.snapshot().assets,before.assets)
})
