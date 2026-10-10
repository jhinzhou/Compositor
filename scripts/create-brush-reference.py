"""Runs the unmodified MetalBrushCoverage class against geometric stroke cases.
Requires macOS and a usable Metal device; fails explicitly if the native pipeline is unavailable.
"""
import argparse,json,pathlib,subprocess,tempfile
parser=argparse.ArgumentParser();parser.add_argument('--source',default=str(pathlib.Path(__file__).resolve().parents[2]/'Compositor/Compositor/Rendering/MetalBrushCoverage.swift'));parser.add_argument('--sdk',default='/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk');args=parser.parse_args();root=pathlib.Path(__file__).resolve().parents[1]
stubs='''
struct BrushSettings {var diameter:CGFloat;var hardness:CGFloat}
enum BrushStroke {static func spacingFraction(_ hardness:CGFloat)->CGFloat {hardness>=1 ? 0.015:0.025}}
enum ExportError:Error {case render}
'''
runner='''
var rows:[[String:Any]]=[]
guard let engine=MetalBrushCoverage.shared else {fatalError("Native Metal pipeline unavailable")}
let width=32,height=24
for hardness in [0.0,0.4,0.9,1.0] {for points in [[[10.3,10.6]],[[4.3,4.7],[22.9,17.1]],[[4.3,4.7],[13.6,10.9],[22.9,17.1]],[[4.3,4.7],[22.9,17.1],[4.3,4.7]]] {for rotation in [0.0,27.0] {
 let scaleX=1.3,scaleY=0.8,originX=8.0,originY=5.0,angle=rotation*Double.pi/180,sizeX=Double(width)*scaleX,sizeY=Double(height)*scaleY
 let a=cos(angle)*scaleX,b=sin(angle)*scaleX,c = -sin(angle)*scaleY,d=cos(angle)*scaleY
 let tx=originX+sizeX/2-a*Double(width)/2-c*Double(height)/2,ty=originY+sizeY/2-b*Double(width)/2-d*Double(height)/2
 let mapping=CGAffineTransform(a:a,b:b,c:c,d:d,tx:tx,ty:ty)
 var segments:[SIMD4<Float>]=[SIMD4(Float(points[0][0]),Float(points[0][1]),Float(points[0][0]),Float(points[0][1]))]
 for i in 1..<points.count {segments.append(SIMD4(Float(points[i-1][0]),Float(points[i-1][1]),Float(points[i][0]),Float(points[i][1])))}
 let tile=try engine.tile(width:width,height:height),context=CGContext(data:nil,width:width,height:height,bitsPerComponent:8,bytesPerRow:width,space:CGColorSpaceCreateDeviceGray(),bitmapInfo:CGImageAlphaInfo.none.rawValue)!
 try engine.render([(tile,CGRect(x:0,y:0,width:width,height:height),context)],settled:segments,tail:[],mapping:mapping,settings:BrushSettings(diameter:9,hardness:hardness),canvas:CGSize(width:40,height:30))
 let expected=Array(UnsafeBufferPointer(start:context.data!.assumingMemoryBound(to:UInt8.self),count:width*height))
 rows.append(["width":width,"height":height,"canvasWidth":40,"canvasHeight":30,"transform":["origin":[originX,originY],"size":[sizeX,sizeY],"rotation":rotation,"flipX":false,"flipY":false,"sampling":"High quality"],"points":points,"size":9,"hardness":hardness,"expected":expected])
}}}
let result:[String:Any]=["commit":"24ef2885daae750537ec8d094f33e8556a8dfc9a","generator":"Original MetalBrushCoverage class executed on system Metal GPU","rows":rows]
let data=try JSONSerialization.data(withJSONObject:result,options:[.sortedKeys]);FileHandle.standardOutput.write(data)
'''
with tempfile.TemporaryDirectory(prefix='native-brush-') as directory:
 path=pathlib.Path(directory);(path/'brush.swift').write_text(pathlib.Path(args.source).read_text()+stubs+runner);subprocess.run(['xcrun','swiftc','-sdk',args.sdk,str(path/'brush.swift'),'-o',str(path/'brush')],check=True);output=subprocess.check_output([str(path/'brush')]);(root/'fixtures/parity/native-1.4.8-brush.json').write_bytes(output);print('Wrote',len(json.loads(output)['rows']),'native brush references')
