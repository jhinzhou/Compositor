import test from 'node:test'
import assert from 'node:assert/strict'
import {quickSelection,magneticLassoPath,IMAGE_SELECTION_LIMITS} from '../src/core/image-driven-selection'
import type {RGBAImage} from '../src/core/selection-retouch'
function image(width=48,height=32):RGBAImage {
 const data=new Uint8Array(width*height*4)
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const at=(y*width+x)*4;data.set(x<width/2?[180+(x%3)*3,50+(y%4)*2,45,255]:[20,80,210,255],at)}
 return {width,height,data}
}
test('Quick Selection grows a textured region outside its brush and stops at a colour edge',()=>{
 const source=image(),before=source.data.slice(),selected=quickSelection(source,[[8.5,16.5]],{size:3,tolerance:24,edgeSensitivity:.8})
 assert.equal(selected.coverage[16*48+20],255);assert.equal(selected.coverage[16*48+30],0);assert.equal(selected.coverage[1*48+1],255);assert.deepEqual(source.data,before)
})
test('Quick Selection learns multiple intentionally brushed colours rather than a single wand seed',()=>{
 const source=image(),selected=quickSelection(source,[[8.5,16.5],[35.5,16.5]],{size:3,tolerance:18})
 assert.equal(selected.coverage[5*48+2],255);assert.equal(selected.coverage[5*48+45],255)
})
test('Quick Selection cannot cross transparent gaps or hidden RGB and starts empty on transparent seeds',()=>{
 const source=image()
 for(let y=0;y<32;y++){source.data.set([250,250,250,0],(y*48+16)*4)}
 const selected=quickSelection(source,[[8.5,16.5]],{size:3,tolerance:255,edgeSensitivity:0})
 assert.equal(selected.coverage[16*48+16],0);assert.equal(selected.coverage[16*48+20],0)
 const empty=quickSelection(source,[[16.5,16.5]],{size:1});assert.equal(empty.coverage.reduce((a,b)=>a+b,0),0)
})
test('Quick Selection antialias preserves a sharp source edge instead of inventing a halo',()=>{
 const source=image(),hard=quickSelection(source,[[8.5,16.5]],{size:3,tolerance:20,antialiased:false}),soft=quickSelection(source,[[8.5,16.5]],{size:3,tolerance:20,antialiased:true})
 assert.equal(hard.coverage[16*48+23],255);assert.deepEqual(soft.coverage,hard.coverage)
})
test('Quick Selection is deterministic; tolerance and edge controls cannot mutate the source',()=>{
 const source=image();assert.deepEqual(quickSelection(source,[[7.5,15.5],[9.5,17.5]],{size:5}),quickSelection(source,[[7.5,15.5],[9.5,17.5]],{size:5}))
 assert.throws(()=>quickSelection(source,[[48,5]],{size:5}),/inside|supported/);assert.throws(()=>quickSelection(source,[[5,5]],{size:0}),/supported/)
})
test('Quick Selection rejects image and stroke budgets before a result is published',()=>{
 assert.throws(()=>quickSelection({width:IMAGE_SELECTION_LIMITS.pixels+1,height:1,data:new Uint8Array()},[[0,0]],{size:1}),/16 MP/)
 assert.throws(()=>quickSelection(image(),Array.from({length:4097},()=>[1,1]),{size:1}),/4096/)
 assert.throws(()=>quickSelection(image(2048,2048),[[1024,1024]],{size:4096}),/footprint/)
})
test('Magnetic Lasso follows a nearby vertical image edge rather than the rough pointer line',()=>{
 const source=image(),before=source.data.slice(),path=magneticLassoPath(source,[[20.5,4.5],[21.5,15.5],[20.5,27.5]],{width:14,contrast:.15,frequency:50})
 assert.ok(path.length>10);assert.ok(path.every(([x])=>x>=23.5&&x<=24.5),JSON.stringify(path));assert.deepEqual(source.data,before)
})
test('Magnetic Lasso sees alpha boundaries while ignoring invisible RGB',()=>{
 const source=image();for(let y=0;y<32;y++)for(let x=24;x<48;x++)source.data.set([(x*17+y*13)%256,123,30,0],(y*48+x)*4)
 const path=magneticLassoPath(source,[[21.5,3.5],[21.5,28.5]],{width:14,contrast:.1})
 assert.ok(path.every(([x])=>x>=23.5&&x<=24.5))
})
test('Magnetic Lasso closure is connected and output is deterministic',()=>{
 const source=image(),points:[[number,number],[number,number],[number,number]]=[[20.5,3.5],[20.5,27.5],[26.5,16.5]],options={width:12,closed:true}
 const a=magneticLassoPath(source,points,options),b=magneticLassoPath(source,points,options);assert.deepEqual(a,b);assert.deepEqual(a[0],a.at(-1))
 for(let i=1;i<a.length;i++)assert.ok(Math.hypot(a[i][0]-a[i-1][0],a[i][1]-a[i-1][1])<=Math.SQRT2+1e-9)
})
test('Magnetic Lasso rejects invalid parameters and oversized analysis',()=>{
 assert.throws(()=>magneticLassoPath(image(),[[3,3]],{width:129}),/supported/);assert.throws(()=>magneticLassoPath(image(),[[3,3]],{contrast:-1}),/supported/)
 assert.throws(()=>magneticLassoPath({width:20_000_000,height:1,data:new Uint8Array()},[[3,0]]),/16 MP/)
})
test('Magnetic Lasso travelled-distance anchors are stable under pointer event subdivision',()=>{
 const source=image(),sparse:[[number,number],[number,number]]=[[20.5,4.5],[20.5,27.5]],dense:[number,number][]=Array.from({length:24},(_,i)=>[20.5,4.5+i]),options={width:14,contrast:.15,frequency:50}
 assert.deepEqual(magneticLassoPath(source,sparse,options),magneticLassoPath(source,dense,options))
})
test('Magnetic Lasso follows a curved contrast boundary rather than closing with straight chords',()=>{
 const source=image(80,80)
 for(let y=0;y<80;y++)for(let x=0;x<80;x++)source.data.set(Math.hypot(x+.5-40,y+.5-40)<22?[230,230,230,255]:[10,10,10,255],(y*80+x)*4)
 const points:[number,number][]=Array.from({length:17},(_,i)=>[40+19*Math.cos(i*Math.PI/16),40+19*Math.sin(i*Math.PI/16)])
 const path=magneticLassoPath(source,points,{width:12,contrast:.2,frequency:50})
 assert.ok(path.length>40);for(const [x,y] of path)assert.ok(Math.abs(Math.hypot(x-40,y-40)-22)<2)
})
test('Quick Selection edge sensitivity changes growth across a weak colour seam',()=>{
 const source=image()
 for(let y=0;y<32;y++)for(let x=0;x<48;x++)source.data.set(x<24?[100,100,100,255]:[110,110,110,255],(y*48+x)*4)
 const loose=quickSelection(source,[[8.5,16.5]],{size:3,tolerance:32,edgeSensitivity:0}),strict=quickSelection(source,[[8.5,16.5]],{size:3,tolerance:32,edgeSensitivity:1})
 assert.equal(loose.coverage[16*48+35],255);assert.equal(strict.coverage[16*48+35],0)
})
