<script setup lang="ts">
import { useI18n } from './i18n'
const { t, tm } = useI18n()
import {computed,ref,watch} from 'vue'
import type {ObjectBounds} from '../core/subject-segmentation'
import type {SubjectMatteSettings} from '../shared/subject-matte'

const props=defineProps<{width:number;height:number;box?:ObjectBounds;disabled?:boolean;busy?:boolean;progress?:{phase:string;received?:number;total?:number};error?:string;preview?:string;previewBusy?:boolean;pending?:boolean;hasRaster?:boolean}>()
const emit=defineEmits<{select:[request:{kind:'subject'|'object'|'remove-background';box?:ObjectBounds;settings:Required<SubjectMatteSettings>}];preview:[request:{kind:'remove-background';settings:Required<SubjectMatteSettings>}];apply:[];fill:[];drawbox:[];cancel:[];error:[message:string]}>()
const x=ref(props.box?.[0]??0),y=ref(props.box?.[1]??0),width=ref(props.box?.[2]??props.width),height=ref(props.box?.[3]??props.height)
const quality=ref<'basic'|'advanced'>('basic'),refineEdges=ref(12),matteContrast=ref(25),shiftEdge=ref(0),edgeMode=ref<'native'|'color'>('color'),feather=ref(0)
watch(()=>[props.width,props.height],()=>{x.value=y.value=0;width.value=props.width;height.value=props.height})
watch(()=>props.box,box=>{if(box){x.value=box[0];y.value=box[1];width.value=box[2];height.value=box[3]}})
function currentSettings():Required<SubjectMatteSettings>{return {quality:quality.value,refineEdges:refineEdges.value,matteContrast:matteContrast.value,shiftEdge:shiftEdge.value,edgeMode:edgeMode.value,feather:feather.value}}
watch([quality,refineEdges,matteContrast,shiftEdge,edgeMode,feather],()=>{if(props.pending)emit('preview',{kind:'remove-background',settings:currentSettings()})})
function fineEdges():void{quality.value='advanced';edgeMode.value='color';refineEdges.value=4;matteContrast.value=0;shiftEdge.value=0;feather.value=0}
const percentage=computed(()=>props.progress?.total?Math.min(100,Math.round((props.progress.received??0)/props.progress.total*100)):undefined)
function select(kind:'subject'|'object'|'remove-background'):void {
 if(props.disabled||props.busy)return
 const settings=currentSettings()
 if(!Number.isFinite(refineEdges.value)||refineEdges.value<0||refineEdges.value>40||!Number.isFinite(matteContrast.value)||matteContrast.value<0||matteContrast.value>100||!Number.isFinite(shiftEdge.value)||Math.abs(shiftEdge.value)>10){emit('error','Choose valid Refine (0–40), Contrast (0–100) and Shift Edge (−10–10) values.');return}
 if(!Number.isFinite(feather.value)||feather.value<0||feather.value>20){emit('error','Choose a feather amount from 0 to 20 pixels.');return}
 if(kind==='remove-background'){emit('preview',{kind,settings});return}
 if(kind!=='object'){emit('select',{kind,settings});return}
 const box:ObjectBounds=[x.value,y.value,width.value,height.value]
 if(box.some(value=>!Number.isFinite(value))||width.value<=0||height.value<=0){emit('error','Choose a nonempty object selection box.');return}
 emit('select',{kind,box,settings})
}
</script>

<template>
 <section class="object-selection-tools" :aria-label="t('Subject and object selection')">
  <p>{{ t('Choose a box on the canvas to select an object. Advanced quality refines the mask against the image’s detail.') }}</p>
  <fieldset :disabled="disabled||busy">
   <div class="row"><button @click="select('subject')">{{ t('Select Subject') }}</button><button :disabled="hasRaster===false" @click="select('remove-background')">{{ t('Remove Background') }}</button></div>
   <div class="row"><label>X<input v-model.number="x" type="number" min="0" :max="props.width-1"></label><label>Y<input v-model.number="y" type="number" min="0" :max="props.height-1"></label></div>
   <div class="row"><label>{{ t('Width') }}<input v-model.number="width" type="number" min="1" :max="props.width"></label><label>{{ t('Height') }}<input v-model.number="height" type="number" min="1" :max="props.height"></label></div>
   <div class="row"><button @click="emit('drawbox')">{{ t('Draw Object Box on Canvas') }}</button></div>
   <div class="row"><button @click="select('object')">{{ t('Select Object in Box') }}</button><button :disabled="hasRaster===false" @click="emit('fill')">{{ t('Content-Aware Fill') }}</button></div>
   <div class="row"><label>{{ t('Quality') }}<select v-model="quality" :aria-label="t('Matte Quality')"><option value="basic">{{ t('Basic') }}</option><option value="advanced">{{ t('Advanced') }}</option></select></label></div>
   <div class="row"><button @click="fineEdges">{{ t('Preserve fine edges') }}</button></div>
   <template v-if="quality==='advanced'">
    <div class="row"><label>{{ t('Edge guide') }}<select v-model="edgeMode" :aria-label="t('Matte edge guide')"><option value="color">{{ t('Color detail') }}</option><option value="native">{{ t('Original luminance') }}</option></select></label></div>
    <p v-if="edgeMode==='color'">{{ t('Color refinement preserves contrasting fine edges. It cannot recover hair absent from the initial mask.') }}</p>
    <label class="matte-control">{{ t('Refine') }}<input v-model.number="refineEdges" :aria-label="t('Matte Refine')" type="range" min="0" max="40" step="1"><input v-model.number="refineEdges" :aria-label="t('Matte Refine value')" type="number" min="0" max="40" step="1"><span>px</span></label>
    <label class="matte-control">{{ t('Contrast') }}<input v-model.number="matteContrast" :aria-label="t('Matte Contrast')" type="range" min="0" max="100" step="1"><input v-model.number="matteContrast" :aria-label="t('Matte Contrast value')" type="number" min="0" max="100" step="1"><span>%</span></label>
    <label class="matte-control">{{ t('Shift Edge') }}<input v-model.number="shiftEdge" :aria-label="t('Matte Shift Edge')" type="range" min="-10" max="10" step="1"><input v-model.number="shiftEdge" :aria-label="t('Matte Shift Edge value')" type="number" min="-10" max="10" step="1"><span>px</span></label>
    <label class="matte-control">{{ t('Feather') }}<input v-model.number="feather" :aria-label="t('Matte feather')" type="range" min="0" max="20" step="0.1"><input v-model.number="feather" :aria-label="t('Matte feather value')" type="number" min="0" max="20" step="0.1"><span>px</span></label>
   </template>
  </fieldset>
  <img v-if="preview" :src="preview" :alt="t('Background removal preview')" class="subject-preview"><p v-if="previewBusy" role="status">{{ t('Updating background preview…') }}</p><div v-if="pending" class="row"><button :disabled="previewBusy" @click="emit('apply')">{{ t('Apply background removal') }}</button><button @click="emit('cancel')">{{ t('Cancel preview') }}</button></div><p v-if="progress" role="status">{{tm(progress.phase)}}<span v-if="percentage!==undefined"> · {{percentage}}%</span></p>
  <p v-if="error" role="alert">{{tm(error)}}</p>
  <button v-if="busy" @click="emit('cancel')">{{ t('Cancel') }}</button>
 </section>
</template>

<style scoped>
.object-selection-tools{padding:10px;font-size:12px;color:inherit}
fieldset{border:0;margin:0;padding:0;min-width:0}
p{color:#aaa;line-height:1.5}
.row{display:flex;gap:6px;margin:8px 0}
label{display:flex;align-items:center;gap:5px;min-width:0;flex:1}
input,button,select{font:inherit;color:inherit;background:#202020;border:1px solid #474747;border-radius:4px;padding:5px;min-width:0}
input,select{height:32px;min-height:32px;line-height:18px}input{width:60px}button{cursor:pointer}button:disabled{opacity:.4}
.matte-control{margin:8px 0;display:grid;grid-template-columns:55px minmax(30px,1fr) 48px 18px}
.matte-control input{width:100%;box-sizing:border-box}.matte-control input[type=range]{padding:0;accent-color:#0a84ff}
</style>
