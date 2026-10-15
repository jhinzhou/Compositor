import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {cropCorners,mapCropPoint,perspectiveCropMatrix,photoshopPerspectiveCropSize,photoshopPerspectiveCropGeometry,perspectiveCropExtentCorners,type CropCorners,type CropPoint} from '../src/shared/crop-projective'
import {LIMITS} from '../src/shared/limits'
type Case={name:string;corners:CropCorners;sourceWidth:number;sourceHeight:number;sourceCenter:CropPoint;width:number;height:number;cohort:string;freshAfterV2Freeze:boolean;previous?:{width:number;height:number}}
const fixture=JSON.parse(readFileSync(new URL('../fixtures/parity/photoshop-27.11-perspective-size-rea.json',import.meta.url),'utf8')) as {role:string;candidateSHA256:string;cases:Case[]}
test('56 retained native dimensions match; only final 9 followed the research v2 freeze, all are now disclosed product regression',()=>{
 assert.equal(fixture.role,'recorded-native-size-regression-not-a-new-product-holdout');assert.equal(fixture.cases.length,56)
 assert.equal(fixture.cases.filter(c=>c.freshAfterV2Freeze).length,9)
 let previous=0
 for(const c of fixture.cases){assert.deepEqual(photoshopPerspectiveCropSize(c.corners,c.sourceWidth,c.sourceHeight,undefined,c.sourceCenter),{width:c.width,height:c.height},`${c.name} ${c.sourceCenter}`);if(c.previous)previous+=Math.abs(c.previous.width-c.width)+Math.abs(c.previous.height-c.height)}
 assert.equal(previous,195,'Previous production total width/height error in disclosed 37 cases')
})
test('axis-aligned analytic rectangle isolates center phase, including negative and quarter centers, independent of source parity',()=>{
 const q=cropCorners({x:20,y:30,width:200,height:120})
 for(const [center,width,height] of [[[320,240],200,120],[[320.25,240],201,120],[[320,240.75],200,121],[[-.25,-.75],201,121],[[0,-1],200,120]] as [CropPoint,number,number][]){
  for(const [w,h] of [[640,480],[641,479]])assert.deepEqual(photoshopPerspectiveCropSize(q,w,h,undefined,center),{width,height})
 }
 assert.deepEqual(photoshopPerspectiveCropSize(q,641,479),{width:201,height:121})
 // Explicit aspect remains authoritative and keeps the prior no-phase size.
 assert.deepEqual(photoshopPerspectiveCropSize(q,641,479,2),{width:240,height:120})
})
test('orthogonal 3D plane analytical endpoint density verifies camera scaling without recovered-normal formulas or fixtures',()=>{
 const angle=25*Math.PI/180,u=[Math.cos(angle),0,-Math.sin(angle)],v=[-(Math.sin(angle)**2),Math.cos(angle),-Math.cos(angle)*Math.sin(angle)],W=180,H=120,f=450,center:CropPoint=[320,240]
 for(const z of [300,600,900]){
  const points=[[0,0],[W,0],[W,H],[0,H]].map(([s,t])=>[-65+s*u[0]+t*v[0],-55+s*u[1]+t*v[1],z+s*u[2]+t*v[2]])
  const q=points.map(([x,y,d])=>[center[0]+f*x/d,center[1]+f*y/d]) as CropCorners
  let density=0
  for(let i=0;i<4;i++){
   const j=(i+1)%4,zA=points[i][2],zB=points[j][2],edge=i%2?H:W,sourceLength=Math.hypot(q[i][0]-q[j][0],q[i][1]-q[j][1])
   // Perspective division: interpolation at source t corresponds to physical
   // s=t*zA/((1-t)*zB+t*zA). The two endpoint lengths are edge*s and edge*(1-s).
   const sNearA=.1*zA/(.9*zB+.1*zA),sNearB=.9*zA/(.1*zB+.9*zA)
   density=Math.max(density,.1*sourceLength/(edge*sNearA),.1*sourceLength/(edge*(1-sNearB)))
  }
  assert.deepEqual(photoshopPerspectiveCropSize(q,640,480),{width:Math.floor(W*density+.5),height:Math.floor(H*density+.5)})
 }
})
test('automatic phase cannot bypass side or surface budgets, and malformed centers never propagate NaN',()=>{
 const side=cropCorners({x:0,y:0,width:LIMITS.maxSide,height:1})
 assert.deepEqual(photoshopPerspectiveCropSize(side,640,480),{width:LIMITS.maxSide,height:1})
 assert.throws(()=>photoshopPerspectiveCropSize(side,641,480),/supported canvas/)
 const area=cropCorners({x:0,y:0,width:20_000,height:10_000})
 assert.deepEqual(photoshopPerspectiveCropSize(area,640,480),{width:20_000,height:10_000})
 assert.throws(()=>photoshopPerspectiveCropSize(area,641,479),/supported canvas/)
 for(const center of [[NaN,1],[1,Infinity],[1],[1,2,3]] as CropPoint[])assert.throws(()=>photoshopPerspectiveCropSize(side,640,480,undefined,center),/principal point/)
})
test('caller-supplied output dimensions preserve the explicit edge mapping regardless of automatic center phase',()=>{
 const q:CropCorners=[[20,30],[220,40],[210,150],[25,140]],explicit=perspectiveCropMatrix(q,37,19)
 assert.deepEqual(mapCropPoint(explicit,0,0),q[0]);const bottomRight=mapCropPoint(explicit,1,1);for(let i=0;i<2;i++)assert.ok(Math.abs(bottomRight[i]-q[2][i])<1e-10)
 assert.deepEqual(perspectiveCropMatrix(q,37,19),perspectiveCropMatrix(q,80,50))
 assert.deepEqual(photoshopPerspectiveCropSize(cropCorners({x:0,y:0,width:200,height:120}),641,479,1),{width:200,height:200})
})

test('automatic geometry preserves phase padding instead of stretching the original quad across the extra pixel',()=>{
 const q=cropCorners({x:20,y:30,width:200,height:120}),frame=photoshopPerspectiveCropGeometry(q,640,480,undefined,[320.25,240.75])
 assert.deepEqual(frame.roundedSize,{width:200,height:120});assert.deepEqual(frame.extent,{width:201,height:121});assert.deepEqual(frame.phase,[.25,.75])
 const expected=[[19.75,29.25],[220.75,29.25],[220.75,150.25],[19.75,150.25]];for(let i=0;i<4;i++)for(let j=0;j<2;j++)assert.ok(Math.abs(frame.corners[i][j]-expected[i][j])<1e-10)
 const matrix=perspectiveCropMatrix(frame.corners,201,121),first=mapCropPoint(matrix,.5/201,.5/121),last=mapCropPoint(matrix,200.5/201,120.5/121)
 assert.ok(Math.abs(first[0]-20.25)<1e-10);assert.ok(Math.abs(first[1]-29.75)<1e-10)
 assert.ok(Math.abs(last[0]-220.25)<1e-10);assert.ok(Math.abs(last[1]-149.75)<1e-10)
 assert.deepEqual(q,[[20,30],[220,30],[220,150],[20,150]],'Displayed/user quad remains unchanged')
 for(const aspect of [undefined,2]){const frame=photoshopPerspectiveCropGeometry(q,640,480,aspect);assert.deepEqual(frame.phase,[0,0]);assert.deepEqual(frame.corners,q);assert.deepEqual(frame.extent,frame.roundedSize)}
 const explicit=photoshopPerspectiveCropGeometry(q,641,479,2);assert.deepEqual(explicit.phase,[0,0]);assert.deepEqual(explicit.corners,q);assert.deepEqual(explicit.extent,{width:240,height:120})
})
test('phase extrapolation rejects a pole immediately outside a valid quad and inconsistent metadata before sampling',()=>{
 // H has denominator 1-.99*u: the public source frame is valid, but u=1.1
 // crosses the horizon. Convex endpoints alone must not authorize that map.
 const q:CropCorners=[[0,0],[100,0],[100,100],[0,1]];perspectiveCropMatrix(q,1,100)
 assert.throws(()=>perspectiveCropExtentCorners(q,{width:1,height:100},{width:2,height:100},[.9,0]),/singular mapping/)
 const rect=cropCorners({x:0,y:0,width:20,height:10})
 for(const phase of [[NaN,0],[-.1,0],[1,0],[.5]] as CropPoint[])assert.throws(()=>perspectiveCropExtentCorners(rect,{width:20,height:10},{width:21,height:10},phase),/output phase/)
 assert.throws(()=>perspectiveCropExtentCorners(rect,{width:20,height:10},{width:22,height:10},[.5,0]),/output phase/)
 for(const c of fixture.cases){const frame=photoshopPerspectiveCropGeometry(c.corners,c.sourceWidth,c.sourceHeight,undefined,c.sourceCenter);assert.deepEqual(frame.extent,{width:c.width,height:c.height});perspectiveCropMatrix(frame.corners,c.width,c.height)}
})
