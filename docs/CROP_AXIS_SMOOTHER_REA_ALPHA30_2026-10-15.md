# REA 透视轴向采样和透明边界：alpha.30 限定范围接入

日期2026-10-15，Photoshop2026 27.11.0。**完整源矩形、RGB8、整数源中心、两个轴都放大的限定范围已由冻结后真实原生样本验证；一般强透视仍有残差。** 本文不把Node/core测试扩张成GUI、安装包或跨平台验收。

## 本次恢复的机制

REA静态恢复普通Bicubic和Bicubic Smoother是不同分支。两张自制dense源的7×透视输出，与真实DOM `BICUBICSMOOTHER`、`BICUBICAUTOMATIC`分别整图RGBA相同；与普通Bicubic不同。Smoother原始常量表给出width1.15、Keys a−.625，6tap offsets[−2..3]，128相位，14bit权重逐项trunc并向最大项补余。

坐标先对`(sourceCoordinate−.5)*128`作positive round，整个index夹到source实际像素bbox，随后分离整数index与phase。RGB与alpha独立采样，RGB边界tap复制端点，alpha边界tap为0。横向处理后先舍入/裁剪到RGB8，再纵向处理并舍入/裁剪。Perspective的原生plan固定先H后V；通用ImageSize/minarea函数不代表Perspective顺序。

静态证据保存在本地REA研究目录：`rea-kernel-constant-tables.json`、`rea-kernel-config.json`、`rea-plan-horizontal-first.json`、`rea-plan-vertical-first.json`。原Photoshop程序不作为运行依赖，不调用或分发提取代码。

## 资格与兼容边界

`src/core/crop-axis-smoother.ts`先检查实际alpha>0 bbox和颜色语义，再执行恢复的核。`crop-actions.ts`仅为High quality RGB8、普通图像、全源原点/尺寸、不旋转/翻转的完整矩形分派。以下情况保留旧路径：

- 源中心有半像素相位、任一轴未放大、一般透视、fractional crop rectangle或不同layer placement。
- bbox投影任意边距half-integer不足1e−7。原生浮点bounds舍入尚未完全恢复，不能硬补quarterpixel或按图片名称选择。
- bbox内部存在A0且可见RGB不是恒色。PNG隐藏颜色规范化尚未完整恢复；可见RGB恒色时，读取A0颜色使用同一恒色，不修改源字节。
- mask、RGBA16、Float32 HDR、Smooth/Nearest及aligned-copy。

原120M work与512MiB边界保留。源资格扫描、输出初始化、两个axis的实际6tap均进入跨layer累计work；中间RGBA8面与坐标数组计入单层和全batch内存峰值，没有绕开其它驻留asset或放宽原上限。

## 冻结后原生验收

研究候选v3 SHA256 `46241bed8604c76269682a06b35dd8e3eb9e1860c4fa99ebbba6eb0660a94e27`。root先登记新输入和计划，在候选冻结后实际执行10个新Photoshop样本：3种新源各两种不同长宽缩放，外加两类明确拒绝源各两种缩放。所有source-before的可见RGB、alpha、premult与输入一致；A0隐藏RGB导出变化单列。

| 新原生类别 | 数量 | 原baseline alphaMax | 生产结果 |
|---|---:|---:|---|
| Opaque wide/tall | 2 | 66 / 69 | 整图RGBA exact |
| Partial alpha wide/tall | 2 | 61 / 64 | 整图RGBA exact |
| 恒色含A0 wide/tall | 2 | 19 / 12 | 整图RGBA exact |
| 奇数源中心 | 2 | 保持原误差 | 拒绝新分派，baseline字节相同 |
| 彩色源内部A0 | 2 | 保持原误差 | 拒绝新分派，baseline字节相同 |

6个接受样本的RGB、可见RGB、alpha、premult RGB的MAE/max全部为0；4个拒绝样本保持旧输出SHA。源字节不变。源/原生RGBA、原生source验证、baseline指标与拒绝baseline字节已冻结到可移植fixture `fixtures/parity/photoshop-27.11-perspective-axis-rea-alpha30.json`，无需本机Photoshop或REA即可复测。

已披露回归另有143个reference：20接受、123旧路径，所有可比较mean/max无退步。20接受中19个RGBA exact，1个Photoshop背景层控制为非退步PARTIAL；其中2个dense8×旧core超过120M RESOURCE_LIMIT，单列为旧baseline不可比较，不能称旧路径运行通过。引用包含旧重复捕获，不当成143个独立姿态。

## v1/v2失败与未解决项保留

v1曾在16个偶数校准输出exact，但冻结后3个奇数源独立样本全部REJECT。实际nativeextent比requested尺寸各多1，研究调用遗漏已恢复的roundedSize/center-phase合同。v1 SHA `ae54756a51d5009cc7face2b4d879935808b662f5d22efd2e22d58a7eca67fa5` 和原18例拒绝记录保留。

v2仅补已知相位后mean大降，仍有边界和axis顺序问题，不能作为独立PASS。SHA `733f0cda0104a3d3cb31ee161ffbc74bc4d0a41cfb8e89c3c7a11ca3d3025689`；统一world ties-even和通用minarea控制均被反例否决。v3通过新静态证据纠正Perspective顺序，并以几何/颜色资格避开未恢复域；没有把v1/v2旧失败重新包装成独立通过。

本地原始记录位于 `/Users/zhoujin/Documents/REA/artifacts/crop-sampling-2026-10-15/`：`smoother-axis-independent-validation.json`（v1 REJECT）、`smoother-axis-phase-v2-calibration.json`、`axis-world-bounds-diagnostic.json`、`smoother-axis-v3-disclosed-validation.json`、`smoother-axis-v3-independent-validation.json`。独立native18与native10均保留，不覆盖。

一般affine/skew的REA 256行参数和32bit采样原型已解释约.3 sourcepixel有效位移，但只有已披露控制达到低残差，尚未接入。强透视、高频缩小、复杂彩色A0、奇数/quarter相位和透明外缘的完整恢复继续单独研究。

## 可复测入口

```sh
npx tsx --test tests/crop-axis-smoother-alpha30.test.ts
npx tsx scripts/measure-crop-axis-rea-alpha30.ts
```

`scripts/freeze-crop-axis-rea-alpha30.ts`只归档已捕获原生数据，校验研究冻结SHA、source/native与生产/fallback输出，默认拒绝覆盖fixture。`tests/crop-magnification-alpha28.test.ts`保留一般采样80tap预算门禁；旧alpha27/28的已恢复axis断言收紧至native exact，其它旧域保持原门槛。

真实Electron验收入口（需先build，由主流程串行运行，不能把编写脚本视作运行通过）：

```sh
COMPOSITOR_SMOKE_OUTPUT=artifacts/crop-axis-alpha30 npx tsx scripts/smoke-crop-axis-alpha30.ts
# 安装包验证另设置COMPOSITOR_EXECUTABLE为实际可执行文件绝对路径。
```

脚本在隔离临时profile中打开由fixture源创建的项目。首例使用真实工具栏四角点击、宽高字段与Apply Crop，其余使用实际Editor命令；6例直接比较捕获的Photoshop RGBA，4例比较冻结的原路径RGBA，全10例验证键盘撤销重做与保存重开。它不生成source/core裁剪oracle，仅替代原生打开/保存对话框的路径。报告记录实际运行时和应用版本；失败保留first-failure，输出效果的声明仍限于上述资格域。
