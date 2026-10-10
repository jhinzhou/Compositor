"""Runs the unmodified native CPU WarpStroke class with minimal app type stubs.
Its context receives premultiplied RGBA bytes directly, avoiding drawing/interpolation in setup.
"""
import argparse,json,pathlib,subprocess,tempfile
parser=argparse.ArgumentParser();parser.add_argument('--source',default=str(pathlib.Path(__file__).resolve().parents[2]/'Compositor/Compositor/Document/SmudgeLiquify.swift'));parser.add_argument('--sdk',default='/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk');args=parser.parse_args();root=pathlib.Path(__file__).resolve().parents[1]
source=pathlib.Path(args.source).read_text();body=source[source.index('final class WarpStroke'):source.index('\nextension EditorSession')]
stubs='''import AppKit
struct ImageLayer {}
struct LayerTransform {var center=CGPoint.zero}
struct BrushSettings {var diameter:CGFloat;var hardness:CGFloat;var opacity:CGFloat}
enum BlurToolMode {case liquify,blur,smudge}
enum ExportError:Error {case render}
enum BrushRaster {static func context(width:Int,height:Int,mask:Bool)throws->CGContext {CGContext(data:nil,width:width,height:height,bitsPerComponent:8,bytesPerRow:width*4,space:CGColorSpace(name:CGColorSpace.sRGB)!,bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue|CGBitmapInfo.byteOrder32Big.rawValue)!}}
enum LayerRenderer {static func draw(_ image:CGImage,transform:LayerTransform,center:CGPoint,in context:CGContext){}}
class MetalWarp {init?(pixels:CGContext){return nil};func read(into:CGContext){};func pickUp(at:CGPoint,radius:Int){};func commit(){};func smudge(at:CGPoint,radius:Int,diameter:CGFloat,hardness:CGFloat,strength:CGFloat){};func push(from:CGPoint,to:CGPoint,radius:Int,diameter:CGFloat,hardness:CGFloat,strength:CGFloat){}}
'''
runner='''
var rows:[[String:Any]]=[]
let width=32,height=24
var rgba=[UInt8]()
for y in 0..<height {for x in 0..<width {let alpha=([0,64,128,255][(x/8+y/6)%4]);let colors=[(x*19+y*11)%256,(x*7+y*17)%256,(x*13+y*3)%256];for c in colors {rgba.append(UInt8((Double(c)*Double(alpha)/255).rounded()))};rgba.append(UInt8(alpha))}}
let context=try BrushRaster.context(width:width,height:height,mask:false),image=context.makeImage()!
for mode in ["smudge","liquify"] {for strength in [0.35,1.0] {for hardness in [0.0,0.9] {for points in [[[10.3,10.6],[18.7,10.9],[22.2,15.8]],[[1.2,1.3],[6.8,4.9]]] {
 let stroke=try WarpStroke(layer:ImageLayer(),image:image,transform:LayerTransform(),canvas:CGSize(width:width,height:height),mode:mode=="smudge" ? .smudge:.liquify,settings:BrushSettings(diameter:9,hardness:hardness,opacity:strength),useGPU:false)
 rgba.withUnsafeBytes {stroke.context.data!.copyMemory(from:$0.baseAddress!,byteCount:rgba.count)}
 for point in points {stroke.append(CGPoint(x:point[0],y:point[1]))}
 let expected=Array(UnsafeBufferPointer(start:stroke.context.data!.assumingMemoryBound(to:UInt8.self),count:rgba.count))
 rows.append(["width":width,"height":height,"rgba":rgba,"mode":mode,"size":9,"hardness":hardness,"strength":strength,"points":points,"expected":expected])
}}}}
let result:[String:Any]=["commit":"24ef2885daae750537ec8d094f33e8556a8dfc9a","generator":"Unmodified native CPU WarpStroke class; premultiplied RGBA8 injected into its CGContext; useGPU false","rows":rows]
let data=try JSONSerialization.data(withJSONObject:result,options:[.sortedKeys]);FileHandle.standardOutput.write(data)
'''
with tempfile.TemporaryDirectory(prefix='native-warp-') as directory:
 path=pathlib.Path(directory);(path/'warp.swift').write_text(stubs+body+runner);subprocess.run(['xcrun','swiftc','-sdk',args.sdk,str(path/'warp.swift'),'-o',str(path/'warp')],check=True);output=subprocess.check_output([str(path/'warp')]);(root/'fixtures/parity/native-1.4.8-warp.json').write_bytes(output);print('Wrote',len(json.loads(output)['rows']),'native warp references')
