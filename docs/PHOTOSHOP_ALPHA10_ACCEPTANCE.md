# alpha.10：PSD 导入修复与复杂边缘第一批验收

日期：2026-10-10。版本：`0.3.0-alpha.10`。用户指定顺序为常用功能统一验收、复杂发丝与 PSD、HDR评估、网页编辑器借鉴。本批承接已经验收的 alpha.9 常用功能，交付实际 PSD 修复，并启动独立边缘原型。没有宣布完成 Photoshop 全部能力。

## 1. 本批实际产品变化

- PSD RGB8/16 Raw/RLE 在像素解码前校验实际消费的颜色/蒙版通道，确证的坏包明确拒绝；原工程与输入文件保持不变。ZIP仍由固定库处理，不扩大校验声明。
- 独立Adobe字节夹具复现并修复 RGB16 RLE 的错误解码，同像素Raw/RLE现在得到相同的straight RGBA8。合法奇数宽度Raw行padding也正确处理。PSD/PSB行表宽度、NOP、mask尺寸、预算及原子失败有回归。
- 正规化只用临时解析节点；扩展字节不写回原文件/描述符，转PNG后释放节点临时通道。512MiB节点暂存预算与现有文档预算共同限制分配。
- 16bit导入仍量化为8bit，导入前报告与画布警告明确说明；不支持16bit无损编辑/PSD输出，也不是HDR。
- alpha.9的Quick Mask、局部选择画笔、命名灰度选区、蒙版密度/羽化及裁剪修复继续保留，详见 [历史验收](PHOTOSHOP_COMMON_ALPHA9_ACCEPTANCE.md)。

核心补丁：`src/core/photoshop-channel-validation.ts`、`src/core/photoshop-io.ts`。实际导入验收脚本：`scripts/smoke-photoshop-channel-import.ts`，通过真实主进程/worker/界面调用，仅stub原生文件选择器，隔离profile；不修改用户原图或剪贴板。

## 2. 复杂边缘及语料状态

C1已实施独立前景/背景/未知区trimap核心、ROI、输入保护、资源预算和取消检查点；13项安全/质量测试通过。4类限定合成边缘的unknown区alpha MAE为0.000802—0.002108，另有3类明确失败案例。最新一次1MP本机独立基准约355ms；这只是一次测量，不是产品交互性能保证。

该核心尚未进入UI、共享编辑动作或MCP，尚无自然图30份、RGB去色边或Photoshop参考。原RGB保持，所以在黑/白背景仍可能有色污染。详情见 [C1原型报告](TRIMAP_MATTE_C1_PROTOTYPE.md)。

C2已建立独立文件来源记录、原通道检查和分阶段runner。4份Apple ImageIO自制文件在本机工具版本下产生非法layer PackBits，现正确拒绝；它们是授权异常输入，不计入有效复杂语料。有效独立复杂文件和Photoshop作者文件仍为0，24项结构组合是后续目标，不是本批完成数量。`--strict`仍返回2，说明复杂外部兼容门槛未满足。独立手写规范夹具与同库生成往返分别记录，见 [C2来源/修复/24项计划](PHOTOSHOP_CORPUS_C2_2026-10-10.md)。

## 3. 集中检查与实际包

| 范围 | 结果 | 本地证据 |
| --- | --- | --- |
| 全量检查 | i18n / typecheck /617项测试/生产build通过；最后源改动后再次617项及typecheck通过 | `artifacts/alpha10-check.log`、`alpha10-final-tests.log`、`alpha10-final-typecheck.log`、`alpha10-final-i18n.log`、`alpha10-final-build.log` |
| 新PSD导入桌面 | 4项通过，页面错误0：拒绝坏包、取消保留工程、失败后正常导入且像素正确、编辑/Undo及源hash不变 | `artifacts/photoshop-channel-import/checks.json` |
| alpha.10最终10组桌面回归 | 10/10脚本，共70项检查；native15/15，页面错误0，冻结out哈希一致 | `artifacts/photoshop-alpha10-final-regression/acceptance.json` |
| alpha.10实际包常用流程 | 12项通过，含20轮Quick Mask取消/切换/绘制/Undo，页面错误0 | `artifacts/alpha10-packaged-common/checks.json` |
| alpha.10实际包Photoshop操作配置 | 13项通过，含快捷键、旋转视图绘制/选区/裁剪、合并/盖印，页面错误0 | `artifacts/alpha10-packaged-workflow/checks.json` |
| alpha.10实际包PSD导入 | 4项通过，页面错误0，真实导入worker与正确像素/取消/Undo | `artifacts/alpha10-packaged-channel-import/checks.json` |
| alpha.10实际包MCP | 5项通过：真实stdio、12工具/协议v2/PNG、task生命周期、灰度选区及非破坏蒙版属性 | `artifacts/alpha10-packaged-mcp.log` |
| 发布完整性 | 目录包版本、16个运行文件、模型/图标及28份许可证逐字节核对通过；当前源码快照已记录 | `artifacts/alpha10-release-integrity.log` |

macOS ARM64目录包：`release/0.3.0-alpha.10/mac-arm64/Compositor Electron.app`。alpha.9历史包保留。目录包未签名；没有执行Windows实机验收，也没有Photoshop本体同图输出验收。包内字节完整性与实际桌面执行是两种证据，分别记录。

## 4. 后续开发顺序

按 [详细路线](PHOTOSHOP_WEB_HDR_ROADMAP_2026-10-10.md) 执行：C1接约束画笔、预览和输出动作，建立自然图质量门槛；C2继续独立有效复杂文件与真实重算，C3逐步实现Alpha通道/矢量/文字和源对象/实例/滤镜栈；H0建立真实浮点原型，再决定HDR源、SDR预览、HDR显示链；W1—W3加入情境操作、笔刷预设/设备交互、本地版本与信息面板。

HDR可行性已经按源码核验，当前仍是RGBA8/sRGB主链路，不能通过枚举或增加按钮来交付。图像生成服务与现有聊天兼容API分开检测能力。研究和计划已完成并开始实施首批，尚未把后续菜单或未来功能计入现有支持范围。
