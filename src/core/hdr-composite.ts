import { PNG } from 'pngjs';
import { EditorError, type Layer, type Manifest, type Transform } from '../shared/contracts';
import { applyHDRAdjustment, supportsHighDepthAdjustment, highDepthAdjustmentEstimate } from './high-depth-adjustment';
import {validateHDRPixels} from '../shared/hdr-pixels';
import { nativeAdjustmentToSpec } from '../shared/image-filters';
import { effectiveMaskPixels, effectiveMaskTransform, maskPropertyGeometry, sampleEffectiveMask, type EffectiveMask } from '../shared/mask-properties';
import { hasVisibleEffects } from '../shared/layer-effects';
import { sourcePoint } from '../shared/selection-coverage';
import { MAX_DEEP_WORKING_BYTES, MAX_DEEP_PIXELS } from '../shared/deep-pixels';
import { validateManifest } from './manifest';
import type { Asset } from './project-io';

export type HDRCompositeAsset=Asset&{hdr?:Float32Array};
export interface HDRCompositeImage {width:number;height:number;data:Float32Array}
export interface HDRCompositeReason {layerId?:string;feature:string;message:string}
export interface HDRCompositeInspection {supported:boolean;reasons:HDRCompositeReason[];estimatedWorkingBytes:number;estimatedSampleWork:number}
export const HDR_COMPOSITE_BLEND_MODES=['Normal','Multiply','Darken','Lighten','Linear Dodge (Add)','Difference'] as const;
const MAX_SAMPLE_WORK=240_000_000;
const clamp=(v:number,min=0,max=1)=>Math.max(min,Math.min(max,v));

/** Preflight supported visible rendering without allocating raster output or changing assets. */
export function inspectHDRComposite(manifest:Manifest,assets:ReadonlyMap<string,HDRCompositeAsset>):HDRCompositeInspection {
 const reasons:HDRCompositeReason[]=[];const issue=(feature:string,message:string,layerId?:string)=>reasons.push({feature,message,...(layerId?{layerId}:{})});
 try{validateManifest(manifest);}catch(error){issue('manifest',error instanceof Error?error.message:String(error));return {supported:false,reasons,estimatedWorkingBytes:0,estimatedSampleWork:0};}
 const layers=new Map(manifest.layers.map(l=>[l.id,l]));const visible=(l:Layer):boolean=>{if(!l.isVisible||!l.opacity)return false;let parent=l.parentID;while(parent){const g=layers.get(parent)!;if(!g.isVisible||!g.opacity)return false;parent=g.parentID;}return true;};
 // A plain stack streams each raster into the output. Clipping keeps one
 // base surface plus its alpha plane; adjustments retain their conservative
 // scratch estimate until their own kernels expose a tighter lifetime bound.
 const hasAdjustment=manifest.layers.some(layer=>visible(layer)&&!!layer.adjustment),hasClipping=manifest.layers.some(layer=>visible(layer)&&!!layer.maskSourceID);
 const surfaceBytes=hasAdjustment?96:16+(hasClipping?20:0);
 const used=new Set<string>();let bytes=manifest.width*manifest.height*surfaceBytes,work=0,adjustmentBytes=0;
 for(const layer of manifest.layers){if(!visible(layer))continue;
  if(!(HDR_COMPOSITE_BLEND_MODES as readonly string[]).includes(layer.blendMode))issue('blend',`HDR composite does not support ${layer.blendMode}.`,layer.id);
  if(layer.effects&&hasVisibleEffects(layer.effects))issue('effects','Visible raster layer effects have no HDR composite implementation.',layer.id);
  if(layer.photoshopVectorMask)issue('vector-mask','Vector masks require an explicit supported raster mask bake before HDR compositing.',layer.id);
  if(layer.adjustment){try{if(!supportsHighDepthAdjustment(nativeAdjustmentToSpec(layer.adjustment)))issue('adjustment','This adjustment has no HDR composite implementation.',layer.id);else{const estimate=highDepthAdjustmentEstimate(manifest.width,manifest.height,nativeAdjustmentToSpec(layer.adjustment));work+=estimate.operations;adjustmentBytes=Math.max(adjustmentBytes,estimate.extraBytes)};}catch(error){issue(error instanceof EditorError&&error.code==='RESOURCE_LIMIT'?'budget':'adjustment',error instanceof Error?error.message:String(error),layer.id);}}
  if(layer.maskSourceID){const siblings=manifest.layers.filter(l=>l.parentID===layer.parentID),at=siblings.findIndex(l=>l.id===layer.id),previous=siblings[at-1],source=layers.get(layer.maskSourceID);if(!source?.imageFile||source.parentID!==layer.parentID||!previous||(previous.id!==source.id&&previous.maskSourceID!==source.id))issue('clipping','HDR clipping requires a contiguous same-parent stack with a raster base.',layer.id);}
  for(const file of [layer.imageFile,layer.maskEnabled===false?undefined:layer.maskFile])if(file&&!used.has(file)){used.add(file);const asset=assets.get(file);if(!asset){issue('asset',`Missing asset ${file}.`,layer.id);continue;}bytes+=asset.bytes.length+(asset.displayBytes?.length??0);bytes+=asset.hdr?.byteLength??(asset.deep?asset.deep.byteLength+asset.width*asset.height*16:asset.width*asset.height*20);if(asset.width<1||asset.height<1||asset.width*asset.height>MAX_DEEP_PIXELS||asset.deep&&(!(asset.deep instanceof Uint16Array)||asset.deep.length!==asset.width*asset.height*4))issue('asset','Invalid or unbounded source raster.',layer.id);if(asset.hdr){try{validateHDRPixels(asset.hdr,asset.width,asset.height,0)}catch(error){issue('asset',error instanceof Error?error.message:String(error),layer.id)}}if(asset.bitDepth===16&&!asset.deep&&!asset.hdr)issue('asset','A 16-bit asset is missing its original high-depth samples.',layer.id);}
  if(layer.maskFile&&layer.maskEnabled!==false){const asset=assets.get(layer.maskFile);if(asset){try{const geometry=maskPropertyGeometry(asset.width,asset.height,layer);bytes+=geometry.width*geometry.height*(geometry.inset?40:8);}catch(error){issue('mask',error instanceof Error?error.message:String(error),layer.id);}}}
  if(!layer.isGroup){let maskCount=layer.maskFile&&layer.maskEnabled!==false?1:0,parent=layer.parentID;while(parent){const g=layers.get(parent)!;if(g.maskFile&&g.maskEnabled!==false)maskCount++;parent=g.parentID;}work+=manifest.width*manifest.height*((layer.adjustment?4:layer.transform.sampling==='High quality'?16:layer.transform.sampling==='Smooth'?4:1)+maskCount*4);}
 }
 bytes+=adjustmentBytes;
 if(manifest.width*manifest.height>MAX_DEEP_PIXELS||bytes>MAX_DEEP_WORKING_BYTES)issue('budget','HDR full-grid composite exceeds the 32 MP / 512 MiB working budget.');
 if(work>MAX_SAMPLE_WORK)issue('work','HDR composite exceeds the bounded sampling-work budget.');
 return {supported:reasons.length===0,reasons,estimatedWorkingBytes:bytes,estimatedSampleWork:work};
}
const F=Math.fround;
function blendChannel(d:number,s:number,mode:string):number {switch(mode){case 'Normal':return s;case 'Multiply':return d*s;case 'Darken':return Math.min(d,s);case 'Lighten':return Math.max(d,s);case 'Linear Dodge (Add)':return d+s;case 'Difference':return Math.abs(d-s);default:throw new EditorError('UNSUPPORTED_FEATURE',`HDR blend ${mode} has no verified extended-space implementation.`);}}
function compositePixel(target:Float32Array,index:number,source:ArrayLike<number>,sourceIndex:number,opacity:number,mode:string):void {
 const sourceAlpha=source[sourceIndex+3],sa=sourceAlpha*opacity,da=target[index+3];if(!sa)return;
 const alpha=sa+da-sa*da;
 for(let c=0;c<3;c++){
  const d=da?target[index+c]/da:0,s=source[sourceIndex+c]/sourceAlpha,blended=blendChannel(d,s,mode);
  target[index+c]=F((1-sa)*target[index+c]+(1-da)*source[sourceIndex+c]*opacity+sa*da*blended);
  if(!Number.isFinite(target[index+c]))throw new EditorError('RESOURCE_LIMIT','HDR blending exceeds finite Float32 values.');
 }
 target[index+3]=F(clamp(alpha));if(!target[index+3])target.fill(0,index,index+3);
}
function composite(target:Float32Array,source:Float32Array,opacity:number,mode:string):void {
 for(let i=0;i<target.length;i+=4)compositePixel(target,i,source,i,opacity,mode);
}
function mitchell(x:number):number {x=Math.abs(x);return x<1?((7*x-12)*x*x+16/3)/6:x<2?((-7/3*x+12)*x-20)*x/6+32/18:0;}
function sample(image:HDRCompositeImage,t:Transform,x:number,y:number,out:number[]):void {
 const [sx,sy]=sourcePoint({transform:t},x,y,image.width,image.height);out.fill(0);if(sx<0||sy<0||sx>=image.width||sy>=image.height)return;
 const get=(x:number,y:number,c:number)=>image.data[(clamp(y,0,image.height-1)*image.width+clamp(x,0,image.width-1))*4+c];
 if(t.sampling==='Nearest'||t.size[0]===image.width&&t.size[1]===image.height&&Math.abs(t.rotation%90)<1e-10&&Math.abs(sx-.5-Math.round(sx-.5))<1e-10&&Math.abs(sy-.5-Math.round(sy-.5))<1e-10){const at=(Math.floor(sy)*image.width+Math.floor(sx))*4;for(let c=0;c<4;c++)out[c]=image.data[at+c];return;}
 const left=Math.floor(sx-.5),top=Math.floor(sy-.5),tx=sx-.5-left,ty=sy-.5-top;
 if(t.sampling==='Smooth'){for(let c=0;c<4;c++)out[c]=get(left,top,c)*(1-tx)*(1-ty)+get(left+1,top,c)*tx*(1-ty)+get(left,top+1,c)*(1-tx)*ty+get(left+1,top+1,c)*tx*ty;}
 else{for(let yy=-1;yy<=2;yy++)for(let xx=-1;xx<=2;xx++){const weight=mitchell(xx-tx)*mitchell(yy-ty);for(let c=0;c<4;c++)out[c]+=get(left+xx,top+yy,c)*weight;}}
 out[3]=clamp(out[3]);if(!out[3])for(let c=0;c<3;c++)out[c]=0;
}
/** Full-grid Float32 HDR composite. Unsupported appearance fails explicitly; no UNORM or byte fallback here.
 * The caller performs one display/export quantization after this entire stack.
 */
export function compositeHDRDocument(manifest:Manifest,assets:ReadonlyMap<string,HDRCompositeAsset>):HDRCompositeImage {
 const inspection=inspectHDRComposite(manifest,assets);if(!inspection.supported)throw new EditorError(inspection.reasons.some(r=>r.feature==='budget'||r.feature==='work')?'RESOURCE_LIMIT':'UNSUPPORTED_FEATURE','The document cannot currently be composited at HDR precision.',inspection);
 const width=manifest.width,height=manifest.height,children=new Map<string|undefined,Layer[]>();for(const layer of manifest.layers){const siblings=children.get(layer.parentID)??[];siblings.push(layer);children.set(layer.parentID,siblings);}
 const decoded=new Map<string,HDRCompositeImage>(),masks=new Map<string,{mask:EffectiveMask;placement:Transform}>();
 const image=(file:string):HDRCompositeImage=>{const known=decoded.get(file);if(known)return known;const asset=assets.get(file)!;let data:Float32Array;if(asset.hdr){data=asset.hdr;validateHDRPixels(data,asset.width,asset.height,0);}else if(asset.deep){for(let i=0;i<asset.deep.length;i+=4)if(asset.deep[i]>asset.deep[i+3]||asset.deep[i+1]>asset.deep[i+3]||asset.deep[i+2]>asset.deep[i+3])throw new EditorError('INVALID_PROJECT','A UNORM16 source violates premultiplied alpha.');data=Float32Array.from(asset.deep,value=>value/65535);}else{const png=PNG.sync.read(asset.bytes,{checkCRC:true});if(png.width!==asset.width||png.height!==asset.height)throw new EditorError('INVALID_PROJECT','Source PNG dimensions differ from the asset metadata.');data=new Float32Array(png.data.length);for(let i=0;i<data.length;i+=4){const a=png.data[i+3];for(let c=0;c<3;c++)data[i+c]=Math.round(png.data[i+c]*a/255)/255;data[i+3]=a/255;}}const result={width:asset.width,height:asset.height,data};decoded.set(file,result);return result;};
 const mask=(layer:Layer,x:number,y:number):number=>{if(!layer.maskFile||layer.maskEnabled===false)return 1;let entry=masks.get(layer.id);if(!entry){const asset=assets.get(layer.maskFile)!,png=PNG.sync.read(asset.bytes,{checkCRC:true}),effective=effectiveMaskPixels({width:png.width,height:png.height,data:new Uint8ClampedArray(png.data)},layer);entry={mask:effective,placement:effectiveMaskTransform(layer.maskPlacement??layer.transform,{width:asset.width,height:asset.height},effective.inset)};masks.set(layer.id,entry);}return sampleEffectiveMask(entry.mask,entry.placement,x,y)/255;};
 const coverage=(layer:Layer,ancestors:Layer[],x:number,y:number)=>{let amount=mask(layer,x,y);for(const folder of ancestors)amount*=mask(folder,x,y);return amount;};
 const raster=(layer:Layer,ancestors:Layer[]):Float32Array=>{const result=new Float32Array(width*height*4),source=image(layer.imageFile!),value=[0,0,0,0];for(let y=0;y<height;y++)for(let x=0;x<width;x++){sample(source,layer.transform,x+.5,y+.5,value);const amount=coverage(layer,ancestors,x+.5,y+.5),at=(y*width+x)*4;for(let c=0;c<4;c++)result[at+c]=F(value[c]*amount);}return result;};
 // Stream non-clipped rasters without a second document-sized Float32 array.
 // Preserve the exact Float32 rounding previously performed by raster().
 const compositeRaster=(target:Float32Array,layer:Layer,ancestors:Layer[],opacity:number)=>{
  const source=image(layer.imageFile!),t=layer.transform;
  if(source.width===width&&source.height===height&&t.origin[0]===0&&t.origin[1]===0&&t.size[0]===width&&t.size[1]===height&&t.rotation===0&&!t.flipX&&!t.flipY&&(!layer.maskFile||layer.maskEnabled===false)&&ancestors.every(folder=>!folder.maskFile||folder.maskEnabled===false)){
   composite(target,source.data,opacity,layer.blendMode);return;
  }
  const value=[0,0,0,0];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   sample(source,t,x+.5,y+.5,value);const amount=coverage(layer,ancestors,x+.5,y+.5);
   for(let c=0;c<4;c++)value[c]=F(value[c]*amount);
   compositePixel(target,(y*width+x)*4,value,0,opacity,layer.blendMode);
  }
 };
 const adjustment=(target:Float32Array,layer:Layer,opacity:number,ancestors:Layer[])=>{
  const spec=nativeAdjustmentToSpec(layer.adjustment),normal=layer.blendMode==='Normal',spatial=spec.kind==='gaussianBlur'||spec.kind==='motionBlur',adjusted=applyHDRAdjustment(target,width,height,spec,{preserveAlpha:!normal||!spatial});
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const at=(y*width+x)*4,alpha=target[at+3],amount=opacity*coverage(layer,ancestors,x+.5,y+.5);
   if(normal){for(let c=0;c<(spatial?4:3);c++)target[at+c]=F(target[at+c]+(adjusted[at+c]-target[at+c])*amount)}
   else for(let c=0;c<3;c++){const value=alpha*blendChannel(alpha?target[at+c]/alpha:0,alpha?adjusted[at+c]/alpha:0,layer.blendMode);target[at+c]=F(target[at+c]+(value-target[at+c])*amount)}
  }
 };
 const result=new Float32Array(width*height*4);
 const walk=(target:Float32Array,parent:string|undefined,ancestors:Layer[],ancestorOpacity:number)=>{const siblings=children.get(parent)??[];for(let index=0;index<siblings.length;index++){const layer=siblings[index];if(!layer.isVisible||!layer.opacity||layer.maskSourceID)continue;const opacity=ancestorOpacity*layer.opacity;if(layer.isGroup){walk(target,layer.id,[layer,...ancestors],opacity);continue;}if(layer.adjustment){adjustment(target,layer,opacity,ancestors);continue;}if(!layer.imageFile)continue;
   const stack:Layer[]=[];if(!layer.maskSourceID)while(siblings[index+1]?.maskSourceID===layer.id){stack.push(siblings[++index]);}
   if(!stack.length){compositeRaster(target,layer,ancestors,opacity);continue;}
   const rendered=raster(layer,ancestors);
   if(stack.length){for(let i=0;i<rendered.length;i+=4){for(let c=0;c<4;c++)rendered[i+c]=F(rendered[i+c]*opacity);}
    const baseAlpha=new Float32Array(width*height);for(let i=0;i<rendered.length;i+=4){const a=rendered[i+3];baseAlpha[i/4]=a;for(let c=0;c<3;c++)rendered[i+c]=a?F(rendered[i+c]/a):0;rendered[i+3]=1;}
    for(const child of stack){if(!child.isVisible||!child.opacity)continue;if(child.adjustment)adjustment(rendered,child,ancestorOpacity*child.opacity,ancestors);else if(child.imageFile)compositeRaster(rendered,child,ancestors,ancestorOpacity*child.opacity);}
    for(let i=0;i<rendered.length;i+=4){const a=baseAlpha[i/4];for(let c=0;c<3;c++)rendered[i+c]=F(rendered[i+c]*a);rendered[i+3]=a;}composite(target,rendered,1,layer.blendMode);
   }
  }};
 walk(result,undefined,[],1);validateHDRPixels(result,width,height,0);return {width,height,data:result};
}

export interface HDRCompositeRegion {x:number;y:number;width:number;height:number}
/** Readonly viewport sampling stays Float32 HDR; Root quantizes its returned image once. */
export function sampleHDRCompositeRegion(image:HDRCompositeImage,region:HDRCompositeRegion,width:number,height:number,sampling:Transform['sampling']='Smooth'):HDRCompositeImage {
 if(!(image.data instanceof Float32Array)||!Number.isSafeInteger(image.width)||!Number.isSafeInteger(image.height)||image.width<1||image.height<1||image.data.length!==image.width*image.height*4||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>MAX_DEEP_PIXELS||image.data.byteLength+width*height*16>MAX_DEEP_WORKING_BYTES||![region.x,region.y,region.width,region.height].every(Number.isFinite)||region.width<=0||region.height<=0||!['Nearest','Smooth','High quality'].includes(sampling))throw new EditorError('RESOURCE_LIMIT','Invalid or unbounded HDR viewport sampling.');
 validateHDRPixels(image.data,image.width,image.height,0);const data=new Float32Array(width*height*4),t:Transform={origin:[0,0],size:[image.width,image.height],rotation:0,flipX:false,flipY:false,sampling},value=[0,0,0,0];
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){sample(image,t,region.x+(x+.5)*region.width/width,region.y+(y+.5)*region.height/height,value);const at=(y*width+x)*4;for(let c=0;c<4;c++)data[at+c]=F(value[c]);}
 return {width,height,data};
}
