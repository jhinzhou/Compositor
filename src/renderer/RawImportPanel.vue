<script setup lang="ts">
import { useI18n } from './i18n'
const { t, tm } = useI18n()
import { computed,ref, watch } from 'vue'
import { normalizeRawSettings, type RawImportSettings } from '../shared/raw-settings'
const props = withDefaults(defineProps<{ open: boolean; filename: string; settings?: Partial<RawImportSettings>; busy?: boolean; cancelable?: boolean; metadata?: { width: number; height: number; camera_make?: string; camera_model?: string }; error?: string; preview?: string }>(), { settings: () => ({}), busy: false, cancelable: true, error: '' })
const emit = defineEmits<{ import: [settings: RawImportSettings]; cameraRaw: [settings: RawImportSettings]; cancel: []; preview: [settings: RawImportSettings] }>()
const draft = ref<RawImportSettings>({ whiteBalance: 'camera', exposureEV: 0, autoBright: true, halfSize: false, highlightMode: 0, noiseReductionThreshold:0 })
watch(() => [props.open, props.settings] as const, () => { if (props.open) draft.value = { whiteBalance: 'camera', exposureEV: 0, autoBright: true, halfSize: false, highlightMode: 0, noiseReductionThreshold:0, ...props.settings } }, { immediate: true })
const valid=computed(()=>{try{normalizeRawSettings(draft.value);return true}catch{return false}})
function submit() { if (!props.busy&&valid.value) emit('import',normalizeRawSettings(draft.value)) }
function previewDraft(){if(!props.busy&&valid.value)emit('preview',normalizeRawSettings(draft.value))}
function cancel(){if(props.cancelable)emit('cancel')}
function openCameraRaw(){if(!props.busy&&valid.value)emit('cameraRaw',normalizeRawSettings(draft.value))}
</script>
<template>
  <div v-if="open" class="raw-backdrop" @keydown.esc.prevent.stop="cancel">
    <form class="raw-import" role="dialog" aria-modal="true" aria-labelledby="raw-heading" @submit.prevent="submit">
      <header><h2 id="raw-heading">{{ t('Import RAW image') }}</h2><button type="button" :aria-label="t('Close RAW import')" :disabled="!cancelable" @click="cancel">×</button></header>
      <p class="raw-name" :title="filename">{{ filename }}</p>
      <p v-if="metadata" class="raw-meta">{{ metadata.camera_make }} {{ metadata.camera_model }} · {{ metadata.width }} × {{ metadata.height }} px</p>
      <img v-if="preview" :src="preview" class="raw-preview" :alt="t('RAW development preview')" /><fieldset :disabled="busy">
        <label>{{ t('White balance') }}<select v-model="draft.whiteBalance" :aria-label="t('White balance')"><option value="camera">{{ t('Camera') }}</option><option value="auto">{{ t('Auto') }}</option></select></label>
        <label>{{ t('Exposure EV') }}<input v-model.number="draft.exposureEV" type="number" min="-5" max="5" step="0.1" required /></label>
        <label>{{ t('Highlights') }}<select v-model.number="draft.highlightMode" :aria-label="t('Highlights')"><option :value="0">{{ t('Clip') }}</option><option :value="1">{{ t('Unclip') }}</option><option :value="2">{{ t('Blend') }}</option><option v-for="mode in [3,4,5,6,7,8,9]" :key="mode" :value="mode">{{ t('Rebuild mode {mode}',{mode}) }}</option></select></label>
        <label>{{ t('Wavelet noise reduction') }}<input v-model.number="draft.noiseReductionThreshold" :aria-label="t('Wavelet noise reduction')" type="number" min="0" max="1000" step="1" required /></label>
        <p class="raw-note">{{ t('RAW wavelet threshold (0–1000); 0 disables noise reduction. Rebuild modes 3–9 use LibRaw highlight recovery.') }}</p>
        <label class="raw-check"><input v-model="draft.autoBright" type="checkbox" /> {{ t('Auto brightness') }}</label>
        <label class="raw-check"><input v-model="draft.halfSize" type="checkbox" /> {{ t('Decode at half resolution') }}</label>
      </fieldset>
      <p class="raw-note">{{ t('Camera orientation is applied. The result becomes an editable 8-bit sRGB image layer. RAW sensor data and development settings are not stored in the project.') }}</p>
      <p v-if="error" class="raw-error" role="alert">{{ tm(error) }}</p>
      <footer><button type="button" :disabled="busy||!valid" @click="previewDraft">{{ t('Preview') }}</button><button type="button" :disabled="!cancelable" @click="cancel">{{ t(busy ? 'Cancel import' : 'Cancel') }}</button><button type="button" :disabled="busy||!valid" :title="t('Import, then open the Camera Raw Filter')" @click="openCameraRaw">{{ t('Camera Raw…') }}</button><button type="submit" :disabled="busy||!valid" class="raw-primary">{{ t(busy ? 'Decoding…' : 'Import image') }}</button></footer>
    </form>
  </div>
</template>
<style scoped>
.raw-backdrop{position:fixed;inset:0;z-index:1100;background:#0009;display:grid;place-items:center}.raw-import{margin:0;width:360px;max-width:calc(100vw - 40px);max-height:calc(100vh - 40px);overflow:auto;color:#ddd;background:#292929;border:1px solid #484848;border-radius:12px;box-shadow:0 18px 60px #0008;padding:20px;font:13px system-ui}header,footer{display:flex;align-items:center;justify-content:space-between;gap:12px}h2{font-size:17px;margin:0}header button{font-size:22px;background:none;border:0;color:#bbb}.raw-preview{max-width:100%;max-height:220px;display:block;margin:12px auto;object-fit:contain}.raw-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#bbb}.raw-meta{color:#aaa;font-size:12px}fieldset{border:0;margin:20px 0;padding:0;display:grid;gap:12px}label{display:flex;align-items:center;justify-content:space-between;gap:16px}select,input[type=number]{width:150px;max-width:55%;height:34px;min-height:34px;line-height:18px;box-sizing:border-box;border:1px solid #4d4d4d;background:#1d1d1d;color:#ddd;border-radius:5px;padding:7px}.raw-check{justify-content:flex-start;gap:8px}.raw-note{font-size:12px;line-height:1.55;color:#aaa}.raw-error{color:#ffa8a8}footer{flex-wrap:wrap;justify-content:flex-end;margin-top:20px}footer button{border:1px solid #505050;border-radius:6px;background:#383838;color:#eee;padding:8px 13px}.raw-primary{background:#087ef8!important;border-color:#087ef8!important}button:disabled,fieldset:disabled{opacity:.5}button{cursor:pointer}input:focus-visible,select:focus-visible,button:focus-visible{outline:2px solid #339aff;outline-offset:2px}
</style>
