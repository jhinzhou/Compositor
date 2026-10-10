<script setup lang="ts">
import { useI18n } from './i18n'
const { t, tm } = useI18n()
import FontPicker from './FontPicker.vue'
import { computed, ref, watch, toRaw } from 'vue'
import {LIMITS,type Layer,type Transform} from '../shared/contracts'
import { defaultShapeStyle, defaultTextStyle, defaultEditorTextStyle, renderShapePNG, renderTextPNG, replaceTextCharacters, setTextColor, setTextFont, validateShapeStyle, validateTextStyle, textFontWarnings, type TextStyle, type ShapeStyle, type ContentRaster } from './content-raster'

const props = defineProps<{ layer?: Layer; disabled?: boolean; mode?: 'text' | 'shape'; draft?:{text?:TextStyle;shape?:ShapeStyle;size:[number,number]};selectionRange?:[number,number];onCanvas?:boolean;fonts?:string[];compact?:boolean }>()
export interface ContentEdit { name: string; raster: ContentRaster; layerId?: string;origin?:[number,number];transform?:Transform;request?:{sessionId:string;documentId:string;expectedRevision:number;idempotencyKey:string} }
const emit = defineEmits<{ create: [edit: ContentEdit]; update: [edit: ContentEdit]; error: [message: string];draft:[style:{text?:TextStyle;shape?:ShapeStyle;size:[number,number]}];applyCanvas:[] }>()
const mode = ref<'text' | 'shape'>(props.mode ?? 'text'), text = ref(defaultEditorTextStyle()), shape = ref(defaultShapeStyle())
const width = ref(360), height = ref(160), fixedBox = ref(true), busy = ref(false), selection = ref<[number, number]>([0, 0])
const textArea = ref<HTMLTextAreaElement>(), name = ref('Text')
const isExisting = computed(() => mode.value === 'text' ? !!props.layer?.text : !!props.layer?.shape)
const color = computed({
  get: () => { const style = mode.value === 'text' ? text.value : shape.value; return `#${[style.red, style.green, style.blue].map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('')}` },
  set: value => {
    const rgb: [number, number, number] = [parseInt(value.slice(1, 3), 16) / 255, parseInt(value.slice(3, 5), 16) / 255, parseInt(value.slice(5, 7), 16) / 255]
    if (mode.value === 'text') text.value = setTextColor(text.value, selection.value[0], selection.value[1], rgb)
    else [shape.value.red, shape.value.green, shape.value.blue] = rgb
  }
})
watch(() => props.mode, value => { if (value) mode.value = value })
watch(() => props.layer, layer => {
  if(props.onCanvas)return
  try {
    if (layer?.text && (!props.mode||props.mode==='text')) {
      mode.value = 'text'; text.value = validateTextStyle(layer.text); fixedBox.value = !!text.value.boxSize
      width.value = text.value.boxSize?.[0] ?? layer.transform.size[0]; height.value = text.value.boxSize?.[1] ?? layer.transform.size[1]
      name.value = layer.name
    } else if (layer?.shape && (!props.mode||props.mode==='shape')) {
      mode.value = 'shape'; shape.value = validateShapeStyle(layer.shape); [width.value, height.value] = layer.transform.size; name.value = layer.name
    }
    selection.value = [0, 0]
  } catch (error) { emit('error', error instanceof Error ? error.message : String(error)) }
}, { immediate: true })
watch(()=>props.draft,value=>{if(!value)return;if(value.text){text.value=validateTextStyle(value.text);fixedBox.value=!!text.value.boxSize}if(value.shape)shape.value=validateShapeStyle(value.shape);[width.value,height.value]=value.size},{deep:true})
watch(()=>props.selectionRange,value=>{if(value)selection.value=[...value]},{deep:true})
watch([text,shape,width,height,fixedBox],()=>{
 let value:{text?:TextStyle;shape?:ShapeStyle;size:[number,number]}
 if(mode.value==='text'){const style=structuredClone(toRaw(text.value));if(fixedBox.value)style.boxSize=[width.value,height.value];else delete style.boxSize;value={text:style,size:[width.value,height.value]}}
 else value={shape:structuredClone(toRaw(shape.value)),size:[width.value,height.value]}
 // A canvas draft is a controlled value; feeding its synchronization back into
 // the overlay would repeatedly rasterize identical text and lose IME responsiveness.
 const incoming=props.draft&&(mode.value==='text'?{text:props.draft.text,size:props.draft.size}:{shape:props.draft.shape,size:props.draft.size})
 if(!incoming||JSON.stringify(value)!==JSON.stringify(incoming))emit('draft',value)
},{deep:true})

const warnings=computed(()=>mode.value==='text'?textFontWarnings(text.value):[])
function rememberSelection(): void { selection.value = [textArea.value?.selectionStart ?? 0, (textArea.value?.selectionEnd ?? 0) - (textArea.value?.selectionStart ?? 0)] }
function contentChanged(event: Event): void {
  const value = (event.target as HTMLTextAreaElement).value, previous = text.value.content
  let start = 0, end = previous.length, nextEnd = value.length
  while (start < Math.min(previous.length, value.length) && previous[start] === value[start]) start++
  while (end > start && nextEnd > start && previous[end - 1] === value[nextEnd - 1]) { end--; nextEnd-- }
  try { text.value = replaceTextCharacters(text.value, start, end - start, value.slice(start, nextEnd)); rememberSelection() }
  catch (error) { emit('error', error instanceof Error ? error.message : String(error)) }
}
function fontSelected(face:string):void{try{text.value=setTextFont(text.value,selection.value[0],selection.value[1],face)}catch(error){emit('error',error instanceof Error?error.message:String(error))}}
function fontChanged(event: Event): void {
  try { text.value = setTextFont(text.value, selection.value[0], selection.value[1], (event.target as HTMLInputElement).value) }
  catch (error) { emit('error', error instanceof Error ? error.message : String(error)) }
}
async function apply(update: boolean): Promise<void> {
  if (busy.value || props.disabled) return
  if(props.onCanvas){emit('applyCanvas');return}
  busy.value = true
  try {
    let raster: ContentRaster
    if (mode.value === 'text') {
      const style = validateTextStyle(text.value)
      if (fixedBox.value) style.boxSize = [width.value, height.value]; else delete style.boxSize
      raster = await renderTextPNG(style)
    } else raster = await renderShapePNG(shape.value, [width.value, height.value])
    const edit: ContentEdit = { name: name.value.trim() || (mode.value === 'text' ? 'Text' : shape.value.kind), raster }
    if (update && props.layer) { edit.layerId = props.layer.id; emit('update', edit) } else emit('create', edit)
  } catch (error) { emit('error', error instanceof Error ? error.message : String(error)) }
  finally { busy.value = false }
}
function cycleKind():void{mode.value='shape';const kinds=['Rectangle','Ellipse','Line'] as const;shape.value.kind=kinds[(kinds.indexOf(shape.value.kind)+1)%kinds.length]}
defineExpose({cycleKind})
</script>

<template>
  <form :class="['content-tools',{compact}]" :aria-label="t('Editable content')" @submit.prevent="apply(isExisting)">
    <fieldset :disabled="disabled || busy">
      <div class="row content-mode"><button type="button" :class="{ active: mode === 'text' }" @click="mode = 'text'">{{ t('Text') }}</button><button type="button" :class="{ active: mode === 'shape' }" @click="mode = 'shape'">{{ t('Shape') }}</button></div>
      <label class="content-name">{{ t('Name') }}<input v-model="name" maxlength="4096"></label>
      <template v-if="mode === 'text'">
        <label class="content-source">{{ t('Content') }}<textarea :aria-label="t('Text content')" ref="textArea" :value="text.content" maxlength="100000" rows="4" @input="contentChanged" @select="rememberSelection" @keyup="rememberSelection" @mouseup="rememberSelection" /></label>
        <label>{{ t('Font') }}<FontPicker :value="text.fontName" :fonts="fonts" :disabled="disabled||busy" @select="fontSelected"/></label><p class="font-preview" :style="{fontFamily:text.fontName}">Aa Bb · 文字预览 0123</p>
        <div class="row"><label>{{ t('Size') }}<input :aria-label="t('Font size')" v-model.number="text.fontSize" type="number" min="1" max="2000"></label><label>{{ t('Alignment') }}<select v-model="text.alignment"><option :value="'Left'">{{ t('Left') }}</option><option :value="'Center'">{{ t('Center') }}</option><option :value="'Right'">{{ t('Right') }}</option></select></label></div>
        <div class="row"><label>{{ t('Tracking') }}<input :aria-label="t('Text tracking')" v-model.number="text.tracking" type="number" min="-100" max="1000"></label><label>{{ t('Leading') }}<input v-model.number="text.leading" type="number" min="0" max="5000" :title="t('0 uses automatic 120% leading')"></label></div>
        <label class="check"><input v-model="fixedBox" type="checkbox">{{ t('Fixed paragraph box') }}</label>
        <p v-if="selection[1]" class="hint">{{ t('Font and color apply to {count} selected UTF-16 units.', {count:selection[1]}) }}</p>
      </template>
      <template v-else>
        <label>{{ t('Kind') }}<select :aria-label="t('Shape kind')" v-model="shape.kind"><option :value="'Rectangle'">{{ t('Rectangle') }}</option><option :value="'Ellipse'">{{ t('Ellipse') }}</option><option :value="'Line'">{{ t('Line') }}</option></select></label>
        <label v-if="shape.kind === 'Rectangle'">{{ t('Corner radius') }}<input v-model.number="shape.cornerRadius" type="number" min="0"></label>
        <label v-if="shape.kind === 'Line'">{{ t('Line width') }}<input v-model.number="shape.lineWidth" type="number" min="1"></label>
        <template v-if="shape.kind === 'Line' && shape.start && shape.end">
          <div class="row"><label>{{ t('Start X') }}<input v-model.number="shape.start[0]" type="number" min="0" max="1" step=".01"></label><label>{{ t('Start Y') }}<input v-model.number="shape.start[1]" type="number" min="0" max="1" step=".01"></label></div>
          <div class="row"><label>{{ t('End X') }}<input v-model.number="shape.end[0]" type="number" min="0" max="1" step=".01"></label><label>{{ t('End Y') }}<input v-model.number="shape.end[1]" type="number" min="0" max="1" step=".01"></label></div>
        </template>
      </template>
      <p v-for="warning in warnings" :key="warning" class="font-warning" role="status">{{tm(warning)}}</p>
      <label>{{ t('Color') }}<input v-model="color" type="color"></label>
      <div v-if="mode === 'shape' || fixedBox" class="row"><label>{{ t('Width') }}<input v-model.number="width" type="number" :min="mode === 'text' ? 16 : 1" :max="LIMITS.maxSide"></label><label>{{ t('Height') }}<input v-model.number="height" type="number" :min="mode === 'text' ? 16 : 1" :max="LIMITS.maxSide"></label></div>
      <div class="row content-actions"><button type="submit">{{ t(busy ? 'Rendering…' : onCanvas ? 'Apply on canvas' : isExisting ? 'Update layer' : 'Create layer') }}</button><button v-if="isExisting&&!onCanvas" type="button" @click="apply(false)">{{ t('Create new') }}</button></div>
    </fieldset>
  </form>
</template>

<style scoped>
.content-tools { padding: 10px; font-size: 12px; color: inherit; }
.content-tools.compact{padding:0;white-space:nowrap}.compact fieldset{display:flex;align-items:center;gap:14px}.compact .row{display:contents}.compact label{flex:none;flex-direction:row;align-items:center;margin:0;gap:6px}.compact .content-mode,.compact .content-name,.compact .content-source,.compact .font-preview,.compact .font-warning,.compact .hint{display:none}.compact input[type=number]{width:65px}.compact input[list]{width:160px}.compact select{max-width:130px}.compact .content-actions button{white-space:nowrap}.compact .row.content-mode{display:none}.compact input[type=color]{height:30px}
fieldset { border: 0; margin: 0; padding: 0; }
.row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
label { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; flex: 1; min-width: 0; }
label.check { flex-direction: row; align-items: center; }
input, textarea, select, button { font: inherit; color: inherit; background: #1b1b1b; border: 1px solid #474747; border-radius: 4px; padding: 5px; min-width: 0; }
button { background: #303030; cursor: pointer; }
button.active { background: #315c88; }
input[type=color] { width: 60px; height: 30px; }
.font-preview{font-size:18px;padding:6px 0;margin:0 0 8px;}.font-warning{color:#ffd78b;line-height:1.4;}
.hint { color: #aaa; margin: 0 0 8px; }
</style>
