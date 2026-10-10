import {LIMITS} from '../shared/limits'
import { deflateSync } from 'node:zlib'
import { PNG } from 'pngjs'
import { exportOptionsSchema, type ExportOptions } from '../shared/export-options'

export type ExportRaster = { width: number; height: number; data: Uint8Array }
export type JPEGEncoder = (opaquePNG: Buffer, quality: number) => Buffer | Promise<Buffer>
export type EncodedExport = { data: Buffer; previewPNG: Buffer; mimeType: string; extension: string; options: ExportOptions }

function dimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > LIMITS.maxSide || height > LIMITS.maxSide || width * height > LIMITS.maxSurfacePixels) throw new Error('Image dimensions exceed export limits.')
}
function rasterValid(raster: ExportRaster): void {
  dimensions(raster.width, raster.height)
  if (raster.data.length !== raster.width * raster.height * 4) throw new Error('Expected straight RGBA8 pixel data.')
}
export function decodeExportPNG(bytes: Uint8Array): ExportRaster {
  const source = Buffer.from(bytes)
  if (source.length < 33 || !source.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || source.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Expected a PNG image.')
  dimensions(source.readUInt32BE(16), source.readUInt32BE(20))
  const png = PNG.sync.read(source, { checkCRC: true })
  return { width: png.width, height: png.height, data: png.data }
}

/** Interpolates premultiplied colors so transparent RGB does not bleed into resized edges. */
export function resizeExportRaster(source: ExportRaster, width: number, height: number): ExportRaster {
  rasterValid(source); dimensions(width, height)
  if (width === source.width && height === source.height) return source
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const sy = Math.max(0, Math.min(source.height - 1, (y + .5) * source.height / height - .5)), y0 = Math.floor(sy), y1 = Math.min(y0 + 1, source.height - 1), fy = sy - y0
    for (let x = 0; x < width; x++) {
      const sx = Math.max(0, Math.min(source.width - 1, (x + .5) * source.width / width - .5)), x0 = Math.floor(sx), x1 = Math.min(x0 + 1, source.width - 1), fx = sx - x0
      const indexes = [(y0 * source.width + x0) * 4, (y0 * source.width + x1) * 4, (y1 * source.width + x0) * 4, (y1 * source.width + x1) * 4]
      const weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy]
      let alpha = 0
      for (let k = 0; k < 4; k++) alpha += source.data[indexes[k] + 3] * weights[k]
      const offset = (y * width + x) * 4
      data[offset + 3] = Math.round(alpha)
      for (let channel = 0; channel < 3; channel++) {
        let sum = 0
        for (let k = 0; k < 4; k++) sum += source.data[indexes[k] + channel] * source.data[indexes[k] + 3] * weights[k]
        data[offset + channel] = alpha ? Math.round(sum / alpha) : 0
      }
    }
  }
  return { width, height, data }
}
export function flattenExportRaster(source: ExportRaster, background: string): ExportRaster {
  rasterValid(source)
  if (!/^#[\da-f]{6}$/i.test(background)) throw new Error('Background must be a six-digit RGB hex color.')
  const rgb = [1, 3, 5].map(offset => parseInt(background.slice(offset, offset + 2), 16)), data = new Uint8Array(source.data.length)
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = source.data[offset + 3] / 255
    for (let channel = 0; channel < 3; channel++) data[offset + channel] = Math.round(source.data[offset + channel] * alpha + rgb[channel] * (1 - alpha))
    data[offset + 3] = 255
  }
  return { width: source.width, height: source.height, data }
}
function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
  return (crc ^ 0xffffffff) >>> 0
}
function pngChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(data.length + 12)
  chunk.writeUInt32BE(data.length, 0); chunk.write(type, 4, 'ascii'); data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length)
  return chunk
}
export function encodePNG(raster: ExportRaster, resolution = 72): Buffer {
  rasterValid(raster)
  if (!Number.isFinite(resolution) || resolution < 1 || resolution > 9600) throw new Error('Invalid export resolution.')
  const png = new PNG({ width: raster.width, height: raster.height }); png.data = Buffer.from(raster.data)
  const encoded = PNG.sync.write(png), physical = Buffer.alloc(9)
  physical.writeUInt32BE(Math.round(resolution / .0254), 0); physical.writeUInt32BE(Math.round(resolution / .0254), 4); physical[8] = 1
  return Buffer.concat([encoded.subarray(0, 33), pngChunk('pHYs', physical), encoded.subarray(33)])
}

/** Supplies JFIF density independently of the platform JPEG compressor. */
export function setJPEGResolution(jpeg: Uint8Array, resolution: number): Buffer {
  if (!Number.isFinite(resolution) || resolution < 1 || resolution > 9600) throw new Error('Invalid export resolution.')
  const data = Buffer.from(jpeg)
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) throw new Error('JPEG encoder did not return a JPEG.')
  const jfif = Buffer.alloc(18)
  jfif[0] = 0xff; jfif[1] = 0xe0; jfif.writeUInt16BE(16, 2); jfif.write('JFIF\0', 4, 'ascii'); jfif[9] = 1; jfif[10] = 2; jfif[11] = 1
  jfif.writeUInt16BE(Math.round(resolution), 12); jfif.writeUInt16BE(Math.round(resolution), 14)
  const parts = [data.subarray(0, 2), jfif]
  let offset = 2
  while (offset < data.length) {
    if (data[offset] !== 0xff || offset + 1 >= data.length) throw new Error('Malformed JPEG marker.')
    const start = offset
    while (data[offset] === 0xff) offset++
    const marker = data[offset++]
    if (marker === 0xda || marker === 0xd9) { parts.push(data.subarray(start)); return Buffer.concat(parts) }
    if (offset + 2 > data.length) throw new Error('Truncated JPEG segment.')
    const length = data.readUInt16BE(offset), end = offset + length
    if (length < 2 || end > data.length) throw new Error('Truncated JPEG segment.')
    if (!(marker === 0xe0 && data.toString('ascii', offset + 2, offset + 7) === 'JFIF\0')) parts.push(data.subarray(start, end))
    offset = end
  }
  throw new Error('JPEG has no image/end marker.')
}

export function encodePDF(source: ExportRaster, resolution = 72, background: string | null = null): Buffer {
  rasterValid(source)
  if (!Number.isFinite(resolution) || resolution < 1 || resolution > 9600) throw new Error('Invalid export resolution.')
  const raster = background ? flattenExportRaster(source, background) : source, rgb = Buffer.alloc(raster.width * raster.height * 3), alpha = Buffer.alloc(raster.width * raster.height)
  let transparent = false
  for (let index = 0; index < alpha.length; index++) {
    rgb[index * 3] = raster.data[index * 4]; rgb[index * 3 + 1] = raster.data[index * 4 + 1]; rgb[index * 3 + 2] = raster.data[index * 4 + 2]
    alpha[index] = raster.data[index * 4 + 3]; transparent ||= alpha[index] !== 255
  }
  const pageWidth = +(raster.width * 72 / resolution).toFixed(6), pageHeight = +(raster.height * 72 / resolution).toFixed(6)
  const stream = (dictionary: string, bytes: Buffer): Buffer => Buffer.concat([Buffer.from(`<< ${dictionary} /Length ${bytes.length} >>\nstream\n`), bytes, Buffer.from('\nendstream')])
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`),
    stream('', Buffer.from(`q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im0 Do\nQ\n`)),
    stream(`/Type /XObject /Subtype /Image /Width ${raster.width} /Height ${raster.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${transparent ? ' /SMask 6 0 R' : ''}`, deflateSync(rgb))
  ]
  if (transparent) objects.push(stream(`/Type /XObject /Subtype /Image /Width ${raster.width} /Height ${raster.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, deflateSync(alpha)))
  const parts = [Buffer.from('%PDF-1.4\n%\xff\xff\xff\xff\n', 'latin1')], offsets = [0]
  let offset = parts[0].length
  objects.forEach((body, i) => { offsets.push(offset); const object = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')]); parts.push(object); offset += object.length })
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(value => `${String(value).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`
  parts.push(Buffer.from(xref)); return Buffer.concat(parts)
}

/** Callers may supply a full canvas PNG; this function resizes without changing the document. */
export async function encodeExport(png: Uint8Array, input: unknown, jpegEncoder?: JPEGEncoder): Promise<EncodedExport> {
  const options = exportOptionsSchema.parse(input), resized = resizeExportRaster(decodeExportPNG(png), options.width, options.height)
  const preview = options.format === 'png' || options.background === null && options.format === 'pdf' ? resized : flattenExportRaster(resized, options.background ?? '#ffffff')
  const previewPNG = encodePNG(preview, options.resolution)
  if (options.format === 'png') return { data: previewPNG, previewPNG, mimeType: 'image/png', extension: 'png', options }
  if (options.format === 'pdf') return { data: encodePDF(resized, options.resolution, options.background), previewPNG, mimeType: 'application/pdf', extension: 'pdf', options }
  if (!jpegEncoder) throw new Error('A platform JPEG encoder is required.')
  return { data: setJPEGResolution(await jpegEncoder(previewPNG, options.quality), options.resolution), previewPNG, mimeType: 'image/jpeg', extension: 'jpg', options }
}
