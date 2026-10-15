# High-depth destructive filter reference (2026-10-12)

The filter source is the canonical dense premultiplied RGBA16 UNORM or Float32 encoded extended-sRGB asset. Display PNG8 is never its input. `prepareHighDepthFilter(stage, layer.filter)` returns `{deep? | hdr?, width, height, transform, maskPNG?}` without mutating the stage; the caller installs the matching depth asset and records undo.

## Precision and scope

| Filter | UNORM16 path | HDR path |
| --- | --- | --- |
| Levels / Curves / Exposure / Invert / HSL / Black & White / Color Balance / Gradient Map | Existing direct16 or native33 color cube | Existing HDR color adapter; Exposure directly in extended float |
| Gaussian / Motion / Bloom | Float32 premultiplied working planes, rounded once to RGBA16 | Float32 premultiplied working planes, negative/overwhite color retained |
| Grain / Noise / Vignette / Tonal Contrast / Scanlines | Native multi-probe reconstruction around the portable byte operator | Native normalize → multi-probe → restore on the same raster grid |
| Lens Correction | Native multi-probe reconstruction | Direct Float32 radial coordinate mapping and bilinear source sampling |
| Camera Raw | Ten independent channel probes and native fitted reconstruction around the existing portable Camera Raw operator | Same bridge after normalization for neutral geometry/optical warp only |
| Dither | Multi-probe precision extension | Normalize/restore precision extension |

Native f5ae5ba `FilterEdit.commit` deliberately rasterizes **Dither to 8-bit**. Keeping a canonical high-depth result here is an extension and must not be reported as native Dither bit-depth parity. Native HDR non-spatial filters themselves normalize negative colors to zero and restore source peak scales; this is intentional for those byte operators. Spatial Gaussian/Motion/Bloom/Lens preserve negative color values directly.

Camera Raw geometry, guided correction, optical distortion, lens-profile distortion, and chromatic-aberration shifts are rejected for HDR before allocation or mutation. The existing byte pipeline privately orders geometry → color → optics → detail; separating those pieces without a coordinated pipeline change would reorder effects. Native HDR normalization with a pixel warp also restores the wrong destination peak scale. A separate HDR Lens Correction is available and samples actual source highlights. Neutral geometry with a color/lens-vignette/defringe adjustment remains accepted. This matrix describes destructive filters only; adjustment-layer support is a separate guarded matrix.

Gaussian preserves transparency by dividing out blurred alpha and restoring original alpha, as native `Filters.swift` does. Gaussian and Motion honor native canvas-edge carry and do not pad those edges; other sides grow by the existing native blur margin. Rotated Motion uses Float32 rotation/resampling and one integrated Gaussian pass. Selection blending copies every zero-coverage original sample exactly. Trimming tests true high-depth alpha, preserving faint pixels that native byte-dithered trim can drop. Linked PNG8 masks carry their original document coverage over a changed raster and transform.

The portable Gaussian uses integrated Gaussian footprints and FFT at large workloads. Motion uses the portable Core Image approximation already established in the project, with Float32 intermediates. Bloom carries the established portable behavior `max(source, source + (Gaussian(source) - source) * amount/50)` into Float32. Core Image CIBloom internals, GPU scheduling, half writes, and a complete native Camera Raw pipeline have not been independently executed here; those remain separate pixel-parity gates.

## Independent C bridge oracle

Run `python3 scripts/create-deep-filter-reference.py`. The generator compiles **unchanged** `f5ae5bad0b25b32dda9f254e62d2f07f59478698/Compositor/Rendering/DeepPixels.c` with SDK MacOSX26.5, `-O2 -ffp-contract=off -fblocks -dynamiclib`. Both source file SHA-256 digests and compiler flags are recorded in `fixtures/parity/native-f5ae5ba-deep-filter.json`.

Twenty C cases cover deterministic low probes, 1/2/4 step probes, least-squares fits, steep bends, low alpha, full alpha, zero alpha, and the native parallel-row branch. Four Camera Raw cases run each of ten **native C-produced** probe images through the existing portable byte operator in an independent fixture callback process, then reconstruct using the original C merge. This proves the new bridge around that callback, not the callback's equivalence to native Core Image Camera Raw. Synthetic independent Python byte operators cover identity, invert, nonlinear bend, and cross-channel mixing.

All 6,010 fixture pixels / 24,040 RGBA channels reconstruct exactly against C (maximum difference zero), and every native probe byte matches. Native merge alpha is intentionally the low operation's alpha byte ×257; direct color filters and floating-point spatial paths preserve finer alpha according to their own contracts. Four-run identity preserves non-257 RGB precision within one code value despite its native byte-alpha boundary.

The targeted suites contain 47 passing tests after the additional canvas-edge Motion and analytical HDR Lens checks. Validation includes canonical source immutability, unselected sample precision, non-257 output, extended color, opacity/outline, rotated/flipped geometry and linked masks, and pre-allocation size/work rejection. Strict targeted TypeScript checks include the repository's pako declaration. Whole-application, packaged runtime and platform acceptance belong to the parent unified gate.

## Budgets

All source and result dimensions are validated before expansion. The wrapper includes retained encoded/display sources, normalized inputs/scales, probe outputs, selection/crop/mask buffers, and spatial scratch in a conservative 512 MiB bound. Camera Raw reserves more scratch than simple filters. Gaussian passes additionally enforce 500 million estimated operations and include FFT workspace; diagonal Motion validates the rotated intermediate before allocation. Operators reject changed dimensions, invalid premultiplication, unsupported HDR settings, non-finite colors, and oversized work without writing source state.

## Adjustment-layer integration

`high-depth-adjustment.ts` extends the previous eight color adjustments with Grain, Add Noise, Gaussian and Motion: **12 native adjustment kinds** total. `LayerAdjustment.swift:applySixteenBit` is the source-backed split: Gaussian/Motion render at the source depth, Exposure uses exact HDR, mixed color uses lookup tables, and Grain/Noise use `DeepLayer.run`. Full canonical canvas coordinates anchor deterministic grain/noise; viewport cropping happens after the whole stack and does not reseed either effect.

The adapter keeps canvas dimensions fixed and accepts `{preserveAlpha?: boolean}` (default true for existing direct callers). Compositors opt out for **Normal Gaussian/Motion**, following native `LiveMaskRenderer.adjust`: `applySixteenBit` produces the blurred RGBA, opacity uses `CIBlendWithMask`, and the image is drawn with copy behavior. Thus color and alpha spread into previously transparent neighbors; masks and opacity interpolate all four premultiplied channels. Gaussian Preserve Transparency divides out blurred alpha and restores original alpha. Non-Normal adjustment blending restores the original target alpha, as the native renderer does. Existing direct helper calls retain their previous alpha-preserving behavior.

Existing compositor mask, group mask, opacity, clipping and blend handling remains in charge. The adapter processes full-strength color once. Inspection includes peak adjustment scratch and convolution work; `adjustment.add` inspects a temporary candidate layer before committing, and HDR routing follows referenced manifest images rather than stale staged assets. Thus an HDR→UNORM16 conversion batch can use UNORM16 blend modes even while the old EXR remains in undo/staging storage.

The new adjustment suite has 31 passing tests: same-size/source/alpha precision, >white and negative floating blur, outline color, analytical mask × opacity blending, deterministic Grain, add/set Undo/Redo, clipped-stack isolation, early budget rejection, and conversion-batch routing. The final Normal-blur alpha correction passed 96 combined adapter/compositor tests. Independent integrated Gaussian footprint expectations verify transparent-neighbor growth, mask/opacity alpha interpolation, and non-Normal/Preserve Transparency outline retention. No native Core Image GPU whole-stack equivalence is claimed.
