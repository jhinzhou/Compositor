<script setup lang="ts">
import {computed,onBeforeUnmount,onMounted,ref,toRaw,watch} from 'vue'
import {mapVectorPath,splitVectorSegment,deleteVectorKnot,moveVectorKnot,setVectorKnotHandle,validateVectorPath,vectorPathSVG,type VectorPath,type VectorPoint} from '../shared/vector-path'
const props=defineProps<{path:VectorPath;width:number;height:number;zoom:number;mode:'pen'|'edit'|'path';disabled?:boolean;spacePan?:boolean;mapClientPoint?:(x:number,y:number)=>VectorPoint}>()
const emit=defineEmits<{update:[VectorPath];commit:[VectorPath];interaction:[boolean];cancel:[];selected:[string|undefined];deletePath:[]}>()
const selected=ref<string>(),svg=ref<SVGSVGElement>(),d=computed(()=>vectorPathSVG(props.path)),knots=computed(()=>props.path.subpaths.flatMap(subpath=>subpath.knots)),radius=computed(()=>4/props.zoom)
let drag:{pointer:number;target:SVGElement;initial:VectorPath;draft:VectorPath;knotId:string;mode:'anchor'|'inHandle'|'outHandle'|'create'|'path';start:VectorPoint}|undefined
const uid=()=>crypto.randomUUID()
function point(event:PointerEvent):VectorPoint {
 if(props.mapClientPoint)return props.mapClientPoint(event.clientX,event.clientY)
 const matrix=svg.value?.getScreenCTM();if(!matrix)throw Error('The path viewport is unavailable.')
 const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());return [p.x,p.y]
}
function publish(path:VectorPath):void{const value=validateVectorPath(path);if(drag)drag.draft=value;emit('update',value)}
function begin(event:PointerEvent,knotId:string,mode:'anchor'|'inHandle'|'outHandle'|'create'|'path',draft:VectorPath,initial=props.path):void {
 const target=event.currentTarget as SVGElement;drag={pointer:event.pointerId,target,initial:structuredClone(toRaw(initial)),draft:structuredClone(toRaw(draft)),knotId,mode,start:point(event)}
 selected.value=mode==='path'?undefined:knotId;emit('selected',selected.value);target.setPointerCapture(event.pointerId);emit('interaction',true);event.preventDefault()
}
function pathStart(event:PointerEvent):void {
 if(event.button!==0||props.mode!=='path'||props.disabled||props.spacePan||drag||!props.path.subpaths.length)return
 begin(event,'','path',props.path)
}
function add(event:PointerEvent):void {
 if(event.button!==0||props.disabled||props.spacePan||props.mode!=='pen'||drag)return
 const draft=validateVectorPath(props.path),p=point(event);let subpath=draft.subpaths.at(-1)
 if(!subpath||subpath.closed){subpath={id:uid(),closed:false,knots:[]};draft.subpaths.push(subpath)}
 const knotId=uid();subpath.knots.push({id:knotId,point:p});begin(event,knotId,'create',draft);publish(draft)
}
function anchor(event:PointerEvent,knotId:string):void {
 if(event.button!==0||props.disabled||props.spacePan||props.mode==='path'||drag)return
 const subpath=props.path.subpaths.find(subpath=>subpath.knots.some(knot=>knot.id===knotId))
 if(props.mode==='pen'&&subpath&&!subpath.closed&&subpath.knots[0].id===knotId&&subpath.knots.length>=2){const draft=validateVectorPath(props.path);draft.subpaths.find(item=>item.id===subpath.id)!.closed=true;emit('update',draft);emit('commit',draft);return}
 begin(event,knotId,'anchor',props.path)
}
function handle(event:PointerEvent,knotId:string,key:'inHandle'|'outHandle'):void{if(event.button===0&&props.mode!=='path'&&!props.disabled&&!props.spacePan&&!drag)begin(event,knotId,key,props.path)}
function move(event:PointerEvent):void {
 const current=drag;if(!current||event.pointerId!==current.pointer)return
 const p=point(event)
 if(current.mode==='path'){const dx=p[0]-current.start[0],dy=p[1]-current.start[1];publish(mapVectorPath(current.initial,([x,y])=>[x+dx,y+dy]))}
 else if(current.mode==='anchor'){const knot=current.initial.subpaths.flatMap(subpath=>subpath.knots).find(knot=>knot.id===current.knotId)!;publish(moveVectorKnot(current.initial,current.knotId,[knot.point[0]+p[0]-current.start[0],knot.point[1]+p[1]-current.start[1]]))}
 else publish(setVectorKnotHandle(current.mode==='create'?current.draft:current.initial,current.knotId,current.mode==='inHandle'?'inHandle':'outHandle',p,current.mode==='create'||!event.altKey))
 event.preventDefault()
}
function end(cancel=false):void {
 const current=drag;if(!current)return;drag=undefined
 if(current.target.hasPointerCapture(current.pointer))current.target.releasePointerCapture(current.pointer)
 if(cancel){if(!current.initial.subpaths.some(subpath=>subpath.knots.some(knot=>knot.id===selected.value))){selected.value=undefined;emit('selected',undefined)}emit('update',current.initial);emit('cancel')}emit('interaction',false)
 if(!cancel)emit('commit',current.draft)
}
function finish(event:PointerEvent):void{if(event.pointerId!==drag?.pointer)return;move(event);end()}
function cancelPointer(event:PointerEvent):void{if(event.pointerId===drag?.pointer)end(true)}
function keydown(event:KeyboardEvent):void {
 if(props.disabled||props.spacePan||(event.target as HTMLElement)?.closest?.('input,textarea,select,[contenteditable="true"]'))return
 if(event.key==='Escape'){event.preventDefault();if(drag)end(true);else emit('cancel')}
 if((event.key==='Delete'||event.key==='Backspace')&&props.mode==='path'){event.preventDefault();event.stopImmediatePropagation();if(drag)end(true);else if(props.path.subpaths.length)emit('deletePath');return}
 if((event.key==='Delete'||event.key==='Backspace')&&selected.value&&!drag){event.preventDefault();event.stopImmediatePropagation();deleteSelected()}
}
function blur():void{end(true)}
const canSplitSelected=computed(()=>props.mode!=='path'&&props.path.subpaths.some(subpath=>{const index=subpath.knots.findIndex(knot=>knot.id===selected.value);return index>=0&&(subpath.closed||index<subpath.knots.length-1)}))
function splitSelected():void {
 if(!selected.value||props.disabled||drag||!canSplitSelected.value)return
 const subpath=props.path.subpaths.find(subpath=>subpath.knots.some(knot=>knot.id===selected.value));if(!subpath)return
 const draft=splitVectorSegment(props.path,subpath.id,selected.value,.5,uid());emit('update',draft);emit('commit',draft)
}
function deleteSelected():void {
 if(!selected.value||props.mode==='path'||props.disabled||drag)return
 if(!props.path.subpaths.some(subpath=>subpath.knots.some(knot=>knot.id===selected.value))){selected.value=undefined;emit('selected',undefined);return}
 const draft=deleteVectorKnot(props.path,selected.value);selected.value=undefined;emit('selected',undefined);emit('update',draft);emit('commit',draft)
}
function convertSelected():void {
 if(!selected.value||props.mode==='path'||props.disabled||drag)return
 const subpath=props.path.subpaths.find(subpath=>subpath.knots.some(knot=>knot.id===selected.value));if(!subpath)return
 const index=subpath.knots.findIndex(knot=>knot.id===selected.value),knot=subpath.knots[index];let draft:VectorPath
 if(knot.inHandle||knot.outHandle){draft=setVectorKnotHandle(props.path,knot.id,'outHandle',undefined,true)}
 else{const previous=subpath.knots[index>0?index-1:subpath.closed?subpath.knots.length-1:0].point,next=subpath.knots[index+1<subpath.knots.length?index+1:subpath.closed?0:index].point,dx=(next[0]-previous[0])/6,dy=(next[1]-previous[1])/6;draft=setVectorKnotHandle(props.path,knot.id,'outHandle',[knot.point[0]+dx,knot.point[1]+dy],true)}
 emit('update',draft);emit('commit',draft)
}
watch(()=>[props.mode,props.disabled,props.spacePan],()=>{end(true);if(props.mode==='path'){selected.value=undefined;emit('selected',undefined)}},{flush:'sync'})
watch(()=>props.path,()=>{if(selected.value&&!props.path.subpaths.some(subpath=>subpath.knots.some(knot=>knot.id===selected.value))){selected.value=undefined;emit('selected',undefined)}})
defineExpose({finish:end,splitSelected,deleteSelected,convertSelected,canSplitSelected})
onMounted(()=>{window.addEventListener('blur',blur);document.addEventListener('keydown',keydown,true)})
onBeforeUnmount(()=>{window.removeEventListener('blur',blur);document.removeEventListener('keydown',keydown,true);end(true)})
</script>
<template>
 <svg ref="svg" class="vector-path-overlay" :class="{black:mode==='path'}" :width="width*zoom" :height="height*zoom" :viewBox="`0 0 ${width} ${height}`" :style="{pointerEvents:disabled||spacePan?'none':'auto'}" @pointerdown.stop="add" @pointermove.stop="move" @pointerup.stop="finish" @pointercancel.stop="cancelPointer" @lostpointercapture.stop="cancelPointer">
  <rect width="100%" height="100%" fill="transparent"/>
  <path :d="d" fill="transparent" :fill-rule="path.fillRule" stroke="#58a6ff" :stroke-width="1.5/zoom" :pointer-events="mode==='path'?'all':'none'" @pointerdown.stop="pathStart"/>
  <g v-for="knot in (mode==='path'?[]:knots)" :key="knot.id">
   <template v-for="key in (['inHandle','outHandle'] as const)" :key="key"><line v-if="knot[key]" :x1="knot.point[0]" :y1="knot.point[1]" :x2="knot[key]![0]" :y2="knot[key]![1]" stroke="#58a6ff" :stroke-width="1/zoom" pointer-events="none"/><circle v-if="knot[key]" :cx="knot[key]![0]" :cy="knot[key]![1]" :r="radius*.8" fill="white" stroke="#58a6ff" :stroke-width="1/zoom" @pointerdown.stop="handle($event,knot.id,key)"/></template>
   <rect :x="knot.point[0]-radius" :y="knot.point[1]-radius" :width="radius*2" :height="radius*2" :fill="selected===knot.id?'#58a6ff':'white'" stroke="#12579b" :stroke-width="1/zoom" @pointerdown.stop="anchor($event,knot.id)"/>
  </g>
 </svg>
</template>
<style scoped>
.vector-path-overlay{position:absolute;left:0;top:0;z-index:8;overflow:visible;touch-action:none;cursor:crosshair}.vector-path-overlay rect,.vector-path-overlay circle{cursor:move}.vector-path-overlay.black{cursor:default}.vector-path-overlay.black path{cursor:move}
</style>
