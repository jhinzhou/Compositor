/** RGB8 Magic Eraser AA reconstructed from the installed Photoshop's six
 * channel LUT and ordered boundary-histogram passes. The caller owns the
 * buffers and retains placement, selection, resource and cancellation policy. */
export function magicEraseColorTables(reference:readonly number[],tolerance:number):Uint8Array{
 const [r,g,b]=reference,seed=[r,g,b,(r-g+256)>>1,(g-b+256)>>1,(b-r+256)>>1],tables=new Uint8Array(1536)
 for(let channel=0;channel<6;channel++)for(let value=0;value<256;value++){
  const span=channel<3?256:129,limit=channel<3?tolerance:tolerance>>1,distance=Math.max(0,Math.abs(value-seed[channel])-limit)
  tables[channel*256+value]=distance===0?127:distance<span?Math.floor((span-distance)*127/span):0
 }
 return tables
}
export function magicEraseColorScore(tables:Uint8Array,r:number,g:number,b:number):number{
 return Math.min(tables[r],tables[256+g],tables[512+b],tables[768+((r-g+256)>>1)],tables[1024+((g-b+256)>>1)],tables[1280+((b-r+256)>>1)])
}
/** The high bit marks selected pixels, while low seven bits retain the color
 * score even outside the connected component. Mutates only the private region
 * and coverage buffers supplied by the caller. Do not combine the histogram
 * passes: horizontal statistics intentionally observe vertical growth. */
export function magicEraseAntialiasCoverage(region:Uint8Array,scores:Uint8Array,width:number,height:number,coverage:Float32Array,tick:(amount?:number)=>void):void{
 const histogram=new Uint32Array(128)
 for(let p=0;p<region.length;p++){tick();region[p]=(region[p]?128:0)|scores[p]}
 for(let y=0;y<height-1;y++)for(let x=0;x<width;x++){
  tick();const p=y*width+x,a=region[p],b=region[p+width]
  if(a>=128&&b<128)histogram[b]++;if(b>=128&&a<128)histogram[a]++
 }
 for(let x=0;x<width;x++){
  for(let y=0;y<height-1;y++){tick();const p=y*width+x;if(region[p]<128&&region[p+width]>=128)region[p]^=128}
  for(let y=height-1;y>0;y--){tick();const p=y*width+x;if(region[p]<128&&region[p-width]>=128)region[p]^=128}
 }
 for(let y=0;y<height;y++)for(let x=0;x<width-1;x++){
  tick();const p=y*width+x,a=region[p],b=region[p+1]
  if(a>=128&&b<128)histogram[b]++;if(b>=128&&a<128)histogram[a]++
 }
 for(let y=0;y<height;y++){
  for(let x=0;x<width-1;x++){tick();const p=y*width+x;if(region[p]<128&&region[p+1]>=128)region[p]^=128}
  for(let x=width-1;x>0;x--){tick();const p=y*width+x;if(region[p]<128&&region[p-1]>=128)region[p]^=128}
 }
 let count=0,sum=0;for(let score=0;score<128;score++){count+=histogram[score];sum+=score*histogram[score]}
 const threshold=Math.max(128,Math.min(254,2*(count?Math.floor((sum+count/2)/count):0))),span=255-threshold
 for(let p=0;p<region.length;p++){tick();coverage[p]=region[p]<=threshold?0:Math.floor(((region[p]-threshold)*255+(span>>1))/span)/255}
}
