<script setup lang="ts">
import {computed,onBeforeUnmount,onMounted,ref,toRaw,watch} from 'vue'
import CropOverlay from './CropOverlay.vue'
import {rotateVector} from './rotated-view'
import type {Transform} from '../shared/contracts'
import type {FrameMetadata} from '../shared/frame'
const props=defineProps<{frame:FrameMetadata;contentTransform?:Transform;mode:'frame'|'content';zoom:number;viewAngle?:number;disabled?:boolean;spacePan?:boolean}>()
const emit=defineEmits<{boundary:[FrameMetadata];content:[Transform];commit:[];interaction:[boolean];cancel:[]}>()
const cropOverlay=ref<InstanceType<typeof CropOverlay>>()
const rect=computed(()=>({x:props.frame.bounds[0],y:props.frame.bounds[1],width:props.frame.bounds[2],height:props.frame.bounds[3]}))
let pending=false,cancelled=false,drag:{pointer:number;target:HTMLElement;start:[number,number];initial:Transform;zoom:number;angle:number}|undefined
function boundary(value:{x:number;y:number;width:number;height:number}):void{pending=true;emit('boundary',{kind:props.frame.kind,bounds:[value.x,value.y,value.width,value.height]})}
function interaction(value:boolean):void {if(value){pending=false;cancelled=false}emit('interaction',value);if(!value&&pending&&!cancelled)emit('commit')}
function cancel():void{cancelled=true;emit('cancel')}
function start(event:PointerEvent):void {
 if(event.button!==0||props.disabled||props.spacePan||!props.contentTransform||drag)return
 const target=event.currentTarget as HTMLElement;drag={pointer:event.pointerId,target,start:[event.clientX,event.clientY],initial:structuredClone(toRaw(props.contentTransform)),zoom:props.zoom,angle:props.viewAngle??0};target.setPointerCapture(event.pointerId);emit('interaction',true);event.preventDefault()
}
function move(event:PointerEvent):void {
 const current=drag;if(!current||event.pointerId!==current.pointer)return
 const delta=rotateVector({x:(event.clientX-current.start[0])/current.zoom,y:(event.clientY-current.start[1])/current.zoom},-current.angle),next=structuredClone(current.initial);next.origin=[next.origin[0]+delta.x,next.origin[1]+delta.y];emit('content',next);event.preventDefault()
}
function end(cancelled=false):void{const current=drag;if(!current)return;drag=undefined;if(current.target.hasPointerCapture(current.pointer))current.target.releasePointerCapture(current.pointer);if(cancelled){emit('content',current.initial);emit('cancel')}emit('interaction',false);if(!cancelled)emit('commit')}
function finish(event:PointerEvent):void{if(event.pointerId!==drag?.pointer)return;move(event);end()}
function cancelPointer(event:PointerEvent):void{if(event.pointerId===drag?.pointer)end(true)}
function finishOwned(cancel=false):void{if(cancel)cancelled=true;cropOverlay.value?.finish(cancel);end(cancel)}
watch(()=>[props.mode,props.disabled,props.spacePan],()=>{finishOwned(true)},{flush:'sync'})
defineExpose({finish:finishOwned})
function blur():void{finishOwned(true)}
function key(event:KeyboardEvent):void{if(drag&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();end(true)}}
onMounted(()=>{window.addEventListener('blur',blur);document.addEventListener('keydown',key,true)})
onBeforeUnmount(()=>{window.removeEventListener('blur',blur);document.removeEventListener('keydown',key,true);finishOwned(true)})
</script>
<template>
 <CropOverlay ref="cropOverlay" v-if="mode==='frame'" :draft="rect" :zoom="zoom" :view-angle="viewAngle" :disabled="disabled" :space-pan="spacePan" @update="boundary" @interaction="interaction" @cancel="cancel"/>
 <div v-else class="frame-content-move" :style="{left:`${rect.x*zoom}px`,top:`${rect.y*zoom}px`,width:`${rect.width*zoom}px`,height:`${rect.height*zoom}px`,pointerEvents:disabled||spacePan?'none':'auto'}" @pointerdown.stop="start" @pointermove.stop="move" @pointerup.stop="finish" @pointercancel.stop="cancelPointer" @lostpointercapture.stop="cancelPointer"/>
</template>
<style scoped>
.frame-content-move{position:absolute;z-index:8;outline:1px dashed #58a6ff;cursor:move;touch-action:none}
</style>
