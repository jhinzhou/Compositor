# alpha.23：选择、修复、透视裁剪和 Info 工具验收

版本0.3.0-alpha.23；本机macOS ARM64、Photoshop27.11.0。日期2026-10-13。此文的源码、实际开发版、实际目录包、原生PS效果和平台硬件结论分开记录。统一验收已完成：源码1828项测试、开发版25套324项、实际未签名macOS ARM64目录包25套324项全部通过。此结论限于本批功能与明确支持范围，不表示全部Photoshop效果等效。

## 本批实现

- 修复自由套索闭合路径零bounds以及不足三点就发布无效polygon的问题；Shift/Alt路径覆盖保留正确加减。
- 现有采样修复新增Photoshop操作配置分支：冻结原始供体、预乘双线性透明软边、边界亮度/颜色融合、一次覆盖；默认旧API不传healingModel仍走Compositor旧核。Opacity0保持原始PNG/placement，alpha锁保留透明隐藏RGB。
- 新增磁性套索：未按鼠标的移动也跟随边缘、自动/手动锚点、宽度/对比/频率、Enter完成、Backspace回退、Escape取消、自交路径支持及异步旧回复隔离。频率允许0–100；[ ]调宽度。
- 新增快速选择：笔划训练多种子前景色模型，连通增长止于颜色/透明边界；加减、All Layers、抗锯齿/羽化、一笔一次Undo；[ ]调笔径。
- 新增RGB8当前层Patch Source/Destination：选区内拖到供体或目标，实际融合预览、Alpha保护、一次像素和选区事务；Shift/Alt从选区内起笔仍绘制加减选区。
- 新增Info颜色取样器：十个编号点、1–101取样窗口、原始或真实合成8/16/HDR读数、移动/Alt删除、源数据不改写；样点不拦截Ruler绘制。标尺含两点/端点/整线、Shift45°、Alt第二臂、单位和DPI，向右下的角度显示为负。
- 持久采样/标尺随画布尺寸、非破坏裁剪、图像重采样、翻转/旋转、自动拉直、透视变换；Metadata独立变动保留Reselect缓存。Undo/Redo与保存重开恢复完整源与点位。
- 透视裁剪四点逐次输入、前三点Enter拒绝、无效第四点重试、Shift轴约束、取消/失焦清理；RGBA8/UNORM16/Float32分别保留工作精度。没有以8位屏幕缩略图提交重采样。
- L4/W3/J3/I3分组和Shift字母轮换，裸字母/组按钮恢复最后子工具；Window→Info/F8；新增中英文译文、Info独立工具栏与分开的hit区域。
- 原生BrowserWindow失焦通过真实editor:action桥接取消画布、磁性和Info交互。实测原生blur可发生而DOMblur为0、document.hasFocus仍true，不能只依赖DOM监听。RPC只读preview错误先通过ticket/identity判定，不让旧回复先弹全局错误；真实apply/interaction错误保持可见。

## 门槛与证据

源码：check:i18n、vue-tsc、完整tests、bundle build；真实Editor几何15项、自由套索5项、原生focus路由回归在全测试内。新工具桌面检查使用独立自制图片和隔离profile，只有原生Open/Save选择路径采用替身；真实鼠标/键盘、公共state、实际资源URL、原始PNG16/EXR值与截图为依据，没有改Vue refs或派发假的pointer/blur。

开发版与实际目录包各跑同一25套门禁。每套保存checks/errors、首次失败、源hash或数值和截图；运行前/每套后比较整个out runtime SHA防止中途换代码。当前源码门禁通过：1828/1828测试，40个Vue组件、2136条消息、759个字面量调用的国际化检查零问题，类型检查与构建通过。开发版25套/324项通过，各套errors为空、截图替代次数为0，包含52项布局检查。开发版运行时SHA256为`414a6d3dcf99823060939d4fbd3023019fd624d315bf3daed78452eca87ec351`。证据：[开发版汇总](../artifacts/alpha23-development-validated/acceptance.json)、[源码门禁日志](../artifacts/alpha23-check-final-4.log)。实际未签名macOS ARM64目录包25套/324项也全部通过，同样无errors、无截图替代，包含52项布局检查；与开发版使用同一运行时SHA256。[目录包汇总](../artifacts/alpha23-packaged-validated/acceptance.json)。

## 原生 Photoshop 对照

自建512×320纹理圆形图，在本机PS用30px Quick Selection实际拖动，源与真正灰度选区存入 `fixtures/parity/photoshop-27.11-tools-alpha23.json`。覆盖面积两边15361px，weighted coverage IoU98.459767%，全图coverage MAE0.371094/255，1112个边界像素覆盖不同。不是逐像素等效，也不能将这一诊断圆形推广到自然照片/发丝。最初直接存活跃alpha通道的PNG其实仍为RGB文档图，已排除，未拿它作为选区参考。

原生Ruler实际读数：start50/49、delta120/70、angle−30.3°、length138.92px；本项目角度符号修复后计算一致。PS持久点原生读数约41.0039/155.9961/70，与同位置原始byte整数41/156/70的显示取整一致；复杂透明/颜色管理平均仍未做PS等价证明。

透视采样研究80种候选、两个输出尺寸仍只有一个四角几何族；当前Mitchell固定348×223 MAE4.486470/max237，PS自动387×257与项目建议尺寸仍不同。模糊B-spline或固定(+.5,−.5)可降低这个族的均值，却没有独立几何证据，未换生产核/硬编码偏移。研究详见 [透视采样报告](PHOTOSHOP_PERSPECTIVE_SAMPLING_ALPHA23_2026-10-13.md)。

采样修复/Patch已验证融合和生命周期，尚无自然照片PS私有修复核逐像素等效门槛。PS原生Remove工具提示其必需组件未就绪，这不构成本项目修补完成的证据，也没有把Remove当作已实现。

## 保留的失败记录

- Info首跑从20/20命中20/24的sample marker：产品hit冲突，按当前工具拆开后复测。
- Patch首跑闭合路径首末相同导致0×0bounds以及points undefined：产品自由套索错误，按全部点范围及未成形保护修复；原first-failure.json/png保留。
- Info焦点采集有两次harness序列化/字符串未调用错误；旧运行的16/HDR记录只是fixture，未据此声称通过。脚本修后观测到原生blur无DOMblur，增加实际native bridge后再验证。
- 一次选择门禁16个功能检查通过但末尾出现expected0/actual1的revision toast；那次缺少逐步错误trace，尚不能证明唯一触发原因。新增逐步首次toast取证与只读错误隔离，后续实际运行必须无toast。原失败不覆盖、不以更宽assert消除。

## 状态与限制

侧栏截图22个子工具当前8基础可用、7部分、7缺少；五项本批新增的实际实现仍有高级选项和私有算法差距。112能力族当前14基础、67部分、31缺少：仅C052因真正Patch链从缺少变为部分；未宣称整个族完成。剩余7个侧栏缺项为切片、切片选择、移除、内容感知移动、红眼、注释、计数。

Patch/新采样修复目前RGB8当前栅格层、4MP和120M工作预算；Content-Aware/Pattern/Diffusion/高级Structure/Color、16/HDR修补尚缺。快速/磁性分析最多16MP且有输入、路径与工作预算。Info当前层忽略opacity/mask/effects、合成不支持的栈明确失败；16位读数是0–65535，不能直接当作PS0–32768单位。CMYK/Lab通道、测量比例/日志、Histogram/Count仍未齐。

本机目录包与源码通过不代表Windows真机、HDR显示硬件、自然发丝或任意外部复杂PSD兼容。发布/完整性、根目录计划与当前状态另见对应JSON和文件。

## 交付与复现

| 门禁 | 最终结果 | 证据 |
|---|---|---|
| 国际化 / 类型检查 / 构建 | PASS，40 Vue组件、2136消息、759字面量调用、0问题 | [完整日志](../artifacts/alpha23-check-final-4.log) |
| 源码测试 | PASS 1828 / 1828，0失败/取消/跳过 | 同上 |
| 真实开发版 | PASS 25套 / 324项，含52布局项，0错误/截图替代 | [开发版JSON](../artifacts/alpha23-development-validated/acceptance.json) |
| 真实macOS ARM64目录包 | PASS 同25套 / 324项，含52布局项，0错误/截图替代 | [目录包JSON](../artifacts/alpha23-packaged-validated/acceptance.json) |
| 包内容 / ZIP | 核对当前16个runtime文件、模型、图标、28个许可证文件与ZIP SHA256 | [完整性JSON](../artifacts/release-integrity.json)、[SOURCE_MANIFEST](../release/0.3.0-alpha.23/SOURCE_MANIFEST.json) |

原下载Electron运行时步骤停滞，保留`artifacts/alpha23-package-mac.log`，随后使用本机开发验收同版本Electron44.7.0的unpacked dist成功构建。没有改变产品依赖版本；实际构建日志为[本地运行时构建](../artifacts/alpha23-package-local-mac.log)。未配置Developer ID签名和公证，未做Windows真机验收。

新版应用：[Compositor Electron.app](../release/0.3.0-alpha.23/mac-arm64/Compositor%20Electron.app)。ZIP：[mac-arm64 alpha.23](../release/0.3.0-alpha.23/Compositor-Electron-0.3.0-alpha.23-mac-arm64.zip)。升级使用先保存旧实例工程并退出，再打开该版本路径，避免macOS继续复用旧实例。

ZIP SHA256：`d79a0c27392d414ab8746bdcb0341e43bfd19275bd532fbf26a5ab8e2305c561`。完整统一记录：[alpha23-unified-acceptance.json](../artifacts/alpha23-unified-acceptance.json)。

源码门禁使用`npm run check`；运行时使用`npx tsx scripts/check-alpha23-runtime.ts artifacts/alpha23-runtime`，目录包模式设置`COMPOSITOR_EXECUTABLE`为上述应用的`Contents/MacOS/Compositor Electron`。运行真实桌面套件时不要并发操作Photoshop，以免产生焦点竞争。工具使用入口为侧栏右键/长按或Shift-F10；L/W/J/I与Shift+对应字母分别恢复/轮换已实现子工具。

根目录清单：[侧栏22工具](/Users/zhoujin/Documents/PS/PHOTOSHOP_TOOL_GROUPS_2026-10-13.md)、[执行计划](/Users/zhoujin/Documents/PS/PHOTOSHOP_ALIGNMENT_PLAN_2026-10-13.md)、[112类能力和效果清单](/Users/zhoujin/Documents/PS/PHOTOSHOP_FUNCTION_EFFECT_CATALOG_2026-10-12.md)。保留本批开始前的root文档备份与哈希，不覆盖原有代码改动；本批未创建Git提交或推送。
