import test from 'node:test'
import assert from 'node:assert/strict'
import {cubicVectorPoint,deleteVectorKnot,flattenVectorPath,moveVectorKnot,rasterizeVectorPath,setVectorKnotHandle,splitVectorSegment,validateVectorPath,vectorPathSelection,vectorPathSVG,type VectorPath,type VectorPoint} from '../src/shared/vector-path'
function rectangle(x:number,y:number,w:number,h:number,prefix='r',reverse=false){let points:VectorPoint[]=[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];if(reverse)points=points.reverse();return {id:prefix,closed:true,knots:points.map((point,i)=>({id:prefix+i,point}))}}
const rect=():VectorPath=>({fillRule:'nonzero',subpaths:[rectangle(2,2,6,4)]})
test('strict finite cubic model rejects duplicate IDs, excess knots, nonfinite handles and illegal closure',()=>{
 const p=rect();assert.deepEqual(validateVectorPath(p),p)
 for(const invalid of [{...p,subpaths:[p.subpaths[0],p.subpaths[0]]},{fillRule:'nonzero',subpaths:[{id:'only',closed:true,knots:[{id:'one',point:[1,2]}]}]},{fillRule:'nonzero',subpaths:[{id:'bad',closed:false,knots:[{id:'node',point:[1,2],outHandle:[Infinity,1]}]}]},{fillRule:'nonzero',subpaths:[{id:'overflow',closed:false,knots:Array.from({length:4097},(_,i)=>({id:'k'+i,point:[0,0]}))}]}])assert.throws(()=>validateVectorPath(invalid))
})
test('adaptive cubic flattening stays within analytical curve tolerance and handles collinear overshoot',()=>{
 const curve:VectorPath={fillRule:'nonzero',subpaths:[{id:'curve',closed:false,knots:[{id:'a',point:[0,0],outHandle:[0,12]},{id:'b',point:[12,0],inHandle:[12,12]}]}]},flat=flattenVectorPath(curve,.05)[0].points
 assert.deepEqual(cubicVectorPoint([0,0],[0,12],[12,12],[12,0],.5),[6,9]);assert.ok(flat.length>10)
 const distance=(p:VectorPoint,a:VectorPoint,b:VectorPoint)=>{const x=b[0]-a[0],y=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*x+(p[1]-a[1])*y)/(x*x+y*y)));return Math.hypot(p[0]-a[0]-t*x,p[1]-a[1]-t*y)}
 for(let i=0;i<=100;i++){const point=cubicVectorPoint([0,0],[0,12],[12,12],[12,0],i/100);assert.ok(Math.min(...flat.slice(1).map((next,index)=>distance(point,flat[index],next)))<=.051)}
 const overshoot:VectorPath={fillRule:'nonzero',subpaths:[{id:'overshoot',closed:false,knots:[{id:'o1',point:[0,0],outHandle:[100,0]},{id:'o2',point:[10,0],inHandle:[100,0]}]}]}
 assert.ok(flattenVectorPath(overshoot,.1)[0].points.some(point=>point[0]>50),'Collinear controls beyond the endpoint must not collapse to one line segment')
 assert.throws(()=>flattenVectorPath(curve,.01,2),/point budget/)
 assert.match(vectorPathSVG(curve),/^M 0 0 C 0 12 12 12 12 0$/);assert.match(vectorPathSVG(rect()),/Z$/)
})
test('exact cubic subdivision, node moves and symmetric handle conversion preserve geometry/control relations',()=>{
 const path:VectorPath={fillRule:'nonzero',subpaths:[{id:'c',closed:false,knots:[{id:'a',point:[0,0],outHandle:[0,12]},{id:'b',point:[12,0],inHandle:[12,12]}]}]},split=splitVectorSegment(path,'c','a',.5,'middle'),[a,m,b]=split.subpaths[0].knots
 assert.deepEqual(m.point,[6,9]);assert.deepEqual(a.outHandle,[0,6]);assert.deepEqual(b.inHandle,[12,6])
 for(const t of [.1,.3,.6,.9]){const actual:VectorPoint=t<=.5?cubicVectorPoint(a.point,a.outHandle!,m.inHandle!,m.point,t*2):cubicVectorPoint(m.point,m.outHandle!,b.inHandle!,b.point,(t-.5)*2),expected=cubicVectorPoint([0,0],[0,12],[12,12],[12,0],t);for(let i=0;i<2;i++)assert.ok(Math.abs(actual[i]-expected[i])<1e-10)}
 const moved=moveVectorKnot(split,'middle',[9,13]).subpaths[0].knots[1];assert.deepEqual(moved.inHandle,[6,13]);assert.deepEqual(moved.outHandle,[12,13])
 const smooth=setVectorKnotHandle(split,'middle','outHandle',[10,10],true).subpaths[0].knots[1];assert.deepEqual(smooth.inHandle,[2,8]);assert.deepEqual(deleteVectorKnot(split,'middle').subpaths[0].knots.length,2)
 assert.equal(path.subpaths[0].knots.length,2,'Editing does not mutate the caller source')
})
test('scanline fill uses finite 4x4 subpixel coverage and nonzero/evenodd winding for compound holes',()=>{
 const fractional:VectorPath={fillRule:'nonzero',subpaths:[rectangle(.25,.25,1,1)]};assert.deepEqual([...rasterizeVectorPath(fractional,2,2)],[143,48,48,16])
 const outer=rectangle(0,0,10,10,'outer'),inner=rectangle(3,3,4,4,'inner'),index=5*10+5
 assert.equal(rasterizeVectorPath({fillRule:'nonzero',subpaths:[outer,inner]},10,10)[index],255)
 assert.equal(rasterizeVectorPath({fillRule:'evenodd',subpaths:[outer,inner]},10,10)[index],0)
 assert.equal(rasterizeVectorPath({fillRule:'nonzero',subpaths:[outer,rectangle(3,3,4,4,'hole',true)]},10,10)[index],0)
 const shape=vectorPathSelection(rect(),10,8,false);assert.equal(shape.raster!.runs.length,4);assert.deepEqual(shape.raster!.runs[0],[2,2,6,255])
 assert.throws(()=>rasterizeVectorPath(rect(),30_000,30_000),/canvas budget/);assert.throws(()=>rasterizeVectorPath(rect(),10_000,10_000),/work budget/)
})
