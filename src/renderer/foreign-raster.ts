import { LIMITS } from '../shared/limits'
/** Chromium fallback for bounded BMP/GIF/WebP imports; animated inputs produce a still layer. */
export async function rasterToPNG(dataURL: string): Promise<Uint8Array> {
  if (!/^data:image\/(bmp|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(dataURL) || dataURL.length > 90 * 1024 * 1024) throw new Error('Invalid raster import payload')
  const image = new Image(); image.src = dataURL; await image.decode()
  const width = image.naturalWidth, height = image.naturalHeight
  if (!width || !height || width > LIMITS.maxSide || height > LIMITS.maxSide || width * height > LIMITS.maxSurfacePixels) throw new Error('Decoded raster exceeds working-surface limits')
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const context = canvas.getContext('2d'); if (!context) throw new Error('Raster import surface allocation failed')
  context.drawImage(image, 0, 0)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Raster PNG encoding failed')), 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}
