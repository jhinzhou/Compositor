<script setup lang="ts">
import {computed,onBeforeUnmount,onMounted,toRaw,watch,ref,nextTick} from 'vue'
import {useI18n} from './i18n'
import {cropCorners,straightenAngle,validatePerspectiveCrop,mapCropPoint,perspectiveCropMatrix,type CropRectangle,type CropCorners,type CropPoint} from '../shared/crop-projective'
import {rotateVector} from './rotated-view'
import {constrainCropCorner,clockwiseCropPoints,sampleCropFeedback} from './crop-overlay-input'
const {t}=useI18n()
const props=defineProps<{mode:'straighten'|'perspective';pointMode?:boolean;inclusiveDrag?:boolean;draft:CropRectangle;corners?:CropCorners;previewCorners?:CropCorners;line?:[CropPoint,CropPoint];zoom:number;viewAngle:number;workspace:CropRectangle;disabled?:boolean;spacePan?:boolean;width:number;height:number;outputWidth:number;outputHeight:number;sourceCanvas?:HTMLCanvasElement;sourceRegion?:CropRectangle}>()
const emit=defineEmits<{corners:[CropCorners];line:[[CropPoint,CropPoint]];interaction:[boolean];cancel:[];ready:[boolean]}>()
const points=computed(()=>props.corners??cropCorners(props.draft)),box=computed(()=>props.workspace),preview=ref<HTMLCanvasElement>()
const pointDraft=ref<CropPoint[]>([]),pointComplete=ref(false),hoverPoint=ref<CropPoint>()
const ready=computed(()=>props.mode!=='perspective'||!props.pointMode||pointComplete.value)
const pendingPath=computed(()=>pointDraft.value.concat(hoverPoint.value?[hoverPoint.value]:[]).map(p=>p.join(' ')).join(' '))
watch(ready,value=>emit('ready',value),{immediate:true,flush:'sync'})
let drag:{pointer:number;target:Element;start:CropPoint;initial:CropCorners;mode:'create'|'point'|'move'|number;lineStart?:CropPoint}|undefined
function point(e:PointerEvent):CropPoint{const rect=(e.currentTarget as Element).closest('.crop-geometry-overlay')!.getBoundingClientRect(),width=box.value.width*props.zoom,height=box.value.height*props.zoom,delta=rotateVector({x:(e.clientX-(rect.left+rect.width/2))/props.zoom,y:(e.clientY-(rect.top+rect.height/2))/props.zoom},-props.viewAngle);return [box.value.x+width/props.zoom/2+delta.x,box.value.y+height/props.zoom/2+delta.y]}
function resetPoints():void{pointDraft.value=[];pointComplete.value=false;hoverPoint.value=undefined}
function start(event:PointerEvent,mode:'create'|'move'|number):void{if(event.button||props.disabled||props.spacePan||drag)return;const target=event.currentTarget as Element,p=point(event);let nextMode:'create'|'point'|'move'|number=mode;if(props.mode==='perspective'&&props.pointMode&&mode==='create'){if(pointComplete.value)resetPoints();nextMode='point';hoverPoint.value=p}drag={pointer:event.pointerId,target,start:p,initial:structuredClone(toRaw(points.value)),mode:nextMode,lineStart:props.mode==='straighten'?p:undefined};target.setPointerCapture(event.pointerId);emit('interaction',true);event.preventDefault()}
function move(event:PointerEvent):void{if(event.pointerId!==drag?.pointer)return;const p=point(event),d=drag;if(d.mode==='point'){hoverPoint.value=p;event.preventDefault();return}if(props.mode==='straighten'){try{straightenAngle(d.lineStart!,p);emit('line',[[...d.lineStart!],p])}catch{};return}const delta:CropPoint=[p[0]-d.start[0],p[1]-d.start[1]];let next:CropCorners
 if(d.mode==='create')next=cropCorners({x:Math.min(d.start[0],p[0]),y:Math.min(d.start[1],p[1]),width:Math.max(1,Math.abs(delta[0])+(props.inclusiveDrag?1:0)),height:Math.max(1,Math.abs(delta[1])+(props.inclusiveDrag?1:0))})
 else if(d.mode==='move')next=d.initial.map(c=>[c[0]+delta[0],c[1]+delta[1]]) as CropCorners
 else{next=structuredClone(d.initial);next[d.mode]=constrainCropCorner(d.initial[d.mode],p,event.shiftKey)}
 try{validatePerspectiveCrop(next,props.outputWidth,props.outputHeight);emit('corners',next)}catch{}
 event.preventDefault()
}
function end(cancel=false):void{const d=drag;drag=undefined;if(d){if(d.target.hasPointerCapture(d.pointer))d.target.releasePointerCapture(d.pointer);emit('interaction',false)}if(cancel&&(d||pointDraft.value.length||pointComplete.value)){resetPoints();emit('cancel')}}
function finish(e:PointerEvent):void{if(e.pointerId===drag?.pointer){if(drag.mode==='point'){const candidate=pointDraft.value.concat([point(e)]);if(candidate.length<4)pointDraft.value=candidate;else{const corners=clockwiseCropPoints(candidate,props.outputWidth,props.outputHeight);if(corners){pointDraft.value=candidate;emit('corners',corners);pointComplete.value=true}}hoverPoint.value=undefined;end()}else{move(e);end()}}}
function cancel(e:PointerEvent):void{if(e.pointerId===drag?.pointer)end(true)}
function keydown(e:KeyboardEvent):void{if(e.key==='Enter'&&props.mode==='perspective'&&props.pointMode&&!ready.value){e.preventDefault();e.stopImmediatePropagation();return}if(e.key==='Escape'&&(drag||props.mode==='perspective'&&props.pointMode)){e.preventDefault();e.stopImmediatePropagation();const hadPending=!!drag||pointDraft.value.length>0||pointComplete.value;end(true);resetPoints();if(!hadPending)emit('cancel')}else if(e.key==='Enter'&&drag)end()}
function blur():void{end(true)}
function componentFinish(cancel=false):void{end(cancel);resetPoints()}
defineExpose({finish:componentFinish})
watch(()=>[props.mode,props.pointMode],()=>{end(true);resetPoints()},{flush:'sync'})
onMounted(()=>{document.addEventListener('keydown',keydown,true);window.addEventListener('blur',blur)})
onBeforeUnmount(()=>{document.removeEventListener('keydown',keydown,true);window.removeEventListener('blur',blur);end(true);resetPoints()})
const path=computed(()=>`M${points.value.map(p=>p.join(' ')).join('L')}Z`)
const grid=computed(()=>{try{const h=perspectiveCropMatrix(points.value,props.outputWidth,props.outputHeight);return [1/3,2/3].flatMap(v=>[[mapCropPoint(h,v,0),mapCropPoint(h,v,1)],[mapCropPoint(h,0,v),mapCropPoint(h,1,v)]])}catch{return []}})
// An SDR feedback thumbnail reads only the already displayed canvas. It never
// becomes a source asset or participates in the precision-preserving commit.
async function drawPreview():Promise<void>{await nextTick();const target=preview.value,source=props.sourceCanvas,region=props.sourceRegion;if(!target||!source||!region||!source.width||!source.height||source.width*source.height>16_000_000||props.mode!=='perspective'||!ready.value||region.width<=0||region.height<=0)return;try{const w=Math.max(1,Math.round(props.outputWidth*Math.min(1,200/props.outputWidth,160/props.outputHeight))),h=Math.max(1,Math.round(props.outputHeight*Math.min(1,200/props.outputWidth,160/props.outputHeight))),map=perspectiveCropMatrix(props.previewCorners??points.value,props.outputWidth,props.outputHeight),ctx=target.getContext('2d'),src=source.getContext('2d')?.getImageData(0,0,source.width,source.height);if(!ctx||!src)return;target.width=w;target.height=h;const out=ctx.createImageData(w,h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const [dx,dy]=mapCropPoint(map,(x+.5)/w,(y+.5)/h),sx=(dx-region.x)*source.width/region.width,sy=(dy-region.y)*source.height/region.height;out.data.set(sampleCropFeedback(src.data,source.width,source.height,sx,sy),(y*w+x)*4)}ctx.putImageData(out,0,0)}catch{}}
watch(()=>[props.corners,props.previewCorners,props.outputWidth,props.outputHeight,props.sourceRegion,props.sourceCanvas,props.mode,props.pointMode,pointComplete.value],drawPreview,{deep:true,immediate:true})
</script>
<template>
 <svg class="crop-geometry-overlay" :class="{disabled:disabled||spacePan}" :style="{left:`${box.x*zoom}px`,top:`${box.y*zoom}px`}" :width="box.width*zoom" :height="box.height*zoom" :viewBox="`${box.x} ${box.y} ${box.width} ${box.height}`" :aria-label="t(mode==='straighten'?'Draw straighten reference line':'Perspective Crop handles')" @pointerdown.stop="start($event,'create')" @pointermove.stop="move" @pointerup.stop="finish" @pointercancel.stop="cancel" @lostpointercapture.stop="cancel">
  <rect :x="box.x" :y="box.y" :width="box.width" :height="box.height" fill="transparent"/>
  <template v-if="mode==='perspective'&&ready&&corners"><path :d="`M${box.x} ${box.y}h${box.width}v${box.height}h${-box.width}Z `+path" fill="black" fill-opacity=".6" fill-rule="evenodd" pointer-events="none"/><path :d="path" fill="transparent" stroke="white" vector-effect="non-scaling-stroke" @pointerdown.stop="start($event,'move')"/><line v-for="(pair,i) in grid" :key="'grid'+i" :x1="pair[0][0]" :y1="pair[0][1]" :x2="pair[1][0]" :y2="pair[1][1]" stroke="#ffffff90" vector-effect="non-scaling-stroke" pointer-events="none"/><circle v-for="(p,i) in points" :key="i" :cx="p[0]" :cy="p[1]" :r="7/zoom" fill="white" stroke="#161616" vector-effect="non-scaling-stroke" role="button" :aria-label="t('Perspective corner {number}',{number:i+1})" @pointerdown.stop="start($event,i)"/></template>
  <template v-else-if="mode==='perspective'&&pointMode"><polyline :points="pendingPath" fill="none" stroke="#0a84ff" vector-effect="non-scaling-stroke" pointer-events="none"/><circle v-for="(p,i) in pointDraft" :key="i" :cx="p[0]" :cy="p[1]" :r="4/zoom" fill="#0a84ff" stroke="white" vector-effect="non-scaling-stroke" pointer-events="none"/></template>
  <template v-else-if="line"><line :x1="line[0][0]" :y1="line[0][1]" :x2="line[1][0]" :y2="line[1][1]" stroke="#0a84ff" stroke-width="2" vector-effect="non-scaling-stroke" pointer-events="none"/><circle v-for="(p,i) in line" :key="i" :cx="p[0]" :cy="p[1]" :r="4/zoom" fill="white" pointer-events="none"/><rect :x="draft.x" :y="draft.y" :width="draft.width" :height="draft.height" fill="none" stroke="white" vector-effect="non-scaling-stroke" pointer-events="none"/></template>
 </svg>
 <div v-if="mode==='perspective'" class="crop-feedback"><span v-if="pointMode&&!ready">{{t('Click four corners clockwise: top-left, top-right, bottom-right, bottom-left')}} · {{pointDraft.length}} / 4</span><template v-else-if="corners"><canvas ref="preview"/><span>{{t('SDR geometry preview')}} · {{outputWidth}} × {{outputHeight}} px</span></template><span v-else>{{t('Drag a rectangle, then adjust its four corners')}}</span></div>
</template>
<style scoped>
.crop-geometry-overlay{position:absolute;z-index:8;overflow:visible;touch-action:none;cursor:crosshair}.crop-geometry-overlay.disabled{pointer-events:none}.crop-geometry-overlay circle{cursor:move}.crop-feedback{position:absolute;right:12px;bottom:12px;z-index:7;display:flex;flex-direction:column;gap:5px;padding:6px;background:#252525;border:1px solid #666;pointer-events:none;max-width:220px;font-size:10px}.crop-feedback canvas{max-width:200px;max-height:160px;align-self:center;background:repeating-conic-gradient(#555 0% 25%,#444 0% 50%) 0 /12px 12px}.crop-feedback span{max-width:205px}
</style>
