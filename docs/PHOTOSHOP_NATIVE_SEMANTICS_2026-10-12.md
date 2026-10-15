# Photoshop 桌面操作语义对照（2026-10-12）

本记录用于下一阶段常用操作对齐。基线是当前 `0.3.0-alpha.16` 源码，上一阶段已通过的开发版及未签名 macOS ARM64 目录包证据见 [alpha.16 统一验收](HIGH_DEPTH_ALPHA16_ACCEPTANCE_2026-10-12.md)。这里没有修改产品代码，没有运行 Photoshop UI，也没有把官方说明或本项目测试当作 Photoshop 实操结果。

证据分为三类：**官方定义**来自 Adobe 桌面 Photoshop 帮助及 UXP API；**本项目确认**来自当前源码及一个只读选区计算；**原生待测**须由主流程在已安装的 Photoshop 中执行并补证。Adobe 文档不公开全部笔尖核、羽化核、颜色空间和输入采样细节，因此不提供任意“匹配率”，也不由功能同名推导像素相同。

## 画笔：有基本语义，缺完整工具模型

Photoshop 的笔画 Opacity 限制同一次按下期间的总覆盖，松开后再画可以继续叠加；Flow 控制这一笔内部的累积。数字键调整 Opacity，Shift+数字调整 Flow。它们是工具属性，绘画 Mode 也与图层混合模式分别存在。[Adobe Painting tools](https://helpx.adobe.com/ca/photoshop/using/painting-tools.html)

本项目 `paintRaster()` 把笔画 coverage 与 Opacity 相乘一次，`dynamicBrushCoverage()` 在一笔内部累计 Flow。`App.vue` 已实现快速双数字输入与 Shift+数字 Flow，也已实现同一图层、同一 image/mask 目标的 Shift-click 直线连接。因此这些应进入实操核验，不再列为完全缺失。

| ID / 优先级 | 官方语义与当前差异 | 本项目源码依据 | 原生对照步骤及验收关注点 |
| --- | --- | --- | --- |
| B1 / P1 | Flow/Opacity 基本模型已实现，笔尖与采样仍非 Photoshop 参考实现。Flow=1 默认走 Compositor 连续覆盖，低 Flow 或压力动态走固定间距 dabs；切换分支的效果要实测。 | `src/shared/brush-coverage.ts`、`src/shared/brush-dynamics.ts:40`、`src/core/raster-edit.ts`、`src/renderer/App.vue:950` | 同一透明 512×512 图，黑色硬圆 64 px，Opacity 30%，Flow 100%/20%；同一笔来回 3 次，再松开重新画。对照中心 alpha、交叉处 alpha、笔尖边缘和最终 PNG。另用 Flow 99%/100% 排查突变；不能仅以最高 alpha 对齐宣称笔尖一致。 |
| B2 / P1 | 现代 Photoshop 在文本、形状、智能对象或调整层上绘画自动建立透明层；项目会在文本/形状层上写 raster 并删除其编辑元数据，在调整层上拒绝。 | `src/core/pixel-actions.ts:40`、`:57`、`:153`；`store()` 删除 `text`/`shape` | 分别选中文字、形状、调整层画一笔。验收新增 raster 的位置/选择、原层保持可编辑、一笔一次 Undo、取消/资源拒绝不留下空层。智能对象须另设真实 PSD fixture，不能拿普通 raster 代替。 |
| B3 / P1 | 绘画 Mode 不等同于图层 Blend；项目 `layer.paint` 无 Mode，Shift+加/减始终修改整层 Blend。 | `src/shared/pixel-contracts.ts` 的 `layer.paint`；`src/renderer/App.vue:960` | 在 Normal 图层上切换画笔 Multiply，画红色于蓝色底图，比较仅新笔画的颜色、既有内容和图层 Blend。新增 Mode 必须贯穿 preview、commit、8/16/HDR 与 Undo。 |
| B4 / P2 | Photoshop Airbrush 支持按住不移动持续积色；项目只有位置/压力样本，无时间或 Airbrush 模式。 | `src/shared/brush-dynamics.ts`、`App.vue` 指针事件链 | 固定点按住 0.2 秒与 2 秒，低 Flow 对照 alpha。普通 Brush 不应因为计时误增色；Airbrush 要显式开启。 |
| B5 / P1 | Photoshop 有 Normal/Full tip、Precise、轮廓粗细及 Caps Lock 切换；项目始终绘制直径圆环，额外 hardness 环仅临时显示，Caps Lock 无处理。 | `src/renderer/BrushCursor.vue:21`、`:32`；`App.vue` keydown/keyup | 同一 100 px 软圆与硬圆，100%/400% 缩放，比较 Normal tip 的覆盖边界、Full tip、Caps Lock 精确十字；光标切换不得更改图像/工具参数。 |
| B6 / P2 | Photoshop 笔尖可设置 angle/roundness/spacing、保存自定义预设及 `.abr`；项目只有三个圆形预设及 Flow/Pressure size/Pressure opacity。 | `src/renderer/BrushDynamicsTools.vue`、`src/shared/brush-dynamics.ts:4`、`:92` | 先补可保存的圆/椭圆笔尖和间距；对照长直线及压力渐变，保存后重启恢复参数。`.abr` 与纹理/双重笔刷作为后续能力，不能只增加选项名称。 |
| B7 / P1 | Photoshop smoothing 有 Pulled String、Stroke Catch-up、Catch-up on Stroke End、Adjust for Zoom；项目单一空间 leash、结束自动补端点，UI 数值除以 zoom，无停顿追赶计时及独立开关。 | `src/shared/interaction-geometry.ts:3`、`src/shared/brush-dynamics.ts:22`、`src/renderer/App.vue:318` | Smoothing 0/50，拖拐角后暂停再松开，观察暂停前后与释放后轨迹。分别测 100%/400% 缩放；项目已做 zoom 换算，不能列为完全不支持缩放调整。 |

B2 的版本依据是 Photoshop **25.0 及之后**，B4 的驻点积色也由当前桌面帮助确认；实际安装版本仍需记录。[Adobe Paint with Brush or Pencil](https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/brushes-presets/paint-with-brush-or-pencil-tool.html)

B5 的 Normal tip 表示覆盖至少 50% 的区域，Full tip 包括较低覆盖的边缘。[Adobe Painting cursor preferences](https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/brushes-presets/set-cursor-preferences-for-painting-tools.html) B6 的 angle/roundness/spacing 和预设保存由 [Adobe Create a brush](https://helpx.adobe.com/ca/photoshop/desktop/apply-painting-techniques/brushes-presets/create-brush-set-painting-options.html) 定义。B7 各模式可分别开关；官方只描述行为，没有公开等价的 leash/时间常数。[Adobe Stroke smoothing](https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/create-smoother-more-polished-brush-strokes-with-stroke-smoothing.html)

性能不应靠降低覆盖质量假装一致。Adobe 说明标准圆笔刷默认 Spacing 25%、默认 Smoothing 10%，提高间距会降低计算负荷；项目动态分支固定 10% spacing，连续分支又是另一算法，默认 smoothing=0。先记录本地所选笔尖的真实参数再比较延迟，不能把文档默认当作所有笔刷的参数。[Adobe Painting and cloning performance](https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/brushes-presets/optimize-painting-and-cloning-using-brush-settings.html)

## 选区：显示与实际覆盖必须对应

Adobe 允许建立选区前设置 Feather，也允许 Select > Modify > Feather。大羽化使全部像素低于 50% 时，边界可能不可见，帮助明确给出提示及继续保留当前 mask 的方式。[Adobe Feathered edges](https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/define-feathered-edges.html) UXP 定义 Feather 0.1–1000、画布边界效果选项，以及不更改图层的选区边界缩放/旋转；这些 API 定义应与本地 UI 一起核验。[Adobe Selection API](https://developer.adobe.com/photoshop/uxp/ps_reference/classes/selection/)

| ID / 优先级 | 当前确认的差异 | 源码依据 | 原生对照及后续验收 |
| --- | --- | --- | --- |
| S1 / P1 | 羽化绘制使用实际软 coverage，但 marching ants 明确排除 feather，仍按原几何边界。小选区大羽化时因此错误显示完整轮廓；无低于 50% 的专门提示。 | `src/shared/selection-outline.ts:93`、`src/shared/selection-coverage.ts:82`、`src/renderer/App.vue:321` | 128×128 上选中心 8×8，Feather 40；比较蚂蚁线、Quick Mask、填充 PNG alpha。轮廓隐藏不等于删除软选区。 |
| S2 / P1 | Modify 输入容许 1000，但 core 将 Feather 结果静默截到 250；工具栏 Feather 也上限 250。重复 Feather 使用平方和开根号，属于当前 Compositor 语义，尚无 Photoshop 核参考证明。 | `src/core/pixel-actions.ts:146`、`src/renderer/App.vue` selectionModify/Feather 输入；`src/shared/selection-gaussian.ts` | 分别输入 250/300/1000，检查 UI 值、实际选区状态与输出 alpha；不得“显示 300、实际 250”。重复 10+10 与单次 14.142 的行为另测，不猜 Photoshop 的 sigma 换算。 |
| S3 / P2 | Expand/Contract 只按当前几何的 50% 硬阈值做距离变换，再带回已有 feather；没有 Apply effect at canvas bounds 的模式。不能由形状圆角相同推导与 PS 软选区处理相同。 | `src/shared/selection-morphology.ts:43`、`src/shared/selection-gaussian.ts` | 矩形贴画布边界、软圆和两个相邻软选区分别 Expand/Contract 5；导出选区灰度及记录边界是否收缩。Adobe API 默认边界效果关闭，项目边界规则需实测对照。 |
| S4 / P1 | 已有 selection.translate 和选中像素 Free Transform；没有单独的选区边界旋转/缩放命令。不能将 Transform Selected Pixels 当作 PS Select > Transform Selection。 | `src/shared/pixel-contracts.ts:43`、`:44`；`src/renderer/App.vue` transform-selection 路由 | 对棋盘图建立选区，分别执行 PS Select > Transform Selection 与 Ctrl/Cmd+T。前者图像 hash 不变，仅 mask 变；后者像素变。项目需两条清楚命名且独立 Undo 的路由。 |

S1 已执行**本项目只读计算**：中心矩形 `[60,60,8,8]`、canvas `[128,128]`、`feather:40`，遍历 `selectionCoverage` 得最大 `6/255 = 0.0235294118`，同时 `selectionOutline(...)` 非空。该结果证明项目自身“轮廓与覆盖”不符；它不是 Photoshop 导出对比，也不是新功能验收。

Quick Mask、局部选区画笔、命名选区和 mask 属性已经存在，属于常用流程复核范围。命名选区在本项目工程中保存不等于 Photoshop 的任意 alpha channel/channel operations 完成；大羽化的真实 mask、命名保存/读取以及裁剪后的坐标一致性需要一并测。

## 裁剪：现有操作保留 source，补足模式和恢复入口

Adobe Crop tool 提供比例、宽高与分辨率、自定义 preset、Delete Cropped Pixels 及 Crop Shield 设置；关闭 Delete Cropped Pixels 保留画布外内容。拖动框角外可旋转裁剪框，Enter/Return 完成。[Adobe Crop tool options](https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/crop-tool-options.html)、[Adobe Crop photos](https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/crop-photos.html)

本项目 `document.crop` 改画布宽高并平移 layer/mask placement/guides/named selections，没有裁去源 raster 字节。因此应描述为**保留原始图层数据的画布裁剪**，而非破坏性裁剪。`CropOverlay` 已有八个 handles、移动、Alt 中心缩放、Ctrl 临时禁用 snapping；`applyCrop()` 已等待 pointerFinish 与 overlay settle，原偶发竞态应保持回归。

| ID / 优先级 | 当前差异 | 依据 / 实操配方 |
| --- | --- | --- |
| C1 / P1 | 无 Delete Cropped Pixels 开关；也无明确 Reveal All 或复原外部内容命令。 | `src/core/pixel-actions.ts:240`、`src/shared/pixel-contracts.ts`、`App.vue` crop toolbar。4 色图裁掉左边后保存/重开，扩大左侧画布检查恢复；保留模式必须 source hash 不变。删除模式须真实裁源、关联蒙版一致、Undo 恢复，不能通过隐藏图层伪装。 |
| C2 / P2 | 预设固定 Free/Original/1:1/4:3/3:4/16:9/9:16；无自定义比例、W×H×Resolution、保存 preset。 | `src/renderer/App.vue:305`。对照 4:5、300×200 px 与 300 PPI 的区别，明确裁剪尺寸与是否重采样，避免 DPI 字段改变像素数而无说明。 |
| C3 / P2 | 无裁剪框旋转/拉直；Rotate View 只是视图旋转。三分线固定，遮罩颜色/透明度固定。 | `src/renderer/CropOverlay.vue`、`src/renderer/crop-geometry.ts`。有倾斜水平线的图用角外旋转与 Straighten，比对成品旋转、输出尺寸、空白角和 Undo；不得用 viewAngle 当输出角度。 |

## 快捷键：已有 Photoshop profile，缺临时工具及上下文分派

当前默认 `photoshop` profile，保留独立 user overrides。已接 Ctrl/Cmd+T、Levels/Curves/Invert、Feather Shift+F6、Fill Shift+F5、前景/背景填充、合并/盖印、Tab/Shift+Tab、Shift 工具组、括号直径/硬度、空格 Hand。Mac Repeat Filter 单独映射 Cmd+Ctrl+F。快捷键表只说明绑定，操作语义与可用目标仍须逐项测。

- **K1 / P1：Spring-loaded tools 缺失。** 项目只保存 `temporaryHandKey`，按 V/H/B 等永久切工具。Adobe 支持按住临时切换、释放恢复，并允许延迟设置，默认 200 ms。配方：Brush 时按住 V 300 ms、拖移图层、释放，再画一笔；测试取消、窗口失焦及输入焦点，恢复先前工具而不丢当前 draft。[Adobe Spring-loaded shortcuts](https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/spring-loaded-shortcuts.html)
- **K2 / P1：快捷键上下文不完整。** Shift+加/减固定改 Layer Blend，缺 Brush Mode；Q 已有 Quick Mask，Caps Lock 无对应处理。先实现不同属性与焦点的明确分派，再扩快捷键数量。
- **K3 / P2：工具组不完整。** Shift+B 组只有 Brush，Shift+J 组只有 heal，不具备 Photoshop 的 Pencil/Mixer/Color Replacement 等组成员。应先给存在的子工具正确分组，不用空选项冒充未实现的工具。
- **K4 / 待实测：括号尺寸步进。** 当前约 ×1.2/÷1.2，硬度按 25% 台阶；此轮官方页面未确认现代 PS 各尺寸段的精确步进。主流程记录 1/9/10/49/50/99/100/499/500 px 的实际序列后再决定改动，不凭记忆写规则。

实操首先打开 Photoshop Edit > Keyboard Shortcuts 确认用户实际 key set，不覆盖用户设置；该对话框 Windows Ctrl+Alt+Shift+K、macOS Cmd+Option+Shift+K 由官方帮助确认。[Adobe View keyboard shortcuts](https://helpx.adobe.com/photoshop/desktop/get-started/settings-and-preferences/view-keyboard-shortcuts.html) 部分历史 Photoshop PDF 的 Airbrush 数字键反转规则仅可作复核线索，不把旧参考或 Photoshop Elements 的绑定当作当前桌面已验证行为。

## 后续层合成语义（本轮只记录）

**L1 / P2：Fill opacity 独立于 Layer opacity。** Photoshop Fill 只影响层内容，Layer opacity 同时影响效果；项目 UI/core 只有整体 opacity。PSD 导入在无 effects 时把 Fill 乘入 opacity，有 effects 时保存元数据并明确警告无法重现独立 Fill。保留未编辑 metadata 不等于当前合成一致。配方：形状加 stroke/drop shadow，Fill=0 与 Opacity=0 分别输出，观察效果是否留下；新增 Fill 要贯穿合成、导入导出、mask/clipping 与 Undo。[Adobe Layer opacity and blending](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/apply-layer-effects/set-layer-opacity-and-blending-modes.html) 源码：`src/core/photoshop-io.ts:98`、`:109`、`:208`。

## 原生证据与实施顺序

| 实操批次 | 必须固定的条件 | 主流程记录区 |
| --- | --- | --- |
| 环境 | Photoshop 版本/build、macOS、语言、键盘布局、实际快捷键集、GPU；文档 RGB profile/8 位、笔尖名称及参数；显示缩放 | 待主流程补入。 |
| 画笔 | 同一独立测试图、画笔设置；一笔/多笔分开，指针路径与按住时间；导出透明 PNG 和原始截图 | B1–B7：待本地 Photoshop 实操；此文尚未作双应用效果验收。 |
| 选区 | exact rectangle/feather、贴边和内部两种；Quick Mask/alpha channel 导出灰度，蚂蚁线截图 | S1–S4：项目 S1 只读数值已确认，其余需原生参照。 |
| 裁剪/快捷键 | 非 Background 和 Background 分开；Delete Cropped Pixels 状态、宽高/PPI、输入焦点 | C1–C3、K1–K4：待主流程补入。 |

推荐先做 **S1/S2 的显示与参数真实性、B2 的类型层保护、B5 的光标反馈、K1/K2 的临时工具和上下文**；第二批完善独立选区边界变换、裁剪保留/删除及恢复入口；第三批做可配置笔尖、Airbrush/smoothing 模式、Fill opacity 和性能测量。B1 的参考数据应先采集，新增笔尖模型不能倒退已经验收的 Compositor 笔画、PNG16/HDR 源精度或 preview/commit 一致性。

每一批独立验收 UI 动作、输出覆盖/颜色、一次 Undo/Redo、取消无变化、保存重开、8/16/HDR 的允许范围与资源拒绝。性能记录 pointer→首次预览、pointerup→提交耗时及内存峰值，按实际 fixture/硬件给数值，不以不同默认参数下的体感比较定结论。


## 阶段 2：已实现的选区与类型层保护（桌面验收待主流程填写）

本节更新上面的研究基线；上表所列 S1 与 B2 是修复前的源码观察，不能再把其旧行为描述成修复后的现状。主流程使用 Photoshop **27.11.0** 获得 `artifacts/photoshop-native/outputs/v3/native-results.tsv` 及同目录 PNG；实际点击文字图层使用画笔时出现明确的栅格化提示。这个本地行为与 Adobe 帮助所述“25.0+ 自动添加透明绘画层”存在配置或版本差异，产品此轮采用有原生实操依据的 **栅格化 / 取消** 提示，未实现自动新建透明绘画层。不能据帮助文档宣称本机 Photoshop 已观察到自动新层。

- **S1 显示已修复：** marching ants 从最终覆盖 `>= 50%` 求轮廓。软 RLE、羽化、反选、AA，以及叠加/减去/交集均先组合真实覆盖，再决定显示；轮廓隐藏不会清空选区或修改图片。按行处理硬选区与单一/叠加弱 RLE，100 MP 稀疏场景不分配整幅位图；其他软覆盖采用几何 ROI，最多 8 MP 显示采样及 8000 万几何工作量。超限明确拒绝该轮廓求值，保留实际编辑数据。缓存绑定不可变选区对象。
- **新发现并修复的参数丢失：** `appendSelectionShape` 原来把新选区 Feather 和原有全局 Feather 都归零。现替换保留新 Feather 与明确的 AA 设置；叠加、减去、交集将原软选区和新软形状分别物化为局部灰度 RLE，再组合，使两者的柔边互不串用。已有选区的归一化结果复用于指针预览。灰度物化按既有 8 位选区契约，最多一个灰度值的量化误差；不降低图片或 PNG16/HDR 数据位深。物化限 ROI 64 MP、8000 万工作量及 10 万 RLE 段，拒绝时不更改原选区。
- **B2 绘画保护已实现：** 新增 `layer.rasterize {layerId}`，可撤销并复用原始已渲染图像，保留图像字节/位深、位置、蒙版、样式效果及无关 PSD 元数据；仅去掉当前可编辑文字/形状及与其对应的 PSD 文本/向量元数据。缺少可读图像时拒绝转换，不产生空图层。文字、形状层的图像目标绘画/橡皮擦/修饰/渐变由共用核心门禁拒绝直接执行；UI 第一次点击先提示，确认不重放这个笔画，请再次绘制。取消不取得交互租约、不改历史。确认检查会话、文档、修订、选中图层集合及目标；期间收到其他编辑则提示重试。文字填色保留既有可编辑重着色语义；图层蒙版目标和 Quick Mask 不要求转换。

`tests/selection-feather-creation.test.ts` 与现有轮廓/组合/命名选区检查共 **59 项 PASS**，包括独立的 AA 面积和 Gaussian 积分阈值参照、低于阈值的弱选区、100 MP 稀疏显示、每种组合、Undo/Redo、命名选区保存重开且图片 hash 不变。`tests/layer-rasterize.test.ts` **7 项 PASS**：预览/直接命令/批处理门禁、原始 PNG16 保持、HDR helper 保持（现有工程不允许可编辑文字/形状引用 EXR，因此该 helper 检查不是 HDR 文字工程兼容证据）、蒙版及 Quick Mask、撤销、锁定/过期/缺失图像的原子拒绝、保存重开。TypeScript 检查通过。GUI/build/package 均由主流程统一执行，此文作者未启动。

**桌面脚本：** `scripts/smoke-photoshop-selection-ux.ts`。使用隔离 profile 和自制带类型元数据的 PNG fallback `.comp`，不访问用户剪贴板、不修改本机 Photoshop；这份输入用于交互验收，不能计入独立复杂 PSD 兼容样本。脚本计划实测中英文 1050×720 对话框、取消零变化、确认保持 source、再次绘画与两次 Undo、MCP 并发修订使确认失效、蒙版与 Quick Mask 绕过、实际 marquee 拖选保留 Feather/AA、弱选区轮廓为空但 coverage 存在、工具栏 Add 保留原柔边且可撤销。**当前执行证据：待主流程运行并回填 report.json；不要将脚本编写完成当作 UI PASS。**

## 羽化核差异仍保留，未迁移历史工程

主流程原生 `selection-tiny-feather40.png` 为 512×320，内部 8×8 选区 Feather 40 后 alpha 最大 **1/255**，8740 个像素有非零 alpha，没有像素达到 128/255；SHA-256 `4aec294a64f55dc485bd7053307b2c201117a32f125713500cb411c2ad3679f4`。项目相同小选区当前核最大 **6/255**。这说明两者都应隐藏蚂蚁线，但**实际柔边仍不逐像素一致**，不能因显示修复而宣称 Feather 完全对齐。

原生 80×80 内部选区 Feather 10 的中心行 200 像素读数，项目参数 5/10/15/20/25/30/35/40 对应 alpha MAE 约 15.48/10.36/5.28/**0.62**/5.01/10.49/16.53/22.99。当前项目 sigma=Feather/2，单条中心行的最佳参数 20 暗示原生 sigma 接近半径，但还不能证明角部、贴边、小区域或多次 Feather 一致；主流程已补原生 5/10/20 多半径样本供进一步调查。本轮没有更改编辑羽化核或历史项目参数意义。后续改核必须验证多组独立原生样本、50% 边界包围盒与 alpha 误差，并明确旧工程迁移策略。


### 阶段 2 补充：工具栏组合模式从选区内开始拖动

Adobe 当前桌面帮助明确将 Options bar 的 Add/Subtract 与按键方式分别列为两种有效操作，选择工具栏模式后即可拖动添加或减去；Marquee 帮助及组合教程也明确要求 Intersect 模式绘制交集形状。[Adobe 手动调整选区](https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/adjust-a-selection-manually.html)、[Adobe Marquee 模式](https://helpx.adobe.com/photoshop/desktop/make-selections/get-started-selections/make-selections-with-marquee-tools.html)、[Adobe 组合选区教程](https://helpx.adobe.com/ph_fil/photoshop/how-to/add-to-subtract-from-selections.html)。本地源码在判断“鼠标位于当前选区内且未按 Shift/Alt”时直接进入移动分支，未检查工具栏模式，因此覆盖了用户已选择的组合模式。

最小修改仅为 `App.vue` 的 selection-move 分支增加 `selectionOperation === 'replace'`。这使 Add/Subtract/Intersect 按工具栏模式创建新形状，New Selection 模式继续保留内部拖动移动边界；没有修改图层、覆盖核、键盘修饰规则或其他工具流程。`smoke-photoshop-selection-ux.ts` 新增三个实际鼠标场景：无修饰键，从当前矩形内部拖到外部，检查旧区域、交集和新增区域的独立期望覆盖、源图 hash、Undo/Redo及截图；另外检查 Replace 模式内部拖动仍移动选区。**脚本尚未运行；主流程会补本机 Photoshop 实操及桌面 gate，不以官方流程说明替代实际双应用证据。**

## 主流程最终运行跟进

alpha.17开发/实际macOS ARM64目录包均运行 `smoke-photoshop-selection-ux.ts` 13项通过，中英文1050×720提示、Cancel/Confirm/重画/两次Undo、并发修订、mask/QuickMask、Tiny Feather40、soft Add、内部Add/Subtract/Intersect与Replace移动均实测。另发现Photoshop操作配置点击mask缩略图将brush切为move，已改为保留工具；该mask实际绘画门禁通过。Gaussian/feather核未改，内部drag的本机PS补测因原生坐标/临时窗口未形成可靠结果而不计通过。后续crop/完整效果采样按原生研究报告推进，最终统一门禁见 [alpha.17](PHOTOSHOP_ALPHA17_ACCEPTANCE_2026-10-12.md)。
