<script setup lang="ts">
import {computed} from 'vue'
import {editorToolIcon} from './editor-tool-icons'
const props=withDefaults(defineProps<{tool:string;variant?:string;size?:number}>(),{size:18})
const icon=computed(()=>editorToolIcon(props.tool,props.variant))
</script>
<template>
 <svg v-if="icon" :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" :data-tool-icon="icon.key"><path v-for="(part,index) in icon.strokes" :key="index" :d="part.d" :stroke-dasharray="part.dash" :fill="part.fill??'none'"/></svg>
</template>
