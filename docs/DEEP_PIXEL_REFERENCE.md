# 16-bit pixel reference, f01e298

The foundation keeps dense, top-left, encoded-sRGB, premultiplied RGBA16 samples. Its 8-bit PNG/display copy is derived data; quantizing it does not modify the 16-bit source. This is 16-bit integer sRGB support, not float HDR or a color-management implementation.

`src/shared/deep-pixels.ts` provides:

- `quantizeDeep16ToPremultipliedRGBA8`: port of native `dither_quantize16`, including fixed per-pixel triangular hash noise, Float32 expression boundaries, native rounding, and alpha clamping. Noise is deterministic and independent of worker scheduling. It is not Floyd–Steinberg diffusion.
- `quantizeDeep16ToRGBA8`: the same quantization followed by explicit rounded integer unpremultiplication for straight RGBA8 PNG/display data. Fully transparent RGB is zero. The unpremultiplication is this project's specified storage boundary; it is not presented as an independently checked Core Graphics PNG encoder.
- `applyDeepColorCube`: copy-returning port of native `deep_cube_apply`, with a red-fastest 3D RGBA Float32 cube, trilinear interpolation, premultiplied colors, unchanged 16-bit alpha, and native Float32 expression boundaries. The cube alpha entry is ignored, matching native behavior. This kernel is available for the later adjustment stage and does not by itself enable any editing command.

All entry points validate integer positive geometry, exact sample lengths, a 32-million-pixel ceiling, premultiplied RGB no greater than alpha, and a 512 MiB input/output working budget before allocating an output. Cubes require dimensions 2–65, exactly dimension³ RGBA samples, and only finite floats. Inputs remain unchanged on success or rejection.

## Independent reference

Run `python3 scripts/create-deep-reference.py` to regenerate `fixtures/parity/native-f01e298-deep.json`. The Python script compiles the **unmodified upstream C files**, calls them through ctypes, and never imports or executes production TypeScript. Source is the fixed snapshot `Compositor_Upstream/f01e298`, commit `f01e2980fb76eb085d3f8ac96070a1c0c4a9afa9`.

Compilation uses Apple clang, MacOSX26.5 SDK, `-O2 -ffp-contract=off -fblocks -dynamiclib`. Float contraction is disabled explicitly so the documented Float32 arithmetic is portable. This verifies the kernel under these recorded conditions; it does not claim pixel identity with every native application's Core Image/Core Graphics pipeline or compiler flags.

| Unmodified source | SHA-256 |
| --- | --- |
| DeepPixels.c | `878a5beb9fcd417882e65d551729831fab66b5bdc1f932f07987ae3aa42b08a1` |
| DeepPixels.h | `1112af37c1a3d4347c3f2b6785c2fd1178b0ba544cb448723e951bc63b625925` |
| DitherPixels.c | `5ca1bd334361a95c6f92e7ba807f496734449cf66405fcf99763a918bcea84a7` |
| DitherPixels.h | `bb3e8c4ea08600b3b4773e8bccde70066d53850464f2dd1dba7fa2a885b9372d` |

The 20 C fixtures cover opaque gradients, alpha gradients, very low alpha and rounding boundaries, abrupt color boundaries, and the native parallel-row path. There are 5 premultiplied display-quantization cases and 15 cube cases (identity, mixed channels, and values outside 0–1 that native clamps). RGBA16 and Float32 fixture data use explicit little-endian serialization. On 2026-10-12, all 20 references matched exactly (maximum sample difference **0**); the 21st test checks invalid input rejection. The PNG straight-byte boundary and unchanged source/alpha are checked separately in the same tests.

Command: `npx tsx --test tests/deep-pixels.test.ts`.

These kernels are derived from Compositor's MIT-licensed source, copyright 2026 Wonder Assembly LLC; the existing repository license and upstream attribution remain applicable.
