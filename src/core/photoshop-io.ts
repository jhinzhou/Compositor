import {photoshopShapeStyle,photoshopShapeFallback} from './photoshop-vector'
import {photoshopAdjustment,exportPhotoshopAdjustment} from './photoshop-adjustments'
import {importPhotoshopEffects,exportPhotoshopEffects} from './photoshop-effects'
import {exportPhotoshopText,exportPhotoshopShape} from './photoshop-editable'
import { randomUUID } from 'node:crypto'
import { PNG } from 'pngjs'
import { getLayerImageData, getLayerMaskImageData, initializeCanvas, readPsd, writePsdBuffer, type BlendMode, type Color, type Layer as PhotoshopLayer, type LayerTextData, type PixelData, type Psd } from 'ag-psd'
import { BLEND_MODES, EditorError, LIMITS, manifestSchema, type Layer, type Manifest, type Transform } from '../shared/contracts'
import { makeAsset, type Asset } from './project-io'
import { validateManifest } from './manifest'
import { encodeRaster } from './raster-edit'
import { transformBounds } from './layer-operations'
import {fullCanvasMaskEdgeMode} from '../shared/mask-feather'
import {effectiveMaskPixels,effectiveMaskTransform,MAX_MASK_FEATHER} from '../shared/mask-properties'
import {validatePhotoshopChannels,normalizePhotoshopChannels} from './photoshop-channel-validation'
import {decodeOriginalPhotoshop16Pixels} from './photoshop-channel-validation'
import {inspectICC} from './foreign-color'
import {assertDeepAssetBudget,DEEP_ASSET_WORKING_BUDGET} from './deep-assets'

// ag-psd's ImageData allocation hook avoids Canvas alpha premultiplication and native Cairo dependencies.
initializeCanvas(() => { throw new Error('Photoshop I/O uses raw ImageData; Canvas must not be allocated.') }, (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }) as ImageData)
const nativeToPhotoshop = new Map<string, BlendMode>(BLEND_MODES.map(mode => [mode, (mode === 'Linear Dodge (Add)' ? 'linear dodge' : mode.toLowerCase()) as BlendMode]))
const photoshopToNative = new Map<string, string>([...nativeToPhotoshop].map(([native, photoshop]) => [photoshop, native]))
const placement = (x: number, y: number, width: number, height: number): Transform => ({ origin: [x, y], size: [width, height], rotation: 0, flipX: false, flipY: false, sampling: 'High quality' })
function dimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > LIMITS.maxSide || height > LIMITS.maxSide || width * height > LIMITS.maxSurfacePixels) throw new EditorError('RESOURCE_LIMIT', 'Photoshop image dimensions exceed this build’s resource limits.')
}
function header(bytes: Buffer): void {
  if (bytes.length < 26 || bytes.toString('ascii', 0, 4) !== '8BPS' || ![1, 2].includes(bytes.readUInt16BE(4))) throw new EditorError('INVALID_IMAGE', 'Select a valid PSD or PSB file.')
  if (bytes.length > LIMITS.maxAssetBytes) throw new EditorError('RESOURCE_LIMIT', 'The PSD/PSB file exceeds 512 MiB.')
  if (![8,16].includes(bytes.readUInt16BE(22)) || bytes.readUInt16BE(24) !== 3) throw new EditorError('UNSUPPORTED_FEATURE', 'PSD/PSB import supports 8-bit RGB and source-preserving 16-bit RGB. Other color modes and 32-bit HDR are not converted silently.')
  if (bytes.readUInt16BE(12) < 3 || bytes.readUInt16BE(12) > 56) throw new EditorError('INVALID_IMAGE', 'Invalid Photoshop channel count.')
  dimensions(bytes.readUInt32BE(18), bytes.readUInt32BE(14))
}
function pngFromPixels(image: PixelData, preserve16=false): PNG {
  dimensions(image.width, image.height)
  if (!(image.data instanceof Uint8Array || image.data instanceof Uint8ClampedArray || image.data instanceof Uint16Array) || image.data.length !== image.width * image.height * 4) throw new EditorError('UNSUPPORTED_FEATURE', 'Expected unpremultiplied 8/16-bit RGBA Photoshop pixels.')
  if(preserve16&&image.data instanceof Uint16Array)return {width:image.width,height:image.height,data:image.data} as unknown as PNG
  const png = new PNG({ width: image.width, height: image.height }); png.data = image.data instanceof Uint16Array ? Buffer.from(image.data.map(value=>Math.round(value/257))) : Buffer.from(image.data); return png
}
/** The pinned PSD library does not expose ICC1039. Inspect its bounded resource
 * block before decoding RGB pixels rather than silently relabeling a profile.
 * This first bridge only accepts a verified sRGB-equivalent matrix/TRC profile;
 * no profile conversion is performed, at either source depth.
 */
function photoshopProfileWarning(bytes:Buffer,depth:8|16):string{
 const invalid=(message:string):never=>{throw new EditorError('INVALID_IMAGE',`Invalid Photoshop color resources: ${message}.`)}
 if(bytes.length<30)invalid('truncated color mode length')
 let at=30+bytes.readUInt32BE(26);if(at+4>bytes.length)invalid('truncated resource length')
 const length=bytes.readUInt32BE(at);at+=4;const end=at+length;if(end>bytes.length)invalid('resource block exceeds file')
 let profile:Buffer|undefined,untagged=false,hasUntaggedFlag=false,count=0
 while(at<end){
  if(++count>16384||at+7>end||bytes.toString('ascii',at,at+4)!=='8BIM')invalid('invalid resource record')
  const id=bytes.readUInt16BE(at+4),nameLength=bytes[at+6],nameBytes=(nameLength+2)&~1;at+=6+nameBytes
  if(at+4>end)invalid('truncated resource name or size')
  const size=bytes.readUInt32BE(at);at+=4;if(at+size>end||at+size+(size%2)>end)invalid('resource payload exceeds block')
  if(id===1039){if(profile||size<132||size>1024*1024)invalid('invalid or duplicate ICC profile');profile=bytes.subarray(at,at+size)}
  if(id===1041){if(size!==1||hasUntaggedFlag)invalid('invalid or duplicate untagged-profile flag');hasUntaggedFlag=true;untagged=bytes[at]!==0}
  at+=size+(size%2)
 }
 if(!profile)return depth===16?'16-bit Photoshop document has no embedded ICC profile; source channel numbers are explicitly interpreted as sRGB without a color conversion.':'8-bit Photoshop document has no embedded ICC profile; source channel numbers are explicitly interpreted as sRGB without a color conversion.'
 const unsupported=()=>new EditorError('UNSUPPORTED_FEATURE',depth===16?'The 16-bit Photoshop document has a non-sRGB or unsupported ICC profile. Convert a separate copy to 16-bit sRGB in Photoshop before importing it.':'The 8-bit Photoshop document has a non-sRGB or unsupported ICC profile. Convert a separate copy to 8-bit sRGB in Photoshop before importing it.',{conversionPerformed:false,sourceBitDepth:depth})
 if(untagged)throw unsupported()
 try{
  const plan=inspectICC(profile)
  if(!plan.matrix||!plan.curves||plan.matrix.some((value,i)=>Math.abs(value-(i%4===0?1:0))>.002)||plan.curves.some(curve=>curve.some((value,i)=>{const x=i/255,expected=x<=.04045?x/12.92:((x+.055)/1.055)**2.4;return Math.abs(value-expected)>.0002})))throw unsupported()
 }catch(error){if(error instanceof EditorError)throw error;throw unsupported()}
 return depth===16?'16-bit Photoshop embedded ICC was verified as sRGB-equivalent; source channel numbers are preserved without a color conversion.':'8-bit Photoshop embedded ICC was verified as sRGB-equivalent; source channel numbers are preserved without a color conversion.'
}
function colorRGB(color?: Color): [number, number, number] {
  if (color && 'r' in color) return [color.r / 255, color.g / 255, color.b / 255]
  if (color && 'fr' in color) return [color.fr, color.fg, color.fb]
  return [0, 0, 0]
}
function convertText(source: LayerTextData, warnings: string[], name: string): Record<string, unknown> | undefined {
  if (source.orientation === 'vertical' || source.text.length > 100000 || source.textPath) { warnings.push(`${name}: unsupported vertical/path text remains a raster fallback.`); return }
  const [red, green, blue] = colorRGB(source.style?.fillColor), fontSize = source.style?.fontSize ?? 12
  const transform = source.transform ?? [1, 0, 0, 1, 0, 0], scale = Math.hypot(transform[0], transform[1]) || 1
  const content = source.text.replace(/\r/g, '\n').replace(/\n$/, ''), colorRuns: unknown[] = [], fontRuns: unknown[] = []
  let location = 0
  for (const run of source.styleRuns ?? []) {
    const length = Math.min(run.length, content.length - location)
    if (length > 0) {
      if (run.style.fillColor) { const rgb = colorRGB(run.style.fillColor); colorRuns.push({ location, length, red: rgb[0], green: rgb[1], blue: rgb[2] }) }
      if (run.style.font?.name) fontRuns.push({ location, length, fontName: run.style.font.name })
    }
    location += run.length
  }
  warnings.push(`${name}: text metadata converted; Photoshop font metrics, warp and advanced typography may differ when edited. The saved raster preserves the imported appearance.`)
  return { content, fontName: source.style?.font?.name ?? 'ArialMT', fontSize: Math.min(2000, Math.max(1, fontSize * scale)), red, green, blue, alignment: ['left', 'center', 'right'].includes(source.paragraphStyle?.justification ?? '') ? source.paragraphStyle!.justification!.replace(/^./, first => first.toUpperCase()) : 'Left', tracking: (source.style?.tracking ?? 0) / 1000 * fontSize * scale, leading: Math.max(0, Math.min(5000,(source.style?.leading ?? fontSize * 1.2) * scale)), ...(source.shapeType === 'box' && source.boxBounds?.length === 4 ? { boxSize: [Math.abs(source.boxBounds[2] - source.boxBounds[0]) * scale, Math.abs(source.boxBounds[3] - source.boxBounds[1]) * scale] } : {}), ...(colorRuns.length ? { colorRuns } : {}), ...(fontRuns.length ? { fontRuns } : {}) }
}
export function decodePhotoshop(input: Uint8Array): { manifest: Manifest; assets: Map<string, Asset>; warnings: string[] } {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength); header(bytes)
  const source16=bytes.readUInt16BE(22)===16,profileWarning=photoshopProfileWarning(bytes,source16?16:8)
  // Reserve bounded parser resource buffers separately from source/channel/PNG
  // allocations. Its strict mode also prevents padded allocation for truncated
  // raw channels; handler errors must not silently publish a partial Lr16 tree.
  const parserWorkingReserve=source16?64*1024*1024:0
  const encodedWorkingBytes=bytes.buffer.byteLength+bytes.byteLength
  if(source16&&encodedWorkingBytes+parserWorkingReserve>DEEP_ASSET_WORKING_BUDGET)throw new EditorError('RESOURCE_LIMIT','Photoshop 16-bit encoded source and parser buffers exceed the 512 MiB working budget.')
  let psd: Psd
  try { psd = readPsd(bytes, { useImageData: true, useRawData: true, skipCompositeImageData: true, skipThumbnail: true, skipLinkedFilesData: true, strict:source16,throwForMissingFeatures:source16,totalMemoryLimit:source16?parserWorkingReserve:LIMITS.maxPixels * 4, logMissingFeatures: false }) }
  catch (error) { const message=error instanceof Error?error.message:String(error);throw new EditorError(source16&&/Exceeded memory limit/.test(message)?'RESOURCE_LIMIT':'INVALID_IMAGE', `Unable to decode PSD/PSB: ${message}`) }
  const warnings: string[] = [profileWarning], assets = new Map<string, Asset>(), layers: Layer[] = []
  if(source16)warnings.push('16-bit RGB source channels are retained as PNG16 and edited with high-depth pixels. Photoshop raster masks remain 8-bit; PSD/PSB export remains 8-bit and requires an explicit layer depth conversion first.')
  let pixels = 0, count = 0
  function preflight(nodes: PhotoshopLayer[], depth = 0): void {
    if (depth > 64) throw new EditorError('RESOURCE_LIMIT', 'Photoshop folders exceed 64 levels.')
    for (const node of nodes) {
      if (++count > LIMITS.maxLayers) throw new EditorError('RESOURCE_LIMIT', 'Photoshop layer count exceeds this build’s limit.')
      const width = Math.max(0, (node.right ?? 0) - (node.left ?? 0)), height = Math.max(0, (node.bottom ?? 0) - (node.top ?? 0))
      if (width && height) { dimensions(width, height); pixels += width * height }
      for (const mask of [node.mask, node.realMask]) if (mask) { const width = Math.max(0, (mask.right ?? 0) - (mask.left ?? 0)), height = Math.max(0, (mask.bottom ?? 0) - (mask.top ?? 0)); if (width && height) { dimensions(width, height); pixels += width * height } }
      if (pixels > LIMITS.maxPixels) throw new EditorError('RESOURCE_LIMIT', 'Photoshop layers and masks exceed the document pixel budget.')
      if (node.children) preflight(node.children, depth + 1)
    }
  }
  preflight(psd.children ?? []); pixels = 0
  const validateChannels=(nodes:PhotoshopLayer[]):void=>{for(const node of nodes){validatePhotoshopChannels(node);if(node.children)validateChannels(node.children)}}
  validateChannels(psd.children??[])
  const deepWorking=(area:number)=>{
    if(!source16)return
    try{assertDeepAssetBudget(assets.values(),encodedWorkingBytes+parserWorkingReserve+area*64,DEEP_ASSET_WORKING_BUDGET)}catch(error){
      if(!(error instanceof EditorError))throw error
      throw new EditorError('RESOURCE_LIMIT','Photoshop 16-bit source, retained assets and channel/PNG/display buffers exceed the 512 MiB working budget.',error.details)
    }
  }
  function store(layer: Layer, png: PNG, mask = false): void {
    pixels += png.width * png.height
    if (pixels > LIMITS.maxPixels) throw new EditorError('RESOURCE_LIMIT', 'Converted Photoshop assets exceed the document pixel budget.')
    deepWorking(png.width*png.height)
    const file = `${layer.id}${mask ? '.mask' : ''}.png`,deep=!mask&&png.data instanceof Uint16Array
    const encoded=deep?PNG.sync.write(png,{bitDepth:16,colorType:6,inputColorType:6,inputHasAlpha:true}):encodeRaster(png,mask)
    assets.set(file, makeAsset(file, encoded,{allow16:deep}));deepWorking(0)
    if (mask) layer.maskFile = file; else layer.imageFile = file
  }
  function convert(nodes: PhotoshopLayer[], parentID?: string): void {
    let clippingBase: string | undefined
    for (const source of [...nodes].reverse()) {
      const group = source.children !== undefined, adjustment=photoshopAdjustment(source.adjustment), id = randomUUID().toUpperCase(), name = source.name?.trim().slice(0, 4096) || (group ? 'Folder' : 'Layer')
      if(source.adjustment&&!adjustment){warnings.push(`${name}: unsupported Photoshop adjustment ${source.adjustment.type} was skipped, matching the native importer.`);continue}
      const area=Math.max(0,(source.right??0)-(source.left??0))*Math.max(0,(source.bottom??0)-(source.top??0)),maskArea=Math.max(0,(source.mask?.right??0)-(source.mask?.left??0))*Math.max(0,(source.mask?.bottom??0)-(source.mask?.top??0))
      deepWorking(area+maskArea)
      const rasterSource=source16?source:normalizePhotoshopChannels(source)
      const raw = group||adjustment ? undefined : source16?decodeOriginalPhotoshop16Pixels(source):getLayerImageData(rasterSource), reconstructed=!group&&!adjustment&&!raw?photoshopShapeFallback(source,LIMITS.maxPixels-pixels):undefined,png = raw ? pngFromPixels(raw,source16) : reconstructed?.png
      if(reconstructed)warnings.push(`${name}: missing Photoshop raster reconstructed from editable basic shape metadata; antialiasing may differ.`)
      const transform = group||adjustment ? placement(0, 0, psd.width, psd.height) : placement(reconstructed?.origin[0]??source.left ?? 0, reconstructed?.origin[1]??source.top ?? 0, png?.width ?? Math.max(1, (source.right ?? 0) - (source.left ?? 0)), png?.height ?? Math.max(1, (source.bottom ?? 0) - (source.top ?? 0)))
      const blendMode = group ? 'Normal' : photoshopToNative.get(source.blendMode ?? 'normal') ?? 'Normal'
      if (group ? source.blendMode && source.blendMode !== 'normal' && source.blendMode !== 'pass through' : !photoshopToNative.has(source.blendMode ?? 'normal')) warnings.push(`${name}: unsupported ${source.blendMode} blending converted to Normal${group ? ' pass-through' : ''}.`)
      if(group&&source.blendMode==='normal')warnings.push(`${name}: isolated Normal group is previewed as pass-through in the editor; the original group blend is retained for unchanged PSD export.`)
      const layer: Layer = { id, name, isVisible: !source.hidden, isGroup: group, opacity: Math.max(0, Math.min(1, (source.opacity ?? 1) * (source.effects ? 1 : source.fillOpacity ?? 1))), blendMode, transform, ...(parentID ? { parentID } : {}) }
      if(source.protected){layer.locked=!!(source.protected.composite&&source.protected.position&&source.protected.transparency);layer.positionLocked=!!source.protected.position;if(!layer.locked&&(source.protected.composite||source.protected.transparency))warnings.push(`${name}: Photoshop pixel/transparency-only locks are preserved as metadata; the editor supports full and position locks.`)}
      if(adjustment){layer.adjustment=adjustment;warnings.push(`${name}: adjustment parameters converted to editable native ${adjustment.kind}; Photoshop rendering may differ.`)}
      if (!group&&!adjustment) {
        if (png) store(layer, png)
        else if (source.text || source.vectorFill || source.adjustment || source.placedLayer) throw new EditorError('UNSUPPORTED_FEATURE', `${name}: this Photoshop layer has no raster fallback. Render it in Photoshop before import.`)
        else store(layer, new PNG({ width: 1, height: 1 }))
        if (source.text && png) layer.text = convertText(source.text, warnings, name)
        if (source.vectorFill && png) { layer.shape = reconstructed?.style??photoshopShapeStyle(source); warnings.push(`${name}: ${layer.shape ? 'basic shape metadata converted' : 'vector shape imported as raster fallback'}.`) }
      }
      if (source.effects) layer.effects=importPhotoshopEffects(source.effects,warnings,name,psd.imageResources?.globalAngle)
      if(source.effects && source.fillOpacity !== undefined && source.fillOpacity !== 1)warnings.push(`${name}: independent Photoshop Fill opacity is retained for unchanged export; the editor cannot reproduce its separation from layer-effect opacity.`)
      if (source.placedLayer) warnings.push(`${name}: smart object imported as a raster; linked/embedded source files are not imported.`)
      if(source.vectorStroke?.strokeEnabled&&layer.shape)warnings.push(`${name}: Photoshop shape stroke was omitted, matching the native basic-shape conversion.`)
      if (source.vectorMask && !source.mask&&!reconstructed) warnings.push(`${name}: vector mask cannot be represented as an editable raster mask.`)
      if (source.realMask) warnings.push(`${name}: the additional real/vector-combined mask is not imported independently.`)
      const preserved:Record<string,unknown> = { ...(source.text ? { text: source.text, nativeTextSnapshot: structuredClone(layer.text) } : {}), ...(source.vectorFill ? { vectorFill: source.vectorFill,nativeShapeSnapshot:structuredClone(layer.shape) } : {}), ...(source.vectorOrigination ? { vectorOrigination: source.vectorOrigination } : {}), ...(source.vectorStroke ? {vectorStroke:source.vectorStroke} : {}), ...(source.vectorMask ? {vectorMask:source.vectorMask}:{}), ...(source.effects ? { effects: source.effects, nativeEffectsSnapshot: structuredClone(layer.effects),fillOpacity:source.fillOpacity } : {}), ...(source.adjustment ? { adjustment: source.adjustment } : {}), ...(source.protected?{protected:source.protected,nativeLockSnapshot:{locked:layer.locked,positionLocked:layer.positionLocked}}:{}),...(group&&source.blendMode?{groupBlend:source.blendMode,nativeGroupBlendSnapshot:layer.blendMode}:{}) }
      if (Object.keys(preserved).length) {preserved.nativeTransformSnapshot=structuredClone(transform);if(layer.imageFile)preserved.nativeRasterHash=assets.get(layer.imageFile)?.hash;layer.photoshop = preserved}
      if (source.mask) {
        deepWorking(area+maskArea)
        const patchData = source16?decodeOriginalPhotoshop16Pixels(source,'mask'):getLayerMaskImageData(rasterSource), patch = patchData ? pngFromPixels(patchData) : undefined
        const width = group||adjustment ? psd.width : png?.width ?? 1, height = group||adjustment ? psd.height : png?.height ?? 1
        dimensions(width, height)
        // A group's sparse mask patch can expand to the full document surface.
        // Include that allocation before constructing PNG, not only in store().
        deepWorking(area+maskArea+width*height)
        const mask = new PNG({ width, height }), gray = source.mask.defaultColor ?? 0
        for (let i = 0; i < mask.data.length; i += 4) mask.data.set([gray, gray, gray, 255], i)
        const left = (source.mask.left ?? 0) - transform.origin[0], top = (source.mask.top ?? 0) - transform.origin[1]
        if (patch) for (let y = 0; y < patch.height; y++) for (let x = 0; x < patch.width; x++) { const tx = x + left, ty = y + top; if (tx >= 0 && ty >= 0 && tx < width && ty < height) { const value = patch.data[(y * patch.width + x) * 4]; mask.data.set([value, value, value, 255], (ty * width + tx) * 4) } }
        store(layer, mask, true); layer.maskEnabled = !source.mask.disabled; layer.maskLinked = !source.mask.positionRelativeToLayer
        if (!layer.maskLinked) layer.maskPlacement = structuredClone(transform)
        layer.photoshopMaskDefault = gray;layer.maskFeatherModel='photoshop'
        // Sparse native patches are expanded above. That temporary full-size
        // raster does not establish a native full-canvas boundary.
        const fullNativeMask=patch&&fullCanvasMaskEdgeMode(patch,{...transform,origin:[source.mask.left??0,source.mask.top??0],size:[patch.width,patch.height]},psd)==='clamp'
        layer.maskFeatherEdgeMode=fullNativeMask?fullCanvasMaskEdgeMode({width,height},layer.maskPlacement??layer.transform,psd):'default'
        if(source.mask.userMaskDensity!==undefined)layer.maskDensity=Math.max(0,Math.min(1,source.mask.userMaskDensity))
        if(source.mask.userMaskFeather!==undefined)layer.maskFeather=Math.max(0,Math.min(MAX_MASK_FEATHER,source.mask.userMaskFeather))
        if (source.mask.userMaskFeather || source.mask.vectorMaskFeather || [source.mask.userMaskDensity,source.mask.vectorMaskDensity].some(value=>value!==undefined&&value!==1)) {
          const metadata=(layer.photoshop??={}) as Record<string,unknown>;metadata.maskParameters={userMaskDensity:source.mask.userMaskDensity,userMaskFeather:source.mask.userMaskFeather,vectorMaskDensity:source.mask.vectorMaskDensity,vectorMaskFeather:source.mask.vectorMaskFeather};metadata.nativeMaskHash=assets.get(layer.maskFile!)?.hash
          metadata.nativeMaskPropertiesSnapshot={density:layer.maskDensity,feather:layer.maskFeather,featherModel:layer.maskFeatherModel,featherEdgeMode:layer.maskFeatherEdgeMode}
          if((source.mask.userMaskFeather??0)>MAX_MASK_FEATHER)warnings.push(`${name}: mask feather above 250 source pixels is clamped for editor preview; unchanged export retains the source parameter.`)
          if(source.mask.vectorMaskFeather||source.mask.vectorMaskDensity!==undefined&&source.mask.vectorMaskDensity!==1)warnings.push(`${name}: vector-mask density/feather metadata is retained for unchanged export but is not independently editable.`)
        }
      }
      // Release expanded clone channels before recursing into child folders.
      if(rasterSource!==source)rasterSource.rawData=source.rawData
      if (source.clipping) { if (!group && clippingBase) layer.maskSourceID = clippingBase; else warnings.push(`${name}: unsupported clipping base was omitted.`) }
      else clippingBase = group ? undefined : layer.id
      layers.push(layer); if (source.children) convert(source.children, id)
    }
  }
  try { convert(psd.children ?? []) } catch (error) { if (error instanceof EditorError) throw error; throw new EditorError('INVALID_IMAGE', `Unable to decode Photoshop pixels: ${error instanceof Error ? error.message : String(error)}`) }
  if (!layers.length) throw new EditorError('UNSUPPORTED_FEATURE', 'The Photoshop file has no layer data. Import its flattened preview as an image instead.')
  const resolutionInfo = psd.imageResources?.resolutionInfo, resolution = resolutionInfo ? resolutionInfo.horizontalResolution * (resolutionInfo.horizontalResolutionUnit === 'PPCM' ? 2.54 : 1) : 72
  const manifest = manifestSchema.parse({ format: 'com.compositor.project', version: [...assets.values()].some(asset=>asset.bitDepth===16)?12:11, colorSpace: 'sRGB', documentID: randomUUID().toUpperCase(), width: psd.width, height: psd.height, resolution: Math.max(1, Math.min(9600, resolution)), layers, activeLayerID: [...layers].reverse().find(layer => !layer.isGroup)?.id, guides: (psd.imageResources?.gridAndGuidesInformation?.guides ?? []).slice(0, 1000).map(guide => ({ id: randomUUID().toUpperCase(), axis: guide.direction, position: guide.location })) })
  if(psd.imageResources?.globalAngle!==undefined||psd.imageResources?.globalAltitude!==undefined)manifest.photoshopDocument={globalAngle:psd.imageResources.globalAngle,globalAltitude:psd.imageResources.globalAltitude}
  if (Buffer.byteLength(JSON.stringify(manifest)) > LIMITS.maxManifestBytes) throw new EditorError('RESOURCE_LIMIT', 'Converted Photoshop metadata exceeds 4 MiB.')
  return { manifest, assets, warnings: [...new Set(warnings)] }
}

export type PhotoshopExportOptions = { psb?: boolean; compositePNG?: Uint8Array; onWarning?: (message: string) => void }
export function photoshopExportWarnings(manifest: Manifest): string[] {
  const warnings: string[] = []
  for (const layer of manifest.layers) {
    if(layer.adjustment)warnings.push(exportPhotoshopAdjustment(layer.adjustment)?`${layer.name}: editable Photoshop adjustment exported; Photoshop rendering may differ.`:`${layer.name}: this adjustment cannot be exported as an independent Photoshop adjustment; only the merged preview includes it.`)
    if(layer.effects)warnings.push(`${layer.name}: editable Photoshop layer effects exported; the Photoshop effect renderer may differ.`)
    const metadata=layer.photoshop&&typeof layer.photoshop==='object'?layer.photoshop as Record<string,unknown>:{}
    if(layer.isGroup&&typeof metadata.groupBlend==='string'&&metadata.groupBlend!=='pass through'&&metadata.nativeGroupBlendSnapshot===layer.blendMode)warnings.push(`${layer.name}: the original Photoshop group blend is restored in PSD; the editor pass-through preview may differ.`)
    if(metadata.effects&&JSON.stringify(metadata.nativeEffectsSnapshot)!==JSON.stringify(layer.effects))warnings.push(`${layer.name}: editing native effects replaces the original Photoshop effect descriptors; unsupported or multiple source styles are not retained after this edit.`)
    if(layer.text)warnings.push(`${layer.name}: editable horizontal text and raster fallback exported; font metrics, baseline and paragraph wrapping may differ when Photoshop rerenders it.`)
    if(layer.shape)warnings.push((layer.shape as Record<string,unknown>).kind==='Line'?`${layer.name}: line exported as raster pixels; editable stroked paths are not yet supported.`:`${layer.name}: editable basic vector shape and raster fallback exported; edge antialiasing may differ.`)
    if (layer.transform.rotation || layer.transform.flipX || layer.transform.flipY || layer.transform.size.some(value => !Number.isInteger(value))) warnings.push(`${layer.name}: transformed pixels baked into an axis-aligned Photoshop layer.`)
  }
  return warnings
}
function sampledPixels(png: PNG, transform: Transform): { image: PixelData; left: number; top: number } {
  if (!transform.rotation && !transform.flipX && !transform.flipY && transform.size[0] === png.width && transform.size[1] === png.height && transform.origin.every(Number.isInteger)) return { image: { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) }, left: transform.origin[0], top: transform.origin[1] }
  const box = transformBounds(transform), left = Math.floor(box.x), top = Math.floor(box.y), width = Math.max(1, Math.ceil(box.x + box.width) - left), height = Math.max(1, Math.ceil(box.y + box.height) - top)
  dimensions(width, height)
  const data = new Uint8ClampedArray(width * height * 4), angle = -transform.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = left + x + .5 - transform.origin[0] - transform.size[0] / 2, dy = top + y + .5 - transform.origin[1] - transform.size[1] / 2
    const u = (dx * cos - dy * sin) * (transform.flipX ? -1 : 1) / transform.size[0] + .5, v = (dx * sin + dy * cos) * (transform.flipY ? -1 : 1) / transform.size[1] + .5
    if (u < 0 || u >= 1 || v < 0 || v >= 1) continue
    const sx = u * png.width - .5, sy = v * png.height - .5, index = (y * width + x) * 4
    if (transform.sampling === 'Nearest') { const at = (Math.min(png.height - 1, Math.floor(v * png.height)) * png.width + Math.min(png.width - 1, Math.floor(u * png.width))) * 4; data.set(png.data.subarray(at, at + 4), index); continue }
    const x0 = Math.floor(sx), y0 = Math.floor(sy), tx = sx - x0, ty = sy - y0; let alpha = 0; const rgb = [0, 0, 0]
    for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 2; xx++) { const at = (Math.max(0, Math.min(png.height - 1, y0 + yy)) * png.width + Math.max(0, Math.min(png.width - 1, x0 + xx))) * 4, weight = (xx ? tx : 1 - tx) * (yy ? ty : 1 - ty), a = png.data[at + 3] / 255; alpha += a * weight; for (let c = 0; c < 3; c++) rgb[c] += png.data[at + c] * a * weight }
    data[index + 3] = Math.round(alpha * 255); for (let c = 0; c < 3; c++) data[index + c] = alpha ? Math.round(rgb[c] / alpha) : 0
  }
  return { image: { width, height, data }, left, top }
}
export function encodePhotoshop(input: Manifest, assets: Map<string, Asset>, options: PhotoshopExportOptions = {}): Buffer {
  const manifest = validateManifest(input).manifest, warnings = photoshopExportWarnings(manifest)
  if(manifest.layers.some(layer=>layer.imageFile&&assets.get(layer.imageFile)?.bitDepth===16))throw new EditorError('UNSUPPORTED_FEATURE','PSD/PSB export currently writes 8-bit channels. Explicitly convert a separate copy of the 16-bit layers to 8-bit first, or save a .comp project to retain source precision.')
  for (const warning of warnings) options.onWarning?.(warning)
  let pixels = 0
  const reserve = (image: PixelData) => { pixels += image.width * image.height; if (pixels > LIMITS.maxPixels) throw new EditorError('RESOURCE_LIMIT', 'Exported Photoshop surfaces exceed the document pixel budget.') }
  const png = (file: string): PNG => { const asset = assets.get(file); if (!asset) throw new EditorError('INVALID_PROJECT', `Missing Photoshop export asset ${file}.`); makeAsset(file, asset.bytes); return PNG.sync.read(asset.bytes) }
  function tree(parentID?: string, depth = 0): PhotoshopLayer[] {
    if (depth > 64) throw new EditorError('INVALID_PROJECT', 'Photoshop export folder depth exceeded.')
    const result: PhotoshopLayer[] = []; let base: string | undefined
    for (const layer of manifest.layers.filter(layer => layer.parentID === parentID)) {
      if (layer.maskSourceID && layer.maskSourceID !== base) throw new EditorError('UNSUPPORTED_FEATURE', `${layer.name}: Photoshop clipping requires a consecutive sibling base. Rasterize this clipping relationship before export.`)
      if (!layer.maskSourceID) base = layer.isGroup ? undefined : layer.id
      const target: PhotoshopLayer = { name: layer.name, opacity: layer.opacity, hidden: !layer.isVisible, blendMode: layer.isGroup ? 'pass through' : nativeToPhotoshop.get(layer.blendMode)!, clipping: !!layer.maskSourceID }
      if (layer.isGroup) target.children = tree(layer.id, depth + 1)
      else if (layer.imageFile) { const source=png(layer.imageFile),sampled = sampledPixels(source, layer.transform); reserve(sampled.image); target.imageData = sampled.image; target.left = sampled.left; target.top = sampled.top;target.text=exportPhotoshopText(layer,source.width,source.height,assets.get(layer.imageFile)?.hash);Object.assign(target,exportPhotoshopShape(layer,source.width,source.height)) }
      if(layer.adjustment)target.adjustment=exportPhotoshopAdjustment(layer.adjustment)
      const metadata=layer.photoshop&&typeof layer.photoshop==='object'?layer.photoshop as Record<string,unknown>:{}
      if(layer.isGroup&&typeof metadata.groupBlend==='string'&&metadata.nativeGroupBlendSnapshot===layer.blendMode&&(metadata.groupBlend==='pass through'||photoshopToNative.has(metadata.groupBlend)))target.blendMode=metadata.groupBlend as BlendMode
      // Arbitrary source vectors can round-trip only while their saved appearance,
      // native geometry and editable basic-shape properties remain untouched.
      if((metadata.vectorFill||metadata.vectorMask)&&metadata.nativeRasterHash===assets.get(layer.imageFile??'')?.hash&&JSON.stringify(metadata.nativeTransformSnapshot)===JSON.stringify(layer.transform)&&JSON.stringify(metadata.nativeShapeSnapshot)===JSON.stringify(layer.shape))for(const key of ['vectorFill','vectorMask','vectorOrigination','vectorStroke'] as const)if(metadata[key])target[key]=structuredClone(metadata[key]) as never
      if(metadata.protected&&JSON.stringify(metadata.nativeLockSnapshot)===JSON.stringify({locked:layer.locked,positionLocked:layer.positionLocked}))target.protected=structuredClone(metadata.protected) as PhotoshopLayer['protected']
      else if(layer.locked===true||layer.positionLocked===true)target.protected={transparency:layer.locked===true,composite:layer.locked===true,position:layer.locked===true||layer.positionLocked===true}
      if(metadata.effects&&JSON.stringify(metadata.nativeEffectsSnapshot)===JSON.stringify(layer.effects)){
        target.effects=structuredClone(metadata.effects) as PhotoshopLayer['effects'];if(typeof metadata.fillOpacity==='number')target.fillOpacity=metadata.fillOpacity
      }else if(layer.effects)target.effects=exportPhotoshopEffects(layer.effects)
      if (layer.maskFile) {
        const source = png(layer.maskFile), maskTransform = layer.maskLinked === false && layer.maskPlacement ? layer.maskPlacement : layer.transform
        const sx=maskTransform.size[0]/source.width,sy=maskTransform.size[1]/source.height,nonuniformFeather=(layer.maskFeather??0)>0&&(source.width>1||source.height>1)&&Math.abs(sx-sy)>1e-6
        let raster=source,placement=maskTransform
        if(nonuniformFeather){const effective=effectiveMaskPixels({width:source.width,height:source.height,data:new Uint8ClampedArray(source.data)},layer);raster=new PNG({width:effective.image.width,height:effective.image.height});raster.data.set(effective.image.data);placement=effectiveMaskTransform(maskTransform,source,effective.inset);options.onWarning?.(`${layer.name}: nonuniform mask scaling bakes feather/density into PSD mask pixels; the project source mask stays editable.`)}
        const sampled = sampledPixels(raster, placement); reserve(sampled.image)
        let edge = 0, count = 0
        for (let x = 0; x < source.width; x++) { edge += source.data[x * 4] + source.data[((source.height - 1) * source.width + x) * 4]; count += 2 }
        for (let y = 0; y < source.height; y++) { edge += source.data[(y * source.width) * 4] + source.data[(y * source.width + source.width - 1) * 4]; count += 2 }
        const rawBackground = typeof layer.photoshopMaskDefault === 'number' ? layer.photoshopMaskDefault : edge / count >= 127.5 ? 255 : 0,background=nonuniformFeather?Math.round(255+(rawBackground-255)*(layer.maskDensity??1)):rawBackground
        for (let i = 0; i < sampled.image.data.length; i += 4) { const value = sampled.image.data[i + 3] ? sampled.image.data[i] : background; sampled.image.data.set([value, value, value, 255], i) }
        target.mask = { top: sampled.top, left: sampled.left, bottom: sampled.top + sampled.image.height, right: sampled.left + sampled.image.width, imageData: sampled.image, disabled: layer.maskEnabled === false, positionRelativeToLayer: layer.maskLinked === false, defaultColor: background }
        if(metadata.maskParameters&&metadata.nativeMaskHash===assets.get(layer.maskFile)?.hash)Object.assign(target.mask,structuredClone(metadata.maskParameters))
        if(nonuniformFeather){delete target.mask.userMaskDensity;delete target.mask.userMaskFeather}
        else{
          if(layer.maskDensity!==undefined)target.mask.userMaskDensity=layer.maskDensity
          if(layer.maskFeather!==undefined){const original=(metadata.maskParameters as {userMaskFeather?:number}|undefined)?.userMaskFeather,unchanged=metadata.nativeMaskHash===assets.get(layer.maskFile)?.hash&&JSON.stringify(metadata.nativeMaskPropertiesSnapshot)===JSON.stringify({density:layer.maskDensity,feather:layer.maskFeather,featherModel:layer.maskFeatherModel,featherEdgeMode:layer.maskFeatherEdgeMode});target.mask.userMaskFeather=unchanged&&original!==undefined&&original>MAX_MASK_FEATHER?original:source.width===1&&source.height===1?0:layer.maskFeather*sx}
        }
      }
      result.unshift(target)
    }
    return result
  }
  const psd: Psd = { width: manifest.width, height: manifest.height, bitsPerChannel: 8, children: tree(), imageResources: { resolutionInfo: { horizontalResolution: manifest.resolution, horizontalResolutionUnit: 'PPI', widthUnit: 'Inches', verticalResolution: manifest.resolution, verticalResolutionUnit: 'PPI', heightUnit: 'Inches' }, gridAndGuidesInformation: { guides: (manifest.guides ?? []).filter(guide => guide.position >= 0).map(guide => ({ location: guide.position, direction: guide.axis })) } } }
  const documentMetadata=manifest.photoshopDocument&&typeof manifest.photoshopDocument==='object'?manifest.photoshopDocument as Record<string,unknown>:{}
  for(const key of ['globalAngle','globalAltitude'] as const)if(typeof documentMetadata[key]==='number'&&Number.isFinite(documentMetadata[key]))psd.imageResources![key]=documentMetadata[key] as number
  if (options.compositePNG) { const image = PNG.sync.read(Buffer.from(options.compositePNG)); if (image.width !== manifest.width || image.height !== manifest.height) throw new EditorError('INVALID_ARGUMENT', 'Photoshop composite must match the document dimensions.'); psd.imageData = { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) } }
  else options.onWarning?.('No merged preview supplied. Photoshop can reconstruct the layers, but applications that only show the composite will not show the document correctly.')
  try { const bytes = writePsdBuffer(psd, { psb: options.psb, trimImageData: false, noBackground: true, generateThumbnail: false }); if (bytes.length > LIMITS.maxAssetBytes) throw new EditorError('RESOURCE_LIMIT', 'Exported Photoshop file exceeds 512 MiB.'); return bytes }
  catch (error) { if (error instanceof EditorError) throw error; throw new EditorError('EXPORT_FAILED', `Unable to encode PSD/PSB: ${error instanceof Error ? error.message : String(error)}`) }
}
