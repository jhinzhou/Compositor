import type {Layer,Transform} from './contracts'
type Matrix=[number,number,number,number,number,number]
function matrix(t:Transform):Matrix{const angle=t.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),w=t.size[0]*(t.flipX?-1:1),h=t.size[1]*(t.flipY?-1:1),a=c*w,b=s*w,d=c*h,e=-s*h;return [a,b,e,d,t.origin[0]+t.size[0]/2-(a+e)/2,t.origin[1]+t.size[1]/2-(b+d)/2]}
function multiply(a:Matrix,b:Matrix):Matrix{return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]]}
function inverse(m:Matrix):Matrix{const det=m[0]*m[3]-m[1]*m[2];return [m[3]/det,-m[1]/det,-m[2]/det,m[0]/det,(m[2]*m[5]-m[3]*m[4])/det,(m[1]*m[4]-m[0]*m[5])/det]}
export function followingTransform(source:Transform,old:Transform,next:Transform):Transform{
 if(old.size[0]===next.size[0]&&old.size[1]===next.size[1]&&old.rotation===next.rotation&&old.flipX===next.flipX&&old.flipY===next.flipY)return {...structuredClone(source),origin:[source.origin[0]+next.origin[0]-old.origin[0],source.origin[1]+next.origin[1]-old.origin[1]]}
 const m=multiply(matrix(next),multiply(inverse(matrix(old)),matrix(source))),sign=source.flipX?-1:1,angle=Math.atan2(m[1]*sign,m[0]*sign),along=-m[2]*Math.sin(angle)+m[3]*Math.cos(angle),w=Math.hypot(m[0],m[1]),h=Math.abs(along),degrees=angle*180/Math.PI
 return {...structuredClone(source),origin:[m[0]/2+m[2]/2+m[4]-w/2,m[1]/2+m[3]/2+m[5]-h/2],size:[w,h],rotation:degrees+Math.round((source.rotation-degrees)/360)*360,flipY:along<0}
}
export function maskPlacementAfterTransform(layer:Pick<Layer,'maskFile'|'maskLinked'|'maskPlacement'|'transform'>,next:Transform,uniform=false):Transform|undefined{
 if(!layer.maskFile||uniform)return undefined
 const moved=layer.maskLinked===false?structuredClone(layer.maskPlacement??layer.transform):layer.maskPlacement?followingTransform(layer.maskPlacement,layer.transform,next):undefined
 if(!moved)return undefined
 const same=moved.origin.every((v,i)=>Math.abs(v-next.origin[i])<1e-9)&&moved.size.every((v,i)=>Math.abs(v-next.size[i])<1e-9)&&Math.abs(moved.rotation-next.rotation)<1e-9&&moved.flipX===next.flipX&&moved.flipY===next.flipY
 return same?undefined:moved
}
