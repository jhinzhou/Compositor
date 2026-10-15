/** Offline host/ELECTRON_RUN_AS_NODE comparison. No Electron app or UI import. */
import {readFileSync,writeFileSync} from 'node:fs'
import {inflateSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {PNG} from 'pngjs'
import {makeAsset} from '../src/core/project-io'
import {perspectiveCropRaster} from '../src/core/crop-actions'
import {cropLanczos3,sampleCropBicubic} from '../src/core/crop-sampling'
const fixture=JSON.parse(readFileSync('fixtures/parity/photoshop-27.11-perspective-gui-alpha27.json','utf8')),source=inflateSync(Buffer.from(fixture.source.rgbaZlib,'base64')),png=new PNG({width:384,height:256});png.data.set(source)
const asset=makeAsset('source.png',PNG.sync.write(png)),placement={origin:[0,0] as [number,number],size:[384,256] as [number,number],rotation:0,flipX:false,flipY:false,sampling:'High quality' as const},quad:[[number,number],[number,number],[number,number],[number,number]]=[[0,0],[384,0],[384,256],[0,256]]
const actual=PNG.sync.read(readFileSync('artifacts/alpha27-development-final/perspective-alpha27/affine-8-actual.png')),expected=PNG.sync.read(readFileSync('artifacts/alpha27-development-final/perspective-alpha27/affine-8-expected.png'))
const output=perspectiveCropRaster(asset,placement,quad,240,160,'High quality'),pixels=PNG.sync.read(output.bytes),sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex'),difference=(a:Uint8Array,b:Uint8Array)=>{let count=0,max=0;const channels=[0,0,0,0],rows=new Set<number>();for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);if(d){count++;channels[i%4]++;rows.add(Math.floor(i/4/240));max=Math.max(max,d)}}return {count,max,channels,rows:[...rows]}}
const sampleCoordinates=[[0,52],[6,52],[49,52],[101,52]],unquantized=sampleCoordinates.map(([x,y])=>{const u=384*((x+.5)/240),v=256*((y+.5)/160),p=sampleCropBicubic(source,384,256,u,v,{premultiplied:false,footprint:[1.6,1.6],filter:'lanczos3'});return {x,y,u,v,p,straight:p.slice(0,3).map(c=>c*255/p[3])}})
const report={runtime:process.versions,sourceRGBA_SHA256:sha(source),outputRGBA_SHA256:sha(pixels.data),outputEncodedSHA256:sha(output.bytes),differenceToGUI:difference(pixels.data,actual.data),differenceToHostExpected:difference(pixels.data,expected.data),sinProbes:[.1,.3,.8,1.2,1.5,2.4,2.8].map(x=>({x,sin:Math.sin(Math.PI*x),kernel:cropLanczos3(x)})),unquantized}
const prefix=process.argv[2]??'artifacts/alpha27-perspective/affine-host';writeFileSync(prefix+'.png',output.bytes);writeFileSync(prefix+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
