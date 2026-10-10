export type Point = { x: number; y: number }
export type Size = { width: number; height: number }
export type Rect = Point & Size
export type Guide = { id: string; axis: 'horizontal' | 'vertical'; position: number }
export type GridSettings = { spacing: number; subdivisions: number; color: string; opacity: number; style: 'lines' | 'dashed' | 'dots' }
export const DEFAULT_GRID: GridSettings = { spacing: 64, subdivisions: 8, color: '#b3b3b3', opacity: 45, style: 'lines' }
export const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value))
export function normalizeGrid(settings: Partial<GridSettings> = {}): GridSettings {
  const spacing = clamp(Math.round(settings.spacing ?? 64), 2, 4096)
  return { spacing, subdivisions: clamp(Math.round(settings.subdivisions ?? 8), 1, Math.min(64, spacing)), color: /^#[\da-f]{6}$/i.test(settings.color ?? '') ? settings.color! : DEFAULT_GRID.color, opacity: clamp(settings.opacity ?? 45, 1, 100), style: settings.style === 'dashed' || settings.style === 'dots' ? settings.style : 'lines' }
}
export function fitRect(document: Size, box: Size): Rect {
  if (Math.min(document.width, document.height, box.width, box.height) <= 0) return { x: 0, y: 0, width: 0, height: 0 }
  const scale = Math.min(box.width / document.width, box.height / document.height)
  const width = document.width * scale, height = document.height * scale
  return { x: (box.width - width) / 2, y: (box.height - height) / 2, width, height }
}
export function navigatorSize(document: Size): Size {
  const fitted = fitRect(document, { width: 126, height: 90 })
  return { width: Math.round(fitted.width), height: Math.round(fitted.height) }
}
export function navigatorPoint(point: Point, document: Size, box: Size): Point {
  const image = fitRect(document, box), scale = image.width / document.width
  return scale > 0 ? { x: clamp((point.x - image.x) / scale, 0, document.width), y: clamp((point.y - image.y) / scale, 0, document.height) } : { x: 0, y: 0 }
}
export function intersectRect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y)
  return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) }
}
export function navigatorViewport(document: Size, box: Size, visible: Rect): Rect {
  const image = fitRect(document, box), scale = document.width > 0 ? image.width / document.width : 0
  return intersectRect({ x: image.x + visible.x * scale, y: image.y + visible.y * scale, width: visible.width * scale, height: visible.height * scale }, image)
}
export function visibleDocumentRect(viewport: Size, canvasOrigin: Point, zoom: number): Rect {
  const scale = Math.max(zoom, .0001)
  return { x: -canvasOrigin.x / scale, y: -canvasOrigin.y / scale, width: viewport.width / scale, height: viewport.height / scale }
}
export function centerCanvasOrigin(point: Point, viewport: Size, zoom: number): Point {
  return { x: viewport.width / 2 - point.x * zoom, y: viewport.height / 2 - point.y * zoom }
}
// Enumerate only visible lines. This prevents a 30k document at 800% generating a giant SVG.
export function gridLines(start: number, end: number, settings: Pick<GridSettings, 'spacing' | 'subdivisions'>, maximum = 4096): { position: number; major: boolean }[] {
  const grid = normalizeGrid(settings), step = grid.spacing / grid.subdivisions
  const first = Math.max(0, Math.ceil(start / step)), last = Math.floor(end / step), count = last - first + 1
  const stride = Math.max(1, Math.ceil(count / maximum)), lines: { position: number; major: boolean }[] = []
  for (let i = first; i <= last; i += stride) lines.push({ position: Math.round(i * step), major: i % grid.subdivisions === 0 })
  return lines
}
export function rulerTicks(start: number, end: number, zoom: number): { position: number; major: boolean }[] {
  const desired = 70 / Math.max(.0001, zoom), power = 10 ** Math.floor(Math.log10(desired))
  const majorStep = [1, 2, 5, 10].map(value => value * power).find(value => value >= desired) ?? power * 10
  const step = majorStep / 5, ticks: { position: number; major: boolean }[] = []
  for (let i = Math.ceil(start / step); i <= Math.floor(end / step) && ticks.length < 2000; i++) ticks.push({ position: Number((i * step).toPrecision(12)), major: i % 5 === 0 })
  return ticks
}
export type SnapOptions = { enabled: boolean; zoom: number; document: Size; layers?: (Rect & { id: string; visible?: boolean })[]; movingIds?: string[]; guides?: Guide[]; canvas?: boolean; layerBounds?: boolean; guideBounds?: boolean; grid?: GridSettings; gridVisible?: boolean; guidesVisible?: boolean; includeCenters?: boolean; tolerance?: number }
export type SnapResult = { delta: Point; x?: number; y?: number }
export function snapTargets(options: SnapOptions): { xs: number[]; ys: number[] } {
  const xs: number[] = [], ys: number[] = [], center = options.includeCenters !== false
  if (!options.enabled) return { xs, ys }
  if (options.canvas !== false) { xs.push(0, options.document.width); ys.push(0, options.document.height); if (center) { xs.push(options.document.width / 2); ys.push(options.document.height / 2) } }
  if (options.layerBounds !== false) for (const layer of options.layers ?? []) {
    if (layer.visible === false || options.movingIds?.includes(layer.id)) continue
    xs.push(layer.x, layer.x + layer.width); ys.push(layer.y, layer.y + layer.height)
    if (center) { xs.push(layer.x + layer.width / 2); ys.push(layer.y + layer.height / 2) }
  }
  if (options.guideBounds !== false && options.guidesVisible !== false) for (const guide of options.guides ?? []) (guide.axis === 'vertical' ? xs : ys).push(guide.position)
  return { xs, ys }
}
function closestCorrection(values: number[], targets: number[], tolerance: number, grid?: GridSettings): { correction: number; target?: number } {
  let best = tolerance + 1, correction = 0, target: number | undefined
  for (const value of values) {
    const candidates = [...targets]
    if (grid) { const step = grid.spacing / grid.subdivisions, nearest = Math.round(value / step); for (const index of [nearest - 1, nearest, nearest + 1]) candidates.push(Math.round(index * step)) }
    for (const candidate of candidates) { const distance = Math.abs(candidate - value); if (distance <= tolerance && distance < best) { best = distance; correction = candidate - value; target = candidate } }
  }
  return { correction, target }
}
export function snapRect(rect: Rect, proposedDelta: Point, options: SnapOptions): SnapResult {
  if (!options.enabled) return { delta: proposedDelta }
  const targets = snapTargets(options), tolerance = (options.tolerance ?? 6) / Math.max(options.zoom, .0001)
  const x = rect.x + proposedDelta.x, y = rect.y + proposedDelta.y
  const grid = options.grid && options.gridVisible ? normalizeGrid(options.grid) : undefined
  const dx = closestCorrection(options.includeCenters === false ? [x, x + rect.width] : [x, x + rect.width / 2, x + rect.width], targets.xs, tolerance, grid)
  const dy = closestCorrection(options.includeCenters === false ? [y, y + rect.height] : [y, y + rect.height / 2, y + rect.height], targets.ys, tolerance, grid)
  return { delta: { x: proposedDelta.x + dx.correction, y: proposedDelta.y + dy.correction }, x: dx.target, y: dy.target }
}
export function snapGuide(position: number, axis: Guide['axis'], options: SnapOptions, excludedId?: string): number {
  const targets = snapTargets({ ...options, guides: options.guides?.filter(guide => guide.id !== excludedId) })
  if (!options.enabled) return position
  const result = closestCorrection([position], axis === 'vertical' ? targets.xs : targets.ys, (options.tolerance ?? 6) / Math.max(options.zoom, .0001), options.grid && options.gridVisible ? normalizeGrid(options.grid) : undefined)
  return position + result.correction
}
