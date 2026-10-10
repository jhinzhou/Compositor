import {readFile,writeFile,mkdtemp,mkdir,rm} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {execFileSync} from 'node:child_process'
const original=resolve(process.argv[2]??'../Compositor'),sourceProject=resolve(process.argv[3]??'artifacts/native-project/electron.comp'),destination=resolve(process.argv[4]??'artifacts/native-project/native.comp')
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:original,encoding:'utf8'}).trim();if(commit!=='24ef2885daae750537ec8d094f33e8556a8dfc9a')throw Error('Native project oracle requires the exact official v1.4.8 tag.')
function block(source:string,marker:string):string {const start=source.indexOf(marker);if(start<0)throw Error(`Missing source declaration ${marker}`);let index=source.indexOf('{',start),depth=0,quoted=false,lineComment=false,comment=0;const opening=index;for(;index<source.length;index++){const c=source[index],next=source[index+1];if(lineComment){if(c==='\n')lineComment=false;continue}if(comment){if(c==='/'&&next==='*'){comment++;index++}else if(c==='*'&&next==='/'){comment--;index++}continue}if(quoted){if(c==='\\'){index++;continue}if(c==='"')quoted=false;continue}if(c==='/'&&next==='/'){lineComment=true;index++;continue}if(c==='/'&&next==='*'){comment=1;index++;continue}if(c==='"'){quoted=true;continue}if(c==='{')depth++;else if(c==='}'&&--depth===0)return source.slice(start,index+1)}throw Error(`Unclosed declaration at ${opening}`)}
const read=(file:string)=>readFile(join(original,'Compositor',file),'utf8'),sources:Record<string,string>={};async function get(file:string){return sources[file]??(sources[file]=await read(file))}
const declarations:string[]=[],extractions:{file:string;declarations:string[];omitted?:string[]}[]=[]
async function add(file:string,markers:string[],omit:string[]=[]){const source=await get(file);for(const marker of markers){let text=block(source,marker);for(const method of omit)while(text.includes(method)){const omitted=block(text,method);text=text.replace(omitted,'')}declarations.push(text)}extractions.push({file,declarations:markers,...(omit.length?{omitted:omit}: {})})}
await add('Document/DocumentLimits.swift',['nonisolated enum DocumentLimits'])
await add('Document/ColorPalette.swift',['nonisolated struct PaletteColor'])
await add('Document/LayerAppearance.swift',['nonisolated enum LayerBlendMode'])
await add('Document/LayerTransform.swift',['nonisolated enum LayerSampling','nonisolated struct LayerTransform'])
const brush=await get('Document/BrushStroke.swift')
declarations.push('enum BrushRaster {\n'+block(brush,'static func pixelToDocument(')+'\n}');extractions.push({file:'Document/BrushStroke.swift',declarations:['BrushRaster.pixelToDocument']})
await add('Document/Guides.swift',['nonisolated struct CanvasGuide'])
await add('Document/TypeTool.swift',['nonisolated enum TextAlignment','nonisolated struct LayerTextStyle','nonisolated struct LayerTextColorRun','nonisolated struct LayerTextFontRun'])
await add('Document/ShapeTool.swift',['nonisolated enum ShapeKind','nonisolated struct LayerShapeStyle'])
await add('Document/Levels.swift',['nonisolated enum LevelsChannel','nonisolated struct LevelRange','nonisolated struct LevelsSettings'])
await add('Document/Curves.swift',['nonisolated struct CurvePoint','nonisolated struct CurvesSettings'],['func apply(_ image: CGImage'])
await add('Document/HueSaturation.swift',['nonisolated enum ColorRange','nonisolated struct HueBand','nonisolated struct RangeAdjustment','nonisolated struct HueSaturationSettings'])
const adjustments=await get('Document/ImageAdjustments.swift');declarations.push('enum ImageAdjustmentPixels {\n'+block(adjustments,'static func clamp(')+'\n}')
await add('Document/ImageAdjustments.swift',['nonisolated struct AdjustmentColor','nonisolated struct ExposureSettings','nonisolated struct GradientMapSettings','nonisolated struct BlackWhiteSettings','nonisolated struct ColorBalanceSettings','nonisolated struct GrainSettings'],['func apply(_ image: CGImage'])
const filter=await get('Document/Filters.swift'),filterStart=filter.indexOf('nonisolated enum FilterKind'),filterEnd=filter.indexOf('    var isAutomatic',filterStart);declarations.push(filter.slice(filterStart,filterEnd)+'}')
await add('Document/LayerAdjustment.swift',['nonisolated enum AdjustmentKind','nonisolated struct LayerAdjustment'],['func apply(_ image: CGImage'])
await add('Document/LayerEffects.swift',['nonisolated struct StrokeEffect','nonisolated struct ShadowEffect','nonisolated struct ColorOverlayEffect','nonisolated struct InnerShadowEffect','nonisolated struct OuterGlowEffect','nonisolated struct InnerGlowEffect','nonisolated struct LayerEffects','nonisolated enum LayerEffectKind'])
await add('Document/LayerGroups.swift',['nonisolated enum LayerHierarchy'])
await add('Document/LiveLayerMask.swift',['nonisolated enum LiveMaskGraph'])
await add('IO/ImageImporter.swift',['nonisolated struct ImportedImage'])
await add('IO/ImageExporter.swift',['nonisolated struct QuickLookImages'])
const mask=block(await get('Document/LayerMask.swift'),'nonisolated struct LayerMask');declarations.push(mask.slice(0,mask.indexOf('    static func solid('))+'}')
const store=await get('IO/ProjectStore.swift');declarations.push(store);extractions.push({file:'IO/ProjectStore.swift',declarations:['entire original file']})
const driver=`
@main struct NativeProjectOracle {
 static func main() async throws {
  let input=URL(fileURLWithPath:CommandLine.arguments[1]),output=URL(fileURLWithPath:CommandLine.arguments[2])
  let snapshot=try await ProjectStore.shared.load(from:input)
  try await ProjectStore.shared.save(snapshot,to:output)
  let reopened=try await ProjectStore.shared.load(from:output)
  let encoder=JSONEncoder();encoder.outputFormatting=[.prettyPrinted,.sortedKeys]
  FileHandle.standardOutput.write(try encoder.encode(reopened.manifest))
 }
}
`
const temporary=await mkdtemp(join(tmpdir(),'compositor-project-oracle-')),swift=join(temporary,'oracle.swift'),binary=join(temporary,'native-project')
// RasterSnapshot is never accessed by ProjectStore; ImportedImage leaves the optional field nil.
const license=await readFile(join(original,'LICENSE'),'utf8')
const source='/* Extracted from Compositor v1.4.8 for native file-format verification.\n'+license+'\n*/\nimport Foundation\nimport AppKit\nimport CoreGraphics\nimport CoreImage\nimport ImageIO\nimport UniformTypeIdentifiers\nstruct RasterSnapshot {}\n'+declarations.join('\n\n')+driver
await mkdir('artifacts/native-project',{recursive:true});await writeFile('artifacts/native-project/native-oracle.swift',source);await writeFile('artifacts/native-project/extraction.json',JSON.stringify({upstream:'v1.4.8',commit,extractions,scope:'Original ProjectStore.load/save, original native Codable data types and validation; unused image-filter apply methods excluded. This is file acceptance/roundtrip, not GUI or rendered pixel parity.'},null,2));await writeFile(swift,source)
try {
 execFileSync('swiftc',['-parse-as-library',swift,'-o',binary],{stdio:'inherit'});const output=execFileSync(binary,[sourceProject,destination],{maxBuffer:4*1024*1024});await writeFile('artifacts/native-project/native-manifest.json',output);console.log(`Native v1.4.8 ProjectStore load/save accepted ${sourceProject}; roundtrip written to ${destination}`)
} finally {await rm(temporary,{recursive:true,force:true})}
