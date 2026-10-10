<script setup lang="ts">
import { useI18n } from './i18n'
const { t, tm } = useI18n()
defineProps<{url:string;selected:boolean;enabled:boolean;linked:boolean;name:string}>()
const emit=defineEmits<{select:[event:MouseEvent];link:[];drag:[event:DragEvent]}>()
</script>
<template><span class="mask-cell"><button class="mask-link" :aria-label="t(linked?'Unlink layer mask':'Link layer mask')" @click.stop="emit('link')">{{linked?'⛓':'·'}}</button><button draggable="true" @dragstart.stop="emit('drag',$event)" class="mask-thumbnail" :class="{active:selected,disabled:!enabled}" :aria-label="t('Select {name} mask', {name})" :title="t('Select mask · Shift disable · Alt show gray · Ctrl/Cmd load hidden pixels')" @click.stop="emit('select',$event)"><img draggable="false" :src="url" alt=""><span v-if="!enabled" class="disabled-mark">×</span></button></span></template>
<style scoped>.mask-cell{display:flex;align-items:center;gap:3px;flex-shrink:0}.mask-link{padding:0;width:10px;color:#999;font-size:12px;background:none}.mask-thumbnail{position:relative;overflow:hidden;width:30px;height:24px;border:1px solid #777;border-radius:2px;padding:0;background:#111}.mask-thumbnail.active{border:2px solid #0a84ff}.mask-thumbnail img{width:100%;height:100%;object-fit:contain;image-rendering:auto}.disabled-mark{position:absolute;inset:0;color:#ff4b52;font-size:29px;line-height:19px;pointer-events:none;text-shadow:0 0 1px black}</style>
