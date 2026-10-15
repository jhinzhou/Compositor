# alpha.28 高频采样专项验收

**结果：限定范围的放大重建工程门禁 PASS；Photoshop 效果 PARTIAL；强透视高频缩小没有新安全候选。** 此专项未运行 Electron GUI 或打包版，这些由根代理统一串行验收，不能用下述 Node/core结果代替。

## 最终生产范围

`src/core/crop-sampling.ts` 新增显式 `catmull-rom-9/8` 重建与连续不透明距离带；默认 Mitchell、等比例仿射缩小 Lanczos、透明实际支撑和蒙版旧语义保留。`src/core/crop-actions.ts` 只在整张映射通过双主轴放大区间证明时一次选择新核，没有同图局部profile切换；最坏80源taps及64有界Jacob证明运算进入既有120M预算，512MiB上限保留。RGBA16/Float32 HDR 按原格式预乘插值，末端各量化一次，不转成RGBA8，不夹掉HDR负值/超白值。

最终源码物理 SHA-256：

- crop-sampling.ts：`9f29fef18d8601ca36d0af6f8c869420fdbe719bbb18273109ed5a8f5facdcbe`
- crop-actions.ts：`940fd1c88592bfc1892160e8d95a5b099581fe8b820f9f223b75873aef136c9a`

## 失败和修正均保留

初始全域宽核会让alpha边界退步，未接受。硬opaque guard存在源单元切换连续性风险，改成支撑2.25至其ceil3之间的.75连续距离带。第一版局部Jacob选择虽然9个新原生样本均PASS，但同phase跨 `1±1e−6` 有红2.914603/绿.517337级cliff，按根代理静态审查改成整个映射区间证明后一次选择核；原9只作为第二版回归。

之后静态审查又证明近等比例剪切 `s=1−2e−9,k=±3e−9` 的旧 `trace²−4det²` 公式消差，会误判真实max=`1.000000001` 的mixed scale。两helper修正为稳定谱范数 `.5*(hypot(a+d,c−b)+hypot(a−d,c+b))`，保留浮点向外padding和`1−1e−9`门槛，加入正负反例和安全对照。该修复来自解析工程反例，没有根据新原生样本调核。

原模型冻结、局部cliff失败、第一版9PASS、第二版冻结和5个新独立结果均保留：

- `CROP_SAMPLING_ALPHA28_MODEL_FREEZE_2026-10-14.md`
- `CROP_SAMPLING_ALPHA28_WHOLE_MAP_FREEZE_2026-10-14.md`
- `artifacts/alpha28-sampling-research/geometry-cliff.json`
- `artifacts/alpha28-sampling-independent/comparison.json`
- `artifacts/alpha28-sampling-whole-map-independent/comparison.json`

## 最终实际测量

同一host Node24.14/V8 的两份真实 core CLI，比对同源、同四角/尺寸。Legacy 只在内存esbuild loader关闭新sampler dispatcher，几何、原Mitchell/Lanczos、预乘及caller量化保持实际生产模块；没有近似baseline，也没有修改生产文件。稳定谱范数修复后重新编译两CLI，**39/39 PASS：旧25 + 第一版9回归 + 第二版5独立**。每例 RGB与premult RGB的MAE/max不恶化，alpha逐像素与legacy一致，来源SHA校验通过。结果 `artifacts/alpha28-sampling-all-stable-final/comparison.json`；首次冻结报告未覆盖。

|第二次模型冻结后新源/新几何|RGB MAE 旧→新|RGB max旧→新|premult RGB MAE旧→新|alpha变化像素|
|---|---:|---:|---:|---:|
|fresh-opaque-wide 780×600|2.806591→2.291803|14→12|2.806591→2.291803|0|
|fresh-alpha-wide 804×612|3.267641→2.790962|183→183|2.841758→2.365080|0|
|fresh-strong-alpha 720×510|5.547703→5.331159|181→181|4.844681→4.628136|0|
|fresh-mixed-projective 300×340|4.722229→4.722229|34→34|4.722229→4.722229|0|
|fresh-one-axis-enlarged 300×500|19.149544→19.149544|255→255|2.713497→2.713497|0|

后两项保持旧路径，证明保守选择没有在mixed/one-axis区域强制使用新核。透明参考的原生alpha边缘仍有残差：fresh-alpha-wide max66、fresh-strong-alpha max70，本项目alpha相对legacy完全不变，不能说已对齐 Photoshop alpha 重建。alpha=0隐藏RGB在原生PNG导出可能重写，sourceComparison独立记录可见RGB/alpha/premult源一致性；不把整幅未预乘RGB高max掩盖成视觉等价。

Immutable fixtures：

- `photoshop-27.11-perspective-sampling-independent-alpha28.json` SHA`e4ce71ab956a74bf1c83cbac4726d222571ef5903ca9d3b8e1c6a03b49aa4efe`（第一版独立，第二版回归）
- `photoshop-27.11-perspective-sampling-whole-map-independent-alpha28.json` SHA`257128336f943dad9d37cd76e81bf654a2a3c5b710ca9251b7476f60e3780438`（第二版冻结后5新独立）

## 定向工程检查

最终7文件 **55/55 PASS，0失败/取消/跳过**，包括：默认RGBA8/16/HDR sampler差分保真、透明边界与隐藏RGB、mask旧路径、HDR负值/超白与低于8位步长的数值、正负近等比例剪切、分母换号/极小值、source-cell连续性、逐像素alpha、source字节不变、实际Crop跨layer累计80taps+64proof预算、aligned-copy成本以及全部14新参考。旧alpha27透明放大效果snapshot从实际max80收紧到78；原MAE11.411和alphaMax6门槛未扩。

日志 `artifacts/alpha28-sampling-research/tests/final-stable-norm-directed.log`。类型检查 `artifacts/alpha28-sampling-research/final-stable-norm-typecheck.log` PASS；最终完整类型检查及全项目门禁由根代理统一运行。

## 仍缺少的强透视高频缩小对齐

缩小族没有合入：新256×192校准原MAE5.967116/max67，scaled Catmull6.223301/max74、Keys6.352844/max77、Spline6.034180/max57；Spline只改善max但mean恶化。旧180×120原31.545077/max181，各候选为33.241574/max205、33.498704/max206、34.825108/max145，最后一项还引入alpha1级误差；全部拒绝。单点Spline、全局Lanczos、固定相位与上一轮面积积分失败也未被重新包装为通过。

方向诊断 `artifacts/alpha28-sampling-research/directional/comparison.json` 保留高差峰值坐标、source point、方向变动和Jacob。旧180×120全输出alpha255，误差是可见二维高频而非隐藏RGB；near-axis二维区域MAE31.545/max181。255×160二维区域MAE14.701/max112，alphaMax5。当前axis-footprint不代表完整旋转椭圆滤波，后续可用方向分离/椭圆源支撑控制研究，但没有足够安全跨参考证据，本轮不新增此核，不继续在已见留出上调参数。
