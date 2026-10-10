<script setup lang="ts">
import {computed,onBeforeUnmount,ref} from 'vue'
import {LIMITS,type Transform} from '../shared/contracts'
import {commandForKey,type ShortcutOverrides,type WorkspaceCommand} from './command-shortcuts'
const props=withDefaults(defineProps<{width:number;height:number;resolution:number;shortcutOverrides?:ShortcutOverrides;shortcutPlatform?:'mac'|'other'}>(),{shortcutOverrides:()=>({}),shortcutPlatform:'other'})
type Options={width:number;height:number;resolution:number;resample:boolean;sampling:Transform['sampling']}
const emit=defineEmits<{apply:[options:Options];cancel:[]}>()
const width=ref(props.width),height=ref(props.height),resolution=ref(props.resolution),lastResolution=ref(props.resolution),locked=ref(true),resample=ref(true),unit=ref('Pixels'),sampling=ref<Transform['sampling']>('High quality')
const physical=computed(()=>unit.value==='Inches'||unit.value==='Centimeters'),units=computed(()=>resample.value?['Pixels','Percent','Inches','Centimeters']:['Inches','Centimeters'])
const validResolution=computed(()=>Number.isFinite(resolution.value)&&resolution.value>=1&&resolution.value<=9600)
const valid=computed(()=>validResolution.value&&[width.value,height.value].every(value=>Number.isFinite(value)&&Math.round(value)>=1&&Math.round(value)<=LIMITS.maxSide)&&(!resample.value||Math.round(width.value)*Math.round(height.value)<=LIMITS.maxSurfacePixels))
function display(pixels:number,original:number):number{if(unit.value==='Percent')return pixels/original*100;if(physical.value)return pixels/resolution.value*(unit.value==='Centimeters'?2.54:1);return pixels}
function presented(isWidth:boolean):number{return Math.round(display(isWidth?width.value:height.value,isWidth?props.width:props.height)*1000)/1000}
function dimension(isWidth:boolean,value:string|number):void{const next=Number(value);if(!Number.isFinite(next)||next<=0||physical.value&&!(Number.isFinite(resolution.value)&&resolution.value>0))return
 if(!resample.value){setResolution((isWidth?width.value:height.value)/next*(unit.value==='Centimeters'?2.54:1));return}
 const pixels=unit.value==='Percent'?next/100*(isWidth?props.width:props.height):physical.value?next/(unit.value==='Centimeters'?2.54:1)*resolution.value:next
 if(isWidth){if(locked.value)height.value=pixels*height.value/width.value;width.value=pixels}else{if(locked.value)width.value=pixels*width.value/height.value;height.value=pixels}}
function setResolution(value:string|number):void{const next=Number(value);resolution.value=next;if(!(Number.isFinite(next)&&next>0))return;if(resample.value&&physical.value){width.value*=next/lastResolution.value;height.value*=next/lastResolution.value}lastResolution.value=next}
function setResample(enabled:boolean):void{resample.value=enabled;if(!enabled){width.value=props.width;height.value=props.height;locked.value=true;if(!physical.value)unit.value='Inches'}}
function bounds(isWidth:boolean):{min:number;max:number;sensitivity:number}{if(physical.value&&!(Number.isFinite(resolution.value)&&resolution.value>0))return {min:0,max:0,sensitivity:0};const pixels=isWidth?width.value:height.value,other=isWidth?height.value:width.value,original=isWidth?props.width:props.height
 if(!resample.value){const multiplier=unit.value==='Centimeters'?2.54:1;return {min:pixels*multiplier/9600,max:pixels*multiplier,sensitivity:.01*multiplier}}
 // Native scrubbing stays within 100 MP; manual entry may use the 200 MP surface budget.
 const minimum=locked.value?Math.max(1,pixels/other):1,side=locked.value?Math.min(LIMITS.maxSide,LIMITS.maxSide*pixels/other):LIMITS.maxSide,area=locked.value?Math.sqrt(100_000_000*pixels/other):100_000_000/other
 return {min:display(minimum,original),max:display(Math.max(minimum,Math.min(side,area)),original),sensitivity:unit.value==='Percent'?100/original:physical.value?(unit.value==='Centimeters'?2.54:1)/resolution.value:1}}
// Each DOM input has one update path. Do not combine a parent capture listener
// with a child's preview/commit draft, which can overwrite the new DOM value.
function rawDimension(isWidth:boolean,event:Event):void{dimension(isWidth,(event.target as HTMLInputElement).value)}
function rawResolution(event:Event):void{setResolution((event.target as HTMLInputElement).value)}
function restoreDimension(isWidth:boolean,event:Event):void{const value=presented(isWidth);(event.target as HTMLInputElement).value=Number.isFinite(value)?String(value):''}
function inputValue(isWidth:boolean):number|string{const value=presented(isWidth);return Number.isFinite(value)?value:''}
type ScrubAxis='width'|'height'|'resolution'
type Scrub={axis:ScrubAxis;startX:number;startValue:number;min:number;max:number;sensitivity:number;target:HTMLElement;pointerId:number;snapshot:[number,number,number,number]}
let scrub:Scrub|undefined
function startScrub(event:PointerEvent,axis:ScrubAxis):void{if(event.button!==0)return;const value=axis==='resolution'?resolution.value:presented(axis==='width'),range=axis==='resolution'?{min:1,max:9600,sensitivity:1}:bounds(axis==='width');if(!Number.isFinite(value)||!range.sensitivity)return
 finishScrub();const target=event.currentTarget as HTMLElement;scrub={axis,startX:event.clientX,startValue:value,...range,target,pointerId:event.pointerId,snapshot:[width.value,height.value,resolution.value,lastResolution.value]};target.setPointerCapture?.(event.pointerId);event.preventDefault()}
function moveScrub(event:PointerEvent):void{if(!scrub||scrub.pointerId!==event.pointerId)return;const value=Math.min(scrub.max,Math.max(scrub.min,scrub.startValue+(event.clientX-scrub.startX)*scrub.sensitivity));if(scrub.axis==='resolution')setResolution(Math.round(value));else dimension(scrub.axis==='width',value);event.preventDefault()}
function finishScrub(cancelled=false):void{if(!scrub)return;const previous=scrub;scrub=undefined;if(cancelled)[width.value,height.value,resolution.value,lastResolution.value]=previous.snapshot;if(previous.target.hasPointerCapture?.(previous.pointerId))previous.target.releasePointerCapture(previous.pointerId)}
onBeforeUnmount(()=>finishScrub())
function commit():void{if(valid.value)emit('apply',{width:Math.round(width.value),height:Math.round(height.value),resolution:resolution.value,resample:resample.value,sampling:sampling.value})}
function cancel():void{emit('cancel')}
const commands:WorkspaceCommand[]=[{id:'apply-draft',title:'Apply Current Operation',shortcut:'enter'},{id:'cancel-draft',title:'Cancel Current Operation',shortcut:'escape'}]
function keydown(event:KeyboardEvent):void{if(event.isComposing)return;const command=commandForKey(commands,props.shortcutOverrides,event,props.shortcutPlatform);if(command){event.preventDefault();event.stopPropagation();if(command.id==='apply-draft')commit();else cancel()}else if(event.key==='Enter'){event.preventDefault()}else if(event.key==='Escape'){event.stopPropagation()}}
defineExpose({commit,cancel})
</script>
<template>
 <form class="size-dialog image-size-dialog" role="dialog" aria-modal="true" aria-label="Image Size" novalidate @submit.prevent="commit" @keydown.capture="keydown">
  <h2>Image Size</h2><p class="current">Current: {{props.width.toLocaleString('en-US')}} × {{props.height.toLocaleString('en-US')}} pixels</p>
  <label>Units<select v-model="unit" aria-label="Image size units"><option v-for="name in units" :key="name">{{name}}</option></select></label>
  <label class="dimension"><span class="scrub-label" @pointerdown="startScrub($event,'width')" @pointermove="moveScrub" @pointerup="finishScrub()" @pointercancel="finishScrub(true)">Width</span><input aria-label="Image width" type="number" step="any" :value="inputValue(true)" @input="rawDimension(true,$event)" @blur="restoreDimension(true,$event)"></label>
  <label class="dimension"><span class="scrub-label" @pointerdown="startScrub($event,'height')" @pointermove="moveScrub" @pointerup="finishScrub()" @pointercancel="finishScrub(true)">Height</span><input aria-label="Image height" type="number" step="any" :value="inputValue(false)" @input="rawDimension(false,$event)" @blur="restoreDimension(false,$event)"></label>
  <label class="check"><input v-model="locked" aria-label="Lock aspect ratio" type="checkbox" :disabled="!resample">Lock aspect ratio</label>
  <label class="resolution"><span class="scrub-label" @pointerdown="startScrub($event,'resolution')" @pointermove="moveScrub" @pointerup="finishScrub()" @pointercancel="finishScrub(true)">Resolution</span><input aria-label="Image resolution" type="number" step="any" min="1" max="9600" :value="resolution" @input="rawResolution"><span>pixels/inch</span></label>
  <label class="check"><input :checked="resample" aria-label="Resample pixels" type="checkbox" @change="setResample(($event.target as HTMLInputElement).checked)">Resample</label>
  <label v-if="resample">Sampling<select v-model="sampling" aria-label="Image sampling"><option>High quality</option><option>Smooth</option><option>Nearest</option></select></label>
  <p>{{resample?'Resizes layer pixels and applies existing transforms. Undo restores the originals.':'Only print dimensions and resolution change. Pixels stay unchanged.'}}</p>
  <p :role="valid?'status':'alert'" :class="{invalid:!valid}">{{valid?`Result: ${Math.round(width).toLocaleString('en-US')} × ${Math.round(height).toLocaleString('en-US')} pixels`:`Use 1–${LIMITS.maxSide.toLocaleString('en-US')} pixels per side, up to ${LIMITS.maxSurfacePixels/1_000_000} megapixels, and 1–9,600 pixels/inch.`}}</p>
  <footer><button type="button" @click="cancel">Cancel</button><button type="submit" :disabled="!valid">Resize</button></footer>
 </form>
</template>
<style scoped>
.image-size-dialog{width:min(430px,calc(100vw - 48px));box-sizing:border-box;max-height:calc(100vh - 48px);overflow:auto;gap:14px;color:#ddd;font:13px system-ui}
.image-size-dialog h2{margin:0;font-size:20px}.image-size-dialog p{margin:0;width:100%;line-height:1.5;font-size:12px;color:#aaa}
.image-size-dialog label:not(.check){justify-content:space-between}
.image-size-dialog select,.image-size-dialog input[type=number]{background:#202020;color:inherit;border:1px solid #555;border-radius:5px;box-sizing:border-box;font:inherit;height:34px;min-height:34px;line-height:20px;padding:0 10px}
.image-size-dialog select{width:185px;min-width:185px}
.dimension,.resolution{width:100%;display:flex;align-items:center;gap:8px}.dimension input{width:185px}.resolution input{width:120px}.scrub-label{flex:1;cursor:ew-resize;touch-action:none;user-select:none}.resolution>span:last-child{font-size:11px;color:#aaa}
.image-size-dialog .invalid{color:#ffb861}.image-size-dialog footer{width:100%;display:flex;justify-content:space-between;gap:12px}.image-size-dialog button{background:#202020;border:1px solid #555;border-radius:5px;color:inherit;padding:7px 14px;cursor:pointer}.image-size-dialog button:disabled{opacity:.4;cursor:default}.image-size-dialog button[type=submit]{background:#087ff5;border-color:#087ff5;color:#fff}
</style>
