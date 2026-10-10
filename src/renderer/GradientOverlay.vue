<script setup lang="ts">
defineProps<{start:[number,number];end:[number,number];zoom:number;radial:boolean}>()
defineEmits<{down:[event:PointerEvent,endpoint:'start'|'end'];move:[event:PointerEvent];up:[];cancel:[]}>()
</script>
<template>
  <div class="gradient-overlay" data-testid="gradient-overlay">
    <svg aria-hidden="true">
      <circle v-if="radial" :cx="start[0]*zoom" :cy="start[1]*zoom" :r="Math.hypot(end[0]-start[0],end[1]-start[1])*zoom" class="radius"/>
      <line :x1="start[0]*zoom" :y1="start[1]*zoom" :x2="end[0]*zoom" :y2="end[1]*zoom" class="under"/>
      <line :x1="start[0]*zoom" :y1="start[1]*zoom" :x2="end[0]*zoom" :y2="end[1]*zoom"/>
    </svg>
    <button v-for="(point,name) in {start,end}" :key="name" :class="['endpoint',name]" :aria-label="`Gradient ${name} handle`" :style="{left:`${point[0]*zoom}px`,top:`${point[1]*zoom}px`}" @pointerdown.stop="$emit('down',$event,name)" @pointermove.stop="$emit('move',$event)" @pointerup.stop="$emit('up')" @pointercancel.stop="$emit('cancel')"/>
  </div>
</template>
<style scoped>
.gradient-overlay{position:absolute;inset:0;z-index:6;pointer-events:none}.gradient-overlay svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}.gradient-overlay line,.radius{fill:none;stroke:white;stroke-width:1}.gradient-overlay .under{stroke:#111;stroke-width:3}.radius{stroke-dasharray:4 4;filter:drop-shadow(0 0 1px black)}.gradient-overlay .endpoint,.gradient-overlay .endpoint:hover{position:absolute;transform:translate(-50%,-50%);width:20px;height:20px;padding:0;background:transparent;border:0;box-shadow:none;pointer-events:auto;cursor:move}.endpoint::after{content:'';position:absolute;inset:4px;border-radius:50%;border:2px solid white;background:#111;box-shadow:0 0 0 1px #111}.endpoint.end::after{background:#ddd}.endpoint:focus-visible{outline:2px solid #0a84ff;border-radius:50%}
</style>
