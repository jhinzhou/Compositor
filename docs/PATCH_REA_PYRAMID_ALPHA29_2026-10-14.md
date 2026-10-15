# Existing Patch D5 effect improved with REA native evidence

Date: 2026-10-14 (Asia/Shanghai). Status: default Normal Patch RGB8 opaque effect implemented; source/typecheck/native-reference gates passed. Final GUI/package/MCP acceptance belongs to the coordinating agent. This document does not claim all Photoshop tools or all healing modes are aligned.

REA/Ghidra investigation of the exact installed AdbePM arm64 bytes established a confidence-normalized reduce/expand pyramid. The inspected float Diffusion argument is the exponent in `powf(0.5*maximumConfidence, diffusion)`, which controls the normalization floor at each level. The kernel is the statically observed separable `[0.05,0.25,0.4,0.25,0.05]`. A main-program original-instruction check established that the native image views use selection bounds expanded by one pixel. The previous harmonic SOR approximation and two-pixel effective solve origin did not express this mechanism.

Full static dossiers, original byte identities, limitations, unsuccessful wrapper analyses, rejected full-image/ROI2 diagnostics and the independent candidate are retained in `/Users/zhoujin/Documents/REA/artifacts/patch-current/` and `/Users/zhoujin/Documents/REA/reports/patch-pyramid-2026-10-14.md`. Those binaries were analyzed and never executed. No Photoshop signature or entitlements were changed.

## Native gates

The 19 alpha26..28 datasets were already disclosed. Across their 27 D1/D5/D7 reference outputs, the independent ROI1 candidate matched 25 exactly; two feathered D5 outputs had one RGB channel differ by one byte. All edit-domain, exterior and alpha counts matched the native references.

Before collecting new outcomes, the candidate was frozen at SHA-256 `f06506f1390346809b08932cb86ac04ab066abbc5ec3344a782167ff5f8317a9`. Two new self-authored textured sources with mixed dimensions, hard/AA/feather/remote weak-island selections and explicit D1/D5/D7 produced 24 fresh native Action Manager outputs. Source SHA, dimensions, exact native mask, history, parameter and no-error checks all passed. The frozen candidate matched 21/24 byte-exactly; remaining cases differ by 1 byte at 1 or 2 RGB channels, with extra/missing/exterior/alpha all zero. These results were not used to retune the candidate.

The production path implements only existing fixed D5 behavior. Its actual `preparePatch` output passed all **19 old + 8 fresh D5 references**, max channel difference <=1 byte, at most 2 differing RGB channels per entire output, and extra/missing/exterior/alpha all zero. `fixtures/parity/photoshop-27.11-patch-rea-pyramid-alpha29.json` retains all 24 native records; D1/D7 are explicitly research evidence, not new product parameters.

## Implementation and compatibility

- `src/shared/patch-pyramid.ts` performs only the opaque RGB8 D5 numeric path using private bounded arrays, charged scans/allocations/filters and per-row cancellation.
- `src/shared/sampled-healing.ts` enables it only through an internal Patch flag. The default Healing Brush remains on the historical path. Transparent and semitransparent source/donor regions also fall back, retaining premultiplied alpha and hidden-RGB behavior until their native semantics are verified.
- `src/core/patch-edit.ts` sends that flag while retaining the existing donor sample, 16 MP/4 MP/120 M budgets, locks, deep-pixel refusal, zero-offset/opacity shortcuts, Source/Destination preview/commit and atomic history.

No Diffusion action/schema/UI was added. No-core masks still copy the donor through their actual coverage; adaptation zero skips colour correction; opacity and coverage are applied once. The one-pixel solving ROI is contained inside the existing two-pixel sampled working region.

107 targeted tests passed, with `npm run typecheck` also passing. The suite covers all references through the production path, native provenance, transparent fallback, no-core/zero-operation, validation/work/cancellation, alpha/hidden RGB, protected/high-depth rejection and real Editor preview/commit/retry/Undo/Redo/save-reopen. Complete logs are in the REA project's `artifacts/patch-current/production-final-tests.log`.

The few 1-byte residuals remain disclosed. Their exact float/quantization cause, transparent native equivalence, 16-bit/HDR equivalence and intermediate D2/D3/D4/D6 effects are not established here. Existing alpha26/27/28 failure reports remain history; their rejected Gaussian, soft-island topology and quantization models were not promoted.
