"""Execute original 1.4.8 LiveMaskBaker and LiveMaskRenderer draw/coverage methods.
Only project/UI types, thumbnail work and unused downsampling dependencies are stubbed.
Nearest samples avoid claiming equivalence to Core Graphics high-quality resampling.
"""
import argparse,json,pathlib,subprocess,tempfile
parser=argparse.ArgumentParser();parser.add_argument('--source',default=str(pathlib.Path(__file__).resolve().parents[2]/'Compositor/Compositor'));parser.add_argument('--sdk',default='/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk');args=parser.parse_args();source=pathlib.Path(args.source);root=pathlib.Path(__file__).resolve().parents[1]
def block(text,start):
 pos=text.index(start);opening=text.index('{',pos);depth=1;i=opening+1
 while depth:
  depth+= (text[i]=='{')-(text[i]=='}');i+=1
 return text[pos:i]
baker=block((source/'Document/LiveLayerMask.swift').read_text(),'nonisolated enum LiveMaskBaker')
live=(source/'Rendering/LiveMaskRenderer.swift').read_text();tail=live[live.index('    init(bounds:'):];tail=tail[:tail.index('\n}')+2]
brush=(source/'Document/BrushStroke.swift').read_text();brush_methods='\n'.join(block(brush,x) for x in ['    static func context(','    static func pixelToDocument('])
renderer=(source/'Rendering/LayerRenderer.swift').read_text().split('\nextension LayerRenderer')[0]
opacity=block((source/'Document/LayerGroups.swift').read_text(),'nonisolated enum LayerOpacity')
stubs='''
import Foundation
import CoreGraphics
enum ExportError:Error {case render}
enum LayerSampling:String {case nearest="Nearest";var quality:CGInterpolationQuality {.none}}
enum LayerBlendMode {case normal;var cgMode:CGBlendMode {.normal}}
struct LayerTransform {var origin:CGPoint;var size:CGSize;var rotation:Double=0;var flipX=false;var flipY=false;var sampling:LayerSampling = .nearest;var center:CGPoint {CGPoint(x:origin.x+size.width/2,y:origin.y+size.height/2)};var radians:CGFloat {rotation*Double.pi/180}}
enum DownsampleCache {static func level(for:CGFloat)->Int {0};static let shared=Engine();struct Engine {func image(_ image:CGImage,level:Int)->(image:CGImage,level:Int){(image,0)}}}
enum PixelAdjust {static func thumbnail(of image:CGImage)throws->CGImage {image}}
struct ImportedImage {var image:CGImage;var thumbnail:CGImage;var name:String}
struct ProjectLayerRecord {var id:UUID;var transform:LayerTransform;var opacity:Double=1;var parentID:UUID?;var maskSourceID:UUID?;var maskEnabled=true
 func effectiveOpacity(in records:[UUID:ProjectLayerRecord])->Double {LayerOpacity.effective(opacity,parent:parentID){records[$0].map {($0.opacity,$0.parentID)}}}}
struct Mask {var image:CGImage;var placement:LayerTransform?=nil;func clipImage(placement:LayerTransform?,over layer:LayerTransform,width:Int,height:Int)->CGImage? {image}}
struct ProjectSnapshot {struct Manifest {var layers:[ProjectLayerRecord]};var manifest:Manifest;var images:[UUID:ImportedImage];var masks:[UUID:Mask];func mask(for layer:ProjectLayerRecord)->Mask? {layer.maskEnabled ? masks[layer.id]:nil}}
final class LiveMaskRenderer {
 let bounds:CGRect;let source:(UUID)->UUID?;let drawOwn:(UUID,CGContext)->Void
 private var cache:[UUID:CGImage]=[:];private var visiting=Set<UUID>();var resolution:CGFloat=1
 private var pixelSize:(width:Int,height:Int)? {(Int(bounds.width),Int(bounds.height))}
'''
runner='''
func cg(_ rgba:[UInt8],_ width:Int,_ height:Int)->CGImage {
 var bytes=rgba;for i in stride(from:0,to:bytes.count,by:4){for c in 0..<3 {bytes[i+c]=UInt8((Int(bytes[i+c])*Int(bytes[i+3])+127)/255)}}
 let provider=CGDataProvider(data:Data(bytes) as CFData)!
 return CGImage(width:width,height:height,bitsPerComponent:8,bitsPerPixel:32,bytesPerRow:width*4,space:CGColorSpace(name:CGColorSpace.sRGB)!,bitmapInfo:CGBitmapInfo(rawValue:CGImageAlphaInfo.premultipliedLast.rawValue|CGBitmapInfo.byteOrder32Big.rawValue),provider:provider,decode:nil,shouldInterpolate:false,intent:.defaultIntent)!
}
func gray(_ value:UInt8)->CGImage {CGImage(width:1,height:1,bitsPerComponent:8,bitsPerPixel:8,bytesPerRow:1,space:CGColorSpaceCreateDeviceGray(),bitmapInfo:CGBitmapInfo(rawValue:CGImageAlphaInfo.none.rawValue),provider:CGDataProvider(data:Data([value]) as CFData)!,decode:nil,shouldInterpolate:false,intent:.defaultIntent)!}
var rows:[[String:Any]]=[]
for mode in 0..<10 {
 let target=UUID(uuidString:"00000000-0000-4000-8000-000000000001")!,source=UUID(uuidString:"00000000-0000-4000-8000-000000000002")!,base=UUID(uuidString:"00000000-0000-4000-8000-000000000003")!,folder=UUID(uuidString:"00000000-0000-4000-8000-000000000004")!,w=8,h=6
 let initial=LayerTransform(origin:.zero,size:CGSize(width:w,height:h));var targetTransform=initial,sourceTransform=initial
 if mode==7 {sourceTransform.flipX=true};if mode==8 {sourceTransform.rotation=90};if mode==9 {targetTransform.rotation=90;targetTransform.flipY=true}
 let targetRecord=ProjectLayerRecord(id:target,transform:targetTransform,opacity:0.2,maskSourceID:source)
 let sourceRecord=ProjectLayerRecord(id:source,transform:sourceTransform,opacity:mode==1 ? 0.5:1,parentID:mode==5 ? folder:nil,maskSourceID:mode==2 ? base:nil,maskEnabled:mode != 4)
 let baseRecord=ProjectLayerRecord(id:base,transform:initial,opacity:0.6)
 let folderRecord=ProjectLayerRecord(id:folder,transform:initial,opacity:0.5)
 let targetRGBA=(0..<w*h).flatMap {i->[UInt8] in [0,255,0,UInt8(i%2==0 ? 128:255)]}
 let sourceRGBA=(0..<w*h).flatMap {i->[UInt8] in [255,0,0,UInt8([0,64,128,255][i%4])]}
 let baseRGBA=(0..<w*h).flatMap {i->[UInt8] in [0,0,255,UInt8(i/w%2==0 ? 255:128)]}
 let targetImage=cg(targetRGBA,w,h),sourceImage=cg(sourceRGBA,w,h),baseImage=cg(baseRGBA,w,h)
 var masks:[UUID:Mask]=[:];if mode==3||mode==4 {masks[source]=Mask(image:gray(128))};if mode==6 {masks[target]=Mask(image:gray(0))}
 let snapshot=ProjectSnapshot(manifest:.init(layers:[targetRecord,sourceRecord,baseRecord,folderRecord]),images:[target:ImportedImage(image:targetImage,thumbnail:targetImage,name:"Target"),source:ImportedImage(image:sourceImage,thumbnail:sourceImage,name:"Source"),base:ImportedImage(image:baseImage,thumbnail:baseImage,name:"Base")],masks:masks)
 let result=try LiveMaskBaker.bake(snapshot,target:target)!.image,data=result.dataProvider!.data!,raw=CFDataGetBytePtr(data)!,expected=(0..<w*h).map {Int(raw[($0/w)*result.bytesPerRow+($0%w)*4+3])}
 func transform(_ t:LayerTransform)->[String:Any] {["origin":[t.origin.x,t.origin.y],"size":[t.size.width,t.size.height],"rotation":t.rotation,"flipX":t.flipX,"flipY":t.flipY,"sampling":"Nearest"]}
 rows.append(["mode":mode,"width":w,"height":h,"target":targetRGBA,"source":sourceRGBA,"base":baseRGBA,"targetTransform":transform(targetTransform),"sourceTransform":transform(sourceTransform),"expectedAlpha":expected])
}
let data=try JSONSerialization.data(withJSONObject:["commit":"24ef2885daae750537ec8d094f33e8556a8dfc9a","generator":"Original LiveMaskBaker and unchanged LiveMaskRenderer draw/coverage methods in Core Graphics; nearest sampling","rows":rows],options:[.sortedKeys]);FileHandle.standardOutput.write(data)
'''
with tempfile.TemporaryDirectory(prefix='native-live-mask-') as directory:
 path=pathlib.Path(directory);(path/'reference.swift').write_text(stubs+tail+'\n'+opacity+'\n'+'enum BrushRaster {\n'+brush_methods+'\n}\n'+renderer+'\n'+baker+'\n'+runner)
 subprocess.run(['xcrun','clang','-isysroot',args.sdk,'-O2','-c',str(source/'Rendering/BrushPixels.c'),'-o',str(path/'brush.o')],check=True)
 subprocess.run(['xcrun','swiftc','-sdk',args.sdk,'-import-objc-header',str(source/'Rendering/BrushPixels.h'),str(path/'reference.swift'),str(path/'brush.o'),'-o',str(path/'reference')],check=True)
 output=subprocess.check_output([str(path/'reference')]);(root/'fixtures/parity/native-1.4.8-live-mask.json').write_bytes(output);print('Wrote',len(json.loads(output)['rows']),'native external clipping references')
