import { z } from 'zod'
import {ASCII_ATLAS} from './ascii-atlas'
export const asciiGlyphSchema = z.object({ character: z.string().min(1).max(8), width: z.number().int().min(1).max(64), height: z.number().int().min(1).max(128), bitmap: z.string().max(10924).regex(/^[A-Za-z\d+/]*={0,2}$/) }).strict().refine(value => { try { return atob(value.bitmap).length === value.width * value.height } catch { return false } }, 'Glyph bitmap does not match its dimensions.')
export type ASCIIGlyph = z.infer<typeof asciiGlyphSchema>
export const ASCII_CHARACTERS = ' .:-=+*#%@'
/** Stable licensed glyph coverage is shared by the desktop renderer and headless MCP. */
export function portableASCIIGlyphs(characters: string, textSize: number): ASCIIGlyph[] {
 if(!Number.isInteger(textSize)||textSize<6||textSize>64)throw new Error('ASCII text size must be between 6 and 64 pixels.')
 const width=Math.max(1,Math.round(textSize*ASCII_ATLAS.width/ASCII_ATLAS.height)),height=textSize
 return [...new Set(characters)].map(character=>{
  const bitmap=ASCII_ATLAS.glyphs[character as keyof typeof ASCII_ATLAS.glyphs]
  if(!bitmap)throw new Error('Custom non-ASCII characters require explicit rasterized glyph maps from the desktop font renderer.')
  const source=Uint8Array.from(atob(bitmap),value=>value.charCodeAt(0)),at=(x:number,y:number)=>source[Math.min(ASCII_ATLAS.height-1,Math.max(0,y))*ASCII_ATLAS.width+Math.min(ASCII_ATLAS.width-1,Math.max(0,x))]
  let bytes=''
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const sx=(x+.5)*ASCII_ATLAS.width/width-.5,sy=(y+.5)*ASCII_ATLAS.height/height-.5,x0=Math.floor(sx),y0=Math.floor(sy),tx=sx-x0,ty=sy-y0;bytes+=String.fromCharCode(Math.round(at(x0,y0)*(1-tx)*(1-ty)+at(x0+1,y0)*tx*(1-ty)+at(x0,y0+1)*(1-tx)*ty+at(x0+1,y0+1)*tx*ty))}
  return {character,width,height,bitmap:btoa(bytes)}
 })
}
export type ASCIISettings = { characters: string; textSize: number; glyphs?: ASCIIGlyph[]; density: number; contrast: number; lightOnDark: boolean; colors: 'blackWhite'|'twoColors'|'original'; dark: string; light: string }
export function applyASCII(image: { width: number; height: number; data: Uint8ClampedArray }, settings: ASCIISettings): typeof image {
  const maps = (settings.glyphs ?? portableASCIIGlyphs(settings.characters || ASCII_CHARACTERS, settings.textSize)).map(glyph => { const data = Uint8Array.from(atob(glyph.bitmap), char => char.charCodeAt(0)); return { ...glyph, data, coverage: data.reduce((sum, value) => sum + value, 0) / (data.length * 255) } }).sort((a, b) => a.coverage - b.coverage)
  if (!maps.length || maps.some(glyph => glyph.width !== maps[0].width || glyph.height !== maps[0].height)) throw new Error('ASCII glyphs must have a shared cell size.')
  const width = maps[0].width, height = maps[0].height, columns = Math.ceil(image.width / width), rows = Math.ceil(image.height / height), picked = new Uint8Array(columns * rows)
  const tone = (value: number) => Math.max(0, Math.min(1, (Math.max(0, Math.min(1, value)) ** (2 ** (settings.density / 100 * 1.5)) - .5) * (settings.contrast >= 0 ? 1 / (1 - .95 * settings.contrast / 100) : 1 + settings.contrast / 100) + .5))
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    let sum = 0, count = 0
    for (let y = row * height; y < Math.min(image.height, (row + 1) * height); y++) for (let x = column * width; x < Math.min(image.width, (column + 1) * width); x++) {
      const at = (y * image.width + x) * 4; if (!image.data[at + 3]) continue
      sum += settings.colors === 'original' ? .2126 * tone(image.data[at] / 255) + .7152 * tone(image.data[at + 1] / 255) + .0722 * tone(image.data[at + 2] / 255) : tone((.2126 * image.data[at] + .7152 * image.data[at + 1] + .0722 * image.data[at + 2]) / 255); count++
    }
    const value = count ? sum / count : 1, wanted = (settings.lightOnDark ? value : 1 - value) * maps.at(-1)!.coverage
    let best = 0; for (let index = 1; index < maps.length; index++) if (Math.abs(maps[index].coverage - wanted) < Math.abs(maps[best].coverage - wanted)) best = index
    picked[row * columns + column] = best
  }
  const color = (value: string) => [1,3,5].map(offset => parseInt(value.slice(offset, offset + 2), 16)), dark = settings.colors === 'twoColors' ? color(settings.dark) : [0,0,0], light = settings.colors === 'twoColors' ? color(settings.light) : [255,255,255], ink = settings.lightOnDark ? light : dark, paper = settings.lightOnDark ? dark : light, data = new Uint8ClampedArray(image.data)
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const at = (y * image.width + x) * 4; if (!data[at + 3]) continue
    const glyph = maps[picked[Math.floor(y / height) * columns + Math.floor(x / width)]], amount = glyph.data[(y % height) * width + x % width] / 255
    for (let channel = 0; channel < 3; channel++) data[at + channel] = Math.round(settings.colors === 'original' ? (settings.lightOnDark ? 0 : 255) * (1 - amount) + image.data[at + channel] * amount : paper[channel] * (1 - amount) + ink[channel] * amount)
  }
  return { ...image, data }
}
