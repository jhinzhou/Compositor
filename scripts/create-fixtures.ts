import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { randomUUID } from 'node:crypto'

const width = 1200, height = 900
const root = 'fixtures/demo.comp'
await mkdir(join(root, 'images'), { recursive: true })
const layers: unknown[] = []
async function layer(name: string, pixel: (x: number, y: number) => number[], opacity = 1): Promise<void> {
  const image = new PNG({ width, height })
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const value = pixel(x, y), offset = (y * width + x) * 4
    for (let channel = 0; channel < 4; channel++) image.data[offset + channel] = value[channel]
  }
  const id = randomUUID().toUpperCase(), imageFile = `${id}.png`
  await writeFile(join(root, 'images', imageFile), PNG.sync.write(image))
  layers.push({ id, name, imageFile, isVisible: true, isGroup: false, opacity, blendMode: 'Normal', transform: { origin: [0, 0], size: [width, height], rotation: 0, flipX: false, flipY: false, sampling: 'High quality' } })
}
await layer('Sky', (_x, y) => { const t = y / height; return [24 + t * 36, 44 + t * 41, 58 + t * 36, 255] })
await layer('Sun', (x, y) => Math.hypot(x - 815, y - 285) < 120 ? [231, 186, 123, 255] : [0, 0, 0, 0])
await layer('Distant ridge', (x, y) => y > 540 - 150 * Math.sin(x / 290) - 95 * Math.sin(x / 115 + 1.2) ? [77, 109, 120, 255] : [0, 0, 0, 0])
await layer('Mountain', (x, y) => { const edge = 730 - 370 * Math.max(0, 1 - Math.abs(x - 435) / 490); return y > edge ? (x > 435 ? [34, 66, 76, 255] : [42, 79, 89, 255]) : [0, 0, 0, 0] })
await layer('Foreground', (x, y) => y > 800 - 65 * Math.sin(x / 260 + 1.7) ? [21, 44, 54, 255] : [0, 0, 0, 0])
const manifest = { format: 'com.compositor.project', version: 11, colorSpace: 'sRGB', documentID: randomUUID().toUpperCase(), width, height, resolution: 72,
  activeLayerID: (layers[1] as { id: string }).id, layers }
await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`Created ${root}: ${width}×${height}, ${layers.length} layers`)
