<script setup lang="ts">
import { useI18n } from './i18n'
const { t, tm } = useI18n()
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { curveValue, defaultFilter, defaultHueBand, FILTER_NAMES, HUE_RANGES, imageFilterSchema, type ImageFilter, type ImageFilterKind } from '../shared/image-filters'
import FilterParameterFields from './FilterParameterFields.vue'
import CameraRawPreview from './CameraRawPreview.vue'
import { rasterizeASCIIGlyphs } from './ascii-glyphs'
const props = defineProps<{ kind?: ImageFilterKind; initial?: ImageFilter; originalURL?: string; preview?: { requestId: number; url: string; error?: string } | null; lastFilter?: ImageFilter | null }>()
const emit = defineEmits<{ preview: [filter: ImageFilter | null, requestId: number]; apply: [filter: ImageFilter, requestId: number]; cancel: []; repeat: [filter: ImageFilter] }>()
const spec = ref<Record<string, unknown>>(JSON.parse(JSON.stringify(props.initial ?? defaultFilter(props.kind ?? 'levels')))), enabled = ref(true), requestId = ref(0), channel = ref(0), zoom = ref(false), panel = ref<HTMLElement>()
let timer: ReturnType<typeof setTimeout> | undefined
const parsed = computed(() => imageFilterSchema.safeParse(spec.value)), kind = computed(() => spec.value.kind as ImageFilterKind)
const fields = computed(() => Object.entries(spec.value).filter(([key]) => !['kind', 'ranges', 'channels', 'weights', 'shadows', 'midtones', 'highlights'].includes(key) || typeof spec.value[key] !== 'object'))
const current = computed(() => props.preview?.requestId === requestId.value ? props.preview : null), error = computed(() => parsed.value.success ? current.value?.error : parsed.value.error.issues[0]?.message)
const ready = computed(() => parsed.value.success && (!enabled.value || !!current.value) && !error.value)
const currentLevel = computed(() => (spec.value.ranges as Record<string, number>[] | undefined)?.[channel.value])
const currentCurve = computed(() => (spec.value.channels as { x: number; y: number }[][] | undefined)?.[channel.value])
const curvePath = computed(() => currentCurve.value?.length ? Array.from({ length: 256 }, (_, x) => `${x ? 'L' : 'M'} ${x} ${255 - curveValue(currentCurve.value!, x)}`).join(' ') : '')
const enumOptions: Record<string, string[]> = { style: ['atkinson', 'floydSteinberg', 'bayer2', 'bayer4', 'bayer8', 'dots', 'lines', 'diamonds', 'patterns','ascii'], colors: ['blackWhite', 'twoColors', 'original'], pixelShape: ['square', 'dot'], activeRange: [...HUE_RANGES], whiteBalance: ['Custom','Auto'], glowStyle: ['Diffusion','Bloom','Halation'], vignetteStyle: ['Highlight Priority','Color Priority','Paint Overlay'] }
function label(key: string): string { return t(key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())) }
function limits(key: string): { min: number; max: number; step: number } {
  if (key === 'seed') return { min: 0, max: 0xffffffff, step: 1 }
  if (['radius', 'distance', 'size', 'pixelSize', 'cellSize', 'lineSpacing'].includes(key)) return { min: key === 'radius' ? .1 : key === 'size' ? .5 : key === 'lineSpacing' ? 2 : key === 'cellSize' ? 4 : 1, max: key === 'radius' ? 250 : key === 'distance' ? 2000 : key === 'size' ? 20 : key === 'cellSize' ? 64 : 32, step: ['radius', 'size'].includes(key) ? .1 : 1 }
  if (key === 'exposure') return { min: kind.value === 'cameraRaw' ? -5 : -20, max: kind.value === 'cameraRaw' ? 5 : 20, step: .1 }
  if (key === 'gamma') return { min: .01, max: 9.99, step: .01 }
  if (key === 'offset') return { min: -.5, max: .5, step: .01 }
  if (key === 'hue') return { min: -360, max: 360, step: 1 }
  if (key === 'tintHue') return { min: 0, max: 360, step: 1 }
  if (key === 'angle') return { min: -90, max: 90, step: 1 }
  if (key === 'levels') return { min: 2, max: 8, step: 1 }
  if (key === 'textSize') return { min: 6, max: 64, step: 1 }
  if (key === 'split') return { min: 0, max: 16, step: 1 }
  if (key === 'wobble') return { min: 0, max: 64, step: 1 }
  if (key === 'amount') return { min: kind.value === 'addNoise' ? .1 : 0, max: kind.value === 'addNoise' ? 400 : 100, step: .1 }
  return { min: ['saturation', 'lightness', 'temperature', 'tint', 'contrast', 'shadows', 'highlights', 'whites', 'blacks', 'vibrance', 'texture', 'clarity', 'dehaze', 'glowSpread', 'glowWarmth', 'vignetteAmount', 'distortion', 'density', 'roundness', 'displace'].includes(key) ? -100 : 0, max: 100, step: 1 }
}
function numberValue(event: Event): number { return Number((event.target as HTMLInputElement).value) }
function setKind(event: Event): void { spec.value = { ...defaultFilter((event.target as HTMLSelectElement).value as ImageFilterKind) }; channel.value = 0 }
function refresh(): void {
  clearTimeout(timer); requestId.value++
  if (!parsed.value.success) return
  const filter = parsed.value.data, id = requestId.value
  if (!enabled.value) { emit('preview', null, id); return }
  timer = setTimeout(() => emit('preview', prepared(filter), id), 180)
}
function prepared(filter: ImageFilter): ImageFilter { return filter.kind === 'dither' && filter.style === 'ascii' ? { ...filter, glyphs: rasterizeASCIIGlyphs(filter.characters || ' .:-=+*#%@', filter.textSize) } : filter }
function apply(): void { if (ready.value && parsed.value.success) emit('apply', prepared(parsed.value.data), requestId.value) }
function hueRange(): Record<string, unknown> | null {
  if (kind.value !== 'hsl' || spec.value.activeRange === 'Master') return null
  return (spec.value.hueRanges as Record<string,unknown>[]).find(value => value.range === spec.value.activeRange) ?? null
}
function addHueRange(): void {
  const values = [...spec.value.hueRanges as Record<string,unknown>[]], range = spec.value.activeRange as typeof HUE_RANGES[number]
  if (range !== 'Master' && !values.some(value => value.range === range)) { values.push({ range, hue: 0, saturation: 0, lightness: 0, band: defaultHueBand(range) }); spec.value.hueRanges = values }
}
function setHueRange(value: Record<string,unknown>): void { spec.value.hueRanges = (spec.value.hueRanges as Record<string,unknown>[]).map(range => range.range === spec.value.activeRange ? value : range) }
function group(key: string): Record<string,unknown> { return spec.value[key] as Record<string,unknown> }
function addPoint(event: MouseEvent): void {
  if (!currentCurve.value || currentCurve.value.length >= 32) return
  const rect = (event.currentTarget as SVGElement).getBoundingClientRect(), x = Math.max(1, Math.min(254, Math.round((event.clientX - rect.left) / rect.width * 255))), y = Math.max(0, Math.min(255, Math.round(255 - (event.clientY - rect.top) / rect.height * 255)))
  if (currentCurve.value.some(point => point.x === x)) return
  currentCurve.value.push({ x, y }); currentCurve.value.sort((a, b) => a.x - b.x)
}
function arrayValue(key: string): number[] { return spec.value[key] as number[] }
function keydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') { event.preventDefault(); emit('cancel') }
  if (event.key === 'Tab' && panel.value) {
    const fields = [...panel.value.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])')], first = fields[0], last = fields.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
}
watch(() => props.kind, value => { if (value) spec.value = { ...defaultFilter(value) } })
watch([spec, enabled], refresh, { deep: true })
onMounted(() => { refresh(); panel.value?.querySelector<HTMLElement>('select')?.focus() })
onBeforeUnmount(() => clearTimeout(timer))
</script>
<template>
  <div class="filter-backdrop" @pointerdown.stop @keydown.stop="keydown"><form ref="panel" novalidate class="filter-panel" role="dialog" aria-modal="true" aria-labelledby="filter-heading" @submit.prevent="apply">
    <header><h2 id="filter-heading">{{ t(FILTER_NAMES[kind]) }}</h2><select :value="kind" :aria-label="t('Filter')" @change="setKind"><option v-for="(name, key) in FILTER_NAMES" :key="key" :value="key">{{ t(name) }}</option></select></header>
    <div class="filter-content"><CameraRawPreview v-if="parsed.success && parsed.data.kind === 'cameraRaw'" :url="enabled ? preview?.url || originalURL : originalURL" :originalURL="originalURL" :spec="parsed.data" @geometry="spec.geometry = $event" @mixer="spec.mixer = $event"/><div v-else class="filter-preview" :class="{ actual: zoom }" @dblclick="zoom = !zoom"><img v-if="enabled ? preview?.url || originalURL : originalURL" :src="enabled ? preview?.url || originalURL : originalURL" :alt="t('Filter preview')" draggable="false" /><span v-if="enabled && !current" class="filter-updating">{{ t('Updating…') }}</span></div>
      <div class="filter-controls">
        <template v-if="kind === 'levels' || kind === 'curves'"><label class="filter-row">{{ t('Channel') }}<select v-model.number="channel"><option v-for="(name, index) in ['RGB', 'Red', 'Green', 'Blue']" :key="name" :value="index">{{ t(name) }}</option></select></label></template>
        <template v-if="currentLevel"><label v-for="(value, key) in currentLevel" :key="key" class="filter-row">{{ label(String(key)) }}<input v-model.number="currentLevel[key]" type="number" :min="key === 'gamma' ? .1 : 0" :max="key === 'gamma' ? 9.99 : 255" :step="key === 'gamma' ? .01 : 1" /></label></template>
        <template v-if="currentCurve"><svg class="filter-curve" viewBox="0 0 255 255" role="img" :aria-label="t('Curve; double click to add a point')" @dblclick="addPoint"><path d="M 0 255 L 255 0" stroke="#666"/><path :d="curvePath" stroke="#ddd" fill="none"/><circle v-for="(point, index) in currentCurve" :key="index" :cx="point.x" :cy="255-point.y" r="4" fill="#1688ff"/></svg><div v-for="(point, index) in currentCurve" :key="index" class="filter-curve-point"><label>{{ t('Input') }}<input v-model.number="point.x" type="number" min="0" max="255" :disabled="index === 0 || index === currentCurve.length - 1" /></label><label>{{ t('Output') }}<input v-model.number="point.y" type="number" min="0" max="255" /></label><button type="button" :disabled="index === 0 || index === currentCurve.length - 1" @click="currentCurve.splice(index, 1)">×</button></div></template>
        <template v-if="kind === 'blackWhite'"><label v-for="(value, index) in arrayValue('weights')" :key="index" class="filter-row">{{ t(['Reds','Yellows','Greens','Cyans','Blues','Magentas'][index]) }}<input v-model.number="arrayValue('weights')[index]" type="number" min="-200" max="300" /></label></template>
        <template v-if="kind === 'colorBalance'"><fieldset v-for="tone in ['shadows','midtones','highlights']" :key="tone"><legend>{{ label(tone) }}</legend><label v-for="(value,index) in arrayValue(tone)" :key="index" class="filter-row">{{ t(['Cyan / Red','Magenta / Green','Yellow / Blue'][index]) }}<input v-model.number="arrayValue(tone)[index]" type="number" min="-100" max="100" /></label></fieldset></template>
        <label v-for="([key,value]) in fields" :key="key" v-show="typeof value !== 'object'" class="filter-row">{{ label(key) }}<input v-if="typeof value === 'boolean'" :checked="value" type="checkbox" @change="spec[key] = ($event.target as HTMLInputElement).checked"/><template v-else-if="typeof value === 'number'"><input :value="value" type="number" v-bind="limits(key)" @input="spec[key] = numberValue($event)"/></template><input v-else-if="typeof value === 'string' && value.startsWith('#')" :value="value" type="color" @input="spec[key] = ($event.target as HTMLInputElement).value"/><select v-else-if="typeof value === 'string' && enumOptions[key]" :value="value" @change="spec[key] = ($event.target as HTMLSelectElement).value"><option v-for="option in enumOptions[key]" :key="option" :value="option">{{ label(option) }}</option></select><input v-else-if="typeof value === 'string'" :value="value" type="text" @input="spec[key] = ($event.target as HTMLInputElement).value"/></label>
        <template v-if="kind === 'hsl' && spec.activeRange !== 'Master'"><button v-if="!hueRange()" type="button" @click="addHueRange">{{ t('Adjust {range}', {range:t(String(spec.activeRange))}) }}</button><FilterParameterFields v-else :value="hueRange()!" path="hsl" @update="setHueRange"/></template>
        <template v-if="kind === 'cameraRaw'"><fieldset v-for="key in ['curve','mixer','grading','detail','optics','geometry','calibration']" :key="key"><legend>{{ label(key) }}</legend><FilterParameterFields :value="group(key)" :path="key" @update="spec[key] = $event"/></fieldset></template>
      </div></div>
    <footer><label><input v-model="enabled" type="checkbox"/> {{ t('Preview') }}</label><button type="button" @click="zoom = !zoom">{{ zoom ? t('Fit') : '100%' }}</button><button type="button" @click="spec = {...defaultFilter(kind)}">{{ t('Reset') }}</button><button v-if="lastFilter" type="button" @click="emit('repeat', lastFilter)">{{ t('Repeat last') }}</button><span v-if="error" class="filter-error" role="alert">{{ tm(error || '') }}</span><button type="button" @click="emit('cancel')">{{ t('Cancel') }}</button><button class="filter-primary" type="submit" :disabled="!ready">{{ t('Apply') }}</button></footer>
  </form></div>
</template>
<style scoped>
.filter-backdrop{position:fixed;inset:0;z-index:31;display:flex;align-items:center;justify-content:center;background:#0007;user-select:none}.filter-panel{width:min(880px,calc(100vw - 40px));max-height:calc(100vh - 40px);overflow:auto;padding:22px;background:#292929;border:1px solid #555;border-radius:12px;box-shadow:0 18px 60px #0009;color:#ddd;font-size:12px}.filter-panel header,.filter-panel footer{display:flex;align-items:center;gap:10px}.filter-panel header{justify-content:space-between;margin-bottom:18px}.filter-panel h2{font-size:19px;margin:0}.filter-content{display:grid;grid-template-columns:minmax(200px,1fr) 270px;gap:20px}.filter-preview{height:min(460px,58vh);background:#171717;position:relative;display:flex;align-items:center;justify-content:center;overflow:auto}.filter-preview img{max-width:100%;max-height:100%;background:repeating-conic-gradient(#888 0% 25%,#aaa 0% 50%) 0 0/16px 16px;object-fit:contain}.filter-preview.actual{display:block}.filter-preview.actual img{max-width:none;max-height:none;image-rendering:pixelated}.filter-updating{position:absolute;bottom:10px;left:10px;padding:6px 9px;background:#222d;border-radius:4px}.filter-controls{overflow:auto;max-height:min(460px,58vh)}.filter-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}.filter-panel input,.filter-panel select{height:28px;background:#202020;color:#ddd;border:1px solid #484848;border-radius:5px;padding:3px 7px;min-width:0}.filter-row input[type=number]{width:90px;text-align:right}.filter-row input[type=color]{width:46px;padding:2px}.filter-row input[type=checkbox],.filter-panel footer input[type=checkbox]{height:auto}.filter-row select{max-width:155px}.filter-panel button{background:#3b3b3b;border:1px solid #555;border-radius:6px;padding:5px 10px;color:#ddd}.filter-panel button:disabled{opacity:.45}.filter-panel footer{margin-top:20px;flex-wrap:wrap;justify-content:flex-end}.filter-panel footer>label{margin-right:auto;display:flex;align-items:center;gap:7px}.filter-error{color:#f0a7a7;max-width:290px}.filter-panel .filter-primary{background:#087dff;border-color:#087dff;color:white}.filter-panel fieldset{margin:0 0 12px;padding:10px 10px 0;border:1px solid #484848;border-radius:5px}.filter-curve{width:255px;height:255px;background:#202020;border:1px solid #484848;cursor:crosshair}.filter-curve-point{display:flex;gap:5px;align-items:center;margin-top:8px}.filter-curve-point input{width:52px}.filter-curve-point label{display:flex;gap:5px;align-items:center}.filter-panel :focus-visible{outline:2px solid #1688ff;outline-offset:2px}@media(max-width:720px){.filter-content{grid-template-columns:minmax(160px,1fr) 220px}.filter-curve{width:210px;height:210px}}
</style>
