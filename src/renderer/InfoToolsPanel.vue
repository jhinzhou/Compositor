<script setup lang="ts">
import {computed} from 'vue'
import {INFO_UNITS,SAMPLE_SIZES,rulerMeasurement,type DocumentInfo,type InfoUnit} from '../shared/document-info'
import type {DocumentColorReading} from '../core/document-info'
import {useI18n} from './i18n'
import {infoToolLabel} from './info-tools-labels'
const {locale}=useI18n()
const props=withDefaults(defineProps<{info:DocumentInfo;readings?:DocumentColorReading[];resolution:number;disabled?:boolean;error?:string;loading?:boolean}>(),{disabled:false,loading:false})
const emit=defineEmits<{change:[info:DocumentInfo];'remove-sample':[id:number];'clear-samples':[];'clear-ruler':[]}>()
const label=(key:Parameters<typeof infoToolLabel>[1])=>infoToolLabel(locale.value,key)
const measurement=computed(()=>props.info.ruler?rulerMeasurement(props.info.ruler,props.resolution,props.info.unit):undefined)
const changeSize=(event:Event)=>emit('change',{...props.info,sampleSize:Number((event.target as HTMLSelectElement).value) as DocumentInfo['sampleSize']})
const changeSource=(event:Event)=>emit('change',{...props.info,sampleTarget:(event.target as HTMLSelectElement).value as DocumentInfo['sampleTarget']})
const changeUnit=(event:Event)=>emit('change',{...props.info,unit:(event.target as HTMLSelectElement).value as InfoUnit})
function reading(id:number){return props.readings?.find(sample=>sample.id===id)?.reading}
function sourcePrecision(id:number){return props.readings?.find(sample=>sample.id===id)?.sourcePrecision}
function number(value:number|undefined):string {return value===undefined?'—':Number.isFinite(value)?value.toFixed(3).replace(/\.?0+$/,''): '—'}
</script>
<template>
 <section class="info-tools-panel" data-testid="info-tools-panel" :aria-label="label('Color samplers')">
  <h3>{{label('Color samplers')}}</h3>
  <div class="info-options"><label>{{label('Sample size')}}<select :value="info.sampleSize" :disabled="disabled" @change="changeSize"><option v-for="size in SAMPLE_SIZES" :key="size" :value="size">{{size===1?label('Point sample'):`${size} × ${size}`}}</option></select></label><label>{{label('Sample source')}}<select :value="info.sampleTarget" :disabled="disabled" @change="changeSource"><option value="merged">{{label('Merged high-depth composite')}}</option><option value="current">{{label('Current layer source')}}</option></select></label></div>
  <p class="hint">{{label('Color readings use canonical pixels; current layer ignores opacity, masks and effects.')}}</p>
  <p v-if="error" class="error" role="alert">{{error}}</p><p v-else-if="loading" role="status">{{label('Reading pending')}}</p>
  <p v-if="!info.samples.length" class="hint">{{label('No color samples')}}</p>
  <ol v-else class="sample-list"><li v-for="sample in info.samples" :key="sample.id" :data-reading-id="sample.id">
   <div class="sample-heading"><strong>#{{sample.id}}</strong><span>X {{number(sample.position[0])}} · Y {{number(sample.position[1])}}</span><button :disabled="disabled" :aria-label="`${label('Remove sample')} ${sample.id}`" @click="emit('remove-sample',sample.id)">×</button></div>
   <template v-if="reading(sample.id)"><dl><div v-for="(channel,index) in ['R','G','B']" :key="channel"><dt>{{channel}}</dt><dd>{{number(reading(sample.id)!.rgb[index])}}</dd></div><div><dt>α</dt><dd>{{number(reading(sample.id)!.alpha*100)}}%</dd></div></dl><p class="precision">{{reading(sample.id)!.precision==='uint16'?(sourcePrecision(sample.id)==='uint8'?label('8-bit source · 16-bit composite'):label('Full-range 16-bit')):reading(sample.id)!.precision==='float32'?label('Floating HDR'):'8-bit'}} · {{reading(sample.id)!.pixelCount}} {{label('Pixels')}}<span v-if="reading(sample.id)!.transparent"> · {{label('Transparent')}}</span></p></template>
   <span v-else class="hint">{{readings?.some(item=>item.id===sample.id)?label('Outside source'):label('Reading pending')}}</span>
  </li></ol>
  <div class="info-footer"><button :disabled="disabled||!info.samples.length" @click="emit('clear-samples')">{{label('Clear samples')}}</button></div>
  <h3>{{label('Ruler tool')}}</h3><label class="unit-option">{{label('Units')}}<select :value="info.unit" :disabled="disabled" @change="changeUnit"><option v-for="unit in INFO_UNITS" :key="unit" :value="unit">{{unit}}</option></select></label>
  <dl v-if="measurement" class="measurement"><div><dt>X / Y</dt><dd>{{number(measurement.x)}} / {{number(measurement.y)}} {{info.unit}}</dd></div><div><dt>W / H</dt><dd>{{number(measurement.width)}} / {{number(measurement.height)}} {{info.unit}}</dd></div><div><dt>{{label('Length')}}</dt><dd>{{number(measurement.length)}} {{info.unit}}</dd></div><div><dt>{{label('Angle')}}</dt><dd>{{number(measurement.angle)}}°</dd></div><template v-if="measurement.secondLength!==undefined"><div><dt>{{label('Second length')}}</dt><dd>{{number(measurement.secondLength)}} {{info.unit}}</dd></div><div><dt>{{label('Included angle')}}</dt><dd>{{number(measurement.includedAngle)}}°</dd></div></template></dl><p v-else class="hint">{{label('Draw a ruler line')}}</p>
  <p class="hint">{{label('Shift constrains to 45°. Alt-drag an endpoint adds a protractor arm.')}}</p><div class="info-footer"><button :disabled="disabled||!info.ruler" @click="emit('clear-ruler')">{{label('Clear ruler')}}</button></div>
 </section>
</template>
<style scoped>
.info-tools-panel{font-size:11px;padding:10px;border-top:1px solid #444;min-width:0;color:#ddd}.info-tools-panel h3{font-size:12px;margin:8px 0 12px}.info-options{display:grid;gap:8px}.info-options label,.unit-option{display:flex;align-items:center;justify-content:space-between;gap:8px}.info-tools-panel select{min-width:0;max-width:170px;padding:4px;color:#ddd;background:#202020;border:1px solid #555;border-radius:4px}.info-tools-panel button{font-size:11px;padding:5px 8px;border:1px solid #555;border-radius:4px;color:#ddd;background:#353535;white-space:nowrap}.sample-list{list-style:none;padding:0;margin:8px 0}.sample-list li{border:1px solid #444;border-radius:4px;padding:6px;margin:6px 0}.sample-heading{display:flex;align-items:center;gap:7px}.sample-heading span{flex:1;font-size:10px;color:#aaa}.sample-heading button{padding:0 5px;font-size:16px}.info-tools-panel dl{margin:6px 0;display:flex;gap:10px;flex-wrap:wrap}.info-tools-panel dl div{display:flex;gap:4px}.info-tools-panel dt{color:#aaa}.info-tools-panel dd{margin:0;font-variant-numeric:tabular-nums}.info-tools-panel .measurement{display:grid;gap:6px}.measurement div{justify-content:space-between}.hint,.precision{font-size:10px;color:#aaa;line-height:1.5;margin:6px 0}.error{color:#ffabab;overflow-wrap:anywhere}.info-footer{display:flex;justify-content:flex-end;margin:8px 0 12px}
</style>
