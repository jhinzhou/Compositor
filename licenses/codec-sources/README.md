# Replaceable WASM codecs and corresponding source

The application loads `libraw-wasm/dist/libraw.js` + `libraw.wasm` and
`libheif-js/libheif-wasm/libheif.js` + `libheif.wasm` as separate runtime files.
They are not compiled into the editor executable. `decodeForeign` also accepts
explicit `codecPaths`, allowing modified compatible codecs to be substituted.
Users may modify/rebuild these libraries and debug those modifications. The
application places no contractual restriction on reverse engineering for that
purpose. Do not add signatures or integrity restrictions that prevent replacement.

This directory includes upstream corresponding sources for LibRaw 0.22.1,
libheif 1.23.5, libde265 1.0.15 and Little CMS 2.19.1, with source download
URLs and SHA-256 values in `sources.json`. Preserve these archives, the library
license texts, this rebuild information and the runtime JS/WASM files when
redistributing a packaged application. The original application source and
build scripts are in the source distribution; runtime application JS remains
separate and can be combined with a rebuilt library. The npm package wrapper
source is obtainable from https://github.com/catdad-experiments/libheif-js and
https://github.com/ybouane/LibRaw-Wasm. The LibRaw C++ wrapper and complete build
script are additionally retained here.

For HEIF, the exact upstream release pipeline uses Emscripten 3.1.61 and Node 24;
`libheif-emscripten.yml` and `libheif-dist-prep.sh` retain that pipeline.
Extract the libheif source archive, run its `scripts/install-ci-linux.sh`,
`scripts/prepare-ci.sh`, then `scripts/run-ci.sh` with `USE_WASM=1`,
`USE_UNSAFE_EVAL=0`, `USE_TYPESCRIPT=1`, as in the retained workflow. Its
`build-emscripten.sh` uses libde265 1.0.15; supply the retained source archive
when a source download is required. The npm wrapper minifies the resulting
JS without changing the C/C++ library. Source pipeline:
https://github.com/catdad-experiments/libheif-emscripten/tree/v1.23.5

For RAW, run the retained `compileLibraw.sh` in the LibRaw-Wasm source checkout
with an Emscripten SDK, autotools, libtool and Node. It pins LibRaw 0.22.1 and
LCMS 2.19.1, includes libjpeg/libpng/zlib Emscripten ports, and links a 256 MiB
initial-memory pthread WASM. The upstream script does not pin the Emscripten
SDK version, so byte-identical rebuilds are not asserted. The application caps
that WASM at 512 MiB and adapts the wrapper's optional web pthread workers to
Node worker_threads without changing the library binary. Original build source:
https://github.com/ybouane/LibRaw-Wasm/blob/main/compileLibraw.sh

LibRaw is offered under LGPL-2.1 (the LGPL option of its LGPL/CDDL dual license).
Libheif and libde265 use LGPL-3.0; their distributed notice includes GPL-3.0
as required by the LGPL text. LCMS uses MIT. The generated Emscripten glue is
available under Emscripten's MIT/University of Illinois license:
https://github.com/emscripten-core/emscripten/blob/main/LICENSE
The Emscripten ports' libjpeg, libpng and zlib notices are retained beside this
directory. These sources and notices describe software copyright licenses;
they do not make a claim about HEVC patent licenses in any jurisdiction.
