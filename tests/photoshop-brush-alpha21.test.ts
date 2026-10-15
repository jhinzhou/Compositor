import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {inflateSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {brushStrokeCoverage} from '../src/shared/brush-coverage'
const read=(path:string)=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'))
const native=read('../fixtures/parity/photoshop-27.11-brush-v7.json'),limits=read('../fixtures/parity/photoshop-alpha21-brush-limits.json')
const grid={width:256,height:192,transform:{origin:[0,0] as [number,number],size:[256,192] as [number,number],rotation:0,flipX:false,flipY:false,sampling:'High quality' as const}}
const hash=(a:Uint8Array)=>createHash('sha256').update(a).digest('hex')
test('v7 near-hard holdouts retain 46 independent native outputs and immutable alpha hashes',()=>{
 assert.equal(native.rows.length,46)
 assert.equal(hash(readFileSync(new URL('../scripts/native-reference/photoshop-brush-study-v7.jsx',import.meta.url))),native.provenance.nativeScriptSHA256)
 for(const r of native.rows)assert.equal(hash(inflateSync(Buffer.from(r.alphaLEZlib,'base64'))),r.alphaSHA256)
})
for(const row of native.rows)test(`alpha21 native holdout: ${row.name}`,()=>{
 const raw=inflateSync(Buffer.from(row.alphaLEZlib,'base64')),a=brushStrokeCoverage(grid,row.points,row.size,row.hardness,{flow:row.flow,spacing:row.spacing,brushModel:'photoshop'}),limit=limits.rows.find((r:{name:string})=>r.name===row.name)
 let sum=0,union=0,max=0;for(let i=0;i<a.length;i++){const v=raw.readUInt16LE(i*2),e=Math.abs(a[i]-v);sum+=e;union+=v||a[i]?1:0;max=Math.max(max,e)}
 assert.ok(max<=limit.maxAlpha+1,`max ${max}, fixed candidate ${limit.maxAlpha}`)
 assert.ok(sum/union<=limit.unionMAE+.02,`MAE ${sum/union}, fixed candidate ${limit.unionMAE}`)
 if(row.hardness===.95&&row.size>=64&&row.flow===1){assert.ok(max<limit.baseline.max*.7);assert.ok(sum/union<limit.baseline.unionMAE*.75)}
})
test('bounded shoulder geometry joins smoothly across width, hardness, and scaled source grids',()=>{
 for(const hardness of [.9,.92,.95,.97,.99,1])for(const width of [.375,.75,1.5]){
  const size=width/(15/64*Math.max(1-hardness,.001));if(size>256)continue
  const a=brushStrokeCoverage(grid,[[128,96]],size-1e-6,hardness,{flow:1,brushModel:'photoshop'}),b=brushStrokeCoverage(grid,[[128,96]],size+1e-6,hardness,{flow:1,brushModel:'photoshop'})
  for(let i=0;i<a.length;i++)assert.ok(Math.abs(a[i]-b[i])<=1)
 }
 for(const size of [8,16,32,48,64,96,128])for(const h of [.9,.92,.95,.97,.99,.999999]){
  const a=brushStrokeCoverage(grid,[[128,96]],size,h,{flow:1,brushModel:'photoshop'}),b=brushStrokeCoverage(grid,[[128,96]],size,Math.min(1,h+1e-6),{flow:1,brushModel:'photoshop'})
  for(let i=0;i<a.length;i++)assert.ok(Math.abs(a[i]-b[i])<=1)
 }
})
test('alpha21 keeps low Flow compounded dab semantics independent of event density',()=>{
 const sparse:[number,number][]=[[48,96],[208,96]],dense:[number,number][]=Array.from({length:161},(_,i)=>[48+i,96])
 for(const h of [.92,.95,.97])for(const spacing of [.1,.2,.25])assert.deepEqual(brushStrokeCoverage(grid,sparse,64,h,{flow:.2,spacing,brushModel:'photoshop'}),brushStrokeCoverage(grid,dense,64,h,{flow:.2,spacing,brushModel:'photoshop'}))
})
