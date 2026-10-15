# 上游 e8c9e29 增量移植与 Photoshop 兼容审计

核查时间：2026-10-13。主流程执行 `git fetch origin main --tags` 后，原克隆 `origin/main` 与 `FETCH_HEAD` 均为 `e8c9e29701528413cc0e608d61187c1c61790add`。原工作目录 HEAD 仍为 `75147a27d90c681215151a6301373dd2b07b7aa2`，未 checkout/reset。此前已审计的基线为 `87e2283bae4cea45b857a1bb386f8a56ad4e99b6`。

增量范围有 **4 个提交、4 个文件，275 行新增、11 行删除**。Swift 与 Electron/Vue/TypeScript 的实现语言不同，本批按真实行为移植。

| 提交 | 实际变化 | Photoshop 兼容判断 | 本批处理 |
|---|---|---|---|
| [f745d65](https://github.com/robbietilton/Compositor/commit/f745d65e32304add905e4f09bf3422836cf93d6b) | Camera Raw 各分组 header 单独重置；完整恢复数值、选项、中点、嵌套数组 | 局部重置符合熟悉的分组编辑方式，没有新增工具字母或覆盖 Photoshop 快捷键 | 移植10组默认值恢复、保留其他组、恢复隐藏组可见状态、清点颜色/参考线临时状态 |
| [b8ff682](https://github.com/robbietilton/Compositor/commit/b8ff6827a5325e5e47dd0c8eff14e735705c7cd9) | 分组发生变化时才显示 eye 与 reset；全默认组不显示 | 减少默认状态冗余按钮；不会改变滤镜色彩核 | 移植 changed 状态检测、eye 暂时排除组、重置后重新启用；提交期间禁止修改 |
| [8d3f2fe](https://github.com/robbietilton/Compositor/commit/8d3f2fe6867bb3335d1cc3b143df376b90b44d4b) | 合并 PR #187 | 没有额外第四套算法 | 与前两项一起覆盖，不重复实现 |
| [e8c9e29](https://github.com/robbietilton/Compositor/commit/e8c9e29701528413cc0e608d61187c1c61790add) | Camera Raw 滚动条远离控件 | 仅布局修复，没有快捷键/效果冲突 | Camera Raw 控制区增加稳定 scrollbar gutter 与12px控件间隔；不扩大其他面板 |

`f745d65` 的作者/提交时间是9月29日，此次于10月12日合并进 main。核查以 Git 提交图和基线差异为依据，不只按作者日期筛选。

## 分组恢复和显示语义

| 分组 | 恢复字段 |
|---|---|
| Tonal Adjustments（上游 Light） | Exposure、Contrast、Highlights、Shadows、Whites、Blacks |
| Color | White Balance、Temperature、Tint、Vibrance、Saturation |
| Effects | Texture、Clarity、Dehaze、所有 Glow、Vignette 和 Grain 参数；本项目额外的随机种子 |
| Curve | 曲线、分区点及通道曲线完整对象 |
| Color Mixer | HSL 颜色数组和 Point Colors 完整对象 |
| Color Grading | 各调色轮、Blending 和 Balance 完整对象 |
| Detail | Sharpen 与降噪完整对象 |
| Optics | 镜头参数、色差和 Defringe 色相范围完整对象 |
| Geometry | 投影、Upright、几何参数和 Guides 完整对象 |
| Calibration | Process、Shadow Tint、RGB 主色校准完整对象 |

本项目英文分组使用 `Tonal Adjustments`、中文“明亮度”，保留原有混合模式 `Light` 的中文“亮色”，避免共享消息 ID 冲突。

默认值来自现有 `defaultFilter('cameraRaw')` 的真实严格 schema，包含 Vignette Midpoint/Feather=50、Grain Size=25/Roughness=50 等非零默认值，不能只把滑块清零。组之间的归属不重叠，全部现有参数恰好归入一组；随机 seed 是 Electron 扩展，归入 Effects。

Eye 是本次面板会话状态，关闭时保留该组编辑值，预览及 Apply 使用该组默认值；再次打开恢复保存的编辑值。Apply 提交实际可见的参数，不把临时 eye 状态写进工程，也不让隐藏组在关闭后偷偷生效。面板明确显示这一行为。Reset 完整恢复该组并启用，下一次修改立即可见。取消依然保留原始图层与历史。

颜色取样的当前点索引/范围预览以及几何参考线正在拖动的草稿，在对应组 Reset 时清除。真实 Apply 增加单次提交保护；提交失败通过 finally 恢复控件，不会永久锁住面板。

## 对照源码与实施路径

上游读取：`Compositor/Document/CameraRawReset.swift`、`Compositor/UI/CameraRawControls.swift`、`CompositorTests/CameraRawResetTests.swift`，以及 `git diff 87e2283..e8c9e29`。这些提交没有改变图像滤镜核、工程格式或 HDR 数据格式。

Electron 实施：

- `src/shared/camera-raw-sections.ts`：10组字段归属、深复制、完整默认值恢复、语义默认检测、临时隐藏组输出。
- `src/renderer/CameraRawSections.vue`：分组折叠、可见状态与重置按钮、现有嵌套参数编辑。
- `src/renderer/FiltersPanel.vue`：同一有效参数用于预览和 Apply；分组与整滤镜 Reset 分离；只给 Camera Raw 控件区添加滚动留白。
- `src/renderer/CameraRawPreview.vue`：清除对应取样/参考线临时状态，避免空颜色点索引继续显示范围。
- `src/renderer/App.vue`：滤镜提交单次保护与提交中禁用。
- `src/shared/locales/upstream-alpha25.zh-CN.ts`：新增中文提示与按钮名称，由主流程合入现有国际化表。

本批不移植原 Swift 更新 feed、Sparkle 发布版本或签名，也不把已审计但尚缺 CMM 的 CMYK 校样/导出虚构为已支持。原版 Progressive Blur 画布拖线仍是已记录的旧缺口；本批只审计其契约，不扩展该交互范围。

## 定向证据和统一验收边界

新增 `tests/camera-raw-sections-alpha25.test.ts` 覆盖真实 schema 全字段归属、逐组恢复、不影响其他组、非零默认值、隐藏组输出和源参数不变、嵌套数组/对象语义、实际 FiltersPanel reset 函数以及实际 App 单次提交/失败解锁。首次运行发现代理对象不能 structuredClone，已改为对 schema 的 JSON 值进行递归复制；原失败日志保留。

`scripts/smoke-camera-raw-sections-alpha25.ts` 已准备真实 Electron 控件烟测：10组按钮、live preview、eye 保值和恢复、局部/整组恢复、隐藏组 Apply、撤销重做、取消、双语言和窄窗口滚动条。只替代打开文件对话框的路径，使用自制梯度图和独立应用 profile。

**这份子任务审计不把尚未执行的桌面或包验收写成通过。** 最终源码全量、实际 Electron 开发版和应用包验收数据由 alpha.25 总报告补充。Camera Raw 的颜色核仍保留此前与 Core Image/Photoshop 的平台差异，本批重置控件完成不代表所有 RAW 图片效果逐像素相同。
