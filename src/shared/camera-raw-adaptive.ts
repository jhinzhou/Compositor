import {inflate} from 'pako'
import { CAMERA_RAW_TABLE_PLANES_ZLIB,CAMERA_RAW_TABLE_METADATA } from './camera-raw-table-data'
import { cameraMap, validateCameraImage, type CameraImage, type CameraCurve, type CameraMixer, type CameraGrading, type CameraCalibration, cameraCurveTables } from './camera-raw-kernels'

export type CameraRawLightSettings = { exposure: number; temperature: number; tint: number; contrast: number; highlights: number; shadows: number; whites: number; blacks: number; saturation: number; vibrance: number }
export type CameraRawColorSettings = CameraRawLightSettings & {curve?:CameraCurve;mixer?:CameraMixer;grading?:CameraGrading;calibration?:CameraCalibration}
export type CameraRawBrightness = { brightest: number; luminance: number; logBrightest: number }
export type CameraRawStage = { tables: number[]; weights: number[] }
const size = 17, grid = 33, entries = size ** 3 * 3
const clamp = (value: number) => Math.max(0, Math.min(1, value))
const decode = (value: number) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
const encode = (value: number) => value <= 0 ? 0 : value >= 1 ? 1 : value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055
const decodeLevels=Float64Array.from({length:256},(_,i)=>decode(i/255))
let tables: Uint8Array | undefined
export function cameraRawTables(): Uint8Array {
  if (!tables) {
    const constructor=Uint8Array as typeof Uint8Array&{fromBase64?:(source:string)=>Uint8Array}
    let packed:Uint8Array
    if(constructor.fromBase64)packed=constructor.fromBase64(CAMERA_RAW_TABLE_PLANES_ZLIB)
    else{const decoded=atob(CAMERA_RAW_TABLE_PLANES_ZLIB);packed=new Uint8Array(decoded.length);for(let i=0;i<decoded.length;i++)packed[i]=decoded.charCodeAt(i)}
    const planes=inflate(packed),metadata=CAMERA_RAW_TABLE_METADATA,cells=size**3
    if(metadata.size!==size||metadata.count!==763||metadata.step<1||planes.length!==metadata.count*entries)throw new Error('Invalid Camera Raw measured atlas.')
    const output=new Uint8Array(planes.length),levels=Array.from({length:size},(_,i)=>Math.round(i*255/(size-1)))
    for(let table=0;table<metadata.count;table++)for(let channel=0;channel<3;channel++){
      const base=(table*3+channel)*cells;let running=0
      for(let cell=0;cell<cells;cell++){running=(running+planes[base+cell])&255;const axis=channel===0?Math.floor(cell/(size*size)):channel===1?Math.floor(cell/size)%size:cell%size;output[table*entries+cell*3+channel]=metadata.format===3?Math.max(0,Math.min(255,levels[axis]+(running<128?running:running-256)*metadata.step)):(running+levels[axis])&255}
    }
    tables=output
  }
  return tables
}
export const cameraRawBetween = (value: number, points: number[]): [number, number] => {
  value = Math.max(points[0], Math.min(points.at(-1)!, value)); let index = 0
  while (index < points.length - 2 && value > points[index + 1]) index++
  return [index, (value - points[index]) / (points[index + 1] - points[index])]
}
export const cameraRawStage = (start: number, value: number, low: number, step: number, count: number): CameraRawStage => {
  const position = Math.max(0, Math.min(count - 1, (value - low) / step)), index = Math.min(count - 2, Math.floor(position)), fraction = position - index
  return { tables: [start + index, start + index + 1], weights: [Math.fround(1 - fraction), Math.fround(fraction)] }
}
const four = (base: number, width: number, down: number, across: number): CameraRawStage => ({ tables: [base, base + 1, base + width, base + width + 1], weights: [(1 - down) * (1 - across), (1 - down) * across, down * (1 - across), down * across].map(Math.fround) })
export function cameraRawWhiteBalanceStage(temperature: number, tint: number): CameraRawStage {
  const [row, down] = cameraRawBetween(temperature, [-100, -75, -50, -25, 0, 25, 50, 75, 100]), [column, across] = cameraRawBetween(tint, [-100, -75, -50, -25, 0, 25, 50, 75, 100])
  return four(row * 9 + column, 9, down, across)
}
export function cameraRawBrightness(image: CameraImage): CameraRawBrightness {
  validateCameraImage(image)
  let brightest = 0, luminance = 0, logBrightest = 0, weight = 0
  for (let at = 0; at < image.data.length; at += 4) {
    const w = image.data[at + 3] / 255; if (!w) continue
    const r = decodeLevels[image.data[at]], g = decodeLevels[image.data[at + 1]], b = decodeLevels[image.data[at + 2]], top = Math.max(r, g, b)
    brightest += w * top; luminance += w * (.2126 * r + .7152 * g + .0722 * b); logBrightest += w * Math.log(top + .0003); weight += w
  }
  return weight ? { brightest: encode(brightest / weight) * 255, luminance: encode(luminance / weight) * 255, logBrightest: encode(Math.exp(logBrightest / weight) - .0003) * 255 } : { brightest: 127.5, luminance: 127.5, logBrightest: 127.5 }
}
export function cameraRawStages(settings: CameraRawColorSettings, brightness: CameraRawBrightness): CameraRawStage[] {
  const stages: CameraRawStage[] = []
  const adaptive = (start: number, value: number, level: number) => { const [row, down] = cameraRawBetween(level, [53, 80, 104, 130, 160, 190, 224]), [column, across] = cameraRawBetween(value, [-100, -50, -25, 0, 25, 50, 100]); return four(start + row * 7 + column, 7, down, across) }
  if(settings.calibration)for(const [i,value] of [settings.calibration.redHue,settings.calibration.redSaturation,settings.calibration.greenHue,settings.calibration.greenSaturation,settings.calibration.blueHue,settings.calibration.blueSaturation].entries())if(value)stages.push(cameraRawStage(405+i*5,value,-100,50,5))
  if (settings.exposure) stages.push(cameraRawStage(81, settings.exposure, -5, .5, 21))
  if (settings.temperature || settings.tint) stages.push(cameraRawWhiteBalanceStage(settings.temperature, settings.tint))
  if (settings.contrast) stages.push(adaptive(138, settings.contrast, brightness.brightest))
  if (settings.highlights) stages.push(adaptive(187, settings.highlights, brightness.logBrightest))
  if (settings.shadows) stages.push(adaptive(236, settings.shadows, brightness.luminance))
  for (const [key, start] of [['whites', 102], ['blacks', 111], ['saturation', 120], ['vibrance', 129]] as const) if (settings[key]) stages.push(cameraRawStage(start, settings[key], -100, 25, 9))
  if(settings.curve&&cameraRawMeasuredDividers(settings.curve))for(const [i,value] of [settings.curve.shadows,settings.curve.darks,settings.curve.lights,settings.curve.highlights].entries())if(value)stages.push(cameraRawStage(435+i*5,value,-100,50,5))
  return stages
}
export function cameraRawLookup(table: Uint8Array | Float32Array, offset: number, dimension: number, color: number[], divisor: number): number[] {
  const p = color.map(value => clamp(value) * (dimension - 1)), i = p.map(value => value >= dimension - 1 ? dimension - 2 : Math.floor(value)), f = p.map((value, axis) => value - i[axis]), output = [0, 0, 0]
  for (let corner = 0; corner < 8; corner++) {
    const dr = corner >> 2, dg = corner >> 1 & 1, db = corner & 1, weight = (dr ? f[0] : 1 - f[0]) * (dg ? f[1] : 1 - f[1]) * (db ? f[2] : 1 - f[2]); if (!weight) continue
    const at = offset + (((i[0] + dr) * dimension + i[1] + dg) * dimension + i[2] + db) * 3
    for (let c = 0; c < 3; c++) output[c] += weight * table[at + c]
  }
  return output.map(value => value / divisor)
}
export function cameraRawStageColor(stage: CameraRawStage, color: number[]): number[] {
  const next = [0, 0, 0], bytes = cameraRawTables()
  for (let t = 0; t < stage.tables.length; t++) { const weight = stage.weights[t]; if (!weight) continue; const looked = stage.tables[t]<0?color:cameraRawLookup(bytes, stage.tables[t] * entries, size, color, 255); for (let c = 0; c < 3; c++) next[c] += weight * looked[c] }
  return next.map(clamp)
}
const composedCache = new Map<string, Float32Array>()
export function cameraRawCompose(stages: CameraRawStage[]): Float32Array | undefined {
  if (!stages.length) return undefined
  const key = JSON.stringify(stages), cached = composedCache.get(key); if (cached) return cached
  const output = new Float32Array(grid ** 3 * 3)
  for (let r = 0; r < grid; r++) for (let g = 0; g < grid; g++) for (let b = 0; b < grid; b++) { let color = [r / (grid - 1), g / (grid - 1), b / (grid - 1)]; for (const stage of stages) color = cameraRawStageColor(stage, color); output.set(color, ((r * grid + g) * grid + b) * 3) }
  if (composedCache.size >= 8) composedCache.delete(composedCache.keys().next().value!)
  composedCache.set(key, output); return output
}
export function cameraRawLightColor(image: CameraImage, settings: CameraRawColorSettings, clipping?: 'highlights' | 'shadows',foldColor=false,knownBrightness?:CameraRawBrightness): CameraImage {
  validateCameraImage(image)
  const adaptive=settings.contrast||settings.highlights||settings.shadows
  let table = cameraRawCompose(cameraRawStages(settings,knownBrightness??(adaptive?cameraRawBrightness(image):{brightest:128,luminance:128,logBrightest:128})))
  if(foldColor)table=cameraRawFoldColor(table,settings)
  if (!table && !clipping) return image
  return cameraMap(image, color => { if (table) color = cameraRawLookup(table, 0, grid, color, 1).map(clamp); if (clipping === 'highlights') return color.map(value => value >= 254.5 / 255 ? 1 : 0); if (clipping === 'shadows') return color.map(value => value <= .5 / 255 ? 0 : 1); return color })
}
export function cameraRawNeutralize(red: number, green: number, blue: number): { temperature: number; tint: number } | undefined {
  if (![red, green, blue].every(Number.isFinite) || Math.min(red, green, blue) <= .0001) return undefined
  const cast = (temperature: number, tint: number) => { const color = cameraRawStageColor(cameraRawWhiteBalanceStage(temperature, tint), [red, green, blue]); return Math.max(...color) - Math.min(...color) }
  let best = { temperature: 0, tint: 0, cast: cast(0, 0) }
  for (const [step, reach] of [[10, 100], [2, 10], [.5, 2]]) { const center = best; for (let temperature = center.temperature - reach; temperature <= center.temperature + reach; temperature += step) for (let tint = center.tint - reach; tint <= center.tint + reach; tint += step) { if (Math.abs(temperature) > 100 || Math.abs(tint) > 100) continue; const found = cast(temperature, tint); if (found < best.cast) best = { temperature, tint, cast: found } } }
  return { temperature: best.temperature, tint: best.tint }
}
export function cameraRawAutoBalance(image: CameraImage): { temperature: number; tint: number } {
  validateCameraImage(image)
  const sum = [0, 0, 0]; let count = 0
  for (let at = 0; at < image.data.length; at += 4) { if (!image.data[at + 3]) continue; count++; for (let c = 0; c < 3; c++) sum[c] += decode(image.data[at + c] / 255) }
  return count ? cameraRawNeutralize(encode(sum[0] / count), encode(sum[1] / count), encode(sum[2] / count)) ?? { temperature: 0, tint: 0 } : { temperature: 0, tint: 0 }
}
/** d0ec2f3: measured parametric curves apply only at the measured divider positions. */
export function cameraRawMeasuredDividers(curve:CameraCurve):boolean{return curve.shadowSplit===25&&curve.darkSplit===50&&curve.lightSplit===75&&curve.refineSaturation===0}
export function cameraRawMixerStages(mixer:CameraMixer):CameraRawStage[]{
 const stages:CameraRawStage[]=[]
 for(const [kind,values] of [mixer.luminance,mixer.saturation,mixer.hue].entries())for(const [color,value] of values.entries())if(value)stages.push(cameraRawStage(285+(kind*8+color)*5,value,-100,50,5))
 return stages
}
export function cameraRawGradingStages(grading:CameraGrading):CameraRawStage[]{
 const stages:CameraRawStage[]=[],wheels=[grading.shadows,grading.midtones,grading.highlights,grading.global]
 for(const [i,wheel] of wheels.entries())if(wheel.luminance)stages.push(cameraRawStage(743+i*5,wheel.luminance,-100,50,5))
 const balance=grading.balance/100,highlightShare=Math.max(0,balance<0?1+1.4*balance:1+2*balance),shadowShare=Math.max(0,balance<0?1-1.2*balance:1-1.4*balance),[blendLow,blendUp]=cameraRawBetween(grading.blending,[0,50,100])
 const section=(blend:number,wheel:number)=>455+(blend===0?wheel*36:blend===1?72+wheel*36:216+wheel*36)
 for(const [wheel,share,blends] of [[3,1,false],[2,1,false],[1,highlightShare,true],[0,shadowShare,true]] as const){
  const color=wheels[wheel];if(color.saturation*share<=0)continue
  const position=(color.hue%360)/30,first=Math.floor(position)%12,second=(first+1)%12,around=position-Math.floor(position),[level,up]=cameraRawBetween(color.saturation*share,[0,25,50,100]),tables:number[]=[],weights:number[]=[]
  for(const [blend,blendWeight] of blends?[[blendLow,1-blendUp],[blendLow+1,blendUp]]:[[1,1]])for(const [hue,hueWeight] of [[first,1-around],[second,around]])for(const [saturation,saturationWeight] of [[level,1-up],[level+1,up]]){tables.push(saturation===0?-1:section(blend,wheel)+hue*3+saturation-1);weights.push(Math.fround(blendWeight*hueWeight*saturationWeight))}
  stages.push({tables,weights})
 }
 return stages
}
const foldedCache=new Map<string,{base?:Float32Array;table:Float32Array}>()
export function cameraRawFoldColor(composed:Float32Array|undefined,settings:CameraRawColorSettings):Float32Array|undefined{
 const stages=[...(settings.mixer?cameraRawMixerStages(settings.mixer):[]),...(settings.grading?cameraRawGradingStages(settings.grading):[])],curves=settings.curve?cameraCurveTables(settings.curve):undefined
 const curveAdjusts=!!settings.curve&&(settings.curve.shadows!==0||settings.curve.darks!==0||settings.curve.lights!==0||settings.curve.highlights!==0||[settings.curve.rgb,settings.curve.red,settings.curve.green,settings.curve.blue].some(points=>points.length!==2||points[0].y!==0||points[1].y!==1))
 if(!stages.length&&!curveAdjusts)return composed
 const key=JSON.stringify([settings.curve,settings.mixer,settings.grading])
 // The adaptive table's identity matters; a different source brightness may
 // produce another base table for identical slider values.
 const cached=foldedCache.get(key);if(cached&&cached.base===composed)return cached.table
 const out=composed?.slice()??new Float32Array(grid**3*3)
 if(!composed)for(let r=0;r<grid;r++)for(let g=0;g<grid;g++)for(let b=0;b<grid;b++)out.set([r/(grid-1),g/(grid-1),b/(grid-1)],((r*grid+g)*grid+b)*3)
 const sample=(lut:Float32Array,value:number)=>{const at=clamp(value)*255,low=Math.floor(at);return lut[low]+(lut[Math.min(255,low+1)]-lut[low])*(at-low)}
 for(let at=0;at<out.length;at+=3){let color=[out[at],out[at+1],out[at+2]];if(curveAdjusts&&curves){color=color.map((value,i)=>Math.fround(sample(curves.channels[i],sample(curves.tone,value))))}for(const stage of stages)color=cameraRawStageColor(stage,color);out.set(color,at)}
 if(foldedCache.size>=8)foldedCache.delete(foldedCache.keys().next().value!);foldedCache.set(key,{base:composed,table:out});return out
}
/** Lens correction uses the measured Exposure stage at every pixel's distance. */
export function cameraRawLensVignette(color:number[],x:number,y:number,width:number,height:number,amount:number,midpoint:number):number[]{
 const distance=Math.hypot(x+.5-width/2,y+.5-height/2)/Math.hypot(width/2,height/2)*(1+(50-midpoint)/100),stops=Math.sign(amount)*(Math.abs(amount)/100)**1.15*1.98*distance**4.3
 return cameraRawStageColor(cameraRawStage(81,stops,-5,.5,21),color)
}
