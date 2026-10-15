import {readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {deflateSync} from 'node:zlib'
import {PNG} from 'pngjs'
const root='artifacts/photoshop-native',log=readFileSync(`${root}/outputs/feather-study/native-results.tsv`),comparison=JSON.parse(readFileSync(`${root}/measurements/feather-study/comparison.json`,'utf8'))
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
const script=readFileSync('scripts/native-reference/photoshop-feather-study.jsx'),source=readFileSync(`${root}/inputs/opaque-white.png`),input=PNG.sync.read(source)
const rows=comparison.results.map((row:{name:string;amount:number;bounds:number[];candidates:{max:number;MAE:number}[]})=>{
 const bytes=readFileSync(`${root}/outputs/feather-study/${row.name}.png`),image=PNG.sync.read(bytes),alpha=Uint8Array.from({length:image.width*image.height},(_,at)=>image.data[at*4+3])
 return {name:row.name,radius:row.amount,bounds:row.bounds,width:image.width,height:image.height,pngSHA256:sha(bytes),alphaSHA256:sha(alpha),alphaZlib: deflateSync(alpha).toString('base64'),measuredLegacy:row.candidates[0],measuredPhotoshop:row.candidates[1]}
})
const fixture={provenance:{application:'Adobe Photoshop 27.11.0',date:'2026-10-12',rights:'Self-authored opaque-white diagnostic image. No user or third-party artwork.',method:'Real Photoshop File > Scripts > Browse. Independently reopen source, rectangle select, feather, invert/clear/deselect, save PNG. Alpha is final selection coverage.',scope:'21 successful references; full-f20 is excluded because Photoshop reported cancellation. sigma=radius is a measured model, not exact private-kernel reproduction.',nativeLog:log.toString('utf8'),nativeLogSHA256:sha(log),scriptPath:'scripts/native-reference/photoshop-feather-study.jsx',scriptSHA256:sha(script),source:{path:`${root}/inputs/opaque-white.png`,pngSHA256:sha(source),width:input.width,height:input.height,rgbaZlib:deflateSync(input.data).toString('base64'),rgbaSHA256:sha(input.data)}},rows}
writeFileSync('fixtures/parity/photoshop-27.11-feather.json',JSON.stringify(fixture,null,2)+'\n')
console.log(`Archived ${rows.length} independently rendered alpha references`)
