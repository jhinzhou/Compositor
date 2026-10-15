# 透视裁剪采样研究（alpha.23）

本研究不修改 production 透视矩阵、默认坐标约定、Mitchell 核或任何 Photoshop 原生 fixture。脚本 `scripts/measure-perspective-alpha23.ts` 重算归档参考，写 measurement JSON 与候选 PNG，验证原始 source/native RGBA SHA256。

## 参考范围

- 固定输出 348×223：不可变 `fixtures/parity/photoshop-27.11-crop-alpha21-ui.json`，原生 GUI 导出的 `capture-1791856464186.png`。
- 自动输出 387×257：同一研究过程归档 `capture-1791856412697.png`。Native TXT 记录尺寸；脚本单独记录 PNG/RGBA SHA256。
- 四角描述均为 `(60,40),(430,55),(400,280),(75,260)`，512×320 RGB8 source。

这属于 **两个输出尺寸、一个四角几何族**，不能算两个独立几何验证案例。旧操作通过屏幕指针布置手柄，归档没有 Photoshop 最终内部透视矩阵，也没有四角精确内部浮点坐标；手柄实际落点与预定图像点可能有半像素或显示映射偏差。没有把这种可能性认定为已证实根因。

## 同一映射，仅换核

输出像素中心 `(x+.5)/W,(y+.5)/H` → 现有四角逆映射，保持源 edge-coordinate `.5` 约定和 premultiplied interpolation。RGB 统计如下；两参考 alpha 最大差均 0。

| 核 | 348×223 MAE / RMSE / max | 387×257 MAE / RMSE / max |
|---|---|---|
| 当前 Mitchell B=C=1/3 | 4.486470 / 14.537943 / 237 | 4.696883 / 15.445773 / 247 |
| Catmull-Rom B=0,C=.5 | 4.574348 / 15.232753 / 254 | 4.783288 / 16.126799 / 255 |
| B-spline B=1,C=0 | 4.476964 / 13.211193 / 209 | 4.675106 / 14.138757 / 215 |
| 双线性 | 4.499317 / 14.551386 / 246 | 4.692835 / 15.477325 / 255 |

Catmull-Rom 没有改善。B-spline 更模糊，稍减 MAE（固定尺寸仅 0.009506），并减少极值，但这不足以证明 Photoshop 使用 B-spline；几何错位也会被模糊掩盖。没有据此切换默认核。

按未移位 inverse-map 对应 source 3×3 每通道局部范围 `<24` 划分低频区，固定输出的当前核低频 MAE 2.436397、高频 MAE 12.407182；自动输出分别 2.513485 与 13.104007。差距在边缘/高频区更大，但平滑区也不为零，不能全部归因为插值核。

## 坐标诊断，不是修复候选

脚本额外检查 source 空间固定 ±.5 位移网格和 normalized endpoints 映射。两个尺寸的最小 MAE 都出现在 Mitchell + source `(+.5,-.5)`：固定 2.850545/max167，自动 2.772352/max163。这个变化明显大于单独换核。

它支持“坐标相位或采集手柄位置值得调查”，**不能证明所有 Photoshop 透视裁剪都需要这个固定偏移**。两个案例共享同一手柄过程，有同一种采集偏差并不意外。最大误差仍很大，也没有自然照片、不同四角、反方向斜边、旋转 placement 或透明图输入的独立原生验证。

## 建议

本批保持默认 legacy 核和中心映射。下一轮原生 GUI 采集至少增加：精确矩形/整数平移基准、相反倾斜四角、不同透视强度、原尺寸/放大/缩小、低频 ramp 与高频棋盘，以及 alpha 边缘；记录 zoom、document viewport origin、每次实际按下/释放指针坐标与最终裁剪 HUD 参数。尽可能记录原生历史 descriptor 中的四角或 transform 数值，减少屏幕坐标歧义。

脚本接受额外 cohort JSON 参数：`{sourcePath,cases:[{name,nativePath,corners,width,height,geometryVerified}]}`，可直接加入独立原生新参考。若得到稳定证据，再通过显式 Photoshop interpolation profile 接入，默认/旧 action 不变；不要把研究的固定 `.5` 位移硬编码到 production。

完整可复算结果：`artifacts/photoshop-native/measurements/perspective-alpha23/comparison.json`。本研究没有 RGB16/HDR 原生采样等价证据，也没有关闭此前 MAE4.486470/max237 的产品残差。
