/** Portable integrated Gaussian kernels. Direct and FFT paths use identical
 * weights; workload changes never switch the image to a three-box approximation. */
function erf(value:number):number{const sign=value<0?-1:1,x=Math.abs(value),t=1/(1+.3275911*x);return sign*(1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*Math.exp(-x*x))}
export function integratedGaussianKernel(sigma:number):Float64Array{
 if(!Number.isFinite(sigma)||sigma<=0||sigma>100_000)throw Error('Invalid Gaussian runtime radius.')
 const radius=Math.max(1,Math.ceil(sigma*3)),weights=new Float64Array(radius*2+1);let sum=0
 for(let i=0;i<weights.length;i++){const center=i-radius;sum+=weights[i]=.5*(erf((center+.5)/(sigma*Math.SQRT2))-erf((center-.5)/(sigma*Math.SQRT2)))}
 for(let i=0;i<weights.length;i++)weights[i]/=sum
 return weights
}
function fft(real:Float64Array,imag:Float64Array,inverse=false):void{
 const n=real.length
 for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[real[i],real[j]]=[real[j],real[i]];[imag[i],imag[j]]=[imag[j],imag[i]]}}
 for(let length=2;length<=n;length*=2){const angle=(inverse?2:-2)*Math.PI/length,wr=Math.cos(angle),wi=Math.sin(angle);for(let start=0;start<n;start+=length){let r=1,q=0;for(let j=0;j<length/2;j++){const a=start+j,b=a+length/2,tr=r*real[b]-q*imag[b],ti=r*imag[b]+q*real[b];real[b]=real[a]-tr;imag[b]=imag[a]-ti;real[a]+=tr;imag[a]+=ti;const next=r*wr-q*wi;q=r*wi+q*wr;r=next}}}
 if(inverse)for(let i=0;i<n;i++){real[i]/=n;imag[i]/=n}
}
/** Per-pass workspace is reused across all rows/channels. Returned values keep
 * float precision until the renderer's final premultiplied byte conversion. */
export function gaussianLineConvolver(length:number,sigma:number,clampEdges:boolean|{start?:boolean;end?:boolean}=false): (input:Float32Array)=>Float32Array{
 return kernelLineConvolver(length,integratedGaussianKernel(sigma),clampEdges)
}
/** Shared bounded convolution workspace. Gaussian callers retain their original
 * coefficients; mask kernels can reuse the same direct/FFT implementation. */
export function kernelLineConvolver(length:number,weights:Float64Array,clampEdges:boolean|{start?:boolean;end?:boolean}=false): (input:Float32Array)=>Float32Array{
 if(!Number.isInteger(length)||length<1||length>30_000)throw Error('Invalid Gaussian line length.')
 if(!weights.length||weights.length%2!==1||weights.length>200_001||weights.some(value=>!Number.isFinite(value)))throw Error('Invalid convolution kernel.')
 const clampStart=typeof clampEdges==='boolean'?clampEdges:!!clampEdges.start,clampEnd=typeof clampEdges==='boolean'?clampEdges:!!clampEdges.end
 const kernel=weights.slice(),radius=(kernel.length-1)/2,useFFT=kernel.length>33
 let n=1;while(n<length+radius*4)n*=2
 if(n>2_097_152)throw Error('Gaussian convolution exceeds the line workspace budget.')
 const kr=useFFT?new Float64Array(n):undefined,ki=useFFT?new Float64Array(n):undefined,real=useFFT?new Float64Array(n):undefined,imag=useFFT?new Float64Array(n):undefined
 if(kr&&ki){kr.set(kernel);fft(kr,ki)}
 return(input:Float32Array)=>{
  if(input.length!==length)throw Error('Gaussian line dimensions changed.')
  const output=new Float32Array(length)
  if(real&&imag&&kr&&ki){real.fill(0);imag.fill(0);for(let x=-radius;x<length+radius;x++)real[x+radius]=x<0?clampStart?input[0]:0:x>=length?clampEnd?input[length-1]:0:input[x];fft(real,imag);for(let i=0;i<n;i++){const r=real[i]*kr[i]-imag[i]*ki[i];imag[i]=real[i]*ki[i]+imag[i]*kr[i];real[i]=r}fft(real,imag,true);for(let x=0;x<length;x++)output[x]=real[x+radius*2]}
  else for(let x=0;x<length;x++){let sum=0;for(let offset=-radius;offset<=radius;offset++){const at=x+offset;if(at<0||at>=length){if(at<0?clampStart:clampEnd)sum+=input[at<0?0:length-1]*kernel[offset+radius]}else sum+=input[at]*kernel[offset+radius]}output[x]=sum}
  return output
 }
}
