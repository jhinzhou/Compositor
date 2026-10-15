import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {PNG} from 'pngjs'
import {prepareDeepBlur} from '../src/core/deep-blur-edit'
import {makeDeepAsset,makeAsset} from '../src/core/project-io'
import {EditorError,type Layer,type Transform} from '../src/shared/contracts'
import {documentPoint,sourcePoint} from '../src/core/raster-edit'
import type {PixelStage} from '../src/core/pixel-actions'
import type {RetouchAction} from '../src/core/retouch-edit'
const code=(expected:string)=>(error:unknown)=>error instanceof EditorError&&error.code===expected
function setup(width=8,height=8,transform:Transform={origin:[4,4],size:[width,height],rotation:0,flipX:false,flipY:false,sampling:'High quality'}){
 const id=randomUUID().toUpperCase(),file=`${id}.png`,deep=new Uint16Array(width*height*4)
 for(let p=0;p<width*height;p++)deep.set([10001+(p*717)%30000,20002+(p*337)%20000,30003+(p*193)%20000,65535],p*4)
 const asset=makeDeepAsset(file,width,height,deep),layer:Layer={id,name:'Deep',imageFile:file,isVisible:true,isGroup:false,opacity:1,blendMode:'Normal',transform},stage:PixelStage={manifest:{format:'com.compositor.project',version:12,colorSpace:'sRGB',documentID:randomUUID(),width:32,height:32,resolution:72,activeLayerID:id,layers:[layer]},assets:new Map([[file,asset]]),selection:null}
 const action:RetouchAction={type:'layer.retouch',layerId:id,kind:'blur',points:[[8,8]],size:64,hardness:1,opacity:.7,blurRadius:1,protectAlpha:true,sourceMode:'this-layer',target:'image'}
 return {stage,action,asset,layer,deep}
}
/** Independent scalar reference: Simpson integration of each Gaussian pixel footprint, no production kernel/convolver. */
function gaussianScalar(input:Uint16Array,width:number,height:number,sigma:number):Uint16Array{
 const radius=Math.max(1,Math.ceil(3*sigma)),weights:number[]=[]
 for(let offset=-radius;offset<=radius;offset++){let sum=0;const n=256,dx=1/n;for(let i=0;i<=n;i++){const x=offset-.5+i*dx;sum+=(i===0||i===n?1:i%2?4:2)*Math.exp(-x*x/(2*sigma*sigma))}weights.push(sum*dx/3)}const total=weights.reduce((a,b)=>a+b,0);for(let i=0;i<weights.length;i++)weights[i]/=total
 const temp=new Float32Array(input.length),out=new Uint16Array(input.length)
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<4;c++){let v=0;for(let d=-radius;d<=radius;d++)if(x+d>=0&&x+d<width)v+=input[(y*width+x+d)*4+c]*weights[d+radius];temp[(y*width+x)*4+c]=v}
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<4;c++){let v=0;for(let d=-radius;d<=radius;d++)if(y+d>=0&&y+d<height)v+=temp[((y+d)*width+x)*4+c]*weights[d+radius];out[(y*width+x)*4+c]=Math.round(v)}return out
}

test('deep blur matches independently integrated scalar Gaussian and keeps genuine sub-byte samples',()=>{
 const {stage,action,asset}=setup(),before=new Uint16Array(asset.deep!),result=prepareDeepBlur(stage,action),soft=gaussianScalar(before,asset.width,asset.height,1)
 assert.equal(result.width,asset.width);assert.equal(result.height,asset.height);assert.deepEqual(result.transform,stage.manifest.layers[0].transform)
 for(let at=0;at<before.length;at+=4){const sa=soft[at+3]/65535*action.opacity;for(let c=0;c<3;c++){const expected=Math.round(before[at+c]*(1-sa)+soft[at+c]*action.opacity);assert.ok(Math.abs(result.deep[at+c]-expected)<=1,`scalar Gaussian delta at ${at+c}`)}assert.equal(result.deep[at+3],before[at+3])}
 assert.ok([...result.deep].some(value=>value%257!==0));assert.deepEqual(asset.deep,before);assert.notEqual(result.deep,asset.deep)
})

test('deep blur selection and brush footprint preserve every unaffected sample and source storage',()=>{
 const {stage,action,asset}=setup();stage.selection={inverted:false,shapes:[{kind:'rectangle',operation:'replace',bounds:[6,6,2,2],feather:0}]};const before=new Uint16Array(asset.deep!),encoded=Buffer.from(asset.bytes),display=Buffer.from(asset.displayBytes!),result=prepareDeepBlur(stage,{...action,points:[[6.5,6.5],[7.5,7.5]],size:3})
 let changed=0;for(let y=0;y<asset.height;y++)for(let x=0;x<asset.width;x++){const at=(y*asset.width+x)*4,doc=documentPoint(stage.manifest.layers[0],x+.5,y+.5,asset.width,asset.height);if(doc[0]<6||doc[0]>=8||doc[1]<6||doc[1]>=8)assert.deepEqual(result.deep.subarray(at,at+4),before.subarray(at,at+4));else if(result.deep[at]!==before[at])changed++}
 assert.ok(changed>0);assert.deepEqual(asset.deep,before);assert.deepEqual(asset.bytes,encoded);assert.deepEqual(asset.displayBytes,display)
})

test('protect alpha keeps original alpha1, transparent borders and placement; zero opacity and empty selection are strict no-ops',()=>{
 const {stage,action,asset}=setup();for(let p=0;p<asset.width*asset.height;p++){const alpha=p%3===0?0:p%3===1?1:30003;asset.deep!.set([Math.min(alpha,10001),Math.min(alpha,20002),Math.min(alpha,30003),alpha],p*4)}const before=new Uint16Array(asset.deep!),result=prepareDeepBlur(stage,action)
 for(let p=0;p<asset.width*asset.height;p++){assert.equal(result.deep[p*4+3],before[p*4+3]);for(let c=0;c<3;c++)assert.ok(result.deep[p*4+c]<=before[p*4+3])}assert.equal(result.width,asset.width);assert.equal(result.height,asset.height);assert.deepEqual(result.transform,stage.manifest.layers[0].transform)
 for(const mode of ['opacity','selection']){if(mode==='selection')stage.selection={shapes:[],inverted:false};const unchanged=prepareDeepBlur(stage,{...action,points:[[0,0]],size:4096,protectAlpha:false,opacity:mode==='opacity'?0:1});assert.equal(unchanged.deep,asset.deep);assert.equal(unchanged.width,asset.width);assert.deepEqual(unchanged.transform,stage.manifest.layers[0].transform)}assert.deepEqual(asset.deep,before)
})

test('canvas radius is mapped to the scaled layer grid and rotation/flip selection remains in document space',()=>{
 const transform:Transform={origin:[4,4],size:[16,8],rotation:90,flipX:true,flipY:false,sampling:'High quality'},a=setup(8,8,transform),b=setup(8,8,{...transform,size:[8,8],rotation:0,flipX:false})
 // Whole hard tip means geometry affects sigma alone: sigma scales by sqrt(pixel area / canvas area).
 const result=prepareDeepBlur(a.stage,{...a.action,size:64,points:[[12,8]],opacity:1,blurRadius:Math.SQRT2}),reference=prepareDeepBlur(b.stage,{...b.action,size:64,points:[[8,8]],opacity:1,blurRadius:1});assert.deepEqual(result.deep,reference.deep)
 const chosen=documentPoint(a.layer,3.5,4.5,8,8);a.stage.selection={inverted:false,shapes:[{kind:'rectangle',operation:'replace',bounds:[Math.floor(chosen[0]),Math.floor(chosen[1]),1,1],feather:0}]};const local=prepareDeepBlur(a.stage,{...a.action,points:[chosen],size:2,opacity:1})
 let changed=0;for(let y=0;y<8;y++)for(let x=0;x<8;x++){const p=(y*8+x)*4,doc=documentPoint(a.layer,x+.5,y+.5,8,8),inside=Math.floor(doc[0])===Math.floor(chosen[0])&&Math.floor(doc[1])===Math.floor(chosen[1]);if(!inside)assert.deepEqual(local.deep.subarray(p,p+4),a.asset.deep!.subarray(p,p+4));else if(local.deep[p]!==a.asset.deep![p])changed++}assert.ok(changed>0)
})

test('unprotected deep blur grows transparent edges at original pixel resolution and carries linked grayscale mask',()=>{
 const {stage,action,asset,layer}=setup(4,4),maskFile=`${layer.id}.mask.png`,mask=PNG.sync.write({width:4,height:4,data:Buffer.alloc(4*4*4,255)} as PNG,{colorType:0,inputColorType:6,inputHasAlpha:true});layer.maskFile=maskFile;layer.maskLinked=true;layer.maskEnabled=true;stage.assets.set(maskFile,makeAsset(maskFile,mask));const before=new Uint16Array(asset.deep!),result=prepareDeepBlur(stage,{...action,points:[[4,4]],size:6,opacity:1,protectAlpha:false})
 assert.ok(result.width>4||result.height>4);assert.equal(result.transform.size[0]/result.width,1);assert.equal(result.transform.size[1]/result.height,1);assert.ok(result.transform.origin[0]<4||result.transform.origin[1]<4);assert.ok(result.maskPNG);assert.equal(result.maskPNG![24],8);assert.equal(result.maskPNG![25],0);const carried=PNG.sync.read(result.maskPNG!);assert.equal(carried.width,result.width);assert.equal(carried.height,result.height)
 let outside=false;for(let y=0;y<result.height;y++)for(let x=0;x<result.width;x++){const p=(y*result.width+x)*4,doc=documentPoint({transform:result.transform} as Layer,x+.5,y+.5,result.width,result.height),old=sourcePoint(layer,...doc,4,4);if((old[0]<0||old[1]<0||old[0]>=4||old[1]>=4)&&result.deep[p+3]>0)outside=true}assert.ok(outside);assert.deepEqual(asset.deep,before)
})

test('source snapshot is softened once per stroke; duplicate points do not repeatedly apply blur',()=>{
 const {stage,action,asset}=setup(),one=prepareDeepBlur(stage,{...action,points:[[8,8]],size:4}),repeated=prepareDeepBlur(stage,{...action,points:Array.from({length:40},()=>[8,8] as [number,number]),size:4})
 assert.deepEqual(one.deep,repeated.deep);const old=new Uint16Array(asset.deep!);asset.deep=one.deep;const next=prepareDeepBlur(stage,{...action,points:[[8,8]],size:4});assert.notDeepEqual(next.deep,one.deep);asset.deep=old
})

test('deep blur refuses unsupported modes and resource-sized growth before modifying source',()=>{
 const {stage,action,asset}=setup(),before=new Uint16Array(asset.deep!)
 for(const change of [{kind:'clone' as const},{sourceMode:'all-layers' as const},{target:'mask' as const}])assert.throws(()=>prepareDeepBlur(stage,{...action,...change}),code('UNSUPPORTED_FEATURE'))
 assert.throws(()=>prepareDeepBlur(stage,{...action,points:[[1000000,1000000]],size:4096,protectAlpha:false}),code('RESOURCE_LIMIT'));assert.deepEqual(asset.deep,before)
})
