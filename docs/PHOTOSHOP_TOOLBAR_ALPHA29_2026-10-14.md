# alpha.29 工具栏补齐：选框、Pencil、Paint Bucket、O、Y、Mixer

本批按用户要求先修现有交互，再补缺项。原有工作树大量未提交修改全部保留；没有提交或推送。本文件覆盖本批实际工具链，不把新入口数量换算为 Photoshop 完成百分比。Frame/Path 为另一实现流，见其专题；现有透视/Patch/颜色擦除效果也分别验收。

## 实际交付

| 工具组 | 本批可执行能力 | 公开动作/机器边界 | 仍有的原生差异 |
|---|---|---|---|
| M（4项） | 矩形/椭圆；新增 Single Row/Column，点击/拖动定位文档一像素整行/列；组合、羽化、撤销和命名保存 | 继续 `selection.set` / named selections，不绕开 schema | 正方形/中心/固定比例手势仍有未完成范围；单行列不宣称所有原生 Feather 一致 |
| B（3项） | Brush、独立硬像素 Pencil、真实 wet-paint Mixer | Pencil 使用 `layer.paint` / Quick Mask 的 `selection.paint`，`tip:'pencil'`；Mixer 独立 `layer.mixer_brush` | Pencil 非默认 PS 所有 ABR 刷尖；Auto Erase/高级 tip 缺少。Mixer 是湿颜料局部混合近似，未恢复 Photoshop 私有求解器 |
| G（2项） | Gradient；新增 Foreground/Normal Paint Bucket，容差、连续、AA、Opacity、All Layers 分类；支持新空白图层 | `layer.bucket_fill`，真实 strokePreview / 单次提交 / 撤销保存；All Layers 是修订检查后的文档采样 | 不支持 Pattern/full blend modes；AA 有几何 fringe 近似，未通过原生 AA 验收。已有被裁小的 raster 填充限源图边界 |
| O（3项） | Dodge/Burn 的范围、Exposure、Protect Tones；Sponge 的 Saturate/Desaturate、Flow、Vibrance | 独立 `layer.tonal_brush`，同 preview/commit 的 coverage 与 selection | 局部曝光/饱和度便携近似；Protect Tones 为色相比例保护，未恢复原生色调响应 |
| Y（2项） | History Brush 局部恢复所选快照；Art History 局部源色块风格化；打开/导入已有 Initial state，可手动 capture/select | `document.history_source` capture/select/clear 是工具状态，不推进普通 revision/history；`layer.history_brush` 必须显式 sourceId | Art 是源色块近似，不等效 PS Style/Area/Tolerance；要求源和当前 doc/layer/grid/placement/precision 匹配。源快照为会话状态，不存进 `.comp` |
| A（2项） | 黑箭头 Path Selection 移动整条路径；白箭头 Direct Selection 编辑节点和控制柄；Shift+A 轮换 | 同一真实 `document.path_set` 几何提交；Path 模型与画布行为见对应专题 | 多路径联合选取、完整 Boolean 与 Photoshop vector/PSD 语义未完成 |

新功能有实际处理像素/选区的命令、交互预览、取消和原子历史，未放置不可用工具按钮。B/G/O/Y 复用现有工具组菜单、外层记忆与键盘循环，图标轮廓不同。K/P/A 注册由本批统一登记，但 Frame/Path 的模型/命令/画布操作由对应专题实现流负责。EN/中文文案及错误提示纳入 catalog。

## 精度、原子性与工具状态

Pencil 覆盖为独立二值文档像素 tip，Opacity 和 selection 由已有绘画链各应用一次；不把 Hardness=100 的抗锯齿 Brush 改名。无 Flow/软硬刷尖 UI，压力可控制直径/强度；画笔、蒙版、Quick Mask 与 RGBA8/保留 RGBA16/Float32 HDR 均走实际既有源数据链。

Paint Bucket 的单层源直接分类并编辑原数据：RGBA16 和 HDR 绝不以 display PNG 回写；RGBA16 保留低位，HDR 保留负值/扩展值未命中像素。All Layers 当前明确要求 RGB8 图层，在 renderer 分配前检查修订、16 MP 文档及深位；不以 8 位 merged proxy 悄悄修改高位源。新空白层会建立私有透明工作 raster，仅有实际变化才进入 asset/history。

O 编辑先在 active coverage 内转直色，再执行局部 operator；深位再预乘回原 alpha。所有 alpha 与未命中 samples 必须逐字节保留。RGBA8 PNG Buffer 私有输出明确复制，避免 Buffer.slice 别名导致未正确检测变化。HDR 的范围响应不会为了让测试显示变化而强行编辑范围外颜色。

Y 每个 Editor 有独立有界 source store；快照的 manifest/map 独立，实际 immutable asset 版本共享。source 的 retainedAssets 进入编辑/工作区预算，捕获先检查再写，install/new/open/reset 安装新的 Initial state。初次 image import 的初始源包含实际导入层。旧 source 在 Undo 分支被丢弃后仍保留；跨 session/变更 grid/当前 sourceId 不一致均拒绝。`document.history_source` 与普通编辑混合在一个 batch 会拒绝，避免部分更新工具状态；成功 capture/select 是 no_change document result，可在 `document.get_state` 的 historyBrush 中读取工具状态。

Mixer 的 wet/load/mix/flow、clean/load、average/tip pickup、透明保护有独立 reservoir；每个 action 明确冻结 reservoir，一次 prepared computation 同时得到像素和下一 reservoir。preview/取消不会安装 reservoir，只有成功 commit 返回的 `EditResult.mixerReservoir` 才供 UI 使用，idempotent retry 回传同一缓存结果。空白层支持绘制，默认未锁 alpha；零强度/无实际命中的 blank preview 有私有透明 fallback，不造普通事务。结果和 undo/save 的像素路径保持 8/16/HDR precision。

## 新原生 Photoshop 证据

根代理在真实 Photoshop 27.11 GUI 采集了 owned 240×160 输入上的 Paint Bucket：seed `[12,14]`，前景 `[218,44,69,255]`，Tolerance 32，AA=false，Contiguous=true，All Layers=false，Normal，Opacity 100。原生 BckT/BckA/BckS/BckF 四字符字段须使用 char ID；初次参数设置失败和纠正步骤在 REA 材料保留。

该参考通过真实 Editor action 对照，源输入与 native dimensions 同为 240×160，native 有 **11,520 个变化通道**，产品与 native 全 **153,600 个 RGBA 通道 diff=0/max=0**。这是单一 hard/opaque/no-AA 场景，不覆盖 AA、自然边缘、16/HDR 或其他桶设置。归档：[产品 fixture](../fixtures/parity/photoshop-27.11-bucket-alpha29.json)，原始 native/选项/历史保存在 `/Users/zhoujin/Documents/REA/artifacts/toolbar-native/`。

本机实际工具选择/选项还确认 `pencilTool`、`bucketTool`、`dodgeTool`、`burnInTool`、`saturationTool`、`historyBrushTool`、`artBrushTool`、`wetBrushTool`、`framedGroupTool` 等字符串。Pencil 读到 1 px / Hardness 100 / Auto Erase false；Bucket 当前32/AA/连续状态；Mixer 当前80/75/90/100。它们是本机当时工具状态，不能宣称所有版本的默认值或证明像素算子。源选项在 `tool-options.json` 与 `tool-options-verified-names.json`，错误猜名也保留。

现有选择交集修复基于官方交互与生产 handler 测试。新的 Photoshop Polygon GUI 交集探针因画布自动滚动失去有效坐标，根代理取消并恢复文档/工具；此探针**不计原生通过**。

## 验收证据及运行计划

`tests/toolbar-tools-alpha29.test.ts` 当前 **10项**：包括生产 App 单行列/独立 Pencil producer、真实 Editor command→像素/命名选区/Undo/Redo/保存重开、RGBA16/HDR、merged/locked/stale/no-op、原生 hard Bucket 全字节，以及新空白桶。其中 worker 使用生产 `editor.worker.ts` 打包加 Node parentPort 适配，执行 Pencil/Bucket/O/Y/Mixer 的只读 preview、真实 commit/retry/Undo；它证明 worker 路径，不当作 Electron 主进程/UI 打包证据。

`tests/tonal-history-integration-alpha29.test.ts` **5项**通过，覆盖 O 三种真实命令精度/alpha/选区，Y source 工具状态/默认源/预算失败原子性，history/art 同预览提交、undo/save。专有 History / Mixer / tonal helper tests 由对应实现者验收；完整 tests/typecheck/i18n/build/package 以本轮根代理最终报告为准。

Root 串行运行 `scripts/smoke-toolbar-alpha29.ts`：

- M4/B3/G2/O3/Y2 菜单、实际画布一像素行列与键盘撤销。
- Pencil 1 px 实际持笔 preview 不改 revision，提交无 AA fringe，Undo/Redo 恢复源。
- Bucket actual All Layers preview 取消与提交、连通 barrier、decoy/outside 保留、Undo/Redo。
- O 三种工具改变局部 RGB，alpha/outside 不变，撤销准确；效果只验本地工具行为。
- Y capture 不造普通历史，真实 preview 取消，所选 source 局部恢复/Art风格化及Undo/Redo。
- Mixer 实际 wet/load/mix/flow 及 reservoir：cancel 不推进颜料，commit 才 consume，Undo/Redo 精确；最终保存、关闭、重开一致。

脚本同时支持 `COMPOSITOR_EXECUTABLE` 指定安装包、`COMPOSITOR_SMOKE_OUTPUT` 指定报告目录，使用 owned temp profile/project 并检查真实窗口焦点。此实现者没有启动 Photoshop/Electron 或执行打包；新实际应用/安装包 gate 由根代理串行完成，不能提前称 PASS。
