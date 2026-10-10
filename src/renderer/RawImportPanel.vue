<script setup lang="ts">
import { useI18n } from './i18n'
const { t, tm } = useI18n()
import { ref, watch } from 'vue'
import type { RawImportSettings } from '../core/foreign-import'
const props = withDefaults(defineProps<{ open: boolean; filename: string; settings?: Partial<RawImportSettings>; busy?: boolean; metadata?: { width: number; height: number; camera_make?: string; camera_model?: string }; error?: string; preview?: string }>(), { settings: () => ({}), busy: false, error: '' })
const emit = defineEmits<{ import: [settings: RawImportSettings]; cancel: []; preview: [settings: RawImportSettings] }>()
const draft = ref<RawImportSettings>({ whiteBalance: 'camera', exposureEV: 0, autoBright: true, halfSize: false, highlightMode: 0 })
watch(() => [props.open, props.settings] as const, () => { if (props.open) draft.value = { whiteBalance: 'camera', exposureEV: 0, autoBright: true, halfSize: false, highlightMode: 0, ...props.settings } }, { immediate: true })
function submit() { if (!props.busy && Number.isFinite(draft.value.exposureEV) && draft.value.exposureEV >= -5 && draft.value.exposureEV <= 5) emit('import', { ...draft.value }) }
</script>
<template>
  <div v-if="open" class="raw-backdrop" @keydown.esc.prevent.stop="emit('cancel')">
    <form class="raw-import" role="dialog" aria-modal="true" aria-labelledby="raw-heading" @submit.prevent="submit">
      <header><h2 id="raw-heading">{{ t('Import RAW image') }}</h2><button type="button" :aria-label="t('Close RAW import')" @click="emit('cancel')">×</button></header>
      <p class="raw-name" :title="filename">{{ filename }}</p>
      <p v-if="metadata" class="raw-meta">{{ metadata.camera_make }} {{ metadata.camera_model }} · {{ metadata.width }} × {{ metadata.height }} px</p>
      <img v-if="preview" :src="preview" class="raw-preview" :alt="t('RAW development preview')" /><fieldset :disabled="busy">
        <label>{{ t('White balance') }}<select v-model="draft.whiteBalance" :aria-label="t('White balance')"><option value="camera">{{ t('Camera') }}</option><option value="auto">{{ t('Auto') }}</option></select></label>
        <label>{{ t('Exposure EV') }}<input v-model.number="draft.exposureEV" type="number" min="-5" max="5" step="0.1" required /></label>
        <label>{{ t('Highlights') }}<select v-model.number="draft.highlightMode" :aria-label="t('Highlights')"><option :value="0">{{ t('Clip') }}</option><option :value="1">{{ t('Unclip') }}</option><option :value="2">{{ t('Blend') }}</option></select></label>
        <label class="raw-check"><input v-model="draft.autoBright" type="checkbox" /> {{ t('Auto brightness') }}</label>
        <label class="raw-check"><input v-model="draft.halfSize" type="checkbox" /> {{ t('Decode at half resolution') }}</label>
      </fieldset>
      <p class="raw-note">{{ t('Camera orientation is applied. The result becomes an editable 8-bit sRGB image layer. RAW sensor data and development settings are not stored in the project.') }}</p>
      <p v-if="error" class="raw-error" role="alert">{{ tm(error) }}</p>
      <footer><button type="button" :disabled="busy" @click="emit('preview', { ...draft })">{{ t('Preview') }}</button><button type="button" @click="emit('cancel')">{{ t(busy ? 'Cancel import' : 'Cancel') }}</button><button type="submit" :disabled="busy" class="raw-primary">{{ t(busy ? 'Decoding…' : 'Import image') }}</button></footer>
    </form>
  </div>
</template>
<style scoped>
.raw-backdrop{position:fixed;inset:0;z-index:1100;background:#0009;display:grid;place-items:center}.raw-import{margin:0;width:360px;max-width:calc(100vw - 40px);max-height:calc(100vh - 40px);overflow:auto;color:#ddd;background:#292929;border:1px solid #484848;border-radius:12px;box-shadow:0 18px 60px #0008;padding:20px;font:13px system-ui}header,footer{display:flex;align-items:center;justify-content:space-between;gap:12px}h2{font-size:17px;margin:0}header button{font-size:22px;background:none;border:0;color:#bbb}.raw-preview{max-width:100%;max-height:220px;display:block;margin:12px auto;object-fit:contain}.raw-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#bbb}.raw-meta{color:#aaa;font-size:12px}fieldset{border:0;margin:20px 0;padding:0;display:grid;gap:12px}label{display:flex;align-items:center;justify-content:space-between;gap:16px}select,input[type=number]{width:150px;max-width:55%;height:34px;min-height:34px;line-height:18px;box-sizing:border-box;border:1px solid #4d4d4d;background:#1d1d1d;color:#ddd;border-radius:5px;padding:7px}.raw-check{justify-content:flex-start;gap:8px}.raw-note{font-size:12px;line-height:1.55;color:#aaa}.raw-error{color:#ffa8a8}footer{flex-wrap:wrap;justify-content:flex-end;margin-top:20px}footer button{border:1px solid #505050;border-radius:6px;background:#383838;color:#eee;padding:8px 13px}.raw-primary{background:#087ef8!important;border-color:#087ef8!important}button:disabled,fieldset:disabled{opacity:.5}button{cursor:pointer}input:focus-visible,select:focus-visible,button:focus-visible{outline:2px solid #339aff;outline-offset:2px}
</style>
