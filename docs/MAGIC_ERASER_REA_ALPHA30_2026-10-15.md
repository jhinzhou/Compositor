# Magic Eraser AA: REA reconstruction and native validation, 2026-10-15

The RGB8 current-layer, integer-tolerance AA route now follows the Photoshop 27.11.0 six-channel compatibility LUT and ordered histogram/growth mechanism. AA-off, merged sampling, fractional tolerance, RGBA16/HDR and Background Eraser retain their prior routes. Tool opacity retains the existing alpha application formula; its one-byte residual at 43% is disclosed below.

No production change was made before the frozen candidate was tested against fresh native Photoshop GUI captures. The source PNG imported by Photoshop, actual output PNG, native options/history identities, self-authored source provenance and complete failure cohort are retained in `fixtures/parity/photoshop-27.11-magic-aa-rea-alpha30.json`. That fixture is sufficient to rerun the product effect regression without local Photoshop or REA files. Full local static dossiers remain under `/Users/zhoujin/Documents/REA/artifacts/magic-aa-static-2026-10-15`; native captures under `/Users/zhoujin/Documents/REA/artifacts/magic-aa-2026-10-15` are local research evidence, not build dependencies or bundled Adobe code.

## Recovered mechanism

The low seven score bits are the minimum of six LUT lookups: R, G, B, floor((R-G+256)/2), floor((G-B+256)/2), floor((B-R+256)/2). Primary RGB channels use the integer tolerance and AA width256; paired differences use floor(tolerance/2) and width129. Accepted values score127. Beyond the accepted interval, distance s below the width scores floor((width-s)*127/width), otherwise0. Direct REA functions `104e0113c`, `104e0135c` and `10544a194` establish these operations; this is not a fitted color-distance heuristic. `104e002f0` confirms RGB modes3/9 populate three primary slots. A four-primary multiply primitive is a different mode4 branch and is not PNG alpha premultiplication in RGB mode3.

Bit7 marks membership in the hard connected region. Scores remain available outside that component. The AA pass performs vertical selected/unselected boundary statistics, vertical forward/backward one-pixel growth, then horizontal boundary statistics on the vertically rewritten mask and horizontal growth. Each boundary contact contributes to the low7 histogram. The final threshold is u=clamp(2*round(weighted mean),128,254); the final coverage LUT is the native integer stretch above u. Low7 zero pixels grown to128 remain suppressed. A touching high-score island can be admitted by the ordered growth; replacing this mechanism with inward subpixel color tests incorrectly preserves parts of the selected core and misses the outer edge.

## Frozen candidates and retained failures

The first candidate froze as `99ad823bd250120fc5fd2eb3ad431374a956585d1d7f354d2d865eb74745806c`. Its recovered spatial mechanism matched all seven disclosed grayscale/partial-alpha calibrations, but its three-channel score hypothesis failed new colored cases. These failures are retained. New direct static evidence revealed the additional paired channels. The second candidate froze at UTC2026-10-15T02:30:13.995760 with SHA256 `7165e520cf92120291a324d6283a1cbc6a298ff475cf815168335f8b118bc1e1`.

The spectrum/lowcontrast four cases were already disclosed or in progress before V2 freeze and remain diagnostic regressions. Only the following four alpha/islands outputs were newly captured after that freeze. Candidate code was not retuned after those outputs were disclosed.

| Native case | Previous product alpha diff / max / MAE | Frozen V1 alpha diff / max | Frozen V2 alpha diff / max / MAE | V2 classification |
|---|---:|---:|---:|---|
| spectrum T17 contiguous | 659 /191 /1.798046875 |429 /131|0 /0 /0|disclosed diagnostic|
| spectrum T17 discontiguous |659 /191 /1.798046875|429 /131|0 /0 /0|disclosed diagnostic|
| lowcontrast T3 contiguous |484 /255 /1.8100520833|82 /204|0 /0 /0|disclosed diagnostic|
| lowcontrast T0 discontiguous |860 /191 /2.8956510417|0 /0|0 /0 /0|disclosed diagnostic|
| mixed alpha T47 opacity100 |98 /64 /.09765625|0 /0|0 /0 /0|post-freeze independent|
| mixed alpha T47 opacity43 |5238 /28 /.1766927083|5175 /1|5175 /1 /.134765625|post-freeze independent, partial|
| islands T8 contiguous |190 /255 /.6528645833|178 /88|0 /0 /0|post-freeze independent|
| islands T8 discontiguous |4082 /191 /14.2937760417|4488 /88|0 /0 /0|post-freeze independent|

The old disclosed alpha28 AA regression improves from256 differing alpha pixels/max252/MAE.8538802083 to0. All seven calibrations also match alpha exactly. In all exact-alpha cases, visible straight RGB and premultiplied RGB are exact. Hidden RGB is excluded: Photoshop exports transparent white in these captures while the product normalizes fully erased hidden RGB tozero.

At43% opacity,5175 alpha pixels differ byone. The entire group has source alpha201, full erasure coverage, product alpha115 and native114. Visible RGB stays exact, while10350 rounded premultiplied channels differ. The result improves both the previous maximum and mean alpha error but remains partial. No quantization constant or opacity adjustment was fitted to that independent output.

## Integration and engineering checks

`src/shared/magic-erase-antialias.ts` implements the six-channel LUT and ordered histogram mechanism. `src/core/color-erase.ts` enables it only for AA-on RGB8 current-layer integer tolerance. Existing `sourcePoint` flooring/placement, document canvas clipping, selection coverage, opacity, private source copies and cancellation/resource errors remain in the actual editor path.

The new lookup table and histogram reserve2048 extra bytes before allocation. Per-domain-pixel score1 + matches1 + private flood region1 + flood queue4 + coverage4 consume11 bytes, matching the existing domain buffer allowance. All new image passes charge the work/cancellation counter. The helper mutates only its caller-owned region/coverage arrays. No native binaries or Ghidra artifacts are bundled.

Targeted tests `magic-erase-rea-alpha30.test.ts` and the updated `color-erase-alpha28.test.ts` cover all15 captures plus the old AA residual, failed V1 retention, post-freeze cohort identity, source immutability, selection/canvas/flooring, cancellation/work limits, deep/merged/fractional fallbacks, and independent helper behavior. The initial targeted run passed34/34. Broader source/runtime/package gates are recorded by the overall alpha30 acceptance report.

`scripts/smoke-magic-aa-alpha30.ts` exercises actual toolbar and pointer input, immutable preview, one commit, frozen native comparison, real keyboard Undo/Redo and save/close/reopen for the old AA residual and three new cases, including the disclosed43% residual. It is written for serial development and actual-package acceptance; merely compiling it is not a runtime PASS.
