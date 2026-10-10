import { z } from 'zod'
import { EditorError, LIMITS } from '../shared/contracts'

import {fontName,validateTextStyle as strictTextStyle,validateShapeStyle,type TextStyle,type ShapeStyle} from '../shared/content-style'
export {textStyleSchema,shapeStyleSchema,validateShapeStyle,type TextStyle,type ShapeStyle} from '../shared/content-style'
export function validateTextStyle(input:unknown):TextStyle {const source=input as Partial<TextStyle>&{lineSpacing?:number};return strictTextStyle(source&&typeof source==='object'&&source.leading===undefined?{...source,leading:typeof source.lineSpacing==='number'?Math.max(0,(source.fontSize??12)*1.2+source.lineSpacing):0}:input)}
export interface ContentRaster {warnings?:string[];bytes:Uint8Array;width:number;height:number;text?:TextStyle;shape?:ShapeStyle}
export function defaultTextStyle(face='Helvetica'): TextStyle { return { content: 'Text', fontName: face, fontSize: 72, red: 0, green: 0, blue: 0, alignment: 'Left', tracking: 0, leading: 0 } }
export function defaultShapeStyle(): ShapeStyle { return { kind: 'Rectangle', red: 0, green: 0, blue: 0, cornerRadius: 0 } }
export const textLineHeight = (style: TextStyle): number => style.leading > 0 ? style.leading : style.fontSize * 1.2
export function textColorAt(style: TextStyle, offset: number): [number, number, number] {
  const run = style.colorRuns?.find(item => offset >= item.location && offset < item.location + item.length)
  return run ? [run.red, run.green, run.blue] : [style.red, style.green, style.blue]
}
export function textFontAt(style: TextStyle, offset: number): string { return style.fontRuns?.find(item => offset >= item.location && offset < item.location + item.length)?.fontName ?? style.fontName }

function compressRuns<T>(values: T[], base: T, equal: (a: T, b: T) => boolean): { location: number; length: number; value: T }[] {
  const runs: { location: number; length: number; value: T }[] = []
  values.forEach((value, location) => {
    if (equal(value, base)) return
    const last = runs.at(-1)
    if (last && last.location + last.length === location && equal(last.value, value)) last.length++
    else runs.push({ location, length: 1, value })
  })
  return runs
}
function textRange(style: TextStyle, location: number, length: number): [number, number] {
  const start = Math.max(0, Math.min(style.content.length, Math.trunc(location)))
  return [start, Math.max(start, Math.min(style.content.length, Math.trunc(location + length)))]
}
export function setTextColor(input: TextStyle, location: number, length: number, color: [number, number, number]): TextStyle {
  const style = structuredClone(validateTextStyle(input)), [start, end] = textRange(style, location, length)
  if (start === end || (start === 0 && end === style.content.length)) { [style.red, style.green, style.blue] = color; delete style.colorRuns }
  else {
    const colors = Array.from({ length: style.content.length }, (_, index) => index >= start && index < end ? color : textColorAt(style, index))
    const runs = compressRuns(colors, [style.red, style.green, style.blue], (a, b) => a.every((value, index) => value === b[index]))
    style.colorRuns = runs.length ? runs.map(run => ({ location: run.location, length: run.length, red: run.value[0], green: run.value[1], blue: run.value[2] })) : undefined
  }
  return validateTextStyle(style)
}
export function setTextFont(input: TextStyle, location: number, length: number, face: string): TextStyle {
  fontName.parse(face)
  const style = structuredClone(validateTextStyle(input)), [start, end] = textRange(style, location, length)
  if (start === end || (start === 0 && end === style.content.length)) { style.fontName = face; delete style.fontRuns }
  else {
    const fonts = Array.from({ length: style.content.length }, (_, index) => index >= start && index < end ? face : textFontAt(style, index))
    const runs = compressRuns(fonts, style.fontName, (a, b) => a === b)
    style.fontRuns = runs.length ? runs.map(run => ({ location: run.location, length: run.length, fontName: run.value })) : undefined
  }
  return validateTextStyle(style)
}
export function replaceTextCharacters(input: TextStyle, location: number, length: number, replacement: string): TextStyle {
  const style = structuredClone(validateTextStyle(input)), [start, end] = textRange(style, location, length)
  if (style.colorRuns) {
    const colors = Array.from({ length: style.content.length }, (_, index) => textColorAt(style, index)), inherited = colors[start > 0 ? start - 1 : start] ?? [style.red, style.green, style.blue]
    colors.splice(start, end - start, ...Array.from({ length: replacement.length }, () => inherited))
    const runs = compressRuns(colors, [style.red, style.green, style.blue], (a, b) => a.every((value, index) => value === b[index]))
    style.colorRuns = runs.length ? runs.map(run => ({ location: run.location, length: run.length, red: run.value[0], green: run.value[1], blue: run.value[2] })) : undefined
  }
  if (style.fontRuns) {
    const fonts = Array.from({ length: style.content.length }, (_, index) => textFontAt(style, index)), inherited = fonts[start > 0 ? start - 1 : start] ?? style.fontName
    fonts.splice(start, end - start, ...Array.from({ length: replacement.length }, () => inherited))
    const runs = compressRuns(fonts, style.fontName, (a, b) => a === b)
    style.fontRuns = runs.length ? runs.map(run => ({ location: run.location, length: run.length, fontName: run.value })) : undefined
  }
  style.content = style.content.slice(0, start) + replacement + style.content.slice(end)
  return validateTextStyle(style)
}

export interface TextSpan { text: string; offset: number; fontName: string; color: [number, number, number] }
export function textSpans(style: TextStyle, start = 0, end = style.content.length): TextSpan[] {
  const spans: TextSpan[] = []
  let offset = start
  for (const character of style.content.slice(start, end)) {
    const face = textFontAt(style, offset), color = textColorAt(style, offset), last = spans.at(-1)
    if (last && last.fontName === face && last.color.every((value, index) => value === color[index])) last.text += character
    else spans.push({ text: character, offset, fontName: face, color })
    offset += character.length
  }
  return spans
}
export interface TextLine { start: number; end: number; width: number }
export function layoutTextLines(style: TextStyle, maximumWidth: number, measure: (text: string, face: string) => number): TextLine[] {
  const widthOf = (start: number, end: number): number => textSpans(style, start, end).reduce((sum, span) => sum + measure(span.text, span.fontName), 0) + Math.max(0, Array.from(style.content.slice(start, end)).length - 1) * style.tracking
  const lines: TextLine[] = [], paragraphs = style.content.split('\n')
  let paragraphStart = 0
  for (const paragraph of paragraphs) {
    const paragraphEnd = paragraphStart + paragraph.length
    if (!paragraph.length) lines.push({ start: paragraphStart, end: paragraphStart, width: 0 })
    const boundaries = [paragraphStart]
    for (const character of paragraph) boundaries.push(boundaries.at(-1)! + character.length)
    let start = paragraphStart
    while (start < paragraphEnd) {
      let end = paragraphEnd
      if (widthOf(start, end) > maximumWidth) {
        let low = boundaries.indexOf(start) + 1, high = boundaries.length - 1, fitting = low
        while (low <= high) {
          const middle = Math.floor((low + high) / 2)
          if (widthOf(start, boundaries[middle]) <= maximumWidth) { fitting = middle; low = middle + 1 } else high = middle - 1
        }
        end = boundaries[fitting]
        const candidate = style.content.slice(start, end), lastSpace = candidate.search(/\s+\S*$/)
        if (lastSpace > 0) end = start + lastSpace
      }
      lines.push({ start, end, width: Math.max(0, widthOf(start, end)) }); start = end
      if (end < paragraphEnd) while (start < paragraphEnd && /\s/.test(style.content[start])) start++
    }
    paragraphStart = paragraphEnd + 1
  }
  return lines
}

function canvas(width: number, height: number): { element: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  width = Math.ceil(width); height = Math.ceil(height)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width > LIMITS.maxSide || height > LIMITS.maxSide || width * height > LIMITS.maxSurfacePixels) throw new EditorError('RESOURCE_LIMIT', 'The content raster exceeds the image limit.')
  const element = document.createElement('canvas'); element.width = width; element.height = height
  const context = element.getContext('2d')
  if (!context) throw new EditorError('RENDER_FAILED', 'The content canvas is unavailable.')
  return { element, context }
}
function rgb(color: [number, number, number]): string { return `rgb(${color.map(value => Math.round(value * 255)).join(' ')})` }
export interface InstalledFont {family:string;postscriptName?:string;fullName?:string;style?:string}
let installedFonts:InstalledFont[]=[]
export function setInstalledFontCatalog(fonts:(string|InstalledFont)[]):void {installedFonts=fonts.map(font=>typeof font==='string'?{family:font}:font)}
export function resolvedFont(face:string):{family:string;weight:string;fontStyle:string} {
 const key=face.toLowerCase(),exact=installedFonts.find(font=>[font.postscriptName,font.fullName].some(value=>value?.toLowerCase()===key)),family=installedFonts.filter(font=>font.family.toLowerCase()===key),match=exact??family.find(font=>!font.style||/regular|normal|roman/i.test(font.style))??family[0],style=match?.style??match?.fullName??''
 return {family:match?.family??face,weight:/bold|heavy|black/i.test(style)?'bold':'normal',fontStyle:/italic|oblique/i.test(style)?'italic':'normal'}
}
export function defaultEditorTextStyle():TextStyle {const native=installedFonts.some(font=>font.family.toLowerCase()==='helvetica')||(!installedFonts.length&&typeof navigator!=='undefined'&&/Mac/.test(navigator.platform));return defaultTextStyle(native?'Helvetica':'Arial')}
export function textFontCSS(face:string):string {return JSON.stringify(resolvedFont(face).family)+', sans-serif'}
function cssFont(style: TextStyle, name: string): string {const font=resolvedFont(name);return `${font.fontStyle} ${font.weight} ${style.fontSize}px ${JSON.stringify(font.family)}, sans-serif`}
async function encode(element: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => element.toBlob(value => value ? resolve(value) : reject(new EditorError('RENDER_FAILED', 'Content PNG encoding failed.')), 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}

/** FontFaceSet.check accepts unknown local families, so compare two independent fallback metrics. */
export function fontAvailable(face:string,context:{font:string;measureText:(text:string)=>Pick<TextMetrics,'width'>}):boolean {
 face=resolvedFont(face).family
 if(['serif','sans-serif','monospace','system-ui'].includes(face.toLowerCase()))return true
 const sample='mmmmWWWlll1234567890@#',measure=(family:string)=>{context.font=`40px ${family}`;return context.measureText(sample).width}
 return ['monospace','serif'].some(fallback=>Math.abs(measure(`${JSON.stringify(face)}, ${fallback}`)-measure(fallback))>.01)
}
export function textFontWarnings(style:TextStyle):string[]{const scratch=canvas(1,1).context,missing=[...new Set([style.fontName,...(style.fontRuns??[]).map(run=>run.fontName)])].filter(face=>!fontAvailable(face,scratch));return [...missing.map(face=>`Font “${face}” is unavailable. Choose an installed font before editing; original imported pixels are preserved.`),...(/[\u3400-\u9fff\uf900-\ufaff]/u.test(style.content)?['CJK glyphs may use the operating system’s fallback font; line metrics can differ between macOS and Windows.']:[])]}
/** Point text grows to its measured content; the baseline formula matches native TypeTool. */
export function measureTextFrame(input:TextStyle):{size:[number,number];baseline:number} {
 const text=validateTextStyle(input),scratch=canvas(1,1).context,padding=12
 const measure=(value:string,face:string)=>{scratch.font=cssFont(text,face);return scratch.measureText(value).width}
 const lines=layoutTextLines(text,text.boxSize?Math.max(1,text.boxSize[0]-2*padding):Infinity,measure)
 scratch.font=cssFont(text,text.fontName);const metrics=scratch.measureText('Mg'),descent=metrics.fontBoundingBoxDescent??metrics.actualBoundingBoxDescent??text.fontSize*.2
 return {size:[text.boxSize?.[0]??Math.max(16,Math.ceil(Math.max(0,...lines.map(line=>line.width))+2*padding+text.fontSize*.1)),text.boxSize?.[1]??Math.max(16,Math.ceil(Math.max(1,lines.length)*textLineHeight(text)+2*padding))],baseline:padding+textLineHeight(text)-descent}
}
export async function renderTextPNG(input: TextStyle): Promise<ContentRaster> {
  const text = validateTextStyle(input), scratch = canvas(1, 1).context
  const faces = [...new Set([text.fontName, ...(text.fontRuns ?? []).map(run => run.fontName)])]
  const warnings=textFontWarnings(text),missing=warnings.filter(message=>message.startsWith('Font “'))
  if(missing.length)throw new EditorError('FONT_UNAVAILABLE',missing.join(' '))
  await Promise.all(faces.map(face => document.fonts.load(cssFont(text, face), text.content)))
  const measure = (value: string, face: string): number => { scratch.font = cssFont(text, face); return scratch.measureText(value).width }
  const padding = 12, lines = layoutTextLines(text, text.boxSize ? Math.max(1, text.boxSize[0] - 2 * padding) : Number.POSITIVE_INFINITY, measure)
  const width = text.boxSize?.[0] ?? Math.max(16, Math.ceil(Math.max(0, ...lines.map(line => line.width)) + 2 * padding + text.fontSize * .1))
  const height = text.boxSize?.[1] ?? Math.max(16, Math.ceil(Math.max(1, lines.length) * textLineHeight(text) + 2 * padding))
  const { element, context } = canvas(width, height)
  context.textBaseline = 'alphabetic'; context.save(); context.beginPath(); context.rect(padding, padding, Math.max(1, width - 2 * padding), Math.max(1, height - 2 * padding)); context.clip()
  const baseline=measureTextFrame(text).baseline
  lines.forEach((line, index) => {
    let x = text.alignment === 'Center' ? (width - line.width) / 2 : text.alignment === 'Right' ? width - padding - line.width : padding
    const y = baseline + index * textLineHeight(text)
    for (const span of textSpans(text, line.start, line.end)) {
      context.font = cssFont(text, span.fontName); context.fillStyle = rgb(span.color)
      context.letterSpacing = `${text.tracking}px`
      context.fillText(span.text, x, y)
      x += measure(span.text, span.fontName) + Array.from(span.text).length * text.tracking
    }
  })
  context.restore()
  return { bytes: await encode(element), width: element.width, height: element.height, text, warnings }
}

export async function renderShapePNG(input: ShapeStyle, size: [number, number]): Promise<ContentRaster> {
  const shape = validateShapeStyle(input), { element, context } = canvas(size[0], size[1]), [width, height] = [element.width, element.height]
  context.fillStyle = context.strokeStyle = rgb([shape.red, shape.green, shape.blue]); context.beginPath()
  if (shape.kind === 'Line') {
    const thickness = Math.max(1, shape.lineWidth ?? 1), insetX = Math.min(thickness, width) / 2, insetY = Math.min(thickness, height) / 2
    const start = shape.start ? [shape.start[0] * width, shape.start[1] * height] : [insetX, insetY]
    const end = shape.end ? [shape.end[0] * width, shape.end[1] * height] : [width - insetX, height - insetY]
    context.lineWidth = thickness; context.lineCap = 'round'; context.moveTo(start[0], start[1]); context.lineTo(end[0], end[1]); context.stroke()
  } else {
    if (shape.kind === 'Ellipse') context.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2)
    else context.roundRect(0, 0, width, height, Math.min(shape.cornerRadius, width / 2, height / 2))
    context.fill()
  }
  return { bytes: await encode(element), width, height, shape }
}
