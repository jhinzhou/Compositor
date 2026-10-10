import type { Layer } from '../shared/contracts'

export function layerSourcePoint(layer: Layer, x: number, y: number, width: number, height: number): [number, number] | undefined {
  const t = layer.transform, angle = -t.rotation * Math.PI / 180
  const dx = x - t.origin[0] - t.size[0] / 2, dy = y - t.origin[1] - t.size[1] / 2
  const localX = (dx * Math.cos(angle) - dy * Math.sin(angle)) * (t.flipX ? -1 : 1)
  const localY = (dx * Math.sin(angle) + dy * Math.cos(angle)) * (t.flipY ? -1 : 1)
  const u = localX / t.size[0] + .5, v = localY / t.size[1] + .5
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return undefined
  return [Math.min(width - 1, Math.floor(u * width)), Math.min(height - 1, Math.floor(v * height))]
}
