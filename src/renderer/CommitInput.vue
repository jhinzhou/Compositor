<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
const props = defineProps<{ value: number | string; disabled?: boolean; type?: string; label: string; min?: number; max?: number; scrubLabel?: string; sensitivity?: number; step?: number }>()
const emit = defineEmits<{ commit: [value: string]; preview: [value: string]; editing: [active: boolean] }>()
const draft = ref(String(props.value)), focused = ref(false)
let editStart: string | undefined
let scrub: {startX:number;start:number;pointerId:number;target:HTMLElement}|undefined
watch(() => props.value, value => { if (!focused.value&&!scrub) draft.value = String(value) })
function validNumber():boolean {const value=Number(draft.value);return String(draft.value).trim()!==''&&Number.isFinite(value)&&(props.min===undefined||value>=props.min)&&(props.max===undefined||value<=props.max)}
function preview():void {if(validNumber())emit('preview',String(draft.value))}
function focus():void {editStart=String(props.value);focused.value=true;emit('editing',true)}
function escape():void {draft.value=editStart??String(props.value);preview()}
function blur(): void {focused.value=false;if(props.type!=='text'&&!validNumber()){draft.value=String(props.value);preview()}else if(String(draft.value)!==(editStart??String(props.value)))emit('commit',String(draft.value));emit('editing',false);editStart=undefined}
function startScrub(event:PointerEvent):void {
 if(props.disabled||event.button!==0||!Number.isFinite(Number(props.value)))return
 const target=event.currentTarget as HTMLElement;scrub={startX:event.clientX,start:Number(props.value),pointerId:event.pointerId,target};target.setPointerCapture(event.pointerId);emit('editing',true);document.addEventListener('keydown',cancelKey,true);event.preventDefault()
}
function moveScrub(event:PointerEvent):void {
 if(!scrub)return
 const step=props.step??1,proposed=scrub.start+(event.clientX-scrub.startX)*(props.sensitivity??1),snapped=step>0?Math.round(proposed/step)*step:proposed
 draft.value=String(Math.round(Math.min(props.max??30_000,Math.max(props.min??-30_000,snapped))*100)/100);preview();event.preventDefault()
}
function endScrub(cancel=false):void {
 if(!scrub)return
 const current=scrub;scrub=undefined;if(current.target.hasPointerCapture(current.pointerId))current.target.releasePointerCapture(current.pointerId);document.removeEventListener('keydown',cancelKey,true)
 if(cancel){draft.value=String(current.start);emit('preview',String(draft.value))}else if(draft.value!==String(current.start))emit('commit',String(draft.value))
 emit('editing',false)
}
function cancelKey(event:KeyboardEvent):void {if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();endScrub(true)}}
onBeforeUnmount(()=>endScrub(true))
</script>
<template>
 <span v-if="scrubLabel" class="commit-field"><span class="scrub-label" :aria-label="`Drag ${label}`" :class="{disabled}" @pointerdown="startScrub" @pointermove="moveScrub" @pointerup="endScrub()" @pointercancel="endScrub(true)">{{scrubLabel}}</span><input v-model="draft" :type="type??'number'" :aria-label="label" :disabled="disabled" :min="min" :max="max" :step="step??'any'" @input="preview" @focus="focus" @blur="blur" @keydown.enter="($event.target as HTMLInputElement).blur()" @keydown.escape.stop.prevent="escape();($event.target as HTMLInputElement).blur()" /></span>
 <input v-else v-model="draft" :type="type??'number'" :aria-label="label" :disabled="disabled" :min="min" :max="max" :step="step??'any'" @input="preview" @focus="focus" @blur="blur" @keydown.enter="($event.target as HTMLInputElement).blur()" @keydown.escape.stop.prevent="escape();($event.target as HTMLInputElement).blur()" />
</template>
<style scoped>
.commit-field {display:flex;align-items:center;gap:4px;min-width:0}.scrub-label {cursor:ew-resize;touch-action:none;user-select:none;white-space:nowrap}.scrub-label.disabled {cursor:default}
</style>
