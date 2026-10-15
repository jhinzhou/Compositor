import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {photoshopPerspectiveCropSize,perspectiveCropSize,type CropCorners} from '../src/shared/crop-projective'
const calibration=JSON.parse(readFileSync(new URL('../fixtures/parity/photoshop-27.11-perspective-size-calibration-alpha28.json',import.meta.url),'utf8')),independent=JSON.parse(readFileSync(new URL('../fixtures/parity/photoshop-27.11-perspective-size-independent-alpha28.json',import.meta.url),'utf8'))
test('production matches recorded native sizes while preserving the historical alpha28 candidate residuals',()=>{
 const crossgate=JSON.parse(readFileSync(new URL('../fixtures/parity/perspective-size-alpha28-crossgate.json',import.meta.url),'utf8'));assert.equal(crossgate.cases.length,36);let baseline=0,current=0
 for(const c of crossgate.cases){const result=photoshopPerspectiveCropSize(c.corners,c.sourceWidth,c.sourceHeight,undefined,c.sourceCenter),error=Math.abs(result.width-c.width)+Math.abs(result.height-c.height);assert.deepEqual(result,{width:c.width,height:c.height},c.name);assert.ok(error<=c.baselineError,c.name);baseline+=c.baselineError;current+=error}
 assert.equal(baseline,237);assert.equal(current,0)
 const old=crossgate.cases.find((c:any)=>c.name==='camera-valid-holdout'&&c.sourceCenter[0]===256);assert.deepEqual(old.candidate,{width:398,height:265});assert.deepEqual([old.width,old.height],[395,264])
})
test('recorded alpha28 independent native sizes match REA; cohort remains disclosed to this implementation',()=>{
 assert.equal(independent.referenceRole,'independent-after-candidate-freeze');assert.equal(independent.cases.length,6)
 for(const c of independent.cases){const size=photoshopPerspectiveCropSize(c.corners,c.sourceWidth,c.sourceHeight);assert.deepEqual(size,{width:c.width,height:c.height})}
})
test('disclosed calibration matches native dimensions without changing its historical reference role',()=>{
 assert.equal(calibration.referenceRole,'calibration-not-blind')
 for(const c of calibration.cases){const size=photoshopPerspectiveCropSize(c.corners,c.sourceWidth,c.sourceHeight);assert.deepEqual(size,{width:c.width,height:c.height})}
})
test('explicit aspect and legacy mean-edge defaults are preserved; negative focal and one-vanishing-point shapes retain fallback',()=>{
 const q:CropCorners=[[60,40],[430,55],[400,280],[75,260]]
 for(const [ratio,width,height] of [[.5,370,741],[1,370,370],[2,454,227]])assert.deepEqual(photoshopPerspectiveCropSize(q,512,320,ratio),{width,height})
 assert.deepEqual(perspectiveCropSize(q),{width:348,height:224})
 assert.deepEqual(photoshopPerspectiveCropSize([[75,70],[437,70],[390,315],[122,315]],512,384),{width:362,height:249})
})
test('REA automatic size is mirror/quarter-turn covariant and remains finite within four source spans',()=>{
 const q=independent.cases[0].corners as CropCorners,size=photoshopPerspectiveCropSize(q,512,384),mirror=q.map(([x,y])=>[512-x,y]).reverse() as CropCorners
 // Reorder the mirrored corners to preserve the width/height axes.
 const ordered:CropCorners=[mirror[3],mirror[2],mirror[1],mirror[0]];assert.deepEqual(photoshopPerspectiveCropSize(ordered,512,384),size)
 const turn=independent.cases[3];assert.deepEqual(photoshopPerspectiveCropSize(turn.corners,turn.sourceWidth,turn.sourceHeight),{width:size.height,height:size.width})
 let seed=28512;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/0x100000000}
 for(let i=0;i<300;i++){const x=10+random()*20,y=10+random()*20,w=100+random()*200,h=100+random()*150,q:CropCorners=[[x,y],[x+w,y+random()*25],[x+w-random()*40,y+h],[x+random()*35,y+h-random()*25]],s=photoshopPerspectiveCropSize(q,512,384),length=(a:number[],b:number[])=>Math.hypot(a[0]-b[0],a[1]-b[1]),W=Math.max(length(q[0],q[1]),length(q[3],q[2])),H=Math.max(length(q[0],q[3]),length(q[1],q[2]))
  assert.ok(Number.isSafeInteger(s.width)&&Number.isSafeInteger(s.height));assert.ok(s.width<=4*W+1&&s.height<=4*H+1);assert.ok(s.width>=Math.round(W)&&s.height>=Math.round(H))
 }
})
test('invalid geometry, principal point, dimensions and explicit ratio reject without allocating pixel data',()=>{
 const q=independent.cases[0].corners as CropCorners
 for(const [w,h]of [[0,384],[512,NaN],[Infinity,384]])assert.throws(()=>photoshopPerspectiveCropSize(q,w,h),/finite source/)
 assert.throws(()=>photoshopPerspectiveCropSize(q,512,384,undefined,[NaN,192]),/principal point/)
 for(const ratio of [0,-1,Infinity,NaN])assert.throws(()=>photoshopPerspectiveCropSize(q,512,384,ratio),/ratio/)
 assert.throws(()=>photoshopPerspectiveCropSize([[0,0],[100,100],[100,0],[0,100]],512,384),/convex/)
 assert.throws(()=>photoshopPerspectiveCropSize([[0,0],[900000,0],[900000,900000],[0,900000]],512,384),/supported canvas/)
})
test('ill-conditioned near-horizon cameras retain the existing entire conservative inference fallback',()=>{
 // Analytical orthogonal 3D planes, independent of any native reference.
 // Area becomes unbounded near the horizon even when the new depth density
 // alone remains under four source spans. Do not revive a rejected camera.
 const angle=40*Math.PI/180,u=[Math.cos(angle),0,-Math.sin(angle)],v=[-(Math.sin(angle)**2),Math.cos(angle),-Math.cos(angle)*Math.sin(angle)]
 for(const epsilon of [.001,.002,.005]){const z=-u[2]-v[2]+epsilon,q=[[0,0],[1,0],[1,1],[0,1]].map(([a,b])=>{const depth=z+a*u[2]+b*v[2];return [256+5*(-.5+a*u[0]+b*v[0])/depth,160+5*(-.5+a*u[1]+b*v[1])/depth]}) as CropCorners
  const result=photoshopPerspectiveCropSize(q,512,320),conservative=photoshopPerspectiveCropSize(q,512,320,1);assert.deepEqual(result,conservative);assert.ok(result.width<5/epsilon,'Near-depth floor is disabled with rejected area inference')
 }
})
test('recorded Photoshop GUI edge event now resolves its previous one-pixel width residual',()=>{
 const f=JSON.parse(readFileSync(new URL('../fixtures/parity/photoshop-27.11-perspective-size-gui-alpha28.json',import.meta.url),'utf8')),c=f.case
 assert.equal(f.referenceKind,'native-gui-event');assert.deepEqual(c.corners,[[88,33],[457,117],[383,347],[49,298]]);assert.deepEqual(c.sourceCenter,[256,192]);assert.deepEqual([c.width,c.height],[421,306]);assert.deepEqual(photoshopPerspectiveCropSize(c.corners,512,384),{width:421,height:306});assert.deepEqual(c.baseline,{width:420,height:306})
})
