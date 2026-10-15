# 最新上游界面差异与接入清单

日期：2026-10-12。上游依据：本地已获取的 `origin/main = f5ae5bad0b25b32dda9f254e62d2f07f59478698`；Swift 工作目录 HEAD 仍为 `75147a2`，本文通过 `git show origin/main:<path>` 读取新代码，没有切换或改写该工作目录。本项目依据：当前 Electron 源码；Phase 15 产品代码冻结期间只读整理，以下尚未实施或验收。

## 1. 图层底部按钮顺序和菜单

上游 [067fca4](https://github.com/robbietilton/Compositor/commit/067fca4) 在 `Compositor/UI/LayersPanel.swift` 调整为：空白图层、文件夹、蒙版、调整图层、图层效果、删除。调整按钮使用全部 `AdjustmentKind` 的菜单，效果按钮使用全部 `LayerEffectKind` 的菜单。

本项目 `src/renderer/App.vue` 的 `.layer-footer` 当前把效果放在调整之前；调整按钮直接打开 Levels 调整窗口，效果按钮直接打开现有效果面板。已有六个按钮的布局验收可复用，图标顺序及菜单行为尚不完全一致。

接入点：先移动已有两个按钮的模板顺序，保持事件和禁用条件；再补调整菜单，复用 `NATIVE_ADJUSTMENT_KINDS` 和现有 `openFilter(kind, true)`。菜单项须反映当前深度实际能力：项目仍拒绝在 16-bit 图层工程中创建可见调整图层，不能把新增菜单等同于高位深实时调整已实现。图层效果菜单应路由到已有 `openEffects` / effect kind 逻辑，避免新建重复状态。

验收：中文/英文六图标顺序、点击区域和禁用状态；菜单可选项触发相应已有窗口；深度不支持的命令不改变 source/hash/history。

## 2. Export As：JPEG、PNG 在前，其他格式放入 More

上游 [f5ae5ba](https://github.com/robbietilton/Compositor/commit/f5ae5ba) 在 `Compositor/UI/ExportAsSheet.swift` 使用 JPEG 在前、PNG 在后的分段按钮；More 菜单包含 PDF，只有存在 `hdrRaster` 才包含 EXR。选择 More 中的格式后，按钮显示对应名称并变蓝。新代码还提供可选 16-bit PNG，但仅在 `deepRaster` 存在时生效。

本项目 `src/renderer/ExportAsPanel.vue` 当前采用一个原生 select，选项 PNG、JPEG、PDF；`src/shared/export-options.ts` 仅允许这三种格式。主进程从显示合成结果编码，输出明确为 8-bit，保留 `.comp` 与导出位深提示。没有 HDR 合成或 EXR 输出。

接入点：先把现有 `format` 状态接到 JPEG/PNG 按钮和 More/PDF 菜单，预览 requestId、质量、透明背景、尺寸及取消行为保持原有路径。EXR 和 16-bit PNG 等精度功能必须先补对应合成/编码路径、契约及验收，再在菜单显示；不应将 8-bit proxy 写为名义高位深文件。仍可保留一个有明确访问性语义的 menu/listbox。

验收：两个常用格式顺序、More 的选中名称和高亮、PDF 参数显示、格式切换后旧预览不可提交、Esc/Tab/Cancel；普通工程不显示 EXR。未来另验 PNG16/EXR 实际数据与位深。

## 3. 图层位深标识与右键转换

上游 [2fe3524](https://github.com/robbietilton/Compositor/commit/2fe3524)、[5a2e57f](https://github.com/robbietilton/Compositor/commit/5a2e57f) 在 `NativeLayerList.swift` 增加图层尺寸旁的 `16-Bit` / `HDR` 标识，以及右键 Convert to 16-Bit / Convert to 8-Bit。HDR 图层另有 Convert to 16-Bit。**该源代码没有通用的位深下拉框**，入口是右键菜单；不能把下拉框当成上游现有行为。

本项目只有选中 16-bit 图层时状态栏的「16-bit layer · 8-bit display」，没有行内标识、深度转换命令和菜单。`AssetInfo.bitDepth` 已足够驱动 8/16 行内标识；当前契约没有 HDR 类型。`Editor` 会阻止既有 16-bit 图层被一般替换路径改成 8-bit，因此转换需要独立、明确授权的编辑命令，不能借普通 replace 绕过保护。

接入点：先增加行内非交互标识，放在尺寸旁，窄面板优先截断尺寸，保留位深标识；新增 `layer.convert_depth` 等独立契约及 core 执行路径后才添加菜单入口。8→16 扩展数值，不虚构原图精度；16→8 必须明确使用舍入或上游抖动规则，并保留撤销版本。仅单个可编辑的栅格/空白图层允许转换，文本、调整图层、文件夹、多选及锁定图层保持禁用。source hash、displayHash、内存预算与 Undo/Redo 都需更新；画面相同仍须刷新位深标签。

验收：8→16→8 的位深及数据、透明度、菜单禁用、撤销重做、工程保存重开、缓存刷新；HDR→16/8 在 HDR 数据路径完成后独立验收。

## 4. New canvas 界面直接粘贴图片

上游 [2522e3b](https://github.com/robbietilton/Compositor/commit/2522e3b) 在 `SelectionClipboard.swift` 和 `CompositorApp.swift` 先判断新画布图片粘贴，再处理文本控件的粘贴。剪贴板文本是合法尺寸时仍粘贴尺寸文本；Finder 复制图片文件时优先导入文件，避免使用文件图标；纯 PNG/TIFF 数据走导入路径，画布按图片尺寸创建。

本项目 `App.vue action()` 首先把输入框中的 Paste 路由到 `textEdit`，新画布尺寸控件聚焦时不会创建图片画布。`pasteClipboard` 的 PNG/JPEG 经过 `nativeImage` 再导出 PNG，并落入已有空文档的 1920×1080 默认尺寸；`Editor.pastePixels` 只新增居中图层。一般 `makeAsset` 默认不接纳 PNG16，不能直接复用这条粘贴路径声称保留 16-bit。

接入点：增加仅用于空文档的 clipboard capability/read route，在输入框转发之前处理「图片且非合法尺寸文本」。内部图层 marker 优先复用已有 source assets；文件列表走现有授权导入、PSD/RAW/SVG 决策；纯图像保存原始 PNG/TIFF 字节，使用受保护的导入链路，确认 PNG16 能保留，再原子创建图片尺寸工程。纯文本、非法/空剪贴板不产生新工程；读剪贴板和 mutation 仍在主进程处理，失败时不留下半创建的文档。

验收：新界面焦点在尺寸输入框时粘贴图片/尺寸文本、Finder 文件列表与图标、PNG16 数据、已创建文档的原有 Paste 行为、失败原子性、临时文件清理。

## 5. 整个标签栏的拖放目标

上游 [d3d0ce7](https://github.com/robbietilton/Compositor/commit/d3d0ce7) 在 `ProjectTabs.swift` 为整个标签条注册 fileURL/image/layer drop。落在现有 tab 上进入该文档，其余标签栏区域建立新文档，New drop slot 高亮同步；同源文档拒绝复制，Option 图层拖动不进入跨文档目标。

本项目现有单个 `.project-tab` 能接收内部 `application/x-compositor-layers`，450ms 悬停切换目标；`.project-tabs` 和 New 按钮没有统一新文档 drop。文件 drop 在 editor-shell 统一处理，导入当前文档，`preload.dropFiles` 仅传受信文件路径，尚无目标文档语义。

接入点：为标签栏空白区和 New 按钮增加一个共享新文档拖放入口；现有 tab handler 必须 stopPropagation，优先落入指定文档。内部拖拽保留 payload 的 sessionId/documentId/revision 校验。文件路径仍由 preload 的 `webUtils.getPathForFile` 获取，新增显式目标类型并在主进程校验，不能改成接受 renderer 任意路径。可先支持当前能验证的文件和内部图层数据，再补系统 image MIME 拖放。同步 New 高亮，并保留 macOS 标题栏窗口拖动区域、Alt 复制及同文档拒绝行为。

验收：已有 tab / 空白标签栏 / New 三位置分别拖内部图层与文件，悬停切换、同源拒绝、Alt 行为、revision 冲突、目录/PSD 弹窗取消，以及源工程资产和历史不变。

## 6. 拖入新工程后按图层内容自动调整画布

上游 [e580107](https://github.com/robbietilton/Compositor/commit/e580107) 在 `ProjectWorkspace.transferLayer` 对所有复制的叶子图层计算四个变换后的角点，合并后取 integral bounds；忽略 folder、adjustment 及没有资产或文本的空白层。只有目标尚未建立 document 才使用这些 bounds。内容中心移到新画布中心；已有目标保留尺寸和落点。独立 mask placement 使用同一个平移差值。

本项目 `DocumentManager.transferLayers → Editor.paste → pasteLayerClipboard` 已处理复制和资源 remap，但未创建新尺寸；新文档先固定 1920×1080，paste 到该尺寸中心。`selectionBounds` 已有可复用几何逻辑，仍需确认其是否与上述叶子、旋转和空白层规则一致。

接入点：在 core 增加「复制到新的空文档」的原子路由，先对全部 group descendants 求旋转后的 bounds，再创建 fitted canvas 和 remap。不可把 renderer 的预览尺寸当作权威。maskPlacement、parentID、maskSourceID、activeLayerID 和深度资产的复制继续走已有 clipboard/remap 规则。超边长和总像素预算失败时源/目标/文档列表都不得部分改变。

当前 `layer.add_blank` 已使用无 imageFile 的空白图层，与上游无资产空白层表示一致；新建空白层应直接排除，不需要扫描透明像素。导入的全透明 PNG 仍有独立 imageFile，按上游资产规则计入尺寸，不能随意把它等同于无资产空白层。已有工程若保留旧式整画布透明 PNG，应作为资产处理，不依赖图层名猜测其来源。

验收：单图、旋转/翻转图层、多图、含嵌套文件夹、负坐标、文本/形状、空白层/调整层、独立蒙版、图层间裁剪及16-bit资产；新目标尺寸与位置按角点计算，已有目标尺寸保持；Undo/Redo 和保存重开恢复同一数据。

## 接入顺序和边界

1. Phase 15 的布局、A1/A2及正式包验收完成后，先实施纯展示调整：底部按钮顺序、Export format 布局、位深行内标识；每组均做 ZH/EN 两窗口尺寸的真实页面验收。
2. 单独实现空画布粘贴与新文档原子创建；用独立剪贴板 fixture 验收输入焦点与位深保留。
3. 标签栏统一拖放入口与 core 自动尺寸路由一起实施；覆盖 group/mask/source资产及失败回滚。
4. 深度转换和高位深 PNG 导出分别补数据路径及参考验收，随后开放相应 UI；HDR/EXR 在实际 HDR backing/compositing/encoding 完成后开放。

这份清单记录规划时的源码差异，不是功能完成报告。HDR/EXR 是否已完成，以独立数据参考和正式包验收为准，不以界面出现 More 或位深标识作为证据。


## 本轮实现状态（统一验收通过）

已实现上述六项接入点：调整/效果菜单及顺序，JPEG/PNG 主选项和 More PDF/条件 EXR，16 位 PNG 导出选择，16-Bit/HDR 徽标与真实转换动作，新画布 PNG16/TIFF/内部缓存图层剪贴板，标签栏及 New 文件/图层拖放，以及 core 按旋转叶子边界建立新文档。文件路径继续由 preload 解析真实 File；新文档先完整执行粘贴和预算检查，再原子接入工作区。超边长或总像素预算时明确拒绝，不截断内容。

`tests/document-new-canvas.test.ts` 的 7 项已通过，覆盖 welcome 复用、旋转边界、复制时快照、预算/超尺寸/过期修订失败回滚、PNG16 低位数据与撤销重做、文件夹空白子层及独立蒙版共同平移。`scripts/smoke-upstream-ui.ts` 的10项和布局脚本52项已在真实开发版及未签名macOS ARM64目录包分别通过；剪贴板用进程内ClipboardItem mock，文件拖放用原生CDP File数据，图层payload用DOM事件。1,162项源码检查、旧10组桌面回归和5组114项专项通过，证据见[统一验收](HIGH_DEPTH_ALPHA16_ACCEPTANCE_2026-10-12.md)。目录包未签名、非正式发布；此处不声称系统pasteboard、Windows或Photoshop全效果等价。
