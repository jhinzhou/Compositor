import {defaultFilter,type ImageFilter} from './image-filters'

export type CameraRawSettings = Extract<ImageFilter,{kind:'cameraRaw'}>
type SettingKey = Exclude<keyof CameraRawSettings,'kind'>
export const CAMERA_RAW_SECTIONS = [
  {id:'light',title:'Tonal Adjustments',fields:['exposure','contrast','highlights','shadows','whites','blacks']},
  {id:'color',title:'Color',fields:['whiteBalance','temperature','tint','vibrance','saturation']},
  {id:'effects',title:'Effects',fields:['texture','clarity','dehaze','glow','glowStyle','glowRange','glowSpread','glowWarmth','vignetteAmount','vignetteStyle','vignetteMidpoint','vignetteRoundness','vignetteFeather','vignetteHighlights','grainAmount','grainSize','grainRoughness','seed']},
  {id:'curve',title:'Curve',fields:['curve']},
  {id:'mixer',title:'Color Mixer',fields:['mixer']},
  {id:'grading',title:'Color Grading',fields:['grading']},
  {id:'detail',title:'Detail',fields:['detail']},
  {id:'optics',title:'Optics',fields:['optics']},
  {id:'geometry',title:'Geometry',fields:['geometry']},
  {id:'calibration',title:'Calibration',fields:['calibration']}
] as const satisfies readonly {id:string;title:string;fields:readonly SettingKey[]}[]
export type CameraRawSection = typeof CAMERA_RAW_SECTIONS[number]['id']
export function cameraRawDefaults():CameraRawSettings {return defaultFilter('cameraRaw') as CameraRawSettings}
function fields(section:CameraRawSection):readonly SettingKey[] {return CAMERA_RAW_SECTIONS.find(value=>value.id===section)!.fields}
// Vue reads may be proxies; copy the schema's JSON values without structuredClone's proxy rejection.
function clone<T>(value:T):T {if(Array.isArray(value))return value.map(item=>clone(item)) as T;if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,clone(item)])) as T;return value}
/** Restore one complete section, including enums, nested arrays and nonzero defaults. */
export function resetCameraRawSection(settings:CameraRawSettings,section:CameraRawSection):CameraRawSettings {
  const result=clone(settings),defaults=cameraRawDefaults()
  for(const key of fields(section)) (result as Record<string,unknown>)[key]=clone(defaults[key])
  return result
}
function equal(a:unknown,b:unknown):boolean {
  if(a===b)return true
  if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,index)=>equal(value,b[index]))
  if(a&&b&&typeof a==='object'&&typeof b==='object'){const left=a as Record<string,unknown>,right=b as Record<string,unknown>,keys=Object.keys(left);return keys.length===Object.keys(right).length&&keys.every(key=>Object.hasOwn(right,key)&&equal(left[key],right[key]))}
  return false
}
export function isCameraRawSectionDefault(settings:CameraRawSettings,section:CameraRawSection):boolean {
  const defaults=cameraRawDefaults();return fields(section).every(key=>equal(settings[key],defaults[key]))
}
/** Eyes are session state. Disabled values remain editable, but preview and Apply use section defaults. */
export function visibleCameraRawSettings(settings:CameraRawSettings,hidden:readonly CameraRawSection[]):CameraRawSettings {
  return hidden.reduce((result,section)=>resetCameraRawSection(result,section),clone(settings))
}
export const CAMERA_RAW_SECTION_CHOICES:Record<string,readonly string[]>={whiteBalance:['Custom','Auto'],glowStyle:['Diffusion','Bloom','Halation'],vignetteStyle:['Highlight Priority','Color Priority','Paint Overlay']}
export function cameraRawScalarLimits(key:string):{min:number;max:number;step:number} {
  if(key==='exposure')return {min:-5,max:5,step:.1}
  if(key==='seed')return {min:0,max:0xffffffff,step:1}
  const signed=['temperature','tint','contrast','highlights','shadows','whites','blacks','vibrance','saturation','texture','clarity','dehaze','glowRange','glowSpread','glowWarmth','vignetteAmount','vignetteRoundness']
  return {min:signed.includes(key)?-100:0,max:100,step:1}
}
