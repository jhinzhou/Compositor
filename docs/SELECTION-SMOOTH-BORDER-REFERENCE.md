# Selection Modify: Smooth / Border

本批在现有 `selection.modify` 命令添加 `smooth` 与 `border`，复用 Editor revision、idempotency、atomic batch 和 Undo/Redo 边界，不改变既有 Expand/Contract/Feather 内核。核心位于 `src/shared/selection-modify.ts`，接入位于 `src/core/pixel-actions.ts` 的 selection.modify 分支；契约仍使用原字段 `operation`、`amount`。

## 参数与官方依据

| operation | amount | 实现与依据 |
| --- | --- | --- |
| `smooth` | 整数 1–100，Sample Radius，单位 px | 圆形邻域灰度中值。二值覆盖按邻域多数决定保留/移除；可移除孤立噪点和补小洞。Adobe 官方说明 Sample Radius 范围及多数规则，见 [Clean up stray pixels in color-based selections](https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/clean-up-stray-pixels-in-color-based-selection.html)。 |
| `border` | 整数 1–200，Width，单位 px | 参数表示围绕原边界居中的**总宽度**，两侧各 amount/2；灰度膨胀减腐蚀。奇数宽度插值相邻整数圆盘半径，保留半覆盖边缘。Adobe 官方说明 Border 范围及宽 20 px 向内/外各 10 px，见 [Create a selection around a selection border](https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/create-selection-around-selection-border.html)。 |

上述对齐入口、参数含义和主要用途，不声称 Photoshop 逐像素等效。官方文档没有完整公开邻域形状、软灰度处理、奇数宽度栅格化和边缘内核，本批选择圆形灰度中值/灰度形态梯度，并对实现规则做独立公式验证。需要后续同图同参数原生样本才可评价核差异。

## 软覆盖、反选和边缘

输入先通过现有 `selectionCoverage` 取得有效选区通道：保留 0–255 灰度、全局反选、抗锯齿和已有羽化。输出保存为当前画布坐标下的 RLE，`inverted:false`、`feather:0`；已有羽化已成为实际灰度数据，不会在结果上重复羽化。原 Selection 不原地修改。

Smooth 对画布边缘钳制，满通道保持满、64/255 的均匀通道保持 64/255。Border 对画布外按 0 覆盖计算，结果仍严格限制在画布内；全选产生内侧边框，洞和外边界都产生居中边框。软边框保留灰度差，例如邻域从 64 到 255 的边框覆盖为 191，而非统一硬化为 255。

## 预算与原子失败

局部非反选优先使用有效几何 bounds，加已有羽化 halo 和邻域 halo；因此 100 MP 文档中的小选区可运行。全局反选需要完整画布覆盖，不能借局部 bounds 绕过预算。

预检包括 ROI 25 MP、估计邻域与源取样工作量 250 M、输出非零 RLE 100,000 runs。源取样计算包含复合形状、AA 的 16 次样本，以及重叠 RLE 行的线性搜索成本。大像素或大半径在分配主覆盖数组前失败，输出过度碎片化在编码时失败。没有静默缩小半径、降分辨率或硬化覆盖的退路。

helper 只在完成返回后替换 stage.selection。Editor 提交前验证，故失败保持原 selection、revision、assets 和既有 Undo transaction，batch 中此前临时修改也回滚。

## 验收

`tests/selection-modify.test.ts` 的 11 项检查包含独立慢邻域排序/极差公式、二值噪点/洞、软覆盖、奇数总宽、反选和已有羽化只物化一次、全画布边缘、100 MP 小 ROI、复杂取样预算、参数/维度限制、Undo/Redo/idempotency，以及失败命令/失败 batch 原子性。

定向命令：`npx tsx --test tests/selection-modify.test.ts tests/selection-native-parity.test.ts tests/selection-retouch.test.ts`。邻接既有 native Wand C 和 Expand/Contract/Feather 检查继续验证原路径；这些 native Wand 结果不用于声称 Smooth/Border 核的原生像素等效。本批未操作 GUI、用户配置、打包或全量 gate；新弹窗和菜单由主任务集成并做真实桌面验收。
