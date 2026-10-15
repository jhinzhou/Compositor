# Photoshop 实测修复第三批：alpha.19

日期：2026-10-12。目标：`Compositor_Electron`，版本 `0.3.0-alpha.19`。本批继续 alpha.18 的真实 Photoshop 效果对照，聚焦硬圆笔尖、低 Flow 残差、裁剪手势生命周期和有限范围 PSD 蒙版。本文区分已修复、原生实测、项目回归和仍未验证的效果；不声明完成整个 Photoshop 对齐计划。

## 已完成的修复

| 问题 | 修复与实际结果 |
|---|---|
| Photoshop 配置硬圆边缘过于锋利 | 以 32px 原生参考提出固定 Gaussian CDF 边缘，使用 8/16/31/33/64px 和半／四分之一像素路径落点留出验证；不按每个尺寸拟合。32px 单点最大 Alpha 误差由约80降低至10。 |
| 高分辨率源缩小后的软边丢失 | 修复ROI未预留dab像素对齐位移的问题；增加独立回归，50个低间距落点在4096px缩小源上应保留的Alpha5尾部，修复前为0、修复后为5。独立实测记录见 `artifacts/alpha19-scaled-roi-measurement.log`。此项验证内部范围正确性，不声称原生100px笔尖核等价。 |
| 小数落点的程序圆笔与原生模板相位不同 | 保持连续弧长与间距，再按原生观察对每次 Photoshop dab 的文档像素原点对齐。实际本项目鼠标落在整数／半像素时，32px 硬圆均为最大10/255误差。Compositor/未标记旧模型保留原算法。 |
| 硬笔尖 AA 尾部被 raster 成长范围截断 | 统一 footprint，包括高位深、擦除、选区画笔和蒙版目标，保留三像素尾部；原始高位深样本仍直接合成，不以PNG8代理替代。 |
| 按住鼠标创建裁剪框时按 Enter | 提交前主动完成裁剪创建手势并等待 lease 释放，后续 mousemove/up 不再把旧 revision 的草稿写回。实际 Undo/Redo 可立即执行。 |
| 第二个指针结束第一个裁剪拖拽 | CropOverlay 的 pointerup/cancel/lostcapture 验证 owner；主画布普通拖拽的 move/up/cancel 也验证 owner；辅助旋转、取样等手势仍需另行审查。 |
| 裁剪句柄拖拽中切换应用 | CropOverlay window blur 取消拖拽、恢复原框并释放交互；实际撤销／重做不再被悬挂 lease 挡住。 |
| 有限 PSD 蒙版载入为选区时丢失外围覆盖 | visible coverage 统一 effective mask；显式白色／灰色外围覆盖保留，1px原生均匀蒙版保留稀疏快速路径。 |
| 默认属性下单独显示蒙版猜错外围颜色 | mask-alone 灰度视图通过同一 effective-mask 合成显示显式 PSD 外围色；实际黑／白两种外围色及有限 tile 均正确。 |
| 蒙版滤镜 Preview 与 Apply 外边界不一致 | 两条路径都传显式 `photoshopMaskDefault`；实际灰度画布 Preview/Apply 逐字节一致，Preview 不修改 revision，Undo/Redo 恢复原像素／位置。 |
| 编辑蒙版后恢复旧值会复活过期 PSD 参数 | properties/placement/filter 使原 mask 参数快照失效；例如导入 feather500 后显式应用当前250，不再导出原500。Undo 仍恢复原源参数。 |

## 原生 Photoshop 证据与差异

实际应用为 Photoshop 2026 27.11.0。通过 File → Scripts → Browse 执行自制透明／纯白诊断图的独立文档；只关闭脚本自身文档，原先 `analysis-grid.png` 活跃文档和工具选项保留。没有使用选品调研图片。

新增24组原生画笔输出，包括复测控制、8/16/31/32/33/64px、90/99/100硬度、整数/半像素/四分之一像素原点、Flow20/Spacing10，以及4组RGB16低不透明度PNG与PSD。v5日志读回 `brush.diameter/hardness/spacing`、Flow/Opacity，并禁用 smoothing/pressure/texture/scatter。原生Alpha归档累计56行，其中51个8位逐例测试，5个16位参考保留差异。脚本、日志、原PNG、压缩Alpha均保留SHA。

- 独立 alpha.18 基线与统一候选，在18个99/100%硬度参考上的平均 union Alpha MAE 为 **9.0182 → 1.5256**，18/18改善。
- 32px硬圆单点：最大Alpha约80 → 10；8/16/31/33/64px硬圆留出最大Alpha为8–11。
- 32px硬圆半像素落点：167 → 10；四分之一像素：115 → 10。
- 32px Soft Flow20 Spacing10：最大36 → 29；32px Hard Flow20 Spacing10：56 → 44，仍不等同于原生低流量稠密落点。
- 90%硬度小笔尖仍有明显误差；本批CDF只改善接近完全硬的端点，不把中间硬度误差包装成通过。
- 原生RGB16 PSD通道与PNG峰值一致：1/2/10/50%分别772/1286/6682/32895，数学16位比例655/1311/6554/32768。本项目保留连续命令精度；尚未引入原生工具不透明度量化模式。

独立测量脚本 `scripts/measure-photoshop-brush-edge-candidates.ts` 重建 alpha.18 旧算法作为 before，排除重复v5行，后续产品变更不会覆盖旧基线。候选是通用近似，不是 Photoshop 私有核的精确复现；实际CDP pen事件测试不代表与Photoshop真数位笔压力/延迟等价。

蒙版密度新增2个有效原生控制（100/50%，Feather0），实际合成Alpha逐像素误差0。非零蒙版 Feather 通过本机 ExtendScript 设置未通过参数读回校验：v1–v5的失败日志留存，**全部非零羽化输出排除**，未因此改变属性羽化核或宣布原生等价。今后应使用真实属性面板／受支持的记录动作重新采集。

## 统一验收

- `npm run check`：**PASS，1,326源码测试，i18n、vue-tsc、生产构建与MCP/subject worker构建通过**。
- 最终开发版：**PASS，14组198项桌面检查**；包含 Photoshop阶段9组81项及高位深/布局5组117项。记录见 `artifacts/alpha19-photoshop-dev-final/acceptance.json`、`artifacts/alpha19-dev-final/acceptance.json`。
- 最终实际 macOS ARM64 目录包：**PASS，14组198项桌面检查**；记录见 `artifacts/alpha19-photoshop-packaged-final/acceptance.json`、`artifacts/alpha19-packaged-final/acceptance.json`。开发与安装包运行同一套198项，不按396项不同功能计数。
- 目录包版本：`0.3.0-alpha.19`；`app.asar` SHA-256：`0a13f9211c52604a2832dbe8d3ca0d0c2e80ec07610e58ed08436e51dddb0250`。包内runtime/模型/图标/许可证逐字节一致性：**PASS**。完整性及最终源码快照以 `artifacts/release-integrity.json` 和 `release/0.3.0-alpha.19/SOURCE_MANIFEST.json` 为准。

当前新桌面检查包含 actual mouse硬／软圆Alpha、pen-pressure源、mask有限边界灰度显示及Preview/Apply、Enter-while-held裁剪、owner指针、blur/Undo/Redo；原有保存重开、PS RGB16/PSB通道、高位深绘画／滤镜／调整合成、HDR源、双语布局及真实stdio MCP继续执行。

布局复查覆盖中文/英文、1050×720及1440×840窗口，共52项。查看实际截图确认拾色器十六进制标签完整、取消/确定按钮在独立底栏，缩放输入与百分号保持同一行，Agent表单可滚动而标题与发送区保持可用。没有截图降级或报告错误；这属于现有布局修正的回归，不声称本批重新实现全部面板。

复验命令（先执行源码检查，再串行运行桌面；原生 Photoshop 参考采集另行执行）：

```sh
npm run check
npx tsx scripts/check-photoshop-stage-release.ts artifacts/alpha19-photoshop-dev-final
npx tsx scripts/check-high-depth-release.ts artifacts/alpha19-dev-final
COMPOSITOR_EXECUTABLE="$PWD/release/0.3.0-alpha.19/mac-arm64/Compositor Electron.app/Contents/MacOS/Compositor Electron" npx tsx scripts/check-photoshop-stage-release.ts artifacts/alpha19-photoshop-packaged-final
COMPOSITOR_EXECUTABLE="$PWD/release/0.3.0-alpha.19/mac-arm64/Compositor Electron.app/Contents/MacOS/Compositor Electron" npx tsx scripts/check-high-depth-release.ts artifacts/alpha19-packaged-final
npx tsx scripts/verify-release.ts mac-arm64
```

生成包：`release/0.3.0-alpha.19/mac-arm64/Compositor Electron.app`。这是未签名 macOS ARM64 目录包；Windows原生、签名／公证、HDR显示器输出与任意外部复杂PSD仍为独立门槛。

## 剩余事项

1. 原生90%附近硬度、稠密低Flow相位、16位工具量化；更大／更小笔尖、真实自由手绘与数位笔延迟。
2. 蒙版非零属性Feather的可验证原生采集、单位及变换顺序；有限1×1 PSD蒙版与原生无限均匀蒙版的区分仍需独立研究。
3. Photoshop非破坏裁剪的 Delete Cropped Pixels 选项、修复／仿制／涂抹／液化／Camera Raw 的授权真实照片对照。
4. RGB16 PSD写出、RGB32/ICC、Fill/隔离组、智能对象及外部复杂PSD；复杂发丝与颜色净化。
5. 稳定后测4K/多图层操作延迟、保存和Undo峰值内存，再按瓶颈优化架构。

本批没有提交或推送Git，保留之前已存在的所有未提交改动与历史发布包。

参考语义：[Adobe Brush Settings](https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/brushes-presets/display-brush-panel-brush-options.html)、[Adobe Brush painting](https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/brushes-presets/paint-with-brush-or-pencil-tool.html)。这些官方资料用于参数语义；本文像素测量来自本机原生输出，不能由帮助页证明数值等价。
