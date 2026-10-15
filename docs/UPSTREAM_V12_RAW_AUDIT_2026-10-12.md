# Compositor 最新上游：v12 工程、16 位与 RAW 能力核查

> 后续实施更新：alpha.12 已验收 v12 PNG16 工程读取/保存/历史保留；alpha.13 已接入 8 类 RGBA16 破坏式调色与单层模糊笔刷。下文原始审计中的“16位图层拒绝/未移植”是开发前状态，当前支持边界及真实验收见 [A1](DEEP_A1_ACCEPTANCE_2026-10-12.md) 与 [A2](DEEP_A2_ACCEPTANCE_2026-10-12.md)。高位深合成/调整层、其他笔刷、导入导出与 RAW 自动镜头配置仍未完成。

核查对象：最新 `f01e2980fb76eb085d3f8ac96070a1c0c4a9afa9`（本机只读快照 `Compositor_Upstream/f01e298`）。主体审计最初固定在`6aea90a`；收尾新增两个16位修复提交的差异也已核查。本报告区分上游实现、Electron 当前实现和后续开发范围。当前 Electron 编辑/合成路径仍为 RGBA8 sRGB；没有宣称全图 16 位编辑、浮点 HDR、无损 RAW 或与 Apple/Adobe 解码器等效。

## 1. v12 工程的实际变化

[上游 ProjectStore.swift](https://github.com/robbietilton/Compositor/blob/6aea90a7ca88bfd8d38c26e858a3835a458afae1/Compositor/IO/ProjectStore.swift) 将 `ProjectManifest.current` 改为 12。manifest 没有新增文档 `bitDepth` 字段；每个 PNG 的文件头决定实际位深。读取规则：图像可为 8 位及以下，版本 12 的普通图像层另外允许 16 位；蒙版仍为 8 位。保存普通图像时优先 `DeepLayer.flattened`，从而写出保留高位深的 PNG。未知更高版本不能按 v12 猜测。

Electron `src/shared/contracts.ts` / `src/core/manifest.ts` 当前接受版本 1–11；`src/core/project-io.ts::makeAsset` 在解码前拒绝超过 8 位的 PNG；`saveProject` 写版本 11。旧 `loadProject` 会在检查资产前把版本 12 当成无效 metadata，难以区分未来版本、有效 RGB8 v12 和需要位深转换的工程。

本批最小 loader 实现（`tests/project-v12.test.ts`，采用按上游 layout 自建的实际临时工程，不是 Photoshop/原版应用独立效果验收）：

1. v12、全部 RGBA8 图像且全部 8-bit gray 蒙版，按现有 metadata 校验读取，明确报告已进入 v11/RGBA8 编辑格式。读取本身不得改写原工程；保存需保留现有原子替换与外部版本冲突保护。
2. v12 包含 16-bit 图像，返回专门的 `NEEDS_CONVERSION`，包含源版本、源位深、图层及文件，保持当前文档和输入 package。禁止为了打开工程而静默量化，更不能提高 schema 的版本上限后直接交给 RGBA8 PNG 路径。
3. 非 v12 的高位深图像、16-bit 蒙版、未知版本或损坏文件继续严格拒绝，不能把它们归为已支持。
4. 真正的 16-bit 资产保留另开有明确 gate 的批次，不将以上 loader 兼容称为 16-bit 编辑。

## 2. 上游 DeepLayer 的边界

[DeepLayers.swift](https://github.com/robbietilton/Compositor/blob/6aea90a7ca88bfd8d38c26e858a3835a458afae1/Compositor/Document/DeepLayers.swift) 使用 sRGB、premultiplied RGBA、native-endian UInt16。一个资产同时保留 16-bit `deep` 和加微小噪声量化的 8-bit `image`；画布、缩略图和多数工具使用后者。它不是浮点 HDR 文档管线。

[DeepPixels.c](https://github.com/robbietilton/Compositor/blob/6aea90a7ca88bfd8d38c26e858a3835a458afae1/Compositor/Rendering/DeepPixels.c) 的 `deep_split/deep_merge` 将普通 8-bit 算法在偏移 0、1、4 的三份输入上执行，再按原始低位重建近似高位深结果。它保留部分精度，不能描述为所有滤镜的原生 UInt16 数学运算。`deep_take_painted` 在未变化处保留原始 UInt16 样本，改变处写 8-bit 结果 ×257。

[Filters.swift](https://github.com/robbietilton/Compositor/blob/6aea90a7ca88bfd8d38c26e858a3835a458afae1/Compositor/Document/Filters.swift) 对 Content-Aware Fill、Dither、Remove Background 明确转为 8 位；理解高位深的过滤、变形、合并、剪贴板等路径才读写 `deep`。这些降级规则也是移植需求，不能只保留文件就宣布全部操作高位深。

[DocumentHistory.swift](https://github.com/robbietilton/Compositor/blob/6aea90a7ca88bfd8d38c26e858a3835a458afae1/Compositor/Document/DocumentHistory.swift) 将 `deep` 纳入历史引用及字节预算。同等像素下深层底图比 8-bit proxy 多 8 bytes/pixel；Electron 当前按资产 hash 和像素预算计费，不能直接假定这一预算适用于同时保留 RGBA16、RGBA8、滤镜临时缓冲和 undo。

Electron 的 `canvas-engine.ts` 是 CanvasKit/Skia 渲染，上传、取像素及合成导出为 `RGBA_8888`；overlay/text 等局部使用 Canvas2D。`raster-edit.ts`、`image-filters.ts`、PNG 保存和大多数 worker 结果也是 UInt8。需要调整的是共享像素/资产/历史边界，不能用更换导出扩展名代替架构实现。

### 收尾新增的16位修复

`2b9603f`将Hue/Saturation、Black & White、Color Balance、Gradient Map的16位路径改用`deep_cube_apply`三线性查找；`PixelAdjust.blend`允许16位选区混合，LiveMaskRenderer也使用该路径。`f01e298`让模糊笔刷绘制中的显示样本取自16位结果再抖动，避免提交前的显示色带。以上不是RGBA8滤镜参数变化，必须在DEEP-A资产与历史链路就绪后接入；本轮尚未实现这两项高位深效果。

## 3. RAW 新能力：可以做什么

上游 [RawImporter.swift](https://github.com/robbietilton/Compositor/blob/6aea90a7ca88bfd8d38c26e858a3835a458afae1/Compositor/IO/RawImporter.swift) 新增 `noiseReduction`、`lensCorrection`、`highlightRecovery`，并分别检查 `CIRAWFilter` 的 `isLuminanceNoiseReductionSupported`、`isLensCorrectionSupported`、`isHighlightRecoverySupported` 后才显示和执行。不同相机格式能力不同。

本项目实际依赖 `libraw-wasm@1.6.0`，对应 [LibRaw-Wasm 原始仓库](https://github.com/ybouane/LibRaw-Wasm)。本地 `node_modules/libraw-wasm/dist/index.d.ts` 和真实 WASM 探针是本轮核查依据；线上默认分支可能继续变化。

| 能力 | 已确认的底层依据 | 产品现状 / 可做范围 |
|---|---|---|
| RAW 降噪 | `LibRawSettings.threshold`：wavelet denoise；`fbddNoiserd`、`medPasses` 为另外两种能力 | 本批已增加默认关闭的 `noiseReductionThreshold`（0–1000）和真实 worker 传参；面板显示小波降噪。不能照搬 Apple 的 0–1 luminance 参数等效声明 |
| RAW 高光恢复 | `highlight` 0–9，`expPreser` 0–1；现有解码器已经执行 `expPreser:1` | 本批 UI/contracts 已扩至整数 0–9：原0/1/2名称不变，3–9明确显示重建模式；旧默认0保持。不能把0–2显示为重建恢复 |
| 自动镜头配置纠正 | 本地 settings 没有 lens-profile correction setter；可读 `LensInfo` | Lens metadata 只证明识别信息，不能自动推导 distortion/vignetting/profile corrections。当前可保留 Camera Raw 的手动几何/光学调整；自动配置需独立校准模型/数据库及许可证、真实镜头语料 gate |
| RAW 16-bit output | 解码 worker 已使用 `outputBps:16,gamm:[1,1]` 得到 linear RGB16，再转 sRGB RGBA8 | 解码中间值并不等于保留的 16-bit 图层或可重新冲洗 RAW。当前警告已明确 original sensor precision/RAW editability 不保留 |

### 真实 decoder 探针

运行：`npx tsx scripts/audit-raw-decoder-capabilities.ts`。输入为仓库已记录来源和许可证的 `tests/fixtures/foreign-import/sample.dng`，半尺寸 960×409；不会上传用户图片，不改变产品 RAW 设置。产品现已 支持此 probe 所验证的底层参数；probe 自身不改变运行产品设置。报告在忽略目录 `test-results/raw-capability-audit/report.json`。输入每次拷贝到独立 worker，探针只替换运行时字符串中设置传参。

本轮实际结果：

| 设置（其他设置一致） | 与 baseline 不同的通道样本 | 绝对差总和 |
|---|---:|---:|
| threshold=1000 / highlight=0 | 860,750 | 4,168,731 |
| threshold=0 / highlight=3 | 968,641 | 29,792,357 |
| threshold=0 / highlight=9 | 968,619 | 29,792,392 |

baseline RGBA SHA-256：`5cc5844d2ed9c96c7000ddfcf12bed58d9a9f4b48fc3f45727eb8b43c4a8f942`。这证实当前绑定接受设置且在这张合法实拍 DNG 上改变像素。它没有验证恢复质量、未恢复细节的真实性、全相机可用性，也没有对 Apple `CIRAWFilter` 或 Adobe Camera Raw 做效果等价验收；差异数量不是画质评分。

## 4. 按 AI 开发批次推进

| 批次 | 实施范围 | 必须通过的验收 |
|---|---|---|
| V12-A（已实施，实际macOS包UI gate通过） | 合法 8-bit v12 工程读取；16-bit 明确 conversion-required；版本/资产/错误报告 | RGB8 文件字节不变；保存/reopen/外部 fingerprint；混合8/16原子拒绝且现有文档不变；未知version及16mask拒绝；package不被修改 |
| RAW-A（已实施，实际macOS包UI gate通过） | wavelet 降噪；明确 highlight recovery mode；默认兼容；预览/取消/导入同设置 | 真实 fixture 下设置传参和像素差；关闭恢复保持 baseline；abort 杀 worker；参数预算；两种语言；不宣传镜头自动配置 |
| DEEP-A（保留资产） | 引入带位深声明和源 hash 的不可变 RGBA16/源16PNG资产；8-bit display proxy；metadata-only edits 保留deep | 不编辑往返16PNG hash；透明 premultiplication；gradient/alpha；undo/redo 与 save reopen；历史字节预算；原子拒绝超限 |
| DEEP-B（操作规则） | 每个操作声明 keep/deep-edit/rasterize；先选少数可准确实现的色调操作，后转层、paint patch和merge | 和16-bit独立参考比较像素；局部修改外原样本不变；降级确认/报告；不得执行8-bit后保留陈旧deep；包含compound操作回归 |
| HDR assessment | 浮点/线性色彩管理、显示映射、EXR/gain map和硬件能力只先评估 | 独立 HDR ramp / chromaticity / display evidence；不把16-bit sRGB等同HDR；不能通过则保留明确未支持状态 |

C1 边缘细化是实验性的 opaque RGBA8 + trimap 局部算法，独立于上述 DEEP/HDR 批次。C1 核心接口已有 11 个新回归通过，包含 selection/mask/new-layer、变换、锁、任务/幂等/撤销、save reopen、源PNG/metadata和临时预览；效果是否等于 Photoshop 发丝抠图仍需自然图片与人工基准，没有用这些结构测试宣称完成。

实际 UI 验收入口：`npx tsx scripts/smoke-raw-upstream.ts`，可传 `COMPOSITOR_EXECUTABLE` 验证打包程序。脚本检查双语控件垂直和面板边界、阈值拒绝、真实预览不写文档、确认像素等于同设置半尺寸预览、解码取消不写历史；本轮实际macOS alpha.11包串行运行已通过RAW的5项检查；`smoke-v12-upstream.ts`另通过v12读取、Save a Copy、保存重开及16位原子拒绝4项。原图/蒙版文件hash、现有文档/历史和源工程均按实际范围核对，记录见 [统一验收](PHOTOSHOP_ALPHA11_ACCEPTANCE.md)。
