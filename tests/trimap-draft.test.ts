import test from 'node:test'
import assert from 'node:assert/strict'
import {buildTrimapDraft,normalizeTrimapDraftSettings,estimateTrimapRefinementBudget,type TrimapDraftSettings} from '../src/shared/trimap-draft'
import {EditorError} from '../src/shared/errors'
test('automatic trimap keeps stable anchors, marks both sides of a boundary and preserves the input',()=>{
 const coverage=Buffer.from([...new Array(8).fill(0),...new Array(9).fill(255)]),before=Buffer.from(coverage),draft=buildTrimapDraft({width:17,height:1,coverage},{boundaryRadius:2})
 assert.deepEqual([...draft],[0,0,0,0,0,0,128,128,128,128,255,255,255,255,255,255,255]);assert.deepEqual(coverage,before)
 assert.deepEqual([...buildTrimapDraft({width:5,height:1,coverage:new Uint8Array([0,0,20,255,255])},{boundaryRadius:1})],[0,128,128,128,255])
})
test('separable class windows match an independent neighbourhood reference at corners and for partial pixels',()=>{
 const width=23,height=17,coverage=Uint8Array.from({length:width*height},(_,i)=>i%11===0?80:i%7<3?0:255),radius=3,draft=buildTrimapDraft({width,height,coverage},{boundaryRadius:radius})
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){let low=255,high=0;for(let dy=Math.max(0,y-radius);dy<=Math.min(height-1,y+radius);dy++)for(let dx=Math.max(0,x-radius);dx<=Math.min(width-1,x+radius);dx++){const value=coverage[dy*width+dx],label=value<=5?0:value>=250?255:128;low=Math.min(low,label);high=Math.max(high,label)}assert.equal(draft[y*width+x],low===high?low:128)}
})
test('ordered hard round strokes interpolate without gaps and clip strictly to the processing region',()=>{
 const width=20,height=10,coverage=new Uint8Array(width*height),region:[number,number,number,number]=[5,2,8,5],draft=buildTrimapDraft({width,height,coverage},{region,strokes:[{value:255,size:3,points:[[-1000,4.5],[1000,4.5]]},{value:0,size:1,points:[[8.5,4.5]]},{value:128,size:1,points:[[10.5,4.5]]}]})
 for(let x=5;x<13;x++)assert.equal(draft[4*width+x],x===8?0:x===10?128:255)
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(x<5||x>=13||y<2||y>=7)assert.equal(draft[y*width+x],0)
 assert.ok(coverage.every(value=>value===0))
})
test('draft settings are validated and copied including mutable stroke/region snapshots',()=>{
 const settings:TrimapDraftSettings={region:[0,0,8,8],strokes:[{value:255,size:2,points:[[2,3],[4,5]]}]},normalized=normalizeTrimapDraftSettings(settings,8,8)
 settings.region![0]=99;settings.strokes![0].points[0][0]=99;settings.strokes![0].value=0;assert.deepEqual(normalized.region,[0,0,8,8]);assert.deepEqual(normalized.strokes,[{value:255,size:2,points:[[2,3],[4,5]]}]);assert.equal(normalized.boundaryRadius,4)
 for(const bad of [{boundaryRadius:null},{region:null},{strokes:null},{boundaryRadius:NaN},{sampleRadius:65},{guidedRadius:0},{region:[0,0,9,8]},{strokes:[{value:42,size:1,points:[[0,0]]}]},{strokes:[{value:0,size:0,points:[[0,0]]}]},{strokes:[{value:0,size:1,points:[[Infinity,0]]}]},{strokes:[{value:0,size:1,points:[]}]},{strokes:Array.from({length:257},()=>({value:0,size:1,points:[[0,0]]}))},{strokes:[{value:0,size:1,points:Array.from({length:10_001},()=>[0,0])}]}])assert.throws(()=>normalizeTrimapDraftSettings(bad as TrimapDraftSettings,8,8),(error:unknown)=>error instanceof EditorError&&error.code==='INVALID_ARGUMENT')
})
test('stroke operation budgets reject expensive repeated painting before modifying or allocating a draft',()=>{
 const width=1000,height=1000,coverage=new Uint8Array(width*height),settings:TrimapDraftSettings={strokes:[{value:255,size:512,points:Array.from({length:10_000},(_,i)=>i%2?[999,999]:[0,0])}]}
 assert.throws(()=>buildTrimapDraft({width,height,coverage},settings),(error:unknown)=>error instanceof EditorError&&error.code==='RESOURCE_LIMIT');assert.ok(coverage.every(value=>value===0))
})
test('refinement budget includes retained backing, queue/transport/draft copies and whole-source validation',()=>{
 const width=20,height=20,count=width*height,backing=new ArrayBuffer(count*5+64),image={width,height,data:new Uint8Array(backing,0,count*4)},selection={width,height,coverage:new Uint8Array(backing,count*4,count)},settings=normalizeTrimapDraftSettings({region:[0,0,1,1]},width,height),budget=estimateTrimapRefinementBudget(image,selection,settings,1000)
 assert.equal(budget.estimatedInputBytes,backing.byteLength);assert.equal(budget.estimatedPeakBytes,budget.estimatedInputBytes+budget.estimatedWorkingBytes);assert.ok(budget.estimatedOperations>2*count);assert.ok(budget.estimatedWorkingBytes>count*30);assert.ok(budget.snapshotBytes>=count*5)
 const huge=new SharedArrayBuffer(512*1024*1024),view=new Uint8Array(huge,0,1);assert.throws(()=>buildTrimapDraft({width:1,height:1,coverage:view}),(error:unknown)=>error instanceof EditorError&&error.code==='RESOURCE_LIMIT')
})
