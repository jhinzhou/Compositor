import test from 'node:test'
import assert from 'node:assert/strict'
import {brushStrokeCoverage} from '../src/shared/brush-coverage'
import {Editor} from '../src/core/editor'
import {actionSchema,type EditAction} from '../src/shared/contracts'
const grid={width:128,height:64,transform:{origin:[0,0] as [number,number],size:[128,64] as [number,number],rotation:0,flipX:false,flipY:false,sampling:'High quality' as const}}
const line:[number,number][]=[[16,32],[112,32]]
test('explicit spacing removes the soft brush Flow discontinuity at 100 percent',()=>{
 for(const hardness of [0,.4,1]){
  const a=brushStrokeCoverage(grid,line,32,hardness,{flow:.999999,spacing:.25}),b=brushStrokeCoverage(grid,line,32,hardness,{flow:1,spacing:.25})
  const maximum=Math.max(...a.map((value,index)=>Math.abs(value-b[index])))
  assert.ok(maximum<=1,`hardness ${hardness} maximum ${maximum}`)
 }
})
test('explicit tip spacing creates separated hard dabs and changes Flow accumulation at a fixed diameter',()=>{
 const separated=brushStrokeCoverage(grid,line,12,1,{flow:1,spacing:2}),dense=brushStrokeCoverage(grid,line,12,1,{flow:1,spacing:.25})
 assert.equal(separated[32*128+28],0);assert.equal(dense[32*128+28],255)
 const sparseFlow=brushStrokeCoverage(grid,line,12,1,{flow:.2,spacing:.5}),denseFlow=brushStrokeCoverage(grid,line,12,1,{flow:.2,spacing:.1})
 assert.ok(denseFlow[32*128+64]>sparseFlow[32*128+64])
 const events:[number,number][]=Array.from({length:961},(_,i)=>[16+i/10,32])
 assert.deepEqual(brushStrokeCoverage(grid,events,12,.4,{flow:.2,spacing:.25}),brushStrokeCoverage(grid,line,12,.4,{flow:.2,spacing:.25}))
})
test('public spacing schema rejects invalid values atomically and supports exact stroke Undo/Redo',()=>{
 const e=new Editor();e.create(128,64);e.apply({...e.identity(),action:{type:'layer.add_blank',name:'spacing'}});const id=e.state().manifest.activeLayerID!,before=e.snapshot()
 const input={type:'layer.paint',layerId:id,points:line,color:[.2,.4,.8,1],size:12,hardness:.4,opacity:.5,flow:.2,spacing:.25}
 for(const spacing of [0,-1,.009,10.01,Infinity,NaN]){assert.throws(()=>e.apply({...e.identity(),action:{...input,spacing} as EditAction}));assert.deepEqual(e.snapshot(),before)}
 e.apply({...e.identity(),action:actionSchema.parse(input)});const after=e.snapshot();e.history({...e.identity(),direction:'undo'});assert.deepEqual(e.snapshot(),before);e.history({...e.identity(),direction:'redo'});assert.deepEqual(e.snapshot(),after)
})

test('Photoshop hardness endpoints and the soft shoulder transition retain continuous coverage',()=>{
 const grid={width:96,height:96,transform:{origin:[0,0] as [number,number],size:[96,96] as [number,number],rotation:0,flipX:false,flipY:false,sampling:'High quality' as const}},points:[[number,number]]=[[48,48]],coverage=(hardness:number)=>brushStrokeCoverage(grid,points,32,hardness,{brushModel:'photoshop',spacing:.25,flow:1})
 for(const [a,b] of [[0,1e-6],[.999999,1]]){const left=coverage(a),right=coverage(b);for(let at=0;at<left.length;at++)assert.ok(Math.abs(left[at]-right[at])<=1,`hardness ${a}→${b}: ${left[at]}→${right[at]}`)}
 const mass=(h:number)=>coverage(h).reduce((sum,v)=>sum+v,0);assert.ok(Math.abs(mass(.01)-mass(0))/mass(0)<.05,'One percent hardness must not cause the former 29% footprint drop')
})

test('Photoshop dab alignment retains accumulated soft tails on a scaled high-resolution source',()=>{
 const width=4096,height=512,grid={width,height,transform:{origin:[0,0] as [number,number],size:[1024,128] as [number,number],rotation:0,flipX:false,flipY:false,sampling:'High quality' as const}},points:[number,number][]=Array.from({length:1000},(_,i)=>[i%2?490.95:490.9,64])
 const coverage=brushStrokeCoverage(grid,points,100,0,{brushModel:'photoshop',flow:1,spacing:.01}),tail=coverage[256*width+1586]
 // The aligned center is490; this source pixel is93.375px away, inside the
 // model four-sigma footprint. Fifty dabs accumulate visible Alpha here.
 // A ROI derived only from the unaligned490.9 pointer drops it altogether.
 assert.ok(tail>=4&&tail<=5,`Accumulated source tail ${tail}/255`)
})
