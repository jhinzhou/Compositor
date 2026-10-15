# alpha.25 上游移植、紧凑分组箭头与局部修复验收

日期：2026-10-13。版本：0.3.0-alpha.25。参考：本机 Photoshop 2026 27.11.0。本报告分开记录代码修改、实际运行和原生图片效果；仍存在的差距保留。

## 本批实现

- 左侧工具组右下角箭头由字体符号改为固定4×4 CSS像素的三角形，保留完整按钮点击范围；正常/矮窗口≥28px，低高度双列仍可见。二级菜单的图标、勾号、记忆项和键盘操作保持。
- 原版main实际fetch到[e8c9e29](https://github.com/robbietilton/Compositor/commit/e8c9e29701528413cc0e608d61187c1c61790add)。相对87e2283新增4提交，主要是Camera Raw分组重置、eye/reset仅在修改分组出现、滚动条避开控件；这些行为与Photoshop操作配置兼容，已按Vue/共享命令结构实现。原Swift工作目录未checkout/reset，298文件源码和逐文件来源记录保留。
- Camera Raw分成10组。逐组Reset恢复真实schema默认值，包括非零默认、枚举和嵌套数组；重置隐藏组也恢复启用。eye暂时排除该组的预览和Apply，参数保留，可重新启用；提交期间禁改且防重复提交。控件滚动区有稳定gutter和12px留白。
- Camera Raw英语分组使用Tonal Adjustments（中文明亮度），避免与混合模式Light（亮色）词条混用。
- 修复Patch Destination的半像素浮点往返偶发取错相邻列。现在只稳定化浮点噪声，不改变正常分数位移。
- Patch融合供体/覆盖率和红眼候选/连通遍历改为局部工作区。RGB8源上限1600万像素，Patch工作区最多400万、红眼眼部工作区最多200万；Remove/Content-Aware Move仍最多200万源像素。整个源仍需解码和保存，不宣称全链只占局部内存。

## 实际运行验收

| 验收层级 | 实际结果 |
|---|---|
| `npm run check` | 类型检查、1910项测试（0失败/跳过/取消）、国际化及构建通过 |
| 国际化 | 41个Vue组件、2180条唯一消息、770个字面消息键，0问题 |
| 开发版真实Electron | 28套、383项全部通过；0运行错误、0截图回退 |
| macOS ARM64目录包真实Electron | 28套、383项全部通过；0运行错误、0截图回退 |
| 新增Camera Raw行为 | 两种运行形态各19项通过，含逐组重置/临时隐藏/实际Apply/中文及小窗口 |
| 工具栏 | 两种运行形态各32项通过，4×4箭头、完整点击范围、菜单图标/勾号/工具循环及多种窗口尺寸 |

两种实际运行使用相同冻结构建，runtime SHA256为`3eb025c1b2168626a0e341910b8b75422802788b295e813479df4f04691ff5a8`。覆盖现有画笔、选区、蒙版羽化、裁剪生命周期、RGB16 PSD/PSB导入、高位深合成/工具、布局和上下游UI回归。运行通过验证这些流程可执行，不能替代下表的Photoshop效果等价验收。

机器证据分别位于artifacts/alpha25-source-check.log、alpha25-development/acceptance.json、alpha25-packaged/acceptance.json及alpha25-unified-acceptance.json。运行器在每套开始和结束检查out摘要，源码、开发版、真实目录包、原生效果、平台硬件门槛分开。

## Photoshop 原生图片效果与剩余差距

使用自制512×320图，不使用用户业务图片。Photoshop实际鼠标/键盘产生效果；JSX只打开本任务副本、读取尺寸/历史和保存PNG。源及输出RGBA摘要固化到仓库内fixture，可从干净源码复算。未确认的透视初次角点和失败Diffusion7不计入有效参考。

| 对照 | 当前结果 | 结论 |
|---|---|---|
| 5种透视四边形，显式使用原生输出尺寸 | RGB MAE 0 / 0.209814 / 0.358634 / 0.307146 / 0.386546；最大通道差0/19/31/45/33；alpha最大差均0 | 接近但不逐像素相同，本批未修改采样核 |
| 透视自动建议尺寸 | 当前与PS最大宽差66px、最大高差33px；最长对边候选仅符合3/5 | **仍未对齐**，未对少量坐标硬拟合，生产自动尺寸保持 |
| 原生Patch Diffusion1，51×51 | 产品adaptation1 MAE0.556837 / max3；选区外RGBA不变 | 同一合成样本较接近，不能泛化到自然纹理 |
| 原生Patch Diffusion5，51×51 | MAE14.221581 / max71 | **仍明显不同**，未把不同参数/选区结果当作代码改善 |
| 旧Patch Diffusion5，50×50 | MAE7.025067 / max20，原有门槛保持 | 与新51×51样本独立保留 |
| 旧红眼两动作样本 | ROI MAE4.290741，软外围/自然眼睛仍有差异 | 本批改局部工作区，未宣称效果核进一步改善 |

透视自动尺寸下一个专题需要更多几何/变换矩阵证据；Patch需要不规则选区、自然纹理和完整Diffusion留出。RGB16/HDR测试验证项目自身源数据保真，五个原生透视和两个新Patch都仅RGB8，不能据此证明高位深Photoshop等价。

详细记录：[上游审计](UPSTREAM_ALPHA25_E8C9E29_AUDIT_2026-10-13.md)、[透视研究](PHOTOSHOP_PERSPECTIVE_ALPHA25_2026-10-13.md)、[局部修复与Patch对照](PHOTOSHOP_RETOUCH_ALPHA25_2026-10-13.md)。

## 新版应用与发布核对

- 应用：`release/0.3.0-alpha.25/mac-arm64/Compositor Electron.app`。
- 压缩包：`release/0.3.0-alpha.25/Compositor-Electron-0.3.0-alpha.25-mac-arm64.zip`，241,063,207字节。
- ZIP SHA256：`7e39b8e071f24de868637291b280bdb7e8b0e89784a4dec658bf550fce32ef62`。
- `verify-release.ts mac-arm64`核对目录包内全部当前out、模型、图标与许可证；结果位于`artifacts/alpha25-release-integrity.json`，逐文件源摘要位于`release/0.3.0-alpha.25/SOURCE_MANIFEST.json`。
- 这是未签名的macOS ARM64目录包，已在本机实际运行；本批不把它记作Windows真机或HDR显示器验收。


更新时先保存并退出自己的旧窗口，再打开上述alpha.25路径。此前历史包保留，不强制关闭用户未保存工程。本批未提交或推送Git。

## 后续顺序

112能力族仍14基础/67部分/31缺少，截图22子工具仍8基础/10部分/4缺少；改几个子功能不代表整族完成。优先继续透视自动尺寸和修补自然纹理/单次红眼留出，再做移除/内容感知移动大图、高位深和多层/独立层输出；之后添加切片、切片选择、注释、计数。

Camera Raw色彩核、CMYK/CMM校样、复杂发丝、任意外部复杂PSD、Windows真机和HDR显示器仍有独立差距。完整清单见[功能效果目录](PHOTOSHOP_FUNCTION_EFFECT_CATALOG_2026-10-12.md)和[开发计划](PHOTOSHOP_ALIGNMENT_PLAN_2026-10-13.md)。

## 复算

```sh
npm run check
npx tsx scripts/measure-perspective-alpha25.ts
npx tsx scripts/measure-patch-alpha25.ts
npx tsx scripts/check-alpha25-runtime.ts artifacts/alpha25-development
# 将COMPOSITOR_EXECUTABLE设为本机alpha.25 .app/Contents/MacOS/Compositor Electron后重复同一runner
npx tsx scripts/verify-release.ts mac-arm64
```
