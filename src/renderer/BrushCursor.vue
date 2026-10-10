<script setup lang="ts">
import { computed,useId } from 'vue'

const props = withDefaults(defineProps<{
  /** Document coordinates; attach the overlay to canvas-wrap so panning follows the canvas. */
  point?: [number, number]
  diameter: number
  zoom: number
  tool: string
  enabled?: boolean
  hardness?: number
  showHardness?: boolean
  /** Alt temporarily samples color or selects a clone/healing source. */
  sampling?: boolean
  showSampleRing?:boolean
  sampledColor?:string
  originalColor?:string
}>(), { enabled: true })
const visible = computed(() => props.enabled !== false && !!props.point?.every(Number.isFinite) && Number.isFinite(props.zoom) && props.zoom > 0 && Number.isFinite(props.diameter) && props.diameter > 0 && ['brush', 'eraser', 'heal', 'clone', 'smear', 'eyedropper'].includes(props.tool))
const sampling = computed(() => props.sampling || props.tool === 'eyedropper')
const diameter = computed(() => Math.max(1, props.diameter * props.zoom))
const ringId=useId()
const showRing=computed(()=>sampling.value&&props.showSampleRing&&/^#[0-9a-f]{6}$/i.test(props.sampledColor??'')&&/^#[0-9a-f]{6}$/i.test(props.originalColor??''))
const extent = computed(() => sampling.value ? showRing.value?116:22 : diameter.value + 8)
const cross=computed(()=>{const c=extent.value/2;return `M ${c-8} ${c} H ${c+8} M ${c} ${c-8} V ${c+8}`})
const radius = computed(() => diameter.value / 2)
const innerRadius = computed(() => radius.value * Math.max(0, Math.min(1, props.hardness ?? 1)))
const position = computed(() => ({ left: `${(props.point?.[0] ?? 0) * props.zoom}px`, top: `${(props.point?.[1] ?? 0) * props.zoom}px` }))
</script>

<template>
  <svg v-if="visible" class="brush-cursor" aria-hidden="true" data-testid="brush-cursor" :data-mode="sampling ? 'sample' : 'brush'" :width="extent" :height="extent" :viewBox="`0 0 ${extent} ${extent}`" :style="position">
    <template v-if="sampling"><g v-if="showRing" data-testid="sample-ring"><defs><clipPath :id="`${ringId}-top`"><rect width="116" height="58"/></clipPath><clipPath :id="`${ringId}-bottom`"><rect y="58" width="116" height="58"/></clipPath></defs><circle cx="58" cy="58" r="43" stroke="#737373" stroke-width="24"/><circle cx="58" cy="58" r="43" :stroke="sampledColor" stroke-width="16" :clip-path="`url(#${ringId}-top)`"/><circle cx="58" cy="58" r="43" :stroke="originalColor" stroke-width="16" :clip-path="`url(#${ringId}-bottom)`"/></g><path :d="cross" stroke="white" stroke-width="3"/><path :d="cross" stroke="black" stroke-width="1"/></template>
    <template v-else>
      <circle :cx="extent / 2" :cy="extent / 2" :r="radius" stroke="white" stroke-width="2.5"/>
      <circle :cx="extent / 2" :cy="extent / 2" :r="radius" stroke="black" stroke-width="1"/>
      <template v-if="showHardness && innerRadius > 0 && innerRadius < radius"><circle :cx="extent / 2" :cy="extent / 2" :r="innerRadius" stroke="white" stroke-width="2.5" stroke-dasharray="4 3"/><circle :cx="extent / 2" :cy="extent / 2" :r="innerRadius" stroke="black" stroke-width="1" stroke-dasharray="4 3"/></template>
    </template>
  </svg>
</template>

<style scoped>
.brush-cursor{position:absolute;z-index:9;overflow:visible;pointer-events:none;transform:translate(-50%,-50%);fill:none}
.brush-cursor circle,.brush-cursor path{stroke-linecap:round}
</style>
