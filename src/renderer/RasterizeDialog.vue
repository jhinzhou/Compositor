<script setup lang="ts">
import {onMounted,ref} from 'vue'
import {useI18n} from './i18n'
const {t}=useI18n()
defineProps<{name:string;disabled?:boolean}>()
const emit=defineEmits<{confirm:[];cancel:[]}>()
const cancelButton=ref<HTMLButtonElement>()
onMounted(()=>cancelButton.value?.focus())
function trapTab(event:KeyboardEvent):void{
 const buttons=Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
 if(!buttons.length)return
 const at=buttons.indexOf(document.activeElement as HTMLButtonElement)
 buttons[(at+(event.shiftKey?-1:1)+buttons.length)%buttons.length].focus();event.preventDefault()
}
</script>
<template>
 <div class="rasterize-backdrop" @pointerdown.self="!disabled&&emit('cancel')" @keydown.esc.stop.prevent="!disabled&&emit('cancel')" @keydown.tab="trapTab" @keydown.stop>
  <section class="rasterize-dialog" role="dialog" aria-modal="true" :aria-label="t('Rasterize layer?')" aria-describedby="rasterize-description">
   <h2>{{t('Rasterize layer?')}}</h2>
   <p id="rasterize-description">{{t('Painting on “{name}” requires rasterization. Text and shapes will no longer be editable. You can undo this change.',{name})}}</p>
   <p>{{t('After rasterizing, draw your stroke again.')}}</p>
   <footer class="dialog-actions"><button ref="cancelButton" type="button" :disabled="disabled" @click="emit('cancel')">{{t('Cancel')}}</button><button type="button" class="primary" :disabled="disabled" @click="emit('confirm')">{{t('Rasterize')}}</button></footer>
  </section>
 </div>
</template>
<style scoped>
.rasterize-backdrop{position:fixed;inset:0;z-index:80;background:#0007;display:grid;place-items:center;padding:20px}
.rasterize-dialog{width:min(440px,100%);max-height:calc(100vh - 40px);overflow:auto;padding:24px;background:#292929;color:#eee;border:1px solid #555;border-radius:10px;box-shadow:0 12px 35px #0008}
.rasterize-dialog h2{margin:0 0 18px;font-size:18px}.rasterize-dialog p{margin:12px 0;font-size:13px;line-height:1.65;overflow-wrap:anywhere}
.rasterize-dialog footer{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:12px;margin-top:22px}.rasterize-dialog button{padding:7px 15px;background:#333;border:1px solid #555;border-radius:5px;color:inherit;white-space:nowrap;cursor:pointer}.rasterize-dialog .primary{background:#087ff5;border-color:#087ff5;color:#fff}.rasterize-dialog button:disabled{opacity:.5;cursor:wait}.rasterize-dialog button:focus-visible{outline:2px solid #168aff;outline-offset:2px}
</style>
