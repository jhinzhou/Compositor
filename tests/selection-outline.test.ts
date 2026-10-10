import test from 'node:test'
import assert from 'node:assert/strict'
import {rasterSelectionOutline} from '../src/shared/selection-outline'
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
  const mask=raster(4,3,[[0,0,4,255],[1,0,2,128],[1,2,2,255],[2,0,4,1]])
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

test('soft nonzero coverage traces the native outline and clips malformed runs to raster bounds',()=>{
  const path=rasterSelectionOutline(raster(4,2,[[0,-2,4,1],[0,2,8,127],[1,0,4,0],[3,0,4,255]]))
  assert.deepEqual(metrics(path),{areas:[4],perimeter:10})
  assert.equal(rasterSelectionOutline(raster(4,2,[])),'')
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
