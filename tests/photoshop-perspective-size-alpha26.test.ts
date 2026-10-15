import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {photoshopPerspectiveCropSize,perspectiveCropSize,perspectiveCropMatrix,type CropCorners} from '../src/shared/crop-projective'
type Case={name:string;corners:CropCorners;width:number;height:number;sourceCenter:[number,number];referenceKind:string}
const fixture=JSON.parse(readFileSync(new URL('../fixtures/parity/photoshop-27.11-perspective-size-alpha26.json',import.meta.url),'utf8')) as {source:{width:number;height:number};cases:Case[]}
const estimate=(reference:Case)=>photoshopPerspectiveCropSize(reference.corners,fixture.source.width,fixture.source.height,undefined,reference.sourceCenter)
test('immutable native dimensions distinguish exact GUI edge geometry from ActionManager camera-center cohorts',()=>{
 assert.equal(fixture.cases.length,19);const gui=fixture.cases.find(c=>c.referenceKind==='native-gui-event')!;assert.deepEqual(gui.corners,[[60,40],[431,55],[401,281],[75,261]]);assert.deepEqual([gui.width,gui.height],[387,257]);assert.deepEqual(estimate(gui),{width:387,height:257})
})
test('REA finite edge ratios reproduce recorded native automatic sizes and improve legacy mean-edge defaults',()=>{
 let previous=0,current=0
 for(const reference of fixture.cases){const old=perspectiveCropSize(reference.corners),next=estimate(reference),error=(size:{width:number;height:number})=>Math.abs(size.width-reference.width)+Math.abs(size.height-reference.height);previous+=error(old);current+=error(next);assert.ok(error(next)<=error(old),reference.name);assert.ok(next.width>0&&next.height>0)}
 assert.ok(current<previous*.5,`${current} vs ${previous}`);assert.equal(current,0,'Recorded native dimension regression; not pixel-equivalence acceptance')
})
test('near-horizon metric camera retains bounded conservative scale instead of allocating its enormous area requirement',()=>{
 // A physical unit square with orthogonal axes, focal=5 and 40-degree Y/X
 // tilts. Its nearest corner depth is .001: finite geometry but huge local
 // sampling density. This is an analytical stability probe, not a PS oracle.
 const angle=40*Math.PI/180,u=[Math.cos(angle),0,-Math.sin(angle)],v=[-(Math.sin(angle)**2),Math.cos(angle),-Math.cos(angle)*Math.sin(angle)],z=-u[2]-v[2]+.001
 const quad=[[0,0],[1,0],[1,1],[0,1]].map(([a,b])=>{const depth=z+a*u[2]+b*v[2];return [256+5*(-.5+a*u[0]+b*v[0])/depth,160+5*(-.5+a*u[1]+b*v[1])/depth]}) as CropCorners
 const matrix=perspectiveCropMatrix(quad,1,1),[a,b,c,d,e,f,g,j]=matrix,determinant=a*(e-f*j)-b*(d-f*g)+c*(d*j-e*g),area=Math.max(...[1,1+g,1+g+j,1+j].map(denominator=>Math.abs(determinant/denominator**3)))
 const longest=Math.max(...quad.map((point,index)=>Math.hypot(point[0]-quad[(index+1)%4][0],point[1]-quad[(index+1)%4][1])))
 assert.ok(Math.sqrt(area)>4*longest,'Area bound must actually be exercised')
 assert.deepEqual(photoshopPerspectiveCropSize(quad,512,320),photoshopPerspectiveCropSize(quad,512,320,1));assert.ok(photoshopPerspectiveCropSize(quad,512,320).width<=Math.round(longest)+1)
 assert.deepEqual(photoshopPerspectiveCropSize([[0,0],[100,1e-10],[100,100],[0,100]],512,320),{width:100,height:100})
 assert.throws(()=>photoshopPerspectiveCropSize([[0,0],[900000,0],[900000,900000],[0,900000]],512,320),/supported canvas/)
})
test('longest source spans reproduce affine, single-vanishing-point and invalid-focal native dimensions',()=>{
 for(const name of ['axis','affine','strong-trapezoid'])for(const reference of fixture.cases.filter(c=>c.name===name))assert.deepEqual(estimate(reference),{width:reference.width,height:reference.height},name)
 const opposite=fixture.cases.find(c=>c.name==='opposite-quad'&&c.sourceCenter[0]===256)!;assert.deepEqual(estimate(opposite),{width:402,height:259})
})
test('document-center camera reconstruction is invariant under source mirror and half-turn',()=>{
 const centered=fixture.cases.filter(c=>c.sourceCenter[0]===256),old=estimate(centered.find(c=>c.name==='old-quad')!)
 for(const name of ['old-quad-mirror','old-quad-half-turn'])assert.deepEqual(estimate(centered.find(c=>c.name===name)!),old)
})
test('REA finite edge ratios resolve the previously recorded document-center holdout residual',()=>{
 const centered=fixture.cases.filter(c=>c.sourceCenter[0]===256)
 for(const reference of centered.filter(c=>c.name!=='camera-valid-holdout'))assert.deepEqual(estimate(reference),{width:reference.width,height:reference.height},reference.name)
 const holdout=centered.find(c=>c.name==='camera-valid-holdout')!;assert.deepEqual(estimate(holdout),{width:395,height:264});assert.deepEqual([holdout.width,holdout.height],[395,264])
})
test('native center changes recovered ratio; explicit user ratio remains authoritative',()=>{
 const references=fixture.cases.filter(c=>c.name==='old-quad'),zero=estimate(references.find(c=>c.sourceCenter[0]===0)!),centered=estimate(references.find(c=>c.sourceCenter[0]===256)!);assert.ok(Math.abs(zero.width/zero.height-382/359)<.005);assert.ok(Math.abs(centered.width/centered.height-387/256)<.005)
 const quad=references[0].corners;assert.deepEqual(photoshopPerspectiveCropSize(quad,512,320,2),{width:454,height:227});assert.deepEqual(perspectiveCropSize(quad),{width:348,height:224})
})
test('size helper rejects invalid source geometry, ratios and source center',()=>{
 const quad=fixture.cases[0].corners
 for(const [width,height]of [[0,320],[512,NaN],[Infinity,320]])assert.throws(()=>photoshopPerspectiveCropSize(quad,width,height),/finite source/)
 for(const ratio of [-1,0,Infinity,NaN])assert.throws(()=>photoshopPerspectiveCropSize(quad,512,320,ratio),/ratio/)
 assert.throws(()=>photoshopPerspectiveCropSize(quad,512,320,undefined,[NaN,160]),/principal point/)
 assert.throws(()=>photoshopPerspectiveCropSize([[0,0],[100,0],[0,100],[100,100]],512,320),/convex/)
})
test('ill-conditioned inferred cameras cannot expand either source span by more than four times',()=>{
 let seed=256160;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/0x100000000}
 for(let index=0;index<250;index++){
  const x=10+random()*20,y=10+random()*20,w=100+random()*200,h=100+random()*150,quad:CropCorners=[[x,y],[x+w,y+random()*25],[x+w-random()*40,y+h],[x+random()*35,y+h-random()*25]],next=photoshopPerspectiveCropSize(quad,512,320)
  const length=(a:number[],b:number[])=>Math.hypot(a[0]-b[0],a[1]-b[1]),longestWidth=Math.max(length(quad[0],quad[1]),length(quad[3],quad[2])),longestHeight=Math.max(length(quad[0],quad[3]),length(quad[1],quad[2]))
  assert.ok(next.width<=4*longestWidth+1);assert.ok(next.height<=4*longestHeight+1);assert.ok(next.width>=Math.round(longestWidth));assert.ok(next.height>=Math.round(longestHeight))
 }
 assert.throws(()=>photoshopPerspectiveCropSize(fixture.cases[0].corners,512,320,1e9),/supported canvas/)
})
