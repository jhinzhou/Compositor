/** Independent local Remove / Content-Aware Move / Red Eye operations.
 * Private RGB8 source, bounded work, no display-proxy editing or generative AI.
 * Preparation is shared by revision-checked previews and atomic Editor commits. */
import {PNG} from 'pngjs'
import {EditorError,type EditAction,type Layer,type Transform} from '../shared/contracts'
import type {Selection} from '../shared/pixel-contracts'
import {brushStrokeCoverage} from '../shared/brush-coverage'
import {compactStroke,strokeSegments} from '../shared/stroke-compaction'
import {translateSelection} from '../shared/interaction-geometry'
import {blendSampledHealing,sampleHealingDonor} from '../shared/sampled-healing'
import {documentPoint,sourcePoint,selectionCoverage,encodeRaster} from './raster-edit'
import {contentAwareFill} from './content-fill'
import {makeAsset} from './project-io'
import {layerProtected} from './layer-locks'
import {invalidatePhotoshopComponent} from './photoshop-metadata'
import type {PixelStage} from './pixel-actions'

export type RetouchToolAction=Extract<EditAction,{type:'layer.remove'|'layer.content_aware_move'|'layer.red_eye'}>
export interface RetouchToolPrepared {png:Buffer;transform:Transform;target:'image';selection:Selection|null;affectedPixels:number}
export const RETOUCH_TOOL_LIMITS={pixels:2_000_000,redEyeSourcePixels:16_000_000,work:120_000_000} as const
export interface RetouchToolOptions {signal?:AbortSignal;maximumWork?:number}
const canceled=(options:RetouchToolOptions)=>{if(options.signal?.aborted)throw new EditorError('CANCELED','Retouch was canceled.')}
function context(stage:PixelStage,action:RetouchToolAction,options:RetouchToolOptions){
 canceled(options);const layer=stage.manifest.layers.find(item=>item.id===action.layerId)
 if(!layer)throw new EditorError('LAYER_NOT_FOUND','The retouch layer no longer exists.')
 if(layerProtected(stage.manifest,layer.id))throw new EditorError('INVALID_ARGUMENT','Unlock this layer before retouching.')
 if(layer.isGroup||layer.adjustment||layer.text||layer.shape)throw new EditorError('INVALID_ARGUMENT','Choose a raster image layer to retouch.')
 const asset=layer.imageFile&&stage.assets.get(layer.imageFile)
 if(!asset)throw new EditorError('ASSET_NOT_FOUND','The retouch source image is missing.')
 if(asset.deep||asset.hdr||asset.bitDepth===16)throw new EditorError('UNSUPPORTED_FEATURE','Remove, Content-Aware Move and Red Eye currently require RGB8 source pixels. High-depth data and history have been kept.')
 const sourceLimit=action.type==='layer.red_eye'?RETOUCH_TOOL_LIMITS.redEyeSourcePixels:RETOUCH_TOOL_LIMITS.pixels
 if(asset.width*asset.height>sourceLimit)throw new EditorError('RESOURCE_LIMIT',action.type==='layer.red_eye'?'Red Eye exceeds its 16 MP source raster budget; use a smaller image.':'Retouch exceeds its 2 MP working raster budget; use a smaller image.')
 const redEyeBounds=action.type==='layer.red_eye'?redEyeSourceBounds(layer,asset.width,asset.height,action):null
 const redEyeWork=redEyeBounds?redEyeBounds[2]*redEyeBounds[3]:0
 if(redEyeWork>RETOUCH_TOOL_LIMITS.pixels)throw new EditorError('RESOURCE_LIMIT','Red Eye exceeds its 2 MP eye-region working budget; use a smaller eye rectangle.')
 const requestedBudget=options.maximumWork??RETOUCH_TOOL_LIMITS.work
 const baselineWork=action.type==='layer.red_eye'?asset.width*asset.height*2+redEyeWork*12:asset.width*asset.height*8,budget=requestedBudget-baselineWork
 if(!Number.isFinite(requestedBudget)||requestedBudget<0||requestedBudget>RETOUCH_TOOL_LIMITS.work)throw new EditorError('INVALID_ARGUMENT','Invalid retouch compute budget.')
 if(budget<0)throw new EditorError('RESOURCE_LIMIT','Retouch exceeds its compute budget.')
 const png=PNG.sync.read(asset.bytes);if(png.width!==asset.width||png.height!==asset.height)throw new EditorError('INVALID_PROJECT','The source image dimensions do not match its descriptor.')
 return {layer,asset,png,budget}
}
const inside=(stage:PixelStage,p:[number,number])=>p[0]>=0&&p[1]>=0&&p[0]<stage.manifest.width&&p[1]<stage.manifest.height
function blendFill(original:PNG,coverage:Uint8Array,opacity:number,protectAlpha:boolean,options:RetouchToolOptions,seed:number,budget:number):PNG{
 if(!coverage.some(v=>v))throw new EditorError('INVALID_ARGUMENT','The removal area has no editable pixels.')
 const filled=contentAwareFill(original,{width:original.width,height:original.height,coverage},{seed,signal:options.signal,maximumWork:budget}).png
 for(let p=0;p<coverage.length;p++){
  if(p%4096===0)canceled(options);const at=p*4,amount=coverage[p]/255*opacity
  if(!amount){filled.data.set(original.data.subarray(at,at+4),at);continue}
  const sa=filled.data[at+3]/255,da=original.data[at+3]/255,alpha=protectAlpha?da:da+(sa-da)*amount
  if(protectAlpha&&!da){filled.data.set(original.data.subarray(at,at+4),at);continue}
  for(let c=0;c<3;c++)filled.data[at+c]=Math.round(protectAlpha?original.data[at+c]+(filled.data[at+c]-original.data[at+c])*amount:alpha?(original.data[at+c]*da*(1-amount)+filled.data[at+c]*sa*amount)/alpha:original.data[at+c])
  filled.data[at+3]=protectAlpha?original.data[at+3]:Math.round(alpha*255)
 }
 return filled
}
function closedLoop(points:[number,number][],size:number):Selection|null{
 if(points.length<4||Math.hypot(points[0][0]-points.at(-1)![0],points[0][1]-points.at(-1)![1])>Math.max(2,size/2))return null
 const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),left=Math.min(...xs),top=Math.min(...ys),right=Math.max(...xs),bottom=Math.max(...ys)
 let area=0;for(let i=0,j=points.length-1;i<points.length;j=i++)area+=points[j][0]*points[i][1]-points[i][0]*points[j][1]
 if(Math.abs(area)/2<Math.max(4,size*size/4))return null
 return {inverted:false,antialiased:true,feather:0,shapes:[{kind:'polygon',operation:'replace',bounds:[left,top,right-left,bottom-top],points,feather:0}]}
}
/** Return an exact byte-preserving no-op for zero opacity/offset. No stage mutation. */
export function prepareRetouchTool(stage:PixelStage,action:RetouchToolAction,options:RetouchToolOptions={}):RetouchToolPrepared{
 const {layer,asset,png,budget}=context(stage,action,options),n=png.width*png.height,selection=stage.selection&&structuredClone(stage.selection)
 const finish=(image:PNG,nextSelection=selection):RetouchToolPrepared=>{let affectedPixels=0;for(let p=0;p<n;p++){if(p%4096===0)canceled(options);const at=p*4;if(image.data[at]!==png.data[at]||image.data[at+1]!==png.data[at+1]||image.data[at+2]!==png.data[at+2]||image.data[at+3]!==png.data[at+3])affectedPixels++}canceled(options);return {png:affectedPixels?encodeRaster(image):asset.bytes,transform:structuredClone(layer.transform),target:'image',selection:nextSelection,affectedPixels}}
 if(action.type==='layer.red_eye')return finish(redEye(png,layer,stage,action,options))
 if(action.opacity===0||action.type==='layer.content_aware_move'&&action.offset.every(value=>value===0))return {png:asset.bytes,transform:structuredClone(layer.transform),target:'image',selection,affectedPixels:0}
 const opacity=action.opacity??1,protectAlpha=action.protectAlpha!==false,coverage=new Uint8Array(n)
 if(action.type==='layer.remove'){
  const points=compactStroke(action.points,Math.min(.125,action.size*.005)),loop=action.fillClosedLoop!==false?closedLoop(points,action.size):null
  // Charge the actual bounded stroke footprint, not every image pixel times
  // every pointer sample: a small loop on a large canvas must remain usable.
  const radius=action.size/2+Math.max(layer.transform.size[0]/png.width,layer.transform.size[1]/png.height),rx=radius*png.width/layer.transform.size[0],ry=radius*png.height/layer.transform.size[1]
  let coverageWork=n
  for(const [ax,ay,bx,by] of strokeSegments(points,Math.max(8,action.size))){const a=sourcePoint(layer,ax,ay,png.width,png.height),b=sourcePoint(layer,bx,by,png.width,png.height);coverageWork+=Math.max(0,Math.min(png.width,Math.ceil(Math.max(a[0],b[0])+rx))-Math.max(0,Math.floor(Math.min(a[0],b[0])-rx)))*Math.max(0,Math.min(png.height,Math.ceil(Math.max(a[1],b[1])+ry))-Math.max(0,Math.floor(Math.min(a[1],b[1])-ry)))*(action.hardness===1?1:16)}
  if(loop){const local=points.map(p=>sourcePoint(layer,...p,png.width,png.height)),xs=local.map(p=>p[0]),ys=local.map(p=>p[1]);coverageWork+=Math.max(0,Math.min(png.width,Math.ceil(Math.max(...xs)+1))-Math.max(0,Math.floor(Math.min(...xs)-1)))*Math.max(0,Math.min(png.height,Math.ceil(Math.max(...ys)+1))-Math.max(0,Math.floor(Math.min(...ys)-1)))*points.length*16}
  if(coverageWork>budget/2)throw new EditorError('RESOURCE_LIMIT','The removal stroke exceeds its coverage budget; use a shorter stroke or smaller image.')
  coverage.set(brushStrokeCoverage({width:png.width,height:png.height,transform:layer.transform,canvasWidth:stage.manifest.width,canvasHeight:stage.manifest.height},points,action.size,action.hardness??1))
  for(let y=0;y<png.height;y++){canceled(options);for(let x=0;x<png.width;x++){const p=y*png.width+x,doc=documentPoint(layer,x+.5,y+.5,png.width,png.height);if(loop&&doc[0]>=loop.shapes[0].bounds[0]-1&&doc[1]>=loop.shapes[0].bounds[1]-1&&doc[0]<=loop.shapes[0].bounds[0]+loop.shapes[0].bounds[2]+1&&doc[1]<=loop.shapes[0].bounds[1]+loop.shapes[0].bounds[3]+1)coverage[p]=Math.max(coverage[p],Math.round(selectionCoverage(loop,...doc)*255));coverage[p]=inside(stage,doc)&&(!protectAlpha||png.data[p*4+3]>0)?Math.round(coverage[p]*selectionCoverage(stage.selection,...doc)):0}}
  return finish(blendFill(png,coverage,opacity,protectAlpha,options,action.seed??0,budget/2))
 }
 if(!stage.selection)throw new EditorError('INVALID_ARGUMENT','Create a selection before using Content-Aware Move.')
 const targetCoverage=new Uint8Array(n),donor=new Float32Array(n*4)
 for(let y=0;y<png.height;y++){canceled(options);for(let x=0;x<png.width;x++){
  const p=y*png.width+x,doc=documentPoint(layer,x+.5,y+.5,png.width,png.height),sourceDoc:[number,number]=[doc[0]-action.offset[0],doc[1]-action.offset[1]],source=sourcePoint(layer,...sourceDoc,png.width,png.height)
  coverage[p]=inside(stage,doc)&&(!protectAlpha||png.data[p*4+3]>0)?Math.round(selectionCoverage(stage.selection,...doc)*255):0
  targetCoverage[p]=inside(stage,doc)?Math.round(selectionCoverage(stage.selection,...sourceDoc)*255):0
  donor.set(inside(stage,sourceDoc)?sampleHealingDonor(png.data,png.width,png.height,...source):[0,0,0,0],p*4)
 }}
 if(!targetCoverage.some((v,p)=>v&&donor[p*4+3]>0&&(!protectAlpha||png.data[p*4+3]>0)))throw new EditorError('INVALID_ARGUMENT','The moved selection has no editable destination pixels.')
 const filled=blendFill(png,coverage,1,protectAlpha,options,action.seed??0,budget/2)
 const result=blendSampledHealing(filled.data,donor,targetCoverage,png.width,png.height,{opacity:1,adaptation:action.adaptation??.5,protectAlpha,signal:options.signal,maximumWork:budget/2})
 // Move is one composite operation. Applying opacity separately to the hole
 // repair and then the donor exposes the background twice in overlapping moves.
 if(opacity<1)for(let p=0;p<n;p++){if(p%4096===0)canceled(options);const at=p*4,da=png.data[at+3]/255,sa=result[at+3]/255,alpha=da+(sa-da)*opacity;for(let c=0;c<3;c++)result[at+c]=Math.round(protectAlpha?png.data[at+c]+(result[at+c]-png.data[at+c])*opacity:alpha?(png.data[at+c]*da*(1-opacity)+result[at+c]*sa*opacity)/alpha:png.data[at+c]);result[at+3]=protectAlpha?png.data[at+3]:Math.round(alpha*255)}
 filled.data=Buffer.from(result);return finish(filled,translateSelection(stage.selection,action.offset))
}
/** Transform all four corners of the search ellipse's conservative document
 * rectangle; a rotated/flipped layer still contains every candidate pixel. */
function redEyeSourceBounds(layer:Layer,width:number,height:number,action:Extract<RetouchToolAction,{type:'layer.red_eye'}>):[number,number,number,number]{
 const [left,top,w,h]=action.bounds,scale=.2+.3*(action.pupilSize??.5),cx=left+w/2,cy=top+h/2,rx=w*scale,ry=h*scale
 const corners=[[cx-rx,cy-ry],[cx+rx,cy-ry],[cx+rx,cy+ry],[cx-rx,cy+ry]].map(([x,y])=>sourcePoint(layer,x,y,width,height)),xs=corners.map(p=>p[0]),ys=corners.map(p=>p[1])
 const x=Math.max(0,Math.min(width,Math.floor(Math.min(...xs))-1)),y=Math.max(0,Math.min(height,Math.floor(Math.min(...ys))-1)),right=Math.max(0,Math.min(width,Math.ceil(Math.max(...xs))+1)),bottom=Math.max(0,Math.min(height,Math.ceil(Math.max(...ys))+1))
 return [x,y,Math.max(0,right-x),Math.max(0,bottom-y)]
}
function redEye(original:PNG,layer:Layer,stage:PixelStage,action:Extract<RetouchToolAction,{type:'layer.red_eye'}>,options:RetouchToolOptions):PNG{
 const [left,top,w,h]=action.bounds,center:[number,number]=[left+w/2,top+h/2],scale=.2+.3*(action.pupilSize??.5),rx=w*scale,ry=h*scale,[sx,sy,sw,sh]=redEyeSourceBounds(layer,original.width,original.height,action),candidate=new Uint8Array(sw*sh),seen=new Uint8Array(sw*sh),output=new PNG({width:original.width,height:original.height});output.data.set(original.data)
 let seed=-1,best=Infinity
 for(let y=0;y<sh;y++){canceled(options);for(let x=0;x<sw;x++){
  const p=y*sw+x,at=((sy+y)*original.width+sx+x)*4,doc=documentPoint(layer,sx+x+.5,sy+y+.5,original.width,original.height),d=((doc[0]-center[0])/rx)**2+((doc[1]-center[1])/ry)**2,r=original.data[at],g=original.data[at+1],b=original.data[at+2]
  if(d<=1&&inside(stage,doc)&&original.data[at+3]>0&&r>50&&r>Math.max(g,b)*1.5&&r-Math.max(g,b)>25){candidate[p]=1;if(d<best){best=d;seed=p}}
 }}
 if(seed<0)return output
 const queue=[seed];seen[seed]=1
 for(let index=0;index<queue.length;index++){
  if(index%4096===0)canceled(options);const p=queue[index],x=p%sw,y=Math.floor(p/sw),at=((sy+y)*original.width+sx+x)*4,doc=documentPoint(layer,sx+x+.5,sy+y+.5,original.width,original.height),amount=selectionCoverage(stage.selection,...doc)*Math.min(1,(original.data[at]-Math.max(original.data[at+1],original.data[at+2])-15)/60),darken=2*(1-(action.darkenAmount??.5)),neutral=Math.max(original.data[at+1],original.data[at+2])
  for(let c=0;c<3;c++){const corrected=Math.min(255,neutral*darken);output.data[at+c]=Math.round(original.data[at+c]+(corrected-original.data[at+c])*amount)}
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy,q=yy*sw+xx;if(xx>=0&&yy>=0&&xx<sw&&yy<sh&&candidate[q]&&!seen[q]){seen[q]=1;queue.push(q)}}
 }
 return output
}
export function applyRetouchTool(stage:PixelStage,action:RetouchToolAction):string{
 const result=prepareRetouchTool(stage,action),layer=stage.manifest.layers.find(item=>item.id===action.layerId)!,file=`${layer.id.toUpperCase()}.png`
 if(result.affectedPixels){stage.assets.set(file,makeAsset(file,result.png));layer.imageFile=file;invalidatePhotoshopComponent(layer,'text');invalidatePhotoshopComponent(layer,'vector')}
 stage.selection=result.selection
 return action.type==='layer.remove'?'Remove object':action.type==='layer.content_aware_move'?'Content-Aware Move':'Red Eye'
}
