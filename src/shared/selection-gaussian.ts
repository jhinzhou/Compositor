/** Separable Gaussian coverage, sigma = native feather / 2. Large kernels use
 * linear FFT convolution instead of switching to a box approximation. Edge
 * samples are clamped, matching DocumentSelection.coverage's clampedToExtent. */
function erf(value:number):number {const sign=value<0?-1:1,x=Math.abs(value),t=1/(1+.3275911*x);return sign*(1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*Math.exp(-x*x))}
function fft(real:Float64Array,imag:Float64Array,inverse=false):void {
 const n=real.length
 for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[real[i],real[j]]=[real[j],real[i]];[imag[i],imag[j]]=[imag[j],imag[i]]}}
 for(let length=2;length<=n;length*=2){const angle=(inverse?2:-2)*Math.PI/length,wr=Math.cos(angle),wi=Math.sin(angle);for(let start=0;start<n;start+=length){let r=1,q=0;for(let j=0;j<length/2;j++){const a=start+j,b=a+length/2,tr=r*real[b]-q*imag[b],ti=r*imag[b]+q*real[b];real[b]=real[a]-tr;imag[b]=imag[a]-ti;real[a]+=tr;imag[a]+=ti;const next=r*wr-q*wi;q=r*wi+q*wr;r=next}}}
 if(inverse)for(let i=0;i<n;i++){real[i]/=n;imag[i]/=n}
}
export function gaussianSelectionCoverage(input:Uint8Array,width:number,height:number,amount:number):Uint8Array {
 if(!amount)return input.slice()
 const sigma=amount/2,radius=Math.max(1,Math.ceil(sigma*4)),kernel=new Float64Array(radius*2+1)
 let sum=0;for(let offset=-radius;offset<=radius;offset++){const weight=.5*(erf((offset+.5)/(sigma*Math.SQRT2))-erf((offset-.5)/(sigma*Math.SQRT2)));kernel[offset+radius]=weight;sum+=weight}for(let i=0;i<kernel.length;i++)kernel[i]/=sum
 const horizontal=new Float64Array(input.length),output=new Uint8Array(input.length)
 function pass(source:ArrayLike<number>,horizontalPass:boolean):void {
  const length=horizontalPass?width:height,lines=horizontalPass?height:width,index=(line:number,x:number)=>horizontalPass?line*width+x:x*width+line
  // Direct convolution is cheaper for short kernels; FFT makes large feather
  // radii O(pixels log(side)) and retains the same integrated Gaussian kernel.
  const useFFT=kernel.length>33
  let n=1;while(n<length+radius*4)n*=2
  const kr=useFFT?new Float64Array(n):undefined,ki=useFFT?new Float64Array(n):undefined,real=useFFT?new Float64Array(n):undefined,imag=useFFT?new Float64Array(n):undefined
  if(kr&&ki){kr.set(kernel);fft(kr,ki)}
  for(let line=0;line<lines;line++){
   if(real&&imag&&kr&&ki){real.fill(0);imag.fill(0);for(let x=-radius;x<length+radius;x++)real[x+radius]=source[index(line,Math.max(0,Math.min(length-1,x)))];fft(real,imag);for(let i=0;i<n;i++){const r=real[i]*kr[i]-imag[i]*ki[i];imag[i]=real[i]*ki[i]+imag[i]*kr[i];real[i]=r}fft(real,imag,true)}
   for(let x=0;x<length;x++){let value=0;if(real)value=real[x+radius*2];else for(let offset=-radius;offset<=radius;offset++)value+=source[index(line,Math.max(0,Math.min(length-1,x+offset)))]*kernel[offset+radius];const at=index(line,x);if(horizontalPass)horizontal[at]=value;else output[at]=Math.round(Math.max(0,Math.min(255,value)))}
  }
 }
 pass(input,true);pass(horizontal,false);return output
}
