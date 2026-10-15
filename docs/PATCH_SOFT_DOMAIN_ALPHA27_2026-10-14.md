# Patch 软覆盖和低峰修复 alpha.27

本批修正的是软覆盖域：羽化选区不能把灰度尾部当成扩大的颜色修复区域；完全没有50%核心的选择不能凭背景颜色差生成适配膜。产品保留alpha.26锐利AA核，仅对软Patch启用核心膜向尾部的调和延拓；无核心则按实际灰度覆盖复制供体并禁用颜色适配。本批独立原生两种低峰选择逐字节一致、羽化2/6均明显改善，但锐利AA和复杂纹理仍存在效果差异，不能称完整Photoshop等价。

## 从原生观察到冻结假设

alpha.26已经公开的程序样本中，feather4中心的修正膜接近原锐利AA，旧算法却依据完整软尾部求膜，导致内外背景色差被重新带入。旧lowpeak20的原生中心变化精确等于供体按mask混合；其膜修正接近0。仅减低适配强度或改变feather峰值的连续函数会把未知参数拟合成假Diffusion，未采用。

在读取新留出之前，向根代理明确冻结soft-v1数学候选：锐利AA保持旧路径；软mask有128核心时先按既有核心求膜，固定核心场，在弱覆盖内用自由外边界调和延拓；无128核心则不求适配膜，仍对全部有效弱覆盖复制供体。核心、灰度mask、一次opacity和供体alpha置信度是分别处理的量，不把软尾删掉来降低误差。宽软域延拓复用既有Float32差分数组和role数组，不扩大私有ROI。

公开alpha.26的7组只作为研究/回归。独立alpha.27的6组由新自制源产生，各case独立物理输入，包含不同方向纹理、低频照明、待修补对象；最高低峰一组改变背景RGB关系。根代理在收到冻结消息后操作Photoshop27.11.0，通过真实Action Manager执行Normal Source、Transparent=false、healSmoothFactor=5、offset[-108,28]，并用原生alpha选择存储/复制load/黑白fill生成精确mask。不是纯鼠标拖动参考，也不是产品rasterizer生成mask。

输入来源为项目自写generator，非他人照片：常规源decoded SHA7264f72c04360e0023f4ac97c5b14ce0e1be312209d75227cae413d485e0e0b5；异背景源1ea2e74810d2a560722c527ce5ef18ec16b253abfedf266eeb38b9f4f8439834。脚本只编辑owned fresh副本，关闭这些副本后恢复原用户文档。6组源SHA、opaque grayscale mask、有效history=修补选区、error空、非零效果和选区外/alpha保持均已核验；失败执行不可删去算通过。读取结果后未根据独立6组改变soft-v1的常数、分类分支或边界模型。

## 生产实现和范围

src/core/patch-edit.ts仍按selection.feather/shape.feather及弱像素一像素邻域保守区分锐利与软覆盖。它对所有Patch指定内部selectionCoreThreshold128，对软路径另外指定selectionSoftTail；这不是public action参数，UI/MCP没有Diffusion1–7字段。Healing Brush及其他调用不指定新选项，保持既有阈值1和低峰兼容路径。

src/shared/sampled-healing.ts先冻结供体、验证预乘alpha。软路径有核心时依照既有膜解算方法得到核心场，再将核心作为已知Dirichlet场、弱尾作为未知场，外部没有指定颜色边界，再次调用现有healMembrane。没有核心时不加入背景颜色差，只进行供体合成。保护alpha时保留目的alpha/隐藏RGB；释放alpha时使用既有预乘source-over。覆盖、opacity和供体alpha各一次，RGB16/HDR仍明确拒绝而非量化。

新增尾部role准备扫描和全部膜迭代计入既有120M预算，逐行/迭代支持取消；旧16MP源、4MP工作区上限不变，预算不足在私有preparation中失败，不产生历史。没有改native-membrane.ts、公开契约、菜单、本地化或现有参数映射。更大的软选择会因第二次膜求解增加计算量；计算预算错误仍显式返回，不能宣称没有性能成本。

## 量化结果

误差是原生精确coverage>0区域内RGB byte MAE和最大单通道差。下表为实际生产preparePatch输出对照，并非仅数学模拟。所有13组每个native档位的产品选区外RGBA变化与alpha变化均0；新低峰的完整输出逐byte一致。

| D5样本 | alpha.26 MAE / Max /变更像素 | alpha.27 MAE / Max /变更像素 | 原生变更像素 |
|---|---:|---:|---:|
| 已公开浅木纹AA | 1.206097 / 14 /2554 | 1.206097 / 14 /2554 |2556 |
| 已公开老木纹AA | 3.142408 / 39 /3585 | 3.142408 / 39 /3585 |3585 |
| 已公开合成整数矩形 | 0.189286 / 1 /2569 | 0.189286 / 1 /2569 |2574 |
| 已公开第三自然木纹AA | 1.264435 / 21 /2641 | 1.264435 / 21 /2641 |2641 |
| 已公开程序AA | 1.782872 / 10 /1295 | 1.782872 / 10 /1295 |1289 |
| 已公开程序feather4 | 3.569717 / 35 /2358 | 0.947865 / 21 /2320 |2223 |
| 已公开lowpeak20 | 0.935062 / 4 /488 | **0 / 0 /890** |890 |
| 新独立斜边AA | 1.213534 / 6 /2014 | 1.213534 / 6 /2014 |2015 |
| 新独立曲线多边形AA | 0.656197 / 5 /1477 | 0.656197 / 5 /1477 |1477 |
| 新独立feather2 | 2.903459 / 22 /2602 | **0.728199 / 6 /2618** |2437 |
| 新独立feather6 | 4.027027 / 33 /4046 | **0.337838 / 8 /4252** |4111 |
| 新独立lowpeak20 | 0.904477 / 5 /536 | **0 / 0 /1049** |1049 |
| 新独立异背景lowpeak92 | 2.223906 / 19 /1303 | **0 / 0 /1871** |1871 |

修复羽化不是靠删弱像素：feather2产品弱覆盖变更598→619，原生440；feather6产品2157→2367，原生2226，仍有尾部变化域残差。本地调和延拓不能冒充Adobe内核。锐利分支保持字节不变，alpha.26程序AA相对更早阈值1的MAE1.352256→1.782872退步也没有消失；新斜AA相对更早阈值1的MAE0.872664仍差，本批没有通过模式切换隐藏这一点。

## AA研究、未晋级模型和未完成部分

仅在已公开alpha.26样本上研究边界中心、半像素边界、coverage亚像素等值线及充分收敛的SOR。不同解释不能在三自然图、合成与程序AA上同时改善：覆盖边界插值让程序AA1.782872→2.025716，并让老木纹3.142408→5.852561；矩形核心+夹边延拓也使自然图明显退步。这些候选只保留在scripts/research和artifact，未改offset、采样、生产锐利核或native-membrane。

尚未完成：全部锐利AA膜场差异、精确羽化尾部变化域、Diffusion1–7参数映射、RGB16/HDR Patch、任意复杂灰度mask/透明输入与Photoshop效果等价。多个不连通软岛、复杂拓扑也未获得新的原生独立对照，不能扩大本轮结果到这些情况。

## 工程验收与复现

定向67/67通过（58已有+9新增），日志artifacts/alpha27/patch-directed.log。新增6项真实native provenance/输出门槛，加供体alpha/隐藏RGB/一次coverage及opacity、尾部额外预算/执行中取消，以及真实Editor Source/Destination preview/commit/retry/Undo/Redo/.comp保存重开。已有源级保护还验证锁、16/HDR拒绝、零opacity/零offset与redo保留。旧alpha.26针对“非零适配soft始终legacy”的保护断言本批有意更新：零适配仍byte一致，非零适配不允许漏掉弱域。不能用旧效果的字节固定测试阻止有native依据的修正。

生产测量artifacts/alpha27/patch-production-measurements.json包含13组、每个native1/5/7档的before/after，而本地没有切换Diffusion档；新6组冻成fixtures/parity/photoshop-27.11-patch-soft-holdout-*-alpha27.json。freeze-patch-holdout-alpha27.ts校验source/mask/effect并保留provenance，measure-patch-soft-alpha27.ts使用当前生产及归档alpha.26旧核，避免基线混用。

scripts/generate-patch-holdout-alpha27.ts和photoshop-patch-holdout-alpha27.jsx可复现实验输入与原生操作；原始结果在artifacts/photoshop-native/outputs/tools-alpha27-soft-domain-holdout。research的patch-soft-domain-alpha27.ts记录冻结模型和其他被拒假设，patch-aa-boundary-alpha27.ts仅针对公开旧样本，均不被产品导入。

统一typecheck、整体测试、dev及实际包验收由根代理独立收尾，本文件只报告本代理定向证据。首次本批全局typecheck由另一research脚本的cases隐式any失败，不能报告其为通过；Patch所属文件无报错；修复该脚本后再次全局检查只剩root所属src/main/index.ts(372,89)的TS2339错误，最新日志artifacts/alpha27/patch-typecheck-final.log。后续根代理统一验收为最终依据。


## 冻结后的公开AA续研（未晋级）

按根代理要求，生产冻结后继续只在已公开alpha.26五组AA/矩形上做额外数学检查，没有用新alpha.27六组的AA结果训练或调参。核心bbox与全mask bbox在这些原生覆盖的几何范围实际相同，未解释剩余差异。将multigrid最近邻回填改成几何中心bilinear prolongation，程序AA MAE1.782872→1.772683，只微幅改善；但老木纹3.142408→3.148068、合成0.189286→0.191080退步，不晋级。

另外以本次合法alpha.26原生参考重新检验clamped biharmonic（早期alpha.25绿污染参数不再用作受控依据）。公开程序AA半量/全量MAE9.815866/18.221980，老木纹40.997934/68.409883，合成1.342304/2.642445，均明显差于现有harmonic；不加入任何虚构Diffusion映射。研究原始数值见artifacts/alpha27/patch-aa-multigrid-diagnostic.json与patch-aa-biharmonic-diagnostic.json，脚本只在scripts/research。当前没有跨自然/程序/整数形状同时改善的通用AA候选；冻结生产和native-membrane不变。
