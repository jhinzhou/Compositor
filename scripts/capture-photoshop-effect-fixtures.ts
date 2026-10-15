/** Archive actual PS exports, never generate expected pixels with product code.
 * Inputs are self-authored diagnostic images; outputs were saved by Photoshop 27.11.0.
 * Run from repository root after the native-reference scripts completed. */
import {createHash} from 'node:crypto'
import {readFileSync,writeFileSync} from 'node:fs'
import {deflateSync} from 'node:zlib'
import {PNG} from 'pngjs'
const root='artifacts/photoshop-native/outputs'
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex')
function raster(path:string){const bytes=readFileSync(path),image=PNG.sync.read(bytes,{skipRescale:true} as Parameters<typeof PNG.sync.read>[1]),depth=bytes[24],data=image.data as unknown as Uint8Array|Uint16Array,raw=Buffer.alloc(data.length*(depth===16?2:1));if(depth!==8&&depth!==16)throw Error('Unexpected depth');for(let i=0;i<data.length;i++)depth===16?raw.writeUInt16LE(data[i],i*2):raw[i]=data[i];return {path,sha256:sha(bytes),width:image.width,height:image.height,bitDepth:depth,rgbaZlibLE:deflateSync(raw).toString('base64')}}
const sources:Record<string,ReturnType<typeof raster>>={},rows:unknown[]=[]
for(const depth of [8,16]){
 const key=`cube${depth}`;sources[key]=raster(`${root}/supplement/rgb${depth}-cube-identity.png`)
 for(const [name,parameters,directory] of [['light-10',{lightness:-10},'supplement'],['light10',{lightness:10},'refine'],['light30',{lightness:30},'refine'],['hue25',{hue:25},'supplement'],['sat30',{saturation:30},'supplement'],['hsl',{hue:25,saturation:30,lightness:-10},'supplement']] as const){
  const caseName=`rgb${depth}-cube-${name}`,log=readFileSync(`${root}/${directory}/native-results.tsv`,'utf8');if(!log.split(/\r\n|\r|\n/).some(line=>line===`${caseName}\tPASS`||line.startsWith(`${caseName}\tPASS\t`)))throw Error(`Missing actual native provenance ${caseName}`)
  rows.push({name:caseName,source:key,filter:{kind:'hsl',...parameters},reference:raster(`${root}/${directory}/${caseName}.png`)})
 }
}
sources.grid8=raster(`${root}/v3/rgb8-identity.png`)
if(!readFileSync(`${root}/refine/native-results.tsv`,'utf8').split(/\r\n|\r|\n/).some(line=>line==='rgb8-curves-input-endpoints\tPASS'||line.startsWith('rgb8-curves-input-endpoints\tPASS\t')))throw Error('Missing actual Curves PASS provenance')
rows.push({name:'rgb8-curves-input-endpoints',source:'grid8',filter:{kind:'curves',channels:[[{x:16,y:0},{x:239,y:255}],...Array.from({length:3},()=>[{x:0,y:0},{x:255,y:255}])]},reference:raster(`${root}/refine/rgb8-curves-input-endpoints.png`)})
const evidence=Object.fromEntries(['scripts/native-reference/photoshop-reference.jsx','scripts/native-reference/photoshop-supplement.jsx','scripts/native-reference/photoshop-refine.jsx',`${root}/v3/native-results.tsv`,`${root}/supplement/native-results.tsv`,`${root}/refine/native-results.tsv`].map(path=>[path,sha(readFileSync(path))]))
writeFileSync('fixtures/parity/photoshop-27.11-effects.json',JSON.stringify({provenance:{application:'Adobe Photoshop 27.11.0',date:'2026-10-12',referenceMethod:'Real Photoshop File > Scripts > Browse with independent source reopened for each operation.',license:'Diagnostic source images authored for this project; references contain no third-party artwork.',colorProfile:'PNG has no embedded ICC/sRGB/gAMA/cHRM chunk. Numeric untagged channel comparison, not ICC display parity.',precision:'16-bit references originate from PS conversion of an 8-bit diagnostic cube, not arbitrary independent source16 values.',encoding:'zlib-compressed dense straight RGBA; 16-bit samples explicitly little-endian.',evidence},sources,rows},null,2)+'\n')
console.log(`Captured ${rows.length} actual Photoshop cases; no product algorithm executed.`)
