import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {inflateSync} from 'node:zlib'
import {randomUUID} from 'node:crypto'
import {applyImageFilter,imageFilterSchema} from '../src/shared/image-filters'
import {applyDeepColorFilter} from '../src/shared/deep-color-filters'
import {applyHDRColorFilter} from '../src/shared/hdr-pixels'
import {makeDeepAsset,makeHDRAsset} from '../src/core/project-io'
import {Editor} from '../src/core/editor'
import type {Manifest} from '../src/shared/contracts'
interface Raster{sha256:string;width:number;height:number;bitDepth:number;rgbaZlibLE:string}
const fixture=JSON.parse(readFileSync(new URL('../fixtures/parity/photoshop-27.11-effects.json',import.meta.url),'utf8')) as {provenance:{application:string;referenceMethod:string};sources:Record<string,Raster>;rows:{name:string;source:string;filter:unknown;reference:Raster}[]}
function samples(image:Raster):Uint8ClampedArray|Uint16Array{const raw=inflateSync(Buffer.from(image.rgbaZlibLE,'base64'));assert.equal(raw.length,image.width*image.height*4*(image.bitDepth===16?2:1));return image.bitDepth===16?Uint16Array.from({length:raw.length/2},(_,i)=>raw.readUInt16LE(i*2)):new Uint8ClampedArray(raw)}
test('Photoshop fixtures retain independent application provenance',()=>{assert.equal(fixture.provenance.application,'Adobe Photoshop 27.11.0');assert.match(fixture.provenance.referenceMethod,/Real Photoshop/);assert.equal(fixture.rows.length,13);for(const row of fixture.rows)assert.match(row.reference.sha256,/^[a-f0-9]{64}$/)})
for(const row of fixture.rows)test(`actual PS reference: ${row.name}`,()=>{
 const source=fixture.sources[row.source],input=samples(source),copy=input.slice(),expected=samples(row.reference),filter=imageFilterSchema.parse(row.filter);let output:Uint8ClampedArray|Uint16Array;
 if(source.bitDepth===16){assert.ok(input instanceof Uint16Array);output=applyDeepColorFilter(input,source.width,source.height,filter)}else output=applyImageFilter({width:source.width,height:source.height,data:input as Uint8ClampedArray},filter).data
 let sum=0,max=0,count=0;for(let at=0;at<output.length;at+=4){assert.equal(output[at+3],expected[at+3]);if(!expected[at+3])continue;for(let c=0;c<3;c++){const error=Math.abs(output[at+c]-expected[at+c]);sum+=error;max=Math.max(max,error);count++}}
 // RGB8 rounding and PS's 15-bit+1 internal RGB16 convention are measured
 // residuals. Mixed HSL additionally retains the native 33³ interpolation.
 const mixed=filter.kind==='hsl'&&filter.hue!==0&&filter.saturation!==0,onlyLight=filter.kind==='hsl'&&filter.hue===0&&filter.saturation===0;
 const tolerance=filter.kind==='curves'?{max:0,mae:0}:source.bitDepth===8?{max:2,mae:.5}:onlyLight?{max:10,mae:1.5}:mixed?{max:235,mae:45}:{max:150,mae:30};
 assert.ok(max<=tolerance.max,`maximum ${max} > ${tolerance.max}`);assert.ok(sum/count<=tolerance.mae,`MAE ${sum/count} > ${tolerance.mae}`);assert.deepEqual(input,copy)
})
test('HSL signed Lightness preserves alpha, between-byte precision and HDR highlight scale',()=>{
 const deep=Uint16Array.from([20001,10001,5001,30003,0,0,0,0]),before=deep.slice();
 for(const lightness of [-10,10,30]){const out=applyDeepColorFilter(deep,2,1,{kind:'hsl',lightness});assert.equal(out[3],deep[3]);assert.equal(out[7],0);assert.deepEqual([...out.slice(4)],[0,0,0,0]);assert.ok([...out.slice(0,3)].some(v=>v%257!==0));for(let c=0;c<3;c++){const expected=lightness<0?deep[c]*(1+lightness/100):deep[c]+(deep[3]-deep[c])*lightness/100;assert.ok(Math.abs(out[c]-expected)<=1)}}assert.deepEqual(deep,before)
 const hdr=Float32Array.from([4,2,1,1]),hdrBefore=hdr.slice(),out=applyHDRColorFilter(hdr,1,1,{kind:'hsl',lightness:-10});assert.equal(out[3],1);for(let c=0;c<3;c++)assert.ok(Math.abs(out[c]-hdr[c]*.9)<.0002);assert.deepEqual(hdr,hdrBefore)
})
for(const depth of ['16','HDR'] as const)test(`${depth} HSL command Undo/Redo restores the canonical source exactly`,()=>{
 const editor=new Editor(),id=randomUUID().toUpperCase(),file=`${id}.${depth==='HDR'?'exr':'png'}`,asset=depth==='HDR'?makeHDRAsset(file,1,1,Float32Array.from([4,2,1,1])):makeDeepAsset(file,1,1,Uint16Array.from([20001,10001,5001,30003])),manifest:Manifest={format:'com.compositor.project',version:depth==='HDR'?13:12,colorSpace:'sRGB',documentID:randomUUID(),width:1,height:1,resolution:72,activeLayerID:id,layers:[{id,name:'HSL source',imageFile:file,isVisible:true,isGroup:false,opacity:1,blendMode:'Normal',transform:{origin:[0,0],size:[1,1],rotation:0,flipX:false,flipY:false,sampling:'Nearest'}}]};editor.importDocument(manifest,new Map([[file,asset]]),'PS HSL test');
 const active=()=>{const snapshot=editor.snapshot();return snapshot.assets.get(snapshot.manifest.layers[0].imageFile!)!};editor.apply({...editor.identity(),action:{type:'layer.filter',layerId:id,filter:{kind:'hsl',hue:25,saturation:30,lightness:-10}}});const edited=active();assert.notEqual(edited,asset);assert.notDeepEqual(edited.hdr??edited.deep,asset.hdr??asset.deep);editor.history({...editor.identity(),direction:'undo'});assert.equal(active(),asset);editor.history({...editor.identity(),direction:'redo'});assert.equal(active(),edited)
})
