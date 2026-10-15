import {PNG} from 'pngjs'

// Hidden straight RGB at alpha=0 is intentionally excluded from visible error.
// Raw layer pixel equality is a separate structural check, never replaced by this metric.
export function visibleMetrics(actual:Buffer,reference:Buffer){
 const a=PNG.sync.read(actual),b=PNG.sync.read(reference)
 if(a.width!==b.width||a.height!==b.height)throw new Error('Reference dimensions do not match.')
 let max=0,total=0,alphaMax=0,differentPixels=0
 for(let i=0;i<a.data.length;i+=4){let changed=false
  for(let channel=0;channel<3;channel++){const error=Math.abs(a.data[i+channel]*a.data[i+3]/255-b.data[i+channel]*b.data[i+3]/255);max=Math.max(max,error);total+=error;if(error>1)changed=true}
  const alpha=Math.abs(a.data[i+3]-b.data[i+3]);alphaMax=Math.max(alphaMax,alpha);if(alpha>1)changed=true;if(changed)differentPixels++
 }
 return {width:a.width,height:a.height,meanPremultipliedRGBError:total/(a.width*a.height*3),maxPremultipliedRGBError:max,maxAlphaError:alphaMax,pixelsOverOneByte:differentPixels}
}
