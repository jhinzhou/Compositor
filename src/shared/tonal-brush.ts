/** Local tone/color editing. These portable operators provide the tool semantics;
 * their tone response is an approximation, not a recovered Photoshop kernel. */
export type TonalData = Uint8Array | Uint16Array | Float32Array
export interface TonalBrushOptions {
 kind:'dodge'|'burn'|'sponge'
 amount:number
 range?:'shadows'|'midtones'|'highlights'
 protectTones?:boolean
 mode?:'saturate'|'desaturate'
 vibrance?:boolean
 cancelled?:()=>boolean
}
const clamp=(value:number)=>Math.max(0,Math.min(1,value))
const luminance=(r:number,g:number,b:number)=>.2126*r+.7152*g+.0722*b
export function tonalBrushPixels<T extends TonalData>(data:T,coverage:Uint8Array,options:TonalBrushOptions):T {
 if(data.length!==coverage.length*4||coverage.length>16_000_000||!['dodge','burn','sponge'].includes(options.kind)||!Number.isFinite(options.amount)||options.amount<0||options.amount>1||options.range!==undefined&&!['shadows','midtones','highlights'].includes(options.range)||options.mode!==undefined&&!['saturate','desaturate'].includes(options.mode))throw Error('Invalid tonal brush parameters.')
 // Node's Buffer.slice() aliases its input; previews and history require a copy.
 const output=(data instanceof Uint8Array?new Uint8Array(data):data instanceof Uint16Array?new Uint16Array(data):new Float32Array(data)) as T,max=data instanceof Uint8Array?255:data instanceof Uint16Array?65535:1
 if(!options.amount)return output
 for(let p=0;p<coverage.length;p++){
  if((p&4095)===0&&options.cancelled?.())throw Error('Tonal brush cancelled.')
  const at=p*4,weight=coverage[p]/255*options.amount
  if(!weight||!data[at+3])continue
  const rgb=[data[at]/max,data[at+1]/max,data[at+2]/max]
  if(rgb.some(value=>!Number.isFinite(value))||!Number.isFinite(data[at+3]))throw Error('Tonal brush requires finite pixels.')
  const y=luminance(...rgb as [number,number,number]),tone=clamp(y)
  let next:number[]
  if(options.kind==='sponge'){
   const hi=Math.max(...rgb),lo=Math.min(...rgb),saturation=hi>0?clamp((hi-lo)/hi):0
   const factor=(options.mode??'desaturate')==='desaturate'?1-weight:1+weight*(options.vibrance===false?1:1-saturation)
   next=rgb.map(value=>y+(value-y)*factor)
   // Keep a uniform color's brightness and constrain expansion at gamut boundaries.
   if(data instanceof Float32Array){next=next.map(value=>Math.max(0,value))}
   else{let scale=1;for(let c=0;c<3;c++){const delta=next[c]-y;if(delta>0)scale=Math.min(scale,(1-y)/delta);else if(delta<0)scale=Math.min(scale,-y/delta)}next=next.map(value=>y+(value-y)*clamp(scale))}
  }else{
   const range=options.range??'midtones',rangeWeight=range==='shadows'?(1-tone)**2:range==='highlights'?tone**2:4*tone*(1-tone),strength=weight*rangeWeight
   if(options.protectTones!==false){
    // A common scale retains channel ratios; the shoulder avoids clipped colors.
    const goal=options.kind==='dodge'?y+(Math.max(1,y)-y)*strength:y*(1-strength)
    const limit=data instanceof Float32Array?Infinity:1/Math.max(...rgb,1e-12),factor=y>1e-12?Math.min(limit,goal/y):1
    next=rgb.map(value=>value*factor)
   }else next=rgb.map(value=>options.kind==='dodge'?value+(Math.max(1,value)-value)*strength:value*(1-strength))
  }
  for(let c=0;c<3;c++){
   const value=data instanceof Float32Array?Math.fround(next[c]):Math.round(clamp(next[c])*max)
   if(!Number.isFinite(value))throw Error('Tonal brush exceeds the finite HDR range.')
   output[at+c]=value
  }
 }
 return output
}
