import {portableASCIIGlyphs,type ASCIIGlyph } from '../shared/ascii-dither'
const cache = new Map<string, ASCIIGlyph[]>()
export function rasterizeASCIIGlyphs(characters: string, textSize: number): ASCIIGlyph[] {
  const key = `${textSize}:${characters}`, cached = cache.get(key); if (cached) return cached
  if([...characters].every(character=>character.charCodeAt(0)>=32&&character.charCodeAt(0)<=126)){const glyphs=portableASCIIGlyphs(characters,textSize);if(cache.size>=8)cache.delete(cache.keys().next().value!);cache.set(key,glyphs);return glyphs}
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) throw new Error('ASCII font rasterization could not allocate its surface.')
  const font = `bold ${textSize / 1.2}px ui-monospace, Menlo, Consolas, monospace`
  context.font = font; const measured = context.measureText('M'), width = Math.max(1, Math.round(measured.width)), height = textSize
  canvas.width = width; canvas.height = height
  const glyphs = [...new Set(characters)].map(character => {
    context.clearRect(0, 0, width, height); context.font = font; context.fillStyle = '#ffffff'; context.textBaseline = 'middle'; context.textAlign = 'center'; context.fillText(character, width / 2, height / 2)
    const pixels = context.getImageData(0, 0, width, height).data; let bitmap = ''
    for (let index = 3; index < pixels.length; index += 4) bitmap += String.fromCharCode(pixels[index])
    return { character, width, height, bitmap: btoa(bitmap) }
  })
  if (cache.size >= 8) cache.delete(cache.keys().next().value!)
  cache.set(key, glyphs); return glyphs
}
