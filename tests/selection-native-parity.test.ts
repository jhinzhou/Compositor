import test from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {existsSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {magicWandSelection,colorRangeSelection,featherRasterSelection} from '../src/core/selection-retouch'
import {selectionCoverage,selectionGeometryCoverage} from '../src/shared/selection-coverage'
import {selectionOutline} from '../src/shared/selection-outline'
import {morphDocumentSelection} from '../src/shared/selection-morphology'
import {sampleLayerInDocument} from '../src/core/document-sampler'
import {selectionSchema,type Selection} from '../src/shared/pixel-contracts'
const rectangle=(bounds:[number,number,number,number]):Selection=>({inverted:false,antialiased:true,feather:0,shapes:[{kind:'rectangle',operation:'replace',bounds,feather:0}]})

test('transparent seeds select transparent pixels and premultiplied alpha separates matching RGB',()=>{
 assert.deepEqual([...magicWandSelection({width:2,height:2,data:new Uint8Array(16)},[0,0]).coverage],[255,255,255,255])
 const data=Uint8Array.from([200,120,80,255,200,120,80,128,0,0,0,0,255,255,255,0])
 assert.deepEqual([...magicWandSelection({width:4,height:1,data},[0,0],{tolerance:32,contiguous:false}).coverage],[255,0,0,0])
 assert.deepEqual([...magicWandSelection({width:4,height:1,data},[2,0],{tolerance:0,contiguous:false}).coverage],[0,0,255,255])
})
test('clipped average sample need not match its clicked pixel',()=>{
 const image={width:3,height:1,data:Uint8Array.from([0,0,0,255,90,90,90,255,180,180,180,255])}
 assert.deepEqual([...magicWandSelection(image,[0,0],{sampleSize:'3x3',tolerance:0}).coverage],[0,0,0])
 assert.deepEqual([...magicWandSelection(image,[0,0],{sampleSize:'5x5',tolerance:0,contiguous:false}).coverage],[0,255,0])
})
test('Color Range excludes samples and inverts the completed mask including transparent pixels',()=>{
 const image={width:4,height:1,data:Uint8Array.from([100,0,0,255,110,0,0,128,200,0,0,255,255,0,0,0])},excludeColors:[[number,number,number]]=[[110,0,0]]
 assert.deepEqual([...colorRangeSelection(image,[[100,0,0]],20,0,true,{excludeColors}).coverage],[0,0,0,0])
 assert.deepEqual([...colorRangeSelection(image,[[100,0,0]],5,0,true,{excludeColors,invert:true}).coverage],[0,255,255,255])
})
test('Gaussian feather clamps canvas edges and composes by root sum of squares',()=>{
 const full=rectangle([0,0,20,10]);full.canvasSize=[20,10];full.feather=6
 assert.equal(selectionCoverage(full,.5,.5),1)
 const soft=rectangle([10,0,10,10]);soft.canvasSize=[30,10];soft.feather=Math.hypot(6,8)
 for(let x=0;x<30;x++)assert.equal(selectionCoverage(soft,x+.5,5.5),selectionCoverage({...soft,feather:10},x+.5,5.5))
 assert.ok(selectionCoverage(soft,9.5,5.5)>0&&selectionCoverage(soft,9.5,5.5)<.5)
 const f=featherRasterSelection({width:30,height:1,coverage:Uint8Array.from({length:30},(_,x)=>x>=10&&x<20?255:0)},20)
 assert.ok(f.coverage[0]>0);assert.ok(f.coverage[15]>f.coverage[0])
})
test('AA applies to curved boundaries and can be disabled',()=>{
 const selection:Selection={shapes:[{kind:'ellipse',operation:'replace',bounds:[1,1,5,5],feather:0}],inverted:false}
 const aa=selectionCoverage(selection,1.5,2.5);assert.ok(aa>0&&aa<1)
 assert.equal(selectionCoverage({...selection,antialiased:false},1.5,2.5),selectionGeometryCoverage(selection,1.5,2.5))
})
test('final outline removes overlap interiors and preserves holes and inverse perimeter',()=>{
 const selection=rectangle([1,1,4,4]);selection.shapes.push({kind:'rectangle',operation:'add',bounds:[3,1,4,4],feather:0})
 const path=selectionOutline(selection,10,8);assert.equal((path.match(/M/g)??[]).length,1);assert.match(path,/H7/);assert.doesNotMatch(path,/H3|H5/)
 selection.shapes.push({kind:'rectangle',operation:'subtract',bounds:[3,2,2,2],feather:0})
 assert.equal((selectionOutline(structuredClone(selection),10,8).match(/M/g)??[]).length,2)
 assert.equal((selectionOutline({...selection,inverted:true},10,8).match(/M/g)??[]).length,3)
})
test('rounded expansion excludes square corners, keeps feather and supports small ROI on 100MP documents',()=>{
 const selection=rectangle([50,50,4,4]);selection.feather=4
 const expanded=morphDocumentSelection(selection,10000,10000,'expand',3)
 selectionSchema.parse(expanded);assert.equal(expanded.feather,4)
 assert.equal(selectionGeometryCoverage(expanded,47.5,47.5),0);assert.ok(selectionGeometryCoverage(expanded,48.5,48.5)>0)
 assert.ok(expanded.shapes[0].raster!.width<20)
 assert.ok(selectionCoverage(expanded,50.5,50.5)>0)
 const contracted=morphDocumentSelection(rectangle([0,0,10,10]),10,10,'contract',2)
 assert.equal(selectionGeometryCoverage(contracted,.5,.5),0);assert.equal(selectionGeometryCoverage(contracted,5.5,5.5),1)
})
test('document sampling respects placement, flip and transparent areas',()=>{
 const image={width:2,height:1,data:Uint8Array.from([255,0,0,255,0,0,255,255])},transform={origin:[1,1] as [number,number],size:[2,1] as [number,number],rotation:0,flipX:false,flipY:false,sampling:'Nearest' as const}
 const sample=sampleLayerInDocument(image,transform,5,3)
 assert.deepEqual([...sample.data.subarray(24,32)],[255,0,0,255,0,0,255,255])
 assert.deepEqual([...sampleLayerInDocument(image,{...transform,flipX:true},5,3).data.subarray(24,32)],[0,0,255,255,255,0,0,255])
 assert.equal(magicWandSelection(sample,[0,0],{tolerance:0}).coverage.filter(Boolean).length,13)
 assert.throws(()=>sampleLayerInDocument(null,transform,30000,30000),/budget/)
})
const source=resolve('../Compositor/Compositor/Rendering/WandPixels.c')
let compiler=false;try{execFileSync('clang',['--version'],{stdio:'ignore'});compiler=true}catch{}
test('compiled original WandPixels.c agrees byte-for-byte for 54 Wand and 8 Color Range cases',{skip:!compiler||!existsSync(source)},()=>{
 const dir=mkdtempSync(join(tmpdir(),'compositor-wand-oracle-'))
 try{
  const c=join(dir,'oracle.c'),exe=join(dir,'oracle')
  writeFileSync(c,'#include <stdio.h>\n#include <stdlib.h>\n#include <stdint.h>\n#include "WandPixels.h"\nint main(int argc,char **argv){unsigned char rgba[9*7*4],mask[9*7];fread(rgba,1,sizeof rgba,stdin);if(argc==3){unsigned char include[6]={11,13,17,100,120,140},exclude[3]={80,90,100};color_range_mask(rgba,9,7,36,include,2,exclude,1,atoi(argv[1]),atoi(argv[2]),mask);}else wand_mask(rgba,9,7,36,atoi(argv[1]),atoi(argv[2]),atoi(argv[3]),atoi(argv[4]),atoi(argv[5]),mask);fwrite(mask,1,sizeof mask,stdout);return 0;}')
  execFileSync('clang',[...(process.platform==='darwin'&&existsSync('/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk')?['-isysroot','/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk']:[]),'-O2','-I',resolve('../Compositor/Compositor/Rendering'),c,source,'-o',exe])
  const straight=new Uint8Array(9*7*4),premultiplied=new Uint8Array(straight.length)
  for(let i=0;i<63;i++){const alpha=[0,64,128,255][i%4];straight.set([(i*11)%256,(i*13)%256,(i*17)%256,alpha],i*4);premultiplied[i*4+3]=alpha;for(let c=0;c<3;c++)premultiplied[i*4+c]=Math.round(straight[i*4+c]*alpha/255)}
  for(const [x,y] of [[0,0],[4,3],[8,6]])for(const radius of [0,1,2])for(const tolerance of [0,32,150])for(const contiguous of [0,1]){
   const expected=execFileSync(exe,[String(x),String(y),String(radius),String(tolerance),String(contiguous)],{input:premultiplied})
   const actual=magicWandSelection({width:9,height:7,data:straight},[x,y],{sampleSize:(['point','3x3','5x5'] as const)[radius],tolerance,contiguous:!!contiguous})
   assert.deepEqual(Buffer.from(actual.coverage),expected,`${x},${y},${radius},${tolerance},${contiguous}`)
  }
  for(const tolerance of [0,32,100,200])for(const invert of [0,1]){
   const expected=execFileSync(exe,[String(tolerance),String(invert)],{input:premultiplied})
   const actual=colorRangeSelection({width:9,height:7,data:premultiplied},[[11,13,17],[100,120,140]],tolerance,0,true,{excludeColors:[[80,90,100]],invert:!!invert,premultiplied:true})
   assert.deepEqual(Buffer.from(actual.coverage),expected,`range/${tolerance}/${invert}`)
  }
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('100MP inverted and compound rectangle outlines remain complete without a document bitmap',()=>{
 const selection=rectangle([100,100,400,400]);selection.shapes.push({kind:'rectangle',operation:'add',bounds:[300,100,400,400],feather:0})
 assert.equal((selectionOutline(selection,10000,10000).match(/M/g)??[]).length,1)
 const path=selectionOutline({...selection,inverted:true},10000,10000)
 assert.equal((path.match(/M/g)??[]).length,2);assert.match(path,/10000/)
})

test('compound vector outline enclosed area matches independently evaluated final geometry',()=>{
 function area(path:string):number {let total=0;for(const loop of path.split('M').slice(1)){const tokens=loop.match(/[HVZ]|-?\d+(?:\.\d+)?/g)!,points:[number,number][]=[[Number(tokens[0]),Number(tokens[1])]];let x=points[0][0],y=points[0][1];for(let i=2;i<tokens.length;i++){if(tokens[i]==='H')x=Number(tokens[++i]);else if(tokens[i]==='V')y=Number(tokens[++i]);else continue;points.push([x,y])}for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];total+=(a[0]*b[1]-a[1]*b[0])/2}}return total}
 for(const operation of ['add','subtract','intersect'] as const)for(const inverted of [false,true]){
  const selection:Selection={inverted,shapes:[{kind:'ellipse',operation:'replace',bounds:[1,1,12,9],feather:0},{kind:'polygon',operation,feather:0,bounds:[3,0,14,13],points:[[3,0],[17,4],[14,13],[5,12]]}]}
  let expected=0;for(let y=0;y<15;y++)for(let x=0;x<20;x++)if(selectionGeometryCoverage(selection,x+.5,y+.5)>=.5)expected++
  assert.equal(area(selectionOutline(selection,20,15)),expected,`${operation}/${inverted}`)
 }
})

test('feather of a uniform 100MP all/empty selection is constant without a full coverage allocation',()=>{
 const full=rectangle([0,0,10000,10000]);full.canvasSize=[10000,10000];full.feather=250
 assert.equal(selectionCoverage(full,.5,.5),1);assert.equal(selectionCoverage({...full,inverted:true},9999.5,9999.5),0)
 assert.equal(selectionCoverage({shapes:[],inverted:true,canvasSize:[10000,10000],feather:250},.5,.5),1)
})
