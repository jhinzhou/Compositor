"""Run upstream LayerRenderer and ImageResizer's context sequence in Core Graphics.
Nearest fixture pixels isolate affine baking/flip semantics from platform filters.
"""
import json,pathlib,subprocess,tempfile,hashlib
root=pathlib.Path(__file__).resolve().parents[1]
upstream=root.parent/'Compositor_Upstream/d0ec2f3/Compositor'
transform=(upstream/'Document/LayerTransform.swift').read_text().split('/// Several layers transformed together:')[0]
renderer=(upstream/'Rendering/LayerRenderer.swift').read_text().split('\nextension LayerRenderer')[0]
resize=(upstream/'IO/ImageResizer.swift').read_text()
assert 'context.scaleBy(x: sx, y: sy)' in resize and 'layers: snapshot.documentLayers' in resize
stubs='''
enum LayerBlendMode {case normal;var cgMode:CGBlendMode {.normal}}
final class DownsampleCache {static let shared=DownsampleCache();static func level(for factor:CGFloat)->Int {0};func image(_ image:CGImage,level:Int)->(image:CGImage,level:Int) {(image,0)}}
enum BrushRaster {static func pixelToDocument(_ t:LayerTransform,width:Int,height:Int)->CGAffineTransform {let a=t.radians,c=cos(a),s=sin(a),w=t.size.width/CGFloat(width)*(t.flipX ? -1:1),h=t.size.height/CGFloat(height)*(t.flipY ? -1:1);return CGAffineTransform(a:c*w,b:s*w,c:-s*h,d:c*h,tx:t.center.x-(c*w*CGFloat(width)-s*h*CGFloat(height))/2,ty:t.center.y-(s*w*CGFloat(width)+c*h*CGFloat(height))/2)}}
'''
runner=r'''
var rows=[[String:Any]]()
let sourceWidth=8,sourceHeight=6
var rgba=[UInt8](),premul=[UInt8](),gray=[UInt8]()
for y in 0..<sourceHeight {for x in 0..<sourceWidth {let a=[255,128,255,0][(x/2+y/2)%4];let color=[30+x*25,20+y*35,230-x*15];for value in color {rgba.append(UInt8(value));premul.append(UInt8((Double(value)*Double(a)/255).rounded()))};rgba.append(UInt8(a));premul.append(UInt8(a));gray.append(UInt8([0,64,128,255][(x+y)%4]))}}
let provider=CGDataProvider(data:Data(premul) as CFData)!,image=CGImage(width:sourceWidth,height:sourceHeight,bitsPerComponent:8,bitsPerPixel:32,bytesPerRow:sourceWidth*4,space:CGColorSpace(name:CGColorSpace.sRGB)!,bitmapInfo:CGBitmapInfo(rawValue:CGImageAlphaInfo.premultipliedLast.rawValue|CGBitmapInfo.byteOrder32Big.rawValue),provider:provider,decode:nil,shouldInterpolate:false,intent:.defaultIntent)!
let maskImage=CGImage(width:sourceWidth,height:sourceHeight,bitsPerComponent:8,bitsPerPixel:8,bytesPerRow:sourceWidth,space:CGColorSpaceCreateDeviceGray(),bitmapInfo:CGBitmapInfo(rawValue:CGImageAlphaInfo.none.rawValue),provider:CGDataProvider(data:Data(gray) as CFData)!,decode:nil,shouldInterpolate:false,intent:.defaultIntent)!
for angle in [0.0,37.0,90.0,-28.0] {for flips in [[false,false],[true,false],[false,true],[true,true]] {for scales in [[2.0,0.5],[0.5,2.0]] {
let original=LayerTransform(origin:CGPoint(x:5,y:8),size:CGSize(width:8,height:6),rotation:angle,flipX:flips[0],flipY:flips[1],sampling:.nearest),sx=scales[0],sy=scales[1],corners=[CGPoint(x:0,y:0),CGPoint(x:1,y:0),CGPoint(x:1,y:1),CGPoint(x:0,y:1)].map{original.point($0)}.map{CGPoint(x:$0.x*sx,y:$0.y*sy)},left=floor(corners.map(\.x).min()!),top=floor(corners.map(\.y).min()!),width=Int(ceil(corners.map(\.x).max()!)-left),height=Int(ceil(corners.map(\.y).max()!)-top)
let context=CGContext(data:nil,width:width,height:height,bitsPerComponent:8,bytesPerRow:width*4,space:CGColorSpace(name:CGColorSpace.sRGB)!,bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue|CGBitmapInfo.byteOrder32Big.rawValue)!
context.translateBy(x:0,y:CGFloat(height));context.scaleBy(x:1,y:-1);context.translateBy(x:-left,y:-top);context.scaleBy(x:sx,y:sy);LayerRenderer.draw(image,transform:original,center:original.center,in:context)
let mask=CGContext(data:nil,width:width,height:height,bitsPerComponent:8,bytesPerRow:width,space:CGColorSpaceCreateDeviceGray(),bitmapInfo:CGImageAlphaInfo.none.rawValue)!
mask.translateBy(x:0,y:CGFloat(height));mask.scaleBy(x:1,y:-1);mask.translateBy(x:-left,y:-top);mask.scaleBy(x:sx,y:sy);LayerRenderer.drawCoverage(maskImage,transform:original,in:mask)
rows.append(["rotation":angle,"flipX":flips[0],"flipY":flips[1],"sx":sx,"sy":sy,"bounds":[left,top,Double(width),Double(height)],"premultiplied":Array(UnsafeBufferPointer(start:context.data!.assumingMemoryBound(to:UInt8.self),count:width*height*4)),"mask":Array(UnsafeBufferPointer(start:mask.data!.assumingMemoryBound(to:UInt8.self),count:width*height))])
}}}
let data=try JSONSerialization.data(withJSONObject:["width":sourceWidth,"height":sourceHeight,"rgba":rgba,"gray":gray,"rows":rows],options:[.sortedKeys]);FileHandle.standardOutput.write(data)
'''
with tempfile.TemporaryDirectory(prefix='native-image-size-') as directory:
 path=pathlib.Path(directory);(path/'oracle.swift').write_text(transform+stubs+renderer+runner)
 subprocess.run(['xcrun','swiftc',str(path/'oracle.swift'),'-o',str(path/'oracle')],check=True)
 result=json.loads(subprocess.check_output([str(path/'oracle')]));result['commit']='d0ec2f35b6358108ac3e59593da1688deb83a559';result['generator']='Unmodified native LayerRenderer.draw/drawCoverage and LayerTransform; native ImageResizer context sequence; Nearest isolates geometry; unused DownsampleCache stub'
 result['sourceHashes']={name:hashlib.sha256((upstream/name).read_bytes()).hexdigest() for name in ['Document/LayerTransform.swift','Rendering/LayerRenderer.swift','IO/ImageResizer.swift']}
 (root/'fixtures/parity/native-image-size.json').write_text(json.dumps(result,separators=(',',':'))+'\n');print('Generated',len(result['rows']),'native Image Size geometry/mask fixtures')
