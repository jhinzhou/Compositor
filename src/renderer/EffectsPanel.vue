<script setup lang="ts">
import CommitInput from './CommitInput.vue'
import { computed, ref, watch } from 'vue'
import { defaultEffect, EFFECT_KINDS, EFFECT_NAMES, validateLayerEffects, type EffectKind, type LayerEffects } from '../shared/layer-effects'

const props = defineProps<{ effects?: unknown; disabled?: boolean; layerId?: string;initialKind?:EffectKind }>()
const emit = defineEmits<{ preview: [effects: LayerEffects | null]; commit: [effects: LayerEffects | null]; cancel: []; error: [message: string] }>()
const effects = ref<LayerEffects>({}), selected = ref<EffectKind>('stroke'), live = ref(true)
const current = computed(() => effects.value[selected.value])
const hasSize = computed(() => ['stroke', 'outerGlow', 'innerGlow'].includes(selected.value)), hasShadow = computed(() => ['shadow', 'innerShadow'].includes(selected.value))
const color = computed({
  get: () => `#${[current.value?.red ?? 0, current.value?.green ?? 0, current.value?.blue ?? 0].map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('')}`,
  set: value => { if (current.value) { current.value.red = parseInt(value.slice(1, 3), 16) / 255; current.value.green = parseInt(value.slice(3, 5), 16) / 255; current.value.blue = parseInt(value.slice(5, 7), 16) / 255 } }
})
function normalized(): LayerEffects | null { const result = validateLayerEffects(effects.value); return EFFECT_KINDS.some(kind => !!result[kind]) ? result : null }
function preview(): void { try { emit('preview', live.value ? normalized() : null) } catch (error) { emit('error', error instanceof Error ? error.message : String(error)) } }
watch(() => [props.layerId, JSON.stringify(props.effects)], () => {
  try { effects.value = validateLayerEffects(props.effects ?? {}) }
  catch (error) { effects.value = {}; emit('error', error instanceof Error ? error.message : String(error)) }
}, { immediate: true })
watch(()=>props.initialKind,kind=>{if(kind)add(kind)},{immediate:true})
watch(effects, preview, { deep: true }); watch(live, preview)
function add(kind: EffectKind): void { effects.value = validateLayerEffects({ ...effects.value, [kind]: effects.value[kind] ?? defaultEffect(kind) }); selected.value = kind }
function parameter(field:'opacity'|'size'|'angle'|'distance'|'blur',raw:string):void {if(!current.value||!raw.trim()||!Number.isFinite(Number(raw)))return;(current.value as Record<string,unknown>)[field]=Number(raw)}
defineExpose({commit,cancel})
function remove(): void { delete effects.value[selected.value] }
function commit(): void { try { emit('commit', normalized()) } catch (error) { emit('error', error instanceof Error ? error.message : String(error)) } }
function cancel(): void { emit('preview', null); emit('cancel') }
</script>

<template>
  <form class="effects-panel" aria-label="Layer effects" @submit.prevent="commit">
    <fieldset :disabled="disabled">
      <div class="effect-list"><button v-for="kind in EFFECT_KINDS" :key="kind" type="button" :class="{ selected: selected === kind, present: effects[kind] }" @click="add(kind)">{{ EFFECT_NAMES[kind] }}<span v-if="effects[kind]"> ✓</span></button></div>
      <template v-if="current">
        <label class="check"><input :checked="current.enabled !== false" type="checkbox" @change="current.enabled = ($event.target as HTMLInputElement).checked">Enabled</label>
        <label>Color<input v-model="color" type="color"></label>
        <label class="effect-param"><span>Opacity</span><input v-model.number="current.opacity" aria-label="Effect opacity slider" type="range" min="0" max="1" step=".01"><CommitInput :value="Math.round(current.opacity*100)" label="Effect opacity" :min="0" :max="100" :step="1" scrub-label="%" @preview="parameter('opacity',String(Number($event)/100))" @commit="parameter('opacity',String(Number($event)/100))"/></label>
        <label v-if="hasSize" class="effect-param"><span>Size</span><input v-model.number="current.size" aria-label="Effect size slider" type="range" min="0" max="500" step="1"><CommitInput :value="Number(current.size??0)" label="Effect size" :min="0" :max="500" :step="1" scrub-label="px" @preview="parameter('size',$event)" @commit="parameter('size',$event)"/></label>
        <label v-if="selected === 'stroke'" class="check"><input v-model="current.inside" type="checkbox">Inside</label>
        <template v-if="hasShadow"><label class="effect-param"><span>Light angle</span><input v-model.number="current.angle" aria-label="Effect angle slider" type="range" min="-360" max="360" step="1"><CommitInput :value="Number(current.angle??0)" label="Effect angle" :min="-360" :max="360" :step="1" scrub-label="°" @preview="parameter('angle',$event)" @commit="parameter('angle',$event)"/></label><label class="effect-param"><span>Distance</span><input v-model.number="current.distance" aria-label="Effect distance slider" type="range" min="0" max="5000" step="1"><CommitInput :value="Number(current.distance??0)" label="Effect distance" :min="0" :max="5000" :step="1" scrub-label="px" @preview="parameter('distance',$event)" @commit="parameter('distance',$event)"/></label><label class="effect-param"><span>Blur</span><input v-model.number="current.blur" aria-label="Effect blur slider" type="range" min="0" max="500" step="1"><CommitInput :value="Number(current.blur??0)" label="Effect blur" :min="0" :max="500" :step="1" scrub-label="px" @preview="parameter('blur',$event)" @commit="parameter('blur',$event)"/></label></template>
        <button type="button" @click="remove">Remove {{ EFFECT_NAMES[selected] }}</button>
      </template>
      <p v-else>Choose an effect to add it.</p>
      <label class="check"><input v-model="live" type="checkbox">Live preview</label>
      <div class="buttons"><button type="button" @click="cancel">Cancel</button><button type="submit">Apply effects</button></div>
    </fieldset>
  </form>
</template>

<style scoped>
.effects-panel { padding: 10px; font-size: 12px; color: inherit; }
fieldset { border: 0; padding: 0; margin: 0; }
.effect-list { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-bottom: 10px; }
label { display: flex; gap: 6px; align-items: center; justify-content: space-between; margin: 9px 0; }
.check { justify-content: flex-start; }
input, button { font: inherit; color: inherit; background: #202020; border: 1px solid #474747; padding: 5px; border-radius: 4px; }
.effect-param>span{min-width:62px}.effect-param :deep(input[type=number]){width:58px;min-width:0}.effect-param :deep(.commit-field){flex:none}.effect-param input[type=range]{min-width:40px;}
input[type=color] { width: 52px; height: 30px; padding: 2px; }
input[type=range] { flex: 1; max-width: 140px; }
button { cursor: pointer; }
button.selected { background: #345e88; }
.buttons { display: flex; justify-content: flex-end; gap: 6px; }
</style>
