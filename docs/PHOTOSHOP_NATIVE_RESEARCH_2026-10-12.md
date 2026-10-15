# 本地 Photoshop 实操与首批效果参考

日期：2026-10-12。实际软件：Adobe Photoshop 2026，About 与原生脚本版本为 **27.11.0**，macOS ARM64。目标是用相同的自制输入和参数建立可复查的行为、像素和格式证据，再改造 Electron 项目。没有使用选品调研图片。不是全部 Photoshop 功能已研究完毕的声明。

## 执行与数据来源

通过原生菜单、快捷键和文件对话框操作已安装的 Photoshop；批量确定性效果通过其 **File → Scripts → Browse** 执行本项目自编 JSX。脚本只打开自制输入，各案例保存独立副本，关闭自己打开的文档并恢复先前活动文档，不循环修改原有文档。该入口由 [Adobe 脚本自动化文档](https://helpx.adobe.com/photoshop/desktop/automate-tasks/automation-settings-and-presets/automate-photoshop-with-scripts.html)支持。

输入包括 512×320 色阶/色块/半透明圆边/棋盘图、透明画笔画布、17³ RGB 色块网格、128×128 阶跃和脉冲图，以及 65×33 非 257 倍数的真正 PNG16。输入图由代码创建，可归档和重复使用。工作目录为 `artifacts/photoshop-native`；完整参考数据已另存到版本控制中的 `fixtures/parity/photoshop-27.11-effects.json` 和 `fixtures/photoshop-corpus/photoshop-27.11.0-rgb16/`，包含作者版本、SHA256、参数与原生脚本/日志来源。

| 执行批次 | 成功输出 | 内容与限制 |
| --- | ---: | --- |
| `scripts/native-reference/photoshop-reference.jsx`，outputs/v3 | 18 | RGB8/16 恒等、Levels、Gaussian3、Invert、HSL、图层 PSD，Feather10、tiny Feather40、300×200 crop |
| `photoshop-supplement.jsx`，outputs/supplement | 20 | RGB8/16 独立 Hue/Saturation/Lightness/组合、Gaussian1/3/6、非字节网格 RGB16 PNG/PSD |
| `photoshop-refine.jsx`，outputs/refine | 8 | Lightness +10/+30、Feather5/10/20、曲线端点(16,0),(239,255) |
| 手工原生 Save As | 1 | 65×33 RGB16 PSB，最大兼容；直接检查 version2/depth16/ZIP prediction 通道 |

共 **47 个成功输出文件**，不等于 47 种功能。早期 v1/v2 脚本记录有失败，不计成功验收。Supplement 的 `LargeDocumentFormatSaveOptions` 构造失败仍保留原始日志；PSB 的成功来自后续手工 Save As，不能用该失败脚本冒充成功来源。`layered-rle.psd` 是作者文件名，实际检查为 ZIP prediction（compression3），不能用名称证明 RLE。

JSX 保留当次执行的绝对工作目录，以便 SHA 来源对应；其他环境重跑须先替换路径并重新记录脚本与输出 SHA。PNG 无嵌入 profile，按当时 sRGB 工作解释测量；脚本中 `untagged` 不能证明 PSD 无 ICC，真实 PSD 后续另查 resource1039。没有用无配置文件样本证明任意 ICC 或跨显示器色彩等价。

## 实操看到的行为

- `Cmd+L` 打开 Levels，输入 Gamma1.25 后色阶亮度变化，可 Undo；另存独立 PNG 后检查实际数字。项目也有独立 Levels 参数回归，Gamma 控制中间调，不应等同增加所有像素的固定亮度。
- `B` 切换画笔。在当时设置下，对独立文字测试层点击画布会提示“此文字图层必须栅格化后才能继续”，包含确认/取消。这为本项目新增显式、可撤销转换提供依据。原生取消后的完整保留结果没有独立像素记录；项目取消行为已单独测试。
- `C` 的工具选项显示 Delete Cropped Pixels 当前勾选、比例/尺寸、拉直和网格。项目当前裁剪保留源图层，只改画布与位置；不能把相同画布尺寸当成相同破坏行为。
- `M`、羽化和工具栏选择模式可查看。实际导出的弱 tiny Feather40 选区没有任何 alpha 达到128，但依然有非零覆盖。它应继续影响编辑，同时不显示50%蚂蚁线。后来尝试手工从选区内部组合时，坐标/临时原生窗口状态未形成可靠操作结果；该补充操作不计原生通过，产品模式修复依据 Adobe 官方流程及 Electron 独立鼠标验收。
- 原生 PSD16/PSB16 Save As 可保留非字节网格通道。PS 自身对非字节输入 open/save 有最多2单位变化；适配器精度以 Photoshop 保存的独立通道参考为准，不声称原输入经过 Photoshop 完全逐位不变。

画笔不透明度/流量、压力、笔尖抗锯齿、完整混合组、Camera Raw、复杂发丝等仍需后续原生参数批次；查菜单或官方说明不算效果通过。

## 首批确认差异与实施

| 差异 | 对图片/操作的影响 | 当前处理 |
| --- | --- | --- |
| 普通 HSL 明度和执行顺序 | 旧 HSL-L 改变中高亮颜色，与 RGB 混黑/白结果不同 | 已改为 RGB Lightness 后 Hue/Saturation；实际色块/网格正负方向验证；Colorize 尚未实际验证 |
| 曲线首末输入固定0/255 | 无法用端点设置黑白阈值，PSD 导入补点导致参数变化 | 已放开横向端点，区间外端值保持，PSD 保留原点；实际两点参考零差异，多点核仍待测 |
| 创建软选区丢失 Feather/组合重复羽化 | 选区硬边或旧柔边被再次改变 | 保留新参数，组合旧/新各自最终覆盖，不重羽化旧区 |
| 蚂蚁线按结构而非最终覆盖 | 弱覆盖显示误导轮廓，AA/反选边界不准确 | 按最终覆盖≥50%显示；无轮廓不清空选区 |
| 工具栏组合从已有选区内部误移动 | Add/Subtract/Intersect 的鼠标意图变成移动 | Move 仅限 Replace；分别验证内部开始的组合和 Undo/Redo |
| 文字/形状绘画静默变像素 | 用户丢失可编辑类型且没有确认 | UI 提示、共享命令 `layer.rasterize`、预览/提交共同保护；源字节和蒙版保留 |
| PSD16 导入量化 PNG8 | 调整前就丢失高位精度与低 alpha 内容 | 真正 PNG16 immutable source + Uint16 working + 单独 PNG8 display；真实 Raw/RLE/ZIP/prediction 验证，工作区预算拒绝原子性 |
| HDR 曝光把负值裁零 | 负通道不可恢复 | 按 Adobe 文档有符号 Gamma；实际负 HDR 作者样本尚未采集，独立代数测试通过 |

详细误差见 [效果测量](PHOTOSHOP_EFFECT_MEASUREMENTS_2026-10-12.md)、[曲线/曝光](PHOTOSHOP_TONE_ALIGNMENT_STAGE2_2026-10-12.md)、[操作语义](PHOTOSHOP_NATIVE_SEMANTICS_2026-10-12.md)、[RGB16 导入](PHOTOSHOP_RGB16_IMPORT_REFERENCE_2026-10-12.md)。统一构建和包内验收另记 alpha.17 报告，定向测试不代替实际桌面门禁。

## 下一批依赖顺序

1. **常用效果继续实测**：Gaussian/羽化核，画笔Opacity/Flow的单笔多笔、硬度/间距，修复/仿制/涂抹，裁剪模式和键盘尺寸步进。固定透明/低Alpha/大图样本，先验证语义再修改，并设计历史工程参数迁移。
2. **格式和合成**：RGB16 PSD writer、RGB32 源数值空间与通道、ICC 转换/保存、组隔离/Fill/高级剪贴。读取、保留、编辑、正确渲染分别验收，按真实作者样本扩充。
3. **复杂能力**：真实人物发丝/背景污染/颜色净化独立集，智能对象/智能滤镜、任意路径/矢量蒙版、复杂文字/样式与资源保留；不能以自导出的简单 PSD 代表全部兼容。
4. **结构与性能**：先测量再改造资产、运算、组合、交互和 IPC 的既有边界；首批已优化 HDR plain raster 合成，尚未证明所有滤镜/大工程性能。

实际 HDR/EDR 显示、Windows、签名/公证、Photoshop 云端生成服务继续保留独立验证门槛。
