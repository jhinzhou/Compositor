import { readonly, ref } from 'vue'
import { isLocale, normalizeLocale, translate, translateMessage, type Locale, type TranslationParams } from '../shared/i18n'

const currentLocale = ref<Locale>('en')
let listening = false
export function applyLocale(locale: Locale): void {
  currentLocale.value = locale
  if (typeof document !== 'undefined') document.documentElement.lang = locale
}
export async function initializeI18n(): Promise<void> {
  if (typeof window === 'undefined') return
  if (window.compositor) {
    try {
      const result = await window.compositor.request<{ locale: Locale }>('localeGet')
      if (result.ok && isLocale(result.value.locale)) applyLocale(result.value.locale)
      else applyLocale(normalizeLocale(navigator.language))
    } catch { applyLocale(normalizeLocale(navigator.language)) }
    if (!listening) {
      window.compositor.onAction(action => { if (action === 'localeChanged') void initializeI18n() })
      listening = true
    }
  } else applyLocale(normalizeLocale(navigator.language))
}
export async function setLocale(locale: Locale): Promise<void> {
  if (!isLocale(locale)) throw new Error('Unsupported interface language.')
  if (typeof window !== 'undefined' && window.compositor) {
    const result = await window.compositor.request<{ locale: Locale }>('localeSet', { locale })
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
    applyLocale(result.value.locale)
  } else applyLocale(locale)
}
export function t(source: string, params?: TranslationParams): string { return translate(currentLocale.value, source, params) }
export function tm(message: string): string { return translateMessage(currentLocale.value, message) }
export function useI18n() { return { locale: readonly(currentLocale), t, tm, setLocale } }
