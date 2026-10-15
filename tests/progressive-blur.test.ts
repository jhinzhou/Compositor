import test from 'node:test'
import assert from 'node:assert/strict'
import {applyImageFilter,imageFilterSchema,type PixelImage} from '../src/shared/image-filters'
import {defaultProgressiveBlurLine,progressiveBlurRadiusAt,progressiveBlurSourceLine,progressiveBlurPixels} from '../src/shared/progressive-blur'
import {applyHighDepthSpatialPixels} from '../src/core/high-depth-filter'
const stripe=(size=200)=>{const data=new Uint8ClampedArray(size*size*4);for(let y=0;y<size;y++)for(let x=0;x<size;x++)data.set([x%4<2?0:255,x%4<2?0:255,x%4<2?0:255,255],(y*size+x)*4);return {width:size,height:size,data}}
const contrast=(image:PixelImage,x:number,y:number)=>{const p=Array.from({length:8},(_,i)=>image.data[(y*image.width+x+i)*4]);return Math.max(...p)-Math.min(...p)}
test('Progressive Blur schema validates native radius bounds and finite document points',()=>{
 assert.deepEqual(imageFilterSchema.parse({kind:'progressiveBlur'}),{kind:'progressiveBlur',from:0,to:20,radial:false,inverted:false})
 for(const patch of [{from:-1},{to:251},{start:[NaN,0]},{end:[0,Infinity]}])assert.equal(imageFilterSchema.safeParse({kind:'progressiveBlur',...patch}).success,false)
})
test('upstream linear progressive stripe semantics: sharp start, softer middle, blurred end',()=>{
 const image=applyImageFilter(stripe(),{kind:'progressiveBlur',from:0,to:6,start:[100,20],end:[100,180]})
 assert.ok(contrast(image,96,10)>230);assert.ok(contrast(image,96,100)<contrast(image,96,30));assert.ok(contrast(image,96,190)<40)
 const both=applyImageFilter(stripe(),{kind:'progressiveBlur',from:1.5,to:6,start:[100,20],end:[100,180]})
 assert.ok(contrast(both,96,10)<230);assert.ok(contrast(both,96,10)>contrast(both,96,190))
})
test('upstream radial and invert change center and outside-circle radius',()=>{
 const spec={kind:'progressiveBlur',from:0,to:6,start:[100,100],end:[160,100],radial:true},image=applyImageFilter(stripe(),spec),inverse=applyImageFilter(stripe(),{...spec,inverted:true})
 assert.ok(contrast(image,96,100)>230);assert.ok(contrast(image,4,4)<40);assert.ok(contrast(inverse,96,100)<40);assert.ok(contrast(inverse,4,4)>230)
})
test('document endpoints map through resized, rotated, flipped placement and native coincident-point fallback',()=>{
 const placement={origin:[10,20] as [number,number],size:[200,100] as [number,number],rotation:90,flipX:true,flipY:false},spec={from:2,to:8,start:[110,70] as [number,number],end:[110,-30] as [number,number],radial:false,inverted:false},line=progressiveBlurSourceLine(spec,100,50,placement)
 assert.deepEqual(line.start,[50,25]);assert.ok(Math.abs(line.end[0]-100)<1e-10);assert.equal(progressiveBlurRadiusAt(spec,line,50,25),2);assert.equal(progressiveBlurRadiusAt(spec,line,100,25),8)
 assert.deepEqual(defaultProgressiveBlurLine({origin:[0,0],size:[200,100],rotation:0,flipX:false,flipY:false},[200,100]),{start:[100,35],end:[100,100]})
 assert.deepEqual(progressiveBlurSourceLine({...spec,start:[2,3],end:[2.1,3]},20,20),{start:[2,3],end:[2,4]})
})
test('constant radius is a floating Gaussian; zero radius is identity and fractional terminal radius does not clear pixels',()=>{
 const source=new Float32Array(8*8*4);for(let i=0;i<source.length;i+=4)source.set([2,-.25,.5001,1],i)
 const spec={from:.1,to:.1,radial:false,inverted:false},sides={left:true,right:true,top:true,bottom:true}
 const actual=progressiveBlurPixels(source,8,8,spec,sides);for(let i=0;i<actual.length;i++)assert.ok(Math.abs(actual[i]-source[i])<1e-6)
 assert.deepEqual(progressiveBlurPixels(source,8,8,{...spec,from:0,to:0}),source)
 const a=applyHighDepthSpatialPixels(source,8,8,{kind:'progressiveBlur',from:1,to:1}),b=applyHighDepthSpatialPixels(source,8,8,{kind:'gaussianBlur',radius:1})
 assert.deepEqual(a,b);assert.ok(a[(4*8+4)*4+1]<0&&a[(4*8+4)*4]>1,'HDR signs and overwhite survive')
})
test('premultiplied processing prevents hidden transparent RGB bleed; selection stays unchanged outside coverage',()=>{
 const image=stripe(12);image.data.set([255,0,0,0],0);const mask=new Uint8Array(144);mask.fill(255,72)
 const spec={kind:'progressiveBlur',from:2,to:2},a=applyImageFilter(image,spec,mask),clean={...image,data:image.data.slice()};clean.data.fill(0,0,4)
 const all=applyImageFilter(image,spec),b=applyImageFilter(clean,spec);assert.deepEqual(all,b);assert.deepEqual(a.data.slice(4,72*4),image.data.slice(4,72*4));assert.equal(a.data[3],0)
})
test('multiscale budget rejects oversized work before invoking convolution',()=>{
 assert.throws(()=>progressiveBlurPixels(new Float32Array(2048*2048*4),2048,2048,{from:0,to:250,radial:false,inverted:false}),/bounded multiscale/)
})
test('canvas edge clamping preserves constant premultiplied HDR through a varying radius field',()=>{
 const source=new Float32Array(12*10*4);for(let i=0;i<source.length;i+=4)source.set([2,-.25,.5001,.8],i)
 const result=progressiveBlurPixels(source,12,10,{from:0,to:4,start:[6,0],end:[6,10],radial:false,inverted:false},{left:true,right:true,top:true,bottom:true})
 for(let i=0;i<source.length;i++)assert.ok(Math.abs(result[i]-source[i])<1e-6)
})
