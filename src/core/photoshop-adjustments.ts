import {infoHandlersMap} from 'ag-psd/dist/additionalInfo.js'
import {readBytes} from 'ag-psd/dist/psdReader.js'
import {writeInt16,writeUint8,writeUint16} from 'ag-psd/dist/psdWriter.js'
import type {AdjustmentLayer,HueSaturationAdjustment,HueSaturationAdjustmentChannel} from 'ag-psd'
import {imageFilterSchema,specToNativeAdjustment,nativeAdjustmentToSpec} from '../shared/image-filters'
import {photoshopRGB} from './photoshop-effects'
const clamp=(value:number|undefined,low:number,high:number,fallback:number)=>Math.min(high,Math.max(low,Number.isFinite(value)?value!:fallback))
const names=['reds','yellows','greens','cyans','blues','magentas'] as const
/** ag-psd 31.0.3 interprets hue2 as seven equal records, losing Colorize and misaligning Master.
 * Read the actual Adobe/native v1.4.8 byte layout. Pinning and real-file tests cover this narrow adapter. */
export function readNativeHue2(bytes:Uint8Array):HueSaturationAdjustment&{nativeColorize:boolean}|undefined {
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
 if(bytes.length<16||![1,2].includes(view.getUint16(0)))return
 const values=(offset:number):HueSaturationAdjustmentChannel=>({a:0,b:0,c:0,d:0,hue:view.getInt16(offset),saturation:view.getInt16(offset+2),lightness:view.getInt16(offset+4)}),nativeColorize=!!bytes[2],result:HueSaturationAdjustment&{nativeColorize:boolean}={type:'hue/saturation',nativeColorize,master:values(nativeColorize?4:10)}
 if(!nativeColorize)for(const [index,name] of names.entries()){const offset=16+index*14;if(offset+14>bytes.length)break;result[name]={...values(offset+8),a:view.getInt16(offset),b:view.getInt16(offset+2),c:view.getInt16(offset+4),d:view.getInt16(offset+6)}}
 return result
}
const hueReader=infoHandlersMap.hue2
hueReader.read=(reader,target,left)=>{const bytes=readBytes(reader,left()),adjustment=readNativeHue2(bytes);if(adjustment)target.adjustment=adjustment}
// Write the same Adobe hue2 layout that the reader accepts. The pinned library's
// stock writer emits seven 14-byte channels, which overwrites Colorize/Master.
hueReader.write=(writer,target)=>{
 const source=target.adjustment as HueSaturationAdjustment&{nativeColorize?:boolean},master=source.master,colorize=!!source.nativeColorize
 writeUint16(writer,2);writeUint8(writer,colorize?1:0);writeUint8(writer,0)
 const triple=(value:HueSaturationAdjustmentChannel|undefined)=>{writeInt16(writer,value?.hue??0);writeInt16(writer,value?.saturation??0);writeInt16(writer,value?.lightness??0)}
 triple(colorize?master:undefined);triple(colorize?undefined:master)
 for(const key of names){const value=source[key];for(const field of ['a','b','c','d'] as const)writeInt16(writer,value?.[field]??0);triple(value)}
}
infoHandlersMap['hue ']={...hueReader,key:'hue '} // Native importer also accepts the legacy Hue/Saturation tag.
export function photoshopAdjustment(source:AdjustmentLayer|undefined):Record<string,unknown>|undefined {
 if(!source)return
 if(source.type==='levels'){
  const ranges=['rgb','red','green','blue'].map(key=>{const value=source[key as 'rgb'],black=clamp(value?.shadowInput,0,254,0);return {black,white:clamp(value?.highlightInput,black+1,255,255),gamma:clamp(value?.midtoneInput,.1,9.99,1),outputBlack:clamp(value?.shadowOutput,0,255,0),outputWhite:clamp(value?.highlightOutput,0,255,255)}})
  return specToNativeAdjustment(imageFilterSchema.parse({kind:'levels',ranges}))
 }
 if(source.type==='curves'){
  const channels=['rgb','red','green','blue'].map(key=>{const values=source[key as 'rgb'];if(!values||values.length<2)return [{x:0,y:0},{x:255,y:255}];const byX=new Map<number,number>();for(const point of values)byX.set(clamp(point.input,0,255,0),clamp(point.output,0,255,0));const points=[...byX].sort((a,b)=>a[0]-b[0]).map(([x,y])=>({x,y}));return points})
  const parsed=imageFilterSchema.safeParse({kind:'curves',channels});return parsed.success?specToNativeAdjustment(parsed.data):undefined
 }
 if(source.type==='hue/saturation'){
  const degrees=(value:number)=>((value%360)+360)%360,master=source.master,rangeNames=['Reds','Yellows','Greens','Cyans','Blues','Magentas'] as const,colorize=!!(source as HueSaturationAdjustment&{nativeColorize?:boolean}).nativeColorize
  const hueRanges=colorize?[]:names.flatMap((key,index)=>{const value=source[key];return value?[{range:rangeNames[index],band:[value.a,value.b,value.c,value.d].map(degrees),hue:clamp(value.hue,-360,360,0),saturation:clamp(value.saturation,-100,100,0),lightness:clamp(value.lightness,-100,100,0)}]:[]})
  return specToNativeAdjustment(imageFilterSchema.parse({kind:'hsl',hue:clamp(master?.hue,-360,360,0),saturation:clamp(master?.saturation,-100,100,0),lightness:clamp(master?.lightness,-100,100,0),colorize,hueRanges}))
 }
 if(source.type==='exposure')return specToNativeAdjustment(imageFilterSchema.parse({kind:'exposure',exposure:clamp(source.exposure,-20,20,0),offset:clamp(source.offset,-.5,.5,0),gamma:clamp(source.gamma,.01,9.99,1)}))
 if(source.type==='invert')return specToNativeAdjustment({kind:'invert'})
 if(source.type==='color balance'){
  const values=(value:typeof source.shadows)=>[value?.cyanRed??0,value?.magentaGreen??0,value?.yellowBlue??0].map(value=>clamp(value,-100,100,0))
  return specToNativeAdjustment({kind:'colorBalance',shadows:values(source.shadows),midtones:values(source.midtones),highlights:values(source.highlights),preserveLuminosity:source.preserveLuminosity??true})
 }
 if(source.type==='black & white'){
  const rgb=photoshopRGB(source.tintColor);if(source.useTint&&!rgb)return
  let hue=40,saturation=20
  if(rgb){const max=Math.max(...rgb),min=Math.min(...rgb),delta=max-min;saturation=max?delta/max*100:0;hue=delta?((max===rgb[0]?(rgb[1]-rgb[2])/delta:max===rgb[1]?2+(rgb[2]-rgb[0])/delta:4+(rgb[0]-rgb[1])/delta)*60+360)%360:0}
  return specToNativeAdjustment({kind:'blackWhite',weights:names.map((name,index)=>clamp(source[name],-200,300,[40,60,40,60,20,80][index])),tint:source.useTint??false,tintHue:hue,tintSaturation:saturation})
 }
 if(source.type==='gradient map'&&source.gradientType==='solid'){
  const stops=[...(source.colorStops??[])].sort((a,b)=>a.location-b.location)
  // The editor's gradient map is a two-stop opaque linear ramp. More complex
  // gradients must be reported rather than silently dropping intermediate stops.
  if(stops.length!==2||stops[0].location!==0||stops[1].location!==1||stops.some(stop=>stop.midpoint!==.5)||source.opacityStops?.some(stop=>stop.opacity!==1))return
  const colors=stops.map(stop=>photoshopRGB(stop.color));if(colors.some(color=>!color))return
  const hex=(rgb:number[])=>'#'+rgb.map(value=>Math.round(value*255).toString(16).padStart(2,'0')).join('')
  return specToNativeAdjustment({kind:'gradientMap',shadows:hex(colors[0]!),highlights:hex(colors[1]!),reversed:source.reverse??false})
 }
 return
}

/** Export editable Photoshop adjustment records instead of merged-preview-only layers. */
export function exportPhotoshopAdjustment(input:unknown):AdjustmentLayer|undefined {
 const spec=nativeAdjustmentToSpec(input)
 if(spec.kind==='levels')return {type:'levels',...Object.fromEntries(['rgb','red','green','blue'].map((key,index)=>{const range=spec.ranges[index];return [key,{shadowInput:range.black,highlightInput:range.white,midtoneInput:range.gamma,shadowOutput:range.outputBlack,highlightOutput:range.outputWhite}]}))}
 if(spec.kind==='curves')return {type:'curves',...Object.fromEntries(['rgb','red','green','blue'].map((key,index)=>[key,spec.channels[index].map(point=>({input:point.x,output:point.y}))]))}
 if(spec.kind==='hsl'){
  if(spec.invertRange)return
  const result:HueSaturationAdjustment&{nativeColorize:boolean}={type:'hue/saturation',nativeColorize:spec.colorize,master:{a:0,b:0,c:0,d:0,hue:spec.hue,saturation:spec.saturation,lightness:spec.lightness}}
  for(const [index,key] of names.entries()){const range=spec.hueRanges.find(value=>value.range.toLowerCase()===key);if(range)result[key]={a:range.band[0],b:range.band[1],c:range.band[2],d:range.band[3],hue:range.hue,saturation:range.saturation,lightness:range.lightness};else {const bands=[[315,345,15,45],[15,45,75,105],[75,105,135,165],[135,165,195,225],[195,225,255,285],[255,285,315,345]][index];result[key]={a:bands[0],b:bands[1],c:bands[2],d:bands[3],hue:0,saturation:0,lightness:0}}}
  return result
 }
 if(spec.kind==='exposure')return {type:'exposure',exposure:spec.exposure,offset:spec.offset,gamma:spec.gamma}
 if(spec.kind==='invert')return {type:'invert'}
 if(spec.kind==='colorBalance'){const values=(input:number[])=>({cyanRed:input[0],magentaGreen:input[1],yellowBlue:input[2]});return {type:'color balance',shadows:values(spec.shadows),midtones:values(spec.midtones),highlights:values(spec.highlights),preserveLuminosity:spec.preserveLuminosity}}
 if(spec.kind==='blackWhite'){
  const h=spec.tintHue/60,s=spec.tintSaturation/100,x=s*(1-Math.abs(h%2-1)),rgb=h<1?[s,x,0]:h<2?[x,s,0]:h<3?[0,s,x]:h<4?[0,x,s]:h<5?[x,0,s]:[s,0,x],color=rgb.map(value=>255*(value+1-s))
  return {type:'black & white',...Object.fromEntries(names.map((key,index)=>[key,spec.weights[index]])),useTint:spec.tint,tintColor:{r:color[0],g:color[1],b:color[2]}}
 }
 if(spec.kind==='gradientMap'){
  const color=(hex:string)=>({r:parseInt(hex.slice(1,3),16),g:parseInt(hex.slice(3,5),16),b:parseInt(hex.slice(5,7),16)})
  return {type:'gradient map',gradientType:'solid',name:'Compositor Gradient',reverse:spec.reversed,dither:false,smoothness:1,colorStops:[{color:color(spec.shadows),location:0,midpoint:.5},{color:color(spec.highlights),location:1,midpoint:.5}],opacityStops:[{opacity:1,location:0,midpoint:.5},{opacity:1,location:1,midpoint:.5}]}
 }
}
