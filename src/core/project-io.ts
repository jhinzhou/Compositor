import {totalmem} from 'node:os'
import {documentPixelBudget} from '../shared/limits'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { PNG } from 'pngjs'
import { EditorError, LIMITS, type AssetInfo, type Manifest } from '../shared/contracts'
import { validateManifest } from './manifest'
import {assertDeepAssetBudget,assertPNGWorkingBudget,boundInterlacedPNG,decodeDeepPNG,deepAssetWorkingBytes,deepDisplayPNG,encodeDeepPNG,inspectPNG,pngHash} from './deep-assets'
import {decodeEXR,encodeEXR,inspectEXR} from './hdr-codecs'
import {hdrAssetWorkingBytes,hdrDisplayPNG} from './hdr-assets'
import {validateHDRPixels} from '../shared/hdr-pixels'

export interface Asset extends AssetInfo { bytes: Buffer; deep?: Uint16Array; hdr?:Float32Array; displayBytes?: Buffer }
export async function writeDurable(path: string, bytes: string | Buffer): Promise<void> {
  const handle = await open(path, 'w', 0o600)
  try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
}
export function projectFingerprint(manifest: Manifest, assets: Map<string, Asset>): string {
  const hash = createHash('sha256').update(JSON.stringify(manifest))
  for (const [file, asset] of [...assets].sort(([a], [b]) => a.localeCompare(b))) hash.update(file).update(asset.hash)
  return hash.digest('hex')
}
export async function fingerprintProject(path: string, retainedAssets?: Iterable<Asset>): Promise<string> {
  const loaded = await loadProject(path,{retainedAssets})
  return projectFingerprint(loaded.manifest, loaded.assets)
}
export function makeAsset(file: string, bytes: Buffer, options: {allow16?:boolean;allowHDR?:boolean} = {}): Asset {
  if(file.endsWith('.exr')){if(!options.allowHDR)throw new EditorError('UNSUPPORTED_FEATURE','OpenEXR assets require a version 13 project.');return makeAssetEXR(file,bytes)}
  const header=inspectPNG(bytes)
  if(header.bitDepth===16){
    if(!options.allow16)throw new EditorError('UNSUPPORTED_FEATURE','16-bit PNG assets require a version 12 project.')
    const {width,height,deep}=decodeDeepPNG(bytes),displayBytes=deepDisplayPNG(width,height,deep)
    return {file,width,height,bytes:Buffer.from(bytes),hash:pngHash(bytes),deep,displayBytes,bitDepth:16,displayHash:pngHash(displayBytes),pixelFormat:'rgba16-premultiplied-srgb'}
  }
  assertPNGWorkingBudget(bytes,header);boundInterlacedPNG(bytes,header)
  try { PNG.sync.read(bytes, { checkCRC: true }) } catch { throw new EditorError('INVALID_PROJECT', 'The PNG image is damaged.') }
  return { file, width:header.width, height:header.height, hash:pngHash(bytes), bytes:Buffer.from(bytes) }
}
/** New immutable editing version: encode from RGBA16, never from its display proxy. */
export function makeDeepAsset(file:string,width:number,height:number,deep:Uint16Array):Asset {
 const bytes=encodeDeepPNG(width,height,deep),displayBytes=deepDisplayPNG(width,height,deep)
 return {file,width,height,bytes,hash:pngHash(bytes),deep,displayBytes,bitDepth:16,displayHash:pngHash(displayBytes),pixelFormat:'rgba16-premultiplied-srgb'}
}
/** An existing EXR keeps its source bytes, including HALF/FLOAT and metadata.
 * Even a sub-white EXR remains HDR-capable until explicit depth conversion.
 */
export function makeAssetEXR(file:string,bytes:Buffer):Asset {
 if(!file.endsWith('.exr'))throw new EditorError('INVALID_ARGUMENT','An HDR source asset requires an .exr filename.')
 hdrAssetWorkingBytes(bytes)
 const {width,height,hdr}=decodeEXR(bytes),displayBytes=hdrDisplayPNG(width,height,hdr)
 return {file,width,height,bytes:Buffer.from(bytes),hash:pngHash(bytes),hdr,displayBytes,bitDepth:16,isHDR:true,displayHash:pngHash(displayBytes),pixelFormat:'rgba32f-premultiplied-extended-srgb'}
}
/** FLOAT+ZIP preserves finite working precision without HALF scene-linear clipping. */
export function makeHDRAsset(file:string,width:number,height:number,hdr:Float32Array):Asset {
 if(!file.endsWith('.exr'))throw new EditorError('INVALID_ARGUMENT','An HDR asset requires an .exr filename.')
 validateHDRPixels(hdr,width,height,48)
 const bytes=encodeEXR(width,height,hdr,{pixelType:'float',compression:'zip'}),displayBytes=hdrDisplayPNG(width,height,hdr)
 return {file,width,height,bytes,hash:pngHash(bytes),hdr,displayBytes,bitDepth:16,isHDR:true,displayHash:pngHash(displayBytes),pixelFormat:'rgba32f-premultiplied-extended-srgb'}
}
async function regularFile(path: string, root: string, maximum: number): Promise<Buffer> {
  const stat = await lstat(path)
  const actual = await realpath(path), base = await realpath(root)
  if (stat.isSymbolicLink() || !stat.isFile() || !actual.startsWith(base + sep)) throw new EditorError('INVALID_PROJECT', 'Project assets must be regular files inside the project.')
  if (stat.size > maximum) throw new EditorError('RESOURCE_LIMIT', 'The project resource exceeds the file size limit.')
  return readFile(path)
}
export async function loadProject(path: string, options: {retainedAssets?: Iterable<Asset>} = {}): Promise<{ manifest: Manifest; assets: Map<string, Asset>; warnings: string[] }> {
  const stat = await lstat(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new EditorError('INVALID_PROJECT', 'Select a .comp project directory.')
  const raw = await regularFile(join(path, 'manifest.json'), path, LIMITS.maxManifestBytes)
  let input: unknown
  try { input = JSON.parse(raw.toString('utf8')) } catch { throw new EditorError('INVALID_PROJECT', 'The project manifest is not valid JSON.') }
  // v12 adds PNG16; v13 adds EXR. Validate the declared version before loading.
  const { manifest, warnings } = validateManifest(input),declaredVersion=manifest.version
  const assets = new Map<string, Asset>()
  const retainedAssets=[...(options.retainedAssets??[])],hasRetainedDeep=retainedAssets.some(asset=>!!asset.deep||!!asset.hdr)
  let pixels = 0,hasDeep=false,hasHDR=false
  for (const layer of manifest.layers) {
    for (const file of [layer.imageFile, layer.maskFile]) {
      if (!file || assets.has(file)) continue
      const bytes = await regularFile(join(path, 'images', file), path, LIMITS.maxAssetBytes)
      const mask=file===layer.maskFile
      const exr=file.endsWith('.exr')
      if(exr&&(mask||declaredVersion<13))throw new EditorError('INVALID_PROJECT','Only version 13 image layers can use EXR assets.')
      const header=exr?{...inspectEXR(bytes),bitDepth:16,colorType:-1}:inspectPNG(bytes)
      if(mask&&(header.bitDepth!==8||header.colorType!==0))throw new EditorError('INVALID_PROJECT','Layer masks must be 8-bit grayscale PNG without alpha.')
      if(declaredVersion<12&&header.bitDepth===16)throw new EditorError('UNSUPPORTED_FEATURE','16-bit PNG assets require a version 12 project.')
      pixels+=header.width*header.height
      if(pixels>documentPixelBudget(totalmem()))throw new EditorError('RESOURCE_LIMIT','The project’s image assets exceed the document raster budget.')
      const working=exr?hdrAssetWorkingBytes(bytes):header.bitDepth===16?deepAssetWorkingBytes(bytes,header as ReturnType<typeof inspectPNG>):bytes.length*2+header.width*header.height*20+header.height*7
      if(hasDeep||hasRetainedDeep||header.bitDepth===16)assertDeepAssetBudget([...retainedAssets,...assets.values()],working)
      const asset=makeAsset(file,bytes,{allow16:declaredVersion>=12&&!mask,allowHDR:declaredVersion>=13&&!mask})
      assets.set(file,asset);hasDeep ||= !!asset.deep||!!asset.hdr;hasHDR ||= !!asset.hdr
      if(hasDeep||hasRetainedDeep)assertDeepAssetBudget([...retainedAssets,...assets.values()])
    }
  }
  manifest.version=hasHDR?13:hasDeep?12:declaredVersion>=12?11:declaredVersion
  if(hasHDR)warnings.push('Version 13 EXR image sources and floating HDR highlights are preserved. The canvas uses a separate clipped SDR display proxy. Sub-white EXR sources remain HDR-capable until explicit depth conversion.')
  else if(hasDeep)warnings.push('Version 12 high-depth image assets are preserved. The canvas uses an 8-bit display proxy; only supported high-depth pixel edits are enabled; other edits are blocked to retain original 16-bit data.')
  else if(declaredVersion>=12)warnings.push(`Version ${declaredVersion} project contains only 8-bit image assets and was loaded into the version 11 RGBA8 editing format. Saving writes version 11.`)
  return { manifest, assets, warnings }
}

// Save As only: rename a fully written sibling into a previously nonexistent destination.
// Existing packages are never replaced by this initial implementation.
export async function saveProject(path: string, manifest: Manifest, assets: Map<string, Asset>, previewJPEG?:Buffer): Promise<string> {
  const destination = resolve(path.endsWith('.comp') ? path : `${path}.comp`)
  const referenced=new Set(manifest.layers.flatMap(layer=>[layer.imageFile,layer.maskFile].filter((file):file is string=>!!file)))
  const hasHDR=[...referenced].some(file=>!!assets.get(file)?.hdr),hasDeep=hasHDR||[...referenced].some(file=>!!assets.get(file)?.deep)
  if(hasDeep)assertDeepAssetBudget([...referenced].map(file=>assets.get(file)).filter((asset):asset is Asset=>!!asset))
  const output={...manifest,version:hasHDR?13:hasDeep?12:11};validateManifest(output);let manifestJSON=JSON.stringify(output,null,2);if(Buffer.byteLength(manifestJSON)>LIMITS.maxManifestBytes)manifestJSON=JSON.stringify(output);if(Buffer.byteLength(manifestJSON)>LIMITS.maxManifestBytes)throw new EditorError('RESOURCE_LIMIT','The project manifest exceeds its 4 MiB limit.')
  try { await lstat(destination); throw new EditorError('DESTINATION_EXISTS', 'Choose a new project name. This build uses Save As to preserve existing projects.') }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  await mkdir(dirname(destination), { recursive: true })
  const staging = join(dirname(destination), `.${basename(destination)}.${randomUUID()}.tmp`)
  await mkdir(join(staging, 'images'), { recursive: true })
  try {
    const written=new Set<string>()
    for (const layer of manifest.layers) {
      for (const file of [layer.imageFile, layer.maskFile]) {
      if (!file || written.has(file)) continue
      written.add(file)
      const asset = assets.get(file)
      if (!asset) throw new EditorError('INVALID_PROJECT', `Missing image asset for ${layer.name}.`)
      if(!!asset.hdr!==file.endsWith('.exr'))throw new EditorError('INVALID_PROJECT','HDR source data and project filename must agree.')
      await writeDurable(join(staging, 'images', file), asset.bytes)
      }
    }
    if(previewJPEG){if(previewJPEG.length>16*1024*1024||previewJPEG[0]!==255||previewJPEG[1]!==216)throw new EditorError('INVALID_ARGUMENT','Invalid project preview JPEG.');await mkdir(join(staging,'QuickLook'));await writeDurable(join(staging,'QuickLook','Preview.jpg'),previewJPEG)}
    await writeDurable(join(staging, 'manifest.json'), manifestJSON)
    await loadProject(staging,{retainedAssets:[...referenced].map(file=>assets.get(file)).filter((asset):asset is Asset=>!!asset)})
    // Re-check immediately before rename so accidental user-created destinations are protected.
    try { await lstat(destination); throw new EditorError('DESTINATION_EXISTS', 'The destination was created while saving.') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    await rename(staging, destination)
    return destination
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error }
}
