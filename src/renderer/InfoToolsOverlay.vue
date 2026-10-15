<script setup lang="ts">
import {computed} from 'vue'
import type {DocumentInfo,InfoPoint} from '../shared/document-info'
import {useI18n} from './i18n'
import {infoToolLabel} from './info-tools-labels'
const {locale}=useI18n()
const props=withDefaults(defineProps<{info:DocumentInfo;width:number;height:number;zoom:number;interactive?:boolean;sampleInteractive?:boolean;rulerInteractive?:boolean;rulerDraft?:DocumentInfo['ruler']}>(),{interactive:true})
const emit=defineEmits<{'sample-down':[event:PointerEvent,id:number];'ruler-down':[event:PointerEvent,handle:'start'|'end'|'third'|'line'];move:[event:PointerEvent];up:[event:PointerEvent];cancel:[event:PointerEvent]}>()
const canSample=computed(()=>props.interactive&&(props.sampleInteractive??true))
const canRuler=computed(()=>props.interactive&&(props.rulerInteractive??true))
function sampleDown(event:PointerEvent,id:number){if(canSample.value)emit('sample-down',event,id)}
function rulerDown(event:PointerEvent,handle:'start'|'end'|'third'|'line'){if(canRuler.value)emit('ruler-down',event,handle)}
const label=(key:Parameters<typeof infoToolLabel>[1])=>infoToolLabel(locale.value,key)
const rulerHandles=computed(()=>{const ruler=props.rulerDraft??props.info.ruler;if(!ruler)return [];return (['start','end','third'] as const).flatMap(handle=>ruler[handle]?[{handle,point:ruler[handle] as InfoPoint}]:[])})
</script>
<template>
 <div class="info-tools-overlay" data-testid="info-tools-overlay" :class="{'sample-interactive':canSample,'ruler-interactive':canRuler}" @pointermove="$emit('move',$event)" @pointerup="$emit('up',$event)" @pointercancel="$emit('cancel',$event)">
  <svg :viewBox="`0 0 ${width} ${height}`" aria-hidden="true">
   <g v-if="rulerDraft??info.ruler" class="ruler-lines">
    <line v-for="end in [(rulerDraft??info.ruler)!.end,...((rulerDraft??info.ruler)!.third?[(rulerDraft??info.ruler)!.third!]:[])]" :key="end.join(',')" :x1="(rulerDraft??info.ruler)!.start[0]" :y1="(rulerDraft??info.ruler)!.start[1]" :x2="end[0]" :y2="end[1]" class="ruler-under" vector-effect="non-scaling-stroke"/>
    <line v-for="end in [(rulerDraft??info.ruler)!.end,...((rulerDraft??info.ruler)!.third?[(rulerDraft??info.ruler)!.third!]:[])]" :key="`top-${end.join(',')}`" :x1="(rulerDraft??info.ruler)!.start[0]" :y1="(rulerDraft??info.ruler)!.start[1]" :x2="end[0]" :y2="end[1]" vector-effect="non-scaling-stroke"/>
    <line class="ruler-hit" :x1="(rulerDraft??info.ruler)!.start[0]" :y1="(rulerDraft??info.ruler)!.start[1]" :x2="(rulerDraft??info.ruler)!.end[0]" :y2="(rulerDraft??info.ruler)!.end[1]" vector-effect="non-scaling-stroke" @pointerdown.stop="rulerDown($event,'line')"/>
   </g>
  </svg>
  <button v-for="sample in info.samples" :key="sample.id" class="sample-marker" :aria-label="`${label('Color samplers')} ${sample.id}`" :title="label('Delete sample with Alt-click; drag to move.')" :style="{left:`${sample.position[0]*zoom}px`,top:`${sample.position[1]*zoom}px`}" :data-sample-id="sample.id" :disabled="!canSample" @pointerdown.stop="sampleDown($event,sample.id)"><span class="cross">⊕</span><span class="number">{{sample.id}}</span></button>
  <template v-if="rulerDraft??info.ruler"><button v-for="{point,handle} in rulerHandles" :key="handle" class="ruler-handle" :aria-label="`${label('Ruler tool')} ${handle}`" :style="{left:`${point[0]*zoom}px`,top:`${point[1]*zoom}px`}" :data-ruler-handle="handle" :disabled="!canRuler" @pointerdown.stop="rulerDown($event,handle)"/></template>
 </div>
</template>
<style scoped>
.info-tools-overlay{position:absolute;inset:0;pointer-events:none;z-index:7;overflow:visible}.info-tools-overlay svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}.ruler-lines line{stroke:white;stroke-width:1;fill:none}.ruler-lines .ruler-under{stroke:#111;stroke-width:3}.ruler-lines .ruler-hit{stroke:transparent;stroke-width:14;pointer-events:none}.ruler-interactive .ruler-lines .ruler-hit{pointer-events:stroke;cursor:move}.sample-marker,.ruler-handle{position:absolute;transform:translate(-50%,-50%);padding:0;border:0;box-shadow:none;background:transparent;width:22px;height:22px;color:white;pointer-events:none;cursor:move}.sample-interactive .sample-marker,.ruler-interactive .ruler-handle{pointer-events:auto}.sample-marker .cross{font-size:22px;line-height:22px;text-shadow:0 0 2px #000,0 0 2px #000}.sample-marker .number{position:absolute;left:19px;top:-2px;font-size:11px;font-weight:700;color:white;background:#222;border:1px solid #ddd;border-radius:2px;padding:0 3px}.ruler-handle::after{content:'';position:absolute;inset:5px;border:1px solid white;background:#111;box-shadow:0 0 0 1px #111}.ruler-handle[data-ruler-handle=third]::after{border-radius:50%}.sample-marker:focus-visible,.ruler-handle:focus-visible{outline:2px solid #0a84ff}.sample-marker:disabled,.ruler-handle:disabled{opacity:1}
</style>
