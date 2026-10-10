import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {brushStrokeCoverage} from '../src/shared/brush-coverage'
const transform={origin:[0,0] as [number,number],size:[32,24] as [number,number],rotation:0,flipX:false,flipY:false,sampling:'High quality' as const}
test('continuous hard and soft brush coverage matches 32 independent original Metal GPU references',async()=>{
 const fixture=JSON.parse(await readFile('fixtures/parity/native-1.4.8-brush.json','utf8'));assert.equal(fixture.rows.length,32)
 for(const row of fixture.rows){const actual=brushStrokeCoverage(row,row.points,row.size,row.hardness);let maximum=0;for(let i=0;i<actual.length;i++)maximum=Math.max(maximum,Math.abs(actual[i]-row.expected[i]));assert.ok(maximum<=1,`${row.hardness}/${row.transform.rotation}/${row.points.length}: ${maximum}`)}
})
test('hard tips retain antialiasing, soft density accumulates on return travel, and document bounds clip rotated/flipped pixels',()=>{
 const grid={width:32,height:24,transform},single=brushStrokeCoverage(grid,[[10.3,10.6]],9,1);assert.ok(single.some(value=>value>0&&value<255));assert.equal(single[10*32+10],255)
 const line=brushStrokeCoverage(grid,[[4,4],[24,16]],9,.4),returning=brushStrokeCoverage(grid,[[4,4],[24,16],[4,4]],9,.4);assert.ok(returning.some((value,index)=>value>line[index]));assert.ok(returning.every((value,index)=>value>=line[index]))
 const clipped=brushStrokeCoverage({...grid,canvasWidth:8,canvasHeight:8},[[7,7],[15,15]],12,.5);for(let y=0;y<24;y++)for(let x=0;x<32;x++)if(x>=8||y>=8)assert.equal(clipped[y*32+x],0)
 const flipped=brushStrokeCoverage({...grid,transform:{...transform,flipX:true}},[[10.3,10.6]],9,1);for(let y=0;y<24;y++)for(let x=0;x<32;x++)assert.equal(flipped[y*32+x],single[y*32+31-x])
 for(const hardness of [-1,2,NaN])assert.throws(()=>brushStrokeCoverage(grid,[[1,1]],9,hardness));assert.throws(()=>brushStrokeCoverage({...grid,width:30001},[[1,1]],9,1))
})
