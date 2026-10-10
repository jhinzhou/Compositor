<script setup lang="ts">
import { computed, ref } from 'vue'
import type { BatchMutation, Manifest } from '../shared/contracts'
import { duplicateSelectionActions, mergeSelectionPlan, selectedRoots, sharedTransformActions, type MergePlan } from '../core/layer-operations'

const props = defineProps<{ manifest: Manifest; selectedIds: string[]; disabled?: boolean; canPaste?: boolean }>()
const emit = defineEmits<{
  actions: [actions: BatchMutation['actions'], label: string]
  copy: [ids: string[]]
  cut: [ids: string[]]
  paste: []
  merge: [plan: MergePlan]
  error: [message: string]
}>()
const degrees = ref(15), scale = ref(100)
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
</script>

<template>
  <div class="layer-actions" aria-label="Layer actions">
    <div class="action-row">
      <button :disabled="disabled || !roots.length" title="Copy selected layers" @click="emit('copy', roots.map(layer => layer.id))">Copy</button>
      <button :disabled="disabled || !roots.length" title="Cut selected layers" @click="emit('cut', roots.map(layer => layer.id))">Cut</button>
      <button :disabled="disabled || !canPaste" title="Paste layers" @click="emit('paste')">Paste</button>
      <button :disabled="disabled || !roots.length" title="Duplicate selected layers" @click="duplicate">Duplicate</button>
    </div>
    <div class="action-row">
      <label>Rotate <input v-model.number="degrees" type="number" step="1" :disabled="disabled || !roots.length" aria-label="Shared rotation degrees">°</label>
      <button :disabled="disabled || !roots.length" @click="transform('rotate')">Apply</button>
    </div>
    <div class="action-row">
      <label>Scale <input v-model.number="scale" type="number" min="1" max="10000" step="1" :disabled="disabled || !roots.length" aria-label="Shared scale percent">%</label>
      <button :disabled="disabled || !roots.length" @click="transform('scale')">Apply</button>
    </div>
    <div class="action-row">
      <button :disabled="disabled || !roots.length" @click="transform('horizontal')">Flip H</button>
      <button :disabled="disabled || !roots.length" @click="transform('vertical')">Flip V</button>
      <button :disabled="disabled || roots.length < 2" @click="merge('selected')">Merge selected</button>
    </div>
    <div class="action-row">
      <button :disabled="disabled || roots.length !== 1" @click="merge('down')">Merge down</button>
      <button :disabled="disabled || roots.length !== 1 || !roots[0]?.isGroup" @click="merge('group')">Merge folder</button>
    </div>
  </div>
</template>

<style scoped>
.layer-actions { padding: 8px; color: inherit; font-size: 12px; }
.action-row { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; margin-bottom: 6px; }
button { padding: 4px 7px; border: 1px solid #464646; border-radius: 4px; background: #303030; color: inherit; font: inherit; cursor: pointer; }
button:disabled { opacity: .4; cursor: default; }
button:hover:not(:disabled) { background: #424242; }
label { display: inline-flex; align-items: center; gap: 6px; }
input { width: 58px; padding: 4px; color: inherit; background: #191919; border: 1px solid #464646; border-radius: 4px; font: inherit; }
</style>
