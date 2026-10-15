type Point={x:number;y:number}
export function rotateVector(point:Point,degrees:number):Point{
 const angle=degrees*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle)
 return {x:point.x*c-point.y*s,y:point.x*s+point.y*c}
}
export type ViewGeometry={center:Point;width:number;height:number;zoom:number;angle:number}
export function clientToDocument(point:Point,view:ViewGeometry):Point{
 const local=rotateVector({x:(point.x-view.center.x)/view.zoom,y:(point.y-view.center.y)/view.zoom},-view.angle)
 return {x:local.x+view.width/2,y:local.y+view.height/2}
}
export function documentToClient(point:Point,view:ViewGeometry):Point{
 const local=rotateVector({x:(point.x-view.width/2)*view.zoom,y:(point.y-view.height/2)*view.zoom},view.angle)
 return {x:local.x+view.center.x,y:local.y+view.center.y}
}
export function rotatedViewport(box:{left:number;top:number;width:number;height:number},view:ViewGeometry):{width:number;height:number;origin:Point}{
 const points=[[box.left,box.top],[box.left+box.width,box.top],[box.left,box.top+box.height],[box.left+box.width,box.top+box.height]].map(([x,y])=>clientToDocument({x,y},view))
 const left=Math.min(...points.map(p=>p.x)),top=Math.min(...points.map(p=>p.y)),right=Math.max(...points.map(p=>p.x)),bottom=Math.max(...points.map(p=>p.y))
 return {width:(right-left)*view.zoom,height:(bottom-top)*view.zoom,origin:{x:-left*view.zoom,y:-top*view.zoom}}
}
