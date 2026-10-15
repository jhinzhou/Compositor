import assert from 'node:assert/strict'
import test from 'node:test'
import {PNG} from 'pngjs'
import {writePsdBuffer,readPsd,type Psd} from 'ag-psd'
import {decodePhotoshop,encodePhotoshop,photoshopExportWarnings} from '../src/core/photoshop-io'
import {nativeAdjustmentToSpec,specToNativeAdjustment} from '../src/shared/image-filters'
import {makeAsset} from '../src/core/project-io'

const pixels=(width=40,height=30)=>({width,height,data:new Uint8ClampedArray(width*height*4).fill(255)})
const create=()=>decodePhotoshop(writePsdBuffer({width:160,height:120,children:[{name:'Layer',imageData:pixels(),left:5,top:7}]},{noBackground:true}))
const read=(bytes:Buffer)=>readPsd(bytes,{useImageData:true,skipCompositeImageData:true,skipThumbnail:true})
test('new horizontal text exports a real TySh editable layer, UTF-16 color/font runs and raster fallback',()=>{
 const document=create(),layer=document.manifest.layers[0]
 layer.text={content:'中😀文\nTest',fontName:'ArialMT',fontSize:20,red:0,green:0,blue:0,tracking:1,leading:24,alignment:'Left',colorRuns:[{location:1,length:2,red:1,green:0,blue:0}],fontRuns:[{location:4,length:4,fontName:'TimesNewRomanPSMT'}]}
 const exported=read(encodePhotoshop(document.manifest,document.assets)),text=exported.children![0].text!
 assert.equal(text.text,'中😀文\nTest');assert.ok(text.styleRuns?.some(run=>run.style.font?.name==='ArialMT'));assert.ok(text.styleRuns?.some(run=>run.style.font?.name==='TimesNewRomanPSMT'));assert.ok(text.styleRuns?.some(run=>run.style.fillColor&&'r' in run.style.fillColor&&run.style.fillColor.r===255));assert.ok(exported.children![0].imageData);assert.ok(Number.isFinite(text.left))
 const again=decodePhotoshop(encodePhotoshop(document.manifest,document.assets));assert.equal((again.manifest.layers[0].text as any).content,'中😀文\nTest')
})
test('unaltered imported text preserves advanced style, warp, transform and edited source translation',()=>{
 const input: Psd={width:100,height:80,children:[{name:'Text',left:10,top:20,imageData:pixels(),text:{text:'Hello',transform:[1,0,0,1,12,35],style:{font:{name:'ArialMT'},fontSize:16,fillColor:{r:10,g:20,b:30},fauxBold:true,underline:true},warp:{style:'arc',value:15},paragraphStyle:{justification:'center'}}}]}
 const before=read(writePsdBuffer(input,{noBackground:true})).children![0].text!,document=decodePhotoshop(writePsdBuffer(input,{noBackground:true})),layer=document.manifest.layers[0]
 assert.deepEqual(read(encodePhotoshop(document.manifest,document.assets)).children![0].text,before)
 layer.transform.origin[0]+=9;layer.transform.origin[1]-=3
 const after=read(encodePhotoshop(document.manifest,document.assets)).children![0].text!;assert.deepEqual(after.transform,[1,0,0,1,21,32]);assert.equal(after.style!.fauxBold,true);assert.equal(after.warp!.style,'arc')
 ;(layer.text as any).content='Changed'
 const edited=read(encodePhotoshop(document.manifest,document.assets)).children![0].text!;assert.equal(edited.text,'Changed');assert.notEqual(edited.warp?.style,'arc')
})
test('rerendered text with identical native parameters never resurrects original warp and advanced styles',()=>{
 const document=decodePhotoshop(writePsdBuffer({width:100,height:80,children:[{name:'Text',left:10,top:20,imageData:pixels(),text:{text:'Hello',transform:[1,0,0,1,12,35],style:{font:{name:'ArialMT'},fontSize:16,fauxBold:true,underline:true},warp:{style:'arc',value:15}}}]},{noBackground:true})),layer=document.manifest.layers[0],image=PNG.sync.read(document.assets.get(layer.imageFile!)!.bytes)
 image.data.set([200,100,50,255],0);document.assets.set(layer.imageFile!,makeAsset(layer.imageFile!,PNG.sync.write(image)))
 const output=read(encodePhotoshop(document.manifest,document.assets)).children![0].text!;assert.equal(output.text,'Hello');assert.notEqual(output.warp?.style,'arc');assert.notEqual(output.style?.fauxBold,true);assert.notEqual(output.style?.underline,true)
})
test('point and box text export rotation and scale as affine descriptors without losing live text',()=>{
 const document=create(),layer=document.manifest.layers[0];layer.transform.rotation=90;layer.transform.size=[80,60]
 layer.text={content:'Box text',fontName:'ArialMT',fontSize:20,red:1,green:0,blue:0,tracking:0,leading:24,alignment:'Right',boxSize:[40,30]}
 const text=read(encodePhotoshop(document.manifest,document.assets)).children![0].text!;assert.equal(text.shapeType,'box');assert.equal(text.paragraphStyle!.justification,'right');assert.ok(Math.abs(text.transform![1]-2)<1e-6);assert.ok(Math.abs(text.transform![2]+2)<1e-6)
})
test('rectangle, rounded rectangle and ellipse export editable SoCo/vmsk/vogk paths through PSD and PSB',()=>{
 for(const kind of ['Rectangle','Ellipse'] as const)for(const cornerRadius of [0,6])for(const psb of [false,true]){
  const document=create(),layer=document.manifest.layers[0];layer.shape={kind,red:.2,green:.4,blue:.6,cornerRadius};layer.transform.rotation=15;layer.transform.flipX=true
  const output=read(encodePhotoshop(document.manifest,document.assets,{psb})).children![0];assert.equal(output.vectorFill!.type,'color');assert.equal(output.vectorMask!.paths.length,1);assert.equal(output.vectorMask!.paths[0].knots.length,kind==='Rectangle'&&cornerRadius?8:4);assert.equal(output.vectorOrigination!.keyDescriptorList[0].keyOriginType,kind==='Ellipse'?5:cornerRadius?2:1)
  const imported=decodePhotoshop(encodePhotoshop(document.manifest,document.assets,{psb}));assert.equal((imported.manifest.layers[0].shape as any).kind,kind)
 }
})
test('an untouched arbitrary source vector preserves path, fill and stroke, while editing raster removes stale vectors',()=>{
 const document=create(),layer=document.manifest.layers[0];layer.shape={kind:'Rectangle',red:1,green:0,blue:0,cornerRadius:0}
 const source=read(encodePhotoshop(document.manifest,document.assets));source.children![0].vectorMask!.paths[0].knots[0].points[2]+=3;source.children![0].vectorStroke={strokeEnabled:true,fillEnabled:true,lineWidth:{units:'Pixels',value:2},content:{type:'color',color:{r:0,g:255,b:0}}}
 const imported=decodePhotoshop(writePsdBuffer(source,{noBackground:true})),before=read(writePsdBuffer(source,{noBackground:true})).children![0],exported=read(encodePhotoshop(imported.manifest,imported.assets)).children![0]
 assert.deepEqual(exported.vectorMask,before.vectorMask);assert.deepEqual(exported.vectorStroke,before.vectorStroke)
 delete imported.manifest.layers[0].shape;imported.manifest.layers[0].transform.origin[0]+=1
 assert.equal(read(encodePhotoshop(imported.manifest,imported.assets)).children![0].vectorFill,undefined)
})
test('stroked line remains an explicit raster fallback instead of becoming a closed rectangle',()=>{
 const document=create();document.manifest.layers[0].shape={kind:'Line',red:0,green:0,blue:0,cornerRadius:0,lineWidth:4}
 assert.equal(read(encodePhotoshop(document.manifest,document.assets)).children![0].vectorMask,undefined);assert.ok(photoshopExportWarnings(document.manifest).some(message=>message.includes('line exported as raster')))
})
const effects={stroke:{red:1,green:0,blue:0,opacity:.8,size:4,inside:true},shadow:{red:0,green:0,blue:0,opacity:.5,angle:35,distance:10,blur:6},colorOverlay:{red:0,green:1,blue:0,opacity:.2},innerShadow:{red:0,green:0,blue:1,opacity:.4,angle:120,distance:3,blur:2},outerGlow:{red:1,green:1,blue:0,opacity:.5,size:7},innerGlow:{red:1,green:0,blue:1,opacity:.7,size:3}}
test('all six editor layer styles export editable PSD descriptors and import as editable native effects',()=>{
 const document=create();document.manifest.layers[0].effects=effects
 const bytes=encodePhotoshop(document.manifest,document.assets),output=read(bytes).children![0].effects!;assert.equal(output.dropShadow![0].angle,35);assert.equal(output.stroke![0].position,'inside');assert.equal(output.innerGlow!.size!.value,3)
 const imported=decodePhotoshop(bytes),native=imported.manifest.layers[0].effects as typeof effects
 assert.deepEqual(Object.keys(native).sort(),Object.keys(effects).sort());assert.equal(native.shadow.distance,10);assert.ok(Math.abs(native.shadow.opacity-.5)<.005)
 assert.ok(imported.warnings.some(message=>message.includes('effect rendering may differ')))
})
test('unsupported/multiple effect descriptors are preserved for unchanged export, then replaced after a native style edit',()=>{
 const document=create();document.manifest.layers[0].effects=effects
 const psd=read(encodePhotoshop(document.manifest,document.assets)),source=psd.children![0].effects!
 source.dropShadow![0].blendMode='multiply';source.dropShadow!.push({...source.dropShadow![0],distance:{units:'Pixels',value:20}});source.bevel={enabled:true,style:'inner bevel',size:{units:'Pixels',value:8},highlightColor:{r:255,g:255,b:255},shadowColor:{r:0,g:0,b:0}}
 const bytes=writePsdBuffer(psd,{noBackground:true}),imported=decodePhotoshop(bytes),original=read(bytes).children![0].effects!,output=read(encodePhotoshop(imported.manifest,imported.assets)).children![0].effects!
 assert.deepEqual(output,original);assert.ok(imported.warnings.some(message=>message.includes('multiply effect blending')));assert.ok(imported.warnings.some(message=>message.includes('bevel')))
 ;(imported.manifest.layers[0].effects as typeof effects).shadow.distance=12
 const edited=read(encodePhotoshop(imported.manifest,imported.assets)).children![0].effects!;assert.equal(edited.dropShadow!.length,1);assert.equal(edited.dropShadow![0].distance!.value,12)
})
test('eight supported adjustment types export independently editable records and survive PSD reimport',()=>{
 const specs=[{kind:'levels',ranges:[{black:10,white:220,gamma:1.5,outputBlack:0,outputWhite:240},...Array.from({length:3},()=>({black:0,white:255,gamma:1,outputBlack:0,outputWhite:255}))]},{kind:'curves'},{kind:'hsl',hue:23,saturation:18,lightness:-7,colorize:true},{kind:'exposure',exposure:1.2,offset:.02,gamma:1.1},{kind:'invert'},{kind:'colorBalance',shadows:[10,-20,30],midtones:[2,3,4],highlights:[-5,-6,7],preserveLuminosity:false},{kind:'blackWhite',weights:[40,50,60,70,80,90],tint:true,tintHue:120,tintSaturation:25},{kind:'gradientMap',shadows:'#102030',highlights:'#c0d0e0',reversed:true}]
 for(const spec of specs){const document=create(),layer=document.manifest.layers[0];delete layer.imageFile;layer.adjustment=specToNativeAdjustment(spec);const output=read(encodePhotoshop(document.manifest,document.assets));assert.ok(output.children![0].adjustment,JSON.stringify(spec));const imported=decodePhotoshop(encodePhotoshop(document.manifest,document.assets)),actual=nativeAdjustmentToSpec(imported.manifest.layers[0].adjustment);assert.equal(actual.kind,spec.kind);if(actual.kind==='hsl'){assert.equal(actual.hue,23);assert.equal(actual.colorize,true)}if(actual.kind==='gradientMap'){assert.equal(actual.shadows,'#102030');assert.equal(actual.highlights,'#c0d0e0');assert.equal(actual.reversed,true)}if(actual.kind==='blackWhite'){assert.deepEqual(actual.weights,[40,50,60,70,80,90]);assert.equal(actual.tintHue,120)}}
})
test('Hue/Saturation export writes the real 100-byte hue2 Master/range layout, including signed degrees',()=>{
 const document=create(),layer=document.manifest.layers[0];delete layer.imageFile;layer.adjustment=specToNativeAdjustment({kind:'hsl',hue:-25,saturation:20,lightness:5,hueRanges:[{range:'Reds',band:[315,345,15,45],hue:40,saturation:10,lightness:-10}]})
 const bytes=encodePhotoshop(document.manifest,document.assets),at=bytes.indexOf(Buffer.from('8BIMhue2'));assert.ok(at>0);assert.equal(bytes.readUInt32BE(at+8),100);assert.equal(bytes.readInt16BE(at+12+10),-25)
 const spec=nativeAdjustmentToSpec(decodePhotoshop(bytes).manifest.layers[0].adjustment);assert.equal(spec.kind,'hsl');if(spec.kind==='hsl'){assert.equal(spec.hue,-25);assert.deepEqual(spec.hueRanges[0],{range:'Reds',band:[315,345,15,45],hue:40,saturation:10,lightness:-10})}
})
function raw16PSD():Buffer{
 const u16=(n:number)=>{const b=Buffer.alloc(2);b.writeUInt16BE(n);return b},i16=(n:number)=>{const b=Buffer.alloc(2);b.writeInt16BE(n);return b},u32=(n:number)=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b},i32=(n:number)=>{const b=Buffer.alloc(4);b.writeInt32BE(n);return b}
 const extra=Buffer.concat([u32(0),u32(0),Buffer.from([3,82,71,66])]),channels:[number,number[]][]=[[0,[65535,257]],[1,[32768,65535]],[2,[0,32896]],[-1,[0,65535]]],record=Buffer.concat([i32(0),i32(0),i32(1),i32(2),u16(4),...channels.flatMap(([id])=>[i16(id),u32(6)]),Buffer.from('8BIMnorm'),Buffer.from([255,0,0,0]),u32(extra.length),extra]),info=Buffer.concat([i16(1),record,...channels.map(([,data])=>Buffer.concat([u16(0),...data.map(u16)]))]),section=Buffer.concat([u32(info.length),info,u32(0)]),header=Buffer.concat([Buffer.from('8BPS'),u16(1),Buffer.alloc(6),u16(3),u32(1),u32(2),u16(16),u16(3)])
 return Buffer.concat([header,u32(0),u32(0),u32(section.length),section,u16(0),Buffer.alloc(12)])
}
test('independent 16-bit RGB PSD fixture preserves source channels and requires explicit depth conversion for8-bit export',()=>{
 const imported=decodePhotoshop(raw16PSD()),layer=imported.manifest.layers[0],asset=imported.assets.get(layer.imageFile!)!,image=PNG.sync.read(asset.bytes,{skipRescale:true})
 assert.deepEqual([...image.data],[65535,32768,0,0,257,65535,32896,65535]);assert.equal(asset.bitDepth,16);assert.equal(imported.manifest.version,12);assert.ok(imported.warnings.some(message=>message.includes('retained as PNG16')));assert.throws(()=>encodePhotoshop(imported.manifest,imported.assets),/Explicitly convert/)
})
test('Photoshop full and position locks map to native flags while untouched advanced protections round-trip',()=>{
 const document=create();document.manifest.layers[0].locked=true
 const full=read(encodePhotoshop(document.manifest,document.assets)).children![0];assert.equal(full.protected?.composite,true);assert.equal(full.protected?.position,true);assert.equal(full.protected?.transparency,true)
 const imported=decodePhotoshop(encodePhotoshop(document.manifest,document.assets));assert.equal(imported.manifest.layers[0].locked,true);assert.equal(imported.manifest.layers[0].positionLocked,true)
 document.manifest.layers[0].locked=false;document.manifest.layers[0].positionLocked=true
 const position=decodePhotoshop(encodePhotoshop(document.manifest,document.assets));assert.equal(position.manifest.layers[0].positionLocked,true);assert.equal(position.manifest.layers[0].locked,false)
 const source=read(encodePhotoshop(document.manifest,document.assets));source.children![0].protected={transparency:true,artboards:true}
 const advanced=decodePhotoshop(writePsdBuffer(source,{noBackground:true}));assert.ok(advanced.warnings.some(message=>message.includes('pixel/transparency-only locks')));assert.deepEqual(read(encodePhotoshop(advanced.manifest,advanced.assets)).children![0].protected,read(writePsdBuffer(source,{noBackground:true})).children![0].protected)
})
test('global-light shadow resolves from document resources while source effect settings retain unchanged',()=>{
 const document=create();document.manifest.layers[0].effects=effects;const source=read(encodePhotoshop(document.manifest,document.assets));source.imageResources={globalAngle:120};source.children![0].effects!.dropShadow![0].useGlobalLight=true
 const imported=decodePhotoshop(writePsdBuffer(source,{noBackground:true}));assert.equal((imported.manifest.layers[0].effects as typeof effects).shadow.angle,120);assert.equal(read(encodePhotoshop(imported.manifest,imported.assets)).imageResources!.globalAngle,120)
})
test('original isolated group blend survives export with an explicit editor preview limitation',()=>{
 const document=decodePhotoshop(writePsdBuffer({width:80,height:60,children:[{name:'Isolated',blendMode:'normal',children:[{name:'Child',imageData:pixels()}]}]},{noBackground:true}))
 assert.ok(document.warnings.some(message=>message.includes('isolated Normal group')));assert.equal(read(encodePhotoshop(document.manifest,document.assets)).children![0].blendMode,'normal')
})
test('mask density and feather are editable native properties retained after raster edits and PSD export',()=>{
 const document=decodePhotoshop(writePsdBuffer({width:80,height:60,children:[{name:'Masked',imageData:pixels(),mask:{left:0,top:0,right:40,bottom:30,imageData:pixels(),userMaskDensity:.5,userMaskFeather:2}}]},{noBackground:true}))
 const layer=document.manifest.layers[0],file=layer.maskFile!,original=document.assets.get(file)!,density=layer.maskDensity!,feather=layer.maskFeather!
 assert.ok(Math.abs(density-.5)<1/255);assert.equal(feather,2);assert.equal(document.warnings.some(message=>message.includes('without those parameters')),false)
 const exported=read(encodePhotoshop(document.manifest,document.assets)).children![0].mask!;assert.ok(Math.abs(exported.userMaskDensity!-density)<1/255);assert.equal(exported.userMaskFeather,feather)
 const mask=PNG.sync.read(original.bytes);mask.data.set([0,0,0,255],0);document.assets.set(file,makeAsset(file,PNG.sync.write(mask)))
 const editedAsset=document.assets.get(file)!,before=Buffer.from(editedAsset.bytes),warnings:string[]=[],edited=read(encodePhotoshop(document.manifest,document.assets,{onWarning:message=>warnings.push(message)})).children![0].mask!
 assert.notEqual(editedAsset.hash,original.hash);assert.equal(layer.maskDensity,density);assert.equal(layer.maskFeather,feather);assert.ok(Math.abs(edited.userMaskDensity!-density)<1/255);assert.equal(edited.userMaskFeather,feather);assert.deepEqual([...edited.imageData!.data.slice(0,4)],[0,0,0,255]);assert.deepEqual(document.assets.get(file)!.bytes,before)
 assert.equal(warnings.some(message=>message.includes('discards the original Photoshop density/feather')),false)
})
