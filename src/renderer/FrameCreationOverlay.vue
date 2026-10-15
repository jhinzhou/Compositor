<script setup lang="ts">
import {ref,watch,onMounted,onBeforeUnmount} from 'vue'
import type {FrameMetadata} from '../shared/frame'
const props=defineProps<{width:number;height:number;zoom:number;kind:FrameMetadata['kind'];disabled?:boolean;spacePan?:boolean;mapClientPoint:(x:number,y:number)=>[number,number]}>()
const emit=defineEmits<{update:[FrameMetadata|undefined];commit:[FrameMetadata];interaction:[boolean];cancel:[]}>()
const draft=ref<FrameMetadata>()
let drag:{pointer:number;target:SVGSVGElement;start:[number,number]}|undefined
function point(e:PointerEvent):[number,number]{const p=props.mapClientPoint(e.clientX,e.clientY);return [Math.min(props.width,Math.max(0,p[0])),Math.min(props.height,Math.max(0,p[1]))]}
function start(e:PointerEvent):void{if(e.button!==0||drag||props.disabled||props.spacePan)return;const target=e.currentTarget as SVGSVGElement;drag={pointer:e.pointerId,target,start:point(e)};target.setPointerCapture(e.pointerId);emit('interaction',true);e.preventDefault()}
function move(e:PointerEvent):void{if(e.pointerId!==drag?.pointer)return;const p=point(e),a=drag.start;let dx=p[0]-a[0],dy=p[1]-a[1];if(e.shiftKey){const side=Math.min(Math.abs(dx),Math.abs(dy));dx=Math.sign(dx)*side;dy=Math.sign(dy)*side}const x=Math.min(a[0],a[0]+dx),y=Math.min(a[1],a[1]+dy),width=Math.abs(dx),height=Math.abs(dy);draft.value={kind:props.kind,bounds:[x,y,width,height]};emit('update',draft.value);e.preventDefault()}
function end(cancel=false):void{const owner=drag;if(!owner)return;drag=undefined;if(owner.target.hasPointerCapture(owner.pointer))owner.target.releasePointerCapture(owner.pointer);const value=draft.value;draft.value=undefined;if(cancel||!value||value.bounds[2]<1||value.bounds[3]<1){emit('update',undefined);emit('cancel')}emit('interaction',false);if(!cancel&&value&&value.bounds[2]>=1&&value.bounds[3]>=1)emit('commit',value)}
function finish(e:PointerEvent):void{if(e.pointerId!==drag?.pointer)return;move(e);end()}
function cancel(e:PointerEvent):void{if(e.pointerId===drag?.pointer)end(true)}
function blur():void{end(true)}
function key(e:KeyboardEvent):void{if(drag&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();end(true)}}
defineExpose({finish:end})
watch(()=>[props.width,props.height,props.zoom,props.kind,props.disabled,props.spacePan],()=>end(true),{flush:'sync'})
onMounted(()=>{window.addEventListener('blur',blur);document.addEventListener('keydown',key,true)})
onBeforeUnmount(()=>{window.removeEventListener('blur',blur);document.removeEventListener('keydown',key,true);end(true)})
</script>
<template>
 <svg class="frame-creation-overlay" :width="width*zoom" :height="height*zoom" :viewBox="`0 0 ${width} ${height}`" @pointerdown.stop="start" @pointermove.stop="move" @pointerup.stop="finish" @pointercancel.stop="cancel" @lostpointercapture.stop="cancel">
  <rect width="100%" height="100%" fill="transparent"/>
  <ellipse v-if="draft&&kind==='ellipse'" :cx="draft.bounds[0]+draft.bounds[2]/2" :cy="draft.bounds[1]+draft.bounds[3]/2" :rx="draft.bounds[2]/2" :ry="draft.bounds[3]/2" fill="none" stroke="#58a6ff" :stroke-width="1/zoom" pointer-events="none"/>
  <rect v-else-if="draft" :x="draft.bounds[0]" :y="draft.bounds[1]" :width="draft.bounds[2]" :height="draft.bounds[3]" fill="none" stroke="#58a6ff" :stroke-width="1/zoom" pointer-events="none"/>
 </svg>
</template>
<style scoped>.frame-creation-overlay{position:absolute;left:0;top:0;z-index:8;touch-action:none;cursor:crosshair}</style>
