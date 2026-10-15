# Alpha.23 颜色取样器与标尺工具

## 对照来源和交互

依据 Adobe 官方[像素颜色读数说明](https://helpx.adobe.com/photoshop/desktop/adjust-color/selective-color-adjustments/view-pixel-color-values-in-an-image.html)和[标尺工具说明](https://helpx.adobe.com/photoshop/desktop/use-grids-measurement-guides/measure-scale/measure-and-position-with-the-ruler-tool.html)：取样器记录点位并随图像编辑更新读数；标尺绘制非打印线，显示位置、距离和角度，Shift 将方向约束到 45° 步进。取样器与吸管同组，标尺也在 I 组；根组件接入快捷键轮换、拖动、Alt 删除点和量角臂。

这一实现提供受控组件和真实数据链，未操作本机 Photoshop，也未声称通过 Photoshop 原生逐像素等价验收。原生操作和应用 UI 接入由统一验收负责。

## 数据与持久化

`manifest.documentInfo` 是单个可验证元数据对象，含最多十个唯一编号取样点、取样窗口大小、来源、单位和可选标尺。点坐标是文档像素坐标，与视图缩放、平移、旋转无关。默认全图合成、单点和像素单位。编号删除后可复用，不自动重排已有编号。

标尺由 `start/end` 组成，可选 `third` 增加从同一 `start` 出发的第二量角臂。读数包括 X/Y、带方向 W/H、长度、按 Photoshop 显示习惯的角度（向右下为负，向右上为正）；第二臂显示长度及 0–180° 夹角。mm/cm/in 根据工程 DPI 换算，不根据屏幕缩放或显示器 DPI。零长度角度定义为 0。

`mapDocumentInfoPoints(info,map)` 对裁剪平移、尺寸缩放、翻转和旋转使用同一文档几何映射，以免点位与图像漂移。由根组件在相应 Editor 事务内调用。移出画布的历史点允许保留，取样越出源时显示范围外。

`editDocumentInfo` 返回新 manifest；revision、Undo/Redo、原子事务与 IPC 接入由 Editor 负责。项目实际保存重开已验证元数据和取样读数保持。

## 真实取样定义与精度

- 当前图层：读取原始 PNG8、UNORM16 或 Float32 HDR 数据，绝不读取 `displayBytes`。按文档 NxN 像素窗口逐点反变换到该图层源图，使用最近邻读原始源像素；窗口随图层旋转/缩放变化。读数不包含图层不透明度、蒙版、图层效果或其他图层。该语义在面板明确标注。
- 合成：一次调用现有有界高位合成器，再读取真实合成样本，包含合成器支持的变换、蒙版、透明度、混合和调整。普通源使用 UNORM16 合成，HDR 使用 Float32；源全为 8 位时 `sourcePrecision=uint8` 与 `reading.precision=uint16` 分开报告，面板标明“8 位源 · 16 位合成”，不冒称源文件有 16 位信息。
- 窗口：1、3、5、11、31、51、101；文档边缘/源图范围内实际像素参与平均，范围外不补显示底色。直通颜色按 alpha 加权，alpha 是参与像素的均值，完全透明点颜色为 0 并标注透明。该透明平均政策尚未做 Photoshop 私有内核等价测量。
- 精度：8 位颜色按 0–255，完整 UNORM16 按 0–65535，HDR 为不裁切的扩展 sRGB Float32，负值及超过 1 的值保持。Photoshop 面板常显示的 0–32768 16 位数值并非此工程的全范围单位，不能直接误比。
- 不支持的合成外观（如尚未具备高位合成的可见图层效果、矢量蒙版）或预算超限会明确失败。不存在悄悄回退到屏幕 PNG 再伪报原精度。当前层可独立读取这些源图，语义限于原始 raster。

## 组件契约

`InfoToolsOverlay.vue`：`info,width,height,zoom,interactive?,sampleInteractive?,rulerInteractive?,rulerDraft?`；向父组件发 `sample-down(PointerEvent,id)`、`ruler-down(PointerEvent,'start'|'end'|'third'|'line')`、`move/up/cancel`。所有事务、指针捕获、视图坐标变换及取消恢复都由父组件管理。Overlay 不自己修改工程。

`InfoToolsPanel.vue`：`info,readings?,resolution,disabled?,error?,loading?`；发 `change(info)`、`remove-sample(id)`、`clear-samples`、`clear-ruler`。中英文标签集中于本组件的 `info-tools-labels.ts`，没有并发修改应用全局目录。

## 验证

`tests/document-info-alpha23.test.ts` 覆盖无效 schema/唯一编号、有符号单位与夹角、全部 Shift 方向步进、点位几何迁移、PNG8 真源、全 16 位非 257 整倍数读数、透明窗口平均、2× 缩放、翻转、90° 旋转、独立 source-over 算术、HDR 负值和超白、合成拒绝无支持外观、真实 `.comp` 保存重开，以及 8 位来源和内部合成精度的区分。

当前组件尚不提供 Lab/CMYK/HSB 转换、独立每点颜色模式、测量日志或自定义测量标度，HDR 数值不等于 HDR 硬件显示验收。应用完整 GUI/Undo/快捷键验收另由 alpha.23 统一验收报告记录。

## 指针事务与过期请求

`renderer/use-info-tools.ts` 提供 `useInfoTools({state,selectedId,tool,canStart,point,identity,send})`。返回 `info/displayInfo/readings/loading/error/showPanel/active`、`startSample(event,id?)`、`startRuler(event,handle?)`、`move(event)`、`finish(cancel=false)`、`cancel()`、`change(info)`、`removeSample(id)`、`clearSamples()`、`clearRuler()` 和 `refresh()`。

`info` 为当前提交的元数据，面板使用；`displayInfo` 带当前拖动预览，Overlay 使用。开始时立即占本地 active、缓存文档身份与 revision；先申请 interaction lease，结束时只提交一次 document.info，再释放同一 lease。异步 lease 未返回前取消也会在它返回后释放。右键、非有限坐标、超出画布的新点不会申请 lease。丢失焦点、换工具/文档/revision、scope销毁取消预览，避免过期提交。`point` 必须由 App 返回文档坐标；本模块不猜测 CSS/屏幕矩形。

颜色点可拖出画布删除；标尺线完全移出画布时删除。两端点都在外部但线段仍穿过图像时保留（线段矩形裁剪判定），量角器任一臂触及图像也保留。Alt 从末端拉出量角臂时先交换基准端点，保留被拖端点为夹角顶点。

readonly 取样请求携带 session/revision/currentLayer，每次请求带本地 ticket，晚到的旧请求不会覆写新读数。拖动期间不将旧位置读数显示为新位置的取样结果。`tests/info-tools-gesture-alpha23.test.ts` 验证异步时序、窗口 blur 生命周期与受控手势（模拟 IPC 返回和 PointerEvent，不属于原生桌面 GUI 验收）。

### Overlapping tool hit regions (acceptance regression)

Color sample markers remain visible while Ruler is active but have no pointer hit area; ruler handles/line likewise pass through while Color Sampler is active. `sampleInteractive` and `rulerInteractive` independently control these regions and guarded event handlers. The composable also rejects mismatched tool entry calls; Shift Eyedropper may only create a new sample. The real Electron smoke intentionally starts a ruler at [20,20], four pixels from sample [20,24], and checks that the sample is unchanged while a ruler is created. Component-handler and lease tests verify the gates independently; these do not replace actual Electron hit-testing.

### 焦点验收的观测边界

真实 Electron smoke 在持有标尺指针之前确认原生窗口 `isFocused()` 与 renderer `document.hasFocus()` 均为 true。之后由真实第二窗口切换焦点，记录原生 blur 和 DOM blur；macOS 在鼠标按下时仍锁定焦点则实际最小化主窗并记录 `forcedMinimize`。只有确实发生焦点丢失后才检查取消、revision 和 lease。未派发合成 blur，也未调用业务 cancel 代替焦点交互。Electron 验收与 Photoshop 操作须串行，避免两个应用争抢焦点造成假失败。

原生实跑进一步发现，Electron 原生窗口可确实失焦（native blur=1、主窗 isFocused=false、另窗 isFocused=true），但 renderer 同时 DOM blur=0、document.hasFocus()=true。仅监听 DOM blur 会遗漏这类原生焦点丢失。因此由主进程 BrowserWindow blur 经真实 `editor:action/windowFocusLost` 和 preload `window.compositor.onAction` 通知 App，取消 Info 及其他画布交互。当前 smoke 保留 native/DOM 双侧观测，但不强求 DOM blur；必须观察真实 native blur、mainFocused=false、public preload windowFocusLost 次数大于零，再验证面板恢复、revision/元数据保持及保存不再 DOCUMENT_BUSY。没有派发合成 DOM 或 IPC 事件，后续统一报告记录实际桥接结果。
