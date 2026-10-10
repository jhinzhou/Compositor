<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { eventChord, searchCommands, shortcutFor, shortcutLabel, shortcutProblem } from './command-shortcuts'
import type { ShortcutOverrides, WorkspaceCommand } from './command-shortcuts'
const props = withDefaults(defineProps<{ open: boolean; commands: WorkspaceCommand[]; overrides?: ShortcutOverrides; platform?: 'mac' | 'other' }>(), { overrides: () => ({}), platform: 'other' })
const emit = defineEmits<{ save: [overrides: ShortcutOverrides]; close: [] }>()
const draft = ref<ShortcutOverrides>({}), query = ref(''), recording = ref<string>(), search = ref<HTMLInputElement>()
const matches = computed(() => searchCommands(props.commands, query.value)), problem = computed(() => shortcutProblem(props.commands, draft.value))
watch(() => props.open, async open => { if (open) { draft.value = { ...props.overrides }; query.value = ''; recording.value = undefined; await nextTick(); search.value?.focus() } })
function record(event: KeyboardEvent, command: WorkspaceCommand): void {
  if (recording.value !== command.id) return
  event.preventDefault(); event.stopPropagation()
  if (event.key === 'Escape') { recording.value = undefined; return }
  if (event.key === 'Backspace' || event.key === 'Delete') { draft.value[command.id] = ''; recording.value = undefined; return }
  const chord = eventChord(event, props.platform)
  if (chord) { draft.value[command.id] = chord; recording.value = undefined }
}
function save(): void { if (!problem.value && !recording.value) { emit('save', { ...draft.value }); emit('close') } }
</script>
<template>
  <div v-if="open" class="shortcut-backdrop" @pointerdown.self="emit('close')" @keydown.esc.stop="recording ? recording = undefined : emit('close')">
    <section class="shortcut-dialog" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <h2>Keyboard shortcuts</h2><p>Click a shortcut and press keys. Delete clears it. Esc cancels recording.</p>
      <input ref="search" v-model="query" aria-label="Search shortcuts" placeholder="Search commands…" />
      <div class="shortcut-list"><div v-for="command in matches" :key="command.id" class="shortcut-row"><span><small>{{ command.category }}</small>{{ command.title }}</span><button :aria-label="`Shortcut for ${command.title}`" :class="{ recording: recording === command.id }" @click="recording = command.id" @keydown="record($event, command)">{{ recording === command.id ? 'Press keys…' : shortcutLabel(shortcutFor(command, draft), platform) }}</button><button :aria-label="`Reset ${command.title} shortcut`" @click="delete draft[command.id]">Reset</button></div></div>
      <p v-if="problem" class="shortcut-error" role="alert">{{ problem }}</p>
      <footer><button @click="draft = {}; recording = undefined">Restore Defaults</button><span /><button @click="emit('close')">Cancel</button><button :disabled="!!problem || !!recording" @click="save">Save</button></footer>
    </section>
  </div>
</template>
<style scoped>
.shortcut-backdrop{position:fixed;inset:0;background:#0006;display:grid;place-items:center;z-index:65}.shortcut-dialog{width:min(620px,90vw);max-height:85vh;background:#292929;border:1px solid #555;border-radius:10px;padding:23px;color:#ddd;box-shadow:0 14px 50px #000a;font:13px system-ui;display:flex;flex-direction:column;gap:12px}.shortcut-dialog h2{font-size:20px;margin:0}.shortcut-dialog p{margin:0;color:#aaa;font-size:12px}.shortcut-dialog input{padding:10px}.shortcut-dialog input,.shortcut-dialog button{border:1px solid #555;border-radius:5px;background:#202020;color:#ddd}.shortcut-dialog button{padding:6px 10px;cursor:pointer}.shortcut-list{overflow:auto;max-height:420px}.shortcut-row{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #393939}.shortcut-row span{flex:1;display:flex;flex-direction:column;gap:3px}.shortcut-row small{font-size:10px;color:#999}.shortcut-row button.recording{border-color:#0085ff;color:#0085ff}.shortcut-dialog .shortcut-error{color:#ffb861}.shortcut-dialog footer{display:flex;gap:10px;margin-top:7px}.shortcut-dialog footer span{flex:1}.shortcut-dialog button:disabled{opacity:.4;cursor:default}
</style>
