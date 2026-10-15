# Photoshop 工具栏第一阶段审计与现有手势修复（2026-10-14）

用户指定顺序：先用 REA 研究并优化现有功能，再补另一个会话总结的缺项。本批没有新增工具入口、没有添加占位按钮；不把覆盖到全部工具组等同完整还原 Photoshop。当前目标为本机 Photoshop 27.11，原始逆向材料保存在 `/Users/zhoujin/Documents/REA`。本文审计产品入口与执行链，原生算法逆向和新样本验收由本轮专题报告分别记录。

## 当前真实入口与执行链

| 组 | 产品已有入口/命令 | 现有效果/交互待对齐项 | 后续新增范围（本批不实施） |
|---|---|---|---|
| V | Move、自动选择、多选、图层/蒙版 placement；`layer.set_transform` | 对齐/吸附、modifier、撤销与真实窗口继续回归 | Artboard 是独立画板结构 |
| M | 矩形/椭圆；`selection.set` → selection composition/coverage | 本批修复交集手势；开始时 Shift 与绘制期间 Shift 语义仍需原生 GUI 核对；中心绘制、固定比例/尺寸需研究 | Single Row/Column 专用模式 |
| L | Selection Brush / Freehand / Polygonal / Magnetic；`selection.paint`、`selection.set`、磁性只读 preview | 本批修复三种套索的模式捕获；磁性吸边/AA/羽化效果仍有残差 | 不将 Lasso 声称为 Pen |
| W | Object / Quick / Wand；`selection.subject`、`selection.quick`、`selection.wand` | 本批修复 Wand 交集；Quick 仍保持 Alt 优先 subtract，不套用交集规则；对象/自然纹理模型不等效 | 模型扩充须真实独立输入 |
| C | Crop / Perspective / Straighten；`document.crop`、`document.perspective_crop`、`document.straighten` | 自动尺寸/透视采样由 REA 专题负责；本文不改 crop 内核 | Slice/Slice Select |
| I | Eyedropper、Sampler、Ruler；foreground sample、document info draft/apply | 颜色空间、16 位读值、测量单位与原生尚未全面对齐 | Note、Count（需要持久化数据） |
| J | Spot / Remove / Sampled Heal / Patch / Content Move / Red Eye | Patch AA/软尾、Diffusion 原生链独立研究；Remove/content move 有源和预算边界 | 不将本地 Remove 当生成式工具 |
| B | Brush；`layer.paint`、mask target、pressure/flow/spacing | 当前已有原生刷尖与低 Flow 残差；完整 ABR 与湿混合缺少 | Pencil、Color Replacement、Mixer |
| S | Clone；`layer.retouch` clone，Alt取源、aligned、all-layers | 克隆源变换、刷尖/位深继续对照 | Pattern Stamp |
| E | Eraser / BG / Magic；`layer.paint` erase、background/magic erase actions | BG 去污染/Find Edges、Magic AA 残差独立研究；BG 无 Flow/Opacity 原生 UI 语义已保留 | 普通 E 的 Pencil/Block/history erase |
| G | Gradient；`layer.gradient`，线性/径向、首尾可编辑、取消/确认 | 颜色插值空间、透明重建、Opacity 需原生对照 | Paint Bucket、Angle/Reflected/Diamond |
| Blur/Smudge | `layer.retouch` blur/smear，原 Compositor liquify 保留 | 流动/Strength/纹理传播没有原生等效证明 | Sharpen Brush、Finger Painting |
| T | 画布内横排文字、编辑/字体/IME、内容栅格与 metadata | 字体排版、显示与导出不能由 UI 测试宣布等效 | 竖排/文字蒙版/沿路径 |
| U | Rectangle/Roundness/Ellipse/Line，shape 参数与栅格 | 当前圆角/描边需真实输入对照 | Polygon/Triangle/Custom；路径节点/布尔另需结构 |
| H / R / Z | 平移/临时 Space、视图旋转、Zoom/Fit/100% | 手势、焦点与临时工具恢复需要真实窗口回归 | Scrubby/Animated Zoom、全量工具栏定制 |
| Q | Quick Mask，selection.paint 后恢复覆盖 | mask 选项/复杂软边/深位边界继续对照 | 不能让 BG/Magic 假冒 Quick Mask |
| 缺专用组 | K / Y / O / P / A / Adjustment Brush | 当前不存在这些专用工具；已有蒙版/Undo/调色/多边形不等于对应工具 | Frame、History/Art History、Dodge/Burn/Sponge、Pen/Path/Direct Selection、Adjustment Brush |

源码锚点：`App.vue` 工具列表/参数/pointerDown→preview→finishPointer；`tool-groups.ts` 七个多工具组与记忆；`interaction-profile.ts` profile 快捷键；`pixel-contracts.ts` 公开动作；`pixel-actions.ts`、`stroke-raster.ts`、`retouch-edit.ts` 等执行内核；`use-info-tools.ts`、`content-interaction.ts`、`content-raster.ts` 分别承担信息与内容工具真实流程。

## 已修复的现有选择工具问题

1. Wand / Marquee / Freehand Lasso 原逻辑先判断 Shift，Shift+Option 因此误作 Add。现在优先判断两个修饰键，发送/捕获 Intersect；无修饰键仍使用现有选区面板设置。
2. Polygonal Lasso 原来在完成时读取面板设置，首点击 Shift/Option 未生效，而且途中更改面板会改变最终操作。现在首点击捕获操作，之后点击和完成只用这一值；提交/取消都重置并释放同一交互 lease。
3. Magnetic Lasso 原来无修饰键固定 Replace，忽略选区面板 Add/Subtract/Intersect。新增可选的 `operation` 提供者，App 传当前面板模式；首点击捕获一次，修饰键仍优先，未传该提供者的现有调用保留 Replace 默认行为。

上述修复依据 Adobe 官方选择工具交互，不涉及 Photoshop 私有像素算子还原。参考：[官方 Photoshop 手册](https://helpx.adobe.com/content/dam/help/en/pdf/photoshop_reference.pdf) 的选择快捷键、[Marquee 说明](https://helpx.adobe.com/photoshop/desktop/make-selections/get-started-selections/make-selections-with-marquee-tools.html)、[Lasso 说明](https://helpx.adobe.com/photoshop/desktop/make-selections/freehand-selections/draw-freeform-selections-with-the-lasso-tool.html)。有已有选区时 Shift+Option 用于交集；没有已有选区时 Marquee 的 Shift/Option 几何语义是另外的问题。本批未用旧手册推断所有当前工具/所有工作区一致，也未用文档代替新的原生像素验收。

## 验证与边界

新增 `tests/selection-gesture-alpha29.test.ts` 抽取并执行实际生产 App 的 pointerDown、updateSelectionDraft、finishPolygon；不复制动作生产代码。检查 Wand 动作 Intersect、M/自由 L 真实覆盖交集、预览不改已存选区、Polygon 首点击冻结/取消/一次 lease 释放，以及 Magnetic 面板模式和 modifier 优先。与自由套索/磁性/工具组/橡皮回归合计 39 项通过。

本文不宣布 Photoshop GUI/当前产品 GUI/安装包验收通过。它们由根代理串行执行后补入总验收报告，像素等效仍依专题新原生参考决定。本批未改调色/克隆/修复/透视像素内核，没有操作 Photoshop 用户文档或启动产品应用。

## 第二阶段可执行计划

当前状态只作为未来实现建议，须遵循用户指定顺序：

- Single Row/Column：在现有 M 组加入专用模式；按点击坐标和文档边界生成一像素整行/整列，继承选择组合/历史与取消链；同时验证 Feather 和模式可见性，不把已有窄矩形当已完成。
- Pencil：需要独立不抗锯齿刷尖与覆盖/Opacity 语义，保留同一 preview/commit/undo/高位数据路径；不能把 Hardness=100 的 Brush 改名为 Pencil。
- Paint Bucket：需要点击颜色连通域、Tolerance/Contiguous/AA/All Layers 与 selection 交集、opacity/color blend；可复用已有颜色选择与 fill 基础，但必须一个实际原子 action、真实预览/取消与高位边界。Fill Selection 不算完成。
- Pattern/History/Frame/Artboard/Path：分别需要 pattern 资源、历史源快照、容器结构或贝塞尔路径。不能通过普通图形/Undo/蒙版入口冒充这些能力。
