import {vectorFrameZhCN} from './locales/vector-frame.zh-CN'
import {toolsAlpha29ZhCN} from './locales/tools-alpha29.zh-CN'
import {upstreamAlpha25ZhCN} from './locales/upstream-alpha25.zh-CN'
import {retouchAlpha25ZhCN} from './locales/retouch-alpha25.zh-CN'
import {toolsAlpha24ZhCN} from './locales/tools-alpha24.zh-CN'
import {photoshopMenuZhCN} from './locales/photoshop-menu.zh-CN'
import {toolsAlpha23ZhCN} from './locales/tools-alpha23.zh-CN'
import {upstreamUIZhCN} from './locales/upstream-ui.zh-CN'
import {rasterizeZhCN} from './locales/rasterize.zh-CN'
import {cropZhCN} from './locales/crop.zh-CN'
import {deepZhCN} from './locales/deep.zh-CN'
import {edgeRefinementZhCN} from './locales/edge-refinement.zh-CN'
import { editorZhCN } from './locales/editor.zh-CN'
import { panelsZhCN } from './locales/panels.zh-CN'
import { desktopZhCN } from './locales/desktop.zh-CN'
import { errorsZhCN } from './locales/errors.zh-CN'
import { activityZhCN } from './locales/activity.zh-CN'
import {photoshopBrushZhCN} from './locales/photoshop-brush.zh-CN'
import {namedSelectionsZhCN} from './locales/named-selections.zh-CN'
import {maskPropertiesZhCN} from './locales/mask-properties.zh-CN'
import {selectionPaintZhCN} from './locales/selection-paint.zh-CN'
import {photoshopZhCN} from './locales/photoshop.zh-CN'

export const SUPPORTED_LOCALES = ['zh-CN', 'en'] as const
export type Locale = typeof SUPPORTED_LOCALES[number]
export type TranslationParams = Record<string, string | number>
export const LOCALE_NAMES: Record<Locale, string> = { 'zh-CN': '简体中文', en: 'English' }
// English source phrases are stable message IDs. Protocol enum values remain English.
export const catalogs = [vectorFrameZhCN,toolsAlpha29ZhCN,editorZhCN, panelsZhCN, desktopZhCN, errorsZhCN, activityZhCN,photoshopBrushZhCN,photoshopZhCN,selectionPaintZhCN,namedSelectionsZhCN,maskPropertiesZhCN,edgeRefinementZhCN,deepZhCN,upstreamUIZhCN,rasterizeZhCN,cropZhCN,photoshopMenuZhCN,toolsAlpha23ZhCN,toolsAlpha24ZhCN,upstreamAlpha25ZhCN,retouchAlpha25ZhCN]
export const zhCN: Readonly<Record<string, string>> = Object.freeze(Object.assign(Object.create(null), ...catalogs))
export function isLocale(value: unknown): value is Locale { return value === 'zh-CN' || value === 'en' }
export function normalizeLocale(value: unknown): Locale {
  return typeof value === 'string' && /^zh(?:[-_]|$)/i.test(value) ? 'zh-CN' : 'en'
}
export function interpolate(text: string, params: TranslationParams = {}): string {
  return text.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (match, name: string) => Object.hasOwn(params, name) ? String(params[name]) : match)
}
export function translate(locale: Locale, source: string, params: TranslationParams = {}): string {
  return interpolate(locale === 'zh-CN' ? zhCN[source] ?? source : source, params)
}
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const templates = Object.entries(zhCN).filter(([source]) => /\{[A-Za-z][A-Za-z0-9_]*\}/.test(source))
  .sort(([a], [b]) => b.replace(/\{[A-Za-z][A-Za-z0-9_]*\}/g, '').length - a.replace(/\{[A-Za-z][A-Za-z0-9_]*\}/g, '').length)
  .map(([source]) => {
  const names: string[] = [], parts: string[] = []; let cursor = 0
  for (const match of source.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)) {
    parts.push(escapeRegex(source.slice(cursor, match.index)), '([\\s\\S]*?)'); names.push(match[1]); cursor = match.index! + match[0].length
  }
  parts.push(escapeRegex(source.slice(cursor)))
  return { source, names, pattern: new RegExp(`^${parts.join('')}$`) }
})
/** Localize known diagnostics at their display boundary without changing RPC errors. */
export function translateMessage(locale: Locale, message: string): string {
  if (locale === 'en') return message
  if (Object.hasOwn(zhCN, message)) return zhCN[message]
  const coded = message.match(/^([A-Z][A-Z0-9_]+):\s*([\s\S]*)$/)
  if (coded) return `${coded[1]}: ${translateMessage(locale, coded[2])}`
  for (const template of templates) {
    const match = template.pattern.exec(message)
    if (match) return translate(locale, template.source, Object.fromEntries(template.names.map((name, i) => [name, match[i + 1]])))
  }
  return message
}
