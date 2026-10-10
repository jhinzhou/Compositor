<script setup lang="ts">
const props = defineProps<{ value: Record<string, unknown>; path?: string }>()
const emit = defineEmits<{ update: [value: Record<string, unknown>] }>()
const title = (key: string) => key.replace(/([A-Z])/g, ' $1').replace(/^./, value => value.toUpperCase())
const choices: Record<string, string[]> = { process: ['Version 1','Version 2','Version 3','Version 4','Version 5','Version 6'], upright: ['Off','Guided'], projection: ['Perspective','Rectilinear'], range: ['Master','Reds','Yellows','Greens','Cyans','Blues','Magentas'] }
const limits = (key: string) => props.path === 'hsl' && ['hue','saturation','lightness'].includes(key) ? { min: key === 'hue' ? -180 : -100, max: key === 'hue' ? 180 : 100, step: 1 } : key === 'hue' || key.includes('HueLow') || key.includes('HueHigh') ? { min: 0, max: 360, step: 1 } : ['x','y','startX','startY','endX','endY','saturationRange','luminanceRange'].includes(key) || ['saturation','luminance'].includes(key) && props.path?.includes('points') ? { min: 0, max: 1, step: .01 } : key === 'hueRange' ? { min: 5, max: 180, step: 1 } : key === 'rotate' ? { min: -45, max: 45, step: .1 } : key === 'sharpenAmount' ? { min: 0, max: 150, step: 1 } : { min: key.includes('Hue') || key.includes('Saturation') || key.endsWith('Shift') || ['luminance','balance','shadows','darks','lights','highlights','refineSaturation','vertical','horizontal','aspect','scale','offsetX','offsetY','distortion','vignetteAmount','vignetteRoundness','glowRange','shadowTint'].includes(key) ? -100 : 0, max: 100, step: 1 }
function set(key: string, value: unknown): void { emit('update', { ...props.value, [key]: value }) }
function setElement(key: string, index: number, value: unknown): void { const items = [...props.value[key] as unknown[]]; items[index] = value; set(key, items) }
function add(key: string): void {
  const items = [...props.value[key] as unknown[]]
  if (key === 'points' && items.length < 8) items.push({ hue: 0, saturation: .5, luminance: .5, hueShift: 0, saturationShift: 0, luminanceShift: 0, hueRange: 30, saturationRange: .4, luminanceRange: .4 })
  else if (key === 'guides' && items.length < 4) items.push({ startX: .2, startY: .1, endX: .2, endY: .9 })
  else if (['rgb','red','green','blue'].includes(key) && items.length < 32) { const points = items as { x: number; y: number }[], index = points.slice(1).findIndex((point, index) => point.x - points[index].x > .02); if (index < 0) return; const left = points[index], right = points[index + 1]; items.splice(index + 1, 0, { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 }) }
  set(key, items)
}
function remove(key: string, index: number): void { const items = [...props.value[key] as unknown[]]; items.splice(index, 1); set(key, items) }
</script>
<template>
  <div class="parameter-fields"><template v-for="(value,key) in value" :key="key">
    <label v-if="typeof value === 'number'" class="parameter-row">{{ title(key) }}<input :value="value" type="number" v-bind="limits(key)" @input="set(key,Number(($event.target as HTMLInputElement).value))"/></label>
    <label v-else-if="typeof value === 'boolean'" class="parameter-row">{{ title(key) }}<input :checked="value" type="checkbox" @change="set(key,($event.target as HTMLInputElement).checked)"/></label>
    <label v-else-if="typeof value === 'string' && choices[key]" class="parameter-row">{{ title(key) }}<select :value="value" @change="set(key,($event.target as HTMLSelectElement).value)"><option v-for="option in choices[key]" :key="option">{{ option }}</option></select></label>
    <fieldset v-else-if="Array.isArray(value)"><legend>{{ title(key) }}</legend>
      <template v-for="(element,index) in value" :key="index"><label v-if="typeof element === 'number'" class="parameter-row">{{ key === 'band' ? ['Falloff start','Range start','Range end','Falloff end'][index] : ['Reds','Oranges','Yellows','Greens','Aquas','Blues','Purples','Magentas'][index] ?? `Value ${index+1}` }}<input :value="element" type="number" :min="key === 'band' ? 0 : -100" :max="key === 'band' ? 360 : 100" @input="setElement(key,index,Number(($event.target as HTMLInputElement).value))"/></label>
        <div v-else-if="element && typeof element === 'object'" class="parameter-item"><FilterParameterFields :value="element" :path="`${path ?? ''}.${key}`" @update="setElement(key,index,$event)"/><button v-if="['points','guides'].includes(key) || index > 0 && index < value.length-1" type="button" @click="remove(key,index)">Remove {{ title(key) }}</button></div></template>
      <button v-if="['points','guides','rgb','red','green','blue'].includes(key)" type="button" @click="add(key)">Add {{ key === 'guides' ? 'guide' : 'point' }}</button>
    </fieldset>
    <fieldset v-else-if="value && typeof value === 'object'"><legend>{{ title(key) }}</legend><FilterParameterFields :value="value as Record<string,unknown>" :path="`${path ?? ''}.${key}`" @update="set(key,$event)"/></fieldset>
  </template></div>
</template>
<style scoped>
.parameter-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:9px 0;font-size:11px}.parameter-fields input,.parameter-fields select{width:75px;height:26px;background:#202020;color:#ddd;border:1px solid #484848;border-radius:4px;padding:3px 5px;min-width:0;text-align:right}.parameter-fields input[type=checkbox]{width:auto;height:auto}.parameter-fields select{width:125px;text-align:left}.parameter-fields fieldset{margin:10px 0;padding:5px 8px;border:1px solid #484848;border-radius:5px}.parameter-fields legend{padding:0 4px;font-size:11px;color:#bbb}.parameter-item{padding:6px 0;border-bottom:1px solid #444}.parameter-fields button{background:#3b3b3b;border:1px solid #555;border-radius:4px;padding:4px 8px;color:#ddd;margin:6px 0;font-size:11px}.parameter-fields :focus-visible{outline:2px solid #1688ff;outline-offset:2px}
</style>
