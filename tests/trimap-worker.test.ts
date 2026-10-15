import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import type {ChildProcess} from 'node:child_process'
import {build} from 'esbuild'
import {SubjectWorker} from '../src/core/subject-worker'
import {buildTrimapDraft,type TrimapDraftSettings} from '../src/shared/trimap-draft'
import {refineTrimapMatte} from '../src/shared/trimap-matte'
import {trimapFixtures,trimapError} from '../scripts/fixtures/trimap-matte-fixtures'
import {EditorError} from '../src/shared/errors'
const workerPath=join(process.cwd(),'artifacts/trimap-test.worker.cjs');let built:Promise<void>|undefined
async function backend(){built??=build({entryPoints:['src/core/subject-worker.ts'],outfile:workerPath,platform:'node',target:'node24',format:'cjs',bundle:true,external:['onnxruntime-node']}).then(()=>{});await built;const directory=await mkdtemp(join(tmpdir(),'trimap-worker-'));return {directory,worker:new SubjectWorker({workerPath,cacheDir:directory})}}
const code=(expected:string)=>(error:unknown)=>error instanceof EditorError&&error.code===expected
test('real auxiliary process refines known-alpha strands with immutable source and stable anchors',async()=>{
 const {worker,directory}=await backend(),fixture=trimapFixtures()[0],before={image:fixture.guide.data.slice(),coverage:fixture.mask.coverage.slice()},phases:string[]=[]
 try{const result=await worker.refine(fixture.guide,fixture.mask,{sampleRadius:32},{onProgress:progress=>phases.push(progress.phase)}),draft=buildTrimapDraft(fixture.mask,{sampleRadius:32}),reference=refineTrimapMatte(fixture.mask,fixture.guide,draft,{sampleRadius:32})
  assert.deepEqual(result.trimap,draft);assert.deepEqual(result.coverage.coverage,reference.mask.coverage);assert.ok(phases.includes('inference'));assert.ok(trimapError(fixture,result.coverage.coverage).alphaMAE<.03)
  for(let i=0;i<draft.length;i++)if(draft[i]!==128)assert.equal(result.coverage.coverage[i],draft[i]);assert.deepEqual(fixture.guide.data,before.image);assert.deepEqual(fixture.mask.coverage,before.coverage);assert.ok(result.report.estimatedPeakBytes>=result.report.estimatedInputBytes+result.report.estimatedWorkingBytes)
 }finally{await worker.dispose();await rm(directory,{recursive:true,force:true})}
})
test('queued job freezes image, selection, stroke points and region even when the caller edits all of them',async()=>{
 const {worker,directory}=await backend(),fixture=trimapFixtures()[0]
 try{const blocker=worker.refine(fixture.guide,fixture.mask,{}, {jobId:'blocker'}),blockerRejected=assert.rejects(blocker,code('CANCELED')),image={width:8,height:8,data:Buffer.alloc(8*8*4,255)},selection={width:8,height:8,coverage:Buffer.alloc(64)},settings:TrimapDraftSettings={region:[0,0,4,4],strokes:[{value:255,size:1,points:[[1.5,1.5]]}]},pending=worker.refine(image,selection,settings)
  image.data.fill(0);selection.coverage.fill(255);settings.region![0]=4;settings.strokes![0].points[0][0]=6.5;settings.strokes![0].value=0;await worker.cancel('blocker');await blockerRejected;const result=await pending
  assert.equal(result.trimap[1*8+1],255);assert.equal(result.coverage.coverage[1*8+1],255);assert.equal(result.trimap[1*8+6],0);assert.equal(result.coverage.coverage[1*8+6],0);assert.ok(image.data.every(value=>value===0));assert.ok(selection.coverage.every(value=>value===255))
 }finally{await worker.dispose();await rm(directory,{recursive:true,force:true})}
})
test('active child cancellation uses real process termination and a following refine restarts cleanly',async()=>{
 const {worker,directory}=await backend(),fixture=trimapFixtures()[0],controller=new AbortController();let started=false,oldPID:number|undefined,oldChild:ChildProcess|undefined
 try{const canceled=worker.refine(fixture.guide,fixture.mask,{sampleRadius:32},{signal:controller.signal,onProgress:progress=>{if(progress.phase==='inference'){started=true;oldChild=(worker as unknown as {worker?:ChildProcess}).worker;oldPID=oldChild?.pid;controller.abort()}}});await assert.rejects(canceled,code('CANCELED'));assert.equal(started,true);assert.ok(oldPID)
  const result=await worker.refine(fixture.guide,fixture.mask,{sampleRadius:32});assert.ok(result.coverage.coverage.some(value=>value>0));assert.notEqual((worker as unknown as {worker?:{pid?:number}}).worker?.pid,oldPID);assert.equal(oldChild?.signalCode,'SIGKILL')
 }finally{await worker.dispose();await rm(directory,{recursive:true,force:true})}
})
test('timeout kills a real auxiliary process and the next job can restart and preserve a region',async()=>{
 const {worker,directory}=await backend(),fixture=trimapFixtures()[0]
 try{const pending=worker.refine(fixture.guide,fixture.mask,{sampleRadius:32},{timeoutMs:1});const oldChild=(worker as unknown as {worker?:ChildProcess}).worker,oldPID=oldChild?.pid;assert.ok(oldPID);await assert.rejects(pending,code('TIMEOUT'))
  const region:[number,number,number,number]=[58,20,24,30],result=await worker.refine(fixture.guide,fixture.mask,{region,sampleRadius:32,strokes:[{value:255,size:5,points:[[-1000,35],[1000,35]]}]});assert.notEqual((worker as unknown as {worker?:{pid?:number}}).worker?.pid,oldPID);assert.equal(oldChild?.signalCode,'SIGKILL')
  for(let y=0;y<fixture.mask.height;y++)for(let x=0;x<fixture.mask.width;x++)if(x<region[0]||x>=region[0]+region[2]||y<region[1]||y>=region[1]+region[3])assert.equal(result.coverage.coverage[y*fixture.mask.width+x],fixture.mask.coverage[y*fixture.mask.width+x])
 }finally{await worker.dispose();await rm(directory,{recursive:true,force:true})}
})
test('invalid/transparent/oversized operations fail atomically and do not poison the worker',async()=>{
 const {worker,directory}=await backend(),fixture=trimapFixtures()[0],before=fixture.mask.coverage.slice()
 try{await assert.rejects(worker.refine(fixture.guide,fixture.mask,{boundaryRadius:NaN}),code('INVALID_ARGUMENT'));const transparent=fixture.guide.data.slice();transparent[3]=0;await assert.rejects(worker.refine({...fixture.guide,data:transparent},fixture.mask),code('INVALID_ARGUMENT'))
  const huge=new SharedArrayBuffer(512*1024*1024),data=new Uint8Array(huge,0,4),coverage=new Uint8Array(huge,4,1);data.set([10,20,30,255]);coverage[0]=19;await assert.rejects(worker.refine({width:1,height:1,data},{width:1,height:1,coverage}),code('RESOURCE_LIMIT'));assert.equal(coverage[0],19)
  const largeImage={width:1000,height:1000,data:new Uint8Array(4_000_000).fill(255)},largeSelection={width:1000,height:1000,coverage:new Uint8Array(1_000_000)};await assert.rejects(worker.refine(largeImage,largeSelection,{strokes:[{value:255,size:512,points:Array.from({length:10_000},(_,i)=>i%2?[999,999]:[0,0])}]}),code('RESOURCE_LIMIT'));const result=await worker.refine(fixture.guide,fixture.mask);assert.equal(result.coverage.width,fixture.guide.width);assert.deepEqual(fixture.mask.coverage,before)
 }finally{await worker.dispose();await rm(directory,{recursive:true,force:true})}
})
