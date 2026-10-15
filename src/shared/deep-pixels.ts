/** Canonical deep pixels: dense top-left sRGB, premultiplied RGBA16 samples.
 * Native reference: Compositor f01e298 DeepPixels.c and DitherPixels.c.
 * Display quantization never changes the deep source.
 */
const f = Math.fround;
const SCALE8 = f(255 / 65535);
export const MAX_DEEP_PIXELS = 32_000_000;
export const MAX_DEEP_WORKING_BYTES = 512 * 1024 * 1024;

function checkedPixels(pixels: Uint16Array, width: number, height: number, outputBytes: number): number {
  if (!(pixels instanceof Uint16Array) || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new RangeError('Deep pixels require positive integer dimensions and Uint16Array samples.');
  }
  const count = width * height;
  if (!Number.isSafeInteger(count) || count > MAX_DEEP_PIXELS || pixels.length !== count * 4) {
    throw new RangeError('Deep pixel dimensions or sample count exceed the supported budget.');
  }
  if (pixels.byteLength + outputBytes > MAX_DEEP_WORKING_BYTES) throw new RangeError('Deep pixel working memory exceeds the supported budget.');
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] > pixels[i + 3] || pixels[i + 1] > pixels[i + 3] || pixels[i + 2] > pixels[i + 3]) {
      throw new RangeError('Deep RGB samples must be premultiplied and no greater than alpha.');
    }
  }
  return count;
}

function roundAway(value: number): number { return value < 0 ? -Math.floor(-value + .5) : Math.floor(value + .5); }
function hashNoise(x: number, y: number, draw: number): number {
  let h = (Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77) ^ Math.imul(draw, 0xc2b2ae3d)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return f((h >>> 8) / (1 << 24));
}

/** Matches native dither_quantize16: fixed triangular noise, premultiplied RGBA8. */
export function quantizeDeep16ToPremultipliedRGBA8(pixels: Uint16Array, width: number, height: number): Uint8Array {
  const count = checkedPixels(pixels, width, height, width * height * 4);
  const out = new Uint8Array(count * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4;
    const alpha = roundAway(f(pixels[at + 3] * SCALE8));
    for (let c = 0; c < 3; c++) {
      const value = f(f(f(f(pixels[at + c] * SCALE8) + hashNoise(x, y, c)) + hashNoise(x, y, c + 3)) - 1);
      out[at + c] = Math.max(0, Math.min(alpha, roundAway(value)));
    }
    out[at + 3] = alpha;
  }
  return out;
}

/** Straight RGBA8 for PNG/display assets. Alpha-zero RGB is canonical zero.
 * This boundary uses rounded integer unpremultiplication; the independent native
 * oracle applies to the premultiplied quantization stage above.
 */
export function quantizeDeep16ToRGBA8(pixels: Uint16Array, width: number, height: number): Uint8Array {
  const out = quantizeDeep16ToPremultipliedRGBA8(pixels, width, height);
  for (let i = 0; i < out.length; i += 4) {
    const alpha = out[i + 3];
    for (let c = 0; c < 3; c++) out[i + c] = alpha ? Math.min(255, Math.floor((out[i + c] * 255 + Math.floor(alpha / 2)) / alpha)) : 0;
  }
  return out;
}

/** Pure copy-returning native deep_cube_apply. Red varies fastest in RGBA float cube.
 * Cube alpha is unused by native; source coverage is preserved exactly.
 */
export function applyDeepColorCube(pixels: Uint16Array, width: number, height: number, cube: Float32Array, dimension: number): Uint16Array {
  if (!(cube instanceof Float32Array) || !Number.isSafeInteger(dimension) || dimension < 2 || dimension > 65 || cube.length !== dimension ** 3 * 4) {
    throw new RangeError('Deep color cube requires dimension 2–65 and exactly dimension³ RGBA Float32 samples.');
  }
  checkedPixels(pixels, width, height, pixels.byteLength + cube.byteLength);
  for (const value of cube) if (!Number.isFinite(value)) throw new RangeError('Deep color cube samples must be finite.');
  const out = pixels.slice();
  const scale = f((dimension - 1) / 65535), sy = dimension * 4, sz = dimension * dimension * 4;
  const mix = (a: number, b: number, t: number): number => f(a + f(f(b - a) * t));
  for (let at = 0; at < pixels.length; at += 4) {
    const alpha = pixels[at + 3];
    if (!alpha) continue;
    const lo = [0, 0, 0], frac = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const pos = f(Math.min(65535, f(f(pixels[at + c] * 65535) / alpha)) * scale);
      lo[c] = Math.min(dimension - 2, Math.trunc(pos));
      frac[c] = f(pos - lo[c]);
    }
    const base = (lo[0] + lo[1] * dimension + lo[2] * dimension * dimension) * 4;
    for (let c = 0; c < 3; c++) {
      const k = base + c;
      const x00 = mix(cube[k], cube[k + 4], frac[0]), x10 = mix(cube[k + sy], cube[k + sy + 4], frac[0]);
      const x01 = mix(cube[k + sz], cube[k + sz + 4], frac[0]), x11 = mix(cube[k + sz + sy], cube[k + sz + sy + 4], frac[0]);
      const result = mix(mix(x00, x10, frac[1]), mix(x01, x11, frac[1]), frac[2]);
      out[at + c] = Math.min(alpha, Math.max(0, roundAway(f(result * alpha))));
    }
  }
  return out;
}
