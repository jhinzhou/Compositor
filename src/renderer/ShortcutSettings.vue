<script setup lang="ts">
import { useI18n } from './i18n'
import { computed, nextTick, ref, watch } from 'vue'
import { eventChord, searchCommands, shortcutFor, shortcutLabel, shortcutProblem } from './command-shortcuts'
import type { ShortcutOverrides, WorkspaceCommand } from './command-shortcuts'
import {profileCommands, type InteractionProfile} from './interaction-profile'
const { t, tm } = useI18n()
const props = withDefaults(defineProps<{ open: boolean; commands: WorkspaceCommand[]; defaultCommands?: WorkspaceCommand[]; overrides?: ShortcutOverrides; platform?: 'mac' | 'other'; profile?:InteractionProfile }>(), { overrides: () => ({}), platform: 'other',profile:'photoshop' })
const emit = defineEmits<{ save: [overrides: ShortcutOverrides]; close: []; profile:[profile:InteractionProfile] }>()
const draft = ref<ShortcutOverrides>({}), query = ref(''), recording = ref<string>(), search = ref<HTMLInputElement>()
// Parent commands already reflect saved overrides. Rebuild from raw defaults for
// this draft so Reset/Restore Defaults and newly displaced defaults stay accurate.
const effectiveCommands = computed(() => {
  const defaults = new Map(props.defaultCommands?.map(command => [command.id, command.shortcut]))
  return profileCommands(props.commands.map(command => defaults.has(command.id) ? {...command, shortcut:defaults.get(command.id)} : command), props.profile, draft.value, props.platform)
})
const matches = computed(() => searchCommands(effectiveCommands.value, query.value)), problem = computed(() => shortcutProblem(effectiveCommands.value, draft.value, props.platform))
watch(() => props.open, async open => { if (open) { draft.value = { ...props.overrides }; query.value = ''; recording.value = undefined; await nextTick(); search.value?.focus() } else recording.value = undefined }, {immediate:true})
function record(event: KeyboardEvent, command: WorkspaceCommand): void {
  if (recording.value !== command.id) return
  event.preventDefault(); event.stopPropagation()
  if (event.key === 'Escape' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) { recording.value = undefined; return }
  const chord = eventChord(event, props.platform)
  if (chord) { draft.value[command.id] = chord; recording.value = undefined }
}
function clear(command: WorkspaceCommand): void { draft.value[command.id] = ''; recording.value = undefined }
function reset(command: WorkspaceCommand): void { delete draft.value[command.id]; recording.value = undefined }
function restoreDefaults(): void { draft.value = {}; recording.value = undefined }
function dialogKeydown(event: KeyboardEvent): void {
  event.stopPropagation()
  if (event.key === 'Escape' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) { if (recording.value) recording.value = undefined; else emit('close') }
}
function save(): void { if (!problem.value && !recording.value) { emit('save', { ...draft.value }); emit('close') } }
</script>
<template>
  <div v-if="open" class="shortcut-backdrop" @pointerdown.self="emit('close')">
    <section class="shortcut-dialog" @keydown="dialogKeydown" role="dialog" aria-modal="true" :aria-label="t('Keyboard shortcuts')">
      <h2>{{ t('Keyboard shortcuts') }}</h2><p>{{ t('Click a shortcut and press keys. Clear removes it. Esc cancels recording.') }}</p>
      <div class="profile-buttons" :aria-label="t('Interaction profile')"><button v-for="profile in (['photoshop','compositor'] as const)" :aria-pressed="props.profile===profile" @click="emit('profile',profile)">{{t(profile==='photoshop'?'Photoshop':'Compositor')}}</button></div><p>{{t('The profile changes default shortcuts and mask selection behavior. Custom shortcuts are kept.')}}</p>
      <input ref="search" v-model="query" :aria-label="t('Search shortcuts')" :placeholder="t('Search commands…')" />
      <div class="shortcut-list"><div v-for="command in matches" :key="command.id" class="shortcut-row"><span><small>{{ command.category }}</small>{{ command.title }}</span><button :aria-label="t('Shortcut for {name}',{name:command.title})" :class="{ recording: recording === command.id }" @click="recording = command.id" @keydown="record($event, command)">{{ recording === command.id ? t('Press keys…') : shortcutLabel(shortcutFor(command, draft, platform), platform) }}</button><button :aria-label="t('Clear {name} shortcut',{name:command.title})" :disabled="!shortcutFor(command, draft, platform)" @click="clear(command)">{{ t('Clear') }}</button><button :aria-label="t('Reset {name} shortcut',{name:command.title})" @click="reset(command)">{{ t('Reset') }}</button></div></div>
      <p v-if="problem" class="shortcut-error" role="alert">{{ tm(problem) }}</p>
      <footer><button @click="restoreDefaults">{{ t('Restore Defaults') }}</button><span /><button @click="emit('close')">{{ t('Cancel') }}</button><button :disabled="!!problem || !!recording" @click="save">{{ t('Save') }}</button></footer>
    </section>
  </div>
</template>
<style scoped>
.profile-buttons{display:flex;gap:10px}.profile-buttons button[aria-pressed=true]{font-weight:700;color:#fff;background:#145589;border-color:#2689e2}.shortcut-backdrop{position:fixed;inset:0;background:#0006;display:grid;place-items:center;z-index:65}.shortcut-dialog{width:min(620px,90vw);max-height:85vh;background:#292929;border:1px solid #555;border-radius:10px;padding:23px;color:#ddd;box-shadow:0 14px 50px #000a;font:13px system-ui;display:flex;flex-direction:column;gap:12px}.shortcut-dialog h2{font-size:20px;margin:0}.shortcut-dialog p{margin:0;color:#aaa;font-size:12px}.shortcut-dialog input{height:40px;min-height:40px;line-height:18px;padding:10px;flex-shrink:0}.shortcut-dialog input,.shortcut-dialog button{border:1px solid #555;border-radius:5px;background:#202020;color:#ddd}.shortcut-dialog button{padding:6px 10px;cursor:pointer}.shortcut-list{overflow:auto;max-height:420px}.shortcut-row{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #393939}.shortcut-row span{flex:1;display:flex;flex-direction:column;gap:3px}.shortcut-row small{font-size:10px;color:#999}.shortcut-row button.recording{border-color:#0085ff;color:#0085ff}.shortcut-dialog .shortcut-error{color:#ffb861}.shortcut-dialog footer{display:flex;gap:10px;margin-top:7px}.shortcut-dialog footer span{flex:1}.shortcut-dialog button:disabled{opacity:.4;cursor:default}
</style>
