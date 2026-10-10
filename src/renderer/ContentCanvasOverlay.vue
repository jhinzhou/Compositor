<script setup lang="ts">
import { useI18n } from './i18n'
const { t, tm } = useI18n()
import { computed, nextTick, onBeforeUnmount, ref, toRaw, watch } from 'vue'
import {commandForKey} from './command-shortcuts'
import {TEXT_EDIT_COMMANDS} from './text-edit-commands'
import type {Layer,Transform} from '../shared/contracts'
import type {ContentEdit} from './ContentTools.vue'
import {defaultTextStyle,defaultShapeStyle,defaultEditorTextStyle,renderTextPNG,renderShapePNG,validateTextStyle,validateShapeStyle,replaceTextCharacters,textSpans,textFontWarnings,measureTextFrame,textFontCSS,resolvedFont,type TextStyle,type ShapeStyle} from './content-raster'
import {resizedParagraphBox,contentRasterTransform} from '../shared/content-transform'
import {dragContentBox,lineContentGeometry,textReplacement,type ContentBox} from './content-interaction'
const props=defineProps<{zoom:number;disabled?:boolean;foreground:string;textShortcutOverrides?:Record<string,string>;shortcutPlatform?:'mac'|'other';commitEdit?:(edit:ContentEdit)=>Promise<boolean>}>()
const emit=defineEmits<{create:[edit:ContentEdit];update:[edit:ContentEdit];error:[message:string];draft:[style:{text?:TextStyle;shape?:ShapeStyle;size:[number,number];layerId?:string}];lease:[busy:boolean];close:[];selection:[range:[number,number]];preview:[value:{raster:import('./content-raster').ContentRaster;transform:Transform;layerId?:string}|undefined]}>()
const box=ref<ContentBox>(),editing=ref(false),composing=ref(false),kind=ref<'text'|'shape'>('text'),text=ref(defaultEditorTextStyle()),shape=ref(defaultShapeStyle()),layer=ref<Layer>(),element=ref<HTMLElement>(),busy=ref(false),rotation=ref(0)
const handles:[number,number][]=[[0,0],[.5,0],[1,0],[0,.5],[1,.5],[0,1],[.5,1],[1,1]]
let resize:{start:[number,number];transform:Transform;source:[number,number];handle:[number,number];pointerId:number}|undefined,pointFromEvent:((event:PointerEvent)=>[number,number])|undefined
let gesture:{start:[number,number];point:(event:PointerEvent)=>[number,number];pointerId:number;request?:ContentEdit['request']}|undefined,request:ContentEdit['request']
const position=computed(()=>box.value?{left:`${box.value.origin[0]*props.zoom}px`,top:`${box.value.origin[1]*props.zoom}px`,width:`${box.value.size[0]*props.zoom}px`,height:`${box.value.size[1]*props.zoom}px`,transform:`rotate(${rotation.value}deg)`}:{}),spans=computed(()=>textSpans(text.value)),warnings=computed(()=>editing.value?textFontWarnings(text.value):[])
let previewTicket=0
const textDisplayScale=computed(()=>{const source=text.value.boxSize??measureTextFrame(text.value).size;return box.value?[box.value.size[0]/source[0],box.value.size[1]/source[1]]:[1,1]})
function publish():void{
 if(!box.value)return
 emit('draft',{text:kind.value==='text'?structuredClone(toRaw(text.value)):undefined,shape:kind.value==='shape'?structuredClone(toRaw(shape.value)):undefined,size:kind.value==='text'?(text.value.boxSize??measureTextFrame(text.value).size):[...box.value.size],layerId:layer.value?.id})
 if(kind.value!=='text')return
 const ticket=++previewTicket,style=structuredClone(toRaw(text.value)),transform=currentTransform(),layerId=layer.value?.id
 void renderTextPNG(style).then(raster=>{if(ticket===previewTicket&&box.value)emit('preview',{raster,transform,layerId})}).catch(()=>{/* Missing imported fonts preserve the stored raster until an explicit replacement is selected. */})
}
function start(event:PointerEvent,mode:'text'|'shape',point:(event:PointerEvent)=>[number,number],identity:ContentEdit['request'],existing?:Layer,initial?:{text?:TextStyle;shape?:ShapeStyle}):void {
 if(props.disabled||busy.value)return
 cancel();pointFromEvent=point;request=identity;kind.value=mode;layer.value=existing;rotation.value=existing?.transform.rotation??0;emit('lease',true)
 if(mode==='text'&&existing?.text){try{text.value=validateTextStyle(existing.text);box.value={origin:[...existing.transform.origin],size:[...existing.transform.size]};editing.value=true;publish();void nextTick(()=>{element.value?.focus()});return}catch(error){emit('error',error instanceof Error?error.message:String(error));cancel();return}}
 const color=props.foreground;const rgb=[parseInt(color.slice(1,3),16)/255,parseInt(color.slice(3,5),16)/255,parseInt(color.slice(5,7),16)/255] as [number,number,number];text.value={...defaultEditorTextStyle(),red:rgb[0],green:rgb[1],blue:rgb[2]};shape.value={...defaultShapeStyle(),red:rgb[0],green:rgb[1],blue:rgb[2]}
 if(initial?.text)text.value=validateTextStyle(initial.text);text.value.content='';delete text.value.fontRuns;delete text.value.colorRuns;delete text.value.boxSize;if(initial?.shape)shape.value=validateShapeStyle(initial.shape)
 const first=point(event);box.value={origin:first,size:mode==='text'?[240,100]:[1,1]};gesture={start:first,point,pointerId:event.pointerId,request:identity};window.addEventListener('pointermove',move,true);window.addEventListener('pointerup',up,true);window.addEventListener('pointercancel',canceled,true);window.addEventListener('keydown',creationKey,true);publish();event.preventDefault()
}
function move(event:PointerEvent):void {if(!gesture||event.pointerId!==gesture.pointerId)return;if(kind.value==='shape'&&shape.value.kind==='Line'){const geometry=lineContentGeometry(gesture.start,gesture.point(event),shape.value.lineWidth??1,event.shiftKey);box.value={origin:geometry.origin,size:geometry.size};shape.value.start=geometry.start;shape.value.end=geometry.end}else box.value=dragContentBox(gesture.start,gesture.point(event),kind.value,event.shiftKey,event.altKey);publish();event.preventDefault();event.stopPropagation()}
function removeGesture():void{gesture=undefined;window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',up,true);window.removeEventListener('pointercancel',canceled,true);window.removeEventListener('keydown',creationKey,true)}
function canceled():void{cancel()}
function textCommand(event:KeyboardEvent):string|undefined{return commandForKey(TEXT_EDIT_COMMANDS,props.textShortcutOverrides??{},event,props.shortcutPlatform??(typeof navigator!=='undefined'&&/Mac/.test(navigator.platform)?'mac':'other'))?.id}
function creationKey(event:KeyboardEvent):void{if(textCommand(event)==='cancel-draft'){event.preventDefault();event.stopPropagation();cancel()}}
function up(event:PointerEvent):void{if(!gesture||event.pointerId!==gesture.pointerId)return;const end=gesture.point(event),distance=Math.hypot(end[0]-gesture.start[0],end[1]-gesture.start[1]);if(distance<3&&kind.value==='text'){const frame=measureTextFrame(text.value);box.value={origin:[gesture.start[0]-12,gesture.start[1]-frame.baseline],size:frame.size};delete text.value.boxSize}else box.value=dragContentBox(gesture.start,end,kind.value,event.shiftKey,event.altKey);if(kind.value==='shape'&&distance<.5){event.preventDefault();event.stopPropagation();cancel();return}if(kind.value==='shape'&&shape.value.kind==='Line'){const geometry=lineContentGeometry(gesture.start,end,shape.value.lineWidth??1,event.shiftKey);box.value={origin:geometry.origin,size:geometry.size};shape.value.start=geometry.start;shape.value.end=geometry.end}removeGesture();publish();event.preventDefault();event.stopPropagation();if(kind.value==='text'){if(distance>=3)text.value.boxSize=[...box.value.size];publish();editing.value=true;void nextTick(()=>{element.value?.focus();document.execCommand('selectAll')})}else void commit()}
function currentTransform():Transform {return {...(layer.value?.transform??{rotation:0,flipX:false,flipY:false,sampling:'High quality'}),rotation:rotation.value,origin:[...box.value!.origin],size:[...box.value!.size]}}
function startResize(event:PointerEvent,handle:[number,number]):void{if(!box.value||!pointFromEvent||busy.value)return;const source=text.value.boxSize??measureTextFrame(text.value).size;resize={start:pointFromEvent(event),transform:currentTransform(),source:[...source],handle,pointerId:event.pointerId};text.value.boxSize=[...source];window.addEventListener('pointermove',resizeMove,true);window.addEventListener('pointerup',resizeUp,true);event.preventDefault();event.stopPropagation()}
function resizeMove(event:PointerEvent):void{if(!resize||event.pointerId!==resize.pointerId||!pointFromEvent)return;try{const point=pointFromEvent(event),value=resizedParagraphBox(resize.transform,resize.source,resize.handle,[point[0]-resize.start[0],point[1]-resize.start[1]]);text.value.boxSize=value.size;box.value={origin:value.transform.origin,size:value.transform.size};publish()}catch(error){emit('error',error instanceof Error?error.message:String(error))}event.preventDefault();event.stopPropagation()}
function resizeUp(event?:PointerEvent):void{if(event&&resize&&event.pointerId!==resize.pointerId)return;resize=undefined;window.removeEventListener('pointermove',resizeMove,true);window.removeEventListener('pointerup',resizeUp,true);if(event){event.preventDefault();event.stopPropagation()}}
function syncEditable():void{if(composing.value||!editing.value||!element.value)return;const root=element.value,selection=window.getSelection();let rangeStart:number|undefined,rangeEnd:number|undefined;if(selection?.rangeCount){const range=selection.getRangeAt(0);if(root.contains(range.commonAncestorContainer)){const before=range.cloneRange();before.selectNodeContents(root);before.setEnd(range.startContainer,range.startOffset);rangeStart=before.toString().length;rangeEnd=rangeStart+range.toString().length}}const nodes=spans.value.map(span=>{const node=document.createElement('span');const font=resolvedFont(span.fontName);node.style.fontFamily=textFontCSS(span.fontName);node.style.fontWeight=font.weight;node.style.fontStyle=font.fontStyle;node.style.color=`rgb(${span.color.map(v=>v*255).join(',')})`;node.textContent=span.text;return node});root.replaceChildren(...nodes);if(rangeStart!==undefined&&rangeEnd!==undefined&&selection){const range=document.createRange(),locate=(offset:number):[Node,number]=>{let remaining=Math.min(offset,text.value.content.length);for(const span of nodes){const node=span.firstChild;if(node){if(remaining<=node.textContent!.length)return [node,remaining];remaining-=node.textContent!.length}}return [root,root.childNodes.length]};const start=locate(rangeStart),end=locate(rangeEnd);range.setStart(...start);range.setEnd(...end);selection.removeAllRanges();selection.addRange(range)}}
watch([text,editing],()=>void nextTick(syncEditable),{deep:true})
function rememberSelection():void{const selection=window.getSelection();if(!selection?.rangeCount||!element.value)return;const range=selection.getRangeAt(0);if(!element.value.contains(range.commonAncestorContainer))return;const before=range.cloneRange();before.selectNodeContents(element.value);before.setEnd(range.startContainer,range.startOffset);emit('selection',[before.toString().length,range.toString().length])}
function resizePointText(previousSize:[number,number]):void{if(box.value&&!text.value.boxSize){const transform=contentRasterTransform(currentTransform(),previousSize,measureTextFrame(text.value).size);box.value={origin:transform.origin,size:transform.size}}}
function compositionEnd(event:CompositionEvent):void{composing.value=false;textInput(event)}
function textInput(event:Event):void{const next=(event.currentTarget as HTMLElement).innerText.replace(/\r/g,''),diff=textReplacement(text.value.content,next);try{const previousSize=text.value.boxSize??measureTextFrame(text.value).size;text.value=replaceTextCharacters(text.value,diff.start,diff.length,diff.replacement);resizePointText(previousSize);publish()}catch(error){emit('error',error instanceof Error?error.message:String(error))}}
function updateDraft(value:{text?:TextStyle;shape?:ShapeStyle;size?:[number,number]}):void {
 if(!box.value)return
 if(value.text){const previous=text.value.boxSize??measureTextFrame(text.value).size,old=currentTransform();text.value=validateTextStyle(value.text);const next=text.value.boxSize??measureTextFrame(text.value).size,transform=contentRasterTransform(old,previous,next);box.value={origin:transform.origin,size:transform.size}}
 if(value.shape)shape.value=validateShapeStyle(value.shape)
 if(kind.value==='shape'&&value.size)box.value.size=[...value.size]
 publish()
}
function nudgeText(command:'trackingDown'|'trackingUp'|'leadingDown'|'leadingUp',large=false):void {
 if(!editing.value||busy.value||composing.value)return
 const step=large?10:1,previous=text.value.boxSize??measureTextFrame(text.value).size
 if(command==='trackingDown')text.value.tracking=Math.max(-100,text.value.tracking-step)
 else if(command==='trackingUp')text.value.tracking=Math.min(1000,text.value.tracking+step)
 else {const leading=text.value.leading||text.value.fontSize*1.2;text.value.leading=Math.min(5000,Math.max(1,leading+(command==='leadingDown'?-step:step)))}
 resizePointText(previous);publish()
}
async function commit():Promise<boolean>{
 if(busy.value)return false
 if(!box.value)return true
 if(kind.value==='text'&&!text.value.content.trim()&&!layer.value){cancel();return true}
 busy.value=true
 try{
  const value=kind.value==='text'?await renderTextPNG(structuredClone(toRaw(text.value))):await renderShapePNG(structuredClone(toRaw(shape.value)),[...box.value.size])
  const edit:ContentEdit={name:layer.value?.name??(kind.value==='text'?'Text':shape.value.kind),layerId:layer.value?.id,origin:[...box.value.origin],raster:value,request,...(kind.value==='text'?{transform:currentTransform()}: {})}
  if(props.commitEdit){if(!await props.commitEdit(edit))return false}
  else if(layer.value)emit('update',edit)
  else emit('create',edit)
  editing.value=false;box.value=undefined;previewTicket++;emit('preview',undefined);emit('close');return true
 }catch(error){emit('error',error instanceof Error?error.message:String(error));return false}
 finally{busy.value=false}
}
function cancel():void{previewTicket++;emit('preview',undefined);resizeUp();removeGesture();box.value=undefined;editing.value=false;composing.value=false;layer.value=undefined;emit('lease',false);emit('close')}
function key(event:KeyboardEvent):void{
 if(event.isComposing||composing.value)return
 const command=textCommand(event);if(!command)return
 event.preventDefault();event.stopPropagation()
 if(command==='cancel-draft'){cancel();return}
 if(command==='text:commit'){void commit();return}
 const name=command.slice('text:'.length).replace(/Large$/,'') as 'trackingDown'|'trackingUp'|'leadingDown'|'leadingUp'
 nudgeText(name,command.endsWith('Large'))
}
onBeforeUnmount(cancel)
defineExpose({start,cancel,updateDraft,commit,nudgeText})
</script>
<template><div v-if="box" class="content-canvas-box" :style="position" :class="{editing}" data-testid="content-canvas-box" @pointerdown.stop><template v-if="editing"><div ref="element" class="canvas-text-edit" contenteditable="plaintext-only" role="textbox" :aria-label="t('Edit text on canvas')" :style="{fontFamily:textFontCSS(text.fontName),fontWeight:resolvedFont(text.fontName).weight,fontStyle:resolvedFont(text.fontName).fontStyle,width:`${(text.boxSize??measureTextFrame(text).size)[0]*zoom}px`,height:`${(text.boxSize??measureTextFrame(text).size)[1]*zoom}px`,left:`${box.size[0]*zoom/2}px`,top:`${box.size[1]*zoom/2}px`,transform:`translate(-50%,-50%) scale(${textDisplayScale[0]*(layer?.transform.flipX?-1:1)},${textDisplayScale[1]*(layer?.transform.flipY?-1:1)})`,fontSize:`${text.fontSize*zoom}px`,lineHeight:`${(text.leading||text.fontSize*1.2)*zoom}px`,letterSpacing:`${text.tracking*zoom}px`,textAlign:text.alignment.toLowerCase() as 'left'|'center'|'right',padding:`${12*zoom}px`}" @input="textInput" @compositionstart="composing=true" @compositionend="compositionEnd" @keydown="key" @keyup="rememberSelection" @mouseup="rememberSelection"></div><button v-for="(handle,index) in handles" :key="index" class="text-resize-handle" :aria-label="t('Resize text box {index}', {index})" :style="{left:`${handle[0]*100}%`,top:`${handle[1]*100}%`}" @pointerdown.stop="startResize($event,handle)"/><div class="text-controls" contenteditable="false"><button :disabled="busy" @click="commit">{{ t('Apply text') }}</button><button :disabled="busy" @click="cancel">{{ t('Cancel') }}</button><p v-for="warning in warnings" :key="warning" role="status">{{tm(warning)}}</p></div></template><svg v-else-if="kind==='shape'" width="100%" height="100%" :viewBox="`0 0 ${box.size[0]} ${box.size[1]}`" class="drawn-shape"><ellipse v-if="shape.kind==='Ellipse'" :cx="box.size[0]/2" :cy="box.size[1]/2" :rx="box.size[0]/2" :ry="box.size[1]/2" :fill="`rgb(${[shape.red,shape.green,shape.blue].map(v=>v*255).join(',')})`"/><rect v-else-if="shape.kind==='Rectangle'" :width="box.size[0]" :height="box.size[1]" :rx="Math.min(shape.cornerRadius,box.size[0]/2,box.size[1]/2)" :fill="`rgb(${[shape.red,shape.green,shape.blue].map(v=>v*255).join(',')})`"/><line v-else :x1="(shape.start?.[0]??0)*box.size[0]" :y1="(shape.start?.[1]??0)*box.size[1]" :x2="(shape.end?.[0]??1)*box.size[0]" :y2="(shape.end?.[1]??1)*box.size[1]" :stroke="`rgb(${[shape.red,shape.green,shape.blue].map(v=>v*255).join(',')})`" stroke-linecap="round" :stroke-width="shape.lineWidth||1"/></svg><div v-if="!editing" class="creation-label">{{Math.round(box.size[0])}} × {{Math.round(box.size[1])}} px</div></div></template>
<style scoped>
.content-canvas-box{position:absolute;z-index:7;border:1px dashed #0a84ff;box-sizing:content-box;pointer-events:none;transform-origin:center}.content-canvas-box.editing{pointer-events:auto}.canvas-text-edit{position:absolute;color:transparent;-webkit-text-fill-color:transparent;caret-color:#fff;transform-origin:center;width:100%;height:100%;box-sizing:border-box;overflow:hidden;outline:none;white-space:pre-wrap;overflow-wrap:break-word;background:transparent}.text-resize-handle{position:absolute;width:9px;height:9px;padding:0;background:white;border:1px solid #1688ff;transform:translate(-50%,-50%);cursor:nwse-resize;z-index:2}.text-controls{position:absolute;top:100%;left:0;margin-top:6px;min-width:260px;display:flex;gap:6px;flex-wrap:wrap;padding:7px;border-radius:5px;background:#303030;color:white;font:12px sans-serif;box-shadow:0 4px 16px #0009}.text-controls button{background:#444;color:white;border:0;padding:6px 10px;border-radius:4px;cursor:pointer}.text-controls p{width:100%;margin:0;color:#ffd78b;line-height:1.4}.drawn-shape{opacity:1;pointer-events:none}.creation-label{position:absolute;top:100%;left:0;padding:3px;color:white;background:#303030;font:12px sans-serif;white-space:nowrap}
</style>
