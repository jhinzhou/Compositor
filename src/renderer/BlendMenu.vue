<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { BLEND_MODES } from '../shared/contracts'
type Mode = typeof BLEND_MODES[number]
const props = defineProps<{ value: string; disabled: boolean }>()
const emit = defineEmits<{ commit: [mode: Mode]; preview: [mode: Mode | undefined] }>()
const root = ref<HTMLElement>(), open = ref(false), active = ref(0)
const separators = new Set([1, 5, 9, 16, 20])
function close(): void { open.value = false; emit('preview', undefined) }
async function toggle(): Promise<void> {
  if (open.value) { close(); return }
  active.value = Math.max(0, BLEND_MODES.indexOf(props.value as Mode)); open.value = true
  await nextTick(); root.value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
}
function hover(index: number): void { active.value = index; emit('preview', BLEND_MODES[index]) }
function choose(index: number): void { const value = BLEND_MODES[index]; close(); emit('commit', value) }
function keydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' || event.key === 'Tab') { close(); return }
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (open.value) choose(active.value); else void toggle(); return }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    if (!open.value) { void toggle(); return }
    hover((active.value + (event.key === 'ArrowDown' ? 1 : BLEND_MODES.length - 1)) % BLEND_MODES.length)
    void nextTick(() => root.value?.querySelector('.blend-option.active')?.scrollIntoView({ block: 'nearest' }))
  }
}
function outside(event: PointerEvent): void { if (!root.value?.contains(event.target as Node)) close() }
watch(() => [props.value, props.disabled], close)
onMounted(() => document.addEventListener('pointerdown', outside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
</script>

<template>
  <div ref="root" class="blend-menu" @keydown.stop="keydown">
    <button aria-label="Blend mode" role="combobox" aria-haspopup="listbox" :aria-expanded="open" :disabled="disabled" @click="toggle">{{ value }}<span>⌄</span></button>
    <div v-if="open" class="blend-options" role="listbox" aria-label="Blend modes" @mouseleave="emit('preview', undefined)">
      <button v-for="(mode, index) in BLEND_MODES" :key="mode" class="blend-option" :class="{ active: active === index, separator: separators.has(index) }" role="option" :aria-selected="value === mode" tabindex="-1" @mouseenter="hover(index)" @click="choose(index)">{{ mode }}<span v-if="value === mode">✓</span></button>
    </div>
  </div>
</template>

<style scoped>
.blend-menu{position:relative;flex:1;min-width:0}.blend-menu>button{width:100%;height:25px;border-radius:16px;background:#303030;justify-content:space-between;font-size:13px;padding:0 9px}.blend-menu>button span{color:#888}.blend-options{position:absolute;top:29px;right:0;width:190px;max-height:calc(100vh - 220px);overflow:auto;padding:5px;background:#333;border:1px solid #666;border-radius:6px;box-shadow:0 10px 25px #0008;z-index:7;scrollbar-width:thin}.blend-option{width:100%;justify-content:space-between;border-radius:3px;font-size:12px;padding:5px 9px}.blend-option.active{background:#0a64c7;color:#fff}.blend-option.separator{border-top:1px solid #555;margin-top:4px;padding-top:8px}
</style>
