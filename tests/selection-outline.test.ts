import test from 'node:test'
import assert from 'node:assert/strict'
import {rasterSelectionOutline,selectionOutline} from '../src/shared/selection-outline'
import {selectionCoverage} from '../src/shared/selection-coverage'
import type {Selection} from '../src/shared/pixel-contracts'

type Raster=NonNullable<Selection['shapes'][number]['raster']>
function raster(width:number,height:number,runs:Raster['runs']):Raster{return {width,height,runs,transform:{origin:[0,0],size:[width,height],rotation:0,flipX:false,flipY:false}}}
function metrics(path:string):{areas:number[];perimeter:number}{
  const areas:number[]=[];let perimeter=0
  for(const subpath of path.match(/M[^M]+/g)??[]){let x=0,y=0,startX=0,startY=0,area=0
    for(const command of subpath.matchAll(/([MHVZ])([^MHVZ]*)/g)){const values=command[2].trim().split(/\s+/).map(Number);let nextX=x,nextY=y
      if(command[1]==='M'){[x,y]=values;startX=x;startY=y;continue}
      if(command[1]==='H')nextX=values[0];else if(command[1]==='V')nextY=values[0];else {nextX=startX;nextY=startY}
      area+=x*nextY-nextX*y;perimeter+=Math.abs(x-nextX)+Math.abs(y-nextY);x=nextX;y=nextY
    }
    areas.push(area/2)
  }
  return {areas,perimeter}
}

test('adjacent RLE rows merge into one exterior without horizontal interior lines',()=>{
  const mask=raster(4,3,[[0,0,4,255],[1,0,2,128],[1,2,2,255],[2,0,4,128]])
  const path=rasterSelectionOutline(mask)
  assert.deepEqual(metrics(path),{areas:[12],perimeter:14})
  assert.equal(path.match(/M/g)?.length,1);assert.equal(path.match(/[HV]/g)?.length,4)
  assert.equal(rasterSelectionOutline(mask),path)
})

test('holes have an independent opposite winding and exact perimeter',()=>{
  const path=rasterSelectionOutline(raster(5,5,[[0,0,5,255],[1,0,1,255],[1,4,1,255],[2,0,1,255],[2,4,1,255],[3,0,1,255],[3,4,1,255],[4,0,5,255]]))
  const result=metrics(path)
  assert.deepEqual(result.areas.sort((a,b)=>a-b),[-9,25]);assert.equal(result.perimeter,32)
})

test('separate fragments and diagonal pixel contacts remain separate contours',()=>{
  const path=rasterSelectionOutline(raster(6,4,[[0,0,1,255],[1,1,1,255],[3,4,2,255]]))
  assert.deepEqual(metrics(path),{areas:[1,1,2],perimeter:14})
})

test('coverage below 50 percent has no ants and strong malformed runs clip to raster bounds',()=>{
  const path=rasterSelectionOutline(raster(4,2,[[0,-2,4,1],[0,2,8,127],[1,0,4,0],[3,0,4,255]]))
  assert.equal(path,'')
  assert.deepEqual(metrics(rasterSelectionOutline(raster(4,2,[[0,-2,4,128],[0,2,8,255]]))),{areas:[4],perimeter:10})
  assert.equal(rasterSelectionOutline(raster(4,2,[])),'')
})

test('ordered overlapping runs let later weak and zero coverage erase an earlier contour',()=>{
 const mask=raster(6,2,[[0,0,6,255],[0,2,2,127],[0,5,1,0],[1,0,6,127],[1,1,3,128]])
 assert.deepEqual(metrics(rasterSelectionOutline(mask)),{areas:[5,1],perimeter:16})
})

function selectionFromRaster(mask:Raster,operation:Selection['shapes'][number]['operation']='replace'):Selection['shapes'][number]{return {kind:'raster',operation,feather:0,bounds:[0,0,mask.width,mask.height],raster:mask}}
test('weak masks combine their coverage before the 50 percent display threshold',()=>{
 const first=selectionFromRaster(raster(4,1,[[0,0,1,127],[0,1,1,128],[0,2,1,153],[0,3,1,255]]))
 const second=raster(4,1,[[0,0,1,128],[0,1,1,128],[0,2,1,102],[0,3,1,255]])
 // Independent byte arithmetic: max(a,b), a*(1-b/255), a*b/255.
 const expectations={add:4,subtract:0,intersect:1} as const
 for(const operation of ['add','subtract','intersect'] as const)for(const inverted of [false,true]){
  const selection:Selection={shapes:[structuredClone(first),selectionFromRaster(structuredClone(second),operation)],inverted}
  const original=structuredClone(selection),area=metrics(selectionOutline(selection,4,1)).areas.reduce((a,b)=>a+b,0)
  assert.equal(area,inverted?4-expectations[operation]:expectations[operation],`${operation}/${inverted}`)
  assert.deepEqual(selection,original)
 }
})

test('tiny feathered region retains weak editable coverage without a visible contour',()=>{
 const selection:Selection={shapes:[{kind:'rectangle',operation:'replace',bounds:[60,60,8,8],feather:0}],inverted:false,feather:40,canvasSize:[128,128]}
 const original=structuredClone(selection),coverage=selectionCoverage(selection,64.5,64.5)
 assert.ok(coverage>0&&coverage<.5);assert.equal(selectionOutline(selection,128,128),'')
 assert.equal(selectionCoverage(selection,64.5,64.5),coverage);assert.deepEqual(selection,original)
 assert.deepEqual(metrics(selectionOutline({...selection,inverted:true},128,128)),{areas:[128*128],perimeter:512})
})

test('small feather ROI works on a large document while unbounded soft display is rejected atomically',()=>{
 const selection:Selection={shapes:[{kind:'rectangle',operation:'replace',bounds:[100,100,8,8],feather:0}],inverted:false,feather:40,canvasSize:[10000,10000]}
 const original=structuredClone(selection)
 assert.equal(selectionOutline(selection,10000,10000),'')
 assert.throws(()=>selectionOutline({...selection,inverted:true},10000,10000),/coverage work budget/)
 assert.deepEqual(selection,original)
})

test('uniform feathered full and empty selections retain sparse scanlines at 100MP',()=>{
 const selection:Selection={shapes:[{kind:'rectangle',operation:'replace',bounds:[0,0,10000,10000],feather:0}],inverted:false,feather:250,canvasSize:[10000,10000]}
 assert.deepEqual(metrics(selectionOutline(selection,10000,10000)),{areas:[100_000_000],perimeter:40000})
 assert.equal(selectionOutline({...selection,inverted:true},10000,10000),'')
 assert.equal(selectionOutline({shapes:[],inverted:false,feather:250},10000,10000),'')
 assert.deepEqual(metrics(selectionOutline({shapes:[],inverted:true,feather:250},10000,10000)),{areas:[100_000_000],perimeter:40000})
})

test('antialiased composite contour uses an independent 4x4 area oracle after combining shapes',()=>{
 for(const operation of ['add','subtract','intersect'] as const)for(const inverted of [false,true]){
  const selection:Selection={inverted,shapes:[{kind:'ellipse',operation:'replace',feather:0,bounds:[1,1,6,5]},{kind:'polygon',operation,feather:0,bounds:[2,1,6,6],points:[[2,1],[8,1],[2,7]]}]}
  let expected=0
  for(let y=0;y<9;y++)for(let x=0;x<10;x++){
   let count=0
   for(let yy=0;yy<4;yy++)for(let xx=0;xx<4;xx++){
    const u=x+(xx+.5)/4,v=y+(yy+.5)/4,a=((u-4)/3)**2+((v-3.5)/2.5)**2<=1,b=u>=2&&v>=1&&u+v<9
    const selected=operation==='add'?a||b:operation==='subtract'?a&&!b:a&&b
    if(inverted?!selected:selected)count++
   }
   if(count>=8)expected++
  }
  assert.equal(metrics(selectionOutline(selection,10,9)).areas.reduce((a,b)=>a+b,0),expected,`${operation}/${inverted}`)
 }
})

test('feathered composite contour agrees with independently integrated Gaussian threshold',()=>{
 const width=18,height=16,sigma=2,radius=8,weights:number[]=[]
 // Midpoint integration of the Gaussian over each pixel is independent of the
 // production erf approximation and separable/FFT implementation.
 for(let offset=-radius;offset<=radius;offset++){let weight=0;for(let i=0;i<128;i++){const at=offset-.5+(i+.5)/128;weight+=Math.exp(-at*at/(2*sigma*sigma))}weights.push(weight)}
 const total=weights.reduce((a,b)=>a+b,0);for(let i=0;i<weights.length;i++)weights[i]/=total
 for(const operation of ['add','subtract','intersect'] as const)for(const inverted of [false,true]){
  const selection:Selection={inverted,feather:4,canvasSize:[width,height],shapes:[{kind:'rectangle',operation:'replace',feather:0,bounds:[3,3,6,6]},{kind:'rectangle',operation,feather:0,bounds:[7,5,6,5]}]}
  const raw=Array.from({length:width*height},(_,at)=>{const x=at%width,y=Math.floor(at/width),a=x>=3&&x<9&&y>=3&&y<9,b=x>=7&&x<13&&y>=5&&y<10,selected=operation==='add'?a||b:operation==='subtract'?a&&!b:a&&b;return inverted?!selected:selected})
  let expected=0
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   let coverage=0
   for(let yy=-radius;yy<=radius;yy++)for(let xx=-radius;xx<=radius;xx++)if(raw[Math.max(0,Math.min(height-1,y+yy))*width+Math.max(0,Math.min(width-1,x+xx))])coverage+=weights[yy+radius]*weights[xx+radius]
   if(Math.round(coverage*255)>=128)expected++
  }
  const original=structuredClone(selection)
  assert.equal(metrics(selectionOutline(selection,width,height)).areas.reduce((a,b)=>a+b,0),expected,`${operation}/${inverted}`)
  assert.deepEqual(selection,original)
 }
})

test('per-shape feather is respected even without a global feather field',()=>{
 const selection:Selection={shapes:[{kind:'rectangle',operation:'replace',bounds:[60,60,8,8],feather:40}],inverted:false,canvasSize:[128,128]}
 assert.equal(selectionOutline(selection,128,128),'')
 assert.ok(selectionCoverage(selection,64.5,64.5)>0)
})

test('weak sparse raster and additive masks keep the scanline path on a 100MP canvas',()=>{
 const mask=raster(10000,10000,[[100,100,2,127],[101,100,2,128]])
 const selection:Selection={inverted:false,shapes:[selectionFromRaster(mask)]}
 assert.deepEqual(metrics(selectionOutline(selection,10000,10000)),{areas:[2],perimeter:6})
 assert.equal(metrics(selectionOutline({...selection,inverted:true},10000,10000)).areas.reduce((a,b)=>a+b,0),100_000_000-2)
 const add=selectionFromRaster(raster(10000,10000,[[100,100,2,128]]),'add')
 assert.deepEqual(metrics(selectionOutline({...selection,shapes:[...selection.shapes,add]},10000,10000)),{areas:[4],perimeter:8})
})

test('large sparse selections show all scanlines without allocating a dense surface',()=>{
  const mask=raster(30_000,30_000,Array.from({length:3000},(_,y)=>[y,29_999,1,255]))
  assert.deepEqual(metrics(rasterSelectionOutline(mask)),{areas:[3000],perimeter:6002})
  assert.equal(rasterSelectionOutline(mask).match(/[HV]/g)?.length,4)
})

test('irregular RLE contours match independent pixel area and exposed-edge perimeter',()=>{
  let seed=31
  for(let sample=0;sample<50;sample++){
    const pixels=Array.from({length:9},()=>Array.from({length:11},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%5<2}))
    const runs:Raster['runs']=[];let area=0,perimeter=0
    for(let y=0;y<pixels.length;y++)for(let x=0;x<pixels[y].length;x++)if(pixels[y][x]){runs.push([y,x,1,255]);area++;for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]])if(!pixels[y+dy]?.[x+dx])perimeter++}
    const actual=metrics(rasterSelectionOutline(raster(11,9,runs)))
    assert.equal(actual.areas.reduce((sum,value)=>sum+value,0),area,`area ${sample}`);assert.equal(actual.perimeter,perimeter,`perimeter ${sample}`)
  }
})
