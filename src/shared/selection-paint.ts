import {brushStrokeCoverage} from './brush-coverage'
import {prepareBrushStroke} from './brush-dynamics'
import {selectionCoverage} from './selection-coverage'
import {LIMITS} from './limits'
import type {Selection} from './pixel-contracts'

export interface SelectionPaint {
 points:[number,number][];size:number;hardness:number;opacity:number;value:number
 tip?:'brush'|'pencil';initial:'empty'|'all';smoothing?:number;flow?:number;spacing?:number;brushModel?:'compositor'|'photoshop';pressures?:number[];pressureSize?:boolean;pressureOpacity?:boolean
}
/** Paint a gray channel, independent of image/layer masks. Freeze soft and inverted
 * selections into document pixels so a new stroke cannot discard their feather. */
export function paintSelection(previous:Selection|null|undefined,width:number,height:number,stroke:SelectionPaint):Selection {
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>64_000_000)throw Error('Selection painting exceeds the 64 MP coverage budget.')
 const prepared=prepareBrushStroke(stroke.points,stroke.size,stroke.smoothing??0,stroke.pressures)
 const tip=brushStrokeCoverage({width,height,transform:{origin:[0,0],size:[width,height],rotation:0,flipX:false,flipY:false,sampling:'Nearest'},canvasWidth:width,canvasHeight:height},prepared.points,stroke.size,stroke.hardness,{flow:stroke.flow,spacing:stroke.spacing,brushModel:stroke.brushModel,tip:stroke.tip,pressures:prepared.pressures,pressureSize:stroke.pressureSize,pressureOpacity:stroke.pressureOpacity})
 const runs:[number,number,number,number][]=[],initial=stroke.initial==='all'?1:0
 const sample=(x:number,y:number)=>{const before=previous?selectionCoverage(previous,x+.5,y+.5):initial,alpha=tip[y*width+x]/255*stroke.opacity;return Math.round(255*(before+(stroke.value-before)*alpha))}
 for(let y=0;y<height;y++)for(let x=0;x<width;){const start=x,value=sample(x++,y);while(x<width&&sample(x,y)===value)x++;if(value)runs.push([y,start,x-start,value]);if(runs.length>100_000)throw Error('Selection painting exceeds the 100,000 coverage run budget.')}
 return {shapes:[{kind:'raster',operation:'replace',bounds:[0,0,width,height],feather:0,raster:{width,height,transform:{origin:[0,0],size:[width,height],rotation:0,flipX:false,flipY:false},runs}}],inverted:false,antialiased:true,feather:0,canvasSize:[width,height]}
}

export function fillSelection(previous:Selection|null|undefined,width:number,height:number,value:number,opacity=1):Selection {
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>64_000_000)throw Error('Selection painting exceeds the 64 MP coverage budget.')
 const runs:[number,number,number,number][]=[]
 const sample=(x:number,y:number)=>Math.round(255*(selectionCoverage(previous,x+.5,y+.5)*(1-opacity)+value*opacity))
 for(let y=0;y<height;y++)for(let x=0;x<width;){const start=x,gray=sample(x++,y);while(x<width&&sample(x,y)===gray)x++;if(gray)runs.push([y,start,x-start,gray]);if(runs.length>100_000)throw Error('Selection painting exceeds the 100,000 coverage run budget.')}
 return {shapes:[{kind:'raster',operation:'replace',bounds:[0,0,width,height],feather:0,raster:{width,height,transform:{origin:[0,0],size:[width,height],rotation:0,flipX:false,flipY:false},runs}}],inverted:false,antialiased:true,feather:0,canvasSize:[width,height]}
}
