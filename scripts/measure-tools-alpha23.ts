import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {inflateSync} from 'node:zlib'
import assert from 'node:assert/strict'
import {quickSelection} from '../src/core/image-driven-selection'
const fixture=JSON.parse(await readFile('fixtures/parity/photoshop-27.11-tools-alpha23.json','utf8')),data=inflateSync(Buffer.from(fixture.source.rgbaZlib,'base64')),native=inflateSync(Buffer.from(fixture.coverage.grayZlib,'base64'))
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');assert.equal(sha(data),fixture.source.sha256);assert.equal(sha(native),fixture.coverage.sha256)
const result=quickSelection({width:fixture.width,height:fixture.height,data},fixture.operation.points,{size:fixture.operation.size,tolerance:fixture.operation.tolerance,edgeSensitivity:fixture.operation.edgeSensitivity,antialiased:true})
let intersection=0,union=0,different=0,absolute=0,nativeArea=0,productArea=0
for(let i=0;i<native.length;i++){const a=result.coverage[i],b=native[i];intersection+=Math.min(a,b);union+=Math.max(a,b);different+=a!==b?1:0;absolute+=Math.abs(a-b);nativeArea+=b/255;productArea+=a/255}
const {source,coverage,...metadata}=fixture,report={...metadata,nativeArea,productArea,coverageIoU:intersection/union,coverageMAE:absolute/native.length,differentPixels:different,pixelExact:different===0,sourceRGBAHash:sha(data),coverageHash:sha(native)}
await mkdir('artifacts/photoshop-native/measurements/tools-alpha23',{recursive:true});await writeFile('artifacts/photoshop-native/measurements/tools-alpha23/quick-comparison.json',JSON.stringify(report,null,2));console.log(report)
