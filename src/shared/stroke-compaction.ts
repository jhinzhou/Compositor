export type StrokePoint=[number,number]
/** Reduce pointer oversampling with a bounded geometric error, preserving both
 * endpoints, reversals and sharp turns. Budget exhaustion retains the remaining
 * vertices instead of silently dropping the end of a stroke. */
export function compactStroke(points:readonly StrokePoint[],tolerance=.125):StrokePoint[]{
 if(!Number.isFinite(tolerance)||tolerance<0||points.length>100_000)throw Error('Invalid stroke compaction parameters.')
 const distinct:StrokePoint[]=[]
 for(const point of points){if(point.length!==2||point.some(v=>!Number.isFinite(v)||Math.abs(v)>1_000_000))throw Error('Invalid stroke point.');const last=distinct.at(-1);if(!last||last[0]!==point[0]||last[1]!==point[1])distinct.push([point[0],point[1]])}
 if(distinct.length<3||tolerance===0)return distinct
 const kept=new Uint8Array(distinct.length),pending:[number,number][]=[],limit=tolerance*tolerance;kept[0]=kept[distinct.length-1]=1
 // Spatial RDP distance cannot detect travel back and forth along the same
 // segment. Preserve changes of direction before simplifying each leg: carried
 // brushes (Smudge) depend on travel order as well as the covered geometry.
 let previous=0
 for(let i=1;i<distinct.length-1;i++){
  const a=distinct[i-1],b=distinct[i],c=distinct[i+1]
  if((b[0]-a[0])*(c[0]-b[0])+(b[1]-a[1])*(c[1]-b[1])<0){kept[i]=1;if(i-previous>1)pending.push([previous,i]);previous=i}
 }
 if(distinct.length-1-previous>1)pending.push([previous,distinct.length-1])
 let visits=0
 while(pending.length){const [first,last]=pending.pop()!,a=distinct[first],b=distinct[last],dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;let maximum=limit,index=-1
  if(visits+last-first>8_000_000){kept.fill(1,first,last+1);continue}
  for(let i=first+1;i<last;i++){visits++;const point=distinct[i],t=length?Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/length)):0,d2=(point[0]-a[0]-t*dx)**2+(point[1]-a[1]-t*dy)**2;if(d2>maximum){maximum=d2;index=i}}
  if(index>=0){kept[index]=1;pending.push([first,index],[index,last])}
 }
 return distinct.filter((_,index)=>kept[index])
}
/** Subdivide long diagonal edges so brush work follows its narrow footprint
 * rather than visiting the entire bounding rectangle of one long segment. */
export function strokeSegments(points:readonly StrokePoint[],maxLength:number):[number,number,number,number][]{
 if(!points.length)return []
 if(!Number.isFinite(maxLength)||maxLength<=0)throw Error('Invalid stroke segment length.')
 const result:[number,number,number,number][]=[[...points[0],...points[0]]]
 for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],dx=b[0]-a[0],dy=b[1]-a[1],distance=Math.hypot(dx,dy);if(!distance)continue;const count=Math.ceil(distance/maxLength)
  if(result.length+count>200_000)throw Error('Stroke path exceeds its geometry budget.')
  let x=a[0],y=a[1];for(let step=1;step<=count;step++){const nx=step===count?b[0]:a[0]+dx*step/count,ny=step===count?b[1]:a[1]+dy*step/count;result.push([x,y,nx,ny]);x=nx;y=ny}
 }
 return result
}
