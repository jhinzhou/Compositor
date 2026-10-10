import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {readFileSync} from 'node:fs'
import { decodeExportPNG } from '../src/core/export-codecs'
import { decodeTIFF, tiffToPNG } from '../src/core/tiff-import'

test('TIFF RGB raw, LZW, Deflate, and PackBits independently match Pillow PNG pixels', async () => {
  const expected = decodeExportPNG(await readFile('fixtures/formats/tiff-reference.png'))
  for (const format of ['raw', 'tiff_lzw', 'tiff_adobe_deflate', 'packbits']) {
    const actual = decodeTIFF(await readFile(`fixtures/formats/${format}.tiff`))
    assert.equal(actual.width, expected.width); assert.equal(actual.height, expected.height)
    assert.deepEqual([...actual.data], [...expected.data], format)
  }
})
test('TIFF alpha, gray, and indexed color retain their semantic pixels', async () => {
  const alpha = decodeExportPNG(tiffToPNG(await readFile('fixtures/formats/alpha.tiff')))
  assert.deepEqual([...alpha.data], [255, 0, 0, 128, 0, 255, 0, 0])
  assert.deepEqual([...decodeTIFF(await readFile('fixtures/formats/gray.tiff')).data], [0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255])
  assert.deepEqual([...decodeTIFF(await readFile('fixtures/formats/palette.tiff')).data], [255, 0, 0, 255, 0, 0, 255, 255])
})
test('TIFF applies all eight orientation transforms and rejects invalid directories and oversized dimensions', async () => {
  const original = await readFile('fixtures/formats/raw.tiff'), ifd = original.readUInt32LE(4), count = original.readUInt16LE(ifd)
  const entries = Array.from({ length: count }, (_, index) => ifd + 2 + 12 * index)
  const width = entries.find(at => original.readUInt16LE(at) === 256)!, firstStrip = entries.find(at => original.readUInt16LE(at) === 273)!
  const huge = Buffer.from(original); huge.writeUInt32LE(90000, width + 8); assert.throws(() => decodeTIFF(huge), /dimensions/)
  const badStrip = Buffer.from(original); badStrip.writeUInt32LE(original.length + 5, firstStrip + 8); assert.throws(() => decodeTIFF(badStrip), /Truncated/)
  assert.throws(() => decodeTIFF(original.subarray(0, 20)), /Truncated/)
  assert.throws(() => decodeTIFF(Uint8Array.from([73, 73, 43, 0, 0, 0, 0, 0])), /BigTIFF/)
  const little = true, pixelBytes = [1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0, 5, 0, 0, 6, 0, 0]
  for (const endian of [little, !little]) for (let orientation = 1; orientation <= 8; orientation++) {
    const tags = [[256, 3, 1, 3], [257, 3, 1, 2], [258, 3, 1, 8], [259, 3, 1, 1], [262, 3, 1, 2], [273, 4, 1, 8 + 2 + 9 * 12 + 4], [274, 3, 1, orientation], [277, 3, 1, 3], [279, 4, 1, 18]]
    const data = Buffer.alloc(8 + 2 + tags.length * 12 + 4 + pixelBytes.length), u16 = (value: number, at: number) => endian ? data.writeUInt16LE(value, at) : data.writeUInt16BE(value, at), u32 = (value: number, at: number) => endian ? data.writeUInt32LE(value, at) : data.writeUInt32BE(value, at)
    data.write(endian ? 'II' : 'MM'); u16(42, 2); u32(8, 4); u16(tags.length, 8)
    tags.forEach(([tag, type, count, value], index) => { const at = 10 + index * 12; u16(tag, at); u16(type, at + 2); u32(count, at + 4); if (type === 3) u16(value, at + 8); else u32(value, at + 8) })
    data.set(pixelBytes, data.length - pixelBytes.length)
    const actual = decodeTIFF(data), orders = [[1, 2, 3, 4, 5, 6], [3, 2, 1, 6, 5, 4], [6, 5, 4, 3, 2, 1], [4, 5, 6, 1, 2, 3], [1, 4, 2, 5, 3, 6], [4, 1, 5, 2, 6, 3], [6, 3, 5, 2, 4, 1], [3, 6, 2, 5, 1, 4]]
    assert.deepEqual([...actual.data].filter((_, index) => index % 4 === 0), orders[orientation - 1])
    assert.equal(actual.width, orientation >= 5 ? 2 : 3)
  }
})

test('TIFF tiles, separate planes, FillOrder and packed 1-bit gray match independent libtiff/Pillow references',async()=>{
 for(const name of ['planar8','tile8','tile-planar8','fill-order2','gray1','gray4','palette2']){
  const actual=decodeTIFF(await readFile(`fixtures/formats/tiff-extended/${name}.tiff`)),expected=decodeExportPNG(await readFile(`fixtures/formats/tiff-extended/${name}.png`))
  assert.equal(actual.width,expected.width,name);assert.equal(actual.height,expected.height,name);assert.deepEqual([...actual.data],[...expected.data],name)
 }
})
test('unsigned 16-bit LE/BE, tiled/separate planes and numeric horizontal predictor quantize to independent RGBA8 reference',async()=>{
 for(const name of ['rgb16-le','rgb16-be','tile16','planar16','predictor16','associated16','associated16-tile-planar']){
  const actual=decodeTIFF(await readFile(`fixtures/formats/tiff-extended/${name}.tiff`)),expected=decodeExportPNG(await readFile(`fixtures/formats/tiff-extended/${name}.png`))
  assert.equal(actual.width,expected.width,name);assert.equal(actual.height,expected.height,name);assert.deepEqual([...actual.data],[...expected.data],name);assert.match(actual.warnings.join(' '),/16-bit.*quantized/)
 }
})
test('matrix/TRC ICC is converted to sRGB and LUT/grayscale profiles, HDR and CMYK fail explicitly',async()=>{
 const bytes=await readFile('fixtures/formats/tiff-extended/icc-srgb.tiff'),actual=decodeTIFF(bytes),expected=decodeExportPNG(await readFile('fixtures/formats/tiff-extended/icc-srgb.png'))
 assert.match(actual.colorProfile,/ICC.*sRGB/);for(let i=0;i<actual.data.length;i++)assert.ok(Math.abs(actual.data[i]!-expected.data[i]!)<=1,`ICC byte ${i}`)
 const signature=bytes.indexOf('acsp'),bad=Buffer.from(bytes);assert.ok(signature>=36);bad.write('CMYK',signature-20);assert.throws(()=>decodeTIFF(bad),/TIFF ICC conversion failed/)
 const lut=Buffer.from(bytes),profileStart=signature-36,count=lut.readUInt32BE(profileStart+128);let xyz=-1;for(let i=0;i<count;i++){const at=profileStart+132+i*12;if(lut.toString('ascii',at,at+4)==='rXYZ')xyz=profileStart+lut.readUInt32BE(at+4)}assert.ok(xyz>signature);lut.write('mft2',xyz);assert.throws(()=>decodeTIFF(lut),/ICC.*LUT/);assert.throws(()=>decodeTIFF(readFileSync('fixtures/formats/tiff-extended/gray-icc.tiff')),/grayscale ICC/)
 assert.throws(()=>decodeTIFF(readFileSync('fixtures/formats/tiff-extended/hdr-float.tiff')),/HDR.*tone mapping/)
 assert.throws(()=>decodeTIFF(readFileSync('fixtures/formats/tiff-extended/cmyk.tiff')),/CMYK.*conversion/)
})

test('TIFF validates padded tile work, directory counts, codec and float format before decoding or allocating pixels',async()=>{
 const original=await readFile('fixtures/formats/tiff-extended/tile16.tiff')
 const changed=(tag:number,value:number)=>{const bytes=Buffer.from(original),ifd=bytes.readUInt32LE(4),count=bytes.readUInt16LE(ifd);for(let i=0;i<count;i++){const at=ifd+2+i*12;if(bytes.readUInt16LE(at)===tag){if(bytes.readUInt16LE(at+2)===3)bytes.writeUInt16LE(value,at+8);else bytes.writeUInt32LE(value,at+8);return bytes}}throw Error(`Fixture has no tag ${tag}`)}
 const huge=changed(322,29984),ifd=huge.readUInt32LE(4),count=huge.readUInt16LE(ifd);for(let i=0;i<count;i++){const at=ifd+2+i*12;if(huge.readUInt16LE(at)===323)huge.writeUInt32LE(29984,at+8)}
 assert.throws(()=>decodeTIFF(huge),/working memory|codec.*budget/)
 const excessInput=Buffer.alloc(original.length+1_000_000);changed(325,1_000_000).copy(excessInput);assert.throws(()=>decodeTIFF(excessInput),/compressed.*codec work budget/)
 assert.throws(()=>decodeTIFF(changed(259,7)),/JPEG.*external conversion/)
 assert.throws(()=>decodeTIFF(changed(324,original.length+200)),/Truncated/)
 assert.throws(()=>decodeTIFF(original.subarray(0,original.length-10)),/Truncated/)
 assert.deepEqual(await readFile('fixtures/formats/tiff-extended/tile16.tiff'),original)
})
