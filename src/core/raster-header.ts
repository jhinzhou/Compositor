import { LIMITS } from '../shared/limits'
export function rasterDimensions(bytes: Uint8Array): [number, number] {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength); let size: [number, number] | undefined
  if (b.length >= 24 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) size = [b.readUInt32BE(16), b.readUInt32BE(20)]
  else if (b.length >= 10 && /^GIF8[79]a$/.test(b.toString('ascii', 0, 6))) size = [b.readUInt16LE(6), b.readUInt16LE(8)]
  else if (b.length >= 26 && b.toString('ascii', 0, 2) === 'BM') { const dib = b.readUInt32LE(14); if (dib === 12) size = [b.readUInt16LE(18), b.readUInt16LE(20)]; else if (dib >= 40) size = [b.readInt32LE(18), Math.abs(b.readInt32LE(22))] }
  else if (b.length >= 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const kind = b.toString('ascii', 12, 16)
    if (kind === 'VP8X') size = [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)]
    else if (kind === 'VP8 ' && b[23] === 0x9d && b[24] === 1 && b[25] === 0x2a) size = [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff]
    else if (kind === 'VP8L' && b[20] === 0x2f) { const bits = b.readUInt32LE(21); size = [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1] }
  } else if (b[0] === 255 && b[1] === 216) {
    let i = 2
    while (i < b.length - 8) { if (b[i++] !== 255) continue; while (b[i] === 255) i++; const marker = b[i++]!; if (marker === 0xda || marker === 0xd9) break; if (marker === 1 || marker >= 0xd0 && marker <= 0xd7) continue; if (i + 2 > b.length) break; const length = b.readUInt16BE(i); if (length < 2 || i + length > b.length) break; if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) { size = [b.readUInt16BE(i + 5), b.readUInt16BE(i + 3)]; break } i += length }
  }
  if (!size || size.some(x => !Number.isInteger(x) || x < 1)) throw new Error('Invalid or unsupported raster image header')
  if (size[0] > LIMITS.maxSide || size[1] > LIMITS.maxSide || size[0] * size[1] > LIMITS.maxSurfacePixels) throw new Error('Raster image dimensions exceed working-surface resource limits')
  return size
}
