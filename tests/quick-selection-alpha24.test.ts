import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {inflateSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {quickSelection} from '../src/core/image-driven-selection'
import type {RGBAImage} from '../src/core/selection-retouch'
const make=(width:number,height:number,color:(x:number,y:number)=>number[]):RGBAImage=>{const data=new Uint8Array(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set(color(x,y),(y*width+x)*4);return{width,height,data}}

test('actual Photoshop circle coverage is preserved with AA enabled, without a spatial-blur halo',()=>{
 const f=JSON.parse(readFileSync(new URL('../fixtures/parity/photoshop-27.11-tools-alpha23.json',import.meta.url),'utf8'))
 const data=inflateSync(Buffer.from(f.source.rgbaZlib,'base64')),native=inflateSync(Buffer.from(f.coverage.grayZlib,'base64'))
 assert.equal(createHash('sha256').update(data).digest('hex'),f.source.sha256);assert.equal(createHash('sha256').update(native).digest('hex'),f.coverage.sha256)
 const selected=quickSelection({width:f.width,height:f.height,data},f.operation.points,{...f.operation,antialiased:true})
 assert.deepEqual(Buffer.from(selected.coverage),native)
})
for(const [name,inside]of Object.entries({diagonal:(x:number,y:number)=>x<y+8,concave:(x:number,y:number)=>(x<18&&y>3)||(x<40&&y>30),texture:(x:number,y:number)=>x<32})){
 test(`held-out ${name}: AA preserves a sharp textured region, including concavity`,()=>{
  const source=make(64,48,(x,y)=>inside(x,y)?[40+x%5,150+y%7,65,255]:[190+x%3,40,170+y%5,255]),original=source.data.slice()
  const result=quickSelection(source,[[8.5,16.5]],{size:3,tolerance:32,antialiased:true})
  for(let y=0;y<48;y++)for(let x=0;x<64;x++)assert.equal(result.coverage[y*64+x],inside(x,y)?255:0,`${x},${y}`)
  assert.deepEqual(source.data,original)
 })
}
test('held-out gentle gradient: AA still creates fractional coverage when image evidence is continuous',()=>{
 const source=make(64,24,(x)=>[Math.min(255,x*3),100,100,255])
 const hard=quickSelection(source,[[8.5,12.5]],{size:3,tolerance:24,antialiased:false}),soft=quickSelection(source,[[8.5,12.5]],{size:3,tolerance:24,antialiased:true})
 assert.ok(soft.coverage.some(v=>v>0&&v<255))
 assert.equal(soft.coverage[12*64+8],255);assert.equal(soft.coverage[12*64+50],0)
 for(let x=2;x<62;x++)assert.ok(soft.coverage[12*64+x]>=soft.coverage[12*64+x+1])
 assert.notDeepEqual(soft.coverage,hard.coverage)
})
test('held-out alpha gap: AA never leaks across transparent hidden colors',()=>{
 const source=make(32,24,(x,y)=>x===16?[y*10,250-y*5,100,0]:[80,120,170,255])
 const first=quickSelection(source,[[8.5,12.5]],{size:3,tolerance:255,edgeSensitivity:0,antialiased:true})
 for(let y=0;y<24;y++){assert.equal(first.coverage[y*32+15],255);assert.equal(first.coverage[y*32+16],0);assert.equal(first.coverage[y*32+17],0);source.data.set([255,0,255,0],(y*32+16)*4)}
 assert.deepEqual(quickSelection(source,[[8.5,12.5]],{size:3,tolerance:255,edgeSensitivity:0,antialiased:true}),first)
})
