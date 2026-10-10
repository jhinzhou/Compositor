import {infoHandlersMap} from 'ag-psd/dist/additionalInfo.js'
import {readBytes} from 'ag-psd/dist/psdReader.js'
import type {AdjustmentLayer,HueSaturationAdjustment,HueSaturationAdjustmentChannel} from 'ag-psd'
import {imageFilterSchema,specToNativeAdjustment} from '../shared/image-filters'
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
infoHandlersMap['hue ']={...hueReader,key:'hue '} // Native importer also accepts the legacy Hue/Saturation tag.
export function photoshopAdjustment(source:AdjustmentLayer|undefined):Record<string,unknown>|undefined {
 if(!source)return
 if(source.type==='levels'){
  const ranges=['rgb','red','green','blue'].map(key=>{const value=source[key as 'rgb'],black=clamp(value?.shadowInput,0,254,0);return {black,white:clamp(value?.highlightInput,black+1,255,255),gamma:clamp(value?.midtoneInput,.1,9.99,1),outputBlack:clamp(value?.shadowOutput,0,255,0),outputWhite:clamp(value?.highlightOutput,0,255,255)}})
  return specToNativeAdjustment(imageFilterSchema.parse({kind:'levels',ranges}))
 }
 if(source.type==='curves'){
  const channels=['rgb','red','green','blue'].map(key=>{const values=source[key as 'rgb'];if(!values||values.length<2)return [{x:0,y:0},{x:255,y:255}];const byX=new Map<number,number>();for(const point of values)byX.set(clamp(point.input,0,255,0),clamp(point.output,0,255,0));const points=[...byX].sort((a,b)=>a[0]-b[0]).map(([x,y])=>({x,y}));if(points[0].x!==0)points.unshift({x:0,y:points[0].y});if(points.at(-1)!.x!==255)points.push({x:255,y:points.at(-1)!.y});return points})
  const parsed=imageFilterSchema.safeParse({kind:'curves',channels});return parsed.success?specToNativeAdjustment(parsed.data):undefined
 }
 if(source.type==='hue/saturation'){
  const degrees=(value:number)=>((value%360)+360)%360,master=source.master,rangeNames=['Reds','Yellows','Greens','Cyans','Blues','Magentas'] as const,colorize=!!(source as HueSaturationAdjustment&{nativeColorize?:boolean}).nativeColorize
  const hueRanges=colorize?[]:names.flatMap((key,index)=>{const value=source[key];return value?[{range:rangeNames[index],band:[value.a,value.b,value.c,value.d].map(degrees),hue:clamp(value.hue,-360,360,0),saturation:clamp(value.saturation,-100,100,0),lightness:clamp(value.lightness,-100,100,0)}]:[]})
  return specToNativeAdjustment(imageFilterSchema.parse({kind:'hsl',hue:clamp(master?.hue,-360,360,0),saturation:clamp(master?.saturation,-100,100,0),lightness:clamp(master?.lightness,-100,100,0),colorize,hueRanges}))
 }
 // The original importer supports only Levels/Curves/Hue-Saturation, and skips unsupported adjustments.
 return
}
