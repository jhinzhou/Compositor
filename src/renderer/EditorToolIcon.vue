<script setup lang="ts">
import {Bandage, Crop, Droplet, Lasso, Paintbrush, Pipette, SquareDashed, Stamp, WandSparkles} from '@lucide/vue'
defineProps<{tool:string}>()
const icons:Record<string,unknown>={marquee:SquareDashed,lasso:Lasso,magic:WandSparkles,crop:Crop,brush:Paintbrush,heal:Bandage,clone:Stamp,smear:Droplet,eyedropper:Pipette}
</script>
<template>
 <svg v-if="tool==='gradient'" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" data-tool-icon="gradient"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 3v18M6 6h.01M9 7h.01M6 10h.01M9 12h.01M6 14h.01M9 17h.01M6 18h.01" stroke-linecap="round"/><path d="M15 4h5v16h-5z" fill="currentColor" stroke="none"/></svg>
 <svg v-else-if="tool==='shape'" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" data-tool-icon="shape"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M8 16H6a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1"/></svg>
 <svg v-else-if="tool==='text'" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" data-tool-icon="text"><path d="m2 20 6-16 6 16M4 14h8M22 12v8m0-5c-8-6-10 8-3 5l3-2" stroke-linecap="round" stroke-linejoin="round"/></svg>
 <component v-else :is="icons[tool]" :size="21" aria-hidden="true" :data-tool-icon="tool" />
</template>
