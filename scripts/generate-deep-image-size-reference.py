"""Independent CG16 Nearest oracle using unmodified upstream LayerRenderer/LayerTransform.
Unused DownsampleCache is stubbed: Nearest never calls it. This proves affine placement,
not private CG high-quality filtering or true16 Lanczos reduction compatibility.
"""
import hashlib,json,pathlib,subprocess,tempfile
root=pathlib.Path(__file__).resolve().parents[1]
upstream=root.parent/'Compositor_Upstream/f01e298/Compositor'
transform=(upstream/'Document/LayerTransform.swift').read_text().split('/// Several layers transformed together:')[0]
renderer=(upstream/'Rendering/LayerRenderer.swift').read_text().split('\nextension LayerRenderer')[0]
assert 'bitsPerComponent: deep == nil ? 8 : 16' in (upstream/'IO/ImageResizer.swift').read_text()
stubs='''
enum LayerBlendMode {case normal;var cgMode:CGBlendMode {.normal}}
final class DownsampleCache {static let shared=DownsampleCache();static func level(for factor:CGFloat)->Int {0};func image(_ image:CGImage,level:Int)->(image:CGImage,level:Int) {(image,0)}}
enum BrushRaster {static func pixelToDocument(_ t:LayerTransform,width:Int,height:Int)->CGAffineTransform {let a=t.radians,c=cos(a),s=sin(a),w=t.size.width/CGFloat(width)*(t.flipX ? -1:1),h=t.size.height/CGFloat(height)*(t.flipY ? -1:1);return CGAffineTransform(a:c*w,b:s*w,c:-s*h,d:c*h,tx:t.center.x-(c*w*CGFloat(width)-s*h*CGFloat(height))/2,ty:t.center.y-(s*w*CGFloat(width)+c*h*CGFloat(height))/2)}}
'''
runner=r'''
var rows=[[String:Any]]()
let sourceWidth=8,sourceHeight=6
var premul=[UInt16]()
for y in 0..<sourceHeight {for x in 0..<sourceWidth {let a=[65535,32768,65535,1,0][(x/2+y/2)%5];let color=[10001+x*4117,20002+y*3037,50005-x*2197];for value in color {premul.append(UInt16((Double(value)*Double(a)/65535).rounded()))};premul.append(UInt16(a))}}
let data=premul.withUnsafeBytes {Data($0)},provider=CGDataProvider(data:data as CFData)!,image=CGImage(width:sourceWidth,height:sourceHeight,bitsPerComponent:16,bitsPerPixel:64,bytesPerRow:sourceWidth*8,space:CGColorSpace(name:CGColorSpace.sRGB)!,bitmapInfo:CGBitmapInfo(rawValue:CGImageAlphaInfo.premultipliedLast.rawValue|CGBitmapInfo.byteOrder16Little.rawValue),provider:provider,decode:nil,shouldInterpolate:false,intent:.defaultIntent)!
for angle in [0.0,37.0,90.0,-28.0] {for flips in [[false,false],[true,false],[false,true],[true,true]] {for scales in [[2.0,0.5],[0.5,2.0]] {
let original=LayerTransform(origin:CGPoint(x:5,y:8),size:CGSize(width:8,height:6),rotation:angle,flipX:flips[0],flipY:flips[1],sampling:.nearest),sx=scales[0],sy=scales[1],corners=[CGPoint(x:0,y:0),CGPoint(x:1,y:0),CGPoint(x:1,y:1),CGPoint(x:0,y:1)].map{original.point($0)}.map{CGPoint(x:$0.x*sx,y:$0.y*sy)},left=floor(corners.map(\.x).min()!),top=floor(corners.map(\.y).min()!),width=Int(ceil(corners.map(\.x).max()!)-left),height=Int(ceil(corners.map(\.y).max()!)-top)
let context=CGContext(data:nil,width:width,height:height,bitsPerComponent:16,bytesPerRow:width*8,space:CGColorSpace(name:CGColorSpace.sRGB)!,bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue|CGBitmapInfo.byteOrder16Little.rawValue)!
context.translateBy(x:0,y:CGFloat(height));context.scaleBy(x:1,y:-1);context.translateBy(x:-left,y:-top);context.scaleBy(x:sx,y:sy);LayerRenderer.draw(image,transform:original,center:original.center,in:context)
rows.append(["rotation":angle,"flipX":flips[0],"flipY":flips[1],"sx":sx,"sy":sy,"bounds":[left,top,Double(width),Double(height)],"premultiplied":Array(UnsafeBufferPointer(start:context.data!.assumingMemoryBound(to:UInt16.self),count:width*height*4))])
}}}
let output=try JSONSerialization.data(withJSONObject:["width":sourceWidth,"height":sourceHeight,"deep":premul,"rows":rows],options:[.sortedKeys]);FileHandle.standardOutput.write(output)
'''
with tempfile.TemporaryDirectory(prefix='native-deep-image-size-') as directory:
 path=pathlib.Path(directory);(path/'oracle.swift').write_text(transform+stubs+renderer+runner)
 subprocess.run(['xcrun','swiftc',str(path/'oracle.swift'),'-o',str(path/'oracle')],check=True)
 result=json.loads(subprocess.check_output([str(path/'oracle')]))
 result['commit']='f01e2980fb76eb085d3f8ac96070a1c0c4a9afa9'
 result['generator']='Unmodified native LayerRenderer.draw and LayerTransform; ImageResizer CG16 context sequence. Nearest-only; unused DownsampleCache stub. Samples are premultiplied native-endian RGBA16.'
 result['sourceHashes']={name:hashlib.sha256((upstream/name).read_bytes()).hexdigest() for name in ['Document/LayerTransform.swift','Rendering/LayerRenderer.swift','IO/ImageResizer.swift']}
 (root/'fixtures/parity/native-deep-image-size.json').write_text(json.dumps(result,separators=(',',':'))+'\n')
 print('Generated',len(result['rows']),'independent native CG16 Nearest geometry fixtures')
