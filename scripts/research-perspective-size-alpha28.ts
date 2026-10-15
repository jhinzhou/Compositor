/** Seen-cohort geometry research only. No production change or blind-test claim. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {perspectiveCropMatrix,photoshopPerspectiveCropSize,type CropCorners,type CropPoint} from '../src/shared/crop-projective'
type Row={name:string;corners:CropCorners;width:number;height:number;sourceWidth:number;sourceHeight:number;sourceCenter:CropPoint;origin:string}
const rows:Row[]=[]
for(const path of ['fixtures/parity/photoshop-27.11-perspective-size-alpha26.json','fixtures/parity/photoshop-27.11-perspective-size-validation-alpha27.json','fixtures/parity/photoshop-27.11-perspective-gui-alpha27.json']){
 const f=JSON.parse(readFileSync(path,'utf8'));for(const c of f.cases){if(!c.corners)continue;const w=c.sourceWidth??f.source?.width,h=c.sourceHeight??f.source?.height;rows.push({...c,sourceWidth:w,sourceHeight:h,sourceCenter:c.sourceCenter??[w/2,h/2],origin:path})}
}
const dot=(a:number[],b:number[])=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a:number[],b:number[])=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],norm=(a:number[])=>Math.sqrt(dot(a,a))
function metrics(row:Row){
 const h=perspectiveCropMatrix(row.corners,1,1),[cx,cy]=row.sourceCenter,g=h[6],j=h[7],a=h[0]-cx*g,d=h[3]-cy*g,b=h[1]-cx*j,e=h[4]-cy*j,f2=-(a*b+d*e)/(g*j),baseline=photoshopPerspectiveCropSize(row.corners,row.sourceWidth,row.sourceHeight,undefined,row.sourceCenter),native={width:row.width,height:row.height}
 if(!Number.isFinite(f2)||f2<=0)return {...row,baseline,native,validCamera:false,f2:Number.isFinite(f2)?f2:null}
 const f=Math.sqrt(f2),A=[a,d,f*g],B=[b,e,f*j],C=[h[2]-cx,h[5]-cy,f],W=norm(A),H=norm(B),normal=cross(A,B).map(v=>v/(W*H)),plane=dot(normal,C),D=[1,1+g,1+g+j,1+j],det=h[0]*(h[4]-h[5]*j)-h[1]*(h[3]-h[5]*g)+h[2]*(h[3]*j-h[4]*g),area=Math.max(...D.map(v=>Math.abs(det/v**3))),aspect=W/H
 const planeCameraScale=f/Math.abs(plane),nearestDepthScale=1/Math.min(...D.map(Math.abs)),nearestRayScale=f/Math.min(...[[0,0],[1,0],[1,1],[0,1]].map(([u,v])=>norm(A.map((a,i)=>a*u+B[i]*v+C[i])))),areaScale=Math.sqrt(area/(W*H))
 const scales={planeOrthogonalCamera:planeCameraScale,nearestDepth:nearestDepthScale,nearestEuclideanRay:nearestRayScale,maximumArea:areaScale}
 const candidates=Object.fromEntries(Object.entries(scales).map(([name,s])=>[name,{width:Math.round(W*s),height:Math.round(H*s),rawWidth:W*s,rawHeight:H*s,error:Math.abs(Math.round(W*s)-row.width)+Math.abs(Math.round(H*s)-row.height)}]))
 return {...row,baseline,native,validCamera:true,f2,g,j,aspect,metricLengths:[W,H],normal,plane,D,area,scales,candidates,nativeScaleRange:{width:[(row.width-.5)/W,(row.width+.5)/W],height:[(row.height-.5)/H,(row.height+.5)/H]},baselineError:Math.abs(baseline.width-row.width)+Math.abs(baseline.height-row.height)}
}
const result={status:'SEEN_COHORT_RESEARCH_ONLY',date:'2026-10-14',limits:['All alpha26/27 cohorts have already been seen; none are fresh independent tests.','No coefficients are fitted. Candidates follow metric-camera rotation, nearest depth/ray or maximum area.','No production helper change.'],rows:rows.map(metrics)}
mkdirSync('artifacts/alpha28-size',{recursive:true});writeFileSync('artifacts/alpha28-size/seen-metric-candidates.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result.rows.map(r=>({name:r.name,center:r.sourceCenter,native:r.native,baseline:r.baseline,f2:r.f2,candidates:'candidates'in r?r.candidates:undefined})),null,2))
