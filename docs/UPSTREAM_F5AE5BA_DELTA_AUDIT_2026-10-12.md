# 上游 main 新增改动审计：f01e298 → f5ae5ba

本记录是源码审计和实施映射，尚不是本轮新增能力全部完成的验收声明。Electron 的现有 16 位工程、调色、模糊笔刷、调整合成，以及正在统一验收的画笔/擦除、Smudge/Liquify、Image Size 保持现有实现，不重新列为未开发。

## 来源和固定快照

- 基线：`f01e2980fb76eb085d3f8ac96070a1c0c4a9afa9`。
- 本次 main：[`f5ae5bad0b25b32dda9f254e62d2f07f59478698`](https://github.com/robbietilton/Compositor/commit/f5ae5bad0b25b32dda9f254e62d2f07f59478698)。2026-10-12 实际 `git fetch` 后，`git ls-remote origin refs/heads/main` 再次确认相同 SHA。
- 差异：13 次提交，41 个文件，新增 1495 行、删除 205 行。
- 本地完整快照：`../Compositor_Upstream/f5ae5ba`。292 个文件的 Git blob SHA1 和 SHA256 均核验通过；记录在相邻的 `f5ae5ba-source-provenance.json`。
- 原 clone 的 HEAD 保留 `75147a27d90c681215151a6301373dd2b07b7aa2`，未用 checkout/reset 覆盖。旧 `f01e298` 快照及旧参考 fixture 保留。

## 拉取时的新增能力及差异（历史快照）

| 提交 | 上游新增行为 | 当前 Electron 源码状态 | 实施入口 |
|---|---|---|---|
| `93f8e8d` | Gaussian/Motion/Bloom 在 16 位源上直接运行一次；Core Image 工作格式改为全 Float32；修复 Swift C 指针生命周期 | 单层 16 位 Blur 笔刷已经直接浮点计算；Gaussian/Motion/Bloom 破坏滤镜尚被深层精度门禁拦截。Swift 生命周期修复不适用于 TypeScript | 新增 RGBA16 空间滤镜，共用 preview/apply、原 alpha 和扩边/蒙版规则；不能将高位深源先转显示 PNG |
| `3d2ada4` | Camera Raw 等原有 8 位工具用于 16 位图层，改为抖动 low 与 1/2/4 step，多通道依赖独立采样；改善色带 | 现有 8 类深层调色已直接 16 位或 33³ 查找，不需改回 8 位。其余 Camera Raw、Tonal Contrast、Scanlines、Noise、Dither 等暂拒绝深层源 | 新增固定内核版本的 split/merge 桥和独立 C 参考；明确采样精度与资源上限，不承诺 8 位工具内核本身变为真正 16 位 |
| `2fe3524` | 图层菜单 8↔16 位转换；空白图层能转透明 16 位；填充/渐变/清除在 16 位网格重绘 | 没有公开位深转换命令；deep fill/gradient/clear_selected 仍被门禁阻止。普通画笔/擦除已经保留未触及 RGBA16 像素 | typed action、单步历史、8→16 premultiply、16→8 dither；新深层 fill/gradient/clear，选区、变换、透明度、增长和 linked mask 保留 |
| `2522e3b` | New canvas 页粘贴图片直接按图片尺寸建画布；Finder 文件优先于其图标；维度文本仍粘贴到输入框 | 粘贴入口依赖当前已建 Editor，New 页尚未按图片尺寸走导入流程；原图 PNG16 导入还需单独深层支持 | main clipboard 分类、空项目 import、input focus 优先，避免 nativeImage.toPNG() 先变成 8 位 |
| `d3d0ce7` | 非具体 tab 的整条 tab bar 拖入文件、图片、图层，新建项目；具体 tab 仍接收自己 drop | 已有具体 tab 的跨文档图层 transfer；整条 bar 及空白区域新建 drop 不完整 | App 全区域 drop 路由，保留既有 tab 优先、hover 切换、文件夹导入流程 |
| `e580107` | 图层拖入新项目按旋转后图层四角联合范围建画布，忽略无像素的空白/调整层 | transferLayers 到已有文档已存在；没有对应新项目 fitted canvas 流程 | DocumentManager 根据实际像素/文字图层 bounds 计算 union 与居中；组层及依赖映射继续使用已有 clipboard 机制 |
| `067fca4` | Layers footer 调整图层按钮排在 effects 前 | 当前仍 effects 在前 | 最小 UI 顺序调整；图标及功能语义不变 |
| `7f239dc`, `a10fcb7`, `b9186f7`, `5a2e57f` | EXR/Radiance HDR/浮点 TIFF 导入、保留超白高光，完整 HDR 编辑/预览/调整合成，v13 工程 EXR 保存，EXR 导出，HDR→16/8 转换，深度 tag 更新 | 当前 Asset 只有 RGBA8/RGBA16 unorm；v12、PNG 存储；没有 HDR 浮点 Asset/codec/export。RGBA16 不等于 HDR | 见下文独立浮点链路，不能将 `deep: Uint16Array` 同时解释成 unorm 与 binary16 |
| `f5ae5ba` | Export As 的 JPEG/PNG 主按钮，PDF/有 HDR 时 EXR 放 More；PNG 快捷键仍直达 | 当前格式 select 为 PNG/JPEG/PDF，导出仅 8 位 | 新格式布局并支持 PNG16 与条件 EXR 选项，透出实际导出精度，preview/encode 同一源 |
| `a65313a` | 原生并行测试使用各进程独立 NSPasteboard | Electron 的 unit tests 和实际 Electron clipboard 不共享同一原生测试实现 | 后续 runtime clipboard 检查隔离或恢复系统剪贴板；不搬 NSPasteboard 私有测试实现 |

## HDR 数据结构和格式审计

`Document/DeepLayers.swift:9` 的上下文有两种完全不同的布局：普通 `RGBA16` 是 premultiplied sRGB unsigned integer；HDR 是 premultiplied binary16 half-float extended sRGB，均每像素 8 字节。`hdrSpace` 在 85 行定义；`wideAsset` 在 165 行检查非透明像素的 straight 最亮值。大于 `1.001` 才保持 HDR，否则转普通 16 位。白色为 1，HDR RGB 可以超过 alpha，不能复用当前 `RGB <= alpha` 的校验。

`IO/ProjectStore.swift:20` 的工程版本变为 13。v13 允许 `<UUID>.exr` 图层图片，v1–12 不允许。mask 仍为 8 位灰度 PNG。HDR 保存的是 flattened HDR EXR，加载时先把文件读入内存，避免源文件替换影响 Undo。`IO/ImageImporter.swift:97` 接入 EXR/Radiance HDR，float TIFF 也走 HDR 检查。`IO/ImageExporter.swift:121` 导出 EXR，渲染和 resize 都保留 float 类型；PNG16 是另一个普通范围 flattening。

以下新增内核位于 `Rendering/DeepPixels.c` / `.h`：

| 内核 | 功能与注意点 |
|---|---|
| `deep_half_peak` | binary16 解码；找透明度归一化后最大有限颜色，判断高光是否超白 |
| `deep_hdr_normalize` / `deep_hdr_restore` | 每像素按最大 straight 颜色缩到白以内，在 RGBA16 上操作后乘回原 scale；alpha 不乘 scale |
| `deep_hdr_exposure` | extended sRGB ↔ linear，乘曝光、加 offset、gamma 后转回；不先裁到白；half round-to-nearest-even |
| `deep_take_painted_hdr` | 有变化的旧 8 位 painted patch 写到 half，未变化的原 HDR 样本保留 |
| `deep_extract_alpha_hdr` / `deep_restore_alpha_hdr` | clipping/merge 的 alpha 临时浮点保存与恢复 |
| 更新后的 `deep_split` / `deep_merge` | low 使用固定 hash 随机偏移；step 0/1/2/4；单通道 4 次或混通道 10 次调用；step 结果线性拟合、拐点逐段，保持 premult 范围 |

HDR 编辑不仅是 codec：`AdjustmentSurface`, `LiveMaskRenderer`, `MetalWarp`, `ImageResizer`, `BrushCommit`, `FloatingSelection`, `LayerMerge` 均显式携带 HDR 类型。HDR Exposure 直接全范围运行；其他混通道调色与旧工具采用 normalize/restore；空间滤镜直接用浮点源。`GPUCanvas` 的 live 调整来源也保留超白值，因此压曝光后能重新显示高光内容。EXR 导出需要 HDR composite，不可导出 clipped display proxy 再改扩展名。

上游自己的可见 canvas/预览仍把超过白色显示为白色，压曝光可显示回范围内细节；这项源码支持不等于操作系统 EDR/HDR 显示输出已验收。本项目继续区分 HDR 数据、HDR 编辑、EXR 持久化与 HDR 硬件显示四个门槛。

## 推荐实施和验收顺序

1. 完成当前深层 paint/erase/Smudge/Liquify/Image Size 统一 gate，保留已有实现和参考 fixture。
2. 并行补 typed 位深转换、16 位 fill/gradient/clear、空间滤镜与 split/merge 剩余滤镜；UI 同时补粘贴建画布、完整 tab drop、fitted layer canvas、footer 与导出 More。核心动作由 UI/MCP 共用。
3. HDR 先 codec 与显式 Asset 表示，v13 open/save/saveCopy/recovery/history/budget/public state；导入色彩变换需确认 EXR/Radiance 的线性数据转 extended sRGB，并在 EXR 保存时逆变换，不能直接把线性数据标成 encoded sRGB。
4. 再接浮点 composite、Exposure/normalize/restore、blur/paint/warp/resample、selection/merge/mask preview 和 EXR flatten/export。旧 RGBA8/RGBA16 项目与 source bytes 保留继续回归。
5. 独立参考优先：固定最新 C 内核、超白值 2/4/16、alpha 低值、half 边界/非有限值、负值处理、混合 HDR/16/8、mask/调整、保存后 reopen，source 不变和 Undo/Redo。实际 Electron/macOS 包/MCP 是独立验收，Windows 与 EDR 屏幕输出不得从源码测试推导完成。

初始只读审计阶段没有变更产品源代码、运行 build/UI 或提交；以上历史差异保留用于追溯。后续源码实施状态见下节。


## alpha.16 实施状态与剩余差异（开发版与未签名目录包验收通过）

| 项目 | 当前源码接入 | 尚未完成或尚待验收 |
|---|---|---|
| 深度转换与绘制 | `layer.convert_depth` 共用 UI/MCP 事务；8↔16、HDR→16/8、无资产空白层16位创建；深层 fill/gradient/clear、paint/erase、this-layer blur/smudge/liquify 已接源数据路径 | 开发版与未签名ARM64目录包的实际Electron/MCP统一检查已通过；all-layers retouch、选中像素变换、深层修复/仿制/内容填充/栅格合并及盖印/PSD 导出仍受精度门禁保护 |
| 画布粘贴与拖放 | New 页保留焦点的图片/数字文本分流，Finder URI优先，复制时图层快照；具体 tab/整栏/New 路由和按旋转叶子 bounds 建立新文档；保留原工程及预算失败回滚 | 实际开发版与未签名ARM64目录包的上游UI10项、双语布局52项分别通过；纯 browser Blob 图片拖放没有可信本地路径时仍不接受 |
| Layers/Export UI | 调整菜单排在效果前，12 项调整/6 效果菜单，16-Bit/HDR 徽标与转换上下文；JPEG/PNG 主按钮，More 的 PDF/条件 EXR，16-bit PNG选择 | 菜单对应的深层不支持滤镜仍会拒绝；界面可选不代表扩充滤镜内核 |
| HDR 数据及持久化 | 独立 Float32 premultiplied extended-sRGB 工作资产、原 EXR 源字节和单独 SDR proxy；v13 EXR 工程、save/history/recovery预算链路；EXR/RGBE/浮点 TIFF 原始导入接入 | 不代表原生 EDR/HDR 显示输出；开发版与未签名ARM64目录包的HDR19项、source-save-reopen及真实MCP gate已通过 |
| HDR 编辑/合成/导出 | HDR 曝光、normalize/restore 调色、画笔/擦除/模糊/Smudge/Liquify/resize和绘制路径接入；混合8/16/HDR合成；PNG16与场景线性EXR导出 | HDR composite 当前限 Normal/Multiply/Darken/Lighten/Linear Dodge (Add)/Difference；可见栅格 effects 等超出栈明确拒绝，不走8位预览兜底 |
| deep 滤镜接入及剩余效果差异 | 全部19个现有 `ImageFilter` kinds已接入UNORM16/HDR源：八类调色、Gaussian/Motion/Bloom浮点空间核、其余工具multi-probe reconstruction；独立20个C cases的6010像素/24040通道最大差值0，含4个portable Camera Raw callback参考 | HDR Camera Raw geometry/Guided/optical warp拒绝，独立HDR Lens可用；空间滤镜及Camera Raw本身与Core Image的完整视觉等价仍未验收；保持Dither高位深是相对上游显式降8位的扩展 |

格式范围：EXR为单图平面 scanline、全分辨率 HALF/FLOAT RGB(A)、NONE/RLE/ZIPS/ZIP、相同 data/display window、方形像素；multipart/tiled/deep、多视图、其他压缩及不支持的颜色声明拒绝。浮点 TIFF 为 classic TIFF RGB(A) IEEE16/32/64 strips（chunky/planar），支持 NONE/LZW/Deflate；tiled、BigTIFF、CMYK/灰度浮点及不支持的 ICC/颜色声明需转换。Radiance 线性 RGBE 转扩展 sRGB 并持久成 EXR，原 RGBE 容器不是项目资产。EXR 原文件可保留源字节；编辑后使用 FLOAT+ZIP EXR 持久数据。

独立 kernel/codec/reference 测试是结构与数值证据，不能替代真实 app 操作。当前 `tests/document-new-canvas.test.ts` 的7项通过；本轮 Electron、正式 macOS包、真实MCP、Windows和EDR屏幕输出分别保留独立gate，新开发版和未签名ARM64目录包5组114项检查分别通过，旧10组桌面回归通过，1,162项源码检查通过；见[统一验收](HIGH_DEPTH_ALPHA16_ACCEPTANCE_2026-10-12.md)。目录包未经签名，不是正式发布。先前 alpha.12–15 验收记录不覆盖或改写。

有意保留的表示差异：上游工作源使用binary16并按peak判断是否保持HDR，本项目工作源使用Float32，已有EXR即使全部低于白值也保留EXR源资产，直到用户明确转换位深。这样保持原始容器、浮点精度和source hash；并非遗漏位深标识。还不能据此宣称全部工具与上游半浮点执行逐样本相同。

滤镜细节与资源边界见[高位深滤镜参考](HIGH_DEPTH_FILTER_REFERENCE.md)。Gaussian/Motion/Bloom及HDR Lens直接保留Float32空间样本；其他HDR字节工具遵循上游normalize/restore，可能把负色归零。四次或十次探针与C参考吻合证明重建桥；Camera Raw参考回调仍是现有portable operator，不证明原生Core Image颜色流水线。单滤镜32MP/512MiB，卷积估算500M操作上限；Camera Raw另有更保守scratch预算，均在分配和修改源之前预检。开发版与未签名ARM64目录包的实际运行检查分别通过；参见[统一验收](HIGH_DEPTH_ALPHA16_ACCEPTANCE_2026-10-12.md)，不等于正式签名发布。

调整层最终源码接入12类：原八类colors + Grain/AddNoise/Gaussian/Motion。按原版规则，Normal Gaussian/Motion在同尺寸文档网格真实卷积RGBA，并按mask×opacity四通道插值，透明边缘可扩散；nonNormal blur与Gaussian Preserve Transparency恢复原target alpha。这个修正已冻结，新增31项adjustment和45项deep/20项HDR composite检查共96项通过，另57项editor/filter回归通过；详细参考在[高位深滤镜矩阵](HIGH_DEPTH_FILTER_REFERENCE.md)。

最终开发版与未签名ARM64目录包各完成5组114项检查（HDR19、上游UI10、deep composite15、deep tools18、双语布局52）；图层上下文、菜单、native文件数据拖放、新画布深层复制、HDR导出入口均经过实际Electron renderer/IPC。UI检查使用进程内ClipboardItem mock与模拟数字paste adapter，不覆盖系统剪贴板行为；自制PNG16/RGBE fixture不是外部独立真实图像语料。旧10组桌面回归和1,162项源码检查通过，统一记录见[alpha.16验收](HIGH_DEPTH_ALPHA16_ACCEPTANCE_2026-10-12.md)。目录包未签名、非正式发布，不能把这些开发运行证据替代Windows、EDR、Photoshop完整效果或全部原版像素一致。
