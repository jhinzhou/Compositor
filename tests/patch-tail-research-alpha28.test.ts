/** Pure topology candidate checks; not a production/Photoshop parity claim. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {blendSampledHealing} from '../scripts/research/patch-tail-model-alpha28'
function field(connected:boolean){const width=64,height=56,source=new Uint8Array(width*height*4),donor=new Float32Array(source.length),coverage=new Uint8Array(width*height)
 for(let p=0;p<coverage.length;p++){source.set([100,90,80,255],p*4);donor.set([50,40,30,255],p*4)}
 for(let y=12;y<24;y++)for(let x=12;x<24;x++){coverage[y*width+x]=255;if(x>15&&x<20&&y>15&&y<20)source.set([210,30,110,255],(y*width+x)*4)}
 const left=connected?24:44,top=connected?15:39;for(let y=top;y<top+4;y++)for(let x=left;x<left+4;x++){coverage[y*width+x]=20;source.set([150,140,130,255],(y*width+x)*4)}
 return {width,height,source,donor,coverage,left,top}
}
test('Unanchored soft component retains raw donor and coverage while anchored core/tail remain exact',()=>{
 const f=field(false),before=f.source.slice(),current=blendSampledHealing(f.source,f.donor,f.coverage,f.width,f.height,{selectionCoreThreshold:128,selectionSoftTail:true,isolateSoftComponents:true}),previous=blendSampledHealing(f.source,f.donor,f.coverage,f.width,f.height,{selectionCoreThreshold:128,selectionSoftTail:true})
 for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++){const p=y*f.width+x,at=p*4;if(x>=f.left&&x<f.left+4&&y>=f.top&&y<f.top+4){for(let c=0;c<3;c++)assert.equal(current[at+c],Math.round(f.source[at+c]*(1-20/255)+f.donor[at+c]*20/255))}else assert.deepEqual(current.subarray(at,at+4),previous.subarray(at,at+4))}
 assert.notDeepEqual(current,previous);assert.deepEqual(f.source,before)
 const linked=field(true);assert.deepEqual(blendSampledHealing(linked.source,linked.donor,linked.coverage,linked.width,linked.height,{selectionCoreThreshold:128,selectionSoftTail:true,isolateSoftComponents:true}),blendSampledHealing(linked.source,linked.donor,linked.coverage,linked.width,linked.height,{selectionCoreThreshold:128,selectionSoftTail:true}))
})
test('Topology classification charge/cancellation do not mutate arrays or turn no-core exact donor edits into a no-op',()=>{
 const f=field(false),before=f.source.slice();assert.throws(()=>blendSampledHealing(f.source,f.donor,f.coverage,f.width,f.height,{selectionCoreThreshold:128,selectionSoftTail:true,isolateSoftComponents:true,maximumWork:1000}),/budget/)
 let reads=0;const signal=new AbortController().signal;Object.defineProperty(signal,'aborted',{get:()=>++reads>3});assert.throws(()=>blendSampledHealing(f.source,f.donor,f.coverage,f.width,f.height,{selectionCoreThreshold:128,selectionSoftTail:true,isolateSoftComponents:true,signal}),/canceled/);assert.deepEqual(f.source,before)
 const soft=f.coverage.map(v=>v?20:0);assert.deepEqual(blendSampledHealing(f.source,f.donor,soft,f.width,f.height,{selectionCoreThreshold:128,selectionSoftTail:true,isolateSoftComponents:true}),blendSampledHealing(f.source,f.donor,soft,f.width,f.height,{selectionCoreThreshold:128,selectionSoftTail:true}));assert.deepEqual(blendSampledHealing(f.source,f.donor,f.coverage,f.width,f.height,{selectionCoreThreshold:128,selectionSoftTail:true,isolateSoftComponents:true,opacity:0}),f.source)
})
