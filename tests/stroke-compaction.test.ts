import test from 'node:test'
import assert from 'node:assert/strict'
import {compactStroke,strokeSegments,type StrokePoint} from '../src/shared/stroke-compaction'
import {brushStrokeCoverage} from '../src/shared/brush-coverage'
import {Editor} from '../src/core/editor'
import {PNG} from 'pngjs'
function distance(p:StrokePoint,a:StrokePoint,b:StrokePoint){const dx=b[0]-a[0],dy=b[1]-a[1],s=dx*dx+dy*dy,t=s?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/s)):0;return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)}
test('100k oversampled points retain both endpoints and exact straight geometry without losing the last segment',()=>{
 const points=Array.from({length:100000},(_,i)=>[i/100,2*i/100] as StrokePoint);assert.deepEqual(compactStroke(points),[points[0],points.at(-1)!]);assert.deepEqual(compactStroke([[0,0],[0,0],[1,0],[1,0]]),[[0,0],[1,0]])
})
test('collinear direction reversals survive even when every vertex lies inside the endpoint segment',()=>{
 const critical:StrokePoint[]=[[0,0],[5,0],[0,0],[5,0]]
 assert.deepEqual(compactStroke(critical),critical)
 const dense:StrokePoint[]=[[0,0]]
 for(let leg=0;leg<3;leg++)for(let step=1;step<=1000;step++)dense.push([leg%2?5-5*step/1000:5*step/1000,0])
 assert.deepEqual(compactStroke(dense),critical)
 const repeated:StrokePoint[]=Array.from({length:100_000},(_,i)=>[i%2?5:0,0])
 assert.deepEqual(compactStroke(repeated),repeated,'Budget handling must preserve the entire 100k sequence of reversals')
})
test('compaction preserves sharp corners, return travel and per-point error bound on a curved stroke',()=>{
 assert.deepEqual(compactStroke([[0,0],[1,0],[2,0],[1,0],[0,0]]),[[0,0],[2,0],[0,0]])
 const points=Array.from({length:5000},(_,i)=>[i/100,4*Math.sin(i/200)] as StrokePoint),output=compactStroke(points,.125);assert.deepEqual(output[0],points[0]);assert.deepEqual(output.at(-1),points.at(-1));assert.ok(output.length<points.length/10)
 for(const p of points)assert.ok(Math.min(...output.slice(1).map((b,i)=>distance(p,output[i],b)))<=.125+1e-9)
 assert.throws(()=>compactStroke([[0,NaN]]));assert.throws(()=>compactStroke([[0,0]],-1))
})
test('bounded simplifier retains high-detail geometry on budget exhaustion; no silent prefix truncation',()=>{
 const points=Array.from({length:5000},(_,i)=>[i,(i%2)*10] as StrokePoint),output=compactStroke(points,.01);assert.deepEqual(output,points);assert.deepEqual(strokeSegments([[0,0],[100,100]],8).at(-1)?.slice(2),[100,100]);assert.throws(()=>strokeSegments([[0,0],[1000000,1000000]],1),/budget/)
})
test('many long diagonal brush passes follow a narrow footprint without the former full-rectangle compute rejection',()=>{
 const size=2048,points:StrokePoint[]=Array.from({length:51},(_,i)=>i%2?[size-2,size-2]:[2,2]),transform={origin:[0,0] as StrokePoint,size:[size,size] as StrokePoint,rotation:0,flipX:false,flipY:false,sampling:'Nearest' as const},coverage=brushStrokeCoverage({width:size,height:size,transform},points,2,1)
 assert.equal(coverage[2*size+2],255);assert.equal(coverage[(size-3)*size+size-3],255);assert.equal(coverage[2*size+size-3],0)
})
test('5000-point paint action commits its entire path, including the tail after the former 2048-point limit, and undo restores pixels',()=>{
 const editor=new Editor();editor.create(512,64);editor.apply({...editor.identity(),action:{type:'layer.add_blank',name:'long stroke'}});const layer=editor.state().manifest.layers[0],before=editor.snapshot(),points=Array.from({length:5000},(_,i)=>[5+i*500/4999,32+4*Math.sin(i/400)] as StrokePoint);editor.apply({...editor.identity(),action:{type:'layer.paint',layerId:layer.id,points,color:[1,0,0,1],size:4,hardness:1,opacity:1,erase:false,target:'image'}});const snapshot=editor.snapshot(),painted=snapshot.manifest.layers[0],png=PNG.sync.read(snapshot.assets.get(painted.imageFile!)!.bytes),last=points.at(-1)!,x=Math.floor((last[0]-painted.transform.origin[0])/painted.transform.size[0]*png.width),y=Math.floor((last[1]-painted.transform.origin[1])/painted.transform.size[1]*png.height);assert.equal(png.data[(y*png.width+x)*4+3],255);editor.history({...editor.identity(),direction:'undo'});assert.deepEqual(editor.snapshot(),before)
})
