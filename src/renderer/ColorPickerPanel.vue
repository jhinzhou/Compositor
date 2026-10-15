<script setup lang="ts">
import { useI18n } from './i18n'
const { t, tm } = useI18n()
import {computed,ref,watch} from 'vue'
const props=defineProps<{value:string;sample?:string}>(),emit=defineEmits<{apply:[string];close:[]}>(),draft=ref(props.value),hue=ref(0),saturation=ref(0),brightness=ref(0)
function parse(hex:string){const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255),max=Math.max(...rgb),min=Math.min(...rgb),delta=max-min;hue.value=delta===0?0:(((max===rgb[0]?(rgb[1]-rgb[2])/delta:max===rgb[1]?(rgb[2]-rgb[0])/delta+2:(rgb[0]-rgb[1])/delta+4)*60+360)%360);saturation.value=max?delta/max:0;brightness.value=max}
parse(props.value)
function fromHSV(){const c=brightness.value*saturation.value,h=hue.value/60,x=c*(1-Math.abs(h%2-1)),m=brightness.value-c,rgb=h<1?[c,x,0]:h<2?[x,c,0]:h<3?[0,c,x]:h<4?[0,x,c]:h<5?[x,0,c]:[c,0,x];draft.value='#'+rgb.map(v=>Math.round((v+m)*255).toString(16).padStart(2,'0')).join('')}
watch(()=>props.sample,value=>{if(value){draft.value=value;parse(value)}})
const rgb=computed(()=>[1,3,5].map(i=>parseInt(draft.value.slice(i,i+2),16)))
function setRGB(index:number,value:string){const values=[...rgb.value];values[index]=Math.max(0,Math.min(255,Math.round(Number(value)||0)));draft.value='#'+values.map(v=>v.toString(16).padStart(2,'0')).join('');parse(draft.value)}
function setHex(value:string){if(/^#?[a-f0-9]{6}$/i.test(value)){draft.value='#'+value.replace('#','').toLowerCase();parse(draft.value)}}
let dragging:HTMLElement|undefined
function point(event:PointerEvent){const target=event.currentTarget as HTMLElement,rect=target.getBoundingClientRect();saturation.value=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width));brightness.value=1-Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height));fromHSV()}
function start(event:PointerEvent){dragging=event.currentTarget as HTMLElement;dragging.setPointerCapture(event.pointerId);point(event)}
function move(event:PointerEvent){if(dragging)point(event)}
function end(event:PointerEvent){if(dragging?.hasPointerCapture(event.pointerId))dragging.releasePointerCapture(event.pointerId);dragging=undefined}
</script>
<template>
 <section class="color-picker-panel" role="dialog" :aria-label="t('Color Picker')">
  <header><strong>{{ t('Color Picker') }}</strong></header>
  <div class="color-picker-body">
   <div class="sv" :aria-label="t('Saturation and brightness')" :style="{background:`linear-gradient(to top,black,transparent),linear-gradient(to right,white,hsl(${hue},100%,50%))`}" @pointerdown="start" @pointermove="move" @pointerup="end" @pointercancel="end"><span :style="{left:`${saturation*100}%`,top:`${(1-brightness)*100}%`}"/></div>
   <label class="hue-control"><span>{{ t('Hue') }}</span><input v-model.number="hue" type="range" min="0" max="360" :aria-label="t('Color hue')" @input="fromHSV"/></label>
   <div class="color-picker-fields">
    <div class="previews"><span :style="{background:draft}" :title="t('New')"/><span :style="{background:value}" :title="t('Current')"/></div>
    <label v-for="(channel,i) in ['R','G','B']" :key="channel"><span>{{channel}}</span><input :value="rgb[i]" type="number" min="0" max="255" :aria-label="t('Color {channel}', {channel:t(channel)})" @change="setRGB(i,($event.target as HTMLInputElement).value)"/></label>
    <label><span>{{ t('Hex') }}</span><input :value="draft" :aria-label="t('Color hex')" @change="setHex(($event.target as HTMLInputElement).value)"/></label>
   </div>
  </div>
  <small>{{ t('Click the canvas to sample a color.') }}</small>
  <footer class="color-picker-actions"><button type="button" @click="emit('close')">{{ t('Cancel') }}</button><button type="button" class="primary" @click="emit('apply',draft)">{{ t('OK') }}</button></footer>
 </section>
</template>
<style scoped>
.color-picker-panel{position:absolute;z-index:30;right:min(355px,calc(100vw - 470px));top:145px;width:450px;max-width:calc(100vw - 32px);max-height:calc(100vh - 165px);overflow:auto;background:#292929;border:1px solid #484848;border-radius:10px;padding:18px;box-shadow:0 8px 30px #0008;color:#ddd}
.color-picker-panel header{font-size:15px;line-height:1.4}
.color-picker-body{display:grid;grid-template-columns:220px minmax(0,1fr);gap:12px 14px;margin:16px 0}
.sv{position:relative;width:220px;height:220px;touch-action:none;cursor:crosshair;overflow:hidden}
.sv span{position:absolute;width:10px;height:10px;border:1px solid white;box-shadow:0 0 0 1px black;border-radius:50%;transform:translate(-50%,-50%);pointer-events:none}
.hue-control{grid-column:1;display:flex;gap:8px;align-items:center;white-space:nowrap}
.hue-control input{flex:1;min-width:0;width:0;padding:0}
.color-picker-fields{grid-column:2;grid-row:1/span 2;display:flex;flex-direction:column;gap:10px;min-width:0}
.color-picker-fields label{display:flex;gap:8px;align-items:center;min-width:0}
.color-picker-fields label>span{flex:0 0 4.25em;white-space:nowrap}
.color-picker-fields input{flex:1;min-width:0;width:0;height:30px;color:#ddd;background:#191919;border:1px solid #555;border-radius:5px;padding:0 7px}
.previews{display:flex;height:36px;flex-shrink:0;border-radius:5px;overflow:hidden}
.previews span{flex:1;border:1px solid #555}
.color-picker-panel small{display:block;color:#aaa;line-height:1.5}
.color-picker-actions{display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:16px;padding-top:14px;border-top:1px solid #3d3d3d}
.color-picker-actions button{min-width:80px;min-height:32px;padding:6px 14px;background:#353535;border:1px solid #555;border-radius:6px;white-space:nowrap}
.color-picker-actions button:hover{background:#424242}
.color-picker-actions button.primary{background:#087ff5;border-color:#087ff5;color:#fff}
.color-picker-actions button.primary:hover{background:#2190ff}
@media(max-width:500px){.color-picker-panel{right:16px;top:80px;max-height:calc(100vh - 96px)}.color-picker-body{grid-template-columns:minmax(0,1fr);justify-items:stretch}.sv{width:100%;height:220px}.color-picker-fields{grid-column:1;grid-row:auto}.hue-control{grid-row:2}}
</style>
