import {EditorError,type Manifest} from '../shared/contracts'
import {mapVectorPath,storedVectorPathsSchema,vectorMaskSchema,type VectorPoint} from '../shared/vector-path'
import {validateFrame} from '../shared/frame'
/** Synchronize document-coordinate metadata alongside existing raster/placement
 * transforms. Frame envelopes support translation, flips, quarter turns and
 * axis scaling; arbitrary rotated/sheared frame boundaries cannot be encoded. */
export function transformVectorFrameMetadata(stage:{manifest:Manifest},pointMapper:(point:VectorPoint)=>VectorPoint):void {
 const paths=stage.manifest.vectorPaths===undefined?undefined:storedVectorPathsSchema.parse(stage.manifest.vectorPaths).map(record=>({...record,path:mapVectorPath(record.path,pointMapper)}))
 const layers=stage.manifest.layers.map(layer=>{
  const vectorMask=layer.vectorMask===undefined?undefined:{...vectorMaskSchema.parse(layer.vectorMask),path:mapVectorPath(layer.vectorMask.path,pointMapper)}
  let frame=layer.frame===undefined?undefined:validateFrame(layer.frame)
  if(frame){
   const [x,y,w,h]=frame.bounds,corners:VectorPoint[]=[[x,y],[x+w,y],[x+w,y+h],[x,y+h]],mapped=corners.map(point=>pointMapper(point)),span=Math.max(1,...mapped.flat().map(Math.abs)),epsilon=span*1e-10
   if(mapped.some(point=>point.length!==2||point.some(value=>!Number.isFinite(value))))throw new EditorError('INVALID_ARGUMENT','Frame coordinate mapping must be finite.')
   for(let i=0;i<4;i++){const a=mapped[i],b=mapped[(i+1)%4];if(Math.abs(a[0]-b[0])>epsilon&&Math.abs(a[1]-b[1])>epsilon)throw new EditorError('UNSUPPORTED_FEATURE','This frame boundary cannot represent an arbitrary rotated or sheared clip. Use translation, flips, quarter turns or axis scaling.')}
   const xs=mapped.map(point=>point[0]),ys=mapped.map(point=>point[1]),left=Math.min(...xs),top=Math.min(...ys)
   frame=validateFrame({kind:frame.kind,bounds:[left,top,Math.max(...xs)-left,Math.max(...ys)-top]})
  }
  return {layer,frame,vectorMask}
 })
 // Validate every coordinate transformation before touching retained metadata.
 if(paths!==undefined)stage.manifest.vectorPaths=paths
 for(const {layer,frame,vectorMask} of layers){if(frame!==undefined)layer.frame=frame;if(vectorMask!==undefined)layer.vectorMask=vectorMask}
}
