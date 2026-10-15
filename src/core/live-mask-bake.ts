/** Portable LiveLayerMask.swift LiveMaskBaker (native 1.4.8, MIT).
 * Bake only a copied target's external dependency; its own mask and appearance stay editable. */
import { PNG } from 'pngjs'
import { EditorError, LIMITS, type Layer, type Manifest } from '../shared/contracts'
import {effectiveMaskPixels,effectiveMaskTransform,sampleEffectiveMask,type EffectiveMask} from '../shared/mask-properties'
import { sourcePoint } from '../shared/selection-coverage'
import { documentPoint } from './raster-edit'
import { makeAsset, type Asset } from './project-io'
import type { LayerClipboard } from './layer-operations'

const byte = (value: number) => Math.max(0, Math.min(255, Math.round(value)))
function sample(values: Uint8Array, width: number, height: number, x: number, y: number, nearest: boolean, outside = 0): number {
  if(Math.abs(x*2-Math.round(x*2))<1e-9)x=Math.round(x*2)/2
  if(Math.abs(y*2-Math.round(y*2))<1e-9)y=Math.round(y*2)/2
  const at = (x: number,y: number) => x < 0 || y < 0 || x >= width || y >= height ? outside : values[y * width + x]
  if (nearest) return at(Math.floor(x),Math.floor(y))
  const ix=Math.floor(x-.5),iy=Math.floor(y-.5),tx=x-.5-ix,ty=y-.5-iy
  return at(ix,iy)*(1-tx)*(1-ty)+at(ix+1,iy)*tx*(1-ty)+at(ix,iy+1)*(1-tx)*ty+at(ix+1,iy+1)*tx*ty
}

export function bakeExternalClipping(manifest: Manifest, assets: Map<string,Asset>, clipboard: LayerClipboard): { metadata: LayerClipboard; assets: Map<string,Asset> } {
  const metadata=structuredClone(clipboard),output=new Map(assets),records=new Map(manifest.layers.map(layer=>[layer.id,layer])),included=new Set(metadata.layers.map(layer=>layer.id)),decoded=new Map<string,PNG>()
  const image=(file: string):PNG=>{
    const cached=decoded.get(file);if(cached)return cached
    const asset=assets.get(file);if(!asset)throw new EditorError('INVALID_PROJECT',`Missing clipping source asset: ${file}`)
    if(asset.width<1||asset.height<1||asset.width>LIMITS.maxSide||asset.height>LIMITS.maxSide||asset.width*asset.height>LIMITS.maxSurfacePixels)throw new EditorError('RESOURCE_LIMIT','Clipping source exceeds the raster budget.')
    if(asset.bitDepth===16)throw new EditorError('UNSUPPORTED_FEATURE','Baking external clipping does not yet preserve 16-bit data. Copy the clipping sources together instead.');
    const result=PNG.sync.read(asset.bytes,{checkCRC:true});decoded.set(file,result);return result
  }
  const effectiveOpacity=(layer:Layer)=>{
    let value=layer.opacity,parent=layer.parentID;const seen=new Set([layer.id])
    while(parent){if(seen.has(parent)||seen.size>64)throw new EditorError('INVALID_PROJECT','Cyclic clipping-source folder hierarchy.');seen.add(parent);const record=records.get(parent);if(!record)throw new EditorError('INVALID_PROJECT','Missing clipping-source folder.');value*=record.opacity;parent=record.parentID}
    return Math.min(1,Math.max(0,value))
  }
  for(const target of metadata.layers){
    if(!target.maskSourceID||included.has(target.maskSourceID))continue
    const original=records.get(target.id)
    if(!original?.imageFile||target.imageFile!==original.imageFile||target.isGroup)throw new EditorError('UNSUPPORTED_FEATURE','External clipping can only be baked into a raster-backed source layer.')
    const raster=image(original.imageFile),count=raster.width*raster.height,cache=new Map<string,Uint8Array>(),visiting=new Set<string>();let visits=0
    const coverage=(id:string):Uint8Array=>{
      const prior=cache.get(id);if(prior)return prior
      if(visiting.has(id)||visiting.size>=256)throw new EditorError('INVALID_PROJECT','Cyclic or excessively deep clipping source graph.')
      const source=records.get(id);if(!source||source.isGroup||source.adjustment||!source.imageFile)throw new EditorError('INVALID_PROJECT','Missing or unsupported live clipping source.')
      visiting.add(id)
      const pixels=image(source.imageFile),alpha=new Uint8Array(pixels.width*pixels.height)
      let mask:EffectiveMask|undefined,maskPlacement=source.maskPlacement??source.transform
      if(source.maskFile&&source.maskEnabled!==false){const raw=image(source.maskFile);mask=effectiveMaskPixels({width:raw.width,height:raw.height,data:new Uint8ClampedArray(raw.data)},source);maskPlacement=effectiveMaskTransform(maskPlacement,raw,mask.inset)}
      visits+=alpha.length+count;if(visits>80_000_000)throw new EditorError('RESOURCE_LIMIT','Live clipping bake exceeds the compute budget.')
      for(let y=0;y<pixels.height;y++)for(let x=0;x<pixels.width;x++){
        let value=pixels.data[(y*pixels.width+x)*4+3]
        if(mask)value*=sampleEffectiveMask(mask,maskPlacement,...documentPoint(source,x+.5,y+.5,pixels.width,pixels.height))/255
        alpha[y*pixels.width+x]=byte(value)
      }
      const inherited=source.maskSourceID?coverage(source.maskSourceID):undefined,result=new Uint8Array(count),opacity=effectiveOpacity(source)
      for(let y=0;y<raster.height;y++)for(let x=0;x<raster.width;x++){
        const p=documentPoint(original,x+.5,y+.5,raster.width,raster.height),s=sourcePoint(source,...p,pixels.width,pixels.height),i=y*raster.width+x
        result[i]=byte(sample(alpha,pixels.width,pixels.height,s[0],s[1],source.transform.sampling==='Nearest')*opacity*(inherited?inherited[i]/255:1))
      }
      visiting.delete(id);cache.set(id,result);return result
    }
    const clip=coverage(target.maskSourceID),baked=new PNG({width:raster.width,height:raster.height});raster.data.copy(baked.data)
    for(let i=0;i<count;i++){baked.data[i*4+3]=byte(raster.data[i*4+3]*clip[i]/255);if(!baked.data[i*4+3])baked.data.fill(0,i*4,i*4+3)}
    output.set(original.imageFile,makeAsset(original.imageFile,PNG.sync.write(baked)));delete target.maskSourceID
  }
  return {metadata,assets:output}
}
