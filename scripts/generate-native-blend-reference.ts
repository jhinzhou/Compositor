import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

// Development-only oracle: compile the enum and render through the release's
// Core Graphics/Core Image paths. The generated JSON also runs on Windows.
const original = resolve(process.argv[2] ?? '../Compositor')
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: original, encoding: 'utf8' }).trim()
if (commit !== '24ef2885daae750537ec8d094f33e8556a8dfc9a') throw new Error('The oracle requires the exact official v1.4.8 tag.')
const appearance = await readFile(join(original, 'Compositor/Document/LayerAppearance.swift'), 'utf8')
const enumSource = appearance.slice(0, appearance.indexOf('\nextension EditorSession'))
const code = enumSource + `
import CoreImage
let space = CGColorSpace(name: CGColorSpace.sRGB)!
let context = CIContext(options: [.cacheIntermediates: false, .workingColorSpace: space])
func surface() -> CGContext {
  CGContext(data: nil, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4, space: space,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue)!
}
func fill(_ canvas: CGContext, _ rgba: [Int], _ opacity: Double = 1) {
  canvas.setFillColor(CGColor(colorSpace: space, components: rgba.map { CGFloat($0)/255 })!)
  canvas.setAlpha(opacity)
  canvas.fill(CGRect(x: 0,y: 0,width: 1,height: 1))
}
let inputs: [([Int], [Int], Double)] = [
 ([64,153,204,255],[204,102,51,255],1),
 ([38,117,225,255],[181,233,76,255],0.6),
 ([64,153,204,128],[204,102,51,192],0.5),
 ([0,0,0,0],[204,102,51,128],0.7),
 ([64,153,204,128],[204,102,51,0],1),
 ([0,255,128,255],[0,255,128,255],1),
 ([128,128,128,255],[128,128,128,255],1),
 ([17,206,94,213],[243,66,147,231],0.85)
]
var rows: [[String: Any]] = []
for mode in LayerBlendMode.allCases {
  for (destination, source, opacity) in inputs {
    let bottom = surface(); fill(bottom,destination)
    if let filterName = mode.coreImageFilter {
      let top = surface(); fill(top,source,opacity)
      let filter = CIFilter(name: filterName)!
      filter.setValue(CIImage(cgImage: top.makeImage()!),forKey:kCIInputImageKey)
      filter.setValue(CIImage(cgImage: bottom.makeImage()!),forKey:kCIInputBackgroundImageKey)
      let image = context.createCGImage(filter.outputImage!,from:CGRect(x:0,y:0,width:1,height:1),format:.RGBA8,colorSpace:space)!
      bottom.setBlendMode(.copy); bottom.setAlpha(1); bottom.draw(image,in:CGRect(x:0,y:0,width:1,height:1))
    } else {
      bottom.setBlendMode(mode.cgMode); fill(bottom,source,opacity)
    }
    let pixels = bottom.data!.assumingMemoryBound(to: UInt8.self)
    rows.append(["mode":mode.rawValue,"destination":destination,"source":source,"opacity":opacity,"expectedPremul":(0..<4).map{Int(pixels[$0])}])
  }
}
let output: [String:Any] = ["upstream":"v1.4.8","commit":"${commit}","renderer":"CoreGraphics + sRGB CoreImage using LayerBlendMode from release source","samples":rows]
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject:output,options:[.prettyPrinted,.sortedKeys]))
`
const temporary = await mkdtemp(join(tmpdir(), 'compositor-native-blends-'))
try {
  await writeFile(join(temporary, 'oracle.swift'), code)
  const result = execFileSync('swift', [join(temporary, 'oracle.swift')], { maxBuffer: 2 * 1024 * 1024 })
  await mkdir('fixtures/parity', { recursive: true })
  await writeFile('fixtures/parity/native-1.4.8-blends.json', result)
  console.log(`Generated ${JSON.parse(result.toString()).samples.length} native blend samples from ${commit}.`)
} finally { await rm(temporary, { recursive: true, force: true }) }
