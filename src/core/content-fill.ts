// TypeScript port of Compositor v1.4.8 Compositor/Rendering/ContentFill.c.
// Copyright (c) 2026 Wonder Assembly LLC. Distributed under the MIT License;
// the complete retained notice is in licenses/Compositor-MIT.txt.
// Changed: typed arrays, immutable input, bounded work, cancellation and PNG output.
import { PNG } from 'pngjs'
import { EditorError, LIMITS } from '../shared/contracts'
import type { RGBAImage, RasterSelection } from './selection-retouch'

export interface ContentFillResult { png: PNG; filledPixels: number; donorCount: number; algorithm: 'compositor-patch-search-v1.4.8' }
export function contentAwareFill(image: RGBAImage, selection: RasterSelection, options: { signal?: AbortSignal; maximumWork?: number } = {}): ContentFillResult {
  const w = image.width, h = image.height, n = w * h
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > LIMITS.maxSide || h > LIMITS.maxSide || n > LIMITS.maxSurfacePixels || image.data.length !== n * 4 || selection.width !== w || selection.height !== h || selection.coverage.length !== n) throw new EditorError('INVALID_ARGUMENT', 'Content fill requires equal-sized RGBA and selection rasters.')
  const canceled = (): void => { if (options.signal?.aborted) throw new EditorError('CANCELED', 'Content fill was canceled.') }; canceled()
  const radius = w >= 5 && h >= 5 ? 2 : 0, patchArea = (radius * 2 + 1) ** 2
  let missing = 0; for (const value of selection.coverage) if (value) missing++
  const budget = options.maximumWork ?? 120_000_000
  if (!Number.isFinite(budget) || budget < 0 || budget > 500_000_000) throw new EditorError('INVALID_ARGUMENT', 'Invalid content fill compute budget.')
  if (n * patchArea + missing * 35 * patchArea > budget) throw new EditorError('RESOURCE_LIMIT', 'Content fill exceeds the patch-search budget; use a smaller image or selection.')
  const png = new PNG({ width: w, height: h }); png.data.set(image.data)
  if (!missing) return { png, filledPixels: 0, donorCount: 0, algorithm: 'compositor-patch-search-v1.4.8' }
  const pixels = png.data, known = new Uint8Array(n), target = new Uint8Array(n), valid = new Uint8Array(n), queued = new Uint8Array(n), donors = new Int32Array(n), queue = new Int32Array(n), chosen = new Int32Array(n); chosen.fill(-1)
  for (let p = 0; p < n; p++) { target[p] = selection.coverage[p] ? 1 : 0; known[p] = !target[p] && pixels[p * 4 + 3] === 255 ? 1 : 0 }
  let donorCount = 0, head = 0, tail = 0, scan = 0, seed = 0x6d2b79f5
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x
    if (!known[p]) continue
    let ok = true
    for (let dy = -radius; dy <= radius && ok; dy++) for (let dx = -radius; dx <= radius; dx++) { const sx = x + dx, sy = y + dy; if (sx < 0 || sy < 0 || sx >= w || sy >= h || !known[sy * w + sx]) { ok = false; break } }
    if (ok) { valid[p] = 1; donors[donorCount++] = p }
  }
  if (!donorCount) throw new EditorError('NO_SOURCE', 'Not enough unselected opaque image pixels to synthesize a fill. Use a smaller selection with surrounding image.')
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x
    if (target[p] && ((x && known[p - 1]) || (x + 1 < w && known[p + 1]) || (y && known[p - w]) || (y + 1 < h && known[p + w]))) { queue[tail++] = p; queued[p] = 1 }
  }
  const random = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed }
  const match = (p: number, q: number): number => {
    const px = p % w, py = Math.floor(p / w), qx = q % w, qy = Math.floor(q / w); let count = 0, sum = 0
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const x = px + dx, y = py + dy, sx = qx + dx, sy = qy + dy
      if (x < 0 || y < 0 || x >= w || y >= h || sx < 0 || sy < 0 || sx >= w || sy >= h || !known[y * w + x]) continue
      const a = (y * w + x) * 4, b = (sy * w + sx) * 4
      for (let channel = 0; channel < 4; channel++) { const difference = pixels[a + channel] - pixels[b + channel]; sum += difference * difference }
      count++
    }
    return count ? sum / count : Number.MAX_VALUE
  }
  for (;;) {
    while (head < tail) {
      if (head % 256 === 0) canceled()
      const p = queue[head++], x = p % w, y = Math.floor(p / w), neighbors = [x ? p - 1 : -1, x + 1 < w ? p + 1 : -1, y ? p - w : -1, y + 1 < h ? p + w : -1]
      let best = -1, score = Number.MAX_VALUE
      for (let k = 0; k < 28; k++) {
        let q = -1
        if (k < 4) { const neighbor = neighbors[k]; if (neighbor >= 0) q = (chosen[neighbor] >= 0 ? chosen[neighbor] : neighbor) + (p - neighbor) }
        else q = donors[random() % donorCount]
        if (q < 0 || q >= n || !valid[q]) continue
        const value = match(p, q); if (best < 0 || value < score) { score = value; best = q }
      }
      if (best < 0) best = donors[0]
      for (let reach = 64; reach >= 1; reach /= 2) {
        const qx = best % w + random() % (2 * reach + 1) - reach, qy = Math.floor(best / w) + random() % (2 * reach + 1) - reach
        if (qx < 0 || qy < 0 || qx >= w || qy >= h || !valid[qy * w + qx]) continue
        const q = qy * w + qx, value = match(p, q); if (value < score) { score = value; best = q }
      }
      pixels.set(pixels.subarray(best * 4, best * 4 + 4), p * 4); known[p] = 1; chosen[p] = best
      for (const q of neighbors) if (q >= 0 && target[q] && !known[q] && !queued[q]) { queued[q] = 1; queue[tail++] = q }
    }
    while (scan < n && (!target[scan] || known[scan])) scan++
    if (scan >= n) break
    queue[tail++] = scan; queued[scan] = 1
  }
  return { png, filledPixels: missing, donorCount, algorithm: 'compositor-patch-search-v1.4.8' }
}
