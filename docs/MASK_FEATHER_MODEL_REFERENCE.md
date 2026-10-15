# 蒙版属性羽化模型与兼容边界

> 本文保留 alpha.20 的模型与测量记录。alpha.21 已改善 Photoshop 模型的 2 源像素以下核；最新公式和 31 个原版输出比较见 [MASK_FEATHER_ALPHA21_REFERENCE.md](MASK_FEATHER_ALPHA21_REFERENCE.md)。旧工程 Gaussian 兼容、边界标记与资源限制不变。

本次实现针对 **Raster mask → Mask properties → Feather**，使用 Photoshop 27.11.0 的 Properties 面板实际输入、读回与导出蒙版作为参考。它是经过独立样本检验的有界近似；不声称复刻 Adobe 的私有卷积实现，也不把选区羽化、修改蒙版像素的 Feather/Gaussian Blur 或画笔软边纳入这项结论。

参考数据位于 [photoshop-27.11-mask-feather-ui.json](../fixtures/parity/photoshop-27.11-mask-feather-ui.json)。每行保存原始蒙版、输出 Alpha、参数与 Alpha SHA-256。产品集成测量见 `artifacts/photoshop-native/measurements/mask-alpha20/` 中根流程生成的 comparison 文件；桌面及打包验收由根流程单独记录，本文件不代替这些运行证据。

## 工程模型与旧工程兼容

图层新增两个可选字段，未增加工程版本要求：

| 字段 | 值 | 含义 |
| --- | --- | --- |
| `maskFeatherModel` | 未指定或 `compositor` | 原有 Gaussian 实现及其边界行为 |
| `maskFeatherModel` | `photoshop` | 统一 box4 近似实现 |
| `maskFeatherEdgeMode` | 未指定或 `default` | 使用蒙版原有 outside/default 灰度扩边 |
| `maskFeatherEdgeMode` | `clamp` | Photoshop 模型扩边时复制原始蒙版边缘 |

旧工程未标记的蒙版不会因为加载新版自动改成 Photoshop 模型。即使旧 Gaussian 图层具有 `clamp` 标记，其旧卷积行为仍不改变。在 Photoshop 操作习惯下，用户提交新的属性修改时明确写入 `photoshop`；Compositor 操作习惯下明确写入 `compositor`。仅通过命令改密度或羽化、但省略模型时，会保留图层已有模型。界面会提示小半径仍可能与 Photoshop 存在差异。

属性修改不会重写原始蒙版 PNG；密度和羽化属于可撤销的图层属性。撤销、重做、工程保存/重开、复制蒙版，以及灰度单独显示与合成预览均携带模型和边界标记。移除、重新创建或完整替换蒙版时清除这些标记，避免新蒙版继承旧栅格的边界假设。非破坏裁剪保留已有显式边界标记，而不根据裁剪后的画布重新推断原始蒙版边界。

## 一个统一卷积族

所有半径均使用同一个连续四方盒卷积族。首先计算

`sigmaEff = sqrt(feather² + min(1/6, 2 × feather² / 3))`，

然后用四个均匀方盒卷积的 Irwin–Hall CDF 对每个像素区间积分，构造对称、归一化的一维核。横向和纵向两次卷积保持 Float32 中间值，完成后才转回灰度字节。不使用按 Feather 半径查表的核参数，也不根据参考图像反向拟合单行像素。

通用一维卷积沿用现有 direct/FFT 路径：短核直接求和，超过 33 个系数时使用 FFT。抽取出的通用函数同时供旧 Gaussian 使用，旧 Gaussian 系数与舍入路径保持不变。源栅格和核系数均不原位修改。

Feather 的单位为**源蒙版像素**，经过原有独立蒙版变换后再参与画布合成。密度在羽化后与白色混合；1×1 均匀蒙版仍作为无限灰度平面，羽化不产生有限方块。16 位 UNORM 和 HDR 合成均读取相同有效蒙版覆盖；图像的高位深源数据保持独立。

## 已测的文档边缘规则

实际参考包含原版完整 256×192 蒙版、选区接触文档左边界、Properties Feather=10 的案例。原版左边界中段保持 Alpha255；使用默认黑色扩边会产生约 Alpha123 的明显差异。复制源边缘参与羽化后，该案例最大 Alpha 误差降至 1。

这一证据支持**完整原始文档蒙版**的边界标记。它不证明所有有限蒙版都应该复制边缘。只有原始源尺寸与文档相等、placement 原点为零、尺寸与文档相等且旋转为零时，新的 Photoshop 属性修改才推断 `clamp`。已有显式标记优先。

PSD 导入还检查原始 mask patch 的尺寸与 `left/top`：导入器将稀疏 patch 补成图层大小时，补出的完整栅格不能用来证明原始 patch 是文档完整蒙版。因此，有限 PSD patch 保留 `default`，即使导入过程补出的栅格恰好与文档一样大。

复制边缘只影响有界有效羽化平面的扩边。采样远离这个平面时仍返回 `photoshopMaskDefault` 或原有背景推断值，包含密度处理；它不是让任意远处坐标无限复制最近边缘。经过任意缩放、移动、旋转的有限蒙版与原版逐像素一致性，尚未作为原生实测结论。

## 原生参考误差

以下为当前产品在 16 个实际 Properties 输出参考上的最大 Alpha 字节误差；比较原文档网格的每一个像素。参数 0.25 的原版面板实际读回为 0.3，按照实际值记录。

| 样本 | 最大误差 |
| --- | ---: |
| 中央矩形 Feather=0、0.1 | 0 |
| 中央矩形 Feather=0.3 | 19 |
| 中央矩形 Feather=0.5 | 3 |
| 中央矩形 Feather=1 | 5 |
| 中央矩形 Feather=2 | 2 |
| 中央矩形 Feather=3 | 3 |
| 中央矩形 Feather=4、6、10、20 | 1 |
| 中央矩形 Feather=50 | 2 |
| Density byte128、Feather=10 | 1 |
| 文档边缘、反向、带孔蒙版 Feather=10 | 各 1 |

最差残差是 Feather=0.3 的 19，不能将整体描述为“误差最多 3”。小半径可能受到原版像素足迹、重采样或离散量化的影响，当前证据还不能确定唯一机制。保留一个统一模型与清晰残差，比为少数已知半径加入特例更可靠。

## 资源限制与验证

处理前检查源尺寸、像素数量、数据长度、羽化范围 0–250，以及扩边后的尺寸。工作栅格预算为 512 MiB，同时遵守既有最大边长与最大表面像素数；超过限制明确拒绝，不静默减小半径或降低位深。

[mask-feather-model.test.ts](../tests/mask-feather-model.test.ts) 覆盖核归一化与对称性、独立标量求和/direct/FFT、旧 Gaussian 保持、Undo/Redo/保存、实际 MaskPanel 预览与提交一致、PSD 原始有限 patch、复制与重新创建、完整文档边界标记及裁剪保持、16/HDR 合成和 16 个原生参考。与已有蒙版属性、显示、组件复制、滤镜、深位深及 HDR 测试合跑共 **112 项通过**；类型检查和国际化检查另行运行。
