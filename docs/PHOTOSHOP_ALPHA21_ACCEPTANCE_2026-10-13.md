# Photoshop 对齐 alpha.21：近硬笔尖、小半径蒙版与裁剪

日期：2026-10-13。运行环境：macOS ARM64，Photoshop 2026 27.11.0，Compositor Electron 0.3.0-alpha.21 / Electron 44.7.0。本批按“原生参考 → 统一数学规则 → 源码回归 → 开发版与安装包实际操作”验收，不把同名工具或运行成功当作图片效果完全相同。

## 本批实现

1. **近硬圆笔尖**：显式 Photoshop 模型采用有界、连续的肩部/硬边半径修正，减少接近 95% 硬度的过亮环带。h0/h100 端点、旧 Compositor 模型、spacing、Flow 与高位深源合成保持原有语义，没有逐图片 lookup。
2. **小半径蒙版羽化**：小核使用采样方差修正的紧支撑 Gaussian，1–2px 连续过渡至既有 box4；≥2px 核系数不变。只修改显示/合成时的覆盖，源蒙版不回写。
3. **自动拉直**：裁剪工具选择“拉直”，沿希望水平或垂直的线拖参考线。自动计算最近水平/垂直的校正角度和内接裁剪框；±45°，可选输出比例。旋转保存在各层及独立蒙版的 placement，普通/拉直裁剪保留画布外原始像素。
4. **透视裁剪**：四角与整体移动交互、投影网格、建议或手动输出尺寸，四角/网格显示在SDR小预览上方，Enter/Apply 一次提交，Esc 取消。最终从原始 RGBA8/16 或 Float32 HDR 源做 inverse homography 采样；不从 SDR 小预览提交。透视会替换当前图像源，会话 Undo 能恢复，保存重开不会保留隐蔽的旧源副本。

普通裁剪继续走非破坏路径。透视保守拒绝未栅格化文字/形状、组、调整图层、图层效果、参考线和非零羽化蒙版；密度标量保留。拒绝在提交前完成，不改变 revision/history。120M 实际采样 tap、512MiB 估算工作内存以及现有高位深预算在分配前检查。共享资产逐层使用原始快照采样，避免重采样两次。

## 真实 Photoshop 效果对照

全部使用自建诊断图，不使用选品调研图片。原生 Photoshop GUI 由根代理串行操作；画笔额外使用原生 strokePath BRUSH 脚本，保存 PNG/rawAlpha/SHA 与实际参数读回。strokePath 不等于数位板或真实自由手绘验证。

### 近硬笔尖

原112个参考 + 新46种唯一设置 = **158项**；新脚本47次执行中16px/h85重复一次，不把重复算成独立设置。

| 样本 | alpha.20最大 Alpha 差 /255 | alpha.21最大差 /255 |
|---|---:|---:|
| v6，64px / 硬度95% 单点 | 41 | 21 |
| v7，48px / 95% 单点 | 12 | 11 |
| v7，64px / 95% 单点 | 41 | 22 |
| v7，96px / 95% 单点 | 41 | 25 |
| v7，128px / 95% 单点 | 41 | 27 |
| v7，64px / 95% / Flow20 连线 | 21 | 18 |

按覆盖 union MAE：15改善，142覆盖逐字节不变，1轻微退化。唯一退化为48px/h92，MAE增加0.018，最大差仍9；原112个参考无退化，旧限值没有放宽。96/128px h100最大差仍34/32。近硬结果更接近，但尚未完全复制 Photoshop 笔尖。

原生记录和公式分析：[笔尖分析](PHOTOSHOP_ALPHA21_NEAR_HARD_ANALYSIS_2026-10-13.md)，`fixtures/parity/photoshop-27.11-brush-v7.json`，`artifacts/photoshop-native/measurements/alpha21-near-hard/comparison.json`。

### 小半径蒙版羽化

**31个原生输出**（旧16 + 新15；有半径重复，不代表31种唯一参数）。最坏覆盖差19→6/255，最大差没有退化。

| 实际读回羽化半径 | alpha.20最大差 | alpha.21最大差 |
|---|---:|---:|
| 0 / 0.1px | 0 | 0 |
| 0.2px | 7 | 3 |
| 0.3px | 19 | 0 |
| 0.4px | 7 | 1 |
| 0.8px | 5 | 3 |
| 0.9px | 4 | 1 |
| 1px | 5 | 2 |
| 1.2px | 3 | 2 |

留出半径0.6/0.7px仍有6/5差，3px仍3；其他任意旋转/缩放、灰度与原生高位深蒙版还不能据此宣称全部等效。真实应用测试逐项验证 Preview/Apply 的灰度 canvas bitmap、Undo、保存关闭重开。

原生记录和公式分析：[蒙版参考](MASK_FEATHER_ALPHA21_REFERENCE.md)，`fixtures/parity/photoshop-27.11-mask-feather-ui-alpha21.json`，`artifacts/photoshop-native/measurements/mask-alpha21/comparison.json`。

### 拉直与透视

使用512×320自建源图、实际GUI拖动，并从 Photoshop 保存图像及工程：

| 操作 | Photoshop 实际输出 | 项目结果与差距 |
|---|---|---|
| 拉直 `(60,132)→(380,172)` | −7.125016°，430×269 | 角度与整数画布尺寸一致；项目保留源像素，PS实际栅格化该层，因此不宣称最终像素完全一样 |
| 四角 `(60,40),(430,55),(400,280),(75,260)` 自动尺寸 | 387×257 | 建议348×224；自动尺寸算法仍不同，可明确输入尺寸 |
| 同四角手动348×223 | 348×223 | Alpha最大差0；RGB MAE4.486470/255、RMSE14.537943、最大通道差237，仍有高频像素差 |

当前默认 Mitchell B=C=1/3、Smooth bilinear、Nearest；准确整数对齐/平移/90°映射直接保留源样本。独立采样诊断保留了滤波、像素相位与角点偏移对比，没有采用仅单图有效的非对称偏移。还需多图、多四边形原生参考继续校正。详细边界：[裁剪实现与参考](CROP-ALPHA21-REFERENCE.md)。

## 统一验收

**源码、开发版、安装包和发布完整性全部PASS**。聚合记录逐个读取子报告、核验status与空errors，布局截图fallback也必须为0；实际记录位于 `artifacts/alpha21-final-acceptance.json`。

- 源码：`npm run check` 完整 PASS；**1,550/1,550**测试，typecheck、i18n 与 build 全通过。
- 开发版实际应用：Photoshop阶段15组139项 + 高位深5组117项 = **20组256项全部PASS**；布局52项、ZH/EN、1050×720与1440×840，截图fallback为0。最终版本全部组重新执行；实际裁剪截图逐角检查4个白色角点始终位于SDR小预览上方。
- 新版 macOS ARM64 目录包：`release/0.3.0-alpha.21/mac-arm64/Compositor Electron.app`。打包使用本地官方 Electron44.7.0 distribution，规避重复下载等待，不改变应用构建配置。
- 安装包实际应用：同样 **15组139项 + 5组117项 = 20组256项全部PASS**，全部重新执行；布局52项与截图fallback0。开发版与安装包重复同一套256项，**不是512个独立功能**。
- 运行记录：开发版 `artifacts/alpha21-development/{photoshop,high-depth}/acceptance.json`，安装包 `artifacts/alpha21-packaged/{photoshop,high-depth}/acceptance.json`。子报告均无renderer errors。
- 包完整性：16个构建文件、模型/图标与28个许可证文件均与当前构建一致；发布源码快照含811文件，`release/0.3.0-alpha.21/SOURCE_MANIFEST.json`。检查脚本修正后再次typecheck、严格定向TS与git diff --check均PASS。
- ZIP：`release/0.3.0-alpha.21/Compositor-Electron-0.3.0-alpha.21-mac-arm64.zip`，240,991,695 bytes；SHA-256 `326215c887a38f464c29ce40fd1fbe17ffc8fb1f1eed223451bb766446565d74`。实际asar SHA-256 `e55accb895b615640add36289a40a04cd5a5e6e4f5243d1e00dbffab3c2ab76c`。
- 原生效果参考与实际应用交互分别验收；HDR源值保真不代表HDR显示器输出验收。Windows、签名/公证及任意外部复杂PSD仍是独立门槛。

测试脚本异常也保留记录：首次蒙版回归因测试未关闭重开的工程达到八文档上限；第二次裁剪回归在Apply异步提交前读取状态，出现HDR旧manifest预期。分别补齐关闭和等待revision后重跑。第三次在旧interaction组最终截图超时，未将该次执行计为PASS；测试改为按URL排除render隐藏窗口、绑定并show/focus可见主窗口并保存失败报告后单独重跑。正式阶段runner支持验证并复用已通过且未受改动影响的子报告，仅重新执行失败/未执行组，报告明确reusedPassedReport，三次原始失败目录全部保留于 `artifacts/alpha21-development-before-preview-layering/`。首轮开发/安装包20组全PASS后，最终截图人工复核发现SDR小预览遮住角点，改为预览z7/几何z8；增加真实截图4个角点中心的白色像素断言，重新check、build、打包，再从头执行两种runtime全20组，而不是复用首次PASS。之前全PASS记录存于 `artifacts/alpha21-{development,packaged}-before-preview-layering/`，历史目录迁移规则见RELOCATION.json。

**另一次未归因的偶发异常**：最终安装包首次布局组在zh-CN/1050×720的13项检查后发现revision5→6，源PNG hash变化，截图显示80×60选区被清空。无renderer error，无截图fallback。该次没有保存最新Activity或控制键，所以不能据此判断是应用事件、测试输入时序还是其他输入，也不把它归为“仅测试脚本问题”或宣称已经修复。失败截图与报告保留在 `artifacts/alpha21-packaged-layout-first-failure/`，首次失败的阶段摘要在 `artifacts/alpha21-packaged-high-depth-first-failure-acceptance.json`。新增逐面板revision/manifest/source hash核对、最新Activity及Enter/Tab/Backspace/Delete/Escape的目标元素记录，不记录文本内容；专项复跑均未复现，控制键只有输入框Enter/Tab。该异常仍需持续定位；最终统一PASS指后续实际重新执行的门禁，不抹去此前失败。

## 交付与后续

本批修改未提交或推送Git。更广的112族功能/效果清单同步至仓库与PS根目录：[完整目录](PHOTOSHOP_FUNCTION_EFFECT_CATALOG_2026-10-12.md)。后续首先继续校正透视的默认尺寸和重采样像素差，再扩展真实自由笔势、数位板压力与复杂变换蒙版；不以当前有限参考代替全部 Photoshop 能力。

操作依据：[Adobe 拉直](https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/straighten-tilted-photos.html)、[Adobe 透视裁剪](https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/transform-perspective-while-cropping.html)。这里“自动拉直”指沿参考线自动计算角度及裁剪；没有宣称无参考线智能检测地平线或自动拆分多张扫描照片。
