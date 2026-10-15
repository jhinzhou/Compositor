import {mapDocumentInfoPoints} from '../shared/document-info'
import {transformVectorFrameMetadata} from './vector-frame-metadata'
import {PNG} from 'pngjs'
import {sampleCropBicubic,cropSourceFootprint,cropSampleTapCount,cropIsotropicAffineMinification,cropMappingIsMagnifying,CROP_MAGNIFICATION_BOUND_PROBES} from './crop-sampling'
import {EditorError,LIMITS,type EditAction,type Layer} from '../shared/contracts'
import {mapCropPoint,perspectiveCropMatrix,rotateCropPoint,straightenPlacement} from '../shared/crop-projective'
import {sourcePoint} from '../shared/selection-coverage'
import {sampleDeepBilinear} from './deep-resample'
import {sampleHDRBilinear} from './hdr-resample'
import {assertDeepAssetBudget,countAssetBytes} from './deep-assets'
import {makeAsset,makeDeepAsset,makeHDRAsset,type Asset} from './project-io'
import {encodeRaster} from './raster-edit'
import {transformNamedSelections} from './named-selections'
import {invalidatePhotoshopComponent} from './photoshop-metadata'
import type {PixelStage} from './pixel-actions'
const WORKING_BYTES=512*1024*1024,COMPUTE_SAMPLES=120_000_000
const sampleCost=(sampling:Layer['transform']['sampling'])=>sampling==='High quality'?16:sampling==='Smooth'?4:1
/** RGB8 PNG samples are decoded on demand; their RGBA surface is not retained
 * in countAssetBytes. High-depth image samples already have a counted backing
 * array, but the mask path still reads PNG regardless of the image precision. */
export function perspectiveCropDecodedSourceBytes(asset:Asset,mask=false):number{return !mask&&(asset.deep||asset.hdr)?0:asset.width*asset.height*4}
export function applyStraighten(stage:PixelStage,action:Extract<EditAction,{type:'document.straighten'}>):string{
 const {width,height}=stage.manifest,crop=action.crop??{x:0,y:0,width,height}
 transformVectorFrameMetadata(stage,p=>{const q=rotateCropPoint(p,[width/2,height/2],action.angle);return [q[0]-crop.x,q[1]-crop.y]})
 if(crop.width*crop.height>LIMITS.maxSurfacePixels)throw new EditorError('RESOURCE_LIMIT','Crop dimensions exceed the supported canvas size.')
 const inverse=(x:number,y:number)=>rotateCropPoint([x+crop.x,y+crop.y],[width/2,height/2],-action.angle)
 transformNamedSelections(stage.manifest,crop.width,crop.height,inverse,!!action.angle)
 for(const layer of stage.manifest.layers){layer.transform=straightenPlacement(layer.transform,width,height,action.angle,crop);if(layer.maskPlacement)layer.maskPlacement=straightenPlacement(layer.maskPlacement,width,height,action.angle,crop)}
 if(stage.manifest.documentInfo)stage.manifest.documentInfo=mapDocumentInfoPoints(stage.manifest.documentInfo,p=>{const q=rotateCropPoint(p,[width/2,height/2],action.angle);return [q[0]-crop.x,q[1]-crop.y]})
 // Guides describe document rulers rather than source pixels. Keep their axes.
 for(const guide of stage.manifest.guides??[])guide.position-=guide.axis==='vertical'?crop.x:crop.y
 stage.manifest.width=crop.width;stage.manifest.height=crop.height;stage.selection=null
 return 'Straighten canvas'
}
function sample8(source:{width:number;height:number;data:Uint8Array},u:number,v:number,nearest:boolean,mask=false,background=0):number[]{
 const {width,height,data}=source
 if(nearest){const x=Math.floor(u+1e-9),y=Math.floor(v+1e-9);if(x<0||y<0||x>=width||y>=height)return mask?[background,background,background,255]:[0,0,0,0];return [...data.subarray((y*width+x)*4,(y*width+x)*4+4)]}
 const x=Math.floor(u-.5),y=Math.floor(v-.5),fx=u-.5-x,fy=v-.5-y,values=[0,0,0,0]
 for(let yy=0;yy<2;yy++)for(let xx=0;xx<2;xx++){const sx=x+xx,sy=y+yy,weight=(xx?fx:1-fx)*(yy?fy:1-fy),inside=sx>=0&&sy>=0&&sx<width&&sy<height,at=(sy*width+sx)*4,alpha=inside?data[at+3]/255:mask?1:0;values[3]+=alpha*weight;for(let c=0;c<3;c++)values[c]+=(inside?data[at+c]:background)*alpha*weight}
 const alpha=Math.round(values[3]*255);return [0,1,2].map(c=>values[3]?Math.round(values[c]/values[3]):0).concat(alpha)
}
/** Single inverse map for all three working formats. HDR RGB is never clamped
 * to alpha/white; RGBA16 is quantized once after premultiplied interpolation. */
export function perspectiveCropRaster(asset:Asset,placement:Layer['transform'],corners:Extract<EditAction,{type:'document.perspective_crop'}>['corners'],width:number,height:number,sampling:Layer['transform']['sampling'],mask=false,background=0,work={samples:0}):Asset{
 const matrix=perspectiveCropMatrix(corners,width,height)
 if(width*height*sampleCost(sampling)>COMPUTE_SAMPLES)throw new EditorError('RESOURCE_LIMIT','Perspective Crop exceeds its pixel, work or 512 MiB working budget.')
 if(width*height*(asset.hdr?80:asset.deep?48:20)+countAssetBytes(asset)+perspectiveCropDecodedSourceBytes(asset,mask)>WORKING_BYTES)throw new EditorError('RESOURCE_LIMIT','Perspective Crop exceeds its pixel, work or 512 MiB working budget.')
 const nearest=sampling==='Nearest',cubic=sampling==='High quality',deep=!mask&&asset.deep,hdr=!mask&&asset.hdr,source=deep||hdr?undefined:PNG.sync.read(asset.bytes),output=hdr?new Float32Array(width*height*4):deep?new Uint16Array(width*height*4):new Uint8Array(width*height*4)
 // Preserve exact aligned identity/translation/quarter-turn samples, as the
 // existing high-depth compositor does; Mitchell is not interpolating at centers.
 const toSource=(u:number,v:number)=>{const p=mapCropPoint(matrix,u,v);return sourcePoint({transform:placement},p[0],p[1],asset.width,asset.height)},a=toSource(0,0),b=toSource(1/width,0),c=toSource(0,1/height),dx=[b[0]-a[0],b[1]-a[1]],dy=[c[0]-a[0],c[1]-a[1]],integer=(n:number)=>Math.abs(n-Math.round(n))<1e-9,unit=(v:number[])=>v.every(integer)&&Math.abs(v[0])+Math.abs(v[1])>1-1e-9&&Math.abs(v[0])+Math.abs(v[1])<1+1e-9,aligned=cubic&&Math.abs(matrix[6])+Math.abs(matrix[7])<1e-10&&a.every(integer)&&unit(dx)&&unit(dy)&&Math.abs(dx[0]*dy[0]+dx[1]*dy[1])<1e-9
 // Compose the rigid document-to-source placement with the inverse crop map
 // once. Keep the existing coordinate path for pixel values; use this matrix
 // only to derive a low-pass footprint, preserving non-minified output bits.
 const base=sourcePoint({transform:placement},0,0,asset.width,asset.height),right=sourcePoint({transform:placement},1,0,asset.width,asset.height),down=sourcePoint({transform:placement},0,1,asset.width,asset.height),ax=right[0]-base[0],ay=down[0]-base[0],bx=right[1]-base[1],by=down[1]-base[1],sourceMatrix=[ax*matrix[0]+ay*matrix[3]+base[0]*matrix[6],ax*matrix[1]+ay*matrix[4]+base[0]*matrix[7],ax*matrix[2]+ay*matrix[5]+base[0]*matrix[8],bx*matrix[0]+by*matrix[3]+base[1]*matrix[6],bx*matrix[1]+by*matrix[4]+base[1]*matrix[7],bx*matrix[2]+by*matrix[5]+base[1]*matrix[8],matrix[6],matrix[7],matrix[8]]
 const constantFootprint=cubic&&!aligned&&Math.abs(sourceMatrix[6])+Math.abs(sourceMatrix[7])<1e-12?cropSourceFootprint(sourceMatrix,width,height,.5,.5):undefined
 const baseFilter=cubic&&!aligned&&cropIsotropicAffineMinification(sourceMatrix,width,height)?'lanczos3':'mitchell'
 // Select once for the whole raster; a mixed-scale projective map must never
 // switch reconstruction families inside the image. Charge the bounded proof
 // as conservative work in addition to every actually visited source tap.
 const proveMagnification=cubic&&!aligned&&!mask
 if(proveMagnification){work.samples+=CROP_MAGNIFICATION_BOUND_PROBES;if(work.samples>COMPUTE_SAMPLES)throw new EditorError('RESOURCE_LIMIT','Perspective Crop exceeds its actual antialias sampling work budget.')}
 const filter=proveMagnification&&cropMappingIsMagnifying(sourceMatrix,width,height)?'catmull-rom-9/8':baseFilter
 if(constantFootprint&&work.samples+width*height*cropSampleTapCount(constantFootprint,filter)>COMPUTE_SAMPLES)throw new EditorError('RESOURCE_LIMIT','Perspective Crop exceeds its actual antialias sampling work budget.')
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const doc=mapCropPoint(matrix,(x+.5)/width,(y+.5)/height),[u,v]=sourcePoint({transform:placement},doc[0],doc[1],asset.width,asset.height),at=(y*width+x)*4
  const footprint=cubic&&!aligned?constantFootprint??cropSourceFootprint(sourceMatrix,width,height,(x+.5)/width,(y+.5)/height):undefined
  work.samples+=cubic&&!aligned?cropSampleTapCount(footprint,filter):nearest||aligned?1:4
  if(work.samples>COMPUTE_SAMPLES)throw new EditorError('RESOURCE_LIMIT','Perspective Crop exceeds its actual antialias sampling work budget.')
  if(deep||hdr){const data=(hdr||deep) as Float32Array|Uint16Array;let values:number[]
   if(nearest||aligned){const sx=Math.floor(u+1e-9),sy=Math.floor(v+1e-9);values=sx<0||sy<0||sx>=asset.width||sy>=asset.height?[0,0,0,0]:[...data.subarray((sy*asset.width+sx)*4,(sy*asset.width+sx)*4+4)]}
   else if(cubic)values=sampleCropBicubic(data,asset.width,asset.height,u,v,{premultiplied:true,footprint,filter})
   else values=hdr?sampleHDRBilinear(hdr,asset.width,asset.height,u,v):sampleDeepBilinear(deep as Uint16Array,asset.width,asset.height,u,v)
   if(hdr){output[at+3]=Math.max(0,Math.min(1,values[3]));for(let c=0;c<3;c++)output[at+c]=output[at+3]?values[c]:0}
   else{output[at+3]=Math.round(Math.max(0,Math.min(65535,values[3])));for(let c=0;c<3;c++)output[at+c]=Math.round(Math.max(0,Math.min(output[at+3],values[c])))}
  }else if(cubic&&!aligned){const values=sampleCropBicubic(source!.data,asset.width,asset.height,u,v,{premultiplied:false,mask,background,footprint,filter}),alpha=Math.max(0,Math.min(255,values[3]));output[at+3]=Math.round(alpha);for(let c=0;c<3;c++)output[at+c]=alpha?Math.round(Math.max(0,Math.min(alpha,values[c]))*255/alpha):0}
  else output.set(sample8(source!,u,v,nearest||aligned,mask,background),at)
 }
 if(hdr)return makeHDRAsset(asset.file,width,height,output as Float32Array)
 if(deep)return makeDeepAsset(asset.file,width,height,output as Uint16Array)
 const png=new PNG({width,height});png.data.set(output);return makeAsset(asset.file,encodeRaster(png,mask))
}
export function applyPerspectiveCrop(stage:PixelStage,action:Extract<EditAction,{type:'document.perspective_crop'}>):string{
 if(stage.manifest.vectorPaths?.some(record=>record.path.subpaths.length)||stage.manifest.layers.some(layer=>layer.frame||layer.vectorMask))throw new EditorError('UNSUPPORTED_FEATURE','Perspective Crop cannot yet preserve editable frame and vector path geometry. The original pixels and paths have been kept.');
 const {width,height,corners,sampling}=action
 perspectiveCropMatrix(corners,width,height)
 // Perspective cannot represent editable geometry or post-raster spatial effects
 // with today's rigid placements. Refuse before allocating or mutating anything.
 if(stage.manifest.layers.some(l=>l.text||l.shape))throw new EditorError('RASTERIZATION_REQUIRED','Rasterize text and shape layers before Perspective Crop.')
 if(stage.manifest.layers.some(l=>l.maskFile&&(l.maskFeather??0)>0))throw new EditorError('UNSUPPORTED_FEATURE','Set mask feather to zero before Perspective Crop. Projective feather geometry is unsupported. The document has been kept.')
 if(stage.manifest.layers.some(l=>l.isGroup||l.adjustment||l.effects))throw new EditorError('UNSUPPORTED_FEATURE','Perspective Crop currently requires raster layers without groups, adjustments or layer effects. The document has been kept.')
 if(stage.manifest.guides?.length)throw new EditorError('UNSUPPORTED_FEATURE','Remove guides before Perspective Crop. Oblique guides cannot be represented. The document has been kept.')
 const refs=stage.manifest.layers.flatMap(layer=>[{file:layer.imageFile,mask:false},{file:layer.maskFile,mask:true}].filter((ref):ref is {file:string;mask:boolean}=>!!ref.file)),pixels=width*height,sourceBytes=[...new Set(stage.assets.values())].reduce((n,a)=>n+countAssetBytes(a),0)
 let outputBytes=0,decodedSourceBytes=0
 for(const {file,mask}of refs){const asset=stage.assets.get(file);if(!asset)throw new EditorError('ASSET_NOT_FOUND','The layer raster is missing.');outputBytes+=pixels*(asset.hdr?80:asset.deep?48:20)
  // Raster operations run serially. Keep all source/output assets in the
  // estimate, plus the largest temporary decode, rather than multiplying the
  // same shared source surface by the number of layer placements.
  if(!mask||asset.width!==1||asset.height!==1)decodedSourceBytes=Math.max(decodedSourceBytes,perspectiveCropDecodedSourceBytes(asset,mask))
 }
 if(pixels*refs.length>LIMITS.maxPixels||pixels*refs.length*sampleCost(sampling)>COMPUTE_SAMPLES||sourceBytes+outputBytes+decodedSourceBytes>WORKING_BYTES)throw new EditorError('RESOURCE_LIMIT','Perspective Crop exceeds its pixel, work or 512 MiB working budget.')
 assertDeepAssetBudget(stage.assets.values(),outputBytes+decodedSourceBytes)
 const matrix=perspectiveCropMatrix(corners,width,height),originalAssets=new Map(stage.assets),work={samples:0}
 transformNamedSelections(stage.manifest,width,height,(x,y)=>mapCropPoint(matrix,x/width,y/height),sampling!=='Nearest')
 for(const layer of stage.manifest.layers){const old=structuredClone(layer.transform),maskPlacement=structuredClone(layer.maskPlacement??old)
  if(layer.imageFile){const asset=originalAssets.get(layer.imageFile)!,file=`${layer.id.toUpperCase()}.${asset.hdr?'exr':'png'}`;stage.assets.set(file,perspectiveCropRaster({...asset,file},old,corners,width,height,sampling,false,0,work));layer.imageFile=file}
  if(layer.maskFile){const asset=originalAssets.get(layer.maskFile)!,file=`${layer.id.toUpperCase()}.mask.png`;if(asset.width!==1||asset.height!==1)stage.assets.set(file,perspectiveCropRaster({...asset,file},maskPlacement,corners,width,height,sampling,true,typeof layer.photoshopMaskDefault==='number'?layer.photoshopMaskDefault:0,work));else stage.assets.set(file,{...asset,file});layer.maskFile=file;if(layer.maskPlacement)layer.maskPlacement={origin:[0,0],size:[width,height],rotation:0,flipX:false,flipY:false,sampling};invalidatePhotoshopComponent(layer,'mask')}
  layer.transform={origin:[0,0],size:[width,height],rotation:0,flipX:false,flipY:false,sampling};invalidatePhotoshopComponent(layer,'text');invalidatePhotoshopComponent(layer,'vector')
 }
 // General projective transforms turn straight horizontal/vertical guides into
 // oblique lines. Keep guides unchanged only for the exact rectangular case.

 if(stage.manifest.documentInfo){const h=matrix,a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],j=h[7],k=h[8],inverse=[e*k-f*j,c*j-b*k,b*f-c*e,f*g-d*k,a*k-c*g,c*d-a*f,d*j-e*g,b*g-a*j,a*e-b*d];stage.manifest.documentInfo=mapDocumentInfoPoints(stage.manifest.documentInfo,p=>{const q=mapCropPoint(inverse,p[0],p[1]);return [q[0]*width,q[1]*height]})}
 stage.manifest.width=width;stage.manifest.height=height;stage.selection=null
 return 'Perspective Crop'
}
