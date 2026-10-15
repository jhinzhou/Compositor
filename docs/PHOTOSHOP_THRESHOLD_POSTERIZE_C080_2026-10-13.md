# C080: Threshold / Posterize source-precision implementation

This batch adds two independent destructive color operations to the existing
`layer.filter` path. It does not add undocumented Compositor adjustment records.

## Primary-source semantics and implementation boundary

Adobe describes Threshold as a brightness cutoff producing black or white, and
Posterize as a chosen number of brightness levels **per channel**, assigning
colors to matching levels. Both are available through Image > Adjustments.
[Adobe: Apply special color effects to images](https://helpx.adobe.com/photoshop/desktop/adjust-color/color-effects-techniques/apply-special-color-effects-to-images.html)

The documentation does not specify the private grayscale coefficients, input
bin boundaries, midpoint ties, or higher-bit-depth rounding. The initial
Rec.709/nearest-level candidate was therefore checked against native Photoshop
27.11 controls and corrected using one uniform rule:

- Threshold: encoded RGB .30/.59/.11 brightness, cutoff maps into each depth. RGB8 rounds
  brightness to a byte before comparison; RGB16 keeps source brightness and compares
  against `floor(level*32768/255)/32768`.
  Equality produces white. Controls accept integer 1–255, default 128.
- Posterize: equal-width input channel bins, not nearest-level input rounding.
  RGB8 uses `floor(byte * levels / 256)`, capped at `levels-1`, and truncates the
  evenly spaced output palette to bytes. RGB16 computes the input bin from `round(channel*32768)` and
  uses an output palette truncated in Photoshop's 0–32768 domain, then
  expanded to our full-range source domain. The evaluated color is temporarily mapped to the native 15+1 lattice for
  this deliberately discrete operation; canonical source/alpha and Undo storage
  remain full precision. Input is never converted to PNG8.
  Controls accept integer 2–255, default 4. UI ranges/defaults are project choices.

Native evidence comes from Photoshop DOM `ArtLayer.threshold` / `posterize`
executed by the parent through actual CUA File > Scripts > Browse. All eight v2
outputs really changed pixels; native IHDR verifies 8/16-bit output. This is
native command pixel evidence, not a manually exercised Image > Adjustments
menu, preview, or dialog acceptance. Raw PNGs/logs remain unchanged; immutable
source/script/output/raw-RGBA SHA and compressed samples are archived in
`fixtures/parity/photoshop-27.11-discrete-adjustments-v2.json`.

| Native sample | Previous max / MAE | Corrected max / MAE |
| --- | --- | --- |
| Posterize4 RGB8 | 85 / 5.2295 | 0 / 0 |
| Posterize8 RGB8 | 37 / 2.9661 | 0 / 0 |
| Threshold128 RGB8 | 255 / 6.2256 | 0 / 0 |
| Threshold64 RGB8 | 255 / 16.5601 | 0 / 0 |
| Posterize4 RGB16 | 21845 / 1344.2503 | 0 / 0 |
| Posterize8 RGB16 | 9362 / 713.4512 | 0 / 0 |
| Threshold128 RGB16 | 65535 / 1535.9766 | 0 / 0 |
| Threshold64 RGB16 | 65535 / 4207.9358 | 0 / 0 |

MAE above includes all four source channels. RGB16 v2 starts as an opaque RGB8
ramp converted by Photoshop; comparison expands source8 by257. Independent
v3 no-op conversion, heldout settings, alpha ramps and non-byte-grid RGB16
inputs have now been measured. The actual native execution produced 34 PASS
(5 no-op controls, 29 operations), while the first v2 study produced 8 PASS.
Raw evidence is preserved in `photoshop-27.11-discrete-adjustments-v3.json`.

All **37 native operations** have zero straight-color kernel error after
calibrating to their matching Photoshop no-op source. This includes Posterize
2/3/4/5/8/255 and Threshold1/64/127/128/255, but does not prove every unmeasured
parameter or input.

The full premultiplied product path is reported separately: v2 8/8 and v3
24/29 controls match exactly. Four v3 Posterize controls have at most one
premultiplied-source unit difference. One v3 Threshold128 alpha control has a
binary boundary difference at pixel535 (x23,y2, alpha32895): native straight
color `[5912,41633,59623]` and our rounded premultiplied representation land on
opposite sides of the cutoff. Its max RGB error is32895 across that one pixel.
This is explicitly retained as an unresolved representation-boundary difference,
not accepted as equivalent using an enlarged tolerance or hidden epsilon.

No-op native import/export changes RGB8→16 colors by at most1 source unit and
true PNG16 colors/alpha by at most2. Comparing original full-precision project
source directly against that rounded Photoshop source can therefore cross a
Threshold or Posterize boundary. The project keeps its original full-range
source and alpha; it does not force every source value onto Photoshop's 15+1
storage grid to obtain lower report errors.

Detailed before/after, source conversion and product metrics for every control
are in `artifacts/photoshop-threshold-posterize/native-v2-comparison.json` and
`native-v3-comparison.json`. Their metrics use different explicitly recorded
denominators: v2 includes all RGBA samples; v3 includes visible RGB samples and
records alpha error separately.

Adobe's current 32-bpc support list does not list either adjustment. The project
conservatively rejects both for HDR; this is an inference from the published
list, not a claim that their actual Photoshop HDR menus were tested.
[Adobe: Features that support 32-bpc HDR images](https://helpx.adobe.com/photoshop/desktop/adjust-color/hdr-and-channel-manipulation/features-that-support-32-bpc-hdr-images.html)

RGB16 support evaluates premultiplied source samples directly. Threshold uses
integer cross multiplication against the exact source alpha; Posterize operates
on channel/source-alpha and repremultiplies against that unchanged alpha.
Neither uses a PNG8 image or a 33³ lookup cube as its source.
Posterize input lattice evaluation is its discrete color semantics, not a
conversion of source storage. Threshold is a
discontinuous decision and must not be approximated by cube interpolation.

For example, opaque grayscale 32895 and 32896 both preview as byte 128, but
Threshold128 returns black and white respectively. Posterize3 distinguishes
21844 and 21845 although both preview as byte85. Alpha50009 is retained exactly.
The deliberate tonal discretization may itself yield values on the byte grid;
that alone is not evidence that the source was quantized.

HDR refusal happens both before high-depth command preparation and in the
shared HDR color operation, before normalization/allocation. Negative and
overwhite source samples remain untouched, including atomic batch failure.
There are no added native `LayerAdjustment` kinds or guessed `.comp` fields.

## Integration and acceptance

`FiltersPanel` supplies numerical controls, previews and Chinese/English names.
The parent task owns Image > Adjustments menu wiring and desktop acceptance.
The command and renderer use the existing filter schema; no new unrelated
App/main/editor contracts are required.

Targeted validation on 2026-10-13:

- 204 tests passed: the two new suites plus image filters, RGB16 color filters,
  HDR pixels, high-depth filters and their integration, and Progressive Blur.
- Strict TypeScript passed for the changed source/helper and new suites.
- Targeted `FiltersPanel.vue` `vue-tsc` check passed.
- Preview/commit equality, source immutability, exact alpha, unchanged mask and
  placement, protected outside-selection pixels, exact Undo/Redo, RGB16 project
  save/reopen, and HDR rejection with batch rollback are exercised.

Logs: `artifacts/photoshop-threshold-posterize/target-tests.log`,
`target-typecheck.log`, `panel-typecheck.log`. Before-edit file copies are in
`artifacts/photoshop-threshold-posterize/backups/`.

All v2 opaque product controls and all v3 calibrated straight kernel controls
are required to match exactly. Opaque v3 product pixels are also exact. The
known alpha threshold boundary remains explicitly tracked, not loosened.
Broader native-pixel equivalence is not asserted in this acceptance record.
No GUI, full build/check, package, version change, or Git commit was performed
by this subtask. Native measured controls will determine follow-up kernel
corrections rather than loosening an arbitrary comparison threshold.

## V3 heldout comparison by row

`Initial` is the pre-native Rec.709/nearest-level candidate against the native
no-op source. `Kernel` is the corrected straight-color formula. `Product` is
the actual premultiplied product against the native no-op source; `Original`
is against the untouched generated input. Columns are max/MAE in source units.

| Case | Initial | Kernel | Product | Original | Original alpha max |
| --- | --- | --- | --- | --- | --- |
| alpha-posterize-4-16.png | 21845/3584.445312 | 0/0.000000 | 1/0.083333 | 1/0.250000 | 1 |
| alpha-posterize-4-8.png | 85/13.945312 | 0/0.000000 | 0/0.000000 | 0/0.000000 | 0 |
| alpha-posterize-8-16.png | 9362/1902.203125 | 0/0.000000 | 1/0.250000 | 1/0.333333 | 1 |
| alpha-posterize-8-8.png | 37/7.687500 | 0/0.000000 | 0/0.000000 | 0/0.000000 | 0 |
| alpha-threshold-128-16.png | 65535/1791.972656 | 0/0.000000 | 32895/42.832031 | 1/0.166667 | 1 |
| alpha-threshold-128-8.png | 255/6.972656 | 0/0.000000 | 0/0.000000 | 0/0.000000 | 0 |
| alpha-threshold-64-16.png | 65535/4607.929688 | 0/0.000000 | 0/0.000000 | 1/0.302083 | 1 |
| alpha-threshold-64-8.png | 255/17.929688 | 0/0.000000 | 0/0.000000 | 0/0.000000 | 0 |
| deep-posterize-2-16.png | 0/0.000000 | 0/0.000000 | 0/0.000000 | 2/0.805556 | 2 |
| deep-posterize-255-16.png | 259/57.647569 | 0/0.000000 | 1/0.111111 | 260/2.927083 | 2 |
| deep-posterize-3-16.png | 32768/5500.402127 | 0/0.000000 | 0/0.000000 | 32768/4.287109 | 2 |
| deep-posterize-5-16.png | 16384/1662.209527 | 0/0.000000 | 1/0.010851 | 16384/2.533203 | 2 |
| deep-threshold-1-16.png | 65535/106.665039 | 0/0.000000 | 0/0.000000 | 2/1.904948 | 2 |
| deep-threshold-127-16.png | 65535/2090.634766 | 0/0.000000 | 0/0.000000 | 2/0.729167 | 2 |
| deep-threshold-255-16.png | 0/0.000000 | 0/0.000000 | 0/0.000000 | 65535/21.333008 | 2 |
| source-posterize-2-16.png | 0/0.000000 | 0/0.000000 | 0/0.000000 | 0/0.000000 | 0 |
| source-posterize-2-8.png | 0/0.000000 | 0/0.000000 | 0/0.000000 | 0/0.000000 | 0 |
| source-posterize-255-16.png | 259/70.850694 | 0/0.000000 | 0/0.000000 | 0/0.000000 | 0 |
| source-posterize-255-8.png | 2/0.609158 | 0/0.000000 | 0/0.000000 | 0/0.000000 | 0 |
| source-posterize-3-16.png | 32768/3598.181207 | 0/0.000000 | 0/0.000000 | 0/0.000000 | 0 |
| source-posterize-3-8.png | 128/14.513889 | 0/0.000000 | 0/0.000000 | 0/0.000000 | 0 |
| source-posterize-5-16.png | 16384/1663.986328 | 0/0.000000 | 0/0.000000 | 0/0.000000 | 0 |
| source-posterize-5-8.png | 65/6.798611 | 0/0.000000 | 0/0.000000 | 0/0.000000 | 0 |
| source-threshold-1-16.png | 65535/106.665039 | 0/0.000000 | 0/0.000000 | 0/0.000000 | 0 |
| source-threshold-1-8.png | 255/1.079102 | 0/0.000000 | 0/0.000000 | 0/0.000000 | 0 |
| source-threshold-127-16.png | 65535/2047.968750 | 0/0.000000 | 0/0.000000 | 0/0.000000 | 0 |
| source-threshold-127-8.png | 255/8.051758 | 0/0.000000 | 0/0.000000 | 0/0.000000 | 0 |
| source-threshold-255-16.png | 0/0.000000 | 0/0.000000 | 0/0.000000 | 0/0.000000 | 0 |
| source-threshold-255-8.png | 0/0.000000 | 0/0.000000 | 0/0.000000 | 0/0.000000 | 0 |
