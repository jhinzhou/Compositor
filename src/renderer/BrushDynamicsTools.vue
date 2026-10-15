<script setup lang="ts">
import {computed} from 'vue'
import {useI18n} from './i18n'
import {BRUSH_PRESETS} from '../shared/brush-dynamics'
import CommitInput from './CommitInput.vue'
const {t}=useI18n()
const props=defineProps<{flow:number;spacing:number;showSpacing?:boolean;hardness:number;pressureSize:boolean;pressureOpacity:boolean}>()
const emit=defineEmits<{'update:flow':[value:number];'update:spacing':[value:number];'update:hardness':[value:number];'update:pressureSize':[value:boolean];'update:pressureOpacity':[value:boolean]}>()
const preset=computed(()=>(props.showSpacing===false||props.spacing===.25?BRUSH_PRESETS.find(item=>item.flow===props.flow&&item.hardness===props.hardness&&item.pressureSize===props.pressureSize&&item.pressureOpacity===props.pressureOpacity)?.id:undefined)??'custom')
function selectPreset(event:Event):void {
 const item=BRUSH_PRESETS.find(value=>value.id===(event.target as HTMLSelectElement).value)
 if(!item)return
 emit('update:hardness',item.hardness);emit('update:flow',item.flow);emit('update:spacing',.25);emit('update:pressureSize',item.pressureSize);emit('update:pressureOpacity',item.pressureOpacity)
}
</script>
<template>
 <label>{{t('Brush preset')}}<select :value="preset" :aria-label="t('Brush preset')" @change="selectPreset"><option value="custom" disabled>{{t('Custom')}}</option><option v-for="item in BRUSH_PRESETS" :key="item.id" :value="item.id">{{t(item.label)}}</option></select></label>
 <label>{{t('Flow')}}<CommitInput :label="t('Brush flow')" :value="Math.round(flow*100)" :min="0" :max="100" :step="1" @preview="emit('update:flow',Number($event)/100)" @commit="emit('update:flow',Number($event)/100)"/>%</label>
 <label v-if="showSpacing!==false">{{t('Spacing')}}<CommitInput :label="t('Brush spacing')" :value="Math.round(spacing*100)" :min="1" :max="1000" :step="1" @preview="emit('update:spacing',Number($event)/100)" @commit="emit('update:spacing',Number($event)/100)"/>%</label>
 <label :title="t('Pen pressure controls diameter; mouse strokes keep the chosen diameter.')"><input type="checkbox" :checked="pressureSize" :aria-label="t('Pressure size')" @change="emit('update:pressureSize',($event.target as HTMLInputElement).checked)">{{t('Pressure size')}}</label>
 <label :title="t('Pen pressure controls ink buildup; stroke opacity remains the ceiling.')"><input type="checkbox" :checked="pressureOpacity" :aria-label="t('Pressure opacity')" @change="emit('update:pressureOpacity',($event.target as HTMLInputElement).checked)">{{t('Pressure opacity')}}</label>
</template>
