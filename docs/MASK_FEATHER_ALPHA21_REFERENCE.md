# alpha.21 小半径蒙版属性羽化

本次仅改动 `src/shared/mask-feather.ts` 的 Photoshop 近似核。未标记和 `compositor` 蒙版继续使用原有 Gaussian；`photoshop` 标记代表持续校正的近似模型，其小半径输出随本次更新改善。工程字段、源蒙版 PNG、`clamp/default` 边界标记、密度顺序、16/HDR 源图像数据和 512 MiB 栅格预算均保持不变。

## 新增真实参考

根流程在 Adobe Photoshop 27.11.0 的 Properties 面板逐项修改 Feather，随后通过 descriptor **读取实际密度和羽化值**，保存 PSD 与合并 PNG。新增 15 个实际输出：0、0.1、0.2、0.3、0.4、0.5、0.6、0.7、0.8、0.9、1、1.2、1.5、2、3。自制输入为 256×192 白图及 `[88,56,80,80]` 的中央矩形蒙版。

新归档为 [photoshop-27.11-mask-feather-ui-alpha21.json](../fixtures/parity/photoshop-27.11-mask-feather-ui-alpha21.json)。原始 PSD/PNG 保留于 `artifacts/photoshop-native/outputs/mask-feather-ui-study-alpha21/`。原有 16 行参考没有修改。本次总计比较 **31 个原版输出**，其中包含重叠半径的重复采集，不是 31 个不同半径。新样本首先用于拒绝不能推广的候选，最终模型也据其结果筛选；不能将全部新样本宣称为从未参与选择的盲测集。

[archive-photoshop-mask-alpha21.ts](../scripts/archive-photoshop-mask-alpha21.ts) 校验 PASS、原版版本、descriptor 参数、PSD 参数和栅格尺寸，并记录原生 PNG、PSD、Alpha 的 SHA-256。已有归档再次运行时只校验原始文件，不把新版产品误写成历史 alpha.20 基线。

## 通用模型及过渡

小核采用点采样 Gaussian，其方差为一个固定的连续函数：

`variance = max(f², min(4f², f)) + min(1/6, f²/6)`。

在零附近采用二次方差，核连续趋向恒等，不让任意小的正值引入有限宽模糊。半径增加后采用线性方差下限；超过一个源像素后恢复二次方差。它是源像素单位下的实测近似，不是已确定的 Adobe 参数定义。

支撑区域为 `3 × sqrt(variance)`。Gaussian 系数乘以像素区间与支撑边缘的连续重叠比例，而不是在整数支撑长度变化时突然纳入整个新系数。系数保持非负、对称并归一化。浮点数下溢导致方差变成零时明确返回恒等核。

`f ≤ 1` 使用该小核；`1 < f < 2` 按 `weight = 2 − f` 连续混合小核与 alpha.20 box4 核；`f ≥ 2` 返回原 box4 核，**系数逐项完全保留**。这是小核精算与已验证宽核近似之间的实现过渡，既没有按每个参考半径查表，也没有声称 Photoshop 内部在这些阈值切换算法。

图像处理仍通过已有可分离 direct/FFT 卷积，两个方向均保持浮点中间值，最后才舍入为灰度。密度仍在羽化后与白色混合。有效蒙版扩边与独立 placement 的计算保持原路径；此次没有重新解释完整画布以外的边界语义。

## 数值实验与拒绝记录

[measure-photoshop-mask-alpha21-candidates.ts](../scripts/measure-photoshop-mask-alpha21-candidates.ts) 记录 41 个固定公式候选，在原 16 行和新 15 行参考上分别生成报告。候选涵盖连续 box3/4/6、分数宽度离散盒滤波、Gaussian 单/双像素面积积分、点采样及支撑量化/连续 taper。报告在 `artifacts/photoshop-native/measurements/mask-alpha21-candidates/` 与 `mask-alpha21-candidates-heldout/`，列出每个样本的最大误差、L1、核系数、边缘剖面以及所有改善和退化。

例如，未经支撑处理的点 Gaussian 能改善 0.3 和 1，却令 0.1 和宽半径退化；分数离散盒滤波和固定双面积核也存在明显退化。仅按前两点选择这些模型是不成立的。最终连续支撑加宽核过渡的模型在当前两组参考上没有最大误差退化。

## 当前产品结果与剩余差异

[measure-photoshop-mask-alpha21.ts](../scripts/measure-photoshop-mask-alpha21.ts) 对原版 PNG/PSD 与解压 Alpha 校验哈希，将产品与独立保留的 alpha.20 box4 基线进行完整原文档网格比较。报告位于 `artifacts/photoshop-native/measurements/mask-alpha21/comparison.json` 和 `comparison.md`。

| 新采集的 Feather | alpha.20 最大 Alpha 误差 | 当前最大 Alpha 误差 |
| --- | ---: | ---: |
| 0、0.1 | 0 | 0 |
| 0.2 | 7 | 3 |
| 0.3 | 19 | 0 |
| 0.4 | 7 | 1 |
| 0.5 | 3 | 3 |
| 0.6 | 6 | 6 |
| 0.7 | 5 | 5 |
| 0.8 | 5 | 3 |
| 0.9 | 4 | 1 |
| 1 | 5 | 2 |
| 1.2 | 3 | 2 |
| 1.5、2 | 2 | 2 |
| 3 | 3 | 3 |

原 16 个参考的 0.3 同样为 0、1 为 2，其余最大误差不退化。完整文档边缘、反向、带孔和密度128的 Feather=10 继续保持最大误差1。31 个输出的最坏误差从19降至6。

**Feather=0.6 和 0.7 仍分别存在6和5的最大误差，Feather=3仍为3。** 本次不将整体描述为逐像素一致，也不声称小半径灰度脉冲、复杂边界、缩放/旋转后的原生外观已完全验证。继续改善需要额外原版参考和通用机制的证据，而不是为这几行添加特例。

## 检查边界

[mask-feather-alpha21.test.ts](../tests/mask-feather-alpha21.test.ts) 新增18项测试，覆盖15个真实 fractional 输出、非负/对称/单位质量、零与浮点下溢、方差和过渡边界的连续性、2–250源像素旧核逐系数保持、源数据只读、密度、`clamp/default` 以及资源拒绝。

与已有模型、蒙版属性、边界和 16/HDR 合成测试合跑 **130 项通过**，类型检查通过。旧16参考误差门槛没有放宽。这里是源代码和纯数值证据；实际桌面预览/提交/Undo/save、安装目录运行与全量 gate 由根流程另行验收，不把这些项目写成已通过。
