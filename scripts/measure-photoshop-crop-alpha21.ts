import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {inflateSync} from 'node:zlib'
import {PNG} from 'pngjs'
import {makeAsset} from '../src/core/project-io'
import {perspectiveCropRaster} from '../src/core/crop-actions'

// Recompute product errors against immutable archived native RGBA. This script
// writes only measurements, never replaces the native fixture or its limits.
const fixturePath='fixtures/parity/photoshop-27.11-crop-alpha21-ui.json'
const fixture=JSON.parse(await readFile(fixturePath,'utf8'))
const decode=(value:{rgbaZlib:string;rgbaSHA256:string})=>{
 const bytes=inflateSync(Buffer.from(value.rgbaZlib,'base64'))
 assert.equal(createHash('sha256').update(bytes).digest('hex'),value.rgbaSHA256)
 return bytes
}
const source=new PNG({width:fixture.sourceWidth,height:fixture.sourceHeight})
source.data=decode(fixture.source)
const native=decode(fixture.perspective.native),[width,height]=fixture.perspective.controlledSize
assert.equal(native.length,width*height*4)
const asset=makeAsset('00000000-0000-4000-8000-000000000001.png',PNG.sync.write(source))
const result=perspectiveCropRaster(asset,{origin:[0,0],size:[source.width,source.height],rotation:0,flipX:false,flipY:false,sampling:'High quality'},fixture.perspective.corners,width,height,'High quality')
const actual=PNG.sync.read(result.bytes)
assert.equal(actual.width,width);assert.equal(actual.height,height)
let sum=0,squares=0,max=0,differing=0,alphaMax=0
for(let i=0;i<native.length;i++){
 const delta=Math.abs(actual.data[i]!-native[i]!)
 if(i%4===3){alphaMax=Math.max(alphaMax,delta);continue}
 sum+=delta;squares+=delta*delta;max=Math.max(max,delta);if(delta)differing++
}
const count=width*height*3
const stats={rgbMAE:sum/count,rgbRMSE:Math.sqrt(squares/count),rgbMaxDelta:max,rgbDifferingChannels:differing,alphaMaxDelta:alphaMax,comparedRGBChannels:count}
const output=process.argv[2]??'artifacts/photoshop-native/measurements/crop-alpha21'
await mkdir(output,{recursive:true})
await writeFile(output+'/electron-controlled.png',result.bytes)
await writeFile(output+'/comparison.json',JSON.stringify(stats,null,2)+'\n')
console.log(JSON.stringify({fixture:fixturePath,...stats},null,2))
