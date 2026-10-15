import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import type {Layer as PhotoshopLayer} from 'ag-psd'
import {writePsdBuffer,getLayerMaskImageData,type Psd} from 'ag-psd'
import {validatePhotoshopChannels,normalizePhotoshopChannels} from '../src/core/photoshop-channel-validation'
import {decodePhotoshop} from '../src/core/photoshop-io'
import {EditorError} from '../src/shared/contracts'

function layer(width:number,height:number,data:number[]|undefined,compression=1,depth=8,large=false):PhotoshopLayer{return {name:'Guard test',left:0,top:0,right:width,bottom:height,rawData:{colorMode:3,bitsPerChannel:depth,large,channels:[{id:0,compression,data:data?new Uint8Array(data):undefined}]}} as PhotoshopLayer}
function rejects(input:PhotoshopLayer,pattern:RegExp){assert.throws(()=>validatePhotoshopChannels(input),(error:unknown)=>error instanceof EditorError&&error.code==='INVALID_IMAGE'&&pattern.test(error.message))}
test('raw8/16 bytes validate with odd-row alignment and zero-sized/header-only layers preserved',()=>{
 for(const input of [layer(2,1,[20,30],0),layer(2,1,[0,20,0,30],0,16),layer(3,2,[1,2,3,0,4,5,6,0],0),layer(3,1,[1,2,3,0],0),layer(0,4,[0],1),layer(4,4,undefined,0)])assert.doesNotThrow(()=>validatePhotoshopChannels(input))
 rejects(layer(2,2,[1,2,3],0),/byte length/);rejects(layer(2,1,[1,2,3],0,16),/byte length/)
})
test('valid PackBits literals, repeats, NOP and odd row pad are accepted',()=>{
 for(const input of [layer(2,1,[0,3,1,20,30]),layer(4,1,[0,2,253,50]),layer(2,1,[0,5,128,1,20,30,128]),layer(3,1,[0,5,2,20,30,40,0]),layer(3,1,[0,5,3,20,30,40,0]),layer(3,1,[0,3,254,40,0]),layer(3,1,[0,3,253,40,128])])assert.doesNotThrow(()=>validatePhotoshopChannels(input))
})
test('RLE table, literal/repeat packet boundaries and expanded size fail before pixel allocation',()=>{
 rejects(layer(2,2,[0,3]),/row length table/);rejects(layer(2,1,[0,4,1,20,30]),/row exceeds/)
 rejects(layer(2,1,[0,2,1,20]),/truncated PackBits/);rejects(layer(2,1,[0,1,255]),/truncated PackBits/)
 rejects(layer(4,1,[0,2,255,40]),/shorter/);rejects(layer(2,1,[0,2,253,40]),/exceeds dimensions/)
 rejects(layer(3,1,[0,2,252,40]),/exceeds dimensions/)
 rejects(layer(2,1,[0,3,1,20,30,0,0]),/trailing/)
})
test('PSB uses 4byte row lengths and RGB16 expands bytes rather than pixel counts',()=>{
 assert.doesNotThrow(()=>validatePhotoshopChannels(layer(2,1,[0,0,0,5,3,0,20,0,30],1,16,true)))
 assert.doesNotThrow(()=>validatePhotoshopChannels(layer(2,1,[0,5,3,0,20,0,30],1,16)))
 rejects(layer(2,1,[0,3,1,20,30],1,16),/shorter/);rejects(layer(2,1,[0,3,1,20,30],1,8,true),/row exceeds|row length/)
})
test('mask and real-mask channels validate against their own patch dimensions, including adjustment masks',()=>{
 const input=layer(20,10,[0,3,1,20,30]);input.mask={left:8,top:4,right:10,bottom:5};input.rawData!.channels[0].id=-2
 assert.doesNotThrow(()=>validatePhotoshopChannels(input));input.mask.right=11;rejects(input,/shorter/)
 input.mask.right=10;input.adjustment={type:'invert'};assert.doesNotThrow(()=>validatePhotoshopChannels(input))
 input.rawData!.channels[0].id=-3;input.realMask={left:0,top:0,right:2,bottom:1};assert.doesNotThrow(()=>validatePhotoshopChannels(input));input.realMask.right=4;rejects(input,/shorter/)
})
test('undefined adjustment colors, nonconsumed group/auxiliary channels and ZIP retain existing handling',()=>{
 const adjustment=layer(20,10,[1],0);adjustment.adjustment={type:'invert'};assert.doesNotThrow(()=>validatePhotoshopChannels(adjustment))
 const group=layer(20,10,[1],0);group.children=[];assert.doesNotThrow(()=>validatePhotoshopChannels(group))
 const aux=layer(20,10,[1],0);aux.rawData!.channels[0].id=4 as NonNullable<PhotoshopLayer['rawData']>['channels'][number]['id'];assert.doesNotThrow(()=>validatePhotoshopChannels(aux))
 for(const compression of [2,3])assert.doesNotThrow(()=>validatePhotoshopChannels(layer(20,10,[1],compression)))
})
test('valid library PSD/PSB raster and differently sized masks continue through the guarded bridge',()=>{
 const raster=(width:number,height:number)=>({width,height,data:new Uint8ClampedArray(width*height*4).fill(120)}),psd:Psd={width:12,height:10,children:[{name:'Valid',left:2,top:3,imageData:raster(5,3),mask:{left:3,top:4,right:6,bottom:5,defaultColor:255,imageData:raster(3,1)}}]}
 for(const psb of [false,true]){const document=decodePhotoshop(writePsdBuffer(psd,{psb,noBackground:true}));assert.equal(document.manifest.layers[0].name,'Valid');assert.ok(document.manifest.layers[0].maskFile)}
})
test('independent malformed ImageIO layer packets are rejected explicitly rather than publishing wrong pixels',async()=>{
 for(const name of ['opaque-color-grid','alpha-coverage','hard-edge-checker','transparent-border']){const bytes=await readFile(`fixtures/photoshop-corpus/imageio/${name}.psd`);assert.throws(()=>decodePhotoshop(bytes),(error:unknown)=>error instanceof EditorError&&error.code==='INVALID_IMAGE'&&/malformed RLE/.test(error.message))}
})
test('16bit normalization budgets expanded channels plus decoder/quantization buffers before allocation',()=>{
 const width=24_000,height=1000,row=Buffer.alloc(width*2/128*2)
 for(let at=0;at<row.length;at+=2){row[at]=129;row[at+1]=255}
 const table=Buffer.alloc(height*2);for(let y=0;y<height;y++)table.writeUInt16BE(row.length,y*2)
 const input=layer(width,height,undefined,1,16);input.rawData!.channels[0].data=Buffer.concat([table,...Array.from({length:height},()=>row)])
 assert.doesNotThrow(()=>validatePhotoshopChannels(input))
 assert.throws(()=>normalizePhotoshopChannels(input),(error:unknown)=>error instanceof EditorError&&error.code==='RESOURCE_LIMIT')
})
test('16bit mask RLE normalizes its own patch bytes without mutating the parsed descriptor',()=>{
 const input=layer(20,10,[0,5,3,128,0,255,255],1,16);input.mask={left:8,top:4,right:10,bottom:5};input.rawData!.channels[0].id=-2
 const before=structuredClone(input),normalized=normalizePhotoshopChannels(input),mask=getLayerMaskImageData(normalized)!
 assert.notEqual(normalized,input);assert.equal(normalized.rawData!.channels[0].compression,0);assert.deepEqual([...mask.data].filter((_,index)=>index%4===0),[32768,65535]);assert.deepEqual(input,before)
})
