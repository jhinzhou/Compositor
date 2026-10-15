# Photoshop 侧栏能力核对 alpha.28（2026-10-14）

**侧栏已按 Photoshop 常用顺序重排，E 已独立为普通橡皮、背景橡皮、魔术橡皮三项。本项目仍没有完整 Photoshop 工具箱；同名入口、相似图标、内部测试通过都不表示图像效果等效。** 本表按工具组说明，不能换算 Photoshop 功能完成百分比，也不改变既有112能力族的统计口径。

“有”表示基础功能有实际入口和执行链；“部分”表示同组有子工具、选项、语义或像素效果缺项；“缺少”表示没有该可用专用工具流程。源码、真实应用运行、原生效果对照分别记录：本批界面定向测试已通过，新的实际应用smoke由根代理串行执行，**此文不能先宣布运行或效果PASS**。Photoshop版本为本机27.11；工具顺序可被工作区自定义，目标是常用默认顺序的可用子集，而不是把没有实现的项放成按钮。[Adobe工具栏自定义说明](https://www.adobe.com/products/photoshop/tools.html)

## 本批修改及原生选项依据

当前顺序：Move V → Marquee M → Lasso/Selection Brush L → Object/Quick/Wand W → Crop C → Eyedropper I → Healing J → Brush B → Clone S → Eraser E → Gradient G → Blur/Smudge → Type T → Shape U → Hand H → Rotate View R → Zoom Z；Quick Mask Q和色板保留在下方。

E工具组使用已有公共菜单组件，勾号、图标、焦点和外层记忆指向同一子工具。B只激活Brush；E恢复上次使用的橡皮；Shift+E循环三项。Photoshop profile的水滴入口默认Blur，R只对应Rotate View；Compositor profile保留原来的Smear R和Tab行为。Move图标改为四向箭头、文字为大T、默认Shape为矩形。未添加Frame、History Brush、Pen/Path、Dodge的占位按钮。

根代理本轮实际打开Photoshop27.11观察到Background Eraser顶部没有Opacity/Flow。Adobe当前说明也列出刷尖、Sampling、Limits、Tolerance和Protect Foreground，背景橡皮光标为圆形加中心十字。[背景橡皮官方说明](https://helpx.adobe.com/in/photoshop/desktop/repair-retouch/clean-restore-images/change-pixels-to-transparent-with-the-background-eraser-tool.html)、[工具与光标说明](https://helpx.adobe.com/in/photoshop/using/tool-techniques/background-eraser-tool.html)

据此本项目BG面板隐藏Opacity和Flow，UI action固定opacity=1，与其他画笔上次的不透明度无关；数字不透明度快捷键不会误改图层或隐藏画笔强度。后端API保留opacity作为扩展能力，不冒充原生BG选项。普通橡皮与Magic Eraser继续提供Opacity。BG取样支持Continuous/Once/Background Swatch，Limits支持Contiguous/Discontiguous；Find Edges明确灰显尚未实现。BG只从目标图层取样，灰显All Layers解释该边界，**不把Photoshop本来不提供的BG All Layers选项统计成缺少原生功能**。刷尖Angle/Roundness、独立Spacing和数位笔Tolerance控制仍缺。

## 各工具组：有、部分、缺少

| Photoshop工具组 / 常用键 | 当前状态 | 本项目已有的实际能力 | 未补齐的子工具、方式或效果 |
|---|---|---|---|
| Move / Artboard · V | **部分** | 图层移动、变换、自动选择、多选、对齐、控制柄 | Artboard专用画板结构、画板边界和批量导出缺少；多文档不等于Artboard。[画板说明](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/layout-design-tools/get-started-artboards.html) |
| Marquee · M | **部分** | 矩形、椭圆；加减交、抗锯齿、羽化、移动选区 | Single Row/Column专用入口、完整Fixed Ratio/Fixed Size/从中心绘制习惯缺少；有1px矩形不等于专用单行列工具。[Marquee四种工具](https://helpx.adobe.com/photoshop/desktop/make-selections/get-started-selections/make-selections-with-marquee-tools.html) |
| Selection Brush / Lasso · L | **部分** | 选区画笔、自由、多边形、磁性套索；闭合、取消、撤销 | 吸边启发式和PS专有磁性/羽化边缘仍有差异，不把L四项入口齐称效果齐 |
| Object / Quick / Wand · W | **部分** | 对象选择、图像驱动快速选择、魔棒、区域/颜色/连续选择 | 对象识别、复杂自然边缘、快速选择持续增长与PS残差仍需对照；不等于Adobe模型 |
| Crop / Perspective / Slice · C | **部分** | 非破坏裁剪、拉直、四点透视、手动/建议尺寸、高位重采样 | Slice和Slice Select缺少；PS自动透视输出尺寸、采样效果仍有残差；拉直子项为本项目入口，不假作PS独立C子工具 |
| Frame · K | **缺少** | 可用蒙版手动组织相似布局，但没有Frame Tool | 占位框、独立框/图内容调整、置入与自动适配缺少。[Frame说明](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/layout-design-tools/draw-frames.html) |
| Eyedropper / Sampler / Ruler / Note / Count · I | **部分** | 吸管、颜色取样点、Info面板、标尺长度角度、取样点持久化 | Note和Count缺少；测量/取样色彩空间、16位读值及单位/颜色管理没有完全对齐。[导航与测量工具](https://helpx.adobe.com/photoshop/desktop/use-grids-measurement-guides/alignment-grids-guides/navigation-and-measuring-tools-overview.html) |
| Healing · J | **部分** | Spot Heal、Remove、Sampled Heal、Patch、Content-Aware Move、Red Eye；预览、取消、事务 | 三项新增修复工具仍有源/预算边界及PS效果差异；Patch AA/软尾alpha.28候选被拒绝，生产不改；Remove不是PS生成式移除 |
| Brush / Pencil / Color Replacement / Mixer · B | **部分** | 圆画笔、硬度/Opacity/Flow/Spacing、压力和蒙版、低位/高位数据链 | Pencil、Color Replacement、Mixer Brush、完整ABR刷尖与湿混合缺少；近硬尖和低Flow仍有公开残差。[绘画工具概览](https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/fill-objects-selections-layers/painting-tools-overview.html) |
| Adjustment Brush | **缺少专用入口** | 调整图层、蒙版和画笔可以分步组合 | 一次涂抹生成调整与mask、对象应用和上下文调整画笔流程缺少；已有调整图层不等于该工具。[Adjustment Brush](https://helpx.adobe.com/photoshop/using/adjustment-brush.html) |
| Clone / Pattern Stamp · S | **部分** | Alt取源、Aligned、当前/所有图层克隆采样 | Pattern Stamp缺少；复杂变换取源、所有PS刷尖/位深效果不完整 |
| History / Art History Brush · Y | **缺少** | 线性Undo/Redo已有 | 从历史快照局部涂回、艺术历史笔触及历史源选择缺少，Undo不等于History Brush。[历史画笔说明](https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/paint-image-states.html) |
| Eraser / Background / Magic · E | **部分，本批新增** | 普通擦除独立入口；BG颜色限制擦除；Magic区域擦除/AA/连续/所有图层采样；8/16位私有数据与共享预览提交路径 | 普通E的Pencil/Block/Erase to History缺少；BG Find Edges、复杂去背景色污染、压力Tolerance和高级刷尖欠缺；BG/Magic HDR明确拒绝。基础源码验证不等于PS毛发/软边效果相等 |
| Gradient / Paint Bucket · G | **部分** | 线性/径向，前景→透明/背景、反向、不透明度及交互调整 | Paint Bucket专用颜色连通填充入口缺少；Angle/Reflected/Diamond及完整渐变编辑/混合空间缺少。Fill Selection不是Paint Bucket。[绘画工具概览](https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/fill-objects-selections-layers/painting-tools-overview.html) |
| Blur / Sharpen / Smudge | **部分** | 现smear入口提供Blur、Smudge；原Compositor Liquify模式保留 | Sharpen Brush缺少；Strength/流动采样、Finger Painting及自然纹理传播未完全对照。Sharpen滤镜不算Sharpen Brush |
| Dodge / Burn / Sponge · O | **缺少专用入口** | 调整图层/选区调色可组合局部改变 | 专用范围/曝光/保护色调、湿式饱和度画笔链缺少；滤镜或白/黑涂色不是原生O工具 |
| Pen / Freeform / Curvature / Anchor · P | **缺少** | 多边形选区是已有相关能力 | 可编辑贝塞尔路径、锚点/手柄、工作路径保存、路径→选区/蒙版缺少。[绘图工具概览](https://helpx.adobe.com/ca/photoshop/desktop/draw-shapes-paths/create-shapes/drawing-tools-overview.html) |
| Path Selection / Direct Selection · A | **缺少** | 图层选择/变换已有 | 路径整体选择、节点编辑及布尔组合缺少；图层Move不等于Path Selection |
| Horizontal / Vertical Type / Type Mask · T | **部分** | 画布内横排文字、文本框、字体/字符样式、输入法编辑 | 竖排、横/竖文字蒙版、沿路径文字和完整排版引擎缺少；文本raster/display与PS字体排版效果未全面匹配。[当前Type层说明](https://helpx.adobe.com/photoshop/desktop/text-typography/type-layers-creation/type-layers-in-photoshop.html) |
| Shapes · U | **部分** | Rectangle、可设Corner Radius、Ellipse、Line，保留shape参数 | Triangle/Polygon/Star/Custom Shape、资源库和路径节点/布尔编辑缺少；描边/矩形圆角不能替代完整路径系统。[当前绘图工具](https://helpx.adobe.com/ca/photoshop/desktop/draw-shapes-paths/create-shapes/drawing-tools-overview.html)、[Custom Shape](https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/draw-custom-shapes.html) |
| Hand / Rotate View · H / R | **有基础入口** | 手型平移、Space临时平移、视图旋转不修改像素 | 本项目仍是两个按钮，非PS单组flyout；导航细节/触控与多屏交互未全面对照。[导航工具](https://helpx.adobe.com/photoshop/desktop/use-grids-measurement-guides/alignment-grids-guides/navigation-and-measuring-tools-overview.html) |
| Zoom · Z | **有基础入口** | 单击/Alt缩小、Fit/100%、输入百分比、滚轮/导航 | 完整PS Scrubby/Animated Zoom、GPU及触控行为未全面对照 |
| Quick Mask · Q（模式） | **部分** | 选区覆盖显示、画笔/普通橡皮、退出转换、撤销 | 完整Mask Options、复杂软边/位深差异仍需原生对照；BG/Magic不会假冒Quick Mask橡皮 |
| Toolbar customization（工作区） | **缺少** | 固定常用顺序、子工具记忆、短窗口布局已有 | Edit Toolbar拖动重排、Extra Tools、保存/加载工具箱preset缺少。[工具栏自定义](https://www.adobe.com/products/photoshop/tools.html) |

以上“缺少”项均没有新增假按钮。删除已退役3D工具之类旧版清单内容，不能拿CS6工具图宣布今天也必须拥有。对于菜单或调整功能，仍回到112族清单，不把本侧栏审查扩充为新的完成率。

## 代码及验收边界

直接检查来源：App.vue工具顺序、工具参数与pointer路径；tool-groups.ts组及记忆；editor-tool-icons.ts图标；BrushCursor.vue光标；ContentTools.vue实际文字与Shape模式；pixel-contracts.ts公开动作；color-erase-edit.ts/core内核；interaction-profile.ts键盘profile。PS侧工具名用作识别锚点，具体工作区和版本新增项以本机/当前Adobe文档为准。

新增tests/eraser-ui-alpha28.test.ts执行实际App函数，包括percent→0..255、归一化color、BG固定strength、Magic首点击点、参数数组不alias、E循环/忙碌保护及禁止误改layer opacity；不是凭源码字串说效果PASS。smoke-eraser-alpha28.ts只由根代理运行，检查真实窗口焦点、DOM菜单/参数、画布预览像素变化、取消画布清除、原子提交、Undo/Redo及保存重开，GUI报告不把功能验收当作Photoshop效果相同；本机Magic关闭AA的两组原生像素参考已有独立通过，AA原生参考仍失败，背景擦除效果仍未验，见擦除专题。具体桌面结果以本轮统一报告为准。

BG/Magic后端是有界颜色匹配与alpha编辑，BG连续取样、原生容差匹配/去污染和复杂纹理不承诺等效；需用原生hard/soft/shifted-color/natural输入分开验收。Patch新19组有明确残差，失败算法保留且没有上线，见[Patch软尾研究](PATCH_TAIL_ALPHA28_RESEARCH_2026-10-14.md)。
