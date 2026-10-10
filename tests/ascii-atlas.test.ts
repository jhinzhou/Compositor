import {test} from 'node:test'
import assert from 'node:assert/strict'
import {portableASCIIGlyphs,ASCII_CHARACTERS,asciiGlyphSchema,applyASCII} from '../src/shared/ascii-dither'
import {rasterizeASCIIGlyphs} from '../src/renderer/ascii-glyphs'
test('licensed fixed atlas has deterministic default and custom printable coverage for desktop and MCP',()=>{
 for(const size of [6,14,32,64]){const characters=ASCII_CHARACTERS+'ABCxyz!?',desktop=rasterizeASCIIGlyphs(characters,size),headless=portableASCIIGlyphs(characters,size);assert.deepEqual(desktop,headless);headless.forEach(glyph=>assert.equal(asciiGlyphSchema.safeParse(glyph).success,true));assert.equal(atob(headless[0].bitmap).split('').some(value=>value.charCodeAt(0)>0),false)}
 assert.throws(()=>portableASCIIGlyphs('中',14),/explicit rasterized glyph maps/)
})
test('desktop and headless dither produce identical pixels with the shared atlas',()=>{
 const image={width:63,height:37,data:new Uint8ClampedArray(63*37*4)};for(let i=0;i<image.data.length;i+=4){image.data[i]=i%256;image.data[i+1]=(i*3)%256;image.data[i+2]=180;image.data[i+3]=255}
 const settings={characters:ASCII_CHARACTERS,textSize:14,density:0,contrast:20,lightOnDark:true,colors:'blackWhite' as const,dark:'#000000',light:'#ffffff'}
 assert.deepEqual(applyASCII(image,{...settings,glyphs:rasterizeASCIIGlyphs(settings.characters,settings.textSize)}),applyASCII(image,settings))
})
