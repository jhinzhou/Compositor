# Compositor 1.4.8 功能补齐实施记录

日期：2026-10-09。当前开发版本：**0.3.0-alpha.3**。实施目录：`/Users/zhoujin/Documents/PS/Compositor_Electron`。

原始方案中的 **41 项功能域已全部有对应实现和操作入口**；当前已完成本轮功能开发、Mac 整体验证与双平台 alpha 包交付。这里的覆盖不表示每项所有子特性、任意图像的像素结果或全部原生控件外观已 100% 一致。明确的兼容边界与待验收事项列在下面，最终结果见本文末尾的交付表与独立验证产物。

[根目录原始方案](../../Compositor_1.4.8功能差异与补齐方案.md)保留添加前的 41 行审计快照，并追加当前进展。[独立功能审查](INDEPENDENT_1_4_8_AUDIT.md)保留源码和执行链证据。用户要求的顺序保持为功能先补齐，Windows 系统验证最后做；AI 实施按真实批次与结果记录，不采用人工人日。

## 比较基准与历史

官方本地仓库准确标签 `v1.4.8`，HEAD `24ef2885daae750537ec8d094f33e8556a8dfc9a`。安装的原应用是 1.4.7，未将其运行界面当成 1.4.8 GUI 验收。原生渲染和工程证据从准确标签的实际 Swift 类型、算法和 `ProjectStore` 提取编译；产品运行没有 Swift 依赖。

alpha.1 和 alpha.2 源码/配置/实施记录分别保留在 `artifacts/v2-alpha1-baseline/`、`artifacts/parallel-alpha2-baseline/`。既有 A1 192 像素、alpha.2 打包结果仍是历史证据，不能充作 alpha.3 包结果。未替换原应用，未提交或推送。

## 41 项当前实现映射

| 编号 | 功能 | alpha.3 当前实现 |
| --- | --- | --- |
| L01 | 24 混合模式 | 全部模式及实时菜单预览/取消、循环切换；192 个原生参考像素。 |
| L02 | 文件夹 | 整树复制、解组、折叠、祖先展开及选层滚动。 |
| L03 | 图层素材流 | 图层/组 Copy/Paste、跨文档复制与真实标签 drag/drop、Option 复制、堆叠/引用重映射。 |
| L04 | 合并 | Merge Down/Layers/Group、Copy Merged；实际渲染后一次事务提交。 |
| L05 | 栅格蒙版 | 灰度像素、组蒙版、绘制/处理、启禁用、链接/独立坐标、Option-drag 复制。 |
| L06 | 剪贴蒙版 | 连续 Alpha clip 栈、解除规则；clipboard/transfer 的 live mask bake。 |
| L07 | 调整图层 | 12 类原生结构、参数 UI、非破坏渲染、保存与双向回读。 |
| L08 | 图层效果 | 6 类效果参数及实时渲染；独立效果 Option-drag 保留其它目标效果。 |
| T01 | 共同变换 | 多层/组共同移动、缩放、旋转、翻转；画布 modifier 多选及一次 Undo。 |
| T02 | 自由扭曲 | 四角预览、轴约束、取消/提交；普通层及浮动选中像素。 |
| T03 | 精确交互 | 标签 scrub、数字 draft、吸附、mask transform、旋转辅助与取消。 |
| S01 | 基础选区 | 矩形/椭圆/自由/多边形套索、加减/反选/取消、轮廓平移。 |
| S02 | 高级选区 | 魔棒/色彩范围、形态/羽化、像素/蒙版载入、真实系统剪贴板、浮动像素变换。 |
| S03 | 识别与填充 | Object 画布拖框、CPU ONNX 主体识别/抠图、独立进程内容填充及取消/撤销。 |
| P01 | 画笔/橡皮 | 颜色/大小/硬度/透明度/平滑/直线、选区和逆坐标、快捷调值/取色手势。 |
| P02 | 修复/克隆/模糊 | Spot Healing 三模式、Clone aligned/单层/全层、Blur/Smudge/Liquify、source crosshair。 |
| P03 | 渐变/颜色 | 端点及设置可取消预览、radial、取色、前背景交换、HSV/RGB/hex。 |
| P04 | 形状 | 矩形/圆角/椭圆/线拖拽创建；尺寸变换重绘 radius/lineWidth，Tab/Shift-U 循环。 |
| P05 | 文字 | 原位多行/中文、font/color UTF-16 runs、tracking/leading、点文字/段落及八个手柄。 |
| F01 | 基础调整 | Levels/Auto、Curves、HSL 等共享参数、选区应用与可撤销像素。 |
| F02 | 常规滤镜 | Gaussian/Motion/Noise/Vignette/Bloom/Tonal Contrast/Lens Correction；保留近似边界。 |
| F03 | Camera Raw | Light/Color/Curves/Mixer/Grading/Detail/Optics/Geometry 与 Shadows/Highlights 修复。 |
| F04 | Dither/Scanlines | 参数与渲染流程、ASCII/位移/平滑/阈值/颜色拆分；采样和字体边界公开。 |
| F05 | 滤镜交互 | 实时 preview/cancel、选区 apply、Last Filter、参数历史。 |
| C01 | 画布操作 | Crop ratio/对称 draft、Canvas Size/Image Size/Trim/flip/rotate 与像素 Undo。 |
| C02 | 辅助视图 | 标尺、拖出 guide、layout grid/细分、≥800% pixel grid、Snap To。 |
| C03 | Navigator | ≥300% 可选显示、整文档 thumbnail、viewport 框点击/拖动定位。 |
| C04 | 画布显示 | 高倍率裁切原像素、指针 zoom anchor、pan、F 画布全屏与退出。 |
| U01 | 命令/快捷键 | 搜索/Return/Escape、持久化 remap、原生菜单重建、工具循环。 |
| U02 | 面板细节 | 图层自动滚动、完整操作入口、multi-select、mask/effect badges；非全部外观一致。 |
| I01 | 普通图像导入 | PNG/JPEG/BMP/GIF 首帧/WebP/SVG/HEIC/TIFF、磁盘 File drop 与尺寸预检。 |
| I02 | Photoshop | 8-bit RGB PSD/PSB、hierarchy/mask/blend/clip、文本/基础 shape/调整转换及确认报告。 |
| I03 | Camera RAW | WASM RAW decode、参数/preview/confirm/cancel、orientation、RGBA8/sRGB 与解码预算。 |
| E01 | 导出 | PNG/JPEG/PDF Export As：独立尺寸、质量/背景、实际 preview/bytes/印刷尺寸；另有 PSD/PSB 降级导出。 |
| E02 | 输出元数据 | PNG/JPEG DPI、PDF 物理页尺寸、.comp QuickLook JPEG 保存。 |
| D01 | 保存/外部修改 | per-document background save、fs.watch、干净 reload/dirty Keep/Reload/Copy、坏源保留。 |
| D02 | 工程互操作 | 真实 1.4.8 Swift ProjectStore load/save/load；44 层/34 资产，原生 metadata 与像素回读。 |
| D03 | 容量/性能 | 规范对齐 30000/200MP surface/800MP doc/10000 层/512MiB；100MP 实际桌面六项通过。 |
| D04 | 系统文件体验 | Recent、mac open-file、argv/second-instance、文件关联配置；Windows 原生待验收。 |
| A01 | Agent 对话 | 可配置 OpenAI-compatible 服务、stream/tools/MCP、图像上下文、停止与整轮回退。 |
| R01 | 分发 | alpha.3 自定义图标/许可/目录包配置；最终包验收和 Windows 由最后一轮填写。 |

## 已完成的验证与产物

所有实际桌面回归使用独立临时 profile/自制或公开许可素材；部分 chooser 路径注入仅用来确定文件，正式 decode/render/IPC/事务/保存链仍运行。不能把注入文件选择器算作已手动验收全部系统对话框。下面是分别记录的模块结果，不能把不同批次相加冒充同一最终回归。

| 验证 | 已记录结果 | 证据 |
| --- | --- | --- |
| 原生混合模式参考 | 24×8 = 192 像素；预乘 RGBA8 容差2 | `fixtures/parity/native-1.4.8-blends.json`；`artifacts/upstream-a1-validation.json` |
| 图层/蒙版/clip/调整/效果/素材流/导出/Agent | 11 项桌面通过，0 errors | `artifacts/parallel-desktop-validation.json` |
| 像素剪贴板/实际 ONNX/抠图/填充/外部 MCP/QuickLook/后台保存 | 7 项通过，0 errors | `artifacts/editing-desktop-validation.json` |
| 选中像素/渐变/颜色/Crop/套索/Clone | 6 项通过，0 errors | `artifacts/interaction-desktop-validation.json` |
| Retouch/clone sampling/crosshair/工具循环/Blur mask | 11 项通过，0 errors | `artifacts/retouch-report.json` |
| 高倍率/扭曲/scrub/共同变换/mask/zoom/fullscreen | 13 项通过，0 errors | `artifacts/viewport/desktop.json` |
| 浮动像素扭曲与 Object 拖框 | 8 项通过，0 errors | `artifacts/floating-distort/desktop.json` |
| 真实跨文档 drag 与快捷键重映射 | 3 项通过，0 errors | `artifacts/transfer-shortcuts.json` |
| PSD 报告、基础无 raster vector、Levels、PSB、文字/形状/手柄/Undo | 13 项通过，0 errors | `artifacts/content-import/desktop.json` |
| 实际 Option-drag 蒙版/独立效果及 Undo | 4 项通过，0 errors | `artifacts/component-copy/desktop.json` |
| RAW/HEIC/SVG/BMP/GIF/WebP/TIFF 导入 | 7 项通过，0 errors | `artifacts/foreign-import/desktop.json` |
| Recent/OS 文件事件/真实 File drop 路径 | 7 项通过，0 errors；Windows argv 在 Mac 模拟 | `artifacts/file-experience/desktop.json` |
| 外部热重载/冲突/坏源/保存生命周期 | 9 项通过，0 errors | `artifacts/source-watch/desktop.json` |
| 原版工程双向回读 | 44 layers /34 assets；规范 UUID 后 metadata 一致、RGBA 最大误差0 | `artifacts/native-project/validation.json` |
| 真实 100MP 核心 | decode/import、metadata transform/Undo、save/reopen 通过；峰值 RSS 2009MiB | `artifacts/capacity/core.json` |
| 真实 100MP 桌面 | 6 项通过，0 errors；open+fit 3.792s、512 preview 0.954s、Save Copy 1.477s | `artifacts/capacity/desktop-100mp.json` |
| 本轮 content/PSD/component 模块检查 | 19 项新增测试及既有 PSD14 通过；typecheck/build 通过 | 对应 `tests/content-transform`、`layer-component-copy`、`photoshop-*` 与桌面 JSON |

100MP fixture 为真实单层 10000×10000 PNG：800% 从中心正确映射回 document(5000,5000)，8 个实际源像素匹配；viewport backing 受 16MP/8192 边长预算限制。512 preview 是独立整文档输出；Save Copy 保留原资产 hash/尺寸。该样本不等于所有 200MP 表面、800MP 多层、复杂效果或长历史都已验证可用。10000 层压力保存与模型运行预算也与单图容量分开。

## 兼容与体验边界

- **像素与外观**：24 模式离散参考、代表滤镜参考与若干实际像素测试已通过；全部图片、Core Image 参数组合、字体和每个原生控件的外观/布局仍不是 100% 一致保证。`src/shared/image-filters.ts` 的 `FILTER_PARITY_LIMITATIONS` 明确：大 Gaussian/Motion 用三次 box passes，小轴向 motion 有采样上限；Camera Raw geometry、Scanlines glow resampling、Dither block downsampling 尚未全量与 native pixels 对照；ASCII 依赖字体，headless MCP 默认便携 bitmap font。
- **Retouch 反馈**：Clone source crosshair、真正 all-layer sampling 与落笔像素已验证；所有工具 hover brush outline、每段指针的连续 live stroke 反馈和原版 cursor 外观不是已完成全量一致验收。
- **浮动选中像素**：支持 preview/cancel/apply、普通和四角变换；切换图层/文档取消当前浮动 draft，不默默把未提交像素转交另一图层。Apply 一次事务、Cancel 不改原资产。
- **智能识别**：双平台 CPU ONNX 模型替代 Apple Vision，真实照片 inference 与灰度 mask 已验证；它与 Vision 的每张图分割边缘/目标判断可能不同。Content-Aware Fill 为本地算法，不能等同生成式填充。
- **PSD/PSB 与字体**：导入范围为 8-bit RGB；CMYK/高位深/HDR 明确拒绝。横排 text 与基础 shapes 保存编辑结构及原始 PNG fallback；缺字体明确提示并阻止重新排版，CJK 合理 OS fallback 有提示。支持原版可导入的 Levels/Curves/HSL；其它 adjustment 显示 skipped。复杂路径、任意 Photoshop mask/effects/text warp/特殊排版不保证可编辑保真。无 raster 基础形状纯 RGBA 2×2 AA 重建，stroke omission/AA 差异报告；diamond 不误转成矩形。额外 PSD/PSB 导出支持 raster/folder/mask/blend，text/shape/effects/adjustment 的独立编辑语义可能降级，报告明确列出。
- **TIFF 编码范围**：classic TIFF，首 IFD 的 RGB/grayscale/indexed、unsigned 1/2/4/8/16-bit、strip/tile、chunky/planar、无压缩/LZW/Deflate/PackBits、orientation 与受支持 ICC 转换。16-bit 量化 RGBA8；BigTIFF、JPEG/CCITT 压缩、CMYK/YCbCr、signed/float HDR 与需要额外颜色管理的 tags 明确拒绝，不能声称任意 TIFF 都能打开。
- **解码/资源预算**：引擎结构容量对齐 30000px/200MP surface/800MP doc/10000 layers/512MiB asset；进程 CPU/GPU 和中间缓冲另设预算。RAW/HEIC WASM 512MiB 内存、RAW sensor 约33.55MP 工作上限及64MiB encoded预算不同于引擎上限；超额明确拒绝而非盲目扩内存。
- **Agent 服务**：用户确认 OpenAI-compatible；endpoint/model/key 在应用中配置，密钥不进浏览器 localStorage，持久化遵循系统加密能力。已完成模拟真实 HTTP/SSE + 实际 stdio MCP + UI/共享事务链；用户指定的真实 provider 尚未配置，真实模型看图编辑任务验收待配置。
- **系统与分发**：mac 文件事件、Windows argv 分派模拟及 fileAssociations 配置不是 Windows 原生运行/registry/DPI 验收。正式签名公证、installer/update、Windows 中文路径/占用/Ctrl/Alt/DPI/恢复/MCP/模型应独立验收。当前为未签名 alpha。

## 最终整体验证与交付

本轮最终结果：**264 项核心测试、143 项桌面检查、18 项 Mac 打包检查全部通过**。桌面与包内检查有重叠，数字不是独立功能数量。汇总见 `artifacts/validation-summary.json`；基础编辑/多文档/原版混合/Agent/编辑/格式/系统文件/热重载八套串行复查记录为 `artifacts/final-desktop-regressions.json`。包内识别真实取消后重新运行、RAW/HEIC/TIFF/PSD/PSB、MCP及混合参考三套执行记录为 `artifacts/final-packaged-regressions.json`。

Camera Raw 最终实际预览补查3项和画布多选/画笔手势11项均通过、0 pageerror，见 `artifacts/camera-preview/desktop.json` 与 `artifacts/pointer-brush/desktop.json`。

| 最终门槛 | 结果与证据 |
| --- | --- |
| 全套核心/协议/模块测试 | PASS，264/264、0失败；`npm test`，`artifacts/integration-tests.log`。 |
| Vue/TypeScript、生产构建 | PASS；`npm run typecheck` / `npm run build`，`artifacts/final-typecheck.log` / `artifacts/final-build.log`。 |
| Mac arm64 alpha.3 | 目录包和 zip 完成；包内13项功能/进程检查、3项MCP检查、2项原版混合/整树事务检查全部通过。 |
| Windows x64 alpha.3 | 交叉构建完成；13项静态资源检查通过，`artifacts/windows-package-validation.json` 明确标为 `STATIC_PASS_NATIVE_PENDING`。修复EXE版本和六尺寸图标；机器代码、46个非图标/版本资源与ASAR保持不变。 |
| 两个平台产物完整性 | PASS；16个运行时文件分别与当前 `out` 字节一致，26个许可/源码文件、模型、图标一致；实际zip SHA256复核，`artifacts/release-integrity.json`。 |
| Windows 原生运行 | 尚未执行，当前没有Windows实机。启动/DPI/中文路径/文件占用/对话框/RAW-HEIF/ONNX取消/MCP等验收仍待实际系统；静态PASS不替代它。 |
| 正式分发 | 未签名alpha；Mac签名公证、Windows Authenticode、安装器/文件关联注册与更新服务属于后续发布验收。 |
| 用户指定真实模型服务 | 配置和实际HTTP模拟→真实MCP→像素/回退链已通过；用户在应用内填写endpoint/model/key之后才可验收真实厂家服务。 |

新产物全部在独立目录 `release/0.3.0-alpha.3/`：

- Mac应用：`mac-arm64/Compositor Electron.app`；压缩包 `Compositor-Electron-0.3.0-alpha.3-mac-arm64.zip`（235,437,743字节）。SHA256：`d86a109b68ec2701797ddcf4df63f37d3497a18df718d712a9e10f11bf8a6daf`。
- Windows便携包：`win-unpacked/Compositor Electron.exe`；压缩包 `Compositor-Electron-0.3.0-alpha.3-win-x64.zip`（319,726,574字节）。SHA256：`9086684c5e4c5b8f659b6cab1534de74fe51998d3783bb58b331a053c1a84695`。
- 两个同名 `.sha256` 校验文件；`SOURCE_MANIFEST.json` 记录交付时源码及包内资源哈希。没有Git提交或推送。

Windows包带 `Windows-Readme.md` 和 `Install-VisualCppRuntime.ps1`，与源码交付说明/脚本一致。ONNX需要微软x64 VC++运行库；脚本从官方固定地址下载、检查精确SHA256和有效Microsoft签名后安装，并检查DLL/注册表。微软二进制不放入产品，脚本在Windows实际执行及ORT加载仍待原生验收。详情见 [Windows交付说明](WINDOWS-RELEASE.md)。便携目录不注册文件关联。

原仓库、原应用及旧版本zip保留；正在运行的旧alpha.2应用和其目录没有被覆盖。上述已通过检查完成本轮开发交付，兼容/体验边界仍以本文前面的条目为准，不能据此宣称原版所有子功能或所有图像100%等价。

## 2026-10-10：左侧工具无法点击排查

运行中进程实际路径为保留的 `release/mac-arm64/Compositor Electron.app`，Info.plist版本0.2.0-alpha.2。该包renderer中存在`unavailableTools`，按钮显式`disabled`且title为Coming soon；因此截图中的选区、画笔等按钮确实无法点击。alpha.3在独立目录，所有工具均已连接chooseTool。

对真实alpha.3打包版通过Electron输入事件执行16个按钮的鼠标移动/按下/释放，全部按钮enabled并能切换active，切换后manifest/revision保持原值。新增脚本`scripts/smoke-packaged-toolbar.ts`，结果`artifacts/toolbar/packaged.json`；类型检查通过。本轮无业务源码或发布包改动，原10月9日测试/哈希仍保留为该次交付证据。

升级步骤：先保存旧窗口未保存的工程并退出旧应用，再打开`release/0.3.0-alpha.3/mac-arm64/Compositor Electron.app`。macOS单实例机制可能复用正在运行的旧窗口，需要完成退出后再启动。
