<script setup lang="ts">
import {LIMITS} from '../shared/limits'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { exportOptionsSchema, type ExportOptions, type ExportPreview } from '../shared/export-options'

const props = defineProps<{ width: number; height: number; resolution?: number; preview?: ExportPreview | null }>()
const emit = defineEmits<{ preview: [options: ExportOptions, requestId: number]; export: [options: ExportOptions, requestId: number]; cancel: [] }>()
const format = ref<ExportOptions['format']>('png'), width = ref(props.width), height = ref(props.height), resolution = ref(props.resolution ?? 72), quality = ref(85), background = ref('#ffffff'), transparent = ref(false), locked = ref(true)
const requestId = ref(0), zoom = ref<number | null>(null), panel = ref<HTMLElement>(), viewport = ref<HTMLElement>()
let timer: ReturnType<typeof setTimeout> | undefined
const options = computed(() => exportOptionsSchema.safeParse({ format: format.value, width: width.value, height: height.value, resolution: resolution.value, quality: quality.value / 100, background: transparent.value && format.value === 'pdf' ? null : background.value }))
const validation = computed(() => options.value.success ? '' : options.value.error.issues[0]?.message ?? 'Invalid export settings.')
const current = computed(() => props.preview?.requestId === requestId.value ? props.preview : null)
const ready = computed(() => options.value.success && !!current.value && !current.value.error)
const pageSize = computed(() => `${(width.value / resolution.value).toFixed(2)} × ${(height.value / resolution.value).toFixed(2)} in at ${resolution.value} DPI`)
const byteSize = computed(() => { const bytes = current.value?.bytes ?? 0; return bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(2)} MB` : `${(bytes / 1024).toFixed(1)} KB` })
const imageStyle = computed(() => zoom.value === null ? {} : { width: `${width.value * zoom.value}px`, height: `${height.value * zoom.value}px`, maxWidth: 'none', maxHeight: 'none', imageRendering: zoom.value >= 1 ? 'pixelated' : 'auto' } as const)
function changeWidth(event: Event): void {
  width.value = Number((event.target as HTMLInputElement).value)
  if (locked.value) height.value = Math.max(1, Math.round(width.value * props.height / props.width))
}
function changeHeight(event: Event): void {
  height.value = Number((event.target as HTMLInputElement).value)
  if (locked.value) width.value = Math.max(1, Math.round(height.value * props.width / props.height))
}
function setScale(event: Event): void {
  const scale = Number((event.target as HTMLSelectElement).value)
  width.value = Math.max(1, Math.round(props.width * scale)); height.value = Math.max(1, Math.round(props.height * scale))
}
function refresh(): void {
  clearTimeout(timer); requestId.value++
  if (!options.value.success) return
  const value = options.value.data, id = requestId.value
  timer = setTimeout(() => emit('preview', value, id), 200)
}
function save(): void { if (ready.value && options.value.success) emit('export', options.value.data, requestId.value) }
function keydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); emit('cancel') }
  if (event.key === 'Tab' && panel.value) {
    const fields = [...panel.value.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]')]
    const first = fields[0], last = fields.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
}
let drag: { x: number; y: number; scrollX: number; scrollY: number; id: number } | null = null
function panStart(event: PointerEvent): void {
  if (zoom.value === null || event.button !== 0 || !viewport.value) return
  drag = { x: event.clientX, y: event.clientY, scrollX: viewport.value.scrollLeft, scrollY: viewport.value.scrollTop, id: event.pointerId }
  viewport.value.setPointerCapture(event.pointerId)
}
function panMove(event: PointerEvent): void {
  if (drag && viewport.value) { viewport.value.scrollLeft = drag.scrollX + drag.x - event.clientX; viewport.value.scrollTop = drag.scrollY + drag.y - event.clientY }
}
function panEnd(): void { drag = null }
watch(options, refresh)
onMounted(async () => { refresh(); await nextTick(); panel.value?.querySelector<HTMLElement>('select')?.focus() })
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <div class="export-backdrop" @pointerdown.stop @keydown.stop="keydown">
    <form ref="panel" class="export-panel" role="dialog" aria-modal="true" aria-labelledby="export-heading" @submit.prevent="save">
      <header><h2 id="export-heading">Export As</h2><div class="export-zoom"><button type="button" :class="{ active: zoom === null }" @click="zoom = null">Fit</button><button type="button" :class="{ active: zoom === 1 }" @click="zoom = 1">100%</button><button type="button" aria-label="Zoom out preview" @click="zoom = Math.max(.125, (zoom ?? 1) / 2)">−</button><button type="button" aria-label="Zoom in preview" @click="zoom = Math.min(8, (zoom ?? 1) * 2)">+</button></div></header>
      <div ref="viewport" class="export-preview" :class="{ fitted: zoom === null, pannable: zoom !== null }" @dblclick="zoom = zoom === null ? 1 : null" @pointerdown="panStart" @pointermove="panMove" @pointerup="panEnd" @pointercancel="panEnd">
        <div v-if="preview?.url" class="export-image-space"><img :src="preview.url" :style="imageStyle" alt="Export preview" draggable="false" /></div>
        <span v-if="!current && !validation" class="export-updating" role="status">Updating preview…</span>
      </div>
      <div class="export-fields">
        <label for="export-format">Format</label><select id="export-format" v-model="format"><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="pdf">PDF</option></select>
        <label for="export-width">Size</label><div class="export-size"><input id="export-width" :value="width" type="number" min="1" :max="LIMITS.maxSide" step="1" aria-label="Export width" @input="changeWidth" /><span>×</span><input :value="height" type="number" min="1" :max="LIMITS.maxSide" step="1" aria-label="Export height" @input="changeHeight" /><span>px</span><button type="button" :aria-pressed="locked" title="Lock aspect ratio" @click="locked = !locked">{{ locked ? 'Linked' : 'Unlinked' }}</button><select aria-label="Export scale" @change="setScale"><option disabled selected>Scale</option><option v-for="scale in [.25, .5, .75, 1, 2]" :key="scale" :value="scale">{{ scale * 100 }}%</option></select></div>
        <label for="export-resolution">Resolution</label><div class="export-size"><input id="export-resolution" v-model.number="resolution" type="number" min="1" max="9600" aria-label="Export DPI" /><span>DPI</span></div>
        <template v-if="format === 'jpeg'"><label for="export-quality">Quality</label><div class="export-quality"><input id="export-quality" v-model.number="quality" type="range" min="0" max="100" step="1" /><output>{{ quality }}%</output></div></template>
        <template v-if="format !== 'png'"><label for="export-background">Background</label><div class="export-size"><input id="export-background" v-model="background" type="color" :disabled="transparent && format === 'pdf'" aria-label="Export background color" /><label v-if="format === 'pdf'" class="export-transparent"><input v-model="transparent" type="checkbox" /> Keep transparency</label></div></template>
        <template v-if="format === 'pdf'"><span>Page</span><span class="export-muted">{{ pageSize }}</span></template>
      </div>
      <footer><span class="export-muted">{{ format === 'png' || format === 'pdf' && transparent ? 'Transparency kept · sRGB' : 'sRGB' }}</span><span v-if="validation || current?.error" class="export-error" role="alert">{{ validation || current?.error }}</span><span v-else class="export-estimate">{{ current ? byteSize : 'Updating…' }}</span><button type="button" @click="emit('cancel')">Cancel</button><button class="export-primary" type="submit" :disabled="!ready">Export…</button></footer>
    </form>
  </div>
</template>

<style scoped>
.export-backdrop{position:fixed;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;background:#0007;user-select:none}.export-panel{width:min(680px,calc(100vw - 40px));max-height:calc(100vh - 40px);overflow:auto;background:#292929;border:1px solid #555;border-radius:12px;padding:24px;box-shadow:0 18px 60px #0009;color:#ddd;font-size:13px}.export-panel header,.export-panel footer,.export-zoom,.export-size,.export-quality{display:flex;align-items:center;gap:10px}.export-panel header{justify-content:space-between;margin-bottom:15px}.export-panel h2{font-size:19px;margin:0}.export-zoom{gap:5px}.export-panel button{background:#3b3b3b;border:1px solid #555;border-radius:6px;padding:5px 11px;color:#ddd}.export-panel button.active{background:#4c4c4c}.export-panel button:disabled{opacity:.45}.export-preview{height:min(330px,40vh);overflow:auto;background:#191919;position:relative;border:1px solid #3a3a3a}.export-image-space{display:flex;align-items:center;justify-content:center;min-width:100%;min-height:100%;width:max-content;height:max-content}.export-preview img{display:block;flex-shrink:0;background:repeating-conic-gradient(#888 0% 25%,#aaa 0% 50%) 0 0/16px 16px}.export-preview.fitted .export-image-space{width:100%;height:100%}.export-preview.fitted img{max-width:100%;max-height:100%;object-fit:contain}.export-preview.pannable{cursor:grab}.export-updating{position:sticky;display:block;bottom:10px;left:10px;width:max-content;padding:7px 10px;background:#222d;border-radius:5px;font-size:12px}.export-fields{display:grid;grid-template-columns:90px minmax(0,1fr);align-items:center;gap:14px 12px;margin:20px 0}.export-panel input,.export-panel select{background:#202020;color:#ddd;border:1px solid #484848;border-radius:5px;height:29px;padding:3px 7px;min-width:0}.export-size{flex-wrap:wrap;gap:6px}.export-size input[type=number]{width:82px;text-align:right}.export-size input[type=color]{width:45px;padding:3px}.export-quality input{width:250px}.export-quality output{width:44px;text-align:right}.export-transparent{display:flex;align-items:center;gap:7px}.export-transparent input{height:auto}.export-muted{color:#999;font-size:12px}.export-panel footer{flex-wrap:wrap}.export-estimate,.export-error{margin-left:auto;font-size:12px}.export-error{color:#f0a7a7;max-width:310px}.export-panel .export-primary{background:#087dff;border-color:#087dff;color:white}.export-panel :focus-visible{outline:2px solid #1787ff;outline-offset:2px}
</style>
