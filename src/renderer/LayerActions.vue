<script setup lang="ts">
import { useI18n } from './i18n'
const { t, tm } = useI18n()
import { computed, ref } from 'vue'
import type { BatchMutation, Manifest } from '../shared/contracts'
import { duplicateSelectionActions, mergeSelectionPlan, selectedRoots, sharedTransformActions, type MergePlan } from '../core/layer-operations'
import {alignLayers,distributeLayers,type Alignment} from '../core/layer-layout'

const props = defineProps<{ manifest: Manifest; selectedIds: string[]; disabled?: boolean; canPaste?: boolean }>()
const emit = defineEmits<{
  actions: [actions: BatchMutation['actions'], label: string]
  copy: [ids: string[]]
  cut: [ids: string[]]
  paste: []
  merge: [plan: MergePlan]
  composite: [command: 'merge-visible'|'stamp-visible'|'stamp-selected']
  error: [message: string]
}>()
const degrees = ref(15), scale = ref(100)
const alignmentTarget=ref<'selection'|'canvas'>('selection')
const roots = computed(() => selectedRoots(props.manifest, props.selectedIds))
function run(callback: () => void): void {
  try { callback() } catch (error) { emit('error', error instanceof Error ? error.message : String(error)) }
}
function transform(kind: 'rotate' | 'scale' | 'horizontal' | 'vertical'): void {
  run(() => {
    const operation = kind === 'rotate' ? { kind: 'rotate' as const, degrees: degrees.value }
      : kind === 'scale' ? { kind: 'scale' as const, factor: scale.value / 100 }
        : { kind: 'flip' as const, axis: kind }
    const actions = sharedTransformActions(props.manifest, props.selectedIds, operation)
    if (actions.length) emit('actions', actions, kind === 'rotate' ? 'Rotate selected layers' : kind === 'scale' ? 'Scale selected layers' : 'Flip selected layers')
  })
}
function duplicate(): void { run(() => emit('actions', duplicateSelectionActions(props.manifest, props.selectedIds), 'Duplicate selected layers')) }
function merge(kind: 'selected' | 'down' | 'group'): void { run(() => emit('merge', mergeSelectionPlan(props.manifest, props.selectedIds, kind))) }
function align(alignment:Alignment):void{run(()=>emit('actions',alignLayers(props.manifest,props.selectedIds,alignment,alignmentTarget.value),'Align layers'))}
function distribute(axis:'horizontal'|'vertical'):void{run(()=>emit('actions',distributeLayers(props.manifest,props.selectedIds,axis),'Distribute layers'))}
function setLock(lock:'all'|'position',locked:boolean){emit('actions',roots.value.map(layer=>({type:'layer.set_lock',layerId:layer.id,lock,locked})),'Set layer lock')}
</script>

<template>
  <div class="layer-actions" :aria-label="t('Layer actions')">
    <div class="action-row"><label><input type="checkbox" :checked="roots.length>0&&roots.every(layer=>layer.locked)" :disabled="disabled||!roots.length" @change="setLock('all',($event.target as HTMLInputElement).checked)"/>{{t('Lock all')}}</label><label><input type="checkbox" :checked="roots.length>0&&roots.every(layer=>layer.positionLocked)" :disabled="disabled||!roots.length" @change="setLock('position',($event.target as HTMLInputElement).checked)"/>{{t('Lock position')}}</label></div>
    <div class="action-row"><label>{{t('Align to')}}<select v-model="alignmentTarget"><option value="selection">{{t('Selected layers')}}</option><option value="canvas">{{t('Canvas')}}</option></select></label></div>
    <div class="action-row"><button v-for="alignment in (['left','center','right','top','middle','bottom'] as const)" :disabled="disabled||!roots.length" @click="align(alignment)">{{t(alignment)}}</button></div>
    <div class="action-row"><button :disabled="disabled||roots.length<3" @click="distribute('horizontal')">{{t('Distribute horizontally')}}</button><button :disabled="disabled||roots.length<3" @click="distribute('vertical')">{{t('Distribute vertically')}}</button></div>
    <div class="action-row">
      <button :disabled="disabled || !roots.length" :title="t('Copy selected layers')" @click="emit('copy', roots.map(layer => layer.id))">{{ t('Copy') }}</button>
      <button :disabled="disabled || !roots.length" :title="t('Cut selected layers')" @click="emit('cut', roots.map(layer => layer.id))">{{ t('Cut') }}</button>
      <button :disabled="disabled || !canPaste" :title="t('Paste layers')" @click="emit('paste')">{{ t('Paste') }}</button>
      <button :disabled="disabled || !roots.length" :title="t('Duplicate selected layers')" @click="duplicate">{{ t('Duplicate') }}</button>
    </div>
    <div class="action-row">
      <label>{{ t('Rotate') }} <input v-model.number="degrees" type="number" step="1" :disabled="disabled || !roots.length" :aria-label="t('Shared rotation degrees')">°</label>
      <button :disabled="disabled || !roots.length" @click="transform('rotate')">{{ t('Apply') }}</button>
    </div>
    <div class="action-row">
      <label>{{ t('Scale') }} <input v-model.number="scale" type="number" min="1" max="10000" step="1" :disabled="disabled || !roots.length" :aria-label="t('Shared scale percent')">%</label>
      <button :disabled="disabled || !roots.length" @click="transform('scale')">{{ t('Apply') }}</button>
    </div>
    <div class="action-row">
      <button :disabled="disabled || !roots.length" @click="transform('horizontal')">{{ t('Flip H') }}</button>
      <button :disabled="disabled || !roots.length" @click="transform('vertical')">{{ t('Flip V') }}</button>
      <button :disabled="disabled || roots.length < 2" @click="merge('selected')">{{ t('Merge selected') }}</button>
    </div>
    <div class="action-row">
      <button :disabled="disabled || roots.length !== 1" @click="merge('down')">{{ t('Merge down') }}</button>
      <button :disabled="disabled || roots.length !== 1 || !roots[0]?.isGroup" @click="merge('group')">{{ t('Merge folder') }}</button>
    </div>
    <div class="action-row"><button :disabled="disabled" @click="emit('composite','merge-visible')">{{t('Merge Visible')}}</button><button :disabled="disabled" @click="emit('composite','stamp-visible')">{{t('Stamp Visible')}}</button><button :disabled="disabled||!roots.length" @click="emit('composite','stamp-selected')">{{t('Stamp Selected')}}</button></div>
  </div>
</template>

<style scoped>
.layer-actions { padding: 8px; color: inherit; font-size: 12px; }
.action-row { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; margin-bottom: 6px; }
button { padding: 4px 7px; border: 1px solid #464646; border-radius: 4px; background: #303030; color: inherit; font: inherit; cursor: pointer; }
button:disabled { opacity: .4; cursor: default; }
button:hover:not(:disabled) { background: #424242; }
label { display: inline-flex; align-items: center; gap: 6px; }
input[type=checkbox]{width:auto} input { width: 58px; padding: 4px; color: inherit; background: #191919; border: 1px solid #464646; border-radius: 4px; font: inherit; }
</style>
