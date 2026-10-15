# 最新 Compositor 内容识别填充与修复内核

本批以本地只读上游快照 `Compositor_Upstream/6aea90a` 的 `PatchPixels.c` 和 `HealPixels.c` 为准，提交 `6aea90a7ca88bfd8d38c26e858a3835a458afae1`。这是 alpha.11 的算法移植记录，不代表 Photoshop 内容识别填充、自然照片修复或 Windows 已验收。

## 实现与默认入口

- `src/shared/native-patch-fill.ts`：7×7 取样块、六通道 RGBA 与水平/垂直纹理、多尺度 PatchMatch、前后交替传播、确定性分带随机搜索、加权投票与最后锐化投票、膜求解颜色衔接。上游依照图像孔洞及四周区域进行工作区裁剪，避免每一级完整处理整张大图。
- `src/shared/native-membrane.ts`：共享上游 Float32 多尺度膜求解；保留运算次序，并复用求和临时数组。
- `src/shared/native-heal.ts` 的默认 `healPremultiplied`：内容识别模式先重建像素，再按笔迹覆盖率和不透明度混合；没有完整、不透明的 7×7 取样区时按最新版上游回退“创建纹理”。另外两种模式保留相同内核。
- `src/core/content-fill.ts` 的默认 `contentAwareFill`：从 PNG 非预乘 RGBA 转换到上游预乘格式，并还原结果。未选中像素和透明像素隐藏的 RGB 原样保留；没有取样区报 `NO_SOURCE`，整个操作不发布修改。
- `src/core/subject-worker.ts` 的填充返回算法标签 `compositor-multiscale-patchmatch-6aea90a`，通过既有独立辅助进程执行。取消或超时由父进程 `SIGKILL`，下一任务重建进程。

上游 C 使用原生并行 row bands；本实现按同样的分带顺序在辅助进程中执行。跨分带传播读取同一轮开始时的 match 快照，因此保留随机状态和结果。每个 Float32 中间运算明确舍入，输出使用与上游 `lrintf` 一致的最近偶数舍入；修复混合沿用 `lround` 舍入。

## 独立参考数据与结果

运行 `python3 scripts/create-patch-reference.py`，直接编译未修改的上游两个 C 源文件。编译 SDK、flags、提交号及两个源文件 SHA-256 写进生成的 JSON。生产应用没有 C 编译依赖。

本机 MacOSX27 SDK 的 TAPI 架构与当前 linker 不兼容，生成器显式使用已安装的 MacOSX26.5 SDK，可通过 `--sdk` 改变；记录的编译参数是 `-O2 -ffp-contract=off -fblocks -dynamiclib`。关闭浮点乘加收缩是为了与跨平台 Float32 次序比较，因而这里证明的是该明确编译条件下的内核结果。

参考数据：`fixtures/parity/native-6aea90a-patch.json`（10 组）和 `native-6aea90a-healing.json`（24 组）。覆盖小孔、多种 seed、多尺度渐变、分离不规则孔、图像边缘孔、裁剪工作区、透明孔、透明取样区及无完整 7×7 取样区。**34/34 逐字节相同，最大字节差 0。**输入 RGBA 与覆盖数组保持不变。

`npx tsx scripts/benchmark-patch-upstream.ts` 生成忽略提交的 `artifacts/patch-upstream/acceptance.json`，含逐案例耗时、工作量、峰值估计、期望/实际 SHA-256，以及对比 PNG。该报告是人工合成图像上的算法对照，不能替代真实照片的主观质量验收。

本批集中测试 `patch-upstream`、`content-fill`、`subject-worker`、`retouch-edit`、`trimap-worker`：**58/58 PASS**。除 34 组新 C 参考外，还验证了默认 Spot Healing 的一次事务与撤销/重做、真实进程填充取消/超时/重建、资源失败不污染进程、Buffer 输入不变、PNG 解码及既有 C1 trimap worker。

旧参考 `native-1.4.8-content-fill.json` 与 `native-1.4.8-healing.json` 未改变。旧算法通过明确命名的 `contentAwareFillLegacy1_4_8` 和 `healPremultipliedLegacy1_4_8` 验收，保留历史基线，不将旧期望数据改成新输出。

## 资源保护与剩余差距

默认工作预算仍为 120,000,000，上限仍为 500,000,000；统计取样块像素访问、图像扫描、膜迭代和 PNG 转换，不通过放宽预算适配新算法。超过预算抛 `RESOURCE_LIMIT`，所有输出在私有副本完成，失败不改变原图。内存上限 512 MiB，估计包含实际不同 backing ArrayBuffer 的完整长度（小 view 也可能保留巨大 backing）、RGBA 输出、多级局部工作区与临时数组；PNG 入口和辅助进程入口另计格式转换、父/子传输副本和排队快照。active 与 queued snapshots 仍受 256 MiB 限制。

进程填充取消有实际 `SIGKILL` 检验，不靠同步 getter 伪装为可中断。独立内核 AbortSignal 测试只验证检查点；同步计算在同一 JS 执行栈内无法处理新来的 postMessage。**Spot Healing 当前仍在编辑命令 worker 同步执行**，有计算预算与原图保护，但这里没有宣称它获得了和填充相同的辅助进程即时取消。

复杂的大孔/大选区可能因工作预算或内存预算被拒绝，应缩小操作范围。上游算法不是生成模型，无法保证结构性物体、大面积语义补全或自然图像上的 Photoshop 同等结果；本批也没有完成自然照片双应用盲测、Windows 桌面运行或 Photoshop 参数/取样区编辑器。
