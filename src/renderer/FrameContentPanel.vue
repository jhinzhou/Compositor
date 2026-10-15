<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import {useI18n} from './i18n'
import type {FrameMetadata} from '../shared/frame'
const {t}=useI18n()
const props=defineProps<{frame:FrameMetadata;layerId:string;sources:{id:string;name:string}[];disabled?:boolean;mode:'frame'|'content'}>()
const emit=defineEmits<{place:[{sourceId:string;fit:'cover'|'contain'}];mode:['frame'|'content'];kind:[FrameMetadata['kind']]}>()
const sourceId=ref(''),fit=ref<'cover'|'contain'>('cover'),available=computed(()=>props.sources.filter(source=>source.id!==props.layerId))
const sourceAvailable=computed(()=>available.value.some(source=>source.id===sourceId.value))
watch(()=>props.layerId,()=>{sourceId.value=''},{flush:'sync'})
</script>
<template>
 <div class="frame-content-panel">
  <button :disabled="disabled" :class="{active:mode==='frame'}" @click="emit('mode','frame')">{{t('Frame boundary')}}</button><button :disabled="disabled" :class="{active:mode==='content'}" @click="emit('mode','content')">{{t('Frame content')}}</button>
  <select v-model="sourceId" :disabled="disabled" :title="t('The source layer is kept and hidden when its image is placed in the frame.')" :aria-label="t('Place image')"><option value="">{{t('Place image')}}</option><option v-for="source in available" :key="source.id" :value="source.id">{{source.name}}</option></select>
  <select v-model="fit" :disabled="disabled"><option value="cover">{{t('Cover frame')}}</option><option value="contain">{{t('Contain image')}}</option></select>
  <button :title="t('The source layer is retained and hidden after placing.')" :disabled="disabled||!sourceAvailable" @click="emit('place',{sourceId,fit})">{{t('Place image')}}</button>
 </div>
</template>
<style scoped>
.frame-content-panel{display:flex;flex-wrap:nowrap;gap:4px;align-items:center}.frame-content-panel button.active{outline:1px solid #58a6ff}
</style>
