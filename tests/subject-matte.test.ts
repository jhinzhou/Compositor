import test from 'node:test'
import assert from 'node:assert/strict'
import {matteBox,guidedMatteFilter,colorGuidedMatteFilter,refineSubjectMatte} from '../src/shared/subject-matte'
import {gaussianSelectionCoverage} from '../src/shared/selection-gaussian'
import {selectionGeometryBounds} from '../src/shared/selection-bounds'

test('guided box filter matches independent clamped two-dimensional means',()=>{
 const width=7,height=4,source=Float32Array.from({length:28},(_,i)=>((i*17)%29)/29)
 for(const radius of [1,3,8]){const result=matteBox(source,width,height,radius);for(let y=0;y<height;y++)for(let x=0;x<width;x++){let sum=0;for(let yy=-radius;yy<=radius;yy++)for(let xx=-radius;xx<=radius;xx++)sum+=source[Math.min(height-1,Math.max(0,y+yy))*width+Math.min(width-1,Math.max(0,x+xx))];assert.ok(Math.abs(result[y*width+x]-sum/(radius*2+1)**2)<1e-6)}}
})
test('guided filtering preserves a constant mask and follows a sharp guide edge',()=>{
 const guide=Float32Array.from({length:20},(_,i)=>i<10?0:1),constant=new Float32Array(20).fill(.4)
 const result=guidedMatteFilter(constant,guide,20,1,3)
 for(const value of result)assert.ok(Math.abs(value-.4)<1e-5)
 const mask=Float32Array.from({length:20},(_,i)=>i<9?.05:i>10?.95:.5),refined=guidedMatteFilter(mask,guide,20,1,3)
 assert.ok(refined[9]<.3);assert.ok(refined[10]>.7)
})
test('matte quality Basic ignores advanced sliders; Advanced contrast follows native slope and shift direction',()=>{
 const mask={width:9,height:1,coverage:Uint8Array.from([0,0,0,64,128,192,255,255,255])},guide={width:9,height:1,data:new Uint8Array(36).fill(255)},before=mask.coverage.slice()
 assert.deepEqual(refineSubjectMatte(mask,guide,{quality:'basic',refineEdges:40,matteContrast:100,shiftEdge:10}).coverage,before)
 const contrast=refineSubjectMatte(mask,guide,{quality:'advanced',refineEdges:0,matteContrast:100})
 assert.deepEqual([...contrast.coverage],[0,0,0,0,153,255,255,255,255])
 const hard={...mask,coverage:Uint8Array.from([0,0,0,0,255,255,255,255,255])}
 const shrunk=refineSubjectMatte(hard,guide,{quality:'advanced',refineEdges:0,matteContrast:0,shiftEdge:-4}),expanded=refineSubjectMatte(hard,guide,{quality:'advanced',refineEdges:0,matteContrast:0,shiftEdge:4})
 assert.ok(shrunk.coverage.filter(Boolean).length<5);assert.ok(expanded.coverage.filter(Boolean).length>5)
 assert.deepEqual(mask.coverage,before)
 assert.throws(()=>refineSubjectMatte(mask,guide,{quality:'advanced',shiftEdge:11}),/ranges/)
})
test('FFT and direct Gaussian coverage match independent integrated-kernel convolution',()=>{
 const width=15,height=7,input=Uint8Array.from({length:width*height},(_,i)=>(i*83)%256)
 for(const amount of [3,20]){
  const sigma=amount/2,radius=Math.ceil(sigma*4),kernel:number[]=[]
  for(let offset=-radius;offset<=radius;offset++){let value=0;const steps=40;for(let j=0;j<=steps;j++){const x=offset-.5+j/steps;value+=Math.exp(-x*x/(2*sigma*sigma))*(j===0||j===steps?1:j%2?4:2)}kernel.push(value/(steps*3))}
  const total=kernel.reduce((a,b)=>a+b,0);for(let i=0;i<kernel.length;i++)kernel[i]/=total
  const temp=new Float64Array(input.length),expected=new Uint8Array(input.length)
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let offset=-radius;offset<=radius;offset++)temp[y*width+x]+=input[y*width+Math.max(0,Math.min(width-1,x+offset))]*kernel[offset+radius]
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){let value=0;for(let offset=-radius;offset<=radius;offset++)value+=temp[Math.max(0,Math.min(height-1,y+offset))*width+x]*kernel[offset+radius];expected[y*width+x]=Math.round(value)}
  const actual=gaussianSelectionCoverage(input,width,height,amount);for(let i=0;i<actual.length;i++)assert.ok(Math.abs(actual[i]-expected[i])<=1,`${amount}/${i}: ${actual[i]} vs ${expected[i]}`)
 }
})
test('RLE selection bounds avoid document-sized work and account for a rotated placement',()=>{
 const selection={inverted:false,shapes:[{kind:'raster' as const,operation:'replace' as const,feather:0,bounds:[0,0,10000,10000] as [number,number,number,number],raster:{width:10000,height:10000,transform:{origin:[0,0] as [number,number],size:[10000,10000] as [number,number],rotation:0,flipX:false,flipY:false},runs:[[20,10,5,255]] as [number,number,number,number][]}}]}
 assert.deepEqual(selectionGeometryBounds(selection,10000,10000,3),[7,17,11,7])
 assert.deepEqual(selectionGeometryBounds({...selection,inverted:true},10000,10000),[0,0,10000,10000])
})

test('guided matte equations match original Swift Float oracle within one millionth',async()=>{
 const {readFile}=await import('node:fs/promises'),oracle=JSON.parse(await readFile(new URL('../fixtures/native-guided-matte-oracle.json',import.meta.url),'utf8'))
 const mask=Float32Array.from({length:63},(_,i)=>((i*19)%47)/47),guide=Float32Array.from({length:63},(_,i)=>((i*13)%41)/41),actual=guidedMatteFilter(mask,guide,9,7,3)
 assert.equal(actual.length,oracle.result.length)
 for(let i=0;i<actual.length;i++)assert.ok(Math.abs(actual[i]-oracle.result[i])<1e-6,`${i}: ${actual[i]} vs native ${oracle.result[i]}`)
})

test('point object selection chooses one island, retains soft coverage, and leaves background clicks empty',async()=>{
 const {pickSubjectComponent}=await import('../src/shared/subject-matte'),mask={width:7,height:1,coverage:Uint8Array.from([30,160,255,0,190,255,50])}
 assert.deepEqual([...pickSubjectComponent(mask,[1.5,.5]).coverage],[30,160,255,0,0,0,0])
 assert.deepEqual([...pickSubjectComponent(mask,[5.5,.5]).coverage],[0,0,0,0,190,255,50])
 assert.deepEqual([...pickSubjectComponent(mask,[3.5,.5]).coverage],new Array(7).fill(0))
 assert.deepEqual([...pickSubjectComponent(mask,[-1,.5]).coverage],new Array(7).fill(0))
})

test('color guidance separates equal-luminance boundaries that grayscale cannot distinguish',()=>{
 const width=25,height=3,data=new Uint8Array(width*height*4),coverage=new Uint8Array(width*height)
 // 255 red and 76 green have the same rounded sRGB luminance. Ground truth
 // here is an abrupt color edge, independent of either refinement algorithm.
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x;data.set(x<12?[255,0,0,255]:[0,76,0,255],i*4);coverage[i]=x<8?0:x>16?255:Math.round((x-8)/8*255)}
 const image={width,height,data},mask={width,height,coverage},settings={quality:'advanced' as const,refineEdges:4,matteContrast:0}
 const native=refineSubjectMatte(mask,image,{...settings,edgeMode:'native'}),color=refineSubjectMatte(mask,image,{...settings,edgeMode:'color'})
 let nativeError=0,colorError=0
 for(let y=0;y<height;y++)for(let x=8;x<=16;x++){const expected=x<12?0:255,i=y*width+x;nativeError+=Math.abs(native.coverage[i]-expected);colorError+=Math.abs(color.coverage[i]-expected)}
 assert.ok(colorError<nativeError*.6,`${colorError} vs ${nativeError}`)
 assert.ok(color.coverage[11]<60);assert.ok(color.coverage[12]>180)
 assert.deepEqual(mask.coverage,coverage);assert.ok(color.coverage.some(value=>value>0&&value<255))
})

test('color refinement keeps certain interiors and flat images stable without inventing foreground',()=>{
 const width=21,height=1,data=new Uint8Array(width*4);for(let i=0;i<width;i++)data.set([55,80,110,255],i*4)
 for(const value of [0,77,255]){
  const mask={width,height,coverage:new Uint8Array(width).fill(value)}
  assert.deepEqual(refineSubjectMatte(mask,{width,height,data},{quality:'advanced',edgeMode:'color',refineEdges:4,matteContrast:0}).coverage,mask.coverage)
 }
 const levels=new Float32Array(width);levels.fill(1,17)
 const refined=colorGuidedMatteFilter(levels,{width,height,data},2)
 assert.equal(refined[0],0);assert.equal(refined[20],1)
})

test('large color mattes have no horizontal or vertical tile seams compared with full-frame neighborhoods',()=>{
 const length=2050,repetitions=513,radius=4,rowMask=Float32Array.from({length},(_,x)=>.1+.8*(.5+.5*Math.sin(x/13))),rowData=new Uint8Array(length*4)
 for(let x=0;x<length;x++)rowData.set(x%19<9?[255,0,0,255]:[0,76,0,255],x*4)
 const reference=colorGuidedMatteFilter(rowMask,{width:length,height:1,data:rowData},radius)
 for(const vertical of [false,true]){
  const width=vertical?repetitions:length,height=vertical?length:repetitions,mask=new Float32Array(width*height),data=new Uint8Array(width*height*4)
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const position=vertical?y:x,i=y*width+x;mask[i]=rowMask[position];data.set(rowData.subarray(position*4,position*4+4),i*4)}
  const actual=colorGuidedMatteFilter(mask,{width,height,data},radius)
  for(const crossSection of [0,256,512])for(let position=0;position<length;position++){
   const i=vertical?position*width+crossSection:crossSection*width+position
   assert.ok(Math.abs(actual[i]-reference[position])<2e-5,`${vertical}/${crossSection}/${position}`)
  }
 }
})

test('feather softens only on request, remains fractional, and never reveals fully transparent source pixels',()=>{
 const width=11,height=1,coverage=Uint8Array.from({length:width},(_,x)=>x>=5?255:0),data=new Uint8Array(width*4).fill(255);data[3]=0;data[10*4+3]=0
 const mask={width,height,coverage},image={width,height,data},settings={quality:'advanced' as const,refineEdges:0,matteContrast:0}
 const hard=refineSubjectMatte(mask,image,settings),soft=refineSubjectMatte(mask,image,{...settings,feather:4})
 assert.equal(hard.coverage[4],0);assert.equal(hard.coverage[5],255)
 assert.ok(soft.coverage[4]>0);assert.ok(soft.coverage[5]<255);assert.equal(soft.coverage[0],0);assert.equal(soft.coverage[10],0)
 assert.equal(mask.coverage[10],255);assert.equal(image.data[10*4+3],0)
 assert.throws(()=>refineSubjectMatte(mask,image,{...settings,feather:21}),/ranges/)
 assert.throws(()=>colorGuidedMatteFilter(new Float32Array(1),{width:1,height:1,data:new Uint8Array(4)},0),/radius/)
 assert.throws(()=>refineSubjectMatte({width:0,height:0,coverage:new Uint8Array()},{width:0,height:0,data:new Uint8Array()},settings),/dimensions/)
})
