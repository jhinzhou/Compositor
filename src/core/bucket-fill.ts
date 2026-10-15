import {PNG} from 'pngjs'
import {EditorError,LIMITS,type EditAction,type Layer} from '../shared/contracts'
import {documentPoint,sourcePoint,selectionCoverage,encodeRaster} from './raster-edit'
import {makeAsset,makeDeepAsset,makeHDRAsset,type Asset} from './project-io'
import {countAssetBytes} from './deep-assets'
import {layerProtected} from './layer-locks'
import {invalidatePhotoshopComponent} from './photoshop-metadata'
import type {PixelStage} from './pixel-actions'
import type {RGBAImage} from './selection-retouch'
export type BucketFillAction=Extract<EditAction,{type:'layer.bucket_fill'}>
export interface BucketFillPrepared {asset:Asset;affectedPixels:number}
const MAX_PIXELS=16_000_000,MAX_BYTES=512*1024*1024
/** Color-connected fill with explicit precision ownership: the original image is
 * the editing source at every depth; merged RGB8 is classification only. */
export function prepareBucketFill(stage:PixelStage,action:BucketFillAction,merged?:RGBAImage):BucketFillPrepared {
 const layer=stage.manifest.layers.find(item=>item.id===action.layerId)
 if(!layer)throw new EditorError('LAYER_NOT_FOUND','The Paint Bucket layer no longer exists.')
 if(layerProtected(stage.manifest,layer.id))throw new EditorError('INVALID_ARGUMENT','Unlock this layer before filling.')
 if(layer.text||layer.shape)throw new EditorError('RASTERIZATION_REQUIRED','Rasterize this text or shape layer before filling its image pixels.')
 if(layer.isGroup||layer.adjustment)throw new EditorError('INVALID_ARGUMENT','Choose a raster image layer to fill.')
 let asset=layer.imageFile?stage.assets.get(layer.imageFile):undefined
 if(layer.imageFile&&!asset)throw new EditorError('ASSET_NOT_FOUND','The Paint Bucket source image is missing.')
 if(action.sampleAllLayers){
  if(!merged)throw new EditorError('INVALID_ARGUMENT','Paint Bucket merged sampling requires a revision-checked document raster.')
  if(stage.manifest.layers.some(l=>l.imageFile&&(stage.assets.get(l.imageFile)?.deep||stage.assets.get(l.imageFile)?.hdr)))throw new EditorError('UNSUPPORTED_FEATURE','Paint Bucket All Layers sampling currently requires RGB8 layers. High-depth pixels and history have been kept.')
  if(merged.width!==stage.manifest.width||merged.height!==stage.manifest.height||merged.data.length!==merged.width*merged.height*4)throw new EditorError('INVALID_ARGUMENT','The merged fill source must match document dimensions.')
 }
 if(!asset){const width=Math.max(1,Math.round(layer.transform.size[0])),height=Math.max(1,Math.round(layer.transform.size[1]));if(width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>MAX_PIXELS||width*height*96>MAX_BYTES)throw new EditorError('RESOURCE_LIMIT','Paint Bucket exceeds its 16 MP source or 512 MiB working budget.');asset=makeAsset(`${layer.id.toUpperCase()}.png`,encodeRaster(new PNG({width,height})))}
 if(asset.bitDepth===16&&!asset.deep&&!asset.hdr)throw new EditorError('INVALID_PROJECT','The 16-bit fill source lacks preserved high-depth pixels.')

 const width=merged?.width??asset.width,height=merged?.height??asset.height,pixels=width*height
 if(pixels>MAX_PIXELS||asset.width*asset.height>MAX_PIXELS||pixels*24+asset.width*asset.height*64+countAssetBytes(asset)>MAX_BYTES)throw new EditorError('RESOURCE_LIMIT','Paint Bucket exceeds its 16 MP source or 512 MiB working budget.')
 const decoded=asset.hdr??asset.deep??PNG.sync.read(asset.bytes).data,scale=asset.hdr?1:asset.deep?65535:255,premultiplied=!!(asset.hdr||asset.deep)
 const data=merged?.data??decoded,compareScale=merged?255:scale,comparePremult=merged?false:premultiplied
 const seed=merged?action.point:sourcePoint(layer,...action.point,asset.width,asset.height),sx=Math.floor(seed[0]),sy=Math.floor(seed[1])
 if(action.point[0]<0||action.point[1]<0||action.point[0]>=stage.manifest.width||action.point[1]>=stage.manifest.height||sx<0||sy<0||sx>=width||sy>=height)throw new EditorError('INVALID_ARGUMENT','Click inside the Paint Bucket image bounds.')
 if(action.opacity===0)return {asset,affectedPixels:0}
 const reference=[0,1,2,3].map(c=>{const alpha=data[(sy*width+sx)*4+3]/compareScale;return c===3?alpha:data[(sy*width+sx)*4+c]/compareScale*(comparePremult?1:alpha)})
 const allowed=(x:number,y:number)=>{const p=merged?[x+.5,y+.5] as [number,number]:documentPoint(layer,x+.5,y+.5,width,height);return p[0]>=0&&p[1]>=0&&p[0]<stage.manifest.width&&p[1]<stage.manifest.height&&selectionCoverage(stage.selection,...p)>0}
 const matches=(index:number)=>{const x=index%width,y=Math.floor(index/width);if(!allowed(x,y))return false;const at=index*4,alpha=data[at+3]/compareScale;for(let c=0;c<4;c++){const value=c===3?alpha:data[at+c]/compareScale*(comparePremult?1:alpha);if(Math.abs(value-reference[c])*255>action.tolerance+1e-9)return false}return true}
 const coverage=new Uint8Array(pixels)
 if(!action.contiguous){for(let i=0;i<pixels;i++)if(matches(i))coverage[i]=255}
 else if(matches(sy*width+sx)){
  const stack=[sx,sy];while(stack.length){const y=stack.pop()!,x=stack.pop()!,row=y*width;if(coverage[row+x]||!matches(row+x))continue;let left=x,right=x;while(left>0&&!coverage[row+left-1]&&matches(row+left-1))left--;while(right+1<width&&!coverage[row+right+1]&&matches(row+right+1))right++;coverage.fill(255,row+left,row+right+1);for(const ny of [y-1,y+1]){if(ny<0||ny>=height)continue;let inRun=false;for(let nx=left;nx<=right;nx++){const valid=!coverage[ny*width+nx]&&matches(ny*width+nx);if(valid&&!inRun)stack.push(nx,ny);inRun=valid}}if(stack.length>2_000_000)throw new EditorError('RESOURCE_LIMIT','Paint Bucket exceeds its connected-region queue budget.')}
 }
 // A bounded geometric fringe; color matching is unchanged. This portable AA
 // is an approximation and requires independent native comparison.
 let mask=coverage
 if(action.antialiased){mask=new Uint8Array(pixels);for(let y=0;y<height;y++)for(let x=0;x<width;x++){if(!allowed(x,y))continue;let sum=0,weight=0;for(let yy=-1;yy<=1;yy++)for(let xx=-1;xx<=1;xx++){const px=x+xx,py=y+yy;if(px<0||py<0||px>=width||py>=height)continue;const w=(xx===0?2:1)*(yy===0?2:1);sum+=coverage[py*width+px]*w;weight+=w}mask[y*width+x]=Math.round(sum/weight)}}
 const result=decoded.slice(),write=asset.hdr?Math.fround:Math.round;let affectedPixels=0
 for(let y=0;y<asset.height;y++)for(let x=0;x<asset.width;x++){
  const point=documentPoint(layer,x+.5,y+.5,asset.width,asset.height);if(point[0]<0||point[1]<0||point[0]>=stage.manifest.width||point[1]>=stage.manifest.height)continue
  const mx=merged?Math.floor(point[0]):x,my=merged?Math.floor(point[1]):y;if(mx<0||my<0||mx>=width||my>=height)continue
  const amount=mask[my*width+mx]/255*selectionCoverage(stage.selection,...point)*action.opacity*action.color[3];if(!amount)continue
  const at=(y*asset.width+x)*4,da=decoded[at+3]/scale,alpha=amount+da*(1-amount),before=[decoded[at],decoded[at+1],decoded[at+2],decoded[at+3]]
  result[at+3]=write(alpha*scale)
  for(let c=0;c<3;c++){const value=action.color[c]*amount+decoded[at+c]/scale*(premultiplied?1:da)*(1-amount);result[at+c]=write((premultiplied?value:alpha?value/alpha:0)*scale)}
  if(before.some((v,c)=>v!==result[at+c]))affectedPixels++
 }
 if(!affectedPixels)return {asset,affectedPixels:0}
 const file=`${layer.id.toUpperCase()}.${asset.hdr?'exr':'png'}`,output=asset.hdr?makeHDRAsset(file,asset.width,asset.height,result as Float32Array):asset.deep?makeDeepAsset(file,asset.width,asset.height,result as Uint16Array):makeAsset(file,encodeRaster({width:asset.width,height:asset.height,data:result} as PNG))
 return {asset:output,affectedPixels}
}
export function applyBucketFill(stage:PixelStage,action:BucketFillAction,merged?:RGBAImage):string{const prepared=prepareBucketFill(stage,action,merged),layer=stage.manifest.layers.find(l=>l.id===action.layerId)!;stage.bucketPreview=prepared.asset;if(prepared.affectedPixels){stage.assets.set(prepared.asset.file,prepared.asset);layer.imageFile=prepared.asset.file;invalidatePhotoshopComponent(layer,'text');invalidatePhotoshopComponent(layer,'vector')}return 'Paint Bucket'}
