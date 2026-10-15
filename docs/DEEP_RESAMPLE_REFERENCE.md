# RGBA16 resampling reference

`src/core/deep-resample.ts` consumes dense, top-left, native-endian, premultiplied sRGB `Uint16Array` samples. RGB must not exceed alpha. It never decodes a display PNG or changes the input array. Image Size returns a new upright raster and its placement; document selections, mask placement, styles and the atomic editor transaction remain the caller's responsibility.

## Public interfaces

- `bakeDeepImageSizeRaster({ width, height, deep }, transform, sx, sy, sampling)` returns `{ width, height, deep, transform }`. Sampling is `Nearest`, `Smooth` or `High quality`.
- `sampleDeepLayerInDocument(source, transform, canvasWidth, canvasHeight)` returns an RGBA16 document work grid for Smudge and Liquify. It reproduces the existing retouch grid's direct bilinear geometry, transparent boundary and pixel centers, irrespective of the layer's display sampling. It does not use a display cache or first reduce the image.
- `sampleDeepBilinear(data, width, height, x, y, { edgeClamp? })` returns floating premultiplied RGBA16 channel values. Coordinates are measured from image edges; the first pixel center is `(0.5, 0.5)`. The default boundary is transparent. Callers round only after their final blend.

## Independent native reference

`scripts/generate-deep-image-size-reference.py` compiles a temporary Swift/CoreGraphics reference from unmodified transform and rendering source in upstream snapshot `f01e2980fb76eb085d3f8ac96070a1c0c4a9afa9`. Its source is a premultiplied RGBA16 CGImage and its output context is also 16 bit. The script records the source commit, file hashes, parameters and raw RGBA16 output in `fixtures/parity/native-deep-image-size.json`.

The 32 Nearest fixtures combine four rotations, four flip combinations and two anisotropic scales, including alpha values 65535, 32768, 1 and 0 and channels that are not multiples of 257. Placement bounds match in every case. Thirty-one cases match every sample. One 90-degree flipped case differs in 32 channel values only at transformed coordinates that lie exactly on a source-pixel boundary; CoreGraphics and the portable implementation resolve floating boundary ties differently. The test both restricts the exception to those coordinates and checks the observed mismatch count. This is not a claim of universal CoreGraphics pixel parity.

## True 16-bit reduction and quality limits

Smooth and High quality use a true RGBA16 Lanczos reduction chain for reductions below one half, followed by bilinear affine sampling unless the final phase permits an exact copy. The chain uses transparent padding, at most six halving levels and `2 ** level` phase, including odd source sizes. It uses a Float32 horizontal intermediate, then rounds final samples and constrains premultiplied RGB to alpha. A separately implemented direct 2D double-precision scalar reference verifies odd-size reduction within one 16-bit sample. Nearest enlargement and identity sampling preserve all original RGBA16 samples exactly.

Upstream `DownsampleCache.halve` currently allocates an ARGB8888 cache even for a deep source. This implementation deliberately retains 16-bit precision through every reduction level. Consequently the high-quality chain is an independently checked portable algorithm, not byte parity with that 8-bit native cache. CoreGraphics' private interpolation and boundary antialiasing can also differ from the final portable bilinear and 4-by-4 boundary coverage. The native fixture is macOS reference evidence and does not establish a Windows runtime result.

## Resource and regression checks

Each operation checks the source and target pixel limits before allocating a working raster. Its working estimate includes the input RGBA16 array, output, retained reduction levels and the largest Float32 intermediate, capped at 512 MiB with a 500-million-work estimate. The editor separately accounts for canonical source/display bytes, other live documents and history. Invalid premultiplied data and oversized operations fail before changing source pixels.

Run `npx tsx --test tests/deep-resample.test.ts` for native Nearest reference, alpha-1 and sub-byte precision, direct premultiplied Smooth interpolation, odd-size reduction, transformed work grids, transparent fractional edges, immutable inputs and atomic budget rejection. Regenerate the fixture only on macOS with the pinned upstream snapshot available: `python3 scripts/generate-deep-image-size-reference.py`.
