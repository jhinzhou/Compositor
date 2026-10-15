import { PNG } from 'pngjs';
import { EditorError, BLEND_MODES, type Layer, type Manifest, type Transform } from '../shared/contracts';
import { applyDeepAdjustment, supportsHighDepthAdjustment, highDepthAdjustmentEstimate } from './high-depth-adjustment';
import { nativeAdjustmentToSpec } from '../shared/image-filters';
import { effectiveMaskPixels, effectiveMaskTransform, maskPropertyGeometry, sampleEffectiveMask, type EffectiveMask } from '../shared/mask-properties';
import { hasVisibleEffects } from '../shared/layer-effects';
import { sourcePoint } from '../shared/selection-coverage';
import { MAX_DEEP_WORKING_BYTES, MAX_DEEP_PIXELS } from '../shared/deep-pixels';
import { validateManifest } from './manifest';
import type { Asset } from './project-io';

export interface DeepCompositeImage {width:number;height:number;data:Uint16Array}
export interface DeepCompositeReason {layerId?:string;feature:string;message:string}
export interface DeepCompositeInspection {supported:boolean;reasons:DeepCompositeReason[];estimatedWorkingBytes:number;estimatedSampleWork:number}
export const DEEP_COMPOSITE_BLEND_MODES=BLEND_MODES;
const MAX_SAMPLE_WORK=240_000_000;
const clamp=(v:number,min=0,max=1)=>Math.max(min,Math.min(max,v));

/** Preflight supported visible rendering without allocating raster output or changing assets. */
export function inspectDeepComposite(manifest:Manifest,assets:ReadonlyMap<string,Asset>):DeepCompositeInspection {
 const reasons:DeepCompositeReason[]=[];const issue=(feature:string,message:string,layerId?:string)=>reasons.push({feature,message,...(layerId?{layerId}:{})});
 try{validateManifest(manifest);}catch(error){issue('manifest',error instanceof Error?error.message:String(error));return {supported:false,reasons,estimatedWorkingBytes:0,estimatedSampleWork:0};}
 const layers=new Map(manifest.layers.map(l=>[l.id,l]));const visible=(l:Layer):boolean=>{if(!l.isVisible||!l.opacity)return false;let parent=l.parentID;while(parent){const g=layers.get(parent)!;if(!g.isVisible||!g.opacity)return false;parent=g.parentID;}return true;};
 const used=new Set<string>();let bytes=manifest.width*manifest.height*48,work=0,adjustmentBytes=0;
 for(const layer of manifest.layers){if(!visible(layer))continue;
  if(!(DEEP_COMPOSITE_BLEND_MODES as readonly string[]).includes(layer.blendMode))issue('blend',`High-depth composite does not support ${layer.blendMode}.`,layer.id);
  if(layer.effects&&hasVisibleEffects(layer.effects))issue('effects','Visible raster layer effects have no high-depth composite implementation.',layer.id);
  if(layer.photoshopVectorMask)issue('vector-mask','Vector masks require an explicit supported raster mask bake before high-depth compositing.',layer.id);
  if(layer.adjustment){try{if(!supportsHighDepthAdjustment(nativeAdjustmentToSpec(layer.adjustment)))issue('adjustment','This adjustment has no high-depth composite implementation.',layer.id);else{const estimate=highDepthAdjustmentEstimate(manifest.width,manifest.height,nativeAdjustmentToSpec(layer.adjustment));work+=estimate.operations;adjustmentBytes=Math.max(adjustmentBytes,estimate.extraBytes)};}catch(error){issue(error instanceof EditorError&&error.code==='RESOURCE_LIMIT'?'budget':'adjustment',error instanceof Error?error.message:String(error),layer.id);}}
  if(layer.maskSourceID){const siblings=manifest.layers.filter(l=>l.parentID===layer.parentID),at=siblings.findIndex(l=>l.id===layer.id),previous=siblings[at-1],source=layers.get(layer.maskSourceID);if(!source?.imageFile||source.parentID!==layer.parentID||!previous||(previous.id!==source.id&&previous.maskSourceID!==source.id))issue('clipping','High-depth clipping requires a contiguous same-parent stack with a raster base.',layer.id);}
  for(const file of [layer.imageFile,layer.maskEnabled===false?undefined:layer.maskFile])if(file&&!used.has(file)){used.add(file);const asset=assets.get(file);if(!asset){issue('asset',`Missing asset ${file}.`,layer.id);continue;}bytes+=asset.deep?.byteLength??asset.width*asset.height*12;if(asset.width<1||asset.height<1||asset.width*asset.height>MAX_DEEP_PIXELS||asset.deep&&(!(asset.deep instanceof Uint16Array)||asset.deep.length!==asset.width*asset.height*4))issue('asset','Invalid or unbounded source raster.',layer.id);if(asset.bitDepth===16&&!asset.deep)issue('asset','A 16-bit asset is missing its original high-depth samples.',layer.id);}
  if(layer.maskFile&&layer.maskEnabled!==false){const asset=assets.get(layer.maskFile);if(asset){try{const geometry=maskPropertyGeometry(asset.width,asset.height,layer);bytes+=geometry.width*geometry.height*(geometry.inset?40:8);}catch(error){issue('mask',error instanceof Error?error.message:String(error),layer.id);}}}
  if(!layer.isGroup){let maskCount=layer.maskFile&&layer.maskEnabled!==false?1:0,parent=layer.parentID;while(parent){const g=layers.get(parent)!;if(g.maskFile&&g.maskEnabled!==false)maskCount++;parent=g.parentID;}work+=manifest.width*manifest.height*((layer.adjustment?4:layer.transform.sampling==='High quality'?16:layer.transform.sampling==='Smooth'?4:1)+maskCount*4);}
 }
 bytes+=adjustmentBytes;
 if(manifest.width*manifest.height>MAX_DEEP_PIXELS||bytes>MAX_DEEP_WORKING_BYTES)issue('budget','High-depth full-grid composite exceeds the 32 MP / 512 MiB working budget.');
 if(work>MAX_SAMPLE_WORK)issue('work','High-depth composite exceeds the bounded sampling-work budget.');
 return {supported:reasons.length===0,reasons,estimatedWorkingBytes:bytes,estimatedSampleWork:work};
}
function blendChannel(d:number,s:number,mode:string):number {
 const burn=(d:number,s:number)=>d>=1?1:s<=0?0:1-Math.min(1,(1-d)/s),dodge=(d:number,s:number)=>d<=0?0:s>=1?1:Math.min(1,d/(1-s));
 switch(mode){case 'Normal':return s;case 'Darken':return Math.min(d,s);case 'Multiply':return d*s;case 'Color Burn':return burn(d,s);case 'Linear Burn':return Math.max(0,d+s-1);case 'Lighten':return Math.max(d,s);case 'Screen':return d+s-d*s;case 'Color Dodge':return dodge(d,s);case 'Linear Dodge (Add)':return Math.min(1,d+s);case 'Overlay':return d<=.5?2*d*s:1-2*(1-d)*(1-s);case 'Hard Light':return s<=.5?2*d*s:1-2*(1-d)*(1-s);case 'Soft Light':return s<=.5?d-(1-2*s)*d*(1-d):d+(2*s-1)*((d<=.25?((16*d-12)*d+4)*d:Math.sqrt(d))-d);case 'Vivid Light':return s<.5?burn(d,2*s):dodge(d,2*s-1);case 'Linear Light':return clamp(d+2*s-1);case 'Pin Light':return s<.5?Math.min(d,2*s):Math.max(d,2*s-1);case 'Hard Mix':return d+s<=1.000001?0:1;case 'Difference':return Math.abs(d-s);case 'Exclusion':return d+s-2*d*s;case 'Subtract':return Math.max(0,d-s);case 'Divide':return d<=0?0:s<=0?1:Math.min(1,d/s);default:throw new EditorError('UNSUPPORTED_FEATURE',`Unsupported deep blend ${mode}.`);}
}
function blendRGB(d:number[],s:number[],mode:string):number[] {
 if(!['Hue','Saturation','Color','Luminosity'].includes(mode))return d.map((v,c)=>blendChannel(v,s[c],mode));
 const lum=(c:number[])=>.3*c[0]+.59*c[1]+.11*c[2],sat=(c:number[])=>Math.max(...c)-Math.min(...c);
 const setLum=(c:number[],l:number)=>{const delta=l-lum(c),out=c.map(v=>v+delta),low=Math.min(...out),high=Math.max(...out);if(low<0)for(let i=0;i<3;i++)out[i]=l+(out[i]-l)*l/(l-low);if(high>1)for(let i=0;i<3;i++)out[i]=l+(out[i]-l)*(1-l)/(high-l);return out.map(v=>clamp(v));};
 const setSat=(c:number[],saturation:number)=>{const order=[0,1,2].sort((a,b)=>c[a]-c[b]),out=[0,0,0],lo=order[0],mid=order[1],hi=order[2];if(c[hi]>c[lo]){out[mid]=(c[mid]-c[lo])*saturation/(c[hi]-c[lo]);out[hi]=saturation;}return out;};
 return mode==='Hue'?setLum(setSat(s,sat(d)),lum(d)):mode==='Saturation'?setLum(setSat(d,sat(s)),lum(d)):mode==='Color'?setLum(s,lum(d)):setLum(d,lum(s));
}
function composite(target:Uint16Array,source:Uint16Array,opacity:number,mode:string):void {
 for(let i=0;i<target.length;i+=4){const sa=source[i+3]/65535*opacity,da=target[i+3]/65535;if(!sa)continue;const alpha=sa+da-sa*da;
  const mixed=['Hue','Saturation','Color','Luminosity'].includes(mode)?blendRGB([0,1,2].map(c=>da?target[i+c]/(da*65535):0),[0,1,2].map(c=>source[i+3]?source[i+c]/source[i+3]:0),mode):undefined;for(let c=0;c<3;c++){const d=da?target[i+c]/(da*65535):0,s=source[i+c]/source[i+3],blended=mixed?.[c]??blendChannel(d,s,mode);target[i+c]=Math.round(clamp((1-sa)*target[i+c]/65535+(1-da)*source[i+c]/65535*opacity+sa*da*blended)*65535);}
  target[i+3]=Math.round(alpha*65535);for(let c=0;c<3;c++)target[i+c]=Math.min(target[i+c],target[i+3]);
 }
}
function mitchell(x:number):number {x=Math.abs(x);return x<1?((7*x-12)*x*x+16/3)/6:x<2?((-7/3*x+12)*x-20)*x/6+32/18:0;}
function sample(image:DeepCompositeImage,t:Transform,x:number,y:number,out:number[]):void {
 const [sx,sy]=sourcePoint({transform:t},x,y,image.width,image.height);out.fill(0);if(sx<0||sy<0||sx>=image.width||sy>=image.height)return;
 const get=(x:number,y:number,c:number)=>image.data[(clamp(y,0,image.height-1)*image.width+clamp(x,0,image.width-1))*4+c];
 if(t.sampling==='Nearest'||t.size[0]===image.width&&t.size[1]===image.height&&Math.abs(t.rotation%90)<1e-10&&Math.abs(sx-.5-Math.round(sx-.5))<1e-10&&Math.abs(sy-.5-Math.round(sy-.5))<1e-10){const at=(Math.floor(sy)*image.width+Math.floor(sx))*4;for(let c=0;c<4;c++)out[c]=image.data[at+c];return;}
 const left=Math.floor(sx-.5),top=Math.floor(sy-.5),tx=sx-.5-left,ty=sy-.5-top;
 if(t.sampling==='Smooth'){for(let c=0;c<4;c++)out[c]=get(left,top,c)*(1-tx)*(1-ty)+get(left+1,top,c)*tx*(1-ty)+get(left,top+1,c)*(1-tx)*ty+get(left+1,top+1,c)*tx*ty;}
 else{for(let yy=-1;yy<=2;yy++)for(let xx=-1;xx<=2;xx++){const weight=mitchell(xx-tx)*mitchell(yy-ty);for(let c=0;c<4;c++)out[c]+=get(left+xx,top+yy,c)*weight;}}
 out[3]=clamp(out[3],0,65535);for(let c=0;c<3;c++)out[c]=clamp(out[c],0,out[3]);
}
/** Full-grid RGBA16 composite. Unsupported appearance fails explicitly; no byte fallback here.
 * The caller performs one display/export quantization after this entire stack.
 */
export function compositeDeepDocument(manifest:Manifest,assets:ReadonlyMap<string,Asset>):DeepCompositeImage {
 const inspection=inspectDeepComposite(manifest,assets);if(!inspection.supported)throw new EditorError(inspection.reasons.some(r=>r.feature==='budget'||r.feature==='work')?'RESOURCE_LIMIT':'UNSUPPORTED_FEATURE','The document cannot currently be composited at high depth.',inspection);
 const width=manifest.width,height=manifest.height,children=new Map<string|undefined,Layer[]>();for(const layer of manifest.layers){const siblings=children.get(layer.parentID)??[];siblings.push(layer);children.set(layer.parentID,siblings);}
 const decoded=new Map<string,DeepCompositeImage>(),masks=new Map<string,{mask:EffectiveMask;placement:Transform}>();
 const image=(file:string):DeepCompositeImage=>{const known=decoded.get(file);if(known)return known;const asset=assets.get(file)!;let data:Uint16Array;if(asset.deep){data=asset.deep;for(let i=0;i<data.length;i+=4)if(data[i]>data[i+3]||data[i+1]>data[i+3]||data[i+2]>data[i+3])throw new EditorError('INVALID_PROJECT','A deep source violates premultiplied alpha.');}else{const png=PNG.sync.read(asset.bytes,{checkCRC:true});if(png.width!==asset.width||png.height!==asset.height)throw new EditorError('INVALID_PROJECT','Source PNG dimensions differ from the asset metadata.');data=new Uint16Array(png.data.length);for(let i=0;i<data.length;i+=4){const a=png.data[i+3];for(let c=0;c<3;c++)data[i+c]=Math.round(png.data[i+c]*a/255)*257;data[i+3]=a*257;}}const result={width:asset.width,height:asset.height,data};decoded.set(file,result);return result;};
 const mask=(layer:Layer,x:number,y:number):number=>{if(!layer.maskFile||layer.maskEnabled===false)return 1;let entry=masks.get(layer.id);if(!entry){const asset=assets.get(layer.maskFile)!,png=PNG.sync.read(asset.bytes,{checkCRC:true}),effective=effectiveMaskPixels({width:png.width,height:png.height,data:new Uint8ClampedArray(png.data)},layer);entry={mask:effective,placement:effectiveMaskTransform(layer.maskPlacement??layer.transform,{width:asset.width,height:asset.height},effective.inset)};masks.set(layer.id,entry);}return sampleEffectiveMask(entry.mask,entry.placement,x,y)/255;};
 const coverage=(layer:Layer,ancestors:Layer[],x:number,y:number)=>{let amount=mask(layer,x,y);for(const folder of ancestors)amount*=mask(folder,x,y);return amount;};
 const raster=(layer:Layer,ancestors:Layer[]):Uint16Array=>{const result=new Uint16Array(width*height*4),source=image(layer.imageFile!),value=[0,0,0,0];for(let y=0;y<height;y++)for(let x=0;x<width;x++){sample(source,layer.transform,x+.5,y+.5,value);const amount=coverage(layer,ancestors,x+.5,y+.5),at=(y*width+x)*4;for(let c=0;c<4;c++)result[at+c]=Math.round(value[c]*amount);}return result;};
 const adjustment=(target:Uint16Array,layer:Layer,opacity:number,ancestors:Layer[])=>{
  const spec=nativeAdjustmentToSpec(layer.adjustment),normal=layer.blendMode==='Normal',spatial=spec.kind==='gaussianBlur'||spec.kind==='motionBlur',adjusted=applyDeepAdjustment(target,width,height,spec,{preserveAlpha:!normal||!spatial});
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const at=(y*width+x)*4,alpha=target[at+3],amount=opacity*coverage(layer,ancestors,x+.5,y+.5);
   if(normal){const nextAlpha=spatial?Math.round(clamp(alpha+(adjusted[at+3]-alpha)*amount,0,65535)):alpha;for(let c=0;c<3;c++)target[at+c]=Math.round(clamp(target[at+c]+(adjusted[at+c]-target[at+c])*amount,0,nextAlpha));target[at+3]=nextAlpha}
   else {const blended=blendRGB([0,1,2].map(c=>alpha?target[at+c]/alpha:0),[0,1,2].map(c=>alpha?adjusted[at+c]/alpha:0),layer.blendMode);for(let c=0;c<3;c++)target[at+c]=Math.round(clamp(target[at+c]+(alpha*blended[c]-target[at+c])*amount,0,alpha))}
  }
 };
 const result=new Uint16Array(width*height*4);
 const walk=(target:Uint16Array,parent:string|undefined,ancestors:Layer[],ancestorOpacity:number)=>{const siblings=children.get(parent)??[];for(let index=0;index<siblings.length;index++){const layer=siblings[index];if(!layer.isVisible||!layer.opacity||layer.maskSourceID)continue;const opacity=ancestorOpacity*layer.opacity;if(layer.isGroup){walk(target,layer.id,[layer,...ancestors],opacity);continue;}if(layer.adjustment){adjustment(target,layer,opacity,ancestors);continue;}if(!layer.imageFile)continue;
   const stack:Layer[]=[];if(!layer.maskSourceID)while(siblings[index+1]?.maskSourceID===layer.id){stack.push(siblings[++index]);}
   const rendered=raster(layer,ancestors);
   if(stack.length){for(let i=0;i<rendered.length;i+=4){for(let c=0;c<4;c++)rendered[i+c]=Math.round(rendered[i+c]*opacity);}
    const baseAlpha=new Uint16Array(width*height);for(let i=0;i<rendered.length;i+=4){const a=rendered[i+3];baseAlpha[i/4]=a;for(let c=0;c<3;c++)rendered[i+c]=a?Math.min(65535,Math.round(rendered[i+c]*65535/a)):0;rendered[i+3]=65535;}
    for(const child of stack){if(!child.isVisible||!child.opacity)continue;if(child.adjustment)adjustment(rendered,child,ancestorOpacity*child.opacity,ancestors);else if(child.imageFile)composite(rendered,raster(child,ancestors),ancestorOpacity*child.opacity,child.blendMode);}
    for(let i=0;i<rendered.length;i+=4){const a=baseAlpha[i/4];for(let c=0;c<3;c++)rendered[i+c]=Math.round(rendered[i+c]*a/65535);rendered[i+3]=a;}composite(target,rendered,1,layer.blendMode);
   }else composite(target,rendered,opacity,layer.blendMode);
  }};
 walk(result,undefined,[],1);return {width,height,data:result};
}

export interface DeepCompositeRegion {x:number;y:number;width:number;height:number}
/** Readonly viewport sampling stays RGBA16; Root quantizes its returned image once. */
export function sampleDeepCompositeRegion(image:DeepCompositeImage,region:DeepCompositeRegion,width:number,height:number,sampling:Transform['sampling']='Smooth'):DeepCompositeImage {
 if(!(image.data instanceof Uint16Array)||!Number.isSafeInteger(image.width)||!Number.isSafeInteger(image.height)||image.width<1||image.height<1||image.data.length!==image.width*image.height*4||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>MAX_DEEP_PIXELS||image.data.byteLength+width*height*8>MAX_DEEP_WORKING_BYTES||![region.x,region.y,region.width,region.height].every(Number.isFinite)||region.width<=0||region.height<=0||!['Nearest','Smooth','High quality'].includes(sampling))throw new EditorError('RESOURCE_LIMIT','Invalid or unbounded deep viewport sampling.');
 const data=new Uint16Array(width*height*4),t:Transform={origin:[0,0],size:[image.width,image.height],rotation:0,flipX:false,flipY:false,sampling},value=[0,0,0,0];
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){sample(image,t,region.x+(x+.5)*region.width/width,region.y+(y+.5)*region.height/height,value);const at=(y*width+x)*4;for(let c=0;c<4;c++)data[at+c]=Math.round(value[c]);}
 return {width,height,data};
}
