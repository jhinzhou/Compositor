<script setup lang="ts">
import {computed,onBeforeUnmount,onMounted,toRaw} from 'vue'
import {CROP_HANDLES,cropDragRectangle,validCropRect,type CropRect,type CropHandle} from './crop-geometry'
import type {SnapOptions} from './view-geometry'
const props=defineProps<{draft:CropRect;zoom:number;workspace?:CropRect;aspect?:number;snap?:SnapOptions;disabled?:boolean;spacePan?:boolean}>()
const emit=defineEmits<{update:[CropRect];interaction:[boolean]}>()
let drag:{pointer:number;target:HTMLElement;point:[number,number];last:[number,number];zoom:number;initial:CropRect;mode:'move'|CropHandle}|undefined
// A full-canvas initial frame lets a drag inside it create a new crop, as native
// Compositor does. Its edge handles remain available for resizing.
const fullCanvas=computed(()=>props.snap?.document&&props.draft.x===0&&props.draft.y===0&&props.draft.width===props.snap.document.width&&props.draft.height===props.snap.document.height)
// Shade the viewport outside the crop, including space outside the image.
const shade=computed(()=>{
 const document=props.snap?.document
 if(!document)return undefined
 const {x,y,width,height}=props.draft
 const box=props.workspace??{x:0,y:0,width:document.width,height:document.height}
 return {left:box.x*props.zoom,top:box.y*props.zoom,width:box.width*props.zoom,height:box.height*props.zoom,viewBox:`${box.x} ${box.y} ${box.width} ${box.height}`,path:`M${box.x} ${box.y}H${box.x+box.width}V${box.y+box.height}H${box.x}Z M${x} ${y}H${x+width}V${y+height}H${x}Z`}
})
const frameStyle=computed(()=>({left:`${props.draft.x*props.zoom}px`,top:`${props.draft.y*props.zoom}px`,width:`${props.draft.width*props.zoom}px`,height:`${props.draft.height*props.zoom}px`,pointerEvents:props.disabled||props.spacePan||fullCanvas.value?'none' as const:'auto' as const}))
function start(event:PointerEvent,mode:'move'|CropHandle):void {
 if(event.button!==0||props.disabled||props.spacePan||drag)return
 const target=event.currentTarget as HTMLElement
 drag={pointer:event.pointerId,target,point:[event.clientX,event.clientY],last:[event.clientX,event.clientY],zoom:props.zoom,initial:structuredClone(toRaw(props.draft)),mode}
 target.setPointerCapture(event.pointerId);emit('interaction',true);event.preventDefault()
}
function move(event:PointerEvent):void {
 if(!drag||event.pointerId!==drag.pointer)return
 drag.last=[event.clientX,event.clientY];update(event.altKey,event.ctrlKey)
 event.preventDefault()
}
function update(alt:boolean,ctrl:boolean):void {
 if(!drag)return
 const next=cropDragRectangle(drag.initial,drag.mode,[(drag.last[0]-drag.point[0])/drag.zoom,(drag.last[1]-drag.point[1])/drag.zoom],props.aspect,alt,props.snap,ctrl)
 if(validCropRect(next))emit('update',next)
}
function finish(event:PointerEvent):void {move(event);end()}
function end(cancel=false):void {const current=drag;if(!current)return;drag=undefined;if(current.target.hasPointerCapture(current.pointer))current.target.releasePointerCapture(current.pointer);if(cancel)emit('update',current.initial);emit('interaction',false)}
function keydown(event:KeyboardEvent):void {if(!drag)return;if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();end(true)}else if(event.key==='Enter')end();else if(event.key==='Alt'||event.key==='Control')update(event.altKey,event.ctrlKey)}
function keyup(event:KeyboardEvent):void {if(drag&&(event.key==='Alt'||event.key==='Control'))update(event.altKey,event.ctrlKey)}
onMounted(()=>{document.addEventListener('keydown',keydown,true);document.addEventListener('keyup',keyup,true)})
onBeforeUnmount(()=>{document.removeEventListener('keydown',keydown,true);document.removeEventListener('keyup',keyup,true);end()})
</script>
<template>
 <svg v-if="shade" class="crop-shade" :style="{left:`${shade.left}px`,top:`${shade.top}px`}" :width="shade.width" :height="shade.height" :viewBox="shade.viewBox" aria-hidden="true"><path :d="shade.path" fill="black" fill-opacity="0.6" fill-rule="evenodd"/></svg>
 <div class="crop-frame" :style="frameStyle" aria-label="Move crop" title="Drag to move the crop frame. Alt resizes from the center; Ctrl temporarily disables snapping." @pointerdown.stop="start($event,'move')" @pointermove.stop="move" @pointerup.stop="finish" @pointercancel.stop="end(true)" @lostpointercapture="end(true)">
  <div class="crop-thirds" aria-hidden="true"><span/><span/><span/><span/></div>
  <button v-for="handle in CROP_HANDLES" :key="handle" type="button" :class="['crop-handle',handle]" :style="{pointerEvents:disabled||spacePan?'none':'auto'}" :aria-label="`Resize crop ${handle}`" :disabled="disabled" @pointerdown.stop="start($event,handle)" @pointermove.stop="move" @pointerup.stop="finish" @pointercancel.stop="end(true)" @lostpointercapture.stop="end(true)"/>
 </div>
</template>
<style scoped>
.crop-shade{position:absolute;left:0;top:0;z-index:6;pointer-events:none;overflow:hidden}
.crop-frame{position:absolute;z-index:7;box-sizing:border-box;border:1px solid #fff;outline:1px solid #0008;cursor:move;touch-action:none;overflow:visible}
.crop-thirds{position:absolute;inset:0;pointer-events:none;overflow:hidden}.crop-thirds span{position:absolute;background:#ffffff70}.crop-thirds span:nth-child(1),.crop-thirds span:nth-child(2){top:0;bottom:0;width:1px;left:33.333%}.crop-thirds span:nth-child(2){left:66.667%}.crop-thirds span:nth-child(3),.crop-thirds span:nth-child(4){left:0;right:0;height:1px;top:33.333%}.crop-thirds span:nth-child(4){top:66.667%}
.crop-handle{position:absolute;width:12px;height:12px;min-width:0;padding:0;border:0;background:transparent;border-radius:0;transform:translate(-50%,-50%);touch-action:none}
.crop-handle:hover:not(:disabled){background:transparent}
.crop-handle::after{content:'';width:4px;height:4px;box-sizing:border-box;border:1px solid #161616;background:white;pointer-events:none}
.nw{left:0;top:0;cursor:nwse-resize}.n{left:50%;top:0;cursor:ns-resize}.ne{left:100%;top:0;cursor:nesw-resize}.e{left:100%;top:50%;cursor:ew-resize}.se{left:100%;top:100%;cursor:nwse-resize}.s{left:50%;top:100%;cursor:ns-resize}.sw{left:0;top:100%;cursor:nesw-resize}.w{left:0;top:50%;cursor:ew-resize}
</style>
