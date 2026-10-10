import type {EditorState,Layer,Transform} from '../shared/contracts'
import {maskBackground} from '../shared/mask-pixels'
export interface MaskPreview {url:string;width:number;height:number}
export function solidMaskURL(value:number):string {const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d')!;context.fillStyle=`rgb(${value},${value},${value})`;context.fillRect(0,0,1,1);return canvas.toDataURL('image/png')}
export async function maskBackgroundURL(url:string):Promise<string> {const image=new Image();image.crossOrigin='anonymous';image.src=url;await image.decode();const canvas=document.createElement('canvas'),scale=Math.min(1,256/Math.max(image.naturalWidth,image.naturalHeight));canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));const context=canvas.getContext('2d',{willReadFrequently:true})!;context.drawImage(image,0,0,canvas.width,canvas.height);return solidMaskURL(maskBackground({width:canvas.width,height:canvas.height,data:context.getImageData(0,0,canvas.width,canvas.height).data}))}
/** A transient display document; the saved document and its mask assets are untouched. */
export function maskDisplayState(state:EditorState,id:string,preview:MaskPreview|undefined,placement:Transform|undefined,alone:boolean,backgroundURL:string):EditorState {
 const manifest=structuredClone(state.manifest),layer=manifest.layers.find(item=>item.id===id),assets=[...state.assets]
 if(!layer?.maskFile)return state
 if(placement)layer.maskPlacement=structuredClone(placement)
 if(preview){layer.maskFile=preview.url;assets.push({file:preview.url,hash:preview.url,width:preview.width,height:preview.height})}
 if(alone){
  const asset=assets.find(item=>item.file===layer.maskFile),transform=asset?.width===1&&asset.height===1?{origin:[0,0] as [number,number],size:[manifest.width,manifest.height] as [number,number],rotation:0,flipX:false,flipY:false,sampling:'Nearest' as const}:layer.maskPlacement??layer.transform
  const background:Layer={id:'mask-preview-background',name:'Mask background',isGroup:false,isVisible:true,opacity:1,blendMode:'Normal',imageFile:backgroundURL,transform:{origin:[0,0],size:[manifest.width,manifest.height],rotation:0,flipX:false,flipY:false,sampling:'Nearest'}}
  const gray:Layer={id:layer.id,name:layer.name,isGroup:false,isVisible:true,opacity:1,blendMode:'Normal',imageFile:layer.maskFile,transform}
  assets.push({file:backgroundURL,hash:backgroundURL,width:1,height:1});manifest.layers=[background,gray]
 }
 return {...state,manifest,assets}
}
