<script setup lang="ts">
import { useI18n } from './i18n'
const { t, tm } = useI18n()
import { computed, onBeforeUnmount, ref } from 'vue'
import { DEFAULT_GRID, fitRect, gridLines, navigatorPoint, navigatorSize, navigatorViewport, normalizeGrid, rulerTicks, snapGuide, visibleDocumentRect } from './view-geometry'
import type { Guide, GridSettings, Point, Size, SnapOptions } from './view-geometry'
const props = withDefaults(defineProps<{ document: Size; viewport: Size; canvasOrigin: Point; zoom: number; thumbnail?: string; navigator?: boolean; rulers?: boolean; gridVisible?: boolean; guidesVisible?: boolean; pixelGrid?: boolean; guidesLocked?: boolean; guides?: Guide[]; grid?: GridSettings; snap?: SnapOptions }>(), { navigator: false, rulers: false, gridVisible: false, guidesVisible: true, pixelGrid: true, guidesLocked: false, guides: () => [], grid: () => ({ ...DEFAULT_GRID }) })
const emit = defineEmits<{ center: [point: Point]; guidesChange: [guides: Guide[]]; gridChange: [settings: GridSettings] }>()
const host = ref<HTMLElement>(), showSettings = ref(false), draftGuide = ref<Guide>(), dragging = ref(false)
let originalGuide: Guide | undefined, creating = false
const visible = computed(() => visibleDocumentRect(props.viewport, props.canvasOrigin, props.zoom))
const clipped = computed(() => ({ x: Math.max(0, visible.value.x), y: Math.max(0, visible.value.y), right: Math.min(props.document.width, visible.value.x + visible.value.width), bottom: Math.min(props.document.height, visible.value.y + visible.value.height) }))
const settings = computed(() => normalizeGrid(props.grid))
const xs = computed(() => gridLines(clipped.value.x, clipped.value.right, settings.value))
const ys = computed(() => gridLines(clipped.value.y, clipped.value.bottom, settings.value))
const pixelXs = computed(() => gridLines(clipped.value.x, clipped.value.right, { spacing: 2, subdivisions: 2 }))
const pixelYs = computed(() => gridLines(clipped.value.y, clipped.value.bottom, { spacing: 2, subdivisions: 2 }))
const xTicks = computed(() => rulerTicks(visible.value.x, visible.value.x + visible.value.width, props.zoom))
const yTicks = computed(() => rulerTicks(visible.value.y, visible.value.y + visible.value.height, props.zoom))
const minimapSize = computed(() => navigatorSize(props.document))
const imageRect = computed(() => fitRect(props.document, minimapSize.value))
const viewportRect = computed(() => navigatorViewport(props.document, minimapSize.value, visible.value))
const displayedGuides = computed(() => draftGuide.value ? [...props.guides.filter(guide => guide.id !== draftGuide.value!.id), draftGuide.value] : props.guides)
const x = (value: number): number => props.canvasOrigin.x + value * props.zoom
const y = (value: number): number => props.canvasOrigin.y + value * props.zoom
function localPoint(event: PointerEvent): Point { const box = host.value!.getBoundingClientRect(); return { x: event.clientX - box.left, y: event.clientY - box.top } }
function startGuide(event: PointerEvent, axis: Guide['axis'], existing?: Guide): void {
  if (props.guidesLocked || event.button !== 0 || !host.value) return
  event.preventDefault(); event.stopPropagation(); creating = !existing; originalGuide = existing
  draftGuide.value = existing ? { ...existing } : { id: crypto.randomUUID(), axis, position: 0 }
  dragging.value = true; moveGuide(event)
  window.addEventListener('pointermove', moveGuide); window.addEventListener('pointerup', finishGuide); window.addEventListener('pointercancel', cancelGuide); window.addEventListener('keydown', guideKey)
}
function moveGuide(event: PointerEvent): void {
  if (!draftGuide.value || !host.value) return
  const point = localPoint(event), axis = draftGuide.value.axis
  let position = (axis === 'vertical' ? point.x - props.canvasOrigin.x : point.y - props.canvasOrigin.y) / props.zoom
  if (props.snap && !event.ctrlKey) position = snapGuide(position, axis, props.snap, draftGuide.value.id)
  draftGuide.value = { ...draftGuide.value, position }
}
function cleanup(): void { window.removeEventListener('pointermove', moveGuide); window.removeEventListener('pointerup', finishGuide); window.removeEventListener('pointercancel', cancelGuide); window.removeEventListener('keydown', guideKey); dragging.value = false; draftGuide.value = undefined; originalGuide = undefined }
function finishGuide(event: PointerEvent): void {
  if (!draftGuide.value || !host.value) return
  const point = localPoint(event), outside = point.x < (props.rulers ? 20 : 0) || point.y < (props.rulers ? 20 : 0) || point.x > props.viewport.width || point.y > props.viewport.height
  const guide = draftGuide.value
  if (!outside) emit('guidesChange', [...props.guides.filter(item => item.id !== guide.id), guide])
  else if (!creating && originalGuide) emit('guidesChange', props.guides.filter(item => item.id !== guide.id))
  cleanup()
}
function cancelGuide(): void { cleanup() }
function guideKey(event: KeyboardEvent): void { if (event.key === 'Escape') { event.preventDefault(); cancelGuide() } }
function navigate(event: PointerEvent): void {
  const target = event.currentTarget as HTMLElement
  if (event.type === 'pointerdown') { if (event.button !== 0) return; target.setPointerCapture(event.pointerId) }
  if (event.type === 'pointermove' && !target.hasPointerCapture(event.pointerId)) return
  event.preventDefault(); event.stopPropagation(); const box = target.getBoundingClientRect()
  emit('center', navigatorPoint({ x: event.clientX - box.left - target.clientLeft, y: event.clientY - box.top - target.clientTop }, props.document, minimapSize.value))
}
function updateGrid(key: keyof GridSettings, value: string): void { emit('gridChange', normalizeGrid({ ...settings.value, [key]: key === 'spacing' || key === 'subdivisions' || key === 'opacity' ? Number(value) : value })) }
onBeforeUnmount(cleanup)
</script>
<template>
  <div ref="host" class="workspace-overlays" :class="{ dragging }" :style="{ width: `${viewport.width}px`, height: `${viewport.height}px` }">
    <svg class="workspace-lines" :width="viewport.width" :height="viewport.height" :aria-label="t('Canvas guides and grid')">
      <defs><clipPath id="workspace-document-clip"><rect :x="x(0)" :y="y(0)" :width="document.width * zoom" :height="document.height * zoom" /></clipPath></defs>
      <g v-if="gridVisible" clip-path="url(#workspace-document-clip)" :stroke="settings.color" :stroke-opacity="settings.opacity / 100">
        <line v-for="line in xs" :key="`gx${line.position}`" :x1="x(line.position)" :x2="x(line.position)" :y1="y(0)" :y2="y(document.height)" :stroke-dasharray="line.major ? settings.style === 'dashed' ? '4 3' : settings.style === 'dots' ? '1 2' : undefined : '1 2'" :opacity="line.major ? 1 : 28 / 45" />
        <line v-for="line in ys" :key="`gy${line.position}`" :y1="y(line.position)" :y2="y(line.position)" :x1="x(0)" :x2="x(document.width)" :stroke-dasharray="line.major ? settings.style === 'dashed' ? '4 3' : settings.style === 'dots' ? '1 2' : undefined : '1 2'" :opacity="line.major ? 1 : 28 / 45" />
      </g>
      <g v-if="pixelGrid && zoom >= 8" clip-path="url(#workspace-document-clip)" stroke="#888" stroke-opacity=".32">
        <line v-for="line in pixelXs" :key="`px${line.position}`" :x1="x(line.position)" :x2="x(line.position)" :y1="y(0)" :y2="y(document.height)" />
        <line v-for="line in pixelYs" :key="`py${line.position}`" :y1="y(line.position)" :y2="y(line.position)" :x1="x(0)" :x2="x(document.width)" />
      </g>
      <g v-if="guidesVisible || dragging" stroke="#00ffff" stroke-opacity=".9">
        <g v-for="guide in displayedGuides" :key="guide.id">
          <line v-if="guide.axis === 'vertical'" :x1="x(guide.position)" :x2="x(guide.position)" y1="0" :y2="viewport.height" />
          <line v-else :y1="y(guide.position)" :y2="y(guide.position)" x1="0" :x2="viewport.width" />
          <line v-if="guide.axis === 'vertical'" class="guide-hit vertical" :class="{ locked: guidesLocked }" :x1="x(guide.position)" :x2="x(guide.position)" y1="20" :y2="viewport.height" @pointerdown="startGuide($event, guide.axis, guide)" />
          <line v-else class="guide-hit horizontal" :class="{ locked: guidesLocked }" :y1="y(guide.position)" :y2="y(guide.position)" x1="20" :x2="viewport.width" @pointerdown="startGuide($event, guide.axis, guide)" />
        </g>
      </g>
      <g v-if="rulers" class="rulers">
        <rect x="20" y="0" :width="Math.max(0, viewport.width - 20)" height="20" class="ruler-background" @pointerdown="startGuide($event, 'horizontal')" />
        <rect x="0" y="20" width="20" :height="Math.max(0, viewport.height - 20)" class="ruler-background" @pointerdown="startGuide($event, 'vertical')" />
        <g v-for="tick in xTicks" :key="`rx${tick.position}`"><line :x1="x(tick.position)" :x2="x(tick.position)" :y1="tick.major ? 13 : 17" y2="20" /><text v-if="tick.major && x(tick.position) > 20" :x="x(tick.position) + 3" y="11">{{ tick.position }}</text></g>
        <g v-for="tick in yTicks" :key="`ry${tick.position}`"><line :y1="y(tick.position)" :y2="y(tick.position)" :x1="tick.major ? 13 : 17" x2="20" /><text v-if="tick.major && y(tick.position) > 20" :transform="`translate(11 ${y(tick.position) + 3}) rotate(-90)`">{{ tick.position }}</text></g>
        <rect width="20" height="20" class="ruler-background" />
      </g>
    </svg>
    <div v-if="navigator && zoom >= 3" class="navigator-minimap" :style="{ width: `${minimapSize.width}px`, height: `${minimapSize.height}px` }" role="slider" :aria-label="t('Navigator')" :aria-valuetext="t('Click or drag to center the canvas')" tabindex="0" @pointerdown="navigate" @pointermove="navigate" @pointerup="($event.currentTarget as HTMLElement).releasePointerCapture($event.pointerId)" @keydown="if ($event.key.startsWith('Arrow')) { $event.preventDefault(); emit('center', { x: visible.x + visible.width / 2 + ($event.key === 'ArrowRight' ? 20 : $event.key === 'ArrowLeft' ? -20 : 0) / zoom, y: visible.y + visible.height / 2 + ($event.key === 'ArrowDown' ? 20 : $event.key === 'ArrowUp' ? -20 : 0) / zoom }) }">
      <img v-if="thumbnail" :src="thumbnail" :alt="t('Document overview')" :style="{ left: `${imageRect.x}px`, top: `${imageRect.y}px`, width: `${imageRect.width}px`, height: `${imageRect.height}px` }" draggable="false" />
      <span v-if="viewportRect.width && viewportRect.height" class="navigator-viewport" :style="{ left: `${viewportRect.x}px`, top: `${viewportRect.y}px`, width: `${viewportRect.width}px`, height: `${viewportRect.height}px` }" />
    </div>
    <button v-if="gridVisible" class="grid-settings-button" :aria-label="t('Grid settings')" @click="showSettings = !showSettings">{{ t('Grid…') }}</button>
    <div v-if="showSettings" class="grid-settings" role="dialog" :aria-label="t('Grid settings')" @keydown.esc.stop="showSettings = false">
      <label>{{ t('Spacing') }} <input type="number" min="2" max="4096" :value="settings.spacing" @change="updateGrid('spacing', ($event.target as HTMLInputElement).value)" /> px</label>
      <label>{{ t('Subdivisions') }} <input type="number" min="1" :max="Math.min(64, settings.spacing)" :value="settings.subdivisions" @change="updateGrid('subdivisions', ($event.target as HTMLInputElement).value)" /></label>
      <label>{{ t('Color') }} <input type="color" :value="settings.color" @input="updateGrid('color', ($event.target as HTMLInputElement).value)" /></label>
      <label>{{ t('Opacity') }} <input type="number" min="1" max="100" :value="settings.opacity" @change="updateGrid('opacity', ($event.target as HTMLInputElement).value)" /> %</label>
      <label>{{ t('Style') }} <select :value="settings.style" @change="updateGrid('style', ($event.target as HTMLSelectElement).value)"><option value="lines">{{ t('Lines') }}</option><option value="dashed">{{ t('Dashed Lines') }}</option><option value="dots">{{ t('Dots') }}</option></select></label>
      <button @click="showSettings = false">{{ t('Done') }}</button>
    </div>
  </div>
</template>
<style scoped>
.workspace-overlays{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:4}.workspace-lines{position:absolute;inset:0;pointer-events:none;stroke-width:1}.ruler-background{fill:#292929;pointer-events:all;cursor:crosshair}.rulers line{stroke:#999}.rulers text{fill:#bbb;font:9px system-ui;stroke:none;pointer-events:none}.guide-hit{stroke:transparent;stroke-width:10;pointer-events:stroke}.guide-hit.vertical{cursor:ew-resize}.guide-hit.horizontal{cursor:ns-resize}.guide-hit.locked{pointer-events:none}.navigator-minimap{position:absolute;right:14px;top:30px;background:repeating-conic-gradient(#373737 0% 25%,#242424 0% 50%) 0 0/10px 10px;border:1px solid #666;border-radius:4px;overflow:hidden;box-shadow:0 2px 6px #0009;pointer-events:all;touch-action:none;cursor:default}.navigator-minimap img{position:absolute;pointer-events:none}.navigator-viewport{position:absolute;box-sizing:border-box;border:2.5px solid #0085ff;pointer-events:none;min-width:3px;min-height:3px}.grid-settings-button{position:absolute;right:14px;bottom:12px;pointer-events:all;background:#303030;color:#ddd;border:1px solid #555;border-radius:4px;padding:4px 9px}.grid-settings{position:absolute;right:14px;bottom:43px;display:grid;gap:10px;background:#292929;border:1px solid #555;padding:16px;color:#ddd;border-radius:7px;pointer-events:all;font:12px system-ui}.grid-settings label{display:flex;align-items:center;gap:8px;justify-content:space-between}.grid-settings input{width:65px}.grid-settings input,.grid-settings select,.grid-settings button{color:#ddd;background:#1d1d1d;border:1px solid #555;border-radius:4px;padding:4px}.dragging{cursor:crosshair}
</style>
