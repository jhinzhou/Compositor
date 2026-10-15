<script setup lang="ts">
import {ref} from 'vue'
import {Eye,EyeOff,RotateCcw,ChevronDown,ChevronRight} from '@lucide/vue'
import {useI18n} from './i18n'
import FilterParameterFields from './FilterParameterFields.vue'
import {CAMERA_RAW_SECTIONS,CAMERA_RAW_SECTION_CHOICES,cameraRawScalarLimits,isCameraRawSectionDefault,type CameraRawSection,type CameraRawSettings} from '../shared/camera-raw-sections'
const {t}=useI18n()
const props=defineProps<{value:CameraRawSettings;hidden:readonly CameraRawSection[];disabled?:boolean}>()
const emit=defineEmits<{update:[value:CameraRawSettings];toggle:[section:CameraRawSection];reset:[section:CameraRawSection]}>()
const expanded=ref<CameraRawSection[]>(['light','color','effects'])
function label(key:string):string{return t(key.replace(/([A-Z])/g,' $1').replace(/^./,c=>c.toUpperCase()))}
function fold(section:CameraRawSection):void{expanded.value=expanded.value.includes(section)?expanded.value.filter(value=>value!==section):[...expanded.value,section]}
function set(key:keyof CameraRawSettings,value:unknown):void {if(!props.disabled)emit('update',{...props.value,[key]:value} as CameraRawSettings)}
</script>
<template>
  <div class="camera-raw-sections"><section v-for="section in CAMERA_RAW_SECTIONS" :key="section.id" :data-camera-section="section.id">
    <header class="camera-section-header"><button type="button" class="camera-section-title" :disabled="disabled" :aria-expanded="expanded.includes(section.id)" :aria-controls="`camera-section-${section.id}`" @click="fold(section.id)"><component :is="expanded.includes(section.id)?ChevronDown:ChevronRight" :size="13" aria-hidden="true"/>{{t(section.title)}}</button>
      <template v-if="!isCameraRawSectionDefault(value,section.id)"><button type="button" class="camera-section-action" :disabled="disabled" :data-camera-eye="section.id" :aria-pressed="!hidden.includes(section.id)" :aria-label="t(hidden.includes(section.id)?'Show {section} section':'Hide {section} section',{section:t(section.title)})" :title="t(hidden.includes(section.id)?'Show {section} section':'Hide {section} section',{section:t(section.title)})" @click="emit('toggle',section.id)"><component :is="hidden.includes(section.id)?EyeOff:Eye" :size="15" aria-hidden="true"/></button><button type="button" class="camera-section-action" :disabled="disabled" :data-camera-reset="section.id" :aria-label="t('Reset {section} section',{section:t(section.title)})" :title="t('Reset {section} section',{section:t(section.title)})" @click="emit('reset',section.id)"><RotateCcw :size="14" aria-hidden="true"/></button></template>
    </header>
    <fieldset v-show="expanded.includes(section.id)" :id="`camera-section-${section.id}`" :disabled="disabled" class="camera-section-fields" :aria-label="t(section.title)">
      <template v-for="key in section.fields" :key="key"><FilterParameterFields v-if="value[key] && typeof value[key]==='object'" :value="value[key] as Record<string,unknown>" :path="key" @update="set(key,$event)"/>
        <label v-else class="camera-section-row">{{label(key)}}<select v-if="CAMERA_RAW_SECTION_CHOICES[key]" :value="value[key]" @change="set(key,($event.target as HTMLSelectElement).value)"><option v-for="choice in CAMERA_RAW_SECTION_CHOICES[key]" :key="choice" :value="choice">{{t(choice)}}</option></select><input v-else :value="value[key]" type="number" v-bind="cameraRawScalarLimits(key)" @input="set(key,Number(($event.target as HTMLInputElement).value))"/></label>
      </template>
    </fieldset>
  </section><p v-if="hidden.length" class="camera-section-note">{{t('Hidden sections are excluded from preview and Apply; their settings are kept until this dialog closes.')}}</p></div>
</template>
<style scoped>
.camera-raw-sections{min-width:0}.camera-raw-sections section{border-bottom:1px solid #484848;margin-bottom:8px}.camera-section-header{display:flex;align-items:center;gap:3px;margin:0 0 6px;min-height:28px}.camera-section-title{display:flex;align-items:center;gap:5px;flex:1;min-width:0;text-align:left;font-weight:600}.camera-section-title,.camera-section-action{background:transparent;border:0;color:#ddd;padding:4px;border-radius:4px;cursor:pointer}.camera-section-action{width:26px;height:26px;display:flex;align-items:center;justify-content:center;flex:none}.camera-section-title:hover,.camera-section-action:hover{background:#3b3b3b}.camera-section-action[aria-pressed=false]{color:#999}.camera-raw-sections button:disabled{opacity:.45;cursor:default}.camera-section-fields{border:0;padding:0 0 3px;margin:0;min-width:0}.camera-section-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:9px 0;font-size:11px}.camera-section-row input,.camera-section-row select{height:26px;background:#202020;color:#ddd;border:1px solid #484848;border-radius:4px;padding:3px 5px;min-width:0;width:85px;text-align:right}.camera-section-row select{max-width:145px;width:145px;text-align:left}.camera-section-note{font-size:11px;color:#aaa;line-height:1.5}.camera-raw-sections :focus-visible{outline:2px solid #1688ff;outline-offset:2px}
</style>
