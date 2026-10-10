import {LIMITS} from '../shared/limits'
/** SVG import is a raster conversion. External resources and executable content are rejected. */
export async function svgToPNG(source: string): Promise<Uint8Array> {
  if (new TextEncoder().encode(source).length > 16 * 1024 * 1024) throw new Error('SVG exceeds the 16 MiB import limit.')
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('SVG document types and entities are not supported.')
  const document = new DOMParser().parseFromString(source, 'image/svg+xml'), root = document.documentElement
  if (document.querySelector('parsererror') || root.localName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg') throw new Error('Invalid SVG document.')
  const descendants = [...root.querySelectorAll('*')]; if (descendants.length > 10000) throw new Error('SVG exceeds the 10,000-element import budget.')
  for (const node of [root, ...descendants]) {
    if (['script', 'foreignobject', 'animate', 'animatetransform', 'animatemotion', 'set'].includes(node.localName.toLowerCase())) throw new Error('Executable or animated SVG content is not supported.')
    for (const attribute of [...node.attributes]) {
      const name = attribute.localName.toLowerCase(), value = attribute.value.trim()
      if (name.startsWith('on') || /javascript\s*:/i.test(value)) throw new Error('Executable SVG attributes are not supported.')
      if (['href', 'src'].includes(name) && !value.startsWith('#') && !/^data:image\/(png|jpeg|webp);base64,[a-z\d+/=\s]+$/i.test(value)) throw new Error('SVG external resources are not supported.')
      if (['href','src'].includes(name) && value.startsWith('data:image/')) validateEmbeddedImage(value)
      validateStyle(value)
    }
    if (node.localName.toLowerCase() === 'style') validateStyle(node.textContent ?? '')
  }
  const viewBox = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number)
  const length = (value: string | null) => {
    if (!value) return undefined
    const match = /^([+\d.e-]+)\s*(px|in|cm|mm|pt|pc)?$/i.exec(value.trim())
    if (!match) return undefined
    return Number(match[1]) * ({ px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, pt: 96 / 72, pc: 16 }[match[2]?.toLowerCase() ?? 'px'] ?? 1)
  }
  const width = Math.round(length(root.getAttribute('width')) ?? (viewBox?.length === 4 ? viewBox[2] : 300)), height = Math.round(length(root.getAttribute('height')) ?? (viewBox?.length === 4 ? viewBox[3] : 150))
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width > LIMITS.maxSide || height > LIMITS.maxSide || width * height > LIMITS.maxSurfacePixels) throw new Error('SVG dimensions exceed import limits.')
  root.setAttribute('width', String(width)); root.setAttribute('height', String(height))
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(root))}`
  try {
    const image = new Image(); image.src = url; await image.decode()
    const canvas = window.document.createElement('canvas'); canvas.width = width; canvas.height = height
    const context = canvas.getContext('2d'); if (!context) throw new Error('SVG raster surface could not be allocated.')
    context.drawImage(image, 0, 0, width, height)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('SVG PNG encoding failed.')), 'image/png'))
    return new Uint8Array(await blob.arrayBuffer())
  } catch (error) { throw error }
}
function validateStyle(value: string): void {
  if (/@import|@font-face|expression\s*\(/i.test(value)) throw new Error('SVG external styles are not supported.')
  for (const match of value.matchAll(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi)) if (!match[2].trim().startsWith('#')) throw new Error('SVG external resources are not supported.')
  if (value.includes('\\')) throw new Error('Escaped SVG resource syntax is not supported.')
}

function validateEmbeddedImage(value: string): void {
  const encoded = value.slice(value.indexOf(',') + 1).replace(/\s/g, ''); if (encoded.length > 8 * 1024 * 1024) throw new Error('SVG embedded image exceeds its encoded budget.')
  let binary: string; try { binary = atob(encoded) } catch { throw new Error('Invalid SVG embedded image encoding.') }
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0)), view = new DataView(bytes.buffer); let size: [number,number] | undefined
  if (bytes.length >= 24 && bytes[0] === 137 && bytes[1] === 80) size = [view.getUint32(16), view.getUint32(20)]
  else if (bytes.length >= 30 && binary.slice(0,4) === 'RIFF' && binary.slice(8,12) === 'WEBP') { const kind = binary.slice(12,16); if (kind === 'VP8X') size = [1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16), 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16)]; else if (kind === 'VP8 ' && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) size = [view.getUint16(26,true) & 16383, view.getUint16(28,true) & 16383]; else if (kind === 'VP8L' && bytes[20] === 47) { const n=view.getUint32(21,true); size=[(n & 16383)+1,((n>>>14)&16383)+1] } }
  else if (bytes[0] === 255 && bytes[1] === 216) { let i=2; while(i < bytes.length-8){if(bytes[i++] !== 255)continue;while(bytes[i]===255)i++;const marker=bytes[i++]!;if(marker===218||marker===217)break;if(marker===1||marker>=208&&marker<=215)continue;const length=view.getUint16(i);if(length<2||i+length>bytes.length)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){size=[view.getUint16(i+5),view.getUint16(i+3)];break}i+=length} }
  if (!size || size[0]<1 || size[1]<1 || size[0]>LIMITS.maxSide || size[1]>LIMITS.maxSide || size[0]*size[1]>16_000_000) throw new Error('SVG embedded image has invalid dimensions or exceeds its 16-megapixel decoder budget.')
}
