import CanvasKitInit, { type CanvasKit, type Image, type Surface, type Canvas } from 'canvaskit-wasm'
import wasmUrl from 'canvaskit-wasm/bin/canvaskit.wasm?url'
import { EditorError,LIMITS, type BLEND_MODES, type EditorState, type Layer } from '../shared/contracts'
import { layerSourcePoint } from './hit-test'
import { expandedContentTransform } from '../shared/content-transform'
import {effectsMargin,renderLayerEffects,validateLayerEffects,hasVisibleEffects} from '../shared/layer-effects'
import {applyImageFilter,nativeAdjustmentToSpec} from '../shared/image-filters'
import { BlendPainter } from './blend-modes'
import type { WorldRegion } from './viewport-render'

let kitPromise: Promise<CanvasKit> | undefined
export const getCanvasKit = (): Promise<CanvasKit> => kitPromise ??= CanvasKitInit({ locateFile: () => wasmUrl })
export function assetUrl(state: EditorState, file: string): string {
  if (file.startsWith('data:image/png;base64,')) return file
  const asset = state.assets.find(item => item.file === file)
  if (!asset) throw new EditorError('ASSET_NOT_FOUND', 'The layer image is missing.')
  return `compositor-asset://${state.sessionId}/${encodeURIComponent(file)}?hash=${asset.hash}`
}
export function orderedLayers(state: EditorState): { layer: Layer; opacity: number; depth: number }[] {
  const rows: { layer: Layer; opacity: number; depth: number }[] = []
  const walk = (parentID: string | undefined, opacity: number, visible: boolean, depth: number): void => {
    for (const layer of state.manifest.layers.filter(item => item.parentID === parentID)) {
      const nextOpacity = opacity * layer.opacity
      if (visible && layer.isVisible) rows.push({ layer, opacity: nextOpacity, depth })
      if (layer.isGroup) walk(layer.id, nextOpacity, visible && layer.isVisible, depth + 1)
    }
  }
  walk(undefined, 1, true, 0)
  return rows
}
export function viewportHalo(state:EditorState):number {
  let effects=0,filters=0
  for(const {layer} of orderedLayers(state)){
    if(layer.effects){const asset=state.assets.find(item=>item.file===layer.imageFile),scale=asset?Math.max(layer.transform.size[0]/asset.width,layer.transform.size[1]/asset.height):1;effects=Math.max(effects,effectsMargin(validateLayerEffects(layer.effects))*scale*Math.SQRT2)}
    if(layer.adjustment){const spec=nativeAdjustmentToSpec(layer.adjustment);if(spec.kind==='gaussianBlur')filters+=spec.radius*3;else if(spec.kind==='motionBlur')filters+=spec.distance}
  }
  return effects+filters
}
export class CanvasEngine {
  private fullResolutionEffects=false
  setFullResolutionEffects(value:boolean):void {this.fullResolutionEffects=value}
  private kit?: CanvasKit
  private surface?: Surface
  private blends = new BlendPainter()
  private region: WorldRegion = {x:0,y:0,width:1,height:1}
  private worldTransform(canvas: Canvas,width:number,height:number):void { canvas.scale(width/this.region.width,height/this.region.height);canvas.translate(-this.region.x,-this.region.y) }
  private worldRect(): Float32Array { const r=this.region;return this.kit!.XYWHRect(r.x,r.y,r.width,r.height) }

  hitTest(state: EditorState, x: number, y: number): string | undefined {
    const kit = this.kit
    if (!kit || x < 0 || y < 0 || x >= state.manifest.width || y >= state.manifest.height) return undefined
    for (const { layer, opacity } of orderedLayers(state).reverse()) {
      if (!layer.imageFile || opacity <= 0) continue
      const asset = state.assets.find(asset => asset.file === layer.imageFile)
      const image = asset && this.images.get(asset.hash)
      if (!image) continue
      const point = layerSourcePoint(layer, x, y, image.width(), image.height())
      if (!point) continue
      const pixel = image.readPixels(point[0], point[1], { width: 1, height: 1, colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Unpremul, colorSpace: kit.ColorSpace.SRGB })
      if (pixel && pixel[3] * opacity > 0 && this.hitCoverage(state,layer,x,y,new Set()) > 0) return layer.id
    }
    return undefined
  }
  private hitCoverage(state:EditorState,layer:Layer,x:number,y:number,visited:Set<string>):number {
    if(visited.has(layer.id))return 0
    visited.add(layer.id)
    let coverage=this.maskCoverage(state,layer,x,y),parent=layer.parentID
    while(parent){const folder=state.manifest.layers.find(item=>item.id===parent);if(!folder)return 0;coverage*=this.maskCoverage(state,folder,x,y);parent=folder.parentID}
    if(layer.maskSourceID){const source=state.manifest.layers.find(item=>item.id===layer.maskSourceID),asset=source?.imageFile&&state.assets.find(item=>item.file===source.imageFile),image=asset&&this.images.get(asset.hash)
      if(!source||!image)return 0
      const point=layerSourcePoint(source,x,y,image.width(),image.height()),kit=this.kit!
      if(!point)return 0
      const pixel=image.readPixels(point[0],point[1],{width:1,height:1,colorType:kit.ColorType.RGBA_8888,alphaType:kit.AlphaType.Unpremul,colorSpace:kit.ColorSpace.SRGB})
      coverage*=pixel ? pixel[3]/255*source.opacity*this.hitCoverage(state,source,x,y,visited) : 0
    }
    return coverage
  }
  private maskCoverage(state:EditorState,layer:Layer,x:number,y:number):number {
    if(!layer.maskFile||layer.maskEnabled===false)return 1
    const mask=this.maskImage(state,layer),kit=this.kit!,w=mask.width(),h=mask.height(),info={width:1,height:1,colorType:kit.ColorType.RGBA_8888,alphaType:kit.AlphaType.Unpremul,colorSpace:kit.ColorSpace.SRGB}
    if(w===1&&h===1)return mask.readPixels(0,0,info)![3]/255
    const transform=layer.maskPlacement??layer.transform,point=layerSourcePoint({...layer,transform},x,y,w,h)
    if(point)return mask.readPixels(point[0],point[1],info)![3]/255
    return this.maskBorder(mask)
  }
  private maskBorders=new WeakMap<object,number>()
  private maskBorder(mask:Image):number {
    const cached=this.maskBorders.get(mask);if(cached!==undefined)return cached
    const kit=this.kit!,w=mask.width(),h=mask.height(),pixels=mask.readPixels(0,0,{width:w,height:h,colorType:kit.ColorType.RGBA_8888,alphaType:kit.AlphaType.Unpremul,colorSpace:kit.ColorSpace.SRGB})!
    let edge=0,count=0
    // Native perimeter counts every pixel once, including corners and 1px edges.
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(!x||!y||x===w-1||y===h-1){edge+=pixels[(y*w+x)*4+3];count++}
    const result=edge/count>=127.5?1:0;this.maskBorders.set(mask,result);return result
  }
  private effectImages = new Map<string,{image:Image;inset:number;bytes:number}>()
  private images = new Map<string, Image>()
  private sessionId?: string
  private maskImages = new Map<string, Image>()
  async draw(element: HTMLCanvasElement, state: EditorState, width: number, height: number, region?: WorldRegion): Promise<void> {
    const kit = this.kit = await getCanvasKit()
    this.region = region ?? {x:0,y:0,width:state.manifest.width,height:state.manifest.height}
    if (this.sessionId !== state.sessionId) { this.clearImages(); this.sessionId = state.sessionId }
    const needed = new Set(state.assets.map(asset => asset.hash))
    for (const [hash,image] of this.maskImages) if(!needed.has(hash)){image.delete();this.maskImages.delete(hash)}
    for (const [hash, image] of this.images) if (!needed.has(hash)) { image.delete(); this.images.delete(hash) }
    for (const asset of state.assets) {
      if (this.images.has(asset.hash)) continue
      let bytes:ArrayBuffer|Uint8Array
      if(asset.file.startsWith('data:image/png;base64,')){const binary=atob(asset.file.slice('data:image/png;base64,'.length));bytes=Uint8Array.from(binary,char=>char.charCodeAt(0))}
      else {const response = await fetch(assetUrl(state, asset.file));if (!response.ok) throw new EditorError('ASSET_NOT_FOUND', 'An image snapshot could not be loaded.');bytes=await response.arrayBuffer()}
      const image = kit.MakeImageFromEncoded(bytes)
      if (!image) throw new EditorError('RENDER_FAILED', 'CanvasKit could not decode a layer image.')
      this.images.set(asset.hash, image)
    }
    this.surface?.delete()
    element.width = width; element.height = height
    // CPU Skia is the correctness baseline. The WebGL helper can replace the DOM
    // canvas on fallback, removing Vue's pointer handlers. Gate a GPU path separately.
    this.surface = kit.MakeSWCanvasSurface(element) ?? undefined
    if (!this.surface) throw new EditorError('RENDER_FAILED', 'No rendering surface is available.')
    const canvas = this.surface.getCanvas()
    canvas.clear(kit.TRANSPARENT)
    canvas.save(); this.worldTransform(canvas,width,height)
    const skipped=new Set<string>()
    for (const { layer, opacity } of orderedLayers(state)) {
      if(skipped.has(layer.id))continue
      if (layer.isGroup || (!layer.imageFile&&!layer.adjustment)) continue
      const asset = layer.imageFile&&state.assets.find(item => item.file === layer.imageFile)!
      const image = asset&&this.images.get(asset.hash)!
      const ancestors: Layer[] = []
      let parent = layer.parentID
      while (parent) { const folder = state.manifest.layers.find(item => item.id === parent)!; ancestors.push(folder); parent = folder.parentID }
      const siblings=state.manifest.layers.filter(item=>item.parentID===layer.parentID),index=siblings.findIndex(item=>item.id===layer.id),children:Layer[]=[]
      if(!layer.maskSourceID&&!layer.adjustment)for(const child of siblings.slice(index+1)){if(child.maskSourceID!==layer.id||child.isGroup)break;children.push(child);skipped.add(child.id)}
      if(children.length){const stack=this.clippingStack(state,layer,children,width,height,ancestors,opacity),paint=new kit.Paint();this.blends.apply(kit,paint,layer.blendMode as typeof BLEND_MODES[number]);try{canvas.drawImageRect(stack,kit.XYWHRect(0,0,width,height),this.worldRect(),paint)}finally{stack.delete();paint.delete()}continue}
      if(layer.adjustment){this.drawAdjustment(canvas,this.surface,state,layer,opacity,width,height,ancestors);continue}
      const masked = !!layer.effects || layer.maskFile && layer.maskEnabled !== false || layer.maskSourceID || ancestors.some(item => item.maskFile && item.maskEnabled !== false)
      const paint = new kit.Paint()
      paint.setAlphaf(opacity); this.blends.apply(kit, paint, layer.blendMode as typeof BLEND_MODES[number]); paint.setAntiAlias(true)
      if (masked) {
        const baked = this.coveredLayer(state, layer, width, height, ancestors)
        try { canvas.drawImageRect(baked, kit.XYWHRect(0,0,width,height),this.worldRect(),paint) } finally { baked.delete() }
      } else this.drawImage(canvas, layer, image as Image, paint)
      paint.delete()
    }
    canvas.restore(); this.surface.flush()
  }
  private clippingStack(state:EditorState,base:Layer,children:Layer[],width:number,height:number,ancestors:Layer[],opacity:number):Image {
    const kit=this.kit!,surface=kit.MakeSurface(width,height)!,canvas=surface.getCanvas(),paint=new kit.Paint(),image=this.coveredLayer(state,base,width,height,ancestors)
    try{
      canvas.clear(kit.TRANSPARENT);paint.setAlphaf(opacity);canvas.drawImage(image,0,0,paint);surface.flush()
      const original=this.surfacePixels(surface,width,height),opaque=new Uint8ClampedArray(original)
      for(let i=3;i<opaque.length;i+=4)opaque[i]=255
      const start=this.rgbaImage(opaque,width,height);paint.setAlphaf(1);paint.setBlendMode(kit.BlendMode.Src);canvas.drawImage(start,0,0,paint);start.delete();this.worldTransform(canvas,width,height)
      const ancestorOpacity=ancestors.reduce((value,layer)=>value*layer.opacity,1)
      for(const child of children){if(!child.isVisible)continue;if(child.adjustment){this.drawAdjustment(canvas,surface,state,child,child.opacity*ancestorOpacity,width,height,ancestors);continue}
        const layer=this.coveredLayer(state,{...child,maskSourceID:undefined},width,height,ancestors),cp=new kit.Paint();cp.setAlphaf(child.opacity*ancestorOpacity);this.blends.apply(kit,cp,child.blendMode as typeof BLEND_MODES[number])
        try{canvas.drawImageRect(layer,kit.XYWHRect(0,0,width,height),this.worldRect(),cp)}finally{layer.delete();cp.delete()}
      }
      surface.flush();const result=this.surfacePixels(surface,width,height);for(let i=3;i<result.length;i+=4)result[i]=original[i]
      return this.rgbaImage(result,width,height)
    }finally{image.delete();paint.delete();surface.delete()}
  }
  private surfacePixels(surface:Surface,width:number,height:number):Uint8ClampedArray {
    const kit=this.kit!,image=surface.makeImageSnapshot()
    try{return new Uint8ClampedArray(image.readPixels(0,0,{width,height,colorType:kit.ColorType.RGBA_8888,alphaType:kit.AlphaType.Unpremul,colorSpace:kit.ColorSpace.SRGB})!)}finally{image.delete()}
  }
  private rgbaImage(data:Uint8Array|Uint8ClampedArray,width:number,height:number):Image {const kit=this.kit!;return kit.MakeImage({width,height,colorType:kit.ColorType.RGBA_8888,alphaType:kit.AlphaType.Unpremul,colorSpace:kit.ColorSpace.SRGB},data,width*4)!}
  private drawAdjustment(canvas:Canvas,surface:Surface,state:EditorState,layer:Layer,opacity:number,width:number,height:number,ancestors:Layer[]):void{
    const kit=this.kit!,original=this.surfacePixels(surface,width,height),spec=nativeAdjustmentToSpec(layer.adjustment),scale=width/this.region.width
    const adjusted=applyImageFilter({width,height,data:original},spec,undefined,scale).data
    const paint=new kit.Paint()
    if(layer.blendMode!=='Normal'){
      const blendSurface=kit.MakeSurface(width,height)!,bc=blendSurface.getCanvas(),base=new Uint8ClampedArray(original),top=new Uint8ClampedArray(adjusted)
      for(let i=3;i<base.length;i+=4){base[i]=255;top[i]=255}
      const baseImage=this.rgbaImage(base,width,height),topImage=this.rgbaImage(top,width,height)
      try{bc.drawImage(baseImage,0,0);this.blends.apply(kit,paint,layer.blendMode as typeof BLEND_MODES[number]);bc.drawImage(topImage,0,0,paint);blendSurface.flush();const blended=this.surfacePixels(blendSurface,width,height);for(let i=0;i<adjusted.length;i+=4)adjusted.set(blended.subarray(i,i+3),i)}finally{baseImage.delete();topImage.delete();blendSurface.delete();paint.delete()}
    }else paint.delete()
    const coverageSurface=kit.MakeSurface(width,height)!,mc=coverageSurface.getCanvas()
    let coverage:Uint8ClampedArray
    try{mc.clear(kit.WHITE);this.worldTransform(mc,width,height);this.applyMask(mc,state,layer,width,height);for(const folder of ancestors)this.applyMask(mc,state,folder,width,height);coverageSurface.flush();coverage=this.surfacePixels(coverageSurface,width,height)}finally{coverageSurface.delete()}
    for(let i=0;i<adjusted.length;i+=4){const amount=opacity*coverage[i+3]/255;for(let c=0;c<3;c++)adjusted[i+c]=Math.round(original[i+c]+(adjusted[i+c]-original[i+c])*amount);adjusted[i+3]=original[i+3]}
    const image=this.rgbaImage(adjusted,width,height),copy=new kit.Paint();copy.setBlendMode(kit.BlendMode.Src)
    try{canvas.drawImageRect(image,kit.XYWHRect(0,0,width,height),this.worldRect(),copy)}finally{image.delete();copy.delete()}
  }
  private drawImage(canvas: Canvas, layer: Layer, image: Image, paint: InstanceType<CanvasKit['Paint']>): void {
    const kit = this.kit!, t = layer.transform, [w,h] = t.size
    canvas.save(); canvas.translate(t.origin[0]+w/2,t.origin[1]+h/2);canvas.rotate(t.rotation,0,0);canvas.scale(t.flipX?-1:1,t.flipY?-1:1)
    const source=kit.XYWHRect(0,0,image.width(),image.height()),target=kit.XYWHRect(-w/2,-h/2,w,h)
    if(t.sampling==='High quality')canvas.drawImageRectCubic(image,source,target,1/3,1/3,paint)
    else canvas.drawImageRectOptions(image,source,target,t.sampling==='Nearest'?kit.FilterMode.Nearest:kit.FilterMode.Linear,kit.MipmapMode.None,paint)
    canvas.restore()
  }
  private maskImage(state: EditorState, layer: Layer): Image {
    const kit=this.kit!,asset=state.assets.find(item=>item.file===layer.maskFile)!,key=asset.hash
    let mask=this.maskImages.get(key)
    if(mask)return mask
    const source=this.images.get(key)!,w=source.width(),h=source.height()
    const pixels=source.readPixels(0,0,{width:w,height:h,colorType:kit.ColorType.RGBA_8888,alphaType:kit.AlphaType.Unpremul,colorSpace:kit.ColorSpace.SRGB})!
    const rgba=new Uint8Array(w*h*4)
    for(let i=0;i<rgba.length;i+=4){rgba[i]=rgba[i+1]=rgba[i+2]=255;rgba[i+3]=pixels[i]}
    mask=kit.MakeImage({width:w,height:h,colorType:kit.ColorType.RGBA_8888,alphaType:kit.AlphaType.Unpremul,colorSpace:kit.ColorSpace.SRGB},rgba,w*4)!
    this.maskImages.set(key,mask);return mask
  }
  private applyMask(canvas: Canvas, state: EditorState, layer: Layer, width: number, height: number): void {
    if(!layer.maskFile||layer.maskEnabled===false)return
    const kit=this.kit!,mask=this.maskImage(state,layer),surface=kit.MakeSurface(width,height)!
    const mc=surface.getCanvas(),paint=new kit.Paint()
    try {
      const pixels=mask.readPixels(0,0,{width:mask.width(),height:mask.height(),colorType:kit.ColorType.RGBA_8888,alphaType:kit.AlphaType.Unpremul,colorSpace:kit.ColorSpace.SRGB})!
      if(mask.width()===1&&mask.height()===1)mc.clear(kit.Color(255,255,255,pixels[3]/255))
      else {
        mc.clear(kit.Color(255,255,255,this.maskBorder(mask)));this.worldTransform(mc,width,height)
        paint.setBlendMode(kit.BlendMode.Src)
        const transform=layer.maskPlacement??layer.transform
        this.drawImage(mc,{...layer,transform},mask,paint)
      }
      surface.flush();const image=surface.makeImageSnapshot()
      paint.setBlendMode(kit.BlendMode.DstIn)
      try{canvas.drawImageRect(image,kit.XYWHRect(0,0,width,height),this.worldRect(),paint)}finally{image.delete()}
    }finally{paint.delete();surface.delete()}
  }
  /** Effects are evaluated in the source pixel grid, then transformed together with the layer. */
  private localEffects(state:EditorState,layer:Layer,source:Image,hash:string):{image:Image;inset:number} {
    const effects=validateLayerEffects(layer.effects),factor=this.fullResolutionEffects?1:Math.min(1,3000/(Math.max(source.width(),source.height())+2*effectsMargin(effects)))
    const maskAsset=layer.maskFile&&state.assets.find(item=>item.file===layer.maskFile)
    const key=JSON.stringify([hash,factor,layer.effects,layer.maskEnabled!==false&&maskAsset?maskAsset.hash:null,layer.maskPlacement,layer.maskFile?layer.transform:null])
    const cached=this.effectImages.get(key);if(cached){this.effectImages.delete(key);this.effectImages.set(key,cached);return cached}
    const kit=this.kit!,w=Math.max(1,Math.round(source.width()*factor)),h=Math.max(1,Math.round(source.height()*factor))
    if(this.fullResolutionEffects){const inset=effectsMargin(effects),expandedW=w+2*inset,expandedH=h+2*inset,pixels=expandedW*expandedH;if(expandedW>LIMITS.maxSide||expandedH>LIMITS.maxSide||pixels>LIMITS.maxPixels||pixels*40>512*1024*1024)throw new EditorError('RESOURCE_LIMIT','The full-resolution effects working surfaces exceed the image or 512 MiB budget.')}
    let pixels:Uint8Array|Uint8ClampedArray
    if(factor===1)pixels=source.readPixels(0,0,{width:w,height:h,colorType:kit.ColorType.RGBA_8888,alphaType:kit.AlphaType.Unpremul,colorSpace:kit.ColorSpace.SRGB}) as Uint8Array
    else {const reduced=kit.MakeSurface(w,h);if(!reduced)throw new EditorError('RESOURCE_LIMIT','The local effects source surface is unavailable.');try{reduced.getCanvas().drawImageRectCubic(source,kit.XYWHRect(0,0,source.width(),source.height()),kit.XYWHRect(0,0,w,h),1/3,1/3);reduced.flush();pixels=this.surfacePixels(reduced,w,h)}finally{reduced.delete()}}
    let coverage:Uint8Array|undefined
    if(maskAsset&&layer.maskEnabled!==false){
      const mask=this.maskImage(state,layer)
      if(mask.width()===1&&mask.height()===1)coverage=new Uint8Array([mask.readPixels(0,0,{width:1,height:1,colorType:kit.ColorType.RGBA_8888,alphaType:kit.AlphaType.Unpremul,colorSpace:kit.ColorSpace.SRGB})![3]])
      else {
        const surface=kit.MakeSurface(w,h);if(!surface)throw new EditorError('RESOURCE_LIMIT','The local effects mask surface is unavailable.')
        const canvas=surface.getCanvas(),paint=new kit.Paint(),t=layer.transform
        try{canvas.clear(kit.Color(255,255,255,this.maskBorder(mask)));canvas.translate(w/2,h/2);canvas.scale(w/t.size[0]*(t.flipX?-1:1),h/t.size[1]*(t.flipY?-1:1));canvas.rotate(-t.rotation,0,0);canvas.translate(-t.origin[0]-t.size[0]/2,-t.origin[1]-t.size[1]/2);paint.setBlendMode(kit.BlendMode.Src);this.drawImage(canvas,{...layer,transform:layer.maskPlacement??t},mask,paint);surface.flush();const rgba=this.surfacePixels(surface,w,h);coverage=new Uint8Array(w*h);for(let i=0;i<coverage.length;i++)coverage[i]=rgba[i*4+3]}finally{paint.delete();surface.delete()}
      }
    }
    const rendered=renderLayerEffects({width:w,height:h,data:new Uint8Array(pixels)},effects,coverage,factor),image=this.rgbaImage(rendered.data,rendered.width,rendered.height),bytes=rendered.data.byteLength
    this.effectImages.set(key,{image,inset:rendered.inset/factor,bytes})
    let retained=[...this.effectImages.values()].reduce((sum,item)=>sum+item.bytes,0)
    while(this.effectImages.size>1&&(this.effectImages.size>8||retained>128*1024*1024)){const oldest=this.effectImages.keys().next().value!,value=this.effectImages.get(oldest)!;value.image.delete();retained-=value.bytes;this.effectImages.delete(oldest)}
    return {image,inset:rendered.inset/factor}
  }
  private coveredLayer(state: EditorState, layer: Layer, width: number, height: number, ancestors: Layer[] = [], depth=0): Image {
    if(depth>256)throw new EditorError('INVALID_PROJECT','Clipping recursion exceeded its limit.')
    const kit=this.kit!,surface=kit.MakeSurface(width,height)!,canvas=surface.getCanvas(),paint=new kit.Paint()
    try{
      canvas.clear(kit.TRANSPARENT);this.worldTransform(canvas,width,height)
      if(layer.imageFile){
        const asset=state.assets.find(item=>item.file===layer.imageFile)!,source=this.images.get(asset.hash)!
        if(layer.effects&&hasVisibleEffects(layer.effects)){const local=this.localEffects(state,layer,source,asset.hash),transform=expandedContentTransform(layer.transform,[source.width(),source.height()],local.inset);this.drawImage(canvas,{...layer,transform},local.image,paint)}
        else {this.drawImage(canvas,layer,source,paint);this.applyMask(canvas,state,layer,width,height)}
      }
      if(layer.maskSourceID){const source=state.manifest.layers.find(item=>item.id===layer.maskSourceID)!,image=this.coveredLayer(state,source,width,height,[],depth+1)
        paint.setBlendMode(kit.BlendMode.DstIn);paint.setAlphaf(source.opacity)
        try{canvas.drawImageRect(image,kit.XYWHRect(0,0,width,height),this.worldRect(),paint)}finally{image.delete()}
      }
      for(const folder of ancestors)this.applyMask(canvas,state,folder,width,height)
      surface.flush();return surface.makeImageSnapshot()
    }finally{paint.delete();surface.delete()}
  }
  png(): Uint8Array {
    if (!this.surface) throw new EditorError('RENDER_FAILED', 'The canvas has not rendered.')
    const snapshot = this.surface.makeImageSnapshot()
    try {
      const bytes = snapshot.encodeToBytes(this.kit!.ImageFormat.PNG, 100)
      if (!bytes) throw new EditorError('RENDER_FAILED', 'PNG encoding failed.')
      return bytes
    } finally { snapshot.delete() }
  }
  private clearImages(): void { for(const value of this.effectImages.values())value.image.delete();this.effectImages.clear();for (const image of [...this.images.values(),...this.maskImages.values()]) image.delete(); this.images.clear(); this.maskImages.clear() }
  dispose(): void { this.surface?.delete(); this.clearImages(); this.blends.dispose() }
}
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(binary)
}
