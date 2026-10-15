# alpha.28 本批修改与剩余差异

2026-10-14。按用户“尽快结束本次修改，剩余未改暂时做标记”收尾，停止增加工具和扩大原生效果研究。本次交付不等于Photoshop全部功能或像素效果等价。Windows、签名与HDR原生显示仍单独待验。

## 本批完成的源码

- 已有左侧工具按Photoshop相对顺序重排：Move → Marquee → Lasso → W选择组 → Crop → Eyedropper → Healing → Brush → Clone → Eraser → Gradient → Blur/Smudge → Type → Shape → Hand → Rotate View → Zoom。缺少的原生组没有放假按钮，因此不是完整Photoshop工具箱逐项相同。
- 独立E组：普通、背景和魔术橡皮擦；子工具图标、勾号、记忆、Shift+E切换同步。B只切画笔；Photoshop配置R旋转视图。背景橡皮擦隐藏原生没有的Opacity/Flow，提交固定完整强度，避免继承上一支画笔的不透明度。
- 背景擦除接入连续/一次/背景色取样、连续/非连续区域、容差、前景保护；魔术擦除接入容差、连续、抗锯齿、不透明度与全部图层取样。UI预览、提交、MCP使用同一像素准备路径。RGB16直接处理保存的高位数据，浮点HDR明确拒绝；合并取样在全尺寸渲染前检查修订和16MP预算。锁定、栅格化、选区、无变化、取消、预算、撤销/重做与保存重开均有独立集成检查。
- 透视自动尺寸增加最近相机深度约束，并保持近地平线安全保护；文档中心28个原生案例总尺寸误差52→26，新的6个留出案例25→8。实际鼠标GUI四角输出为本项目420×306，Photoshop421×306，仍差1px。
- 透视全图放大采用保守整图几何证明及透明边缘安全混合。最终39个采样案例没有RGB/预乘指标退步或alpha改变；真实高频縮小未解决，仍保留旧安全算法。
- Patch的软尾/抗锯齿候选在其他原生案例退步，全部拒绝，没有改生产Patch内核。失败证据与量化残差保留。

## Photoshop真实对照结果

本机Photoshop27.11实际操作任务自有图像与副本，导出真实像素并检查当前工具参数和历史。用户原文档未被修改，任务副本已关闭，工具参数恢复后返回原文档。

Magic Eraser：同一240×160源、容差32、关闭AA。非连续擦除13,480像素；连续擦除3,840像素。两者alpha、可见RGB及预乘RGB逐像素一致；完全透明像素隐藏RGB规范不同，不声称完整RGBA字节相同。

打开AA的第三个原生探针仍有256个alpha不同像素，alpha平均绝对误差0.8538802083、最大252；预乘RGB平均绝对误差0.2606425654、最大95.85882353。该精确对齐目标为失败，工具整体为部分实现，未用放宽门槛掩盖差异。背景橡皮擦本批尚未完成原生像素效果对照。

透视与Patch实际鼠标操作另有源像素、事件/历史和输出核对，见各专题报告。本项目复现操作通过不代表私有内核完全相等。

## 已标记，暂缓修改

| 范围 | 当前状态与下一步 |
|---|---|
| Magic抗锯齿 | 部分：内侧近似与Photoshop外侧软覆盖不同；冻结失败原生参考，后续单独改进 |
| Background Eraser | 基础可用但原生效果未验；Find Edges、混色边缘去污/发丝仍缺少；HDR禁用 |
| 工具箱缺项 | Frame、History/Art History、Pen/Path、Dodge/Burn/Sponge、Paint Bucket、Pattern Stamp、Mixer/Pencil、文字蒙版等尚缺；逐组清单见下方链接 |
| 透视尺寸 | 强透视与非中心主点仍有残差；不能称自动尺寸完全一致 |
| 采样 | 高频缩小仍有明显差异，alpha放大也非原生等价 |
| Patch | AA、羽化尾部、自然纹理及私有Diffusion仍有差异；RGB16/HDR仍不支持 |
| 全量平台回归 | 本批只安排改变范围的重点桌面/包检查；旧32套完整runtime不重跑，alpha.27历史结果不计作alpha.28通过 |
| Windows/签名/HDR显示 | 未在本机原生完成验证，继续独立待办 |

[完整侧栏功能标记](PHOTOSHOP_TOOLBAR_ALPHA28_2026-10-14.md) · [擦除实现与残差](COLOR_ERASE_ALPHA28_2026-10-14.md) · [透视尺寸](PHOTOSHOP_PERSPECTIVE_SIZE_ALPHA28_2026-10-14.md) · [采样研究](CROP_SAMPLING_ALPHA28_ACCEPTANCE_2026-10-14.md) · [Patch失败候选](PATCH_TAIL_ALPHA28_RESEARCH_2026-10-14.md)。112能力族统计没有因本批有新入口而重新标为完成。

## 本批验收

已完成源码全量check：双语检查、vue-tsc、2085/2085测试（0跳过/失败）、生产构建通过。独立排除out/release/artifacts的1183文件源码副本类型检查通过（复用现有node_modules，非依赖安装验证）。git diff --check通过。

本批真实开发版桌面4套81项通过：透视9、Patch12、E工具8、布局52；运行错误/截图替代均0。runtimeSHA256为634f1858ad2b43769f8c4544cb47922184e929eec353f87a00a1abdaf56d3e25。详情artifacts/alpha28-development-focused/acceptance.json。实际macOS ARM64包E工具8/8通过，包内MCP6/6通过（12工具/协议v2）；未重新跑包内完整4套桌面。包内运行文件、模型/图标、许可与ZIP一致性由SOURCE_MANIFEST记录。

包路径release/0.3.0-alpha.28/mac-arm64/Compositor Electron.app，旧包和用户运行中的旧实例保留。请先保存旧工程并退出旧应用，再按新路径打开，避免macOS复用旧实例。Git没有提交或推送；运行产物、构建、发布包继续由.gitignore排除。

旧32套完整runtime本批不重跑；实际包未重跑完整开发版4套，仅安排E工具与MCP重点检查。工程检查范围缩小是根据用户本次收尾要求，不表示未跑门槛通过。Photoshop整体效果结论仍为PARTIAL。
