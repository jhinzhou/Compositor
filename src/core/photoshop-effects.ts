import type {Color, LayerEffectsInfo} from 'ag-psd'
import {layerEffectsSchema, type LayerEffects} from '../shared/layer-effects'

const clamp = (value: number | undefined, max = 1, fallback = 0) => Math.max(0, Math.min(max, Number.isFinite(value) ? value! : fallback))
export function photoshopRGB(color?: Color): [number, number, number] | undefined {
  if (color && 'r' in color) return [color.r, color.g, color.b].map(value => clamp(value / 255)) as [number, number, number]
  if (color && 'fr' in color) return [color.fr, color.fg, color.fb].map(value => clamp(value)) as [number, number, number]
}
/** Native styles have one instance per kind and Normal compositing; keep unsupported source descriptors separately. */
export function importPhotoshopEffects(source: LayerEffectsInfo, warnings: string[], name: string, globalAngle?:number): LayerEffects | undefined {
  const result: Record<string, unknown> = {}, scale = clamp(source.scale, 100, 1)
  const appearance = (effect: {enabled?: boolean; color?: Color; opacity?: number; blendMode?: string}) => {
    const rgb = photoshopRGB(effect.color)
    if (!rgb) { warnings.push(`${name}: a non-RGB layer effect remains in Photoshop metadata only.`); return }
    if (effect.blendMode && effect.blendMode !== 'normal') warnings.push(`${name}: ${effect.blendMode} effect blending is approximated with Normal in the editor; the original descriptor is retained for unchanged export.`)
    return {enabled: !source.disabled && effect.enabled !== false, red: rgb[0], green: rgb[1], blue: rgb[2], opacity: clamp(effect.opacity, 1, 1)}
  }
  for (const [psKey, key] of [['dropShadow', 'shadow'], ['innerShadow', 'innerShadow']] as const) {
    const list = source[psKey], effect = list?.[0], basic = effect && appearance(effect)
    if (list && list.length > 1) warnings.push(`${name}: multiple ${psKey} instances retain only the first editable instance in the editor.`)
    if (effect && basic) result[key] = {...basic, angle: ((effect.useGlobalLight&&Number.isFinite(globalAngle)?globalAngle!:effect.angle??90)%360), distance: clamp((effect.distance?.value ?? 0) * scale, 5000), blur: clamp((effect.size?.value ?? 0) * scale, 500)}
  }
  const stroke = source.stroke?.[0]
  if (source.stroke && source.stroke.length > 1) warnings.push(`${name}: multiple strokes retain only the first editable instance in the editor.`)
  if (stroke && (!stroke.fillType || stroke.fillType === 'color')) { const basic = appearance(stroke); if (basic) result.stroke = {...basic, size: clamp((stroke.size?.value ?? 0) * scale, 500), inside: stroke.position === 'inside'}; if (stroke.position === 'center') warnings.push(`${name}: centered stroke is approximated with an outside stroke.`) }
  else if (stroke) warnings.push(`${name}: gradient/pattern stroke remains in Photoshop metadata only.`)
  const overlay = source.solidFill?.[0]
  if (source.solidFill && source.solidFill.length > 1) warnings.push(`${name}: multiple color overlays retain only the first editable instance in the editor.`)
  if (overlay) result.colorOverlay = appearance(overlay)
  for (const key of ['outerGlow', 'innerGlow'] as const) { const effect = source[key], basic = effect && appearance(effect); if (effect && basic) { result[key] = {...basic, size: clamp((effect.size?.value ?? 0) * scale, 500)}; if (effect.source === 'center') warnings.push(`${name}: center-source glow is approximated with edge-source glow.`) } }
  if (source.bevel || source.satin || source.gradientOverlay || source.patternOverlay) warnings.push(`${name}: bevel, satin, gradient/pattern overlay descriptors are retained for export but not rendered in the editor.`)
  if (Object.keys(result).length) { warnings.push(`${name}: supported layer effects are editable; Photoshop contours, spread and effect rendering may differ.`); return layerEffectsSchema.parse(result) }
}
export function exportPhotoshopEffects(input: unknown): LayerEffectsInfo {
  const source = layerEffectsSchema.parse(input), result: LayerEffectsInfo = {scale: 1}
  const appearance = (effect: {enabled?: boolean; red: number; green: number; blue: number; opacity: number}) => ({enabled: effect.enabled !== false, present: true, showInDialog: true, color: {r: effect.red * 255, g: effect.green * 255, b: effect.blue * 255}, opacity: effect.opacity, blendMode: 'normal' as const})
  const px = (value: number) => ({units: 'Pixels' as const, value})
  for (const [key, psKey] of [['shadow', 'dropShadow'], ['innerShadow', 'innerShadow']] as const) { const effect = source[key]; if (effect) result[psKey] = [{...appearance(effect), angle: effect.angle, distance: px(effect.distance), size: px(effect.blur), useGlobalLight: false, choke: px(0)}] }
  if (source.stroke) result.stroke = [{...appearance(source.stroke), size: px(source.stroke.size), position: source.stroke.inside ? 'inside' : 'outside', fillType: 'color'}]
  if (source.colorOverlay) result.solidFill = [appearance(source.colorOverlay)]
  if (source.outerGlow) result.outerGlow = {...appearance(source.outerGlow), size: px(source.outerGlow.size), source: 'edge', choke: px(0)}
  if (source.innerGlow) result.innerGlow = {...appearance(source.innerGlow), size: px(source.innerGlow.size), source: 'edge', technique: 'softer', choke: px(0)}
  return result
}
