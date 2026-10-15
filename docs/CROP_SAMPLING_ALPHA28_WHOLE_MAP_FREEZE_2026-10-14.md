# alpha.28 全映射放大选择规则冻结（第二版）

第一版核/不透明距离带模型及原始25旧参考回归记录保留在 `CROP_SAMPLING_ALPHA28_MODEL_FREEZE_2026-10-14.md`，第一版冻结后采集的9个新原生参考 **全部 PASS**，原样报告为 `artifacts/alpha28-sampling-independent/comparison.json`，不可覆盖。对应 immutable fixture 为 `fixtures/parity/photoshop-27.11-perspective-sampling-independent-alpha28.json`。

然而，根代理静态审查指出第一版仍按每个像素的 Jacobian 选择滤波核，混合缩放的 projective 图像内部可能切换核。解析同源、同不透明、同分数相位 `(12.137,15.269)` 与 Jacobian 最大奇异值 `1±1e−6` 的探针，实测红通道差 **2.9146031396333854**，绿通道差 **.5173374662387573**。证据 `artifacts/alpha28-sampling-research/geometry-cliff.json` 保留；身份/对齐直接复制没有掩盖该失败。9个原生均值/最大值通过不能抵消这一工程风险。

## 第二版唯一改动：整张图一次选择核

第二版沿用第一版 **Catmull–Rom B0/C.5、9/8源空间扩展、.75不透明距离过渡、旧透明/蒙版默认语义及80最坏源taps**。没有根据已见9个原生输出修改核或过渡参数，只按根代理明确授权的保守修正，消除同图局部滤波核切换：

- 对经过图层 placement 合成后的逆映射矩阵，完整输出参数域 `[0,1]²` 分成固定4×4单元；不是只采四角或采样若干输出点。
- 每个单元的 Jacobian 分子为参数的仿射函数，所以各分子绝对值上界在四个顶点取得。对同一单元分母仿射函数，绝对值下界也在顶点取得；若符号混合、零或极小值则拒绝证明。计算中向外加入有限浮点误差 padding，抵消相减/乘加抵消风险。
- 用分子上界除以分母下界平方及目标宽/高，得到 Jacobian 每个分量的绝对上界。这个非负2×2上界矩阵的最大奇异值是整个单元的保守算子范数界。16单元全部严格小于 `1−1e−9`，才能证明整张映射两个主轴均放大。
- 若证明成立、High quality、非蒙版且非对齐直接复制，整张 raster 一次选择新核。任一单元证明失败，整张保留原 Mitchell/Lanczos选择，包含一轴缩小、混合缩放及不确定的 projective 情形。图内不再按局部尺度切换核。
- 保守证明可能拒绝实际上全部放大的图，这会失去部分改善，但不会强行对不安全区域使用新核。跨整张文档的尺度模式切换仍是明确的算法选择，**不宣称不同 document scale 的核连续性**。
- 16×4共64个有界 Jacobian 顶点运算作为保守 work charge 加入现有120M预算；80源tap预算仍包含64 opacity guard/宽核复用和16旧核过渡。蒙版和对齐复制不增加这项证明开销，无额外全图距离场，512MiB边界保留。

实现范围为 `src/core/crop-sampling.ts` 的 `cropMappingIsMagnifying`、显式 `catmull-rom-9/8` profile 与 `src/core/crop-actions.ts` 的一次选择/工作预算。默认公共 sampler 保持 Mitchell；RGBA16 和 Float32 HDR 不降到8位；fractional/hidden alpha支撑保留旧核。

## 验证次序和证据边界

第一版新9参考对第二版只能作为回归，不能再次称为第二版模型冻结后的独立参考。第二版冻结后由根代理采至少3个新 pose，包含 one-axis near1 与 mixed scale，才形成独立验证。新增解析 tests 包含单轴、旋转、剪切、分母换号/极小值、全区间安全例、源像素/不透明距离带连续性以及RGBA8/RGB16/HDR逐像素alpha不变；拒绝用全图alpha均值掩盖局部变化。

缩小候选仍被否决：新256×192校准原 MAE5.967116/max67，scaled Catmull为6.223301/max74，scaled Keys为6.352844/max77，scaled Spline为6.034180/max57（max改善但mean恶化）；旧180×120原31.545077/max181，相应为33.241574/max205、33.498704/max206、34.825108/max145，最后一项还新增alpha误差。详细 `artifacts/alpha28-sampling-research/down-calibration` 与 `down-old-cohorts`，没有强行合入任何缩小候选。
