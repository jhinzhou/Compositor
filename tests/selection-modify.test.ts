import test from 'node:test'
import assert from 'node:assert/strict'
import {Editor} from '../src/core/editor'
import {actionSchema} from '../src/shared/contracts'
import {selectionSchema,type Selection} from '../src/shared/pixel-contracts'
import {selectionCoverage} from '../src/shared/selection-coverage'
import {smoothSelectionCoverage,borderSelectionCoverage,modifyDocumentSelection} from '../src/shared/selection-modify'

const apply=(editor:Editor,action:unknown)=>editor.apply({...editor.identity(),action})
function channel(width:number,height:number,pixels:Uint8Array,inverted=false):Selection {
 const runs:[number,number,number,number][]=[]
 for(let y=0;y<height;y++)for(let x=0;x<width;){const start=x,value=pixels[y*width+x];while(x<width&&pixels[y*width+x]===value)x++;if(value)runs.push([y,start,x-start,value])}
 return {inverted,feather:0,canvasSize:[width,height],shapes:[{kind:'raster',operation:'replace',feather:0,bounds:[0,0,width,height],raster:{width,height,transform:{origin:[0,0],size:[width,height],rotation:0,flipX:false,flipY:false},runs}}]}
}
function values(selection:Selection,width:number,height:number):Uint8Array{return Uint8Array.from({length:width*height},(_,i)=>Math.round(selectionCoverage(selection,i%width+.5,Math.floor(i/width)+.5)*255))}
// Independent slow reference: enumerate the geometric disk, then sort actual
// neighboring coverage. It does not use sliding histograms or the production helper.
function neighborhood(input:Uint8Array,width:number,height:number,x:number,y:number,radius:number,clamp:boolean):number[]{
 const result:number[]=[]
 for(let yy=y-radius;yy<=y+radius;yy++)for(let xx=x-radius;xx<=x+radius;xx++)if((xx-x)**2+(yy-y)**2<=radius**2){const outside=xx<0||yy<0||xx>=width||yy>=height;result.push(outside&&!clamp?0:input[Math.max(0,Math.min(height-1,yy))*width+Math.max(0,Math.min(width-1,xx))])}
 return result.sort((a,b)=>a-b)
}
test('sliding disk median matches independent neighborhood sorting at every pixel including edges',()=>{
 const width=11,height=8,input=Uint8Array.from({length:width*height},(_,i)=>(i*47+i*i*13)%256)
 for(const radius of [1,2,3,7]){const expected=Uint8Array.from(input,(_,i)=>{const sorted=neighborhood(input,width,height,i%width,Math.floor(i/width),radius,true);return sorted[Math.floor(sorted.length/2)]});assert.deepEqual(smoothSelectionCoverage(input,width,height,radius),expected)}
})
test('Smooth removes an isolated binary speck and fills an isolated hole without hardening constant gray coverage',()=>{
 const speck=new Uint8Array(49);speck[24]=255;assert.equal(smoothSelectionCoverage(speck,7,7,1).some(Boolean),false)
 const hole=new Uint8Array(49).fill(255);hole[24]=0;assert.equal(smoothSelectionCoverage(hole,7,7,1).every(v=>v===255),true)
 assert.equal(smoothSelectionCoverage(new Uint8Array(49).fill(64),7,7,3).every(v=>v===64),true)
})
test('Border uses a centered total width and preserves soft coverage, with fractional edges for odd widths',()=>{
 const width=24,height=15,input=Uint8Array.from({length:width*height},(_,i)=>i%width>=10&&i%width<20?255:0)
 const even=borderSelectionCoverage(input,width,height,4),odd=borderSelectionCoverage(input,width,height,3),row=7*width
 assert.deepEqual([...even.slice(row+7,row+14)],[0,255,255,255,255,0,0])
 assert.deepEqual([...odd.slice(row+7,row+14)],[0,128,255,255,128,0,0])
 const soft=Uint8Array.from({length:35},(_,i)=>[0,64,128,255,255][i%5]),border=borderSelectionCoverage(soft,5,7,2)
 assert.equal(border[3*5+2],191);assert.equal(border[3*5+1],128)
})
test('disk Border matches independent min/max neighborhood ranges for gray masks and widths 1–6',()=>{
 const width=9,height=6,input=Uint8Array.from({length:54},(_,i)=>(i*31+i*i)%256)
 for(let band=1;band<=6;band++){
  const lower=Math.floor(band/2),upper=Math.ceil(band/2),mix=band/2-lower
  const expected=Uint8Array.from(input,(_,i)=>{const a=neighborhood(input,width,height,i%width,Math.floor(i/width),lower,false),b=neighborhood(input,width,height,i%width,Math.floor(i/width),upper,false);return Math.round((a.at(-1)!-a[0])*(1-mix)+(b.at(-1)!-b[0])*mix)})
  assert.deepEqual(borderSelectionCoverage(input,width,height,band),expected)
 }
})
test('document operations materialize gray inverse and feather once, retain canvas bounds, and yield valid RLE',()=>{
 const width=20,height=12,pixels=Uint8Array.from({length:240},(_,i)=>i%width>=7&&i%width<14?128:0),source=channel(width,height,pixels,true);source.feather=2;source.featherModel='photoshop'
 const materialized=values(source,width,height),equivalent=channel(width,height,materialized)
 for(const operation of ['smooth','border'] as const){const result=modifyDocumentSelection(source,width,height,operation,3),plain=modifyDocumentSelection(equivalent,width,height,operation,3)
  assert.equal(result.inverted,false);assert.equal(result.feather,0);assert.deepEqual(result.canvasSize,[width,height]);assert.deepEqual(values(result,width,height),values(plain,width,height));assert.ok(selectionSchema.safeParse(result).success)
  for(const shape of result.shapes){assert.ok(shape.bounds[0]>=0&&shape.bounds[1]>=0);assert.ok(shape.bounds[0]+shape.bounds[2]<=width&&shape.bounds[1]+shape.bounds[3]<=height)}
 }
 assert.equal(source.inverted,true);assert.equal(source.feather,2,'Input remains unchanged')
})
test('Smooth keeps a full/inverse empty channel; Border clips to the canvas and leaves the inside edge ring',()=>{
 const full:Selection={inverted:true,shapes:[]},width=10,height=8
 assert.equal(values(modifyDocumentSelection(full,width,height,'smooth',2),width,height).every(v=>v===255),true)
 const empty:Selection={inverted:false,shapes:[]};assert.equal(values(modifyDocumentSelection(empty,width,height,'smooth',2),width,height).some(Boolean),false)
 const border=values(modifyDocumentSelection(full,width,height,'border',2),width,height)
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)assert.equal(border[y*width+x],x===0||y===0||x===width-1||y===height-1?255:0)
})
test('small ROI works on a large document, and centered Border follows a hole as well as the outer boundary',()=>{
 const selection:Selection={inverted:false,antialiased:false,feather:0,shapes:[{kind:'rectangle',operation:'replace',feather:0,bounds:[100,100,15,15]},{kind:'rectangle',operation:'subtract',feather:0,bounds:[104,104,7,7]}]}
 const output=modifyDocumentSelection(selection,10_000,10_000,'border',2)
 assert.equal(selectionCoverage(output,103.5,107.5),1);assert.equal(selectionCoverage(output,104.5,107.5),1);assert.equal(selectionCoverage(output,107.5,107.5),0);assert.equal(selectionCoverage(output,99.5,107.5),1);assert.equal(selectionCoverage(output,100.5,107.5),1)
 assert.ok(output.shapes[0].raster!.width<30);assert.ok(output.shapes[0].raster!.height<30)
 assert.equal(selectionCoverage(modifyDocumentSelection(selection,10_000,10_000,'smooth',1),107.5,107.5),0)
})
test('compound AA sampling and overlapping RLE rows cannot bypass the work preflight',()=>{
 const compound:Selection={inverted:true,shapes:Array.from({length:128},()=>({kind:'ellipse' as const,operation:'add' as const,feather:0,bounds:[0,0,500,500] as [number,number,number,number]}))}
 assert.throws(()=>modifyDocumentSelection(compound,500,500,'smooth',1),/work budget/)
 const selection=channel(2000,1,new Uint8Array(2000).fill(255));selection.shapes[0].raster!.runs=Array.from({length:100_000},()=>[0,0,2000,255])
 assert.throws(()=>modifyDocumentSelection(selection,2000,2,'border',2),/work budget/)
})
test('schema and standalone entry points enforce integer amount, canvas dimensions and safe work budgets',()=>{
 for(const operation of ['smooth','border'] as const){const max=operation==='smooth'?100:200;for(const amount of [0,-1,.5,max+1]){assert.equal(actionSchema.safeParse({type:'selection.modify',operation,amount}).success,false);assert.throws(()=>modifyDocumentSelection({inverted:true,shapes:[]},20,10,operation,amount),/integer/)}assert.equal(actionSchema.safeParse({type:'selection.modify',operation,amount:max}).success,true)}
 assert.throws(()=>smoothSelectionCoverage(new Uint8Array(1),NaN,1,1),/dimensions/)
 assert.throws(()=>borderSelectionCoverage(new Uint8Array(1),2,2,1),/do not match/)
 assert.throws(()=>modifyDocumentSelection({inverted:true,shapes:[]},6000,6000,'smooth',1),/25 MP/)
 assert.throws(()=>modifyDocumentSelection({inverted:true,shapes:[]},4096,4096,'border',200),/work budget/)
})
test('Smooth/Border run through atomic editor commands with Undo/Redo and preserve raster assets',()=>{
 for(const operation of ['smooth','border'] as const){const editor=new Editor();editor.create(18,12);const selection=channel(18,12,Uint8Array.from({length:216},(_,i)=>i%18>4&&i%18<12?192:0),true);apply(editor,{type:'selection.set',selection});const before=editor.state().selection,assets=editor.snapshot().assets,identity=editor.identity(),action={type:'selection.modify',operation,amount:3}
  const first=editor.apply({...identity,action}),after=editor.state().selection;assert.notDeepEqual(after,before);assert.deepEqual(editor.apply({...identity,action}),first);assert.deepEqual(editor.snapshot().assets,assets)
  editor.history({...editor.identity(),direction:'undo'});assert.deepEqual(editor.state().selection,before);editor.history({...editor.identity(),direction:'redo'});assert.deepEqual(editor.state().selection,after)
 }
})
test('failed modification and failed batch preserve selection, revision, assets and previous undo transaction',()=>{
 const editor=new Editor();editor.create(6000,6000);apply(editor,{type:'selection.set',selection:{inverted:true,shapes:[]}});const before=editor.state(),snapshot=editor.snapshot()
 assert.throws(()=>apply(editor,{type:'selection.modify',operation:'smooth',amount:1}),/25 MP/);assert.deepEqual(editor.state(),before);assert.deepEqual(editor.snapshot(),snapshot)
 assert.throws(()=>editor.applyBatch({...editor.identity(),actions:[{type:'selection.invert'},{type:'selection.invert'},{type:'selection.modify',operation:'border',amount:200}]}),/25 MP/);assert.deepEqual(editor.state(),before);assert.deepEqual(editor.snapshot(),snapshot)
})
