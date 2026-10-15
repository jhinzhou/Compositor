# Patch 抗锯齿与软尾 alpha.28 研究

当前生产仍为alpha.27。所有旧alpha.26/27图像已经公开，不能继续称独立留出。低峰20/92已经逐byte匹配原生，是必须保持的保护；锐利AA MAE1.782872/max10和软尾变化域还未等效。本文件记录失败候选和一项冻结的连通分量假设，不把研究结果算作已上线。

## 先区分额外与漏编辑

旧报告羽化2的变更数2618对原生2437，净差181；但真实额外像素197、漏编辑16。羽化6的4252对4111，净差141，对应额外189、漏编辑48。不能仅把净差降到0便认定变化域正确。alpha.28测量同时报告extra/missing/weakExtra/weakMissing、coverage内MAE/max、外部RGBA和alpha。

## 已公开13组上的失败模型

以冻结alpha.27函数为研究基线，源和原生mask/输出都直接解压固化fixture；私有数组保留decoded source SHA，不读取新alpha.28原生结果选参数。锐利AA、整数和三个低峰保护组一起测量。

| 机制 | 旧feather4 MAE / Max | feather2 MAE / Max | feather6 MAE / Max | 结论 |
|---|---:|---:|---:|---|
| 生产Neumann软尾 |0.947865 /21|0.728199 /6|0.337838 /8|基线 |
| 尾部外边界Dirichlet回到原背景 |1.068220 /21|0.754827 /6|0.564421 /7|漏编辑明显增加，不采用 |
| 修正颜色先量化成byte再混mask |0.951082 /21|0.731806 /6|0.346785 /9|非通用改善，不采用 |
| 核心膜拟合仿射平面再延续尾部 |1.413311 /29|1.099406 /24|0.830742 /26|不采用 |
| 近核心局部一阶梯度延续 |1.746201 /18|0.786336 /6|1.018944 /12|不采用 |

Dirichlet模型使feather6漏编辑48→423，不能凭max8→7晋级。全域颜色量化还让第三自然木纹MAE1.264435→1.265041，违背不退步要求；不能用只选有利行的方式上线。其余AA亚像素/双调和模型沿用alpha.27已排除记录，没有改native-membrane或供体坐标。

失败代码和完整数据分别在scripts/research/patch-tail-model-alpha28.ts、measure-patch-tail-alpha28.ts、measure-patch-tail-continuation-alpha28.ts，以及artifacts/alpha28-patch/{tail-model-diagnostic,tail-continuation-diagnostic}.json。它们不被产品导入。

## 冻结的连通分量假设

Neumann软尾若某个弱覆盖4连通分量完全没有接触有效128核心，缺少Dirichlet锚点。当前初始化全局mean会给它任意常量颜色修正。冻结假设是只对这种无锚点分量设correction0，仍按实际coverage和供体alpha复制供体；有锚点软尾、核心、锐利AA以及整个无核心路径完全保持原样。使用4连通是因为现有膜解算本身采用四邻居，并非按图像ID、羽化峰值或fixture分类。

研究实现复用role作为临时访问标记，使用有界Int32队列。每个ROI像素至多访问一次、四个邻居一次，再一次恢复角色，先收取6×工作区像素预算，队列每1024次检查取消。根代理收到冻结消息后才允许披露新原生参考；此机制不因新参考输出再改常数/分支。

已公开13组before/after decoded output SHA逐项完全一致，含三个自然D5、整数样本、旧/新AA、feather4/2/6及exact低峰20/92。两项纯研究测试验证无锚点岛仍有raw donor edits、有锚点保持字节、预算/取消私有数组、零opacity和低峰保护。它们证明数学/数据边界，不证明Photoshop效果或实际应用历史链。

## 新原生独立输入计划

新自写320×240非均匀光照纹理，decoded SHA d1b8be12247f4084873d4f18623e5f67d10166055740000a2ac2ab1f5ae7aee0。6个fresh physical inputs和owned副本：同一斜多边形AA0、羽化0.5/2.5/5、曲线多边形AA0、强核心poly2.5加远处6×6 feather8的EXTEND弱岛；固定offset[-104,24]、Normal Source、透明关、healSmoothFactor5。源和供体软尾在图内，原生alpha选择先保存再duplicate/load后黑白fill出exactmask。没有用产品rasterizer代替参考。

生成器scripts/generate-patch-tail-holdout-alpha28.ts、原生脚本scripts/photoshop-patch-tail-holdout-alpha28.jsx仅由根代理操作Photoshop。无历史/error/源SHA不符的case必须保留为失败，不能静默删除。候选冻结后新参考才能用于晋级；此时生产仍保持alpha.27，新增公开结果不能再称下一候选的独立数据。

## 冻结后独立原生验收：候选拒绝

冻结记录 artifacts/alpha28-patch/candidate-freeze.json 写于2026-10-14 06:19:55.513585 UTC，研究核SHA337c5328a10b05a46e796f7c17245d73c4b2f1f7172bb4284f63d0b599029912。随后才解码6组原生输出；没有根据它们修改机制或常数。6/6 source SHA、320×240尺寸、opaque grayscale mask、Normal Source/transparent=false/healSmoothFactor5参数、原生“修补选区”历史、空error均验证通过，coverage外RGBA与alpha变化均0。参考是根代理实际Photoshop Browse执行ActionManager内核，不能称纯鼠标操作；鼠标GUI另行采集。

| 新独立组 | 生产基线MAE / max | 冻结候选MAE / max | extra / missing 基线→候选 | 结果 |
|---|---:|---:|---:|---|
| slanted-aa | 0.993697 / 8 | 0.993697 / 8 | 5/9 → 5/9 | 逐字节不变 |
| slanted-feather05 | 0.736135 / 5 | 0.736135 / 5 | 180/6 → 180/6 | 逐字节不变 |
| slanted-feather25 | 0.634441 / 9 | 0.634441 / 9 | 256/34 → 256/34 | 逐字节不变 |
| slanted-feather5 | 0.517430 / 9 | 0.517430 / 9 | 281/57 → 281/57 | 逐字节不变 |
| curved-aa | 0.649210 / 7 | 0.649210 / 7 | 7/4 → 7/4 | 逐字节不变 |
| core-and-soft-island | 0.498978 / 9 | 0.600914 / 9 | 317/75 → 688/102 | 退步，拒绝 |

旧13组与新前5组逐字节不变；混合核心+独立弱岛的变化数4455→4799（原生4213），MAE0.498978→0.600914，extra317→688，missing75→102，不能因为理论上无Dirichlet锚点就替换原生的实际全域作用。这说明孤立低峰单独存在时的raw donor机制，不能直接推广到同选区另有强核心的混合场；不增加峰值经验映射或按fixture识别的补丁。此候选未上线，产品仍为alpha.27的保守软尾。此批没有把AA/羽化尾部宣布完成。

完整6组固化为fixtures/parity/photoshop-27.11-patch-tail-holdout-*-alpha28.json；参数包括nativeExtraPoints/nativeExtraFeather，完整原生metadata保留，失败不丢弃。复测脚本scripts/freeze-patch-tail-holdout-alpha28.ts与scripts/research/measure-patch-tail-independent-alpha28.ts；逐项输出在artifacts/alpha28-patch/{native-holdout-freezer,tail-component-independent-alpha28}.json。新6组在这次验收后已公开，下一候选研究不能再称它们独立留出。

## 透视尺寸 alpha.28 只读复核

比较src/shared/crop-projective.ts与artifacts/alpha28-baseline同路径，只新增有效相机模型的nearest-depth尺寸下限；显式ratio与非物理/近仿射/近地平线fallback保持原条件。新增depthWidth/depthHeight共享同一nearestDepth，二者比值等于已恢复aspect，独立round引入的±0.5像素与旧尺寸机制相同。finite检查、4×source-span保护以及最终maxSide/maxSurfacePixels/singular validation仍在；没有采样核、alpha、工程精度或MCP显式输出尺寸改变。未发现可确定的新数据/资源回归。该尺寸仍是有界相机近似，不能由此宣称所有Photoshop自动尺寸完全相同。

## 已公开19组上的两阶段量化：拒绝

在独立验收结束后才提出新的量化研究，6组alpha.28此时已公开，只作为校准交叉验证，不重新标注独立。区别于之前“adapted colour先量化再混mask”的候选，这次严格把源覆盖和膜调整拆为两个8-bit阶段：destination + round((straightDonor-destination)*sa) + round((adaptedColour-straightDonor)*sa)，sa含原mask/opacity/donorAlpha，最终clamp。没有fixture身份分支、峰值经验映射或重新估计Diffusion。

| 组 | 基线MAE / max | 两阶段MAE / max | 判断 |
|---|---:|---:|---|
| a26-natural-explicit-calibration-wood | 1.206097 / 14 | 1.204963 / 14 | 不退步 |
| a26-natural-explicit-heldout-old-wood | 3.142408 / 39 | 3.141959 / 39 | 不退步 |
| a26-synthetic-explicit-calibration | 0.189286 / 1 | 0.189286 / 1 | 不退步 |
| a26-natural-independent-third-wood-background | 1.264435 / 21 | 1.264435 / 21 | 不退步 |
| a26-independent-procedural-irregular-aa | 1.782872 / 10 | 1.784085 / 10 | 退步 |
| a26-independent-procedural-irregular-feather4 | 0.947865 / 21 | 1.011093 / 21 | 退步 |
| a26-independent-procedural-isolated-soft-peak | 0.000000 / 0 | 0.000000 / 0 | 不退步 |
| a27-independent-soft-domain-slanted-aa | 1.213534 / 6 | 1.216518 / 6 | 退步 |
| a27-independent-soft-domain-curved-polygon-aa | 0.656197 / 5 | 0.658974 / 5 | 退步 |
| a27-independent-soft-domain-slanted-feather2 | 0.728199 / 6 | 0.774666 / 6 | 退步 |
| a27-independent-soft-domain-slanted-feather6 | 0.337838 / 8 | 0.448106 / 9 | 退步 |
| a27-independent-soft-domain-lowpeak6-feather8 | 0.000000 / 0 | 0.000000 / 0 | 不退步 |
| a27-independent-soft-domain-lowpeak14-feather8 | 0.000000 / 0 | 0.000000 / 0 | 不退步 |
| a28-independent-patch-tail-slanted-aa | 0.993697 / 8 | 0.996487 / 8 | 退步 |
| a28-independent-patch-tail-slanted-feather05 | 0.736135 / 5 | 0.748154 / 5 | 退步 |
| a28-independent-patch-tail-slanted-feather25 | 0.634441 / 9 | 0.678521 / 9 | 退步 |
| a28-independent-patch-tail-slanted-feather5 | 0.517430 / 9 | 0.593717 / 9 | 退步 |
| a28-independent-patch-tail-curved-aa | 0.649210 / 7 | 0.649592 / 7 | 退步 |
| a28-independent-patch-tail-core-and-soft-island | 0.498978 / 9 | 0.563548 / 9 | 退步 |

12/19组MAE或max退步，feather6 max8→9、extra189→528；旧f4 extra145→325，新mixed extra317→725。低峰exact虽保留，也不足以晋级。研究脚本scripts/research/measure-patch-staged-quantization-alpha28.ts及完整tail-staged-quantization-diagnostic.json保留。未采额外独立输入，也未把这些数字用作再次拟合系数。

另一项仅旧13组校准的3×3 binomial ring smoothing，虽然旧AA MAE1.782872→1.443231，但自然oldwood3.142408/max39→4.634322/max57，synthetic0.189286→0.358836以及feather6 .337838→.403307退步，也拒绝；不能仅展示AA收益。完整ring-boundary-diagnostic.json保留。

拓扑冻结时原研究核已额外归档到scripts/research/patch-tail-model-alpha28-topology-frozen.ts，其SHA仍337c5328a10b05a46e796f7c17245d73c4b2f1f7172bb4284f63d0b599029912，以免后续量化研究同文件新增选项影响冻结复现。产品patch-edit.ts SHA5322862e7301a11f7edf165cc6ad9d237bdd15237d50d5a35de2b3d0d6bfa043，sampled-healing.ts SHAe9ad78b8348cc82841293bda6c6f7b196a5b2a64f00392f4311b53c4ed08c31f，均保持alpha.27，不上线失败算法。
