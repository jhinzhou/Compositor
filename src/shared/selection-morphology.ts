import {selectionGeometryBounds} from './selection-bounds'
import {EditorError} from './contracts'
import type {Selection} from './pixel-contracts'
import {selectionGeometryCoverage} from './selection-coverage'

// Exact squared Euclidean distance transform, separable lower envelopes of
// parabolas (Felzenszwalb/Huttenlocher). The doubled grid records both ends and
// the midpoint of every pixel-path boundary segment, so document pixel centers
// measure their distance to the segment rather than to a square kernel.
function distanceTransform(values:Float64Array,width:number,height:number):void {
 const max=Math.max(width,height),v=new Int32Array(max),z=new Float64Array(max+1),f=new Float64Array(max),d=new Float64Array(max)
 function line(length:number):void{
  let k=0;v[0]=0;z[0]=-Infinity;z[1]=Infinity
  for(let q=1;q<length;q++){let s=0;do{s=((f[q]+q*q)-(f[v[k]]+v[k]*v[k]))/(2*(q-v[k]));if(s<=z[k])k--;else break}while(k>=0);if(k<0){k=0;v[0]=q;z[0]=-Infinity;z[1]=Infinity}else{k++;v[k]=q;z[k]=s;z[k+1]=Infinity}}
  k=0;for(let q=0;q<length;q++){while(z[k+1]<q)k++;d[q]=(q-v[k])**2+f[v[k]]}
 }
 for(let y=0;y<height;y++){for(let x=0;x<width;x++)f[x]=values[y*width+x];line(width);for(let x=0;x<width;x++)values[y*width+x]=d[x]}
 for(let x=0;x<width;x++){for(let y=0;y<height;y++)f[y]=values[y*width+x];line(height);for(let y=0;y<height;y++)values[y*width+x]=d[y]}
}
export function roundedMorphCoverage(input:Uint8Array,width:number,height:number,operation:'expand'|'contract',amount:number,antialiased=false):Uint8Array {
 if(!amount)return input.slice()
 const gw=width*2+1,gh=height*2+1
 if(gw*gh>100_000_000)throw new EditorError('RESOURCE_LIMIT','Rounded selection modification exceeds the distance-grid budget.')
 const distance=new Float64Array(gw*gh);distance.fill(1e15)
 const selected=(x:number,y:number)=>x>=0&&y>=0&&x<width&&y<height&&input[y*width+x]>=128
 function edge(x:number,y:number,vertical:boolean):void {for(let t=0;t<=2;t++)distance[(y+(vertical?t:0))*gw+x+(vertical?0:t)]=0}
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(selected(x,y)){if(!selected(x,y-1))edge(x*2,y*2,false);if(!selected(x,y+1))edge(x*2,(y+1)*2,false);if(!selected(x-1,y))edge(x*2,y*2,true);if(!selected(x+1,y))edge((x+1)*2,y*2,true)}
 distanceTransform(distance,gw,gh)
 const result=new Uint8Array(input.length)
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const d=Math.sqrt(distance[(y*2+1)*gw+x*2+1])/2*(selected(x,y)?-1:1),signed=operation==='expand'?d-amount:d+amount;result[y*width+x]=antialiased?Math.round(255*Math.max(0,Math.min(1,.5-signed))):signed<0?255:0}
 return result
}
export function morphDocumentSelection(selection:Selection,width:number,height:number,operation:'expand'|'contract',amount:number):Selection {
 if(!Number.isFinite(amount)||amount<0||amount>500)throw new EditorError('INVALID_ARGUMENT','Selection expand/contract amount must be between 0 and 500.')
 const [left,top,w,h]=selectionGeometryBounds(selection,width,height,amount+1)
 if(w*h>25_000_000)throw new EditorError('RESOURCE_LIMIT','Rounded selection modification exceeds the coverage budget.')
 if(!w||!h)return {...selection,inverted:false,shapes:[],canvasSize:[width,height]}
 const coverage=new Uint8Array(w*h)
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)coverage[y*w+x]=selectionGeometryCoverage(selection,left+x+.5,top+y+.5)>=.5?255:0
 const output=roundedMorphCoverage(coverage,w,h,operation,amount,selection.antialiased!==false),runs:[number,number,number,number][]=[]
 for(let y=0;y<h;y++)for(let x=0;x<w;){const start=x,value=output[y*w+x];while(x<w&&output[y*w+x]===value)x++;if(value)runs.push([y,start,x-start,value]);if(runs.length>100_000)throw new EditorError('RESOURCE_LIMIT','Modified selection exceeds the coverage run budget.')}
 return {inverted:false,antialiased:selection.antialiased,featherModel:selection.featherModel,feather:selection.feather??Math.max(0,...selection.shapes.map(s=>s.feather)),canvasSize:[width,height],shapes:[{kind:'raster',operation:'replace',feather:0,bounds:[left,top,w,h],raster:{width:w,height:h,transform:{origin:[left,top],size:[w,h],rotation:0,flipX:false,flipY:false},runs}}]}
}
