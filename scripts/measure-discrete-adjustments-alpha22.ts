import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {deflateSync} from 'node:zlib'
import {PNG} from 'pngjs'
import {applyImageFilter,type ImageFilter} from '../src/shared/image-filters'
import {applyDeepColorFilter} from '../src/shared/deep-color-filters'
const root='artifacts/photoshop-native',directory=root+'/outputs/adjustments-alpha22-v2',script='scripts/native-reference/photoshop-adjustments-alpha22-v2.jsx',sourcePath=root+'/inputs/adjustments-alpha22-source.png'
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex')
function raster(path:string){const bytes=readFileSync(path),png=PNG.sync.read(bytes,{skipRescale:true}),depth=bytes[24] as 8|16,data=png.data as unknown as Uint8Array|Uint16Array,raw=Buffer.alloc(data.length*(depth===16?2:1));for(let i=0;i<data.length;i++)depth===16?raw.writeUInt16LE(data[i],i*2):raw[i]=data[i];return {path,sha256:sha(bytes),pngBase64:bytes.toString('base64'),width:png.width,height:png.height,bitDepth:depth,rawSHA256:sha(raw),rgbaZlibLE:deflateSync(raw).toString('base64'),data}}
function metadata(image:ReturnType<typeof raster>){const {data,...rest}=image;return rest}
const source=raster(sourcePath),log=readFileSync(directory+'/native-results.tsv'),lines=log.toString('utf8').split(/\r\n?|\n/).filter(Boolean)
if(lines.filter(line=>line.includes('\tPASS\t')).length!==8||lines.some(line=>line.includes('\tFAIL\t')))throw Error('Incomplete native capture')
const rows=readdirSync(directory).filter(v=>v.endsWith('.png')).sort().map(name=>{
 const [kind,amount,depthString]=name.replace('.png','').split('-'),depth=Number(depthString) as 8|16,spec={kind,...kind==='threshold'?{level:Number(amount)}:{levels:Number(amount)}} as ImageFilter,native=raster(directory+'/'+name),input=depth===8?Uint8ClampedArray.from(source.data):Uint16Array.from(source.data,v=>v*257)
 const after=depth===8?applyImageFilter({width:source.width,height:source.height,data:input as Uint8ClampedArray},spec).data:applyDeepColorFilter(input as Uint16Array,source.width,source.height,spec),before=Array.from(input),alpha=depth===8?255:65535
 for(let at=0;at<before.length;at+=4){const color=before.slice(at,at+3);if(kind==='threshold'){const cutoff=255*(2126*color[0]+7152*color[1]+722*color[2])>=10000*Number(amount)*alpha;for(let c=0;c<3;c++)before[at+c]=cutoff?alpha:0}else for(let c=0;c<3;c++)before[at+c]=Math.round(Math.round(color[c]/alpha*(Number(amount)-1))/(Number(amount)-1)*alpha)}
 const metrics=(data:ArrayLike<number>)=>{let max=0,total=0,changed=0;for(let i=0;i<data.length;i++){const error=Math.abs(data[i]-native.data[i]);max=Math.max(max,error);total+=error;if(error)changed++}return {max,mae:total/data.length,changedSamples:changed}}
 let changed=0;for(let i=0;i<input.length;i++)if(input[i]!==native.data[i])changed++
 return {name,spec,inputDepth:depth,native:metadata(native),changedFromInput:changed,before:metrics(before),after:metrics(after)}
})
const fixture={version:1,photoshop:'27.11.0',provenance:'Photoshop DOM ArtLayer.threshold/posterize, invoked through CUA File > Scripts > Browse; command execution is native, not a manual Image > Adjustments GUI acceptance.',source:metadata(source),script:{path:script,sha256:sha(readFileSync(script)),sourceText:readFileSync(script,'utf8')},log:{path:directory+'/native-results.tsv',sha256:sha(log),text:log.toString('utf8')},input16Boundary:'Original source is RGB8 converted by native Photoshop to RGB16. Comparison currently expands RGB8 by257; v3 native no-op conversion control will verify this boundary separately.',rows}
mkdirSync('artifacts/photoshop-threshold-posterize',{recursive:true});writeFileSync('fixtures/parity/photoshop-27.11-discrete-adjustments-v2.json',JSON.stringify(fixture,null,2)+'\n')
writeFileSync('artifacts/photoshop-threshold-posterize/native-v2-comparison.json',JSON.stringify(rows.map(({native,...row})=>row),null,2)+'\n')
console.log(JSON.stringify(rows.map(({name,changedFromInput,before,after})=>({name,changedFromInput,before,after})),null,2))
