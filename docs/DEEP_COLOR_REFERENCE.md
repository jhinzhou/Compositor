# Deep color filters, A2

`src/shared/deep-color-filters.ts` reads canonical dense premultiplied RGBA16 directly. It never quantizes the source to RGBA8 before editing. The public `applyDeepColorFilter(pixels, width, height, input)` returns an independent Uint16Array; input samples and alpha remain unchanged. Selection mixing, asset creation, previews, undo and command integration are the command layer's responsibility.

Supported specifications use the existing strict `imageFilterSchema`: Levels, Curves, Exposure, Invert, Hue/Saturation, Black & White, Color Balance, and Gradient Map. `supportsDeepColorFilter` returns false for unsupported or invalid specifications. Geometry, sample counts, premultiplication, finite parameters, a 32 MP ceiling and 512 MiB working budget are validated before producing an output. Identity Levels/Curves/Exposure/HSL/Color Balance return exact copies, preserving every bit.

## Source16 channel-separable processing

Levels runs individual channels then composite RGB with normalized black/white/gamma/output settings. Curves uses shape-preserving cubic Hermite interpolation, individual channels followed by RGB; slopes are compiled once per operation. Exposure decodes sRGB to linear light, applies stops/offset/gamma, then encodes sRGB. Invert subtracts each premultiplied color directly from its alpha.

These operations evaluate the original high-precision sample, then round once into the existing alpha. They are intentionally **direct 16-bit evaluations**, not the native `DeepLayer.run` low/near/far three-pass reconstruction through byte tables. Formula semantics follow the existing/native settings, but full application pixel equality with that approximation or Core Image is not claimed. Analytic tests verify between-byte precision, linear-light Exposure, exact inversion, Curves endpoints/local extrema, and no unwanted alpha changes. Results are not fabricated by expanding edited bytes by 257.

## Mixed-channel lookup

All four mixed-channel operations use native `deep_cube_apply` trilinear interpolation on the original 16-bit source, with the same red-fastest 33³ RGBA Float32 layout:

- HSL retains the native Double lattice evaluation, once-per-degree hue response, range falloff/inversion, Colorize and saturation expansion, then Float32 storage. Normal Lightness now follows real Photoshop 27.11 references: first blend RGB toward black/white, then adjust Hue/Saturation. This intentionally differs from the native HSL-L shift. It never processes a byte source or interpolates a second cube. Colorize retains its unmeasured native Lightness semantics.
- Black & White, Color Balance and Gradient Map follow `GPUAdjustment.cube`: each corner begins as a rounded opaque byte lattice, runs the corresponding native byte-kernel semantics, and is converted to Float32. Only these fixed lattice corners are bytes; input pixels remain 16-bit. This preserves precision between the corners and intentionally retains native lookup behavior.
- Lookup alpha entries are ignored, matching the native deep kernel. Source alpha is unchanged. Fully transparent canonical pixels remain zero.
- Cube cache retains at most 8 entries and callers receive copies, so mutation cannot corrupt a later operation.

## Independent oracle and limits

`scripts/create-deep-color-reference.py` compiles the **unmodified** native `DeepPixels.c`, `AdjustPixels.c` and `LensPixels.c`. For HSL it extracts original pure Swift types and method bodies unchanged into a Foundation command-line executable; the assembly shim supplies test settings, and private method visibility is widened solely to invoke the original builder. It does not execute production TypeScript or Core Image.

Fixed source commit: `f01e2980fb76eb085d3f8ac96070a1c0c4a9afa9` in `Compositor_Upstream/f01e298`. C flags: `-O2 -ffp-contract=off -fblocks -dynamiclib`, MacOSX26.5 SDK. Extracted Swift builds with `-O` against the same SDK. Per-file SHA-256 values, build flags and oracle provenance are recorded in `fixtures/parity/native-f01e298-deep-color.json`. Cube SHA-256 uses explicit little-endian Float32 bytes; expected output uses explicit little-endian RGBA16 samples.

The initial A2 implementation on 2026-10-12 had **9 independent mixed-channel cube hashes and output fixtures matched exactly, maximum sample difference 0**. Fixtures cover global HSL, inverted red range, colorize, default/tinted Black & White, Color Balance with/without preserved luminosity, and normal/reversed colored gradients; image data includes opaque, half-alpha, low-alpha and transparent samples. The original A2 gate had **28 passing tests**, including precision, identity, curve edges, alpha, immutable source/cache and invalid inputs.

Command: `npx tsx --test tests/deep-color-filters.test.ts`.

This is kernel/source-semantic evidence under recorded compiler conditions. It does not establish all Core Graphics/Core Image color-profile behavior, adjustment-layer render equality, natural-image acceptance, Windows execution, or HDR. Root acceptance must verify actual commands, preview/apply, history, engineering file preservation and the packaged runtime separately. Native source remains MIT-licensed, copyright 2026 Wonder Assembly LLC.

## Photoshop alignment after the original A2 gate

Normal HSL with nonzero Lightness now deliberately diverges from the historical native fixture. The fixture and its SHA values remain immutable; current native cube checks cover seven unchanged rows (including Colorize), excluding two normal-Lightness rows. The actual Photoshop regression contains 13 cases: pure Hue/Saturation, negative/positive Lightness, combined HSL in RGB8/16, and RGB8 Curves horizontal endpoints. The inputs are self-authored, untagged diagnostic images. `scripts/capture-photoshop-effect-fixtures.ts` only decodes actual Photoshop exports; it never runs a product algorithm to manufacture expected pixels.

`tests/photoshop-effect-reference.test.ts` states measured tolerances explicitly. These are not universal byte-exact Photoshop claims. The retained 33³ cube produces up to 230 RGB16 LSB error for combined HSL on the cube, while pure Lightness stays within 9 LSB. Alpha remains exact. See `docs/PHOTOSHOP_EFFECT_MEASUREMENTS_2026-10-12.md` for full metrics and limitations.
