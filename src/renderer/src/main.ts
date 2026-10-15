import { createApp } from 'vue'
import App from '../App.vue'
import '../style.css'
import { CanvasEngine, toBase64 } from '../canvas-engine'
import {renderTextPNG,renderShapePNG,setInstalledFontCatalog} from '../content-raster'
import { failure } from '../../shared/contracts'
import { initializeI18n } from '../i18n'

if (new URLSearchParams(location.search).has('render')) {
  const fonts=window.compositor.request<{family:string;postscriptName?:string;fullName?:string;style?:string}[]>('fontCatalog').then(result=>{if(result.ok)setInstalledFontCatalog(result.value)})
  const canvas = document.createElement('canvas')
  document.body.append(canvas)
  const engine = new CanvasEngine()
  // Saved thumbnails, MCP captures and adjustment previews have a deterministic
  // image boundary. Display-only dithering belongs to the visible editor.
  engine.setScreenQuantization(false)
  window.compositor.onRender(async ({ id, state, maxDimension, fullSize,content }) => {
    try {
      if(content){await fonts;const raster=content.type==='layer.text'?await renderTextPNG(content.style):await renderShapePNG(content.style,content.size);window.compositor.renderComplete(id,{ok:true,value:{data:toBase64(raster.bytes),mimeType:'image/png',revision:state.revision,previewId:crypto.randomUUID(),width:raster.width,height:raster.height,canvasSize:[raster.width,raster.height],scale:1}});return}
      const { width, height } = state.manifest
      const scale = fullSize ? 1 : Math.min(1, maxDimension / Math.max(width, height))
      const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale))
      engine.setFullResolutionEffects(!!fullSize);await engine.draw(canvas, state, w, h)
      window.compositor.renderComplete(id, { ok: true, value: { data: toBase64(engine.png()), mimeType: 'image/png', revision: state.revision,
        previewId: crypto.randomUUID(), width: w, height: h, canvasSize: [width, height], scale: w / width } })
    } catch (error) { window.compositor.renderComplete(id, failure(error)) }
  })
} else {
  void initializeI18n().then(() => createApp(App).mount('#app'))
}
