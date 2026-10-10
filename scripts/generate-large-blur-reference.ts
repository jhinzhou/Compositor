/** Mac development-only Core Image oracle; fixture consumption is portable. */
import {readFile,writeFile,mkdtemp,mkdir,rm} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
const upstream=resolve('../Compositor'),commit=execFileSync('git',['rev-parse','HEAD'],{cwd:upstream,encoding:'utf8'}).trim(),pipeline=await readFile(join(upstream,'Compositor/Document/PixelAdjust.swift'),'utf8'),filterSource=await readFile(join(upstream,'Compositor/Document/Filters.swift'),'utf8')
if(!pipeline.includes('.workingColorSpace: NSNull()')||!filterSource.includes('settings.distance * job.scale * motionRadiusPerPixel'))throw Error('Native blur pipeline changed; inspect it before regenerating fixtures.')
const code=`import AppKit
import CoreImage
let space=CGColorSpace(name: CGColorSpace.sRGB)!
let ci=CIContext(options:[.workingColorSpace:NSNull(),.outputColorSpace:NSNull()])
let width=512,height=256
let samples:[[Int]]=[[0,0],[1,1],[64,32],[128,32],[256,32],[384,32],[511,32],[64,64],[128,64],[256,64],[384,64],[511,64],[0,128],[64,128],[128,128],[192,128],[240,128],[256,128],[272,128],[320,128],[384,128],[448,128],[511,128],[64,192],[128,192],[256,192],[384,192],[511,192],[0,255],[128,255],[256,255],[511,255]]
let specs:[(String,Double,Double)]=[("gaussianBlur",64,0),("gaussianBlur",128,0),("gaussianBlur",250,0),("motionBlur",300,0),("motionBlur",800,90),("motionBlur",2000,0),("motionBlur",800,45)]
var rows:[[String:Any]]=[]
for pattern in 0..<2 {
 let context=CGContext(data:nil,width:width,height:height,bitsPerComponent:8,bytesPerRow:width*4,space:space,bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue|CGBitmapInfo.byteOrder32Big.rawValue)!
 context.interpolationQuality = .none
 let input=context.data!.assumingMemoryBound(to:UInt8.self)
 for y in 0..<height {for x in 0..<width {let at=(y*width+x)*4
 if pattern == 0 {input[at]=UInt8(x<width/2 ? 230:30);input[at+1]=UInt8(y<height/2 ? 40:190);input[at+2]=UInt8((x/17+y/23)%2 == 0 ? 210:40);input[at+3]=255}
 else if x>=width/2-32 && x<width/2+32 && y>=height/2-32 && y<height/2+32 {input[at]=220;input[at+1]=80;input[at+2]=30;input[at+3]=255}
 }}
 let image=CIImage(cgImage:context.makeImage()!),extent=image.extent
 for (kind,amount,angle) in specs {
 let filtered=kind == "gaussianBlur" ? image.applyingGaussianBlur(sigma:amount):image.applyingFilter("CIMotionBlur",parameters:[kCIInputRadiusKey:amount/sqrt(12),kCIInputAngleKey:angle*Double.pi/180])
 let made=ci.createCGImage(filtered.cropped(to:extent),from:CGRect(x:0,y:0,width:width,height:height),format:.RGBA8,colorSpace:space)!
 let bitmap=CGContext(data:nil,width:width,height:height,bitsPerComponent:8,bytesPerRow:width*4,space:space,bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue|CGBitmapInfo.byteOrder32Big.rawValue)!
 bitmap.interpolationQuality = .none;bitmap.draw(made,in:CGRect(x:0,y:0,width:width,height:height))
 let output=bitmap.data!.assumingMemoryBound(to:UInt8.self),spec:[String:Any]=kind == "gaussianBlur" ? ["kind":kind,"radius":amount]:["kind":kind,"distance":amount,"angle":angle]
 rows.append(["pattern":pattern,"width":width,"height":height,"spec":spec,"samples":samples.map {point->[Int] in let at=(point[1]*width+point[0])*4;return point+(0..<4).map{Int(output[at+$0])}}])
 }
}
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject:["commit":"${commit}","pipeline":"Filters.swift Gaussian sigma / Motion distance divided by sqrt(12), PixelAdjust unmanaged RGBA8", "rows":rows],options:[.sortedKeys]))
`
const dir=await mkdtemp(join(tmpdir(),'compositor-large-blur-'));try{const path=join(dir,'oracle.swift');await writeFile(path,code);const output=execFileSync('swift',[path],{maxBuffer:2*1024*1024});await mkdir('fixtures/parity',{recursive:true});await writeFile('fixtures/parity/native-large-blur.json',output);console.log(`Generated ${JSON.parse(output.toString()).rows.length} independent native large-blur reference cases.`)}finally{await rm(dir,{recursive:true,force:true})}
