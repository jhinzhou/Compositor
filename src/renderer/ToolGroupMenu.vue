<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import EditorToolIcon from './EditorToolIcon.vue'
import {useI18n} from './i18n'
import {toolGroup,toolGroupIconProps,toolGroupMenuPosition,type ToolGroupAnchor,type ToolGroupEntry,type ToolGroupId} from './tool-groups'
const props=defineProps<{open:boolean;group:ToolGroupId;selected?:string;anchor:ToolGroupAnchor;disabled?:boolean}>()
const emit=defineEmits<{select:[entry:ToolGroupEntry];close:[]}>()
const {t}=useI18n(),root=ref<HTMLElement>(),active=ref(0)
const checkedId=computed(()=>entries.value.some(entry=>entry.id===props.selected)?props.selected:entries.value[0]?.id)
const entries=computed(()=>toolGroup(props.group).entries)
const viewport=ref({width:0,height:0}),menuSize=ref({width:240,height:0})
const position=computed(()=>toolGroupMenuPosition(props.anchor,{width:menuSize.value.width,height:menuSize.value.height||entries.value.length*34+12},viewport.value))
let focusTicket=0
function updateGeometry():void {
  viewport.value={width:window.innerWidth,height:window.innerHeight}
  if(root.value)menuSize.value={width:root.value.offsetWidth,height:root.value.offsetHeight}
}
function focusActive():void {root.value?.querySelector<HTMLButtonElement>(`[data-entry-index="${active.value}"]`)?.focus()}
function activate(index:number):void {active.value=index;focusActive()}
function choose(index:number):void {
  if(!props.open||props.disabled)return
  const entry=entries.value[index]
  if(!entry)return
  emit('select',entry);emit('close')
}
function keydown(event:KeyboardEvent):void {
  event.stopPropagation()
  if(event.key==='Escape'){event.preventDefault();emit('close');return}
  if(event.key==='Tab'){emit('close');return}
  if(props.disabled)return
  const count=entries.value.length
  if(['ArrowDown','ArrowUp','Home','End','Enter',' '].includes(event.key))event.preventDefault()
  if(event.key==='ArrowDown')activate((active.value+1)%count)
  else if(event.key==='ArrowUp')activate((active.value+count-1)%count)
  else if(event.key==='Home')activate(0)
  else if(event.key==='End')activate(count-1)
  else if(event.key==='Enter'||event.key===' ')choose(active.value)
}
function outside(event:PointerEvent):void {if(props.open&&root.value&&!root.value.contains(event.target as Node))emit('close')}
function windowBlur():void {if(props.open)emit('close')}
watch(()=>[props.open,props.group,props.selected,props.disabled] as const,async()=>{
  const ticket=++focusTicket
  if(!props.open)return
  active.value=Math.max(0,entries.value.findIndex(entry=>entry.id===checkedId.value))
  await nextTick()
  if(ticket!==focusTicket||!props.open)return
  updateGeometry()
  if(!props.disabled)focusActive()
},{immediate:true})
onMounted(()=>{updateGeometry();document.addEventListener('pointerdown',outside);window.addEventListener('resize',updateGeometry);window.addEventListener('blur',windowBlur)})
onBeforeUnmount(()=>{focusTicket++;document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',updateGeometry);window.removeEventListener('blur',windowBlur)})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" ref="root" class="tool-group-menu" role="menu" :aria-label="`${t('Tools')} · ${group}`" :style="{left:`${position.left}px`,top:`${position.top}px`}" @keydown="keydown" @pointerdown.stop @contextmenu.prevent.stop>
      <button v-for="(entry,index) in entries" :key="entry.id" type="button" role="menuitemradio" :aria-checked="checkedId===entry.id" :data-tool-entry="entry.id" :data-entry-index="index" :tabindex="active===index?0:-1" :disabled="disabled" :class="{active:active===index}" @focus="active=index" @mouseenter="active=index" @click.stop="choose(index)">
        <span class="tool-group-check" aria-hidden="true">{{checkedId===entry.id?'✓':''}}</span><EditorToolIcon v-bind="toolGroupIconProps(entry)" :size="18"/><span class="tool-group-label">{{t(entry.label)}}</span><span class="tool-group-letter" aria-hidden="true">{{group}}</span>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.tool-group-menu{position:fixed;z-index:1000;width:240px;max-width:calc(100vw - 12px);max-height:calc(100vh - 12px);overflow:auto;box-sizing:border-box;padding:5px;background:#303030;border:1px solid #606060;border-radius:6px;box-shadow:0 8px 24px #0009;color:#eee;scrollbar-width:thin}.tool-group-menu button{display:flex;align-items:center;width:100%;min-height:34px;gap:7px;text-align:left;background:transparent;color:inherit;border:0;border-radius:3px;padding:5px 8px;font:inherit;font-size:13px;cursor:pointer}.tool-group-menu button.active,.tool-group-menu button:focus-visible{background:#0a64c7;color:#fff;outline:none}.tool-group-menu button:disabled{opacity:.45;cursor:default}.tool-group-check{width:13px;flex:none}.tool-group-menu button>svg{width:18px;height:18px;flex:none}.tool-group-label{min-width:0;white-space:nowrap}.tool-group-label{flex:1}.tool-group-letter{color:#aaa;font-size:11px}.tool-group-menu button.active .tool-group-letter{color:#ddd}
</style>
