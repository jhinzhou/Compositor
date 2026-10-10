<script setup lang="ts">
import { useI18n } from './i18n'
const { t, tm } = useI18n()
import {EFFECT_KINDS,EFFECT_NAMES,type EffectKind,type LayerEffects} from '../shared/layer-effects'
defineProps<{effects:LayerEffects}>()
const emit=defineEmits<{drag:[kind:EffectKind,event:DragEvent];edit:[kind:EffectKind]}>()
</script>
<template><span class="layer-effect-badges"><button v-for="kind in EFFECT_KINDS.filter(kind=>effects[kind])" :key="kind" draggable="true" :aria-label="t('Select {effect} effect', {effect:t(EFFECT_NAMES[kind])})" :title="t('{effect} · Option/Alt-drag to copy to another layer · Click to edit', {effect:t(EFFECT_NAMES[kind])})" @dragstart.stop="emit('drag',kind,$event)" @click.stop="emit('edit',kind)">{{t(EFFECT_NAMES[kind])}}</button></span></template>
<style scoped>.layer-effect-badges{display:flex;flex-wrap:wrap;gap:2px;margin-top:3px}.layer-effect-badges button{font:9px system-ui;padding:1px 4px;border-radius:3px;color:#b9cfe7;background:#344050;cursor:grab;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}</style>
