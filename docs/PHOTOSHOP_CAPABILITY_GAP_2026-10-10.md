# Photoshop 功能操作和效果差距清单

当前 Compositor Electron 已具备基础图片编辑、图层合成、选区、蒙版、绘画、调色和 MCP 编辑链路。与 Photoshop 桌面版相比，主要差距在精细选区、专业画笔、非破坏编辑、复杂 PSD 可编辑往返和专业色彩工作流。快捷键和部分同名操作的语义也不同，会直接影响熟悉 Photoshop 的用户。

日期：2026-10-10。项目版本：0.3.0-alpha.7。源码基线：`ad9c75bde904801b52f913652558f1d44cb39cd0`。本次只整理评估与清单，产品源码没有修改。

## 统计范围和效果依据

这份清单沿用旧方案 P01–P36 的能力组，并更新为 alpha.7 当前状态；新增 P37 图层保护与排版、P38 历史面板与快照。共 **38 个差距能力组：18 个部分具备，20 个核心工作流缺失**。一组可以包含多个工具、参数或操作。这是有明确边界的差距清单，不是 Photoshop 的全部功能数，也不能换算成完成率。快捷键差异和效果差异是这些能力的其他观察维度，不再与 38 相加。

“部分具备”指相关基础链路可用，但完整 Photoshop 工作流仍有缺口；“核心缺失”指没有该组所需的核心模型或可用工作流。可用基础能力另列，避免把现有功能重复说成未实现。

Photoshop 对照以 Adobe 官方桌面帮助为准。官方最新功能页在 2026-10-05 更新，列出 2026 年 9 月 27.11 版本；AI Assisted Editor 仍明确标为 Beta。当前帮助中的新能力与长期常用工具分别说明。[Adobe 最新功能](https://helpx.adobe.com/photoshop/desktop/whats-new/whats-new-in-adobe-photoshop-on-desktop.html)、[AI Assisted Editor](https://helpx.adobe.com/photoshop/desktop/generative-ai/use-ai-assisted-mode.html)。

常用应用目录与 Spotlight 均没有找到本机 Photoshop 桌面版。因此这里的结果来自当前源码、已有项目验收记录和 Adobe 官方操作规则，**没有 Photoshop 同图实际操作、像素误差或耗时比数据**。本次新增的蒙版实验只执行本项目内核；Photoshop 的对照覆盖值由官方规则推导。已做的 Compositor 原版 C、Metal、Core Image 参考和 491 项项目测试不能代替 Photoshop 对照。

## 已有的基础编辑能力

| 基础流程 | 当前可用范围 | 与后面的差距表关系 |
| --- | --- | --- |
| 建画布与工程保存 | 像素尺寸、DPI、透明画布、`.comp` 保存/恢复、多标签 | PSD 保真和画板另见 P22/P29 |
| 导入与素材组合 | 常规图片、WebP、TIFF、HEIF/RAW 等输入路径、跨文档复制/拖动 | RAW 显影深度与导出格式另见 P27/P30 |
| 图层组织 | 新建、复制、多选、文件夹、排序、合并、可见性 | 图层锁定/对齐分布另见 P37 |
| 基本几何编辑 | 移动、缩放、旋转、翻转、持续自由变换、四角变形 | 网格、木偶、透视和脸部变形另见 P08 |
| 裁剪与尺寸 | 裁剪框、固定比例、Canvas Size、Image Size、Trim、撤销恢复视图 | 拉直、透视裁剪等另见 P01 |
| 基本选区 | 矩形/椭圆、自由/多边形套索、魔棒、色彩范围、加减/相交/反选/羽化 | 快速选区刷、精细边缘、命名选区另见 P02–P05 |
| 绘画与擦除 | 画笔/橡皮、笔径、硬度、不透明度、平滑、直线笔触、真实预览 | Flow、压感、笔尖动态和预设另见 P09–P11 |
| 基本修复 | Clone、Healing、Spot Healing、Blur、Smudge、简单 Liquify | 高级修补和完整液化另见 P06–P08 |
| 蒙版与剪贴 | 栅格图层/文件夹蒙版、链接、启禁用、绘画、反相、羽化、剪贴源 | Density、非破坏 Feather、载入语义另见 P18 |
| 文字与形状 | 水平点文字/段落框、中文、多行、局部字体/颜色、基本几何形状 | 排版与路径另见 P19–P21 |
| 基本调色与外观 | 12 类调整层、24 种混合模式、6 种图层效果、19 类图像滤镜 | 完整集合与 Photoshop 算法对应另见 P14/P16/P17/P28 |
| 视图与自动化 | 缩放、平移、标尺、网格、辅助线、Navigator、Undo/Redo、12 个 MCP 工具和内置 Agent | 工作区、Actions、历史快照另见 P32/P35/P36/P38 |

这张表表示流程存在，不表示每项都与 Photoshop 的全部子功能或像素输出相同。[项目当前说明](../README.md)、[当前原版对齐验收](NATIVE_PARITY_ALPHA6_ACCEPTANCE.md)、[国际化验收](I18N_IMPLEMENTATION.md)。

## 已有基础但需要增强的十八组

| ID | 能力组 | 当前实现和具体差距 | 影响及优先级 | 代码证据 |
| --- | --- | --- | --- | --- |
| P01 | 裁剪尺寸和画布 | 基本裁剪与尺寸已补齐；缺拉直、透视裁剪、裁剪预设管理、裁剪时内容识别补边。当前 Crop 只改变画布和位置，保留源资产；不能说裁掉的像素已被永久删除，也没有 Photoshop 的删除裁切像素选项。 | 扫描件、斜拍素材需额外操作。高 | `App.vue` crop 控制、`pixel-actions.ts` document.crop |
| P02 | 常规选区的完整操作 | 已有 AA、最终复合轮廓、组合和羽化；缺单行/单列选区、独立边界/平滑命令和完整 Photoshop 选区载入修饰键语义。Color Range 也没有完整皮肤色/高光等预设及设置存取。 | 复杂选区复用与边缘操作较繁琐。高 | `pixel-contracts.ts`、`selection-retouch.ts`、`App.vue` |
| P06 | 修复和局部调节 | Clone/Heal/Spot/Blur/Smudge 有真实内核；缺完整 Patch、Content-Aware Move、Dodge/Burn/Sponge 专用工具。Clone 没有完整多来源、来源旋转缩放等面板。 | 大区域修补、纹理保持及局部提亮压暗不足。高 | `retouch-edit.ts`、`App.vue` strokeAction |
| P07 | 内容识别填充 | 已有确定性 patch-search 填充；没有编辑采样区、排除区、旋转/缩放/镜像适配和输出到新图层的完整工作区。 | 大物体、透视纹理和结构修复缺少控制；当前预算也可能拒绝大任务。高 | `content-fill.ts`、`editor.ts` commitImageOperation |
| P08 | 专业变形和液化 | 已有四角 Distort 和局部 Liquify/Smudge；没有完整 Warp 网格、冻结/解冻/重建、人脸液化、Puppet Warp、Perspective Warp。 | 人像塑形、衣服贴图、建筑透视能力差距大。中 | `native-warp.ts`、`distort-raster.ts` |
| P09 | 完整画笔引擎 | 有圆形笔径/硬度/透明度/平滑；没有独立 Flow、笔刷混合模式、自定义笔尖、可配置 spacing、散布、纹理、双重画笔等完整参数。 | 普通标注可用；手绘、细腻修图和多次积色难以复制 Photoshop 手感。高 | `pixel-contracts.ts` layer.paint、`App.vue` strokeAction |
| P14 | 完整调整层集合 | 当前 12 类含 Levels/Curves/HSL/Exposure 等；缺 Channel Mixer、Color Lookup/LUT、Selective Color、Posterize、Threshold、Vibrance 及新 Light/Clarity/Dehaze 等独立对应层。 | 专业配色、风格复用的可编辑手段不足。中 | `image-filters.ts` NATIVE_ADJUSTMENT_KINDS |
| P16 | 完整图层样式 | 已有描边、投影、颜色叠加、内阴影、内/外发光；缺 Bevel & Emboss、Gradient/Pattern Overlay、Satin、轮廓、全局光、多重同类效果及更多描边选项。 | 金属、立体字、复杂海报样式不能完整表达。中 | `layer-effects.ts` EFFECT_KINDS |
| P18 | 完整栅格蒙版属性 | 创建、链接、启禁用和绘制已可用；缺独立 Density、保存参数而不改 mask PNG 的 Feather、完整快捷显示。Ctrl/Cmd 点击蒙版目前载入黑区阈值选区，和 Photoshop 白区灰度覆盖相反。 | 抠图修边与选区复用存在明确结果差异。高 | `mask-operations.ts`、`MaskPanel.vue`、`App.vue` maskThumbnailClick |
| P21 | 高级文字排版 | 有水平文字、字体/颜色区段、字距、行距、左右居中对齐；缺竖排、路径文字、文字变形、完整 OpenType、字符/段落样式、复杂段落规则。 | 中文海报、品牌排版与 PSD 文字再编辑会有较大差距。中 | `content-style.ts`、`content-raster.ts`、`photoshop-io.ts` convertText |
| P25 | 完整 ICC 色彩管理 | 部分输入 matrix/TRC ICC 转到 sRGB；文档固定 sRGB，没有完整文档 profile、工作色域、Assign/Convert Profile、LUT ICC、显示/打印管理工作流。 | 广色域照片、品牌颜色和跨设备输出不能完整管理。高，基础架构专题 | `foreign-color.ts`、`contracts.ts` manifestSchema |
| P27 | 完整 RAW 显影 | 有 LibRaw 显影导入和 Camera Raw 风格滤镜；没有保留 RAW 源的完整可重显影工程、相机/镜头 profile 体系、局部 AI masks、Adobe Denoise/Super Resolution 等链路；工作面最终为 8bit。 | 高光恢复、噪点、肤色及局部显影流程不能视为 Adobe Camera Raw 等价。中 | `foreign-import.ts`、`RawImportPanel.vue`、`camera-raw-*` |
| P28 | 完整滤镜集合和算法 | 当前 19 类滤镜可用；缺完整 Blur/Filter Gallery、Smart Sharpen/High Pass 等常用系列和 Neural Filters。原版参考不能证明与 Photoshop 同名算法一致。 | 特定风格/锐化/景深处理需继续补；现有输出待 Photoshop golden 对照。中 | `image-filters.ts`、`FiltersPanel.vue` |
| P29 | PSD 和 PSB 可编辑往返 | 仅 8bit RGB 输入；仅 Levels/Curves/HSL 调整可转换，其他调整可能跳过；智能对象栅格化，效果仅保留元数据，部分 vector/mask 不完整。导出文字/形状为像素，调整/原生效果没有独立 Photoshop 编辑语义。 | 复杂 PSD 可能导入即改变合成；来回编辑会损失结构。合成预览接近也不能证明重新合成相同。高 | `photoshop-io.ts`、`photoshop-adjustments.ts` |
| P30 | 专业导出和资产输出 | 有 PNG/JPEG/单页 PDF、独立 PSD/PSB；没有 TIFF/WebP 等完整输出、多尺寸批量输出、导出图层/画板、切片和完整色彩/metadata 输出策略。 | 多平台素材和摄影交付需要额外工具。中 | `export-codecs.ts`、`ExportAsPanel.vue` |
| P31 | 大工程性能和缓存 | 有 ROI、worker、16MP 视口及有限的大图实测；仍有全图 PNG 解码/编码与多次资源分配，没有完整 tile/scratch 工作架构。 | 高层数、长笔画、大滤镜和高位深性能未知；不能给 Photoshop 耗时倍数。高，架构专题 | `limits.ts`、`selection-transform.ts`、`viewport-render.ts` |
| P35 | 自然语言编辑 | 本项目有自选 OpenAI-compatible/Anthropic 服务、MCP、预览、任务取消/撤销；真实厂家接口尚未完整联调。能否看图和调用工具受模型与动作集合约束。Photoshop 已有 AI Assisted Editor Beta。 | 是可比能力及本项目的灵活性优势，不能直接判定双方质量优劣。中 | `agent-controller.ts`、`model-client.ts`、`MCP.md` |
| P36 | 工作区和属性面板 | 有 Layers、Navigator、浮动参数和命令搜索；没有完整可停靠/分组面板、工作区保存/恢复、统一目标属性入口。Tab 和部分上下文操作也与 Photoshop 不同。 | 经常打开关闭浮窗、查参数，影响熟练操作速度。高 | `App.vue`、`style.css`、`command-shortcuts.ts` |

本节 Photoshop 能力依据：[裁剪选项](https://helpx.adobe.com/uk/photoshop/desktop/crop-resize-transform/crop-straighten/crop-tool-options.html)、[色彩范围](https://helpx.adobe.com/uk/photoshop/desktop/make-selections/freehand-selections/select-a-color-range-in-photoshop.html)、[内容识别填充控制](https://helpx.adobe.com/uk/photoshop/desktop/repair-retouch/remove-objects-fill-space/adjust-content-aware-fill-settings.html)、[变形工具](https://helpx.adobe.com/photoshop/desktop/effects-filters/artistic-stylize-filters/overview-of-distortion-tools.html)、[画笔 Flow 与压感](https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/brushes-presets/paint-with-brush-or-pencil-tool.html)、[滤镜参考](https://helpx.adobe.com/photoshop/desktop/effects-filters/blur-sharpen-filters/filter-effects-reference.html)、[色彩管理](https://helpx.adobe.com/photoshop/desktop/adjust-color/color-profiles/color-management-in-photoshop.html)。

图层/文字/调整/输出能力的官方菜单范围见 [Adobe 桌面帮助](https://helpx.adobe.com/photoshop/desktop.html)。P18 的具体操作依据见下一节实验；P35 的 Beta 状态见开头官方链接。官方资料只证明 Photoshop 能力，项目的实现结论由代码和既有执行证据支持。

## 核心工作流缺失的二十组

| ID | 能力组 | Photoshop 使用方式 | 当前差距及优先级 |
| --- | --- | --- | --- |
| P03 | 精细选区工作区 | 建选区后进入 Select and Mask，切换背景视图、局部细化发丝并输出蒙版；新版另有 Enhance Edge。 | 有 Advanced matte 的整体参数，但没有完整局部边缘画笔/去色污染/多视图工作区，也没有 Enhance Edge 对应算法。高 |
| P04 | 辅助选区工具 | 用 Quick Selection/Selection Brush 涂选区域；Q 进入 Quick Mask 以绘画修改选区；Magnetic Lasso 沿边吸附；人物部位选择服务更细目标。 | 没有快速选区刷、Quick Mask、磁性套索和人物局部选择。已有 Object 点击/框选与显著主体识别保留，但模型不等价。高 |
| P05 | 命名选区和 Channels | Select > Save Selection 写成 alpha channel；Channels 中载入、组合和编辑通道。 | 只有当前选区和图层 mask；没有命名选区、Channels、Apply Image/Calculations 工作流。高 |
| P10 | 画笔和工具预设库 | Window > Brushes 选择、组织笔刷，调整后保存预设，导入 ABR。 | 没有完整预设资源库、画笔分组与 ABR 导入。中 |
| P11 | 数位笔压感和倾斜 | 在画笔选项和 Brush Settings 中将大小/透明度/Flow 等映射到笔压或倾斜。 | 协议仅二维点和整条笔画参数，没有逐点 pressure/tilt 数据链路。高 |
| P12 | 嵌入和链接智能对象 | Convert to Smart Object，或 Place Embedded/Linked；双击内容编辑，保存后更新实例。 | 普通 transform 已保留源分辨率，但没有嵌套可编辑源、链接、替换和实例更新，不能当作智能对象。高 |
| P13 | 智能滤镜栈 | 在智能对象上应用滤镜，之后重开参数、调整顺序/透明度/混合和滤镜蒙版。 | 有可编辑调整层/效果，普通 layer.filter 仍写像素；无独立智能滤镜列表。高 |
| P15 | 参数化填充层 | 从调整菜单建 Solid Color、Gradient 或 Pattern 层，再编辑参数和蒙版。 | Fill/Gradient 工具已有，但没有可重新编辑的填充层节点或图案资源。中 |
| P17 | 高级混合 | Layer Style > Blending Options 中调 Blend If、拆分阈值、Fill opacity、通道和 Knockout；文件夹可作为隔离组合。 | 有 24 个 blend 和 opacity；缺这些高级语义。文件夹按子层遍历/乘 opacity，没有 Photoshop 完整 group isolation。也缺 Dissolve、Darker/Lighter Color 等模式。高 |
| P19 | 钢笔和 Bezier 路径 | P 建路径，A 选锚点和控制柄，Paths 管理路径并转为选区或形状。 | 只有 Rectangle/Ellipse/Line；SVG 导入为栅格，不具备可编辑路径模型。中 |
| P20 | 矢量蒙版 | 以路径创建 vector mask，修改锚点后保持矢量边缘。 | mask 为 PNG，PSD vector mask 也没有完整可编辑转换。中 |
| P22 | 多画板和 Frame | 同一文档创建多画板/Frame，分别布局与输出。 | 多标签是多个文档；没有单文档 artboard 或 Frame 对象。中 |
| P23 | Layer Comps | Window > Layer Comps 保存图层可见性、位置、外观的命名方案。 | 不能存取/切换命名构图方案；Undo 和恢复副本不提供同样语义。中 |
| P24 | 高位深和色彩模式 | Image > Mode 选择 8/16/32bit、RGB/CMYK/Lab 等；具体工具支持随模式变化。 | 固定 RGBA8/sRGB；16bit TIFF 会量化，PSD 非 8bit RGB 拒绝，没有完整高位深/CMYK/HDR 编辑链。高，架构专题 |
| P26 | 印刷打样和专业打印 | 配置色彩 profile、软打样、色域警告和打印颜色管理。 | DPI 和单页 PDF 不提供 CMYK/软打样/专业印刷色彩链。按印刷需求推进 |
| P32 | Actions 和目录批处理 | Actions 录制/编辑步骤，File > Automate > Batch 对文件目录重复执行。 | MCP 批事务已有，但没有可视化录制、配方保存/复用和目录任务队列。高 |
| P33 | Photoshop 插件兼容 | Photoshop 的插件、UXP 等扩展使用其专用宿主接口。 | MCP 是本软件编辑协议，不提供 Photoshop 插件运行环境。低，独立可行性项目 |
| P34 | 生成式图像编辑 | 选择区域后使用 Generative Fill/Prompt to edit，或扩图、去物、放大；依赖专用图像服务。 | 语言模型对话不自动产生图像；没有生成填充/扩图/融合/生成放大完整接入。后续专题 |
| P37 | 图层保护和排版效率 | Layers 锁位置/像素/透明度；多选后 Align/Distribute，或自动对齐。 | 没有完整图层锁定动作/执行校验，以及一键对齐、等距分布、自动对齐。现有吸附和共同变换不能代替这些命令。高 |
| P38 | 历史面板快照和历史画笔 | Window > History 跳转状态、建立会话 snapshot；History Brush 从历史来源局部恢复。 | 已有 Undo/Redo、活动记录及 Agent Task Undo；没有状态跳转面板、命名快照和历史画笔。中 |

本节主要依据：[Select and Mask 视图和细化](https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/refine-your-selection-and-mask.html)、[Enhance Edge](https://helpx.adobe.com/photoshop/desktop/create-masks/layer-masks/use-enhance-edge-to-refine-masks.html)、[保存和载入选区](https://helpx.adobe.com/photoshop/desktop/create-masks/layer-masks/save-and-load-selections.html)、[智能对象](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/smart-objects/create-embedded-smart-objects.html)、[智能滤镜](https://helpx.adobe.com/photoshop/desktop/effects-filters/smart-filters/apply-and-manage-smart-filters.html)、[高级混合](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/apply-layer-effects/use-advanced-blending-options.html)、[Fill 和 Opacity 及文件夹混合](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/apply-layer-effects/set-layer-opacity-and-blending-modes.html)、[位深](https://helpx.adobe.com/photoshop/desktop/adjust-color/color-modes/bit-depth-in-photoshop.html)、[图层锁定](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/transform-manipulate-layers/lock-layers.html)、[History snapshots](https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/create-work-snapshots.html)、[Actions](https://helpx.adobe.com/ca/photoshop/desktop/automate-tasks/automation-settings-and-presets/use-the-actions-panel.html)。其他能力可在 [Adobe 桌面帮助](https://helpx.adobe.com/photoshop/desktop.html) 的对应工具目录核对。

## 快捷键和修饰键对照

下面比较默认配置。`Primary` 表示 Windows 的 Ctrl 或 macOS 的 Command；`Alt` 在 macOS 对应 Option。项目支持改绑，用户已改过的配置可能不同。Windows 侧当前是协议/实现规则对照，尚未完成原生设备验证。Photoshop 的默认工具切换也受 Use Shift Key for Tool Switch 偏好影响。[Adobe 快捷键 PDF](https://helpx.adobe.com/content/dam/help/en/photoshop/using/default-keyboard-shortcuts/photoshop-keyboard-shortcuts.pdf?TVGll=wnKKa)、[当前快捷键设置说明](https://helpx.adobe.com/photoshop/desktop/get-started/settings-and-preferences/view-keyboard-shortcuts.html)。

| 动作 | Photoshop 默认或官方操作 | 项目默认 | 差距 |
| --- | --- | --- | --- |
| 移动/框选/套索/魔棒/裁剪 | V/M/L/W/C | V/M/L/W/C | 主键基本一致，工具组不完整 |
| 画笔/橡皮/修复/图章 | B/E/J/S | B/E/J/S | 主键基本一致，工具组与参数不同 |
| 渐变/文字/形状/取色 | G/T/U/I | G/T/U/I | 主键基本一致；没有完整 paint bucket、文字/形状组 |
| 手型/缩放 | H/Z，Space 临时平移 | H/Z，Space 临时平移 | 基础一致；完整临时工具/视图组不同 |
| 笔径与硬度 | [ / ]，Shift+[ / Shift+] | 相同 | 调整步长/笔尖系统不必然一致 |
| 默认/交换前背景 | D/X | D/X | 基础一致 |
| 不透明度 | 1–0；快速输入两位数 | 按工具写 brush/gradient/layer opacity，支持两位数 | 基础接近；Flow 和 brush mode 缺失 |
| 全选/取消/反选 | Primary+A/D/Shift+I | 相同 | 基础一致 |
| 自由变换 | Primary+T | 相同 | 框架一致，Warp/Perspective 等范围不同 |
| 复制/剪切/粘贴/合并复制 | Primary+C/X/V/Shift+C | 相同，按选区或图层上下文执行 | 基础对应 |
| 复制选区到新层 | Primary+J | 有选区时复制选区，否则复制层 | 基础对应；新层 via cut 未完整对应 |
| 新层/编组/解组 | Primary+Shift+N/G/Shift+G | 原生菜单使用相同组合 | 基础对应 |
| 取消/提交草稿 | Esc/Enter，文字通常 Primary+Enter | 相同基础路径 | 文本编辑、字段焦点仍有上下文规则 |
| Fit/100%/标尺 | Primary+0/1/R | 相同 | 基础对应 |
| 隐藏/显示面板 | Tab；Shift+Tab 保留工具和选项 | Tab 切换当前工具子模式，Shift+Tab 没有对应面板命令 | **S01 显著冲突** |
| 切换同组工具 | Shift+对应字母，偏好可关闭 Shift 要求；工具按钮也有隐藏工具组 | Tab 或重复当前字母；仅 Shape 有 Shift+U | **S02 模式和分组不同**，Tab 在 Clone 甚至切换采样范围 |
| 旋转视图 | R | R 为 Smear，默认 Liquify 模式 | **S03 显著冲突**，没有 Rotate View 工作流 |
| 合并选中/向下合并 | Primary+E | 面板入口，无该默认绑定 | **S04 缺常用合并键** |
| 合并可见 | Primary+Shift+E | Export As | **S04 同键不同动作** |
| 盖印可见到新层 | Primary+Alt+Shift+E | 没有一键对应 | **S04 工作流缺失** |
| 填充和羽化 | Shift+F5 填充、Shift+F6 羽化；前景/背景常用 Alt+Delete / Primary+Delete | Fill/Feather 有命令，但没有这些完整默认绑定与对话语义；Delete 按上下文清除像素/删除目标 | **S05 快捷入口和语义不同** |
| 载入蒙版选区 | Primary 点击 mask 载入显露区域，保留灰度覆盖 | 载入黑区 `<128`，coverage 固定为 255 | **S06 结果相反且丢失软边** |
| 图层透明度选区组合 | Primary/Primary+Shift/Primary+Alt/三修饰键点击缩略图用于载入与组合 | 图像缩略图只走 selection.from_alpha 的替换路径；蒙版有 add/subtract，三修饰键仍先走 subtract | **S07 修饰键组合不完整** |
| 画笔 Flow | Shift+数字 | 没有 Flow 变量/动作 | **S08 参数和快捷键均缺失** |
| 常用参数对话 | Image Size、Canvas Size、Levels、Curves 等有对应菜单/快捷入口 | 有功能和命令搜索，多项缺 Photoshop 默认绑定 | **S09 默认快捷入口不完整** |
| 快速蒙版/钢笔/路径选择/减淡加深/历史画笔 | Q/P/A/O/Y | 没有这些完整工具链 | **S10 工具及其快捷键缺失** |
| 屏幕模式 | F/Shift+F 在屏幕模式间切换 | F 切换项目 canvas-only | 是相关入口，模式数和界面行为不同 |

S01 官方依据：[隐藏和显示面板](https://helpx.adobe.com/uk/photoshop/desktop/get-started/learn-the-basics/hide-show-panels.html)。S04 依据：[合并与盖印](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/get-started-layers/merge-and-stamp-layers.html)。S06/S07 依据：[从图层或蒙版载入选区](https://helpx.adobe.com/photoshop/desktop/make-selections/get-started-selections/select-non-transparent-or-unmasked-areas.html)。S08 依据：[Flow 和数字快捷键](https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/brushes-presets/paint-with-brush-or-pencil-tool.html)。其余常用工具和键位参照官方快捷键 PDF；当前默认菜单绑定仍应以目标 Photoshop 版本的 Edit > Keyboard Shortcuts 导出为最终验收输入，避免沿用旧版快捷键变更。

项目入口：[App.vue](../src/renderer/App.vue)、[原生菜单](../src/main/index.ts)、[键位匹配与改绑](../src/renderer/command-shortcuts.ts)。**现有改绑只能更换已实现命令的按键，不能补出 Flow、Quick Mask、盖印、智能对象等缺失能力。**

## 蒙版载入选区的可复现实验

创建 4×1 的 mask，灰度依次为 0、64、128、255，执行实际 `selection.from_mask` 内核，得到：

| Mask 灰度 | 本项目实际 selection coverage | Photoshop 官方规则推导的 coverage | 差别 |
| --- | --- | --- | --- |
| 0 黑 | 255 全选 | 0 不选 | 方向相反 |
| 64 暗灰 | 255 全选 | 64 部分选择 | 灰度覆盖丢失 |
| 128 灰 | 0 不选 | 128 部分选择 | 灰度覆盖丢失 |
| 255 白 | 0 不选 | 255 全选 | 方向相反 |

执行命令：`npx tsx artifacts/photoshop-audit/mask-load-probe.ts`。本地证据：[实验代码](../artifacts/photoshop-audit/mask-load-probe.ts)、[实际输出](../artifacts/photoshop-audit/mask-load-probe.json)。这些是忽略目录内的审查产物，不进入源码提交。代码中的 `<128` 是沿用原版 Compositor 的行为，属于已确认的 Photoshop 差异；若要同时保留原版习惯，建议明确提供 Photoshop/Compositor 操作配置及不同语义命令，不能静默改掉现有协议。

## 实际使用效果的差距

| 场景 | 当前可完成的操作 | 已确认的效果或工作流边界 | Photoshop 同图实测仍需确认 |
| --- | --- | --- | --- |
| 简单截图标注和拼贴 | 图片组合、裁剪、文字、画笔、PNG/JPEG 输出 | 核心路径已有；快捷键、面板和文字细节仍不同 | 完成任务耗时、点击数、文本像素边缘 |
| 普通形状和规则边缘抠图 | Wand、Marquee、Lasso、mask、羽化 | 没有 Quick Mask/快速选区刷等效率工具；加载 mask 结果已确认不同 | 完成选区耗时、轮廓与真实编辑覆盖 |
| 人物发丝毛发和半透明边缘 | U²-NetP 粗 mask、Advanced matte 参数 | 缺局部 Refine Edge/去边缘色污染完整链；不能视为 Photoshop 的对象和边缘模型 | mask IoU、边界误差、细发保留、黑白背景残边 |
| 小斑点和简单背景修复 | Clone/Heal/Spot/Content Fill | 内核真实可用；缺完整采样控制与 Patch/Remove 等工具 | 纹理连续性、重复纹理、边缘和颜色匹配 |
| 复杂去物和大范围补景 | 有本地 patch-search | 无生成式补景，采样适配/预算有限；不能按工具名承诺结构重建 | 地砖/栏杆/背景线条是否断裂、人工修补量 |
| 连续手绘或数位笔修图 | 圆笔、软硬边、透明度、平滑 | 无 Flow、压感、倾斜和笔尖动态，表达能力差异确定 | 指针到像素 p50/p95 延迟、长笔画丢点、设备曲线 |
| 人像和衣服塑形 | 局部位移/四角变形 | 缺冻结、网格、重建、脸部/木偶结构 | 五官/衣纹是否失真、边缘拉伸、预览与提交 |
| 多层海报和品牌模板 | 基础文字、shape、blend、6 类效果 | 无智能对象/完整 styles/隔离 group；同源实例和样式修改更费操作 | 相同文档的最终重新合成、字体度量、可编辑性 |
| 多次调色和 RAW 高光恢复 | 8bit Levels/Curves、Camera Raw 风格处理 | 高位深信息不保留；相机/镜头 profile、局部显影和模型不同 | RAW 明暗细节、肤色、噪声、渐变断层、参数回改 |
| 外部 PSD 编辑来回交付 | 8bit RGB 子集导入，报告降级后导出 | smart/text/shape/adjustment/effect 等结构转换损失已确认 | Photoshop 重开后的图层合成、缺效果和对象编辑 |
| 印刷和广色域输出 | sRGB、DPI、PDF | 缺完整 CMS/CMYK/软打样，不能完成专业印刷颜色链 | 标准设备下的色差和 profile 处理 |
| 大尺寸和多层工程 | 有 ROI 和有限 100MP 操作证据 | 未完成全部工具的分块/缓存架构；现有容量不等于稳定性能 | 同硬件峰值内存、延迟、取消响应与保存耗时 |

这里的“差距大”应理解为缺少完成该工作流所需的能力，不能推导出任何通用图像质量百分比。对于双方都有的基础工具，**当前没有 Photoshop 同图 golden 输出，因此不能给出“像素相似度 90%”或“速度慢几倍”这样的结论**。

## 后续优先顺序

按 AI 实施批次安排，不按人日估算；本次没有开始实现以下增强。

| 批次 | 任务 | 可 review 和验收的结果 |
| --- | --- | --- |
| 第一批 操作习惯和低成本效率 | S01–S07，P18/P36/P37 的常用子项 | 可选择 Photoshop 默认键位；Tab/工具组、merge/stamp/fill、mask coverage 明确；锁定保护和对齐分布实际有效；不改变已选择的 Compositor 配置语义。 |
| 第二批 选区与画笔 | P03/P04/P05/P09/P10/P11 | Quick Mask/选区刷/命名选区、局部修边；Flow、基础 brush preset 与逐点 pressure；每条笔画预览/提交/Undo 一致。 |
| 第三批 非破坏编辑 | P12/P13/P15/P17/P18/P38 | 原始源、滤镜栈、参数化填充、mask属性和历史快照可回改；保存重开、MCP 与人工编辑走同一模型。 |
| 第四批 模板和文件交付 | P14/P16/P19–P23/P29/P30/P32 | 优先真实模板使用的调整/样式/路径和 PSD 支持；结构支持矩阵、往返报告、批量配方与输出。 |
| 独立架构专题 | P24/P25/P26/P27/P31 | 高位深/色彩管理、RAW源与tile/scratch；按工具分别公布容量和性能，不仅提高 LIMITS。 |
| 后续模型专题 | P08/P28/P33/P34/P35 中的高级部分 | 智能模型、生成编辑和生态扩展各自有固定验收素材与错误/费用/取消处理。 |

Photoshop 配置应兼容现有 Compositor 操作习惯。先实现命令语义，再配置默认键；仅改快捷键表会把用户带到仍缺失的操作。工具输出应在同一规格下比较：同图、同像素尺寸、同 profile、同位深、同目标图层/蒙版、同参数与文档坐标，不用屏幕截图直接计算算法误差。

同图验收素材可选：带毛发的人像、白底产品、树枝/玻璃、皮肤与织物、地砖/栏杆、包含多字体及 styles/smart objects 的 PSD、RAW 高动态场景与大尺寸合成。遵循用户此前要求，不使用选品调研图片。

每组记录操作路径和键位、预览与提交、导出像素、Undo/Redo、保存重开、PSD 再编辑、耗时和峰值内存。基础 deterministic 操作用 RGBA/覆盖误差；抠图用覆盖/边界与黑白背景检查；去物用结构/纹理质量和手动修补量，生成内容不要求逐像素相同。缺少目标 Photoshop 版本的实际执行结果时，保持待测状态。

## 项目证据入口

| 判断 | 当前入口 |
| --- | --- |
| 默认键位和工具子模式 | [App.vue](../src/renderer/App.vue)、[原生菜单](../src/main/index.ts)、[command-shortcuts.ts](../src/renderer/command-shortcuts.ts) |
| 画笔没有逐点压力和 Flow | [pixel-contracts.ts](../src/shared/pixel-contracts.ts)、[stroke-raster.ts](../src/core/stroke-raster.ts) |
| 蒙版阈值选区及像素羽化 | [mask-operations.ts](../src/core/mask-operations.ts)、[MaskPanel.vue](../src/renderer/MaskPanel.vue) |
| Fill 和 crop 的实际语义 | [pixel-actions.ts](../src/core/pixel-actions.ts) |
| patch-search 和局部变形 | [content-fill.ts](../src/core/content-fill.ts)、[native-warp.ts](../src/shared/native-warp.ts) |
| 12类调整和19类滤镜 | [image-filters.ts](../src/shared/image-filters.ts) |
| 六类图层效果 | [layer-effects.ts](../src/shared/layer-effects.ts) |
| group 合成策略 | [canvas-engine.ts](../src/renderer/canvas-engine.ts) orderedLayers/draw |
| 基本文字/形状范围 | [content-style.ts](../src/shared/content-style.ts) |
| PSD 输入限制及导出降级 | [photoshop-io.ts](../src/core/photoshop-io.ts)、[photoshop-adjustments.ts](../src/core/photoshop-adjustments.ts) |
| 固定 sRGB 和资源预算 | [contracts.ts](../src/shared/contracts.ts)、[limits.ts](../src/shared/limits.ts) |
| 项目测试与原版对齐证据 | [alpha.6 验收](NATIVE_PARITY_ALPHA6_ACCEPTANCE.md)、[alpha.7 验收](I18N_IMPLEMENTATION.md) |

38 组没有覆盖 Photoshop 的所有领域。视频/时间轴、HDR合并、全景拼接、焦点堆栈、云协作、Adobe资源库、科学影像和其他生态工作流仍存在额外差距。这些与当前静态图像常用编辑目标分别规划。
