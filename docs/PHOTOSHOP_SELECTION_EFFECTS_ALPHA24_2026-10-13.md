# 快速选择边缘效果（alpha.24）

## 本轮改动

`src/core/image-driven-selection.ts` 的快速选择原先在启用抗锯齿后，无条件对选区覆盖率执行 3×3 空间模糊。即使原图边缘完全锐利，也会人为生成一圈半透明覆盖：这不是图像原本的软边。

现在使用源图引导的覆盖率平滑：邻域权重同时取决于空间距离和局部预乘颜色/alpha 差异，采用区域生长的同一局部边界阈值。跨越强颜色边界的样本权重为零；完全透明像素不参与连接。连续渐变处仍可以形成平滑覆盖。该实现不改变工具协议、笔划颜色模型、加减选区或一次笔划一次撤销的语义。

## 实际 Photoshop 参考

参考文件 `fixtures/parity/photoshop-27.11-tools-alpha23.json` 包含前轮使用 Photoshop 27.11.0 实际界面采集的、由我们自行创建的 512×320 带纹理圆形图像和实际选区灰度覆盖。原始 RGBA 和灰度覆盖均校验 SHA256。

| 同一个输入、笔径和笔划 | 不同覆盖像素数 | 覆盖率 MAE / 255 | 覆盖率 IoU |
|---|---:|---:|---:|
| alpha.23，抗锯齿关闭 | 0 | 0 | 1 |
| alpha.23，原空间模糊抗锯齿 | 1,112 | 0.37109375 | 0.984597671157746 |
| alpha.24，源图引导抗锯齿 | 0 | 0 | 1 |

这关闭的是 **该参考样本** 上的差距，不能认定 Photoshop 的选择算法、自然照片、软边或发丝分割已经完全一致。Photoshop 参考时 Enhance Edge 为关闭状态；本项目没有把新平滑冒称为 Photoshop Enhance Edge。

复算：`npx tsx scripts/measure-tools-alpha24.ts`，产物 `artifacts/photoshop-native/measurements/tools-alpha24/quick-comparison.json`。alpha.23 的旧测量报告保留旧数值。

## 独立边界验证

`tests/quick-selection-alpha24.test.ts` 六项验证：实际原生覆盖一致性；独立斜边、凹形和纹理硬边不产生光晕；连续色彩渐变仍有局部半透明覆盖；透明间隙不被隐藏 RGB 连接。独立人工样本是边界行为回归，不是新的 Photoshop 原生效果证据。

已有 `tests/image-driven-selection.test.ts` 的十三项生长、预算和磁性套索测试继续通过。原来断言“锐利边界必须变成半透明”的单项断言已修正为保持源图锐利边界。

## 透视裁剪：Photoshop 输入坐标约定

本轮另用 Photoshop 27.11.0 实际操作采集了两组独立几何：100% 视图中的整数矩形，以及反向倾斜四边形。原图是自行创建的诊断图，输入为原生 `capture-1791880124463.png`；矩形结果为 `capture-1791880222503.png`（401×241），四边形结果为 `capture-1791880285219.png`（384×219）。RGBA 与 PNG SHA256、压缩像素和原始角点归档在 `fixtures/parity/photoshop-27.11-perspective-alpha24.json`。

矩形鼠标输入 `(40,40)→(440,280)` 的原生结果包含端点像素，为 401×241。源像素中心/输出端点对应关系，在独立四边形上也显著减少误差。因此新增 `photoshopPerspectiveCropCorners`，只在 **Photoshop 操作配置的交互层** 将输入中心角点转换成既有公共 edge-coordinate 四边形；提交及预览统一使用转换后的采样四角，可见手柄仍保留鼠标输入位置。既有命令和 MCP 的角点含义不变，没有统一硬编码额外平移，也没有更换 Mitchell 插值核。

| 原生几何及实际输出尺寸 | 修改前 RGB MAE | 修改后生产代码 RGB MAE | 修改后最大通道差 |
|---|---:|---:|---:|
| 矩形，401×241 | 0.947424 | 0.018232 | 15 |
| 反向透视，384×219 | 1.025899 | 0.361642 | 41 |

矩形生产代码保留整数对齐时逐像素精确保留的分支，而 Photoshop 原生结果仍有少量重采样差异；不能把研究脚本单独 Mitchell 候选的 MAE 0.010392 冒称为实际生产结果。两例都显著改善，但不属于逐像素一致。

自动输出尺寸建议仍使用现有平均对边长度。上表以原生尺寸显式填写后比较，未声称已解决 Photoshop 自动尺寸推断。自然照片、高位深的原生等价和其他透视强度仍需独立参考。单像素输出轴按中点采样，其他轴保持端点对应；转换后退化或奇异四边形继续明确拒绝。

相关验证：`tests/photoshop-perspective-alpha24.test.ts` 检查公共坐标合同不变、输入不突变、单像素轴、预算/无效几何和两组原生输出改善；与既有 crop-projective / overlay 回归合计 43 项通过。复算脚本 `npx tsx scripts/measure-perspective-alpha24.ts`（默认直接读取随代码归档的不可变原生 fixture，无需 artifacts 中的外部 PNG） 的 `photoshopUIProduction` 字段是实际生产渲染结果，`diagnostics` 仅供研究。
