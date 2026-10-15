import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {bakeDeepImageSizeRaster,sampleDeepLayerInDocument,sampleDeepBilinear,type DeepRaster} from '../src/core/deep-resample'
import {sourcePoint} from '../src/core/raster-edit'
import {EditorError,type Transform} from '../src/shared/contracts'
const code=(expected:string)=>(error:unknown)=>error instanceof EditorError&&error.code===expected
const placement=(width:number,height:number):Transform=>({origin:[0,0],size:[width,height],rotation:0,flipX:false,flipY:false,sampling:'High quality'})
function image(width:number,height:number):DeepRaster {const deep=new Uint16Array(width*height*4);for(let p=0;p<width*height;p++){const alpha=[65535,32768,1,0][p%4];deep.set([Math.round((10001+p*193)%65535*alpha/65535),Math.round((20002+p*337)%65535*alpha/65535),Math.round((30003+p*717)%65535*alpha/65535),alpha],p*4)}return {width,height,deep}}
const native=JSON.parse(readFileSync('fixtures/parity/native-deep-image-size.json','utf8')) as {width:number;height:number;deep:number[];rows:{rotation:number;flipX:boolean;flipY:boolean;sx:number;sy:number;bounds:[number,number,number,number];premultiplied:number[]}[]}

test('RGBA16 Nearest affine baking matches 32 independent CG references outside documented source-boundary ties',()=>{
 const source={width:native.width,height:native.height,deep:Uint16Array.from(native.deep)},before=new Uint16Array(source.deep);let exactCases=0,mismatchedChannels=0
 for(const row of native.rows){const original:Transform={origin:[5,8],size:[source.width,source.height],rotation:row.rotation,flipX:row.flipX,flipY:row.flipY,sampling:'Nearest'},result=bakeDeepImageSizeRaster(source,original,row.sx,row.sy,'Nearest')
 assert.deepEqual([result.transform.origin[0],result.transform.origin[1],result.width,result.height],row.bounds);let identical=true;for(let y=0;y<result.height;y++)for(let x=0;x<result.width;x++){const at=(y*result.width+x)*4,expected=row.premultiplied.slice(at,at+4),actual=Array.from(result.deep.subarray(at,at+4));if(JSON.stringify(actual)!==JSON.stringify(expected)){identical=false;for(let channel=0;channel<4;channel++)if(actual[channel]!==expected[channel])mismatchedChannels++;const [u,v]=sourcePoint({transform:original},(row.bounds[0]+x+.5)/row.sx,(row.bounds[1]+y+.5)/row.sy,source.width,source.height);assert.ok(row.rotation!==0&&(Math.abs(u-Math.round(u))<1e-8||Math.abs(v-Math.round(v))<1e-8),'CG mismatch outside a transformed exact source-pixel boundary');}}if(identical)exactCases++;assert.equal(result.transform.rotation,0);assert.equal(result.transform.flipX,false);assert.equal(result.transform.flipY,false)}assert.equal(exactCases,31);assert.equal(mismatchedChannels,32);assert.deepEqual(source.deep,before)
})

test('identity resample and exact Nearest enlargement preserve alpha1 and all non-byte samples with independent output storage',()=>{
 const source=image(5,3),before=new Uint16Array(source.deep),identity=bakeDeepImageSizeRaster(source,placement(5,3),1,1)
 assert.deepEqual(identity.deep,source.deep);assert.notEqual(identity.deep,source.deep)
 const nearest=bakeDeepImageSizeRaster(source,placement(5,3),2,3,'Nearest');assert.equal(nearest.width,10);assert.equal(nearest.height,9)
 for(let y=0;y<nearest.height;y++)for(let x=0;x<nearest.width;x++){const src=(Math.floor(y/3)*5+Math.floor(x/2))*4;assert.deepEqual(nearest.deep.subarray((y*10+x)*4,(y*10+x)*4+4),source.deep.subarray(src,src+4))}assert.ok([...nearest.deep].some(value=>value%257!==0));assert.ok([...nearest.deep].some(value=>value===1));assert.deepEqual(source.deep,before)
})

test('Smooth enlargement blends high-depth premultiplied samples directly rather than display colors or byte multiples',()=>{
 const source:DeepRaster={width:2,height:2,deep:new Uint16Array([10001,20002,30003,65535,12001,8002,4003,32768,1,1,0,1,0,0,0,0])},result=bakeDeepImageSizeRaster(source,placement(2,2),2,2,'Smooth'),at=(1*4+1)*4
 const weights=[.5625,.1875,.1875,.0625]
 for(let c=0;c<4;c++){const expected=Math.round(weights.reduce((sum,w,p)=>sum+w*source.deep[p*4+c],0));assert.equal(result.deep[at+c],expected)}assert.ok([...result.deep].some(value=>value%257!==0))
 for(let p=0;p<result.deep.length;p+=4)for(let c=0;c<3;c++)assert.ok(result.deep[p+c]<=result.deep[p+3])
})

/** Independent direct 2D scalar Lanczos oracle, no production halve, kernel or pass helper. */
function scalarHalf(source:DeepRaster):DeepRaster {
 const width=Math.ceil(source.width/2),height=Math.ceil(source.height/2),deep=new Uint16Array(width*height*4),weight=(offset:number)=>{const x=Math.abs((offset-.5)/2);return x===0?1:x>=3?0:Math.sin(Math.PI*x)*Math.sin(Math.PI*x/3)/(Math.PI*Math.PI*x*x/3)},sum=Array.from({length:12},(_,k)=>weight(k-5)).reduce((a,b)=>a+b,0)
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const values=[0,0,0,0];for(let dy=-5;dy<=6;dy++)for(let dx=-5;dx<=6;dx++){const sx=x*2+dx,sy=y*2+dy;if(sx<0||sy<0||sx>=source.width||sy>=source.height)continue;const w=weight(dx)*weight(dy)/(sum*sum);for(let c=0;c<4;c++)values[c]+=source.deep[(sy*source.width+sx)*4+c]*w}const at=(y*width+x)*4,alpha=Math.round(Math.max(0,Math.min(65535,values[3])));deep[at+3]=alpha;for(let c=0;c<3;c++)deep[at+c]=Math.round(Math.max(0,Math.min(alpha,values[c])))}return {width,height,deep}
}

test('High quality odd-size 4x reduction retains exact mip phase and matches independent true16 2D Lanczos scalar within 1 sample',()=>{
 const source=image(9,7),before=new Uint16Array(source.deep),first=scalarHalf(source),reference=scalarHalf(first),result=bakeDeepImageSizeRaster(source,placement(9,7),.25,.25,'High quality')
 assert.equal(result.width,3);assert.equal(result.height,2);assert.equal(reference.width,result.width);assert.equal(reference.height,result.height)
 for(let at=0;at<result.deep.length;at++)assert.ok(Math.abs(result.deep[at]-reference.deep[at])<=1,`16-bit Lanczos delta at ${at}`)
 assert.ok([...result.deep].some(value=>value%257!==0));assert.deepEqual(source.deep,before)
})

test('document work canvas observes placement and transparent outside; bilinear helper exposes half-pixel and edge modes without quantization',()=>{
 const source:DeepRaster={width:2,height:1,deep:new Uint16Array([10001,20002,30003,65535,12001,8002,4003,32768])},transform:Transform={...placement(2,1),origin:[3,2],sampling:'Nearest'},canvas=sampleDeepLayerInDocument(source,transform,8,6)
 for(let y=0;y<6;y++)for(let x=0;x<8;x++){const pixel=canvas.deep.subarray((y*8+x)*4,(y*8+x)*4+4);if(y===2&&(x===3||x===4))assert.deepEqual(pixel,source.deep.subarray((x-3)*4,(x-3)*4+4));else assert.deepEqual(pixel,new Uint16Array(4))}
 assert.deepEqual(sampleDeepBilinear(source.deep,2,1,.5,.5),[10001,20002,30003,65535]);assert.deepEqual(sampleDeepBilinear(source.deep,2,1,1,.5),[11001,14002,17003,49151.5]);assert.deepEqual(sampleDeepBilinear(source.deep,2,1,0,.5),[5000.5,10001,15001.5,32767.5]);assert.deepEqual(sampleDeepBilinear(source.deep,2,1,0,.5,{edgeClamp:true}),[10001,20002,30003,65535])
})

test('flipped work-canvas sampling preserves true samples and singular pixel rows without mutating source',()=>{
 const source=image(3,1),before=new Uint16Array(source.deep),canvas=sampleDeepLayerInDocument(source,{...placement(3,1),origin:[1,1],flipX:true,sampling:'Nearest'},6,3)
 for(let x=0;x<3;x++)assert.deepEqual(canvas.deep.subarray((1*6+x+1)*4,(1*6+x+1)*4+4),source.deep.subarray((2-x)*4,(3-x)*4))
 assert.deepEqual(source.deep,before)
})

test('fractionally placed retouch work grid keeps transparent-edge bilinear coverage irrespective of layer sampling',()=>{
 const source:DeepRaster={width:1,height:1,deep:new Uint16Array([10001,20002,30003,65535])},transform={...placement(1,1),origin:[.25,.25] as [number,number],sampling:'Nearest' as const},canvas=sampleDeepLayerInDocument(source,transform,3,3)
 const weights=[.5625,.1875,.1875,.0625]
 for(let p=0;p<4;p++){const x=p%2,y=Math.floor(p/2),at=(y*3+x)*4;for(let c=0;c<4;c++)assert.equal(canvas.deep[at+c],Math.round(source.deep[c]*weights[p]))}
 assert.deepEqual(sampleDeepLayerInDocument(source,{...transform,sampling:'High quality'},3,3).deep,canvas.deep)
 for(let y=0;y<3;y++)for(let x=0;x<3;x++)if(x===2||y===2)assert.deepEqual(canvas.deep.subarray((y*3+x)*4,(y*3+x+1)*4),new Uint16Array(4))
})

test('resource/invalid resample input refusal is atomic and does not mislabel straight alpha as premultiplied',()=>{
 const source=image(2,2),before=new Uint16Array(source.deep)
 assert.throws(()=>bakeDeepImageSizeRaster(source,placement(2,2),0,1),code('INVALID_ARGUMENT'));assert.throws(()=>bakeDeepImageSizeRaster(source,placement(2,2),20000,20000),code('RESOURCE_LIMIT'));assert.throws(()=>sampleDeepLayerInDocument(source,placement(2,2),30000,30000),code('RESOURCE_LIMIT'))
 const bad={width:1,height:1,deep:new Uint16Array([2,0,0,1])};assert.throws(()=>bakeDeepImageSizeRaster(bad,placement(1,1),1,1),code('INVALID_ARGUMENT'));assert.deepEqual(source.deep,before)
})
