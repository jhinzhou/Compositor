# Mixer Brush 基础功能与验证边界

日期：2026-10-14，Asia/Shanghai。状态：专有 shared/core 像素路径已实现，RGB8、原生 RGBA16 与 HDR Float32 工程验收通过。工具栏、worker、Editor 桥接由 toolbar 代理负责；最终 GUI/MCP/安装包验收由根代理负责。**本实现是明确标注的湿颜料近似模型，尚未恢复 Photoshop Mixer Brush 的专有像素内核，不能称像素等效。**

## 原生语义证据

[Adobe 官方 Mixer Brush 说明](https://helpx.adobe.com/photoshop/using/painting-mixer-brush.html)描述储存颜料和从画布取色的两个颜料池，以及 Wet、Load、Mix、Flow、清洁和重新载入。该文没有提供数值求解公式。此次采用这些交互语义实现独立、可使用的基础工具；消耗速率常数是本地模型选择，不是 Adobe 的公式。

根代理实际读取 Photoshop 的 `currentToolOptions`，确认真实工具标识为 `wetBrushTool`。原先试用的 `mixerBrushTool` 名称被拒绝。根代理记录位于 `/Users/zhoujin/Documents/REA/artifacts/toolbar-native/tool-options-verified-names.json`，包含 wetness、dryness、mix、flow、autoFill、autoClean、loadSolidColorOnly、sampleAllLayers、reservoirState 和完整笔尖选项。读到的是当时设置，**不能由此推断软件默认值，也不能推断私有扩散机制**。

额外只读原程序 ASCII `__cstring` 扫描找到了 `wetBrushTool` (`0x107a664b5`) 和 `saturationTool` (`0x107a6712f`)，在该节未找到 `mixerBrushTool`。完整有界扫描记录 `/Users/zhoujin/Documents/REA/artifacts/patch-current/mixer-ascii-candidates.json`。这是 shell 原字节证据，不是新 REA solver 反编译，也不是调用观察。

## 专有像素行为

`src/shared/mixer-brush.ts` 按固定弧长连续生成 dab。每个 dab 先从尚未写入本 dab 的画布取色，再更新显式颜料池，再向画布沉积混合颜料并消耗载入量；后续 dab 能读取此前 dab 的真实结果。它不是普通 Brush 的单色 coverage 换名。

- Wet 控制吸取画布颜料，Mix 控制取色与载入颜料的混合比例；Wet=0 的干画使用载入颜料。
- Load 决定可用载入量，逐 dab 消耗；Flow 控制每个 dab 的沉积强度。整个笔划的 opacity 最后应用一次。
- Average 使用实际笔尖覆盖范围的加权颜色，Tip 使用中心双线性取样。隐藏 RGB 不进入颜料池。
- Clean After Stroke 返回空池；Load After Stroke 返回按当前颜色和 Load 重新载入的池，两项同时启用时先清洁再载入。独立 clean/load helper 可供选项栏使用。
- Reservoir 是请求中显式传入的不可变快照，准备函数只返回新池。没有模块全局缓存、隐式文档副作用或预览时累计消耗。

储存路径直接读取源类型：RGB8 straight RGBA、UNORM16 premultiplied RGBA、Float32 premultiplied extended sRGB。RGBA16 不经过 8-bit 显示代理；HDR 的负值、超白高光和原始 Float32 精度保留。选区外 RGBA 保持原值，alpha 锁保留原 alpha 和隐藏 RGB；未锁 alpha 可以向透明区域沉积颜料。新建无 imageFile 空白图层也能通过自己的 Mixer action 实际绘制。

## core / Editor 约定

`prepareMixerBrush(stage,action,{signal,maximumWork})` 返回 PNG/深位预览、保留的 deep/hdr 数据、尺寸、transform、affectedPixels 和新 reservoir，完全不改输入 stage 或 reservoir。`applyMixerBrushOperation(stage,action,onPrepared)` 仅在实际像素变化时安装按真实类型编码的资产，成功后由 callback 把同一次准备结果的 reservoir 交给调用者。

Editor/worker 接入使用 `layer.mixer_brush`，成功提交通过 `EditResult.mixerReservoir` 返回新的工具状态；重试缓存应带同一 reservoir。预览可返回预测池供诊断，但取消或尚未提交时 UI 不安装它。源版本变化、锁、非法参数、预算和取消均拒绝，不生成部分历史。零强度操作保持原像素、selection 和已有 redo 历史。

## 验证

`tests/mixer-brush.test.ts` 共 9 项，已通过：真实 Wet/Mix/Flow/Load 像素差异、载入消耗和空池取色；Average/Tip 区分；clean/load；弧长结果不随 pointer event 分段改变；单 opacity、选区外/alpha/hidden RGB；Buffer 输入无别名写回；预算/取消与非法池拒绝；RGBA16 低字节精度和 HDR 负值高光；preview/commit 一致；原始深位 save/reopen；linked mask 成长；新空白图层；实际 Editor 在三种深度的 metadata、幂等重试、Undo/Redo、no-op redo 保护和 Save As 重开。

资源边界为 4 MP working raster、120 M work、50,000 dabs、10,000 points 和 512 MiB conservative working bytes。过大操作会明确报 RESOURCE_LIMIT；不静默降位深或通过显示代理编辑。输入/工作数组、filter visits 和行扫描均计预算，取消逐行检查。

当前不支持全图层 Mixer 取样、多颜色形状笔尖、真实 bristle/velocity/tilt 数值内核，也没有新独立 Photoshop Mixer stroke 像素参考。上述工程通过不替代这些效果门槛。
