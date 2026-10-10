import {totalmem} from 'node:os'
import {documentPixelBudget} from '../shared/limits'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { PNG } from 'pngjs'
import { EditorError, LIMITS, type AssetInfo, type Manifest } from '../shared/contracts'
import { validateManifest } from './manifest'

export interface Asset extends AssetInfo { bytes: Buffer }
export async function writeDurable(path: string, bytes: string | Buffer): Promise<void> {
  const handle = await open(path, 'w', 0o600)
  try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
}
export function projectFingerprint(manifest: Manifest, assets: Map<string, Asset>): string {
  const hash = createHash('sha256').update(JSON.stringify(manifest))
  for (const [file, asset] of [...assets].sort(([a], [b]) => a.localeCompare(b))) hash.update(file).update(asset.hash)
  return hash.digest('hex')
}
export async function fingerprintProject(path: string): Promise<string> {
  const loaded = await loadProject(path)
  return projectFingerprint(loaded.manifest, loaded.assets)
}
export function makeAsset(file: string, bytes: Buffer): Asset {
  if (bytes.length > LIMITS.maxAssetBytes) throw new EditorError('RESOURCE_LIMIT', 'The encoded image exceeds the encoded asset budget.')
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new EditorError('INVALID_PROJECT', 'Only valid PNG image assets are supported.')
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
  if (width < 1 || height < 1 || width > LIMITS.maxSide || height > LIMITS.maxSide || width * height > LIMITS.maxSurfacePixels) throw new EditorError('RESOURCE_LIMIT', 'The image exceeds this build’s image size limit.')
  if (bytes[24] > 8) throw new EditorError('UNSUPPORTED_FEATURE', '16-bit PNG assets are not supported in this RGBA8 build.')
  try { PNG.sync.read(bytes, { checkCRC: true }) } catch { throw new EditorError('INVALID_PROJECT', 'The PNG image is damaged.') }
  return { file, width, height, hash: createHash('sha256').update(bytes).digest('hex'), bytes: Buffer.from(bytes) }
}
async function regularFile(path: string, root: string, maximum: number): Promise<Buffer> {
  const stat = await lstat(path)
  const actual = await realpath(path), base = await realpath(root)
  if (stat.isSymbolicLink() || !stat.isFile() || !actual.startsWith(base + sep)) throw new EditorError('INVALID_PROJECT', 'Project assets must be regular files inside the project.')
  if (stat.size > maximum) throw new EditorError('RESOURCE_LIMIT', 'The project resource exceeds the file size limit.')
  return readFile(path)
}
export async function loadProject(path: string): Promise<{ manifest: Manifest; assets: Map<string, Asset>; warnings: string[] }> {
  const stat = await lstat(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new EditorError('INVALID_PROJECT', 'Select a .comp project directory.')
  const raw = await regularFile(join(path, 'manifest.json'), path, LIMITS.maxManifestBytes)
  let input: unknown
  try { input = JSON.parse(raw.toString('utf8')) } catch { throw new EditorError('INVALID_PROJECT', 'The project manifest is not valid JSON.') }
  const { manifest, warnings } = validateManifest(input)
  const assets = new Map<string, Asset>()
  let pixels = 0
  for (const layer of manifest.layers) {
    for (const file of [layer.imageFile, layer.maskFile]) {
    if (!file) continue
    const bytes = await regularFile(join(path, 'images', file), path, LIMITS.maxAssetBytes)
    if (file === layer.maskFile && (bytes[24] !== 8 || bytes[25] !== 0)) throw new EditorError('INVALID_PROJECT', 'Layer masks must be 8-bit grayscale PNG without alpha.')
    if(bytes.length<33)throw new EditorError('INVALID_PROJECT','The image asset has no valid PNG header.')
    pixels+=bytes.readUInt32BE(16)*bytes.readUInt32BE(20)
    if (pixels > documentPixelBudget(totalmem())) throw new EditorError('RESOURCE_LIMIT', 'The project’s image assets exceed the document raster budget.')
    const asset = makeAsset(file,bytes)
    assets.set(file, asset)
    }
  }
  return { manifest, assets, warnings }
}

// Save As only: rename a fully written sibling into a previously nonexistent destination.
// Existing packages are never replaced by this initial implementation.
export async function saveProject(path: string, manifest: Manifest, assets: Map<string, Asset>, previewJPEG?:Buffer): Promise<string> {
  const destination = resolve(path.endsWith('.comp') ? path : `${path}.comp`)
  validateManifest(manifest)
  const output={...manifest,version:11};let manifestJSON=JSON.stringify(output,null,2);if(Buffer.byteLength(manifestJSON)>LIMITS.maxManifestBytes)manifestJSON=JSON.stringify(output);if(Buffer.byteLength(manifestJSON)>LIMITS.maxManifestBytes)throw new EditorError('RESOURCE_LIMIT','The project manifest exceeds its 4 MiB limit.')
  try { await lstat(destination); throw new EditorError('DESTINATION_EXISTS', 'Choose a new project name. This build uses Save As to preserve existing projects.') }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  await mkdir(dirname(destination), { recursive: true })
  const staging = join(dirname(destination), `.${basename(destination)}.${randomUUID()}.tmp`)
  await mkdir(join(staging, 'images'), { recursive: true })
  try {
    for (const layer of manifest.layers) {
      for (const file of [layer.imageFile, layer.maskFile]) {
      if (!file) continue
      const asset = assets.get(file)
      if (!asset) throw new EditorError('INVALID_PROJECT', `Missing image asset for ${layer.name}.`)
      await writeDurable(join(staging, 'images', file), asset.bytes)
      }
    }
    if(previewJPEG){if(previewJPEG.length>16*1024*1024||previewJPEG[0]!==255||previewJPEG[1]!==216)throw new EditorError('INVALID_ARGUMENT','Invalid project preview JPEG.');await mkdir(join(staging,'QuickLook'));await writeDurable(join(staging,'QuickLook','Preview.jpg'),previewJPEG)}
    await writeDurable(join(staging, 'manifest.json'), manifestJSON)
    await loadProject(staging)
    // Re-check immediately before rename so accidental user-created destinations are protected.
    try { await lstat(destination); throw new EditorError('DESTINATION_EXISTS', 'The destination was created while saving.') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    await rename(staging, destination)
    return destination
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error }
}
