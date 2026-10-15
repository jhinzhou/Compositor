import {EditorError} from '../shared/contracts'
import type {PixelPoint,RGBAImage,RasterSelection} from './selection-retouch'

export const IMAGE_SELECTION_LIMITS = Object.freeze({pixels:16_000_000,points:4096,seedVisits:4_000_000,neighbours:64_000_000,modelComparisons:128_000_000,segmentPixels:262_144,searchPixels:4_000_000,pathPoints:100_000})
function argument(value:number,min:number,max:number,label:string):number {
 if(!Number.isFinite(value)||value<min||value>max)throw new EditorError('INVALID_ARGUMENT',`${label} is outside its supported range.`)
 return value
}
function check(image:RGBAImage,points:PixelPoint[]):number {
 const pixels=image.width*image.height
 if(!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<1||image.height<1||pixels>IMAGE_SELECTION_LIMITS.pixels)throw new EditorError('RESOURCE_LIMIT','Image-driven selection supports up to 16 MP per sample.')
 if(image.data.length!==pixels*4)throw new EditorError('INVALID_ARGUMENT','The image-driven selection sample has invalid RGBA data.')
 if(!points.length||points.length>IMAGE_SELECTION_LIMITS.points)throw new EditorError('INVALID_ARGUMENT','Image-driven selection requires between 1 and 4096 points.')
 for(const point of points){if(point.length!==2)throw new EditorError('INVALID_ARGUMENT','A selection point requires two coordinates.');argument(point[0],0,image.width-Number.EPSILON,'Selection X');argument(point[1],0,image.height-Number.EPSILON,'Selection Y');if(point[0]>=image.width||point[1]>=image.height)throw new EditorError('INVALID_ARGUMENT','Selection points must lie inside the image.')}
 return pixels
}
function difference(image:RGBAImage,a:number,b:number):number {
 const x=a*4,y=b*4,aa=image.data[x+3],ba=image.data[y+3]
 // Alpha is part of the barrier. Hidden RGB below zero alpha never influences it.
 let result=Math.abs(aa-ba)
 for(let c=0;c<3;c++)result=Math.max(result,Math.abs(image.data[x+c]*aa/255-image.data[y+c]*ba/255))
 return result
}
export interface QuickSelectionOptions {size:number;tolerance?:number;edgeSensitivity?:number;antialiased?:boolean}
/** Brush footprints train the foreground model and seed a connected adaptive
 * region. Growth depends on image colour and local boundaries, not brush opacity
 * or the first seed alone. The RGBA sample is read-only. */
export function quickSelection(image:RGBAImage,points:PixelPoint[],options:QuickSelectionOptions):RasterSelection {
 const pixels=check(image,points),radius=argument(options.size,1,4096,'Quick Selection size')/2,tolerance=argument(options.tolerance??32,0,255,'Quick Selection tolerance'),edgeSensitivity=argument(options.edgeSensitivity??.65,0,1,'Edge sensitivity')
 const stamps:PixelPoint[]=[]
 for(let index=0;index<points.length;index++){
  const a=points[Math.max(0,index-1)],b=points[index],steps=index?Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/Math.max(1,radius/2))):1
  if(stamps.length+steps>4096)throw new EditorError('RESOURCE_LIMIT','Quick Selection exceeds the brush sample budget.')
  for(let step=1;step<=steps;step++)stamps.push([a[0]+(b[0]-a[0])*step/steps,a[1]+(b[1]-a[1])*step/steps])
 }
 let visits=0
 for(const [x,y] of stamps){visits+=(Math.min(image.width,Math.ceil(x+radius))-Math.max(0,Math.floor(x-radius)))*(Math.min(image.height,Math.ceil(y+radius))-Math.max(0,Math.floor(y-radius)));if(visits>IMAGE_SELECTION_LIMITS.seedVisits)throw new EditorError('RESOURCE_LIMIT','Quick Selection exceeds the brush footprint budget.')}
 const coverage=new Uint8Array(pixels),queue=new Uint32Array(pixels),palette:number[]=[];let tail=0
 for(const [sx,sy] of stamps)for(let y=Math.max(0,Math.floor(sy-radius));y<Math.min(image.height,Math.ceil(sy+radius));y++)for(let x=Math.max(0,Math.floor(sx-radius));x<Math.min(image.width,Math.ceil(sx+radius));x++){
  const index=y*image.width+x
  if(coverage[index]||Math.hypot(x+.5-sx,y+.5-sy)>radius||!image.data[index*4+3])continue
  coverage[index]=255;queue[tail++]=index
  if(!palette.length||palette.every(reference=>difference(image,index,reference)>Math.max(4,tolerance/2))){if(palette.length<32)palette.push(index)}
 }
 if(!tail)return {width:image.width,height:image.height,coverage}
 // Frontier colours may vary gradually, but cannot drift arbitrarily far from
 // the colours actually painted. Strong colour/alpha edges stop propagation.
 const edgeLimit=Math.max(1,(1-edgeSensitivity)*96+tolerance*.2),modelLimit=Math.max(1,tolerance),driftLimit=Math.max(2,tolerance*1.75)
 const seen=coverage.slice();let head=0,work=0,comparisons=0
 while(head<tail){const current=queue[head++],x=current%image.width,y=Math.floor(current/image.width)
  for(const next of [x?current-1:-1,x+1<image.width?current+1:-1,y?current-image.width:-1,y+1<image.height?current+image.width:-1]){
   if(++work>IMAGE_SELECTION_LIMITS.neighbours)throw new EditorError('RESOURCE_LIMIT','Quick Selection exceeds the region growth budget.')
   if(next<0||seen[next])continue
   // A rejected candidate must remain eligible from another, matching frontier.
   if(!image.data[next*4+3]){seen[next]=1;continue}
   const local=difference(image,current,next);if(local>edgeLimit)continue
   let model=Infinity
   for(const reference of palette){if(++comparisons>IMAGE_SELECTION_LIMITS.modelComparisons)throw new EditorError('RESOURCE_LIMIT','Quick Selection exceeds the colour comparison budget.');model=Math.min(model,difference(image,next,reference));if(model<=modelLimit)break}
   if(local>edgeLimit||!(model<=modelLimit||local<=Math.max(1,tolerance*.35)&&model<=driftLimit))continue
   seen[next]=1;coverage[next]=255;queue[tail++]=next
  }
 }
 if(options.antialiased){
  const soft=coverage.slice()
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){
   const at=y*image.width+x;if(!image.data[at*4+3])continue
   // Interior coverage is already constant. Avoid colour comparisons over the
   // whole selected region; only its one-pixel boundary needs filtering.
   let boundary=false
   for(let dy=-1;dy<=1&&!boundary;dy++)for(let dx=-1;dx<=1;dx++){
    const xx=Math.max(0,Math.min(image.width-1,x+dx)),yy=Math.max(0,Math.min(image.height-1,y+dy))
    if(coverage[yy*image.width+xx]!==coverage[at]){boundary=true;break}
   }
   if(!boundary)continue
   let sum=0,weight=0
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const xx=Math.max(0,Math.min(image.width-1,x+dx)),yy=Math.max(0,Math.min(image.height-1,y+dy)),neighbour=yy*image.width+xx
    // Coverage smoothing follows image evidence. A spatial blur alone invents
    // a translucent halo on a perfectly sharp object edge. Use the same local
    // colour/alpha barrier as region growth; zero-alpha pixels never bridge it.
    if(!image.data[neighbour*4+3])continue
    const similarity=Math.max(0,1-difference(image,at,neighbour)/edgeLimit)
    const factor=(dx===0?2:1)*(dy===0?2:1)*similarity*similarity
    sum+=coverage[neighbour]*factor;weight+=factor
   }
   soft[at]=Math.round(sum/weight)
  }
  return {width:image.width,height:image.height,coverage:soft}
 }
 return {width:image.width,height:image.height,coverage}
}

export interface MagneticLassoOptions {width?:number;contrast?:number;frequency?:number;closed?:boolean}
function edge(image:RGBAImage,x:number,y:number):number {
 const left=y*image.width+Math.max(0,x-1),right=y*image.width+Math.min(image.width-1,x+1),top=Math.max(0,y-1)*image.width+x,bottom=Math.min(image.height-1,y+1)*image.width+x
 return Math.min(1,Math.hypot(difference(image,left,right),difference(image,top,bottom))/255)
}
function snap(image:RGBAImage,point:PixelPoint,width:number,contrast:number):PixelPoint {
 const radius=width/2,cx=Math.floor(point[0]),cy=Math.floor(point[1]);let best:PixelPoint=[cx+.5,cy+.5],score=0
 for(let y=Math.max(0,Math.floor(cy-radius));y<=Math.min(image.height-1,Math.ceil(cy+radius));y++)for(let x=Math.max(0,Math.floor(cx-radius));x<=Math.min(image.width-1,Math.ceil(cx+radius));x++){
  const distance=Math.hypot(x+.5-point[0],y+.5-point[1]);if(distance>radius)continue
  const strength=edge(image,x,y);if(strength<contrast)continue
  const candidate=strength*(1-distance/(radius+1))
  if(candidate>score){score=candidate;best=[x+.5,y+.5]}
 }
 return best
}
class Heap {
 private values:{node:number;cost:number}[]=[]
 get length():number{return this.values.length}
 push(node:number,cost:number):void{const entry={node,cost};let i=this.values.length;this.values.push(entry);while(i){const parent=(i-1)>>1;if(this.values[parent].cost<=cost)break;this.values[i]=this.values[parent];i=parent}this.values[i]=entry}
 pop():{node:number;cost:number}{const first=this.values[0],last=this.values.pop()!;if(this.values.length){let i=0;while(i*2+1<this.values.length){let child=i*2+1;if(child+1<this.values.length&&this.values[child+1].cost<this.values[child].cost)child++;if(this.values[child].cost>=last.cost)break;this.values[i]=this.values[child];i=child}this.values[i]=last}return first}
}
/** Gradient attraction plus shortest paths in a bounded pointer corridor. It
 * follows visible colour/alpha boundaries; it is not Photoshop's private kernel. */
export function magneticLassoPath(image:RGBAImage,points:PixelPoint[],options:MagneticLassoOptions={}):PixelPoint[] {
 check(image,points)
 const width=argument(options.width??24,1,128,'Magnetic width'),contrast=argument(options.contrast??.1,0,1,'Magnetic contrast'),frequency=argument(options.frequency??20,0,100,'Magnetic frequency'),anchors:PixelPoint[]=[]
 const spacing=Math.max(2,24-frequency*.2);let snapWork=0
 const appendAnchor=(point:PixelPoint)=>{snapWork+=(width+3)**2;if(snapWork>IMAGE_SELECTION_LIMITS.searchPixels)throw new EditorError('RESOURCE_LIMIT','Magnetic Lasso exceeds the attraction budget.');anchors.push(snap(image,point,width,contrast))}
 appendAnchor(points[0]);let previous=points[0],remaining=spacing
 // Anchor placement depends on travelled distance, not pointer event frequency.
 for(let i=1;i<points.length;i++){const destination=points[i];let length=Math.hypot(destination[0]-previous[0],destination[1]-previous[1]);while(length>=remaining){previous=[previous[0]+(destination[0]-previous[0])*remaining/length,previous[1]+(destination[1]-previous[1])*remaining/length];appendAnchor(previous);length-=remaining;remaining=spacing}remaining-=length;previous=destination}
 if(points.length>1)appendAnchor(points.at(-1)!)
 if(options.closed&&anchors.length>1)anchors.push(anchors[0])
 const path:PixelPoint[]=[anchors[0]];let searchWork=0
 for(let i=1;i<anchors.length;i++){
  const a=anchors[i-1],b=anchors[i];if(a[0]===b[0]&&a[1]===b[1])continue
  const left=Math.max(0,Math.floor(Math.min(a[0],b[0])-width)),top=Math.max(0,Math.floor(Math.min(a[1],b[1])-width)),right=Math.min(image.width-1,Math.ceil(Math.max(a[0],b[0])+width)),bottom=Math.min(image.height-1,Math.ceil(Math.max(a[1],b[1])+width)),w=right-left+1,h=bottom-top+1,count=w*h
  searchWork+=count;if(count>IMAGE_SELECTION_LIMITS.segmentPixels||searchWork>IMAGE_SELECTION_LIMITS.searchPixels)throw new EditorError('RESOURCE_LIMIT','Magnetic Lasso exceeds the path search budget.')
  const source=(Math.floor(a[1])-top)*w+Math.floor(a[0])-left,target=(Math.floor(b[1])-top)*w+Math.floor(b[0])-left,costs=new Float64Array(count).fill(Infinity),parents=new Int32Array(count).fill(-1),settled=new Uint8Array(count),heap=new Heap();costs[source]=0;heap.push(source,0)
  while(heap.length){const current=heap.pop();if(settled[current.node])continue;settled[current.node]=1;if(current.node===target)break
   const x=current.node%w,y=Math.floor(current.node/w)
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy||x+dx<0||x+dx>=w||y+dy<0||y+dy>=h)continue;const next=(y+dy)*w+x+dx;if(settled[next])continue
    const strength=edge(image,left+x+dx,top+y+dy),step=Math.hypot(dx,dy)*(1+12*(1-Math.max(0,(strength-contrast)/Math.max(.001,1-contrast)))),cost=current.cost+step
    if(cost<costs[next]){costs[next]=cost;parents[next]=current.node;heap.push(next,cost)}
   }
  }
  const segment:PixelPoint[]=[];let at=target
  while(at!==source){if(at<0||parents[at]<0)throw new EditorError('INVALID_ARGUMENT','Magnetic Lasso could not connect its anchors.');segment.push([left+at%w+.5,top+Math.floor(at/w)+.5]);at=parents[at]}
  if(path.length+segment.length>IMAGE_SELECTION_LIMITS.pathPoints)throw new EditorError('RESOURCE_LIMIT','Magnetic Lasso exceeds the output path budget.')
  path.push(...segment.reverse())
 }
 return path
}
