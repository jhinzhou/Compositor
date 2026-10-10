/** Bounded HEIF box/profile inspection before any codec allocates pixels. */
export interface ColorPlan { label: string; curves?: number[][]; matrix?: number[]; transfer?: number; primaries?: number; warnings: string[] }
export interface HeifHeader { sizes: { width: number; height: number }[]; color: ColorPlan }
const srgbXYZ = [3.2404542, -1.5371385, -.4985314, -.969266, 1.8760108, .041556, .0556434, -.2040259, 1.0572252]
const adaptD50 = [.9555766, -.0230393, .0631636, -.0282895, 1.0099416, .0210077, .0122982, -.020483, 1.3299098]
function multiply(a: number[], b: number[]): number[] { return Array.from({ length: 9 }, (_, i) => { const row = Math.floor(i / 3), col = i % 3; return a[row * 3]! * b[col]! + a[row * 3 + 1]! * b[col + 3]! + a[row * 3 + 2]! * b[col + 6]! }) }
export function inspectICC(profile: Uint8Array): ColorPlan {
  const b = Buffer.from(profile.buffer, profile.byteOffset, profile.byteLength)
  if (b.length < 132 || b.length > 1024 * 1024 || b.readUInt32BE(0) > b.length || b.toString('ascii', 36, 40) !== 'acsp' || b.toString('ascii', 16, 20) !== 'RGB ' || b.toString('ascii', 20, 24) !== 'XYZ ') throw new Error('HEIF ICC profile is not a supported RGB matrix/TRC profile')
  const count = b.readUInt32BE(128); if (count > 128 || 132 + count * 12 > b.length) throw new Error('Invalid ICC tag table')
  const tags = new Map<string, Buffer>()
  for (let i = 0; i < count; i++) { const p = 132 + i * 12, start = b.readUInt32BE(p + 4), length = b.readUInt32BE(p + 8); if (start + length > b.length) throw new Error('Invalid ICC tag range'); tags.set(b.toString('ascii', p, p + 4), b.subarray(start, start + length)) }
  const fixed = (tag: Buffer, offset: number) => { if (offset + 4 > tag.length) throw new Error('Truncated ICC parameter'); return tag.readInt32BE(offset) / 65536 }
  const xyz = ['rXYZ', 'gXYZ', 'bXYZ'].map(name => { const tag = tags.get(name); if (!tag || tag.toString('ascii', 0, 4) !== 'XYZ ' || tag.length < 20) throw new Error('ICC LUT profiles require an external color-managed conversion'); return [fixed(tag, 8), fixed(tag, 12), fixed(tag, 16)] })
  const matrix = multiply(multiply(srgbXYZ, adaptD50), [xyz[0]![0]!, xyz[1]![0]!, xyz[2]![0]!, xyz[0]![1]!, xyz[1]![1]!, xyz[2]![1]!, xyz[0]![2]!, xyz[1]![2]!, xyz[2]![2]!])
  const curves = ['rTRC', 'gTRC', 'bTRC'].map(name => {
    const tag = tags.get(name); if (!tag || tag.length < 12) throw new Error('ICC matrix profile has no tone curve')
    const type = tag.toString('ascii', 0, 4)
    let curve: (x: number) => number
    if (type === 'curv') { const n = tag.readUInt32BE(8); if (n > 65536 || 12 + n * 2 > tag.length) throw new Error('Invalid ICC tone curve'); curve = n === 0 ? x => x : n === 1 ? x => x ** (tag.readUInt16BE(12) / 256) : x => { const p = x * (n - 1), i = Math.floor(p), a = tag.readUInt16BE(12 + i * 2) / 65535, z = tag.readUInt16BE(12 + Math.min(i + 1, n - 1) * 2) / 65535; return a + (z - a) * (p - i) } }
    else if (type === 'para') { const fn = tag.readUInt16BE(8), lengths = [1, 3, 4, 5, 7], n = lengths[fn]; if (!n) throw new Error('Unsupported ICC parametric curve'); const p = Array.from({ length: n }, (_, i) => fixed(tag, 12 + i * 4)), [g, a = 1, c = 0, d = 0, e = 0, f = 0, h = 0] = p; curve = x => fn === 0 ? x ** g! : fn === 1 ? x >= -c / a ? (a * x + c) ** g! : 0 : fn === 2 ? x >= -c / a ? (a * x + c) ** g! + d : d : fn === 3 ? x >= e ? (a * x + c) ** g! : d * x : x >= e ? (a * x + c) ** g! + f : d * x + h }
    else throw new Error('Unsupported ICC tone curve encoding')
    return Array.from({ length: 256 }, (_, i) => { const y = curve(i / 255); if (!Number.isFinite(y)) throw new Error('Invalid ICC tone curve value'); return y })
  })
  return { label: 'ICC RGB matrix/TRC → sRGB', matrix, curves, warnings: ['HEIF ICC colors converted to sRGB; colors outside sRGB are clipped to the RGBA8 working gamut.'] }
}
export function inspectHeif(bytes: Uint8Array, maxSide = 30_000, maxPixels = 200_000_000): HeifHeader {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), sizes: HeifHeader['sizes'] = [], colors: ColorPlan[] = []; let visited = 0, hasBrand = false
  function scan(start: number, end: number, depth: number): void {
    if (depth > 12) throw new Error('HEIF box nesting limit exceeded')
    for (let p = start; p < end;) {
      if (++visited > 16384 || p + 8 > end) throw new Error('Invalid or excessive HEIF box table')
      let size = b.readUInt32BE(p), header = 8; const type = b.toString('ascii', p + 4, p + 8)
      if (size === 1) { if (p + 16 > end) throw new Error('Truncated HEIF box'); const n = b.readBigUInt64BE(p + 8); if (n > BigInt(b.length)) throw new Error('Invalid HEIF box size'); size = Number(n); header = 16 } else if (!size) size = end - p
      if (size < header || p + size > end) throw new Error('Invalid HEIF box range')
      const body = p + header, stop = p + size
      if (type === 'ftyp') { if (size < 16) throw new Error('Invalid HEIF file type'); const brands = [b.toString('ascii', body, body + 4)]; for (let q = body + 8; q + 4 <= stop; q += 4) brands.push(b.toString('ascii', q, q + 4)); hasBrand = brands.some(x => ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(x)) && !brands.includes('avif') }
      else if (type === 'meta') scan(body + 4, stop, depth + 1)
      else if (['iprp', 'ipco'].includes(type)) scan(body, stop, depth + 1)
      else if (type === 'ispe') { if (body + 12 > stop) throw new Error('Truncated HEIF size'); const width = b.readUInt32BE(body + 4), height = b.readUInt32BE(body + 8); if (!width || !height || width > maxSide || height > maxSide || width * height > maxPixels) throw new Error('HEIF image dimensions exceed resource limits'); sizes.push({ width, height }) }
      else if (type === 'colr') { if (body + 4 > stop) throw new Error('Truncated HEIF color profile'); const kind = b.toString('ascii', body, body + 4); if (kind === 'nclx') { if (body + 11 > stop) throw new Error('Truncated HEIF NCLX profile'); const primaries = b.readUInt16BE(body + 4), transfer = b.readUInt16BE(body + 6); if (![1, 12].includes(primaries) || ![1, 6, 8, 13].includes(transfer)) throw new Error('HEIF HDR/unsupported NCLX profile requires explicit tone mapping or color conversion'); colors.push({ label: primaries === 12 ? 'Display P3 → sRGB' : 'BT.709/sRGB → sRGB', primaries, transfer, warnings: primaries === 12 ? ['Display P3 converted to sRGB; out-of-gamut colors are clipped.'] : [] }) } else if (kind === 'prof' || kind === 'rICC') colors.push(inspectICC(b.subarray(body + 4, stop))); else throw new Error('Unsupported HEIF color profile') }
      p = stop
    }
  }
  scan(0, b.length, 0)
  if (!hasBrand || !sizes.length) throw new Error('Not a supported HEIC/HEIF still image')
  // Ambiguous per-item profiles must not silently apply a thumbnail's profile to the primary still.
  const unique = new Set(colors.map(x => JSON.stringify({ matrix: x.matrix, curves: x.curves, primaries: x.primaries, transfer: x.transfer })))
  if (unique.size > 1) throw new Error('HEIF contains differing per-item profiles; convert the primary image with a color-managed external tool')
  return { sizes, color: colors[0] ?? { label: 'Assumed sRGB (untagged)', warnings: ['HEIF has no color profile; pixels are interpreted as sRGB.'] } }
}
