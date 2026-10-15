<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import type {EditAction} from '../shared/contracts'
import {NAMED_SELECTION_LIMITS,namedSelectionNameSchema,type NamedSelection,type SelectionCombine} from '../shared/named-selections'
import {useI18n} from './i18n'
const {t}=useI18n()
const props=withDefaults(defineProps<{selections?:NamedSelection[];hasSelection?:boolean;disabled?:boolean}>(),{selections:()=>[],hasSelection:false,disabled:false})
const emit=defineEmits<{action:[action:EditAction]}>()
const selected=ref(''),name=ref(''),rename=ref(''),overwrite=ref(false),operation=ref<SelectionCombine>('replace')
const validName=computed(()=>namedSelectionNameSchema.safeParse(name.value).success),validRename=computed(()=>namedSelectionNameSchema.safeParse(rename.value).success)
const existing=computed(()=>props.selections.some(channel=>channel.name===name.value.trim().normalize('NFC')))
const current=computed(()=>props.selections.find(channel=>channel.name===selected.value))
watch(()=>props.selections,channels=>{if(!channels.some(channel=>channel.name===selected.value)){selected.value=channels[0]?.name??'';rename.value=selected.value}},{immediate:true})
function choose(channel:NamedSelection):void{selected.value=channel.name;rename.value=channel.name}
function save():void{const parsed=namedSelectionNameSchema.safeParse(name.value);if(parsed.success&&props.hasSelection&&(!existing.value||overwrite.value))emit('action',{type:'selection.save_named',name:parsed.data,overwrite:overwrite.value})}
function load():void{if(current.value)emit('action',{type:'selection.load_named',name:current.value.name,operation:operation.value})}
function renameSelection():void{const parsed=namedSelectionNameSchema.safeParse(rename.value);if(current.value&&parsed.success){emit('action',{type:'selection.rename_named',name:current.value.name,newName:parsed.data});selected.value=parsed.data}}
</script>
<template>
 <section class="named-selections" :aria-label="t('Named selections')">
  <header><strong>{{t('Named selections')}}</strong><span>{{selections.length}} / {{NAMED_SELECTION_LIMITS.maxCount}}</span></header>
  <p>{{t('Save grayscale coverage including feathered edges. Named selections follow canvas edits and stay in the project.')}}</p>
  <fieldset :disabled="disabled">
   <form @submit.prevent="save"><label>{{t('Selection name')}}<input v-model="name" maxlength="128" :placeholder="t('Name this selection')"></label>
    <label v-if="existing" class="checkbox"><input v-model="overwrite" type="checkbox">{{t('Overwrite existing selection')}}</label>
    <button :disabled="!hasSelection||!validName||existing&&!overwrite||!existing&&selections.length>=NAMED_SELECTION_LIMITS.maxCount" type="submit">{{t('Save named selection')}}</button>
   </form>
   <p v-if="!hasSelection" class="empty">{{t('Create a selection to save it.')}}</p>
   <ul v-if="selections.length" :aria-label="t('Saved selections')"><li v-for="channel in selections" :key="channel.name"><button :class="{selected:selected===channel.name}" :aria-pressed="selected===channel.name" :title="channel.name" @click="choose(channel)"><span>{{channel.name}}</span><small>{{channel.width}} × {{channel.height}}</small></button></li></ul>
   <p v-else class="empty">{{t('No saved selections yet.')}}</p>
   <template v-if="current"><label>{{t('Load operation')}}<select v-model="operation"><option value="replace">{{t('Replace selection')}}</option><option value="add">{{t('Add to selection')}}</option><option value="subtract">{{t('Subtract from selection')}}</option><option value="intersect">{{t('Intersect with selection')}}</option></select></label>
    <div class="buttons"><button @click="load">{{t('Load named selection')}}</button><button @click="emit('action',{type:'selection.delete_named',name:current.name})">{{t('Delete named selection')}}</button></div>
    <form @submit.prevent="renameSelection"><label>{{t('New selection name')}}<input v-model="rename" maxlength="128"></label><button type="submit" :disabled="!validRename||rename.trim().normalize('NFC')===current.name||selections.some(channel=>channel.name!==current?.name&&channel.name===rename.trim().normalize('NFC'))">{{t('Rename named selection')}}</button></form>
   </template>
  </fieldset>
 </section>
</template>
<style scoped>
.named-selections{font-size:11px;border-top:1px solid #444;margin-top:12px;padding-top:10px}.named-selections header{display:flex;justify-content:space-between;gap:8px}.named-selections header span,.named-selections p{color:#aaa}.named-selections p{line-height:1.5}.named-selections fieldset{padding:0;border:0;min-width:0}.named-selections label{display:flex;flex-direction:column;gap:5px;margin:8px 0}.named-selections input,.named-selections select{box-sizing:border-box;min-width:0;width:100%;background:#202020;color:#ddd;border:1px solid #555;border-radius:4px;padding:6px;font-size:11px}.named-selections input:not([type=checkbox]),.named-selections select{height:32px;min-height:32px;line-height:18px}.named-selections .checkbox{flex-direction:row;align-items:center}.checkbox input{width:16px;height:16px;padding:0;flex:none}.named-selections button{font-size:11px;background:#343434;color:#ddd;border:1px solid #555;border-radius:4px;padding:6px 8px}.named-selections button:disabled{opacity:.45}.named-selections ul{list-style:none;margin:10px 0;padding:0;max-height:170px;overflow:auto}.named-selections li+li{margin-top:4px}.named-selections li button{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;text-align:left}.named-selections li span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.named-selections li small{white-space:nowrap;color:#aaa}.named-selections .selected{background:#254f78;border-color:#368be6}.buttons{display:flex;gap:5px;flex-wrap:wrap}.empty{font-style:italic}
</style>
