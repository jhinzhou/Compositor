# HDR integration independent review

Scope: Editor install/commit/state/history/copy, draft preview binding/cache, wide image import, FLOAT project persistence, deep export and sampling. This review reads Root-owned implementation and adds only `tests/hdr-review.test.ts`; it does not modify those implementation files. Findings below record the initial reviewed state and require rerunning the regression tests after repair.

## Reproduced behavior defects

1. **Unreferenced EXR chooses the wrong commit inspector.** `editor.ts` chooses `inspectHDRComposite` from all staged assets before pruning unreferenced assets. HDR→16 changes the layer reference to a PNG but leaves the old EXR in the staged map until commit. With a visible adjustment, a batch converting to PNG16 then applying SDR `Overlay` is rejected as unsupported HDR rendering. The same final manifest with only referenced PNG16 assets passes `inspectDeepComposite`. The regression test reproduces this using a valid HDR source and verifies the successful conversion must remain undoable. Choose the compositor from references in the candidate manifest, or prune the staged map before appearance inspection. The operation currently rejects atomically; it does not corrupt the source.

2. **PNG16 API defaults flatten transparency.** `deep-export.ts` constructs background RGB from `exportOptionsSchema`'s default white background regardless of PNG format, then sets all alpha to one. Existing `encodeExport` always preserves PNG transparency. The regression source has alpha `.5`: default PNG16 output becomes `65535` instead of `32768`. The UI explicitly sends `background:null`, so the reproduced defect affects direct API/MCP callers using default options. Align the PNG8/PNG16 policy; explicit EXR background handling should also be deliberate because its shared options default currently implies white flattening.

## Allocation accounting defects identified in the source

3. **Draft total eviction excludes encoded/display buffers.** The per-entry check in `DeepPreviewService.remember` counts Float32/Uint16, canonical and display buffers, but the aggregate eviction loop counts only the working raster if it exists. Two valid uncompressed EXR assets can each occupy approximately 38 MiB (19 MiB canonical + 19 MiB Float32 + a tiny PNG), pass their individual 64 MiB checks and have a combined Float32 size below 64 MiB while retaining approximately 76 MiB. URL/base64 keys add further retained storage. Count all retained backing stores with alias deduplication and include or independently cap string/URL storage.

4. **Export checks component budgets without a combined 512 MiB bound.** Export checks output pixels×80 against the codec bound and calls `assertDeepAssetBudget` for source+composition+output. That helper enforces the document/workspace budget, which may be several GiB. The HDR compositor's own check separately bounds its working estimate. Neither guarantees the combined compositor+output estimate stays within 512 MiB. For example, a compressed, mostly constant 4096×1024 HDR source has an inspection estimate around 470 MiB and an export output estimate around 320 MiB; both individual checks pass. Check combined `inspection.estimatedWorkingBytes + outputWorkingBytes` before constructing either output. Account retained preview/cache buffers when these coexist in the worker.

5. **Save journal fingerprinting bypasses retained baselines.** `replaceProject` calls `fingerprintProject(destination)` and staging/source verification without the retained asset baseline. Fingerprinting currently performs full project load, including Float32 and display decoding. Opening and Editor's direct external checks correctly pass a live baseline, but these save-journal calls can allocate another high-depth copy beside current assets, history and other documents without that accounting. Either propagate baseline through all live save checks or use a structural/source-hash validation path that avoids working/display raster allocations. Startup recovery may use an empty baseline when no documents exist; live recovery must not assume this.

## Persistence precision measurement

`tests/hdr-review.test.ts` generates 4096 deterministic signed, highlight and low-alpha pixels in Float32 premultiplied encoded extended sRGB. It encodes FLOAT+ZIP scene-linear RGBA then decodes to the editor representation. The initial measurement was:

| Measurement | Result |
| --- | --- |
| Total RGBA samples | 16384 |
| Changed working samples | 553 |
| Maximum absolute delta | 3.725290298461914e-9 |
| Maximum Float32 ULP delta | 1 |
| Alpha samples changed | 0 |
| Input working array changed | No |

The encoded `.exr` bytes remain exact across project save/copy; Float32 working arrays are not promised bit-identical after decode of an edited scene-linear file. This result describes the measured fixture, not a universal bound on every possible HDR sample. The test stores current measurements under ignored `test-results/hdr-codec/float-transfer-roundtrip.json` and permits at most two ULP for this fixture. HALF storage has an additional quantization boundary; new project assets use FLOAT+ZIP.

## Confirmed preservation paths and support boundaries

Public state exposes depth/HDR/hash metadata without original bytes or Float32 arrays. Asset display retrieval checks source identity and the separate display hash. Whole-layer duplication and clipboard plans keep `.exr` extensions and reuse immutable source/raster versions; explicit conversion changes to `.png` and is undoable. HDR edits route to Float32 before PNG8 branches. Original EXR data is not read from the clipped display proxy. Draft lookup binds session, revision and layer file; expired high-depth drafts refuse an inline PNG8 substitute. Wide import performs source/retained-budget preflight, while ordinary images keep their existing path.

The initial HDR compositor deliberately supports six blend modes and supported adjustment kernels; unsupported visible effects and vector masks are rejected. TIFF imports support the documented float subset and explicit ICC policy. PNG16 output is SDR and clips floating highlights at the output boundary; EXR carries HDR. SDR previews are not HDR/EDR monitor evidence. These source tests do not establish Windows runtime acceptance.

## Repair verification

The five findings above were repaired after the initial review. Root prunes staged unreferenced sources before Editor appearance inspection. Preview/export floating detection now follows manifest image references. PNG16 ignores background just as PNG8 does and keeps alpha under default API options. Draft registration preflights canonical/working/display backing stores, UTF-16 URL storage and tagged-PNG temporary bytes, deduplicates aliases, and evicts older entries before encoding a new URL. `retainedWorkingBytes()` reports surviving draft/cache storage to readonly export; combined export preflight includes that context, source/composition and output before allocation. Export does not clear active drafts.

Save-journal fingerprint and recovery functions receive the live retained baseline. An additional header-based preflight includes all candidate assets and the largest decode working estimate before invoking staging verification, so staging cannot allocate first and discover an over-budget workspace only in a later fingerprint check. `replaceProject` accepts this baseline as its final optional argument, and `recoverSaveJournals` as its optional second argument; startup recovery can retain the empty default.

`hdr-review.test.ts` now passes all seven checks. Its cache case uses two actual 1024×1024 uncompressed FLOAT EXR sources, whose canonical+Float32 storage exceeds the old aggregate limit although Float32-only counting passed; the older URL is now correctly expired. Its export test rejects a large combined allocation before generating pixels, verifies retained readonly cache accounting, and preserves editor/cache state. Save tests observe baseline propagation through each fingerprint phase and inject a retained-budget refusal before source replacement. The full targeted sweep of HDR integration, deep preview, high-depth filters, recovery and review passed **61/61**; the changed modules and tests passed strict TypeScript checks. Product runtime and platform acceptance remain Root's separate gate.
