# C1 第一批：独立 trimap 约束细化原型

状态：**纯核心已实施，13 项回归通过，限定合成夹具达标；尚未接入产品 UI 或工程动作。** 此原型没有改 alpha.9 的 App、共享动作 schema、主进程或当前渲染器，也不代表复杂发丝功能已全部完成。

## API 与最小接入路径

`src/shared/trimap-matte.ts` 提供：

```ts
refineTrimapMatte(
  mask: RasterSelection,
  guide: RGBAImage,
  trimap: Uint8Array,
  options?: TrimapMatteOptions
): { mask: RasterSelection; report: TrimapMatteReport }
```

三个栅格尺寸相同。`trimap` 的值必须为 0（明确背景）、128（未知）、255（明确前景）。`region` 为图像内的整数矩形；省略时处理全幅。区域外覆盖率逐字节不变，区域内前景固定为255、背景固定为0。未知区缺少前景或背景锚点、颜色差低于阈值时，保留原覆盖率并计入 fallback。

`guide` 必须是 alpha 全为255的不透明 RGB 栅格，否则在计算前明确拒绝。它可以是已有背景的照片/合成图；**半透明物体夹具是已合成在背景上的不透明 RGB 图，不等于透明 PNG guide**。前景255约束独立蒙版，不能用它声明不存在的源像素变得可见。后续集成如需透明源，应另设计可靠的样本排除与输出 alpha 规则，不能忽略隐藏 RGB。

参数：采样半径1–64（默认16）、RGB引导半径1–40（默认2）、引导混合0–1（默认0.1）、最小RGB颜色距离0.01–1（默认0.05），可提供 `AbortSignal`。所有参数、字节栅格、trimap值、区域和预算先验证；返回新覆盖率，原RGB、原覆盖率和trimap均不改。

后续最小集成路径是一个共用核心动作，将明确的 trimap、目标栅格和ROI送入本函数；预览和提交共用参数，提交复用现有历史，并支持输出选区或非破坏蒙版。去色边会修改RGB，必须另做新图层输出。工作区前景/背景/未知画笔、预览取消和输出动作仍需独立桌面验收。本原型没有添加尚不可用的菜单或能力声明。

## 算法和预算

附近明确前景/背景样本经分离式 running box sums 求局部平均颜色，再将未知像素投影到 `C = alpha F + (1-alpha) B`，复用现有 `colorGuidedMatteFilter` 做轻量细化。采样没有逐像素半径平方扫描，计算量是栅格线性规模加边界项。投影和引导运行在 **encoded-sRGB** 域；这不是物理线性光 matting，也不是语义发丝模型。

源图最多32MP；保守峰值总预算512MiB，运算上限20亿。`estimatedInputBytes` 按三个输入所保留的不同 ArrayBuffer / SharedArrayBuffer 的实际 byteLength 求和，共享背板只计一次，小视图也计入整个保留背板。`estimatedWorkingBytes` 包含输出副本、局部引导、颜色均值、原有引导算法 scratch 以及 box sums 临时数组延后回收的余量，每个局部像素按256字节计；`estimatedPeakBytes` 为输入与工作估算之和，超过512MiB即拒绝。运算估算加入全幅 alpha / trimap 检查的两倍源像素数，ROI不能省掉这部分扫描。较大的全幅应使用ROI，而不是提高预算后强行分配。原子拒绝不会产生部分输出或改动源图。

阶段和行边界检查取消信号。仅把同步纯函数移入worker，并不能让该worker在计算时处理postMessage或改变自身AbortSignal；真正集成应由父线程终止worker，或使用SharedArrayBuffer原子取消标记及可读适配器。getter阶段测试仅证明检查点与原子输入保护，不代表原生AbortSignal能够在阻塞计算中收到事件，也不代表产品任务取消、Undo或UI操作已接通。

## 可重复验证

```sh
npx tsx --test tests/trimap-matte.test.ts
npx tsx scripts/benchmark-trimap-matte.ts
```

第二条命令输出忽略提交的 `artifacts/trimap-matte/acceptance.json`、`comparison.png` 和说明文件。合成图像为本项目原创程序生成，没有外部素材或 Photoshop 输出冒充参考。

在已定义的未知边缘区统计归一化 alpha MAE，目标≤0.03，不能用整图空白平均稀释边缘误差：

| 夹具 | alpha MAE | 结果 |
| --- | --- | --- |
| 亚像素细丝 | 0.00123 | PASS |
| 已合成的半透明软边 | 0.00211 | PASS |
| 抗锯齿尖角 | 0.00135 | PASS |
| 等亮度、不同RGB细丝 | 0.00080 | PASS |
| 低对比 | 0.12447 | FAIL；fallback保留原覆盖率 |
| 缺前景锚点 | 0.03976 | FAIL；fallback保留原覆盖率 |
| 未知细丝颜色与前景锚点不同 | 0.13008 | FAIL；恒定前景颜色假设不成立 |

1,048,576像素全幅独立性能场景的一次本机测量约299ms，进程最高RSS约269MiB，保守工作估算约257MiB、输入背板6MiB、合计峰值预算估算约263MiB；进程RSS包含运行时及此前夹具，不是精确分配归因或稳定性能保证。以重跑报告记录的值为准。

13项回归还覆盖明确前景/背景不会漂移、矛盾原覆盖率被硬约束纠正、区域外不变、原数组保护、NaN/尺寸/trimap/ROI拒绝、资源预算（含小视图巨背板及全源扫描估算）、取消、Buffer源数据独立复制及最后阶段取消的原子性，以及透明PNG guide拒绝。`npm run typecheck` 已通过。

黑、白、棋盘背景预览保留原RGB，因此仍能出现原背景颜色污染；本批没有去色边。尚无自然图至少30张及参考边缘、Photoshop本体比较、真实复杂发丝质量、桌面取消/撤销/输出链路验证。限定合成夹具达标不能替代这些未完成条件。
