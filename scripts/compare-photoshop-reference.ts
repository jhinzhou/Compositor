/** Actual Photoshop exports are the reference. No synthetic expected image is
 * described as Photoshop. Run: npx tsx scripts/compare-photoshop-reference.ts [output-directory] */
import {createHash,randomUUID} from 'node:crypto'
import {readFileSync,readdirSync,writeFileSync,mkdirSync,existsSync} from 'node:fs'
import {resolve,join,relative} from 'node:path'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import {makeAsset} from '../src/core/project-io'
import {imageFilterSchema,type ImageFilter} from '../src/shared/image-filters'
import type {Manifest} from '../src/shared/contracts'

const root=resolve('artifacts/photoshop-native'),references=resolve(process.argv[2]??join(root,'outputs/v3')),destination=join(root,'measurements',references.split('/').at(-1)!)
mkdirSync(destination,{recursive:true})
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex')
function png(file:string){const bytes=readFileSync(file),raw=PNG.sync.read(bytes,{skipRescale:true} as Parameters<typeof PNG.sync.read>[1]),depth=bytes[24],max=depth===16?65535:255,data=raw.data as unknown as Uint8Array|Uint16Array;if(depth!==8&&depth!==16)throw Error(`Unsupported depth ${depth}`);if(data.length!==raw.width*raw.height*4)throw Error('RGBA decoding mismatch');return {file,bytes,hash:sha(bytes),width:raw.width,height:raw.height,depth,max,data}}
type Raster=ReturnType<typeof png>
function metadata(image:Raster){const chunks:string[]=[];for(let p=8;p+12<=image.bytes.length;){const n=image.bytes.readUInt32BE(p),name=image.bytes.toString('ascii',p+4,p+8);if(['iCCP','sRGB','gAMA','cHRM','cICP'].includes(name))chunks.push(name);p+=n+12}return {path:relative(process.cwd(),image.file),sha256:image.hash,width:image.width,height:image.height,bitDepth:image.depth,colorChunks:chunks}}
function filterFor(suffix:string):ImageFilter|null {
 if(suffix==='identity')return null
 if(suffix==='invert')return imageFilterSchema.parse({kind:'invert'})
 if(suffix==='hue25')return imageFilterSchema.parse({kind:'hsl',hue:25})
 if(suffix==='sat30')return imageFilterSchema.parse({kind:'hsl',saturation:30})
 if(/^light(?:10|30)$/.test(suffix))return imageFilterSchema.parse({kind:'hsl',lightness:Number(suffix.slice(5))})
 if(suffix==='curves-input-endpoints')return imageFilterSchema.parse({kind:'curves',channels:[[{x:16,y:0},{x:239,y:255}],...Array.from({length:3},()=>[{x:0,y:0},{x:255,y:255}])]})
 if(suffix==='light-10')return imageFilterSchema.parse({kind:'hsl',lightness:-10})
 if(suffix==='hsl')return imageFilterSchema.parse({kind:'hsl',hue:25,saturation:30,lightness:-10})
 if(suffix==='levels-gamma125')return imageFilterSchema.parse({kind:'levels',ranges:[{gamma:1.25},{},{},{}]})
 if(suffix==='levels-range')return imageFilterSchema.parse({kind:'levels',ranges:[{black:23,white:221,gamma:.85,outputBlack:11,outputWhite:240},{},{},{}]})
 const blur=/^gaussian(\d+(?:\.\d+)?)$/.exec(suffix);return blur?imageFilterSchema.parse({kind:'gaussianBlur',radius:Number(blur[1])}):null
}
function product(source:Raster,filter:ImageFilter|null):{data:Float64Array;image:Raster;placement:unknown}{
 const editor=new Editor(),id=randomUUID().toUpperCase(),file=`${id}.png`,asset=makeAsset(file,source.bytes,{allow16:true}),manifest:Manifest={format:'com.compositor.project',version:source.depth===16?12:8,colorSpace:'sRGB',documentID:randomUUID(),width:source.width,height:source.height,resolution:72,activeLayerID:id,layers:[{id,name:'Photoshop comparison source',imageFile:file,isVisible:true,isGroup:false,opacity:1,blendMode:'Normal',transform:{origin:[0,0],size:[source.width,source.height],rotation:0,flipX:false,flipY:false,sampling:'High quality'}}]}
 editor.importDocument(manifest,new Map([[file,asset]]),'PS comparison')
 if(filter)editor.apply({...editor.identity(),action:{type:'layer.filter',layerId:id,filter}})
 const snapshot=editor.snapshot(),layer=snapshot.manifest.layers[0],edited=snapshot.assets.get(layer.imageFile!)!,out=join(destination,`${source.depth}-${source.hash.slice(0,10)}-${filter?.kind??'identity'}-${sha(Buffer.from(JSON.stringify(filter))).slice(0,12)}-${sha(edited.bytes).slice(0,12)}.png`)
 writeFileSync(out,edited.bytes);const actual=png(out)
 if(actual.width!==source.width||actual.height!==source.height)throw Error('Comparison requires the original document grid; product raster geometry changed.')
 return {data:Float64Array.from(actual.data),image:actual,placement:layer.transform}
}
function stats(errors:number[]){if(!errors.length)return {count:0,mae:null,rmse:null,max:null,p95:null,p99:null,over1:null,over2:null,over4:null};let sum=0,squares=0,max=0;for(const v of errors){sum+=v;squares+=v*v;max=Math.max(max,v)}errors.sort((a,b)=>a-b);const percentile=(p:number)=>errors[Math.min(errors.length-1,Math.floor(p*(errors.length-1)))];return {count:errors.length,mae:sum/errors.length,rmse:Math.sqrt(squares/errors.length),max,p95:percentile(.95),p99:percentile(.99),over1:errors.filter(v=>v>1).length/errors.length,over2:errors.filter(v=>v>2).length/errors.length,over4:errors.filter(v=>v>4).length/errors.length}}
function metrics(source:Raster,ref:Raster,actual:Float64Array){
 if(ref.width!==source.width||ref.height!==source.height||ref.depth!==source.depth)throw Error('Reference format mismatch')
 const all:number[]=[],opaque:number[]=[],partial:number[]=[],stablePartial:number[]=[],lowAlpha:number[]=[],interior:number[]=[],boundary:number[]=[],alpha:number[]=[],alphaTop:{x:number;y:number;error:number;source:number;photoshop:number;project:number}[]=[],premul:number[]=[],top:{x:number;y:number;channel:number;error:number;source:number;photoshop:number;project:number}[]=[],max=source.max
 for(let p=0;p<ref.width*ref.height;p++){const at=p*4,x=p%ref.width,y=Math.floor(p/ref.width),sa=source.data[at+3],ra=ref.data[at+3],pa=actual[at+3],isInterior=x>=16&&y>=16&&x<ref.width-16&&y<ref.height-16;const alphaError=Math.abs(pa-ra);alpha.push(alphaError);if(alphaError>(alphaTop.at(-1)?.error??-1)){alphaTop.push({x,y,error:alphaError,source:sa,photoshop:ra,project:pa});alphaTop.sort((a,b)=>b.error-a.error);if(alphaTop.length>8)alphaTop.pop()}for(let c=0;c<3;c++){const error=Math.abs(actual[at+c]-ref.data[at+c]);premul.push(Math.abs(actual[at+c]*pa/max-ref.data[at+c]*ra/max));if(ra||pa){all.push(error);(isInterior?interior:boundary).push(error)}if(sa===max&&ra===max&&pa===max)opaque.push(error);if(sa>0&&sa<max||ra>0&&ra<max||pa>0&&pa<max)partial.push(error);if(ra>=max*.05&&pa>=max*.05&&(ra<max||pa<max))stablePartial.push(error);if((ra||pa)&&Math.min(ra,pa)<max*.05)lowAlpha.push(error);if((ra||pa)&&error>(top.at(-1)?.error??-1)){top.push({x,y,channel:c,error,source:source.data[at+c],photoshop:ref.data[at+c],project:actual[at+c]});top.sort((a,b)=>b.error-a.error);if(top.length>12)top.pop()}}}
 return {units:`${source.depth}-bit output LSB`,straightRGBVisible:stats(all),opaqueRGB:stats(opaque),partialAlphaRGB:stats(partial),partialAlphaAtLeast5percentRGB:stats(stablePartial),lessThan5percentAlphaRGB:stats(lowAlpha),interiorRGB16pxInset:stats(interior),boundaryRGB16pxBand:stats(boundary),premultipliedRGB:stats(premul),alpha:stats(alpha),largestVisibleRGBDifferences:top,largestAlphaDifferences:alphaTop}
}
function identityFile(prefix:string,family:string){for(const dir of [references,join(root,'outputs/supplement'),join(root,'outputs/v3')]){const file=join(dir,`${prefix}${family}identity.png`);if(existsSync(file))return file}throw Error(`Missing actual PS identity ${prefix}${family}`)}
const log=readFileSync(join(references,'native-results.tsv'),'utf8').split(/\r\n|\r|\n/).filter(Boolean),results:unknown[]=[]
for(const depth of [8,16]){
 const prefix=`rgb${depth}-`
 for(const file of readdirSync(references).filter(f=>f.startsWith(prefix)&&f.endsWith('.png')).sort()){
  const fullSuffix=file.slice(prefix.length,-4),family=/^(cube|step)-/.exec(fullSuffix)?.[0]??'',suffix=fullSuffix.slice(family.length),baseline=png(identityFile(prefix,family)),filter=filterFor(suffix);if(!filter&&suffix!=='identity')continue
  if(!log.some(row=>row===`${prefix}${fullSuffix}\tPASS`||row.startsWith(`${prefix}${fullSuffix}\tPASS\t`)))throw Error(`Missing native PASS provenance for ${file}`)
  const ref=png(join(references,file)),actual=product(baseline,filter),row={case:`${prefix}${fullSuffix}`,filter,source:metadata(baseline),reference:metadata(ref),project:metadata(actual.image),placement:actual.placement,metrics:metrics(baseline,ref,actual.data)};results.push(row)
  const m=row.metrics;process.stdout.write(`${row.case}\tRGB MAE ${m.opaqueRGB.mae?.toFixed(4)} max ${m.opaqueRGB.max}\tAlpha max ${m.alpha.max}\n`)
 }
}
const basic=existsSync(join(references,'rgb8-identity.png')),original=png(join(root,basic?'inputs/analysis-grid.png':'inputs/color-cube.png')),identity8=png(identityFile('rgb8-',basic?'':'cube-')),identity16=png(identityFile('rgb16-',basic?'':'cube-'))
const productSources=Object.fromEntries(['scripts/compare-photoshop-reference.ts','src/core/editor.ts','src/core/filter-edit.ts','src/core/high-depth-filter.ts','src/shared/image-filters.ts','src/shared/image-filter-algorithms.ts','src/shared/deep-color-filters.ts'].map(file=>[file,sha(readFileSync(file))]))
const provenance={productSources,photoshopVersion:log[0],logSha256:sha(readFileSync(join(references,'native-results.tsv'))),nativeLog:log,sourceOriginal:metadata(original),source8Identity:metadata(identity8),source16Identity:metadata(identity16),originalVsIdentity8:metrics(original,identity8,Float64Array.from(original.data)),conversion8To16:{maximumDifferenceFromTimes257:Math.max(...Array.from({length:256},(_,v)=>{let delta=0;for(let p=0;p<original.width*original.height;p++)for(let c=0;c<3;c++)if(original.data[p*4+c]===v)delta=Math.max(delta,Math.abs(identity16.data[p*4+c]-v*257));return delta})),note:'RGB16 baseline is the actual Photoshop identity conversion; it avoids attributing conversion rounding to a filter. Inputs originated as RGBA8, so these cases do not prove arbitrary independent source16 precision.'},scope:'Actual Photoshop-exported reference images; product uses real Editor layer.filter pipeline. No color management conversion, no GUI comparison, no synthetic Photoshop oracle. Empty partial-alpha ROI is reported count=0, not claimed passing.'}
writeFileSync(join(destination,'comparison.json'),JSON.stringify({provenance,results},null,2)+'\n')
process.stdout.write(`Saved ${relative(process.cwd(),join(destination,'comparison.json'))}\n`)
