# alpha.17 结构与性能首批优化

2026-10-12。现有 TypeScript / Vue 3 / Electron / CanvasKit 架构保持；首批完成行为和真实参考后实施有测量依据的优化，未进行全面重写。

## 像素合成生命周期

`hdr-composite.ts` 提取单像素 `compositePixel`，由数组合成和采样合成共同调用同一混合代数。普通 raster 直接逐像素写入结果；对齐、同尺寸且没有启用蒙版的完整图层直接读原 Float32 缓冲。避免每个 raster 再分配一张整画布 Float32 暂存。原有采样后的 Float32 舍入位置保持；变换/蒙版走原核，剪贴保留 base raster 与 alpha 平面，调整层维持保守 scratch 预算。

预算依据实际生命周期区分：plain 输出16字节/像素；有 clipping 再保留20字节/像素；有 adjustment 仍使用旧96字节/像素加核额外工作。源编码、display、解码浮点、mask scratch 与采样工作上限继续计入。没有提升512MiB上限。

独立回归检查全部6种支持的混合、fractional alpha/opacity、negative/overwhite；直读快速路径与1×1全白蒙版的慢路径逐 Float32 相同，原数组不改。已有变换/翻转/组蒙版/剪贴/调整和不支持堆栈测试继续执行。

## 同环境受控 before/after

单个已经解码的完整、对齐 High quality HDR图层，Node24.14.0/macOS ARM64。每组单次测量，完整输出与原 Float32 数组相等。隔离合成，不包含解码、I/O、GPU或用户界面。进程 memory counters 是前后快照，不是峰值RSS。

| 尺寸 | 优化前时间 / 估计工作量 | 优化后时间 / 估计工作量 | 输出检查 |
| --- | --- | --- | --- |
| 1024×512 | 135.25 ms / 56.000 MiB | 10.49 ms / 16.000 MiB | Float32 exact |
| 2048×1024 | 530.93 ms / 224.000 MiB | 34.82 ms / 64.000 MiB | Float32 exact |
| 3840×2160 | 预算拒绝 / 885.938 MiB | 145.27 ms / 253.125 MiB | Float32 exact |

原始 JSON：`artifacts/alpha17-hdr-before/results.json`、`artifacts/alpha17-hdr-after/results.json`；重跑脚本：`scripts/benchmark-hdr-composite.ts`。该数据不能推广为全部滤镜15倍加速。

## 真实源链路验证

`scripts/benchmark-hdr-real-source.ts` 使用自制 3840×2160、含2.125超白/-.125负值/Alpha1的 FLOAT ZIP EXR，真实encode/decode → immutable Editor import → HDR composition →512×288 RGBA8 SDR display。

本次源构造/编码/解码 6580.55 ms，合成 222.63 ms，含重新合成的预览 324.17 ms；合成工作预算 258.967 MiB。不是Photoshop同操作性能对比，也不是HDR显示。解码源与合成结果 exact，negative/overwhite存在；只读预览没有修改revision/源字节。真实链路单次执行，且与其他后台验收同机运行，时间只作为本轮记录。结果与SDR图在 `artifacts/alpha17-hdr-real-source/`。

## 跨进程资产预算

`deep-assets.ts` 增加共享 `countAssetBackingBytes`，保留完整 ArrayBuffer backing 大小并去重 slice/重复资产。`DocumentManager.importPhotoshopSnapshot` 在替换画布前同时预检已有文档/历史、worker transfer资产、额外剪贴板版本、main控制器尚持有的另一份structured clone，以及readonly preview/cache字节。主进程和worker接线将实际额外存储传入同一预算；未知/负数/非安全整数context原子拒绝。EXR和PNG使用对应解码预算，不把HDR按PNG解析。

该入口仍重新验证canonical源，避免只信任IPC携带的deep/display视图。拒绝不创建新tab，不改变active/revision/history/asset；6项独立budget/import测试覆盖上下文耗尽、破损源前拒绝、别名去重、真实16/HDR及无效参数。PSD解析另有64MiB元数据reserve、strict channel长度以及fullcanvas group/adjustment masks预算。

## 继续优化的测量门槛

保持UI/MCP/Agent共享typed Editor command边界；资产canonical源、working样本、display代理三种表示继续分离。下一批测多图层4K/调整/blur/undo/save的CPU与峰值内存，再选择缓存生命周期、tile/streaming、大文件writer和取消策略；当前没有证明这些路径整体优化完成。Windows、显卡、HDR/EDR屏幕、字体跨平台性能独立验收。
