<script setup lang="ts">
import {ref,watch,nextTick,toRaw} from 'vue'
import type {Selection} from '../shared/pixel-contracts'
import {selectionCoverage} from '../shared/selection-coverage'
import type {ViewportRenderPlan} from './viewport-render'
const props=defineProps<{selection?:Selection|null;plan?:ViewportRenderPlan;width:number;height:number;zoom:number;protectedAreas:boolean}>()
const emit=defineEmits<{error:[message:string]}>()
const canvas=ref<HTMLCanvasElement>()
async function draw(){try{await nextTick();if(!canvas.value)return;const region=props.plan?.region??{x:0,y:0,width:props.width,height:props.height},scale=Math.min(1,768/Math.max(region.width,region.height)),w=Math.max(1,Math.ceil(region.width*scale)),h=Math.max(1,Math.ceil(region.height*scale));canvas.value.width=w;canvas.value.height=h;const context=canvas.value.getContext('2d')!;const image=context.createImageData(w,h),selection=props.selection&&toRaw(props.selection);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const coverage=selectionCoverage(selection,region.x+(x+.5)*region.width/w,region.y+(y+.5)*region.height/h),alpha=props.protectedAreas?1-coverage:selection?coverage:0;image.data.set([255,props.protectedAreas?35:70,props.protectedAreas?35:210,Math.round(alpha*128)],(y*w+x)*4)}context.putImageData(image,0,0)}catch(cause){canvas.value?.getContext('2d')?.clearRect(0,0,canvas.value.width,canvas.value.height);emit('error',cause instanceof Error?cause.message:String(cause))}}
watch(()=>[props.selection,props.plan,props.width,props.height,props.protectedAreas,canvas.value],draw,{immediate:true})
</script>
<template><canvas ref="canvas" data-testid="selection-mask-overlay" :data-protected="protectedAreas" class="selection-mask-overlay" :style="plan?.css??{left:'0px',top:'0px',width:`${width*zoom}px`,height:`${height*zoom}px`}"/></template>
<style scoped>.selection-mask-overlay{position:absolute;pointer-events:none;z-index:2}</style>
