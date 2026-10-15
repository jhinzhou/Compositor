import { EditorError, type EditorState } from './contracts'

export type AssetRepresentation = 'source' | 'display'
export interface AssetRepresentationInfo {
  file: string
  hash: string
  bitDepth?: 8 | 16
  displayHash?: string
}

/** A display proxy can change without changing the preserved source PNG. */
export function assetDisplayKey(asset: AssetRepresentationInfo): string {
  if (asset.bitDepth === 16 && !asset.displayHash) {
    throw new EditorError('RENDER_FAILED', 'An image snapshot could not be loaded.')
  }
  return asset.displayHash ? `${asset.hash}:${asset.displayHash}` : asset.hash
}

/** Source is the default for file/MCP consumers; renderer callers opt in to display. */
export function assetRepresentationURL(
  state: Pick<EditorState, 'sessionId' | 'assets'>,
  file: string,
  representation: AssetRepresentation = 'source',
): string {
  if (file.startsWith('data:image/png;base64,')) return file
  const asset: AssetRepresentationInfo | undefined = state.assets.find(item => item.file === file)
  if (!asset) throw new EditorError('ASSET_NOT_FOUND', 'The layer image is missing.')
  const base = `compositor-asset://${state.sessionId}/${encodeURIComponent(file)}?hash=${encodeURIComponent(asset.hash)}`
  if (representation === 'source') return base
  assetDisplayKey(asset)
  return `${base}&representation=display${asset.displayHash ? `&displayHash=${encodeURIComponent(asset.displayHash)}` : ''}`
}
