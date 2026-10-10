import type { Blender, CanvasKit, Paint } from 'canvaskit-wasm'
import { EditorError, type BLEND_MODES } from '../shared/contracts'

type Mode = typeof BLEND_MODES[number]
const customModes = ['Linear Burn', 'Linear Dodge (Add)', 'Vivid Light', 'Linear Light', 'Pin Light', 'Hard Mix', 'Subtract', 'Divide'] as const

// Skia passes premultiplied sRGB to a blender. Blend straight colors first,
// then compose coverage; Plus is not Linear Dodge on translucent layers.
const customBlend = `
uniform float mode;
float burn(float d, float s) { return d >= 1 ? 1 : s <= 0 ? 0 : 1 - min(1.0, (1-d)/s); }
float dodge(float d, float s) { return d <= 0 ? 0 : s >= 1 ? 1 : min(1.0, d/(1-s)); }
float channel(float d, float s) {
  if (mode < 0.5) return max(0.0, d+s-1);
  if (mode < 1.5) return min(1.0, d+s);
  if (mode < 2.5) return s < 0.5 ? burn(d,2*s) : dodge(d,2*s-1);
  if (mode < 3.5) return clamp(d+2*s-1,0.0,1.0);
  if (mode < 4.5) return s < 0.5 ? min(d,2*s) : max(d,2*s-1);
  if (mode < 5.5) return d+s <= 1.000001 ? 0 : 1;
  if (mode < 6.5) return max(0.0, d-s);
  return d <= 0 ? 0 : s <= 0 ? 1 : min(1.0, d/s);
}
half4 main(half4 source, half4 destination) {
  // The native CI path renders foreground coverage into an RGBA8 surface first.
  // Preserve that quantization, especially at Hard Mix's discontinuous threshold.
  float4 top = floor(float4(source)*255+0.5)/255;
  float4 bottom = floor(float4(destination)*255+0.5)/255;
  float sa = top.a, da = bottom.a;
  float3 s = sa > 0 ? top.rgb/sa : float3(0);
  float3 d = da > 0 ? bottom.rgb/da : float3(0);
  float3 blended = float3(channel(d.r,s.r),channel(d.g,s.g),channel(d.b,s.b));
  return half4((1-sa)*bottom.rgb+(1-da)*top.rgb+sa*da*blended, sa+da-sa*da);
}`

export class BlendPainter {
  private blenders = new Map<Mode, Blender>()
  private kit?: CanvasKit
  apply(kit: CanvasKit, paint: Paint, mode: Mode): void {
    if (this.kit && this.kit !== kit) this.dispose()
    this.kit = kit
    const index = customModes.indexOf(mode as typeof customModes[number])
    if (index >= 0) {
      let blender = this.blenders.get(mode)
      if (!blender) {
        let diagnostic = ''
        const effect = kit.RuntimeEffect.MakeForBlender(customBlend, message => { diagnostic = message })
        if (!effect) throw new EditorError('RENDER_FAILED', `Blend shader compilation failed: ${diagnostic}`)
        try { blender = effect.makeBlender([index]); this.blenders.set(mode, blender) }
        finally { effect.delete() }
      }
      paint.setBlender(blender)
      return
    }
    const modes = {
      Normal: kit.BlendMode.SrcOver, Darken: kit.BlendMode.Darken, Multiply: kit.BlendMode.Multiply,
      'Color Burn': kit.BlendMode.ColorBurn, Lighten: kit.BlendMode.Lighten, Screen: kit.BlendMode.Screen,
      'Color Dodge': kit.BlendMode.ColorDodge, Overlay: kit.BlendMode.Overlay, 'Soft Light': kit.BlendMode.SoftLight,
      'Hard Light': kit.BlendMode.HardLight, Difference: kit.BlendMode.Difference, Exclusion: kit.BlendMode.Exclusion,
      Hue: kit.BlendMode.Hue, Saturation: kit.BlendMode.Saturation, Color: kit.BlendMode.Color, Luminosity: kit.BlendMode.Luminosity
    }
    const value = modes[mode as keyof typeof modes]
    if (!value) throw new EditorError('UNSUPPORTED_FEATURE', `Unknown blend mode: ${mode}`)
    paint.setBlendMode(value)
  }
  dispose(): void { for (const blender of this.blenders.values()) blender.delete(); this.blenders.clear(); this.kit = undefined }
}
