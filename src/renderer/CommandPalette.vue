<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { searchCommands, shortcutFor, shortcutLabel } from './command-shortcuts'
import type { ShortcutOverrides, WorkspaceCommand } from './command-shortcuts'
const props = withDefaults(defineProps<{ open: boolean; commands: WorkspaceCommand[]; overrides?: ShortcutOverrides; platform?: 'mac' | 'other' }>(), { overrides: () => ({}), platform: 'other' })
const emit = defineEmits<{ execute: [id: string]; close: [] }>()
const query = ref(''), selected = ref(0), input = ref<HTMLInputElement>(), results = ref<HTMLElement>()
const matches = computed(() => searchCommands(props.commands, query.value))
watch(() => props.open, async open => { if (open) { query.value = ''; selected.value = 0; await nextTick(); input.value?.focus() } })
watch(query, () => { selected.value = 0 })
watch(matches, () => { selected.value = Math.min(selected.value, Math.max(0, matches.value.length - 1)) })
function execute(id?: string): void { const command = matches.value.find(item => item.id === id); if (command && command.enabled !== false) { emit('execute', command.id); emit('close') } }
async function keydown(event: KeyboardEvent): Promise<void> {
  if (event.key === 'Escape') { event.preventDefault(); emit('close') }
  else if (event.key === 'Enter') { event.preventDefault(); execute(matches.value[selected.value]?.id) }
  else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault(); const count = matches.value.length
    if (!count) return
    selected.value = (selected.value + (event.key === 'ArrowDown' ? 1 : -1) + count) % count
    await nextTick(); results.value?.querySelector<HTMLElement>(`[data-index="${selected.value}"]`)?.scrollIntoView({ block: 'nearest' })
  }
}
</script>
<template>
  <div v-if="open" class="command-palette-backdrop" @pointerdown.self="emit('close')" @keydown.stop="keydown">
    <section class="command-palette" role="dialog" aria-modal="true" aria-label="Search commands">
      <input ref="input" v-model="query" role="combobox" aria-label="Search commands" aria-autocomplete="list" aria-controls="command-results" :aria-activedescendant="matches[selected] ? `command-${selected}` : undefined" :aria-expanded="true" placeholder="Search commands…" />
      <div ref="results" id="command-results" class="command-results" role="listbox">
        <button v-for="(command, index) in matches" :id="`command-${index}`" :key="command.id" :data-index="index" role="option" :aria-selected="index === selected" :aria-disabled="command.enabled === false" :class="{ selected: index === selected, unavailable: command.enabled === false }" @pointermove="selected = index" @click="execute(command.id)">
          <span><small>{{ command.category }}</small><strong>{{ command.title }}</strong><em v-if="command.description">{{ command.description }}</em></span><kbd>{{ shortcutLabel(shortcutFor(command, overrides), platform) }}</kbd>
        </button>
        <p v-if="!matches.length">No matching commands.</p>
      </div>
      <footer>↑ ↓ Choose · Return Run · Esc Close</footer>
    </section>
  </div>
</template>
<style scoped>
.command-palette-backdrop{position:fixed;inset:0;background:#0006;display:flex;justify-content:center;align-items:flex-start;padding-top:min(18vh,140px);z-index:60}.command-palette{width:min(570px,90vw);background:#282828;border:1px solid #555;border-radius:10px;box-shadow:0 14px 50px #000a;color:#ddd;font:13px system-ui;overflow:hidden}.command-palette input{box-sizing:border-box;width:100%;font:16px system-ui;padding:17px 20px;border:0;border-bottom:1px solid #444;background:#222;color:#eee;outline:none}.command-results{max-height:380px;overflow:auto;padding:6px}.command-results button{width:100%;border:0;padding:11px 13px;background:transparent;color:inherit;display:flex;align-items:center;justify-content:space-between;text-align:left;border-radius:5px;cursor:pointer}.command-results button.selected{background:#075b9f}.command-results button.unavailable{opacity:.5;cursor:default}.command-results span{display:flex;flex-direction:column;gap:3px}.command-results small{font-size:10px;opacity:.7}.command-results strong{font-weight:500}.command-results em{font-style:normal;opacity:.7;font-size:11px}.command-results kbd{color:#aaa;font:12px system-ui;white-space:nowrap;margin-left:15px}.command-results p{padding:14px}.command-palette footer{padding:10px 17px;border-top:1px solid #444;font-size:11px;color:#999}
</style>
