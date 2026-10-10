import type { Transform } from './contracts'
export type ResizeHandle = 'nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w'
const handles: Record<ResizeHandle, [number,number]> = {nw:[0,0],n:[.5,0],ne:[1,0],e:[1,.5],se:[1,1],s:[.5,1],sw:[0,1],w:[0,.5]}
/** Port of Compositor LayerTransform.swift TransformDrag.updated resize branch. */
export function resizeLayer(original:Transform, handle:ResizeHandle, delta:[number,number], lockRatio:boolean, shift:boolean, option=false):Transform {
 const [hx,hy]=handles[handle], [w,h]=original.size, a=original.rotation*Math.PI/180,c=Math.cos(a),s=Math.sin(a)
 const ax=option?.5:1-hx,ay=option?.5:1-hy
 const anchor:[number,number]=[original.origin[0]+w/2+(ax-.5)*w*c-(ay-.5)*h*s,original.origin[1]+h/2+(ax-.5)*w*s+(ay-.5)*h*c]
 const dx=(hx-ax)*w*c-(hy-ay)*h*s+delta[0],dy=(hx-ax)*w*s+(hy-ay)*h*c+delta[1],span=option?2:1
 const lx=(dx*c+dy*s)*span,ly=(-dx*s+dy*c)*span,sx=hx*2-1,sy=hy*2-1
 const rw=sx===0?w:lx*sx,rh=sy===0?h:ly*sy,mx=rw<0,my=rh<0
 let width=Math.max(1,Math.abs(rw)),height=Math.max(1,Math.abs(rh))
 if(lockRatio!==shift){const factor=sx===0?height/h:sy===0?width/w:Math.max(1/Math.min(w,h),(lx*sx*w+ly*sy*h)/(w*w+h*h));width=w*factor;height=h*factor}
 const ox=(.5-ax)*width*(mx?-1:1),oy=(.5-ay)*height*(my?-1:1)
 return {...original,origin:[anchor[0]+ox*c-oy*s-width/2,anchor[1]+ox*s+oy*c-height/2],size:[width,height],flipX:original.flipX!==mx,flipY:original.flipY!==my}
}
export function constrainMove(delta:[number,number],shift:boolean):[number,number]{return !shift?delta:Math.abs(delta[0])>=Math.abs(delta[1])?[delta[0],0]:[0,delta[1]]}

/** Map each layer through the shared axis-aligned resize, including reflection. */
export function resizeTogether(layer:Transform,before:Transform,after:Transform):Transform {
 const fx=before.flipX!==after.flipX,fy=before.flipY!==after.flipY,sx=after.size[0]/before.size[0],sy=after.size[1]/before.size[1]
 const x=(layer.origin[0]+layer.size[0]/2-before.origin[0])/before.size[0],y=(layer.origin[1]+layer.size[1]/2-before.origin[1])/before.size[1]
 const width=layer.size[0]*sx,height=layer.size[1]*sy
 return {...layer,origin:[after.origin[0]+(fx?1-x:x)*after.size[0]-width/2,after.origin[1]+(fy?1-y:y)*after.size[1]-height/2],size:[width,height],rotation:fx!==fy?-layer.rotation:layer.rotation,flipX:layer.flipX!==fx,flipY:layer.flipY!==fy}
}
