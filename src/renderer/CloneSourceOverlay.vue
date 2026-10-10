<script setup lang="ts">
defineProps<{ point: [number, number]; width: number; height: number; zoom: number }>()
</script>
<template>
  <svg class="clone-source-overlay" :viewBox="`0 0 ${width} ${height}`" aria-label="Clone sample position" data-testid="clone-source-marker" :data-source-x="point[0]" :data-source-y="point[1]">
    <g :transform="`translate(${point[0]} ${point[1]})`" fill="none" stroke-linecap="round">
      <path :d="`M${-7/zoom} 0H${7/zoom}M0 ${-7/zoom}V${7/zoom}`" stroke="white" stroke-width="3" vector-effect="non-scaling-stroke"/>
      <path :d="`M${-7/zoom} 0H${7/zoom}M0 ${-7/zoom}V${7/zoom}`" stroke="black" stroke-width="1" vector-effect="non-scaling-stroke"/>
    </g>
  </svg>
</template>
<style scoped>
.clone-source-overlay{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3;overflow:visible}
</style>
