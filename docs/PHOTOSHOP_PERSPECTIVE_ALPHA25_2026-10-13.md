# 透视裁剪自动尺寸研究（alpha.25）

本批将自动尺寸与固定尺寸采样分开验证。自动尺寸不能通过调整插值核修复；固定尺寸 RGB 误差不能证明尺寸算法已经对齐。

## 原有接口

公共命令 `document.perspective_crop` 明确提供输出宽高和四个源边界坐标，没有自动尺寸字段。`perspectiveCropSize` 是界面建议值，按两条对边长度平均后取整。Photoshop 配置的界面把用户给定像素中心角点显式转换成公共边界坐标，再交给相同 8 / 16 / HDR 源精度路径。此批保留公共命令语义。

## 独立原生样本要求

原生 Photoshop 27.11，图像 100% 显示，宽、高、分辨率字段清空，记录每次按下/释放的屏幕坐标与文档原点。提交后必须存在透视裁剪历史步骤，并保存实际裁前源、输出 PNG、尺寸与 SHA256。新四角须同时覆盖轴对齐矩形、分数长度平行四边形、强梯形及两种不同倾斜方向。旧 alpha.21 四角必须复采；不能直接把历史不一致解释为 GUI 不精确。

`measure-perspective-alpha25.ts` 比较可解释的几何候选：旧对边均值、最长对边包含端点的 floor / round / ceil 取整。候选模型只用于诊断；生产采纳需要独立留出几何支持，不按样本名或坐标分支。

## alpha.24 已知证据

401×241 矩形与 384×219 反向倾斜四角均符合 `round(max edge)+1` 与 `floor(max edge)+1`，因此不能用这两个样本区分取整规则。独立平行四边形长边 `sqrt(330²+20²)=330.6055` 可以区分两种规则：round-inclusive 为 332，floor-inclusive 为 331。

旧 alpha.21 声明角点 `(60,40),(430,55),(400,280),(75,260)` 原生自动输出 387×257，不符合这些最长对边模型；旧记录没有最终内部浮点角点/变换矩阵。本批精确复采再次得到 387×257，排除了把这一尺寸差异单纯归因于旧角点采集不精确的解释。旧 fixture 保留。

## 五例原生最终结果

每个最终角点在原生屏幕中逐一检查。Source 为原始 `alpha24-retouch-source.png`，不是 alpha.24 红眼编辑后的图。未观察最终角点的第一次输出 `capture-1791884383217.png` 被排除，未计入有效证据。

| 独立几何 | 原生自动尺寸 | 当前 mean 建议 | 当前显式原生尺寸 RGB MAE / max | alpha max |
|---|---:|---:|---:|---:|
| 轴矩形，实际底边 y159 | 202×135 | 201×134 | 0 / 0 | 0 |
| 分数跨度平行四边形 | 332×201 | 331×200 | 0.209814 / 19 | 0 |
| 旧四角精确复采 | 387×257 | 348×224 | 0.358634 / 31 | 0 |
| 强梯形 | 331×244 | 265×239 | 0.307146 / 45 | 0 |
| 相反方向四边形 | 403×260 | 363×242 | 0.386546 / 33 | 0 |

最长对边 round-inclusive 只符合 3/5，floor-inclusive 与 ceil-inclusive 各符合 2/5。强梯形的 round-inclusive 预测 331×245，与实际 331×244 不同；旧四角 round-inclusive 预测 371×228，与实际 387×257 不同。另检查源逆单应矩阵四个角点最大 Jacobian 长度、保证最小局部采样密度的候选：旧四角 384×260，alpha.24 反方向四角 387×225，亦不符合原生，不采用。

尚未得到可泛化公式，**生产自动尺寸不变**。本次五例当前 mean 最大宽差 **66px**，最大高差 **33px**，没有宣布自动尺寸对齐。公共 MCP 显式尺寸语义、8/16/HDR 精度路径、采样核均不变。

固定尺寸采样继续使用 alpha.24 已有的 Photoshop 像素中心转换，本批没有替换核。新独立样本平均误差都低于 0.4/255，但最大 RGB 差仍达到45/255，不能宣称像素完全相同。旧四角复采 .358634 相对于旧 alpha.23 4.696883 的差异包含更精确采集及此前 alpha.24 坐标修复，**不能计作本批修改采样算法的改善**。

## 验证与复算

不可变 `fixtures/parity/photoshop-27.11-perspective-alpha25.json` 保存裁前及五例实际 RGBA 的压缩数据和 SHA256；不会依赖被忽略的 artifacts 才能运行。`measure-perspective-alpha25.ts` 默认读取此 fixture，报告逐例尺寸候选、支持数以及显式原生尺寸误差。可提供新 cohort 参数扩展独立样本。

`tests/photoshop-perspective-alpha25.test.ts` 固定原生采样/alpha 回归、保留已知尺寸缺口，并验证显式 Photoshop inclusive identity 在 RGB8、RGBA16 与 HDR 中保留真实源数据、分数alpha、非257网格样本和负值/超白。

定向运行：

```sh
npx tsx --test tests/photoshop-perspective-alpha24.test.ts tests/photoshop-perspective-alpha25.test.ts tests/crop-projective.test.ts
npx tsx scripts/measure-perspective-alpha25.ts
```

源码、真实GUI交互、目录包完整性与跨平台硬件验收仍由主任务统一验收。RGB16/HDR 测试是项目自身保真证据，原生五例为 RGB8，不能据此宣称高位深原生等价。

Adobe 的操作说明支持 Perspective Crop 在 Options bar 设定尺寸与透视纠正操作，但未公开自动输出的数值算法。几何模型结论须由原生样本验证：[Adobe Perspective Crop](https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/transform-perspective-while-cropping.html)。
