# 上游 1.5.2 / 43d691b 增量与 Photoshop 兼容审计

核查日期：2026-10-14。原同步基线 `e8c9e29701528413cc0e608d61187c1c61790add`，通过实时 `git ls-remote` 与独立克隆核实 main 为 `43d691b67995e924965bcd520f8b300f96b7d5b8`。上游仓库为 [robbietilton/Compositor](https://github.com/robbietilton/Compositor)。直连遇到 DNS 失败后，仅在本次 Git 命令中使用系统已经配置的本地代理，没有更改系统网络设置。

源码存放在 `/Users/zhoujin/Documents/PS/Compositor_Upstream/git-review-alpha27`，独立 detached HEAD 固定该 SHA，300 个源码文件的 SHA256/字节数记录在相邻的 `43d691b-source-provenance.json`。原 `/Users/zhoujin/Documents/PS/Compositor` 工作树未 checkout、reset、fetch 或修改；历史 Electron 脏工作区保留。

## 真实提交范围

4 个提交、11 个变化文件，392 行新增、34 行删除。上游 Swift/AppKit 与本项目 TypeScript/Vue/Electron 不同，按行为移植，不做无意义的文件级 Git merge。

| 提交 | 实际变化 | 当前项目差异 | Photoshop 判断与处理 |
|---|---|---|---|
| [735c2cc](https://github.com/robbietilton/Compositor/commit/735c2cc23c0efe7c2c2f85a66741b253e053cf2b) | Camera Raw Shadows 区域自适应，独立空间 pass；CRS2 拟合资源；前后调色阶段拆分；原生测试 | 旧实现使用整个图像亮度统计选择 `236` 开始的色彩 LUT，无法区分同一颜色在不同图像区域的效果 | 无快捷键冲突，方向与 Photoshop Shadows 相同；移植空间 pass、阶段顺序和层原尺寸分组，并保留精度/效果限制 |
| [a3a0e29](https://github.com/robbietilton/Compositor/commit/a3a0e290168977c568d6f0afb57b666f1d006fec) | RAW 导入面板新增 Camera Raw…，导入完成后选择实际新图层并打开滤镜 | 原面板仅 Import image，没有完成后打开 Camera Raw 的 intent | 不覆盖现有 Enter 导入、Esc 取消；移植额外按钮和异步完成后定位，不能仅按钮点击时直接打开滤镜 |
| [f2d5754](https://github.com/robbietilton/Compositor/commit/f2d575424ce81e7838f28d53b31267214e499de0) | Xcode 版本 1.5.2 / build 48 | Electron 使用独立 alpha 版本和发布流程 | 不复制原版 bundle ID、签名、Apple 部署目标和 Swift 版本号 |
| [43d691b](https://github.com/robbietilton/Compositor/commit/43d691b67995e924965bcd520f8b300f96b7d5b8) | Sparkle 更新 feed / 1.5.2 发布说明 | Electron 发布流程不同 | 不复制原版 DMG、Sparkle 签名和更新 URL；发布说明提及的旧快捷键/分组重置不能算作本次新 delta |

提交时间均在2026-10-13美西下午，对应2026-10-14北京时间。判断使用 Git 提交图，而非按作者日期或网页缓存筛选。

## 精确文件差异

| 原生文件 | 增 / 删 | 行为 |
|---|---:|---|
| `Compositor/Document/CameraRaw.swift` | 12 / 2 | 227–247 行：曝光等 before stages，Shadows pass，after stages，再折叠其余颜色处理 |
| `Compositor/Document/CameraRawShadows.swift` | 72 / 0 | CRS2 读取、amount 插值、1020 原层长边尺寸分组 |
| `Compositor/Document/CameraRawTables.swift` | 24 / 6 | 移除旧 Shadows LUT 236，增加前后阶段切分 |
| `Compositor/Rendering/AdjustPixels.c` | 165 / 0 | 519–679 行：边缘缩小 box mean、log2 luminance guided field、纹理参考亮度和局部 lift/gain |
| `Compositor/Rendering/AdjustPixels.h` | 4 / 0 | 新 C pass 签名 |
| `Compositor/Resources/CameraRawShadows.bin` | 新增 25254 字节 | CRS2 两组、五 amount、35 x columns、6 K rows、3 terms |
| `CompositorTests/CameraRawTests.swift` | 73 / 0 | 自制纹理景观对 Photoshop 的 sky/ground 均值参考；仍为有限样本效果预算 |
| `Compositor/Document/EditorSession.swift` | 14 / 1 | 609 行接受 intent，885–887 保存实际新图层 ID，928–933 导入完成后选择/打开 |
| `Compositor/UI/RawDevelopSheet.swift` | 3 / 0 | 67 行新增按钮，原默认 Import 和 Cancel 快捷键保持 |
| `Compositor.xcodeproj/project.pbxproj` | 12 / 12 | 原版版本号更新 |
| `appcast.xml` | 13 / 13 | 原版更新 feed |

## Shadows 实施与证据边界

`camera-raw-shadows-data.ts` 保留上游 CRS2 原字节，SHA256 为 `76578539bc45a32817aff669c4e41523d7040f3c691ad35adf0723a70a89a705`。格式为 `CRS2`，2 sets / 5 amounts / 35 columns / 6 rows / 3 terms；amounts 是 -100、-50、25、50、100，零 amount 使用全零系数。normalFrom=1020，xLow=-14、xStep=0.5、kLow=-11、kStep=2。解析严格验证尺寸、完整字节数、有限值、正步长和有序 amount，不静默忽略损坏资源。

`camera-raw-shadows.ts` 使用原生32-band的参考亮度累加顺序，仅用有纹理的像素，全部平坦时使用全部有效像素；透明像素不进入亮度统计。小副本的边缘 box mean 窗口缩小，不使用旧 effects 的重复边缘核。短边按384整数下采样，guided variance epsilon=1.5，保留 C Float32 平面赋值。局部明暗和细节增益由原始系数插值，保持颜色比例及 alpha，不做按文件名、照片类别、fixture 或工具名称选择效果。

`camera-raw-adaptive.ts` 将 Shadows 从颜色表中移除，before 包含 Calibration、Exposure、White Balance、Contrast、Highlights；after 包含 Whites、Blacks、Saturation、Vibrance、Parametric Curve；其余曲线和 Mixer/Grading 继续使用已有路径。Shadows=0 时保留旧非空间流程。`image-filters.ts` 将已有运行时 samplingScale 传入，并给独立 preview 增加严格的瞬时 samplingScale，不能写进持久化滤镜 schema。当前正式 worker preview 本来按原始 source 全尺寸计算，scale=1，不需要修改该 worker。

原生 C 仅处理 RGBA8，本项目仍通过既有 ten-probe 架构重建 RGB16，并对 HDR 使用既有 normalization/restoration；保留 Uint16/Float32 数据和扩展值，不把原图 flatten 成一个 PNG8。此架构既有 alpha probe 量化和颜色重建限制仍在，不能称独立浮点 Camera Raw 或原生高位深效果等价。

新的工作区估算包含源/输出与低分辨率平面，超过512MiB时明确拒绝。没有把大图分组错误地按缩小 preview 的显示尺寸选择。

### 原生 C 对照与保留的冲突

`scripts/capture-camera-raw-shadows-alpha27.py` 在固定新源码上实际编译并调用 `AdjustPixels.c`，只写新的 alpha.27 reference。原始 `tests/fixtures/camera-raw-upstream.json` 保持不变；其中7项旧 Shadows 同输入的新 C 输出保存为 `legacyCaseReplacements`，测试继续保持最大误差≤1，不用旧算法的结果验收新空间算法。

最终22个探针及7项同输入 pipeline 新参考均通过最大误差≤1；包含正负 amount 插值、两套原层尺寸系数、半透明、不透明、全透明、纯黑、平坦颜色及窄长图。20个较小探针RGBA逐字节一致；另2个1200×800、真实短边≥768的大尺寸副本分别仅1、2个RGB通道差1（各288万RGB通道），alpha全部一致。三个固定灰阶pipeline参考与C逐字节一致。测量在 `artifacts/alpha27-camera-raw-shadows/comparison.json`，低分辨率平面的处理和全尺寸输出验证均包含在内。这里是移植到原生 C 的证据，不等于直接与 Photoshop 像素对照。

Camera Raw新/旧reference、分组重置、源统计缓存、深位ten-probe及高位深滤镜回归的早期159项通过。采样循环移除每个像素的closure/临时terms数组后，重新验证原生输出，结果保持；不把该局部清理声称为应用整体速度提升。最终专项包含下面的新组合契约与原image-filters回归，**181/181通过，0失败、0跳过**；全项目typecheck最终通过。中间一次并行透视测量脚本候选名称TS2367已由其所有者修复并重新验证，没有更改Shadows解决该错误。日志为 `artifacts/alpha27-camera-raw-shadows/final-targeted-tests.log`，typecheck日志为同目录 `typecheck.log`。这些专项证据不等于应用包或独立Photoshop效果验收。

第一轮104项定向测试中103通过，旧 gray-ramp 混合参数严格单调测试发现 **Shadows80 + Highlights-90 在8处反降1级**。确切同输入新原生 C 同样在86、99、105、114、125、133、153、162位置产生相同反降，已在新 fixture 的 `pipelineCases.nativeFalls` 原样保留。这里的旧要求来自组合为一张scalar颜色表的实现；改为 byte-quantized Highlights 后接区域 Shadows 空间pass，已不再是同一个scalar曲线契约。反降可由真实上游C复算，不是移植误差，也不能写成“Photoshop同样如此”。

主流程在本机再次用Shift+Cmd+A、完整Filter菜单和已安装Photoshop/Adobe共享插件目录检查，没有找到可用Camera Raw入口或插件，因此本批无法取得此组合的独立Photoshop效果参考。经明确授权，保留最新上游空间算法，生产代码不加入灰阶、图片名、fixture或特定参数组合的回退分支。测试保留原Shadows+100、Highlights-100及black/white组的严格单调，并增加Shadows-100；旧复合80/-90案例移到新上游C **全RGBA exact** 参考，并显式要求上述8个位置恰好下降1级、alpha完全一致、源数据不变。原生C其余最大误差≤1门槛和其他既有真实PS门槛没有放宽，失败历史与原fixture保留。这是透明变更旧scalar测试契约，不是通过扩大容差隐藏残差。

这项组合的1级量化反降仍是效果限制，当前只能声明upstream C移植一致。独立Photoshop Camera Raw效果未验，不能称完整Photoshop兼容或所有图片效果完全相同。

额外扩展检查也观察到既有Highlights+100路径在灰阶241处反降1级；该参数不在旧单调测试原范围，Shadows=0时算法路径未变，属于后续LUT/调色审计事项。本批没有扩展生产修复范围或用容差掩盖它。该次扩展失败记录另存 `final-targeted-tests-before-scope-correction.log`；最终保留原参数严格约束，不把额外发现混成新Shadows移植失败。

上游宣称约260张照片拟合和约30%更接近 Photoshop，属于上游说明；本地尚未验证这个整体比例。对小图/自然纹理/HDR的效果不能外推。

## RAW 接入的异步要求

当前 `foreignConfirm` 立即返回 `decoding`，不是图层已导入。新增 Camera Raw intent 应存放在实际 import job，Cancel/fail清除；等待导入实际返回 state，持有该 sessionId、activeLayerID及 revision。在UI安装结果并确认新图层仍存在后再打开 Camera Raw，避免多文件、新画布、用户切换文档时把滤镜打开到错误图层。普通 Import 和 Enter默认行为保持。当前 Electron RAW 仍来自 LibRaw 8位结果，不能通过新增按钮声称完成上游 RAW 16位解码保真。

## 复算和来源

```sh
python3 scripts/capture-camera-raw-shadows-alpha27.py /Users/zhoujin/Documents/PS/Compositor_Upstream/git-review-alpha27
npx tsx scripts/measure-camera-raw-shadows-alpha27.ts
npx tsx --test tests/camera-raw-shadows-alpha27.test.ts tests/camera-raw-upstream.test.ts tests/image-filters.test.ts
```

Compositor MIT许可已保存在 `licenses/Compositor-MIT.txt`，现有 `THIRD_PARTY_NOTICES.md` 已涵盖其 portable pixel algorithms。新增系数仍来自同一 MIT 仓库，需要补充新算法 SHA/资源来源说明，不能覆盖旧版本来源或声称捆绑原Swift应用。应用/安装包/Windows/原生HDR显示验收由主流程独立完成，本子任务没有并行操作GUI，没有commit或push。


## 整图转换前的工作预算补核（2026-10-14）

只读复核发现直通RGBA8 wrapper先分配并遍历整图预乘副本，随后才进入premultiplied Shadows函数检查512 MiB。已经将同一预算提取为pure assertCameraRawShadowsBudget，两个入口在转换或空间工作数组分配前调用：估算仍为16×全尺寸像素+28×低分辨率cells+4,000,000字节，未改算法、系数、分支尺度、颜色/alpha输出或原生精度门槛。amount0的wrapper仍返回原对象，不增加无操作费用。

新增tests/camera-raw-shadows-budget-alpha27.test.ts的2项保护。数学边界直接检查超限而不分配大数组；metadata-only surface只允许validation读取一次length，第二次读取立即抛出allocation sentinel，证明超预算输入在整图Uint8Array转换前得到RESOURCE_LIMIT。零Shadows另验证不进入转换路径。该metadata工具只用于验证失败路径，不能冒充有效图像颜色/原生效果证据。

Shadows自身原生/深位/流水线30项+2新增共32/32通过，日志artifacts/alpha27/shadows-budget-directed.log；全局vue-tsc退出0，日志artifacts/alpha27/shadows-budget-typecheck.log为空。随后此前已启动的较广207项回归也通过（artifacts/alpha27/shadows-budget-extended.log），未据此替代全项目或实际包验收。生产source冻结SHA为0e66aeb5a4426860279623b5113583c48ec84786c6dcb5e4527db8c82d7a90cb（src/shared/camera-raw-shadows.ts）；资源data和像素模型不变，主流程将重新check/build/dev/package。
