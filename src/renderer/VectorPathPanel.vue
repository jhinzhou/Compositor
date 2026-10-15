<script setup lang="ts">
import {computed} from 'vue'
import {useI18n} from './i18n'
const {t}=useI18n()
import type {StoredVectorPath} from '../core/path-edit'
const props=defineProps<{paths:StoredVectorPath[];selectedId?:string;disabled?:boolean;hasLayer?:boolean}>()
const emit=defineEmits<{select:[string];create:[];delete:[string];selection:[string];fill:[string];mask:[string]}>()
const selected=computed(()=>props.paths.find(path=>path.id===props.selectedId))
</script>
<template>
 <section class="vector-path-panel">
  <div class="path-list"><button v-for="record in paths" :key="record.id" :class="{active:record.id===selectedId}" :disabled="disabled" @click="emit('select',record.id)">{{record.name}} <small>{{record.path.subpaths.reduce((sum,path)=>sum+path.knots.length,0)}} {{t('Anchors')}}</small></button></div>
  <div class="path-actions"><button :disabled="disabled" @click="emit('create')">{{t('New path')}}</button><button :disabled="disabled||!selected" @click="selected&&emit('delete',selected.id)">{{t('Delete path')}}</button><button :disabled="disabled||!selected" @click="selected&&emit('selection',selected.id)">{{t('Make selection')}}</button><button :disabled="disabled||!selected||!hasLayer" @click="selected&&emit('fill',selected.id)">{{t('Fill path')}}</button><button :disabled="disabled||!selected||!hasLayer" @click="selected&&emit('mask',selected.id)">{{t('Vector mask')}}</button></div>
 </section>
</template>
<style scoped>
.vector-path-panel{display:flex;align-items:center;gap:8px;padding:0}.path-list{display:flex;gap:4px;max-width:240px;overflow:auto;scrollbar-width:none}.path-list button{display:flex;justify-content:space-between}.path-list button.active{outline:1px solid #58a6ff}.path-actions{display:flex;flex-wrap:nowrap;gap:4px}
</style>
