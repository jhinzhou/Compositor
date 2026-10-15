/** Normal Patch D5 reconstruction from shipped AdbePM static evidence.
 * The one-pixel ROI and confidence-normalized reduce/expand pyramid were verified
 * against frozen native RGB8 references. Transparent rasters use the existing
 * sampled-healing path until their native confidence semantics are verified. */
const F=Math.fround,K=[.05,.25,.4,.25,.05].map(F),DIFFUSION=F(.75)
interface Level {width:number;height:number;values:Float32Array}
export interface PatchPyramidBounds {left:number;top:number;right:number;bottom:number}
export function blendPatchPyramid(destination:Uint8Array,donor:Float32Array,coverage:Uint8Array,width:number,height:number,output:Uint8Array,bounds:PatchPyramidBounds,options:{opacity:number;adaptation:number;softTail:boolean},charge:(work:number)=>void):Uint8Array|null {
 const left=Math.max(0,bounds.left-1),top=Math.max(0,bounds.top-1),right=Math.min(width,bounds.right+1),bottom=Math.min(height,bounds.bottom+1),w=right-left,h=bottom-top
 // Only this proven opaque path changes. Premultiplied alpha/hidden RGB behavior
 // continues to use the historical implementation, for both alpha policies.
 for(let y=top;y<bottom;y++){charge(w);for(let x=left;x<right;x++){const p=(y*width+x)*4;if(destination[p+3]!==255||donor[p+3]!==255)return null}}
 let hasCore=false
 for(let y=top;y<bottom;y++){charge(w);for(let x=left;x<right;x++)if(coverage[y*width+x]>=128)hasCore=true}
 const core=(x:number,y:number)=>x>=0&&y>=0&&x<width&&y<height&&coverage[y*width+x]>=128
 let base:Float32Array|null=null
 if(hasCore&&options.adaptation){
  charge(w*h*5);base=new Float32Array(w*h*4)
  for(let y=0;y<h;y++){charge(0);for(let x=0;x<w;x++){
   const X=x+left,Y=y+top,p=Y*width+X,q=y*w+x
   if(!core(X,Y)&&(core(X-1,Y)||core(X+1,Y)||core(X,Y-1)||core(X,Y+1))){for(let c=0;c<3;c++)base[q*4+c]=F(F(destination[p*4+c]-donor[p*4+c])*F(1/255));base[q*4+3]=1}
  }}
  const levels:Level[]=[{width:w,height:h,values:base}];let min=Math.min(w,h),count=0
  do{const next=min+1;min=next>>1;count++;if(next<=3)break}while(true)
  for(let level=1;level<count;level++){
   const previous=levels[level-1],cw=Math.ceil(previous.width/2),ch=Math.ceil(previous.height/2);charge(cw*ch*4);const values=new Float32Array(cw*ch*4),sums=new Float32Array(4);let maxWeight=0
   for(let y=0;y<ch;y++){charge(cw*25);for(let x=0;x<cw;x++){
    sums.fill(0);let total=0
    for(let j=-2;j<=2;j++)for(let i=-2;i<=2;i++){const X=x*2+i,Y=y*2+j;if(X<0||Y<0||X>=previous.width||Y>=previous.height)continue;const weight=F(K[i+2]*K[j+2]),p=(Y*previous.width+X)*4;total=F(total+weight);for(let c=0;c<4;c++)sums[c]=F(sums[c]+F(previous.values[p+c]*weight))}
    const p=(y*cw+x)*4;for(let c=0;c<4;c++)values[p+c]=F(sums[c]/total);maxWeight=Math.max(maxWeight,values[p+3])
   }}
   const floor=F(Math.pow(F(maxWeight*.5),DIFFUSION))
   for(let y=0;y<ch;y++){charge(cw);for(let x=0;x<cw;x++){const p=(y*cw+x)*4,denominator=Math.max(values[p+3],floor),inverse=denominator>=1e-5?F(1/denominator):0;for(let c=0;c<4;c++)values[p+c]=F(values[p+c]*inverse)}}
   levels.push({width:cw,height:ch,values})
  }
  const sums=new Float32Array(4)
  for(let level=levels.length-2;level>=0;level--){const fine=levels[level],coarse=levels[level+1]
   for(let y=0;y<fine.height;y++){charge(fine.width*25);for(let x=0;x<fine.width;x++){
    sums.fill(0);let total=0
    for(let j=-2;j<=2;j++)for(let i=-2;i<=2;i++){if((x+i)%2||(y+j)%2)continue;const X=(x+i)/2,Y=(y+j)/2;if(X<0||Y<0||X>=coarse.width||Y>=coarse.height)continue;const weight=F(K[i+2]*K[j+2]),p=(Y*coarse.width+X)*4;total=F(total+weight);for(let c=0;c<4;c++)sums[c]=F(sums[c]+F(coarse.values[p+c]*weight))}
    const p=(y*fine.width+x)*4,weight=fine.values[p+3],other=F(1-weight);for(let c=0;c<4;c++)fine.values[p+c]=F(F(F(sums[c]/total)*other)+F(fine.values[p+c]*weight))
   }}
  }
 }
 for(let y=0;y<h;y++){charge(w);for(let x=0;x<w;x++){
  const p=(top+y)*width+left+x,q=y*w+x;if(!coverage[p]||hasCore&&!options.softTail&&coverage[p]<128)continue
  const amount=coverage[p]/255*options.opacity,factor=base&&base[q*4+3]>1e-5?F(255/base[q*4+3]):0
  for(let c=0;c<3;c++){const adapted=Math.max(0,Math.min(255,F(donor[p*4+c]+(base?F(base[q*4+c]*factor)*options.adaptation:0))));output[p*4+c]=Math.round(adapted*amount+destination[p*4+c]*(1-amount))}
 }}
 return output
}
