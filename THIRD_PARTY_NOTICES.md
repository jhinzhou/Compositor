# Third party notices

The `.comp` format and editing semantics are based on Compositor by Wonder Assembly LLC, https://github.com/robbietilton/Compositor, source baseline 24ef2885daae750537ec8d094f33e8556a8dfc9a (official v1.4.8). Its MIT license is retained in `licenses/Compositor-MIT.txt`. The app icon and portable pixel algorithms are derived from that MIT-licensed source. Native C/Metal/Swift reference generators execute pinned upstream algorithms for regression evidence; they are developer validation tools, not runtime platform dependencies. The product does not bundle the original Swift application.

Runtime dependencies and their license files are included by the package manager. CanvasKit is supplied by the Skia project; Electron includes Chromium and its third-party notices. Preserve their notices when distributing packaged applications.

## RAW / HEIC WASM import

`libraw-wasm` 1.6.0 is by ybouane and contributors and declares ISC for its
JavaScript/C++ wrapper. Its embedded LibRaw 0.22.1 is separately distributed
under the LGPL-2.1 option of the upstream LGPL/CDDL dual license; **the entire
RAW WASM is not ISC-only**. It also links Little CMS 2.19.1 (MIT) and Emscripten
ports of libjpeg, libpng and zlib. Their license/notice texts are retained in
`licenses/`. Upstream: https://github.com/ybouane/LibRaw-Wasm and
https://github.com/LibRaw/LibRaw.

`libheif-js` 1.23.5 includes libheif 1.23.5 and libde265 1.0.15 under LGPL-3.0.
The complete supplied LGPL/GPL notice is retained as
`licenses/Libheif-LGPL-3.0-and-GPL-3.0.txt`; libde265's notice is also retained.
Upstream: https://github.com/catdad-experiments/libheif-js and
https://github.com/strukturag/libheif.

The codecs are loaded as separately replaceable runtime JS/WASM files.
Corresponding library sources, source URLs/checksums, and rebuild instructions
are included in `licenses/codec-sources/`. Preserve those sources, instructions,
license texts and the application source/build material when redistributing,
and allow compatible modified codecs to be substituted. These notices cover
copyright licensing and do not assert availability of HEVC patent licenses.

Real decoding regression fixtures in `tests/fixtures/foreign-import/` are
CC0-1.0 samples from raw.pixls.us and HEIC.best; original download/license URLs
and the RAW catalog record are retained in `SOURCE.json`. They are test inputs,
not runtime image assets. No personal photo library or proprietary SDK is used.

## IBM Plex Mono Bold glyph atlas

The deterministic ASCII raster atlas is derived from IBM Plex Mono Bold, distributed under SIL Open Font License 1.1. The license is included in `licenses/ibm-plex-mono-OFL.txt`. Official source: https://github.com/google/fonts/tree/main/ofl/ibmplexmono.

## pako 2.1.0

MIT licensed zlib inflation for the shared Camera Raw atlas; copyright Vitaly Puzrin and Andrei Tuputcyn. The license is included in `licenses/pako-MIT.txt`.

## Compositor spatial Camera Raw Shadows

The portable adaptive Shadows implementation and embedded CRS2 tables in `src/shared/camera-raw-shadows.ts` and `camera-raw-shadows-data.ts` are derived from Compositor commit `735c2cc23c0efe7c2c2f85a66741b253e053cf2b`, reviewed at upstream main `43d691b67995e924965bcd520f8b300f96b7d5b8`. The original `CameraRawShadows.bin` SHA-256 is `76578539bc45a32817aff669c4e41523d7040f3c691ad35adf0723a70a89a705`. These algorithms and tables remain covered by the retained Compositor MIT license in `licenses/Compositor-MIT.txt`.
