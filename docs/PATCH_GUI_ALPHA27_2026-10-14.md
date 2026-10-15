# Photoshop 修补软选区 GUI 交叉验证（2026-10-14）

本项确认 Photoshop 27.11.0 **实际鼠标修补拖动**与封存的 Action Manager 修补输出一致。它补充 [软选区效果审计](PATCH_SOFT_DOMAIN_ALPHA27_2026-10-14.md) 的来源证据，不表示所有修补模式、Diffusion 值或图片内容已与 Photoshop 等效。

## 操作来源和验证边界

原生文档为 `alpha27-gui-owned-patch-feather2`，自有目标图层为 `alpha27-tools-owned`，源图 256×192。选择多边形顶点为 `[155,48] [193,66] [198,94] [163,106] [143,78]`，原生羽化 2 像素。**选区由原生脚本预建并保留，未声称选区绘制本身使用鼠标。** 之后根代理在 Photoshop 中用真实鼠标完成 Source Patch 拖动，偏移 `[-108,28]`。

实际事件记录 `artifacts/photoshop-native/outputs/crop-events-alpha27/crop-event-1791948347399.json` 的 `event` 为 `patchSelection`，历史为 `修补选区`，记录 `from.offset.horizontal=-108`、`vertical=28`、`patchMode=patchNormal`、`transparency=false`、`sampleAllLayers=false`、`healSmoothFactor=5`、`useSource=true`。这是实际操作事件，不是测试脚本推算的状态。`patchStructureAdapt=4` 和 `patchColorAdaptation=0` 为该事件原样值，不据此宣称本项目已有 Content-Aware Patch 参数映射。

## 物理文件和像素哈希

下面文件来自本机真实 Photoshop 会话，均未重写。PNG 文件编码不同，验证比较的是解码后的完整 RGBA：256×192×4 共 196608 字节，**全部逐字节一致**。

|证据|相对项目根目录路径|物理文件 SHA-256|
|---|---|---|
|真实鼠标拖动输出|`artifacts/photoshop-native/outputs/gui-alpha27/alpha27-gui-owned-patch-feather2.png`|`3a2604e4c14f5ad0d51ac0098f276724dea271b3debf8586821d0c5b44c7bfe9`|
|已封存 Action Manager 输出|`artifacts/photoshop-native/outputs/tools-alpha27-soft-domain-holdout/slanted-feather2-output.png`|`040b60e5ff44f6ec026427cf06c1c62fb0ec4c82fee7cf41ff4d8f3874267105`|
|真实鼠标操作事件 JSON|`artifacts/photoshop-native/outputs/crop-events-alpha27/crop-event-1791948347399.json`|`37696b480242199245eee1048a4c17baa28122f6f08fbdedf83ae1c610fca497`|

两个 PNG 的完整解码 RGBA SHA-256 均为 `55ef509f1d8e7ff763e9427466138e842caca6adf28b8297139ce3e97ac17b65`，与 `fixtures/parity/photoshop-27.11-patch-soft-holdout-slanted-feather2-alpha27.json` 中 `cases[0].nativeSha` 一致。源解码 RGBA SHA-256 为 `7264f72c04360e0023f4ac97c5b14ce0e1be312209d75227cae413d485e0e0b5`，封存选区覆盖 SHA-256 为 `5eb7944f991027c5d0576e0f89d1499a4150964d3c7c0fbee4f64e260dadeecf`。因此，后续本项目验收可使用该封存输出作为这项真实 GUI 操作的像素参考，不能扩展为任意 Photoshop 操作的参考。

## Electron 专项脚本和验收契约

新增 `scripts/smoke-patch-soft-alpha27.ts` 使用独立临时 profile 和自有文档，支持开发版及 `COMPOSITOR_EXECUTABLE` 指定的本机打包版。准备阶段用本地 Editor 生成工程容器，实际测试编辑经真实 preload IPC/main/worker 与 UI 鼠标执行，未调用生产 `preparePatch` 生成期望结果。原生覆盖蒙版通过公开 `selection.set` 安装，每个像素核对，**不重复应用已烘焙的原生羽化**。只有文件打开对话框路径被替换；不改用户工程或系统剪贴板，不关闭用户旧应用。

脚本依次测试 `lowpeak6-feather8`、`lowpeak14-feather8`、`slanted-feather2`、`slanted-feather6`。每项执行真实 main `apply` 的 `layer.patch`，再撤销后执行实际鼠标 Source Patch 偏移 `[-108,28]`，两条路径必须输出一致。前两项完整 RGBA 必须与封存 Photoshop 输出逐字节一致；后两项保留原测试门槛：**覆盖范围 RGB MAE <1，最大通道误差 ≤8**。选择覆盖以外的 RGBA、全部 alpha 以及非目标诱饵图层资产必须完全不变。原生样本自身 alpha 不变化是本项的精度边界，不能据此宣称所有半透明来源策略都完成原生效果对照。

真实 UI 的按住预览不得改变修订、选择、工程清单或源资产；抬起后必须恰好增加一个修订。一次 Photoshop 习惯的 Undo 必须恢复全部资产字节与选择。Escape 取消另一次按住拖动必须不写入任何修订/资产，并能再次切换当前文档，证明实际交互租约已释放。脚本通过 UI 先选择诱饵再选择目标缩略图，以确认实际编辑目标，不只依赖工程初始选择。

`layer.patch` 实际通过公开 IPC 的 `apply` 进入主进程，再由主编辑 worker 执行；它未进入仅用于 Subject / Content Fill / Refine Edges 的辅助 `imageJobs` 分支。脚本同时核对 `imageOperationState=[]`，不伪称 Patch 已改成该辅助任务架构。

根代理首次开发版执行在侧栏诱饵选择检查处停止，未进入修补功能：脚本原先误用工程 `activeLayerID` 检查瞬态 UI 选择。已改为检查实际图层行的 `selected` 类、唯一选中行及诱饵取消选中，保留后续目标输出/非目标资产保护，生产逻辑和原生门槛未修改。首次失败保留于 `artifacts/alpha27-development-final/patch-soft-alpha27/first-failure.json/png`。修正脚本经静态检查后由根代理串行重跑；**该记录本身不是功能 PASS 证据**。运行后的独立 PASS/FAIL 结论以指定输出目录 `report.json`、真实截图和输出 PNG 为准。保留 `first-failure.json/png`，重试不删除首次失败。

```sh
npx tsx scripts/smoke-patch-soft-alpha27.ts
# root 串行运行本机打包版时：
COMPOSITOR_EXECUTABLE='/实际路径/Compositor Electron.app/Contents/MacOS/Compositor Electron' \
COMPOSITOR_SMOKE_OUTPUT='artifacts/patch-soft-alpha27-packaged' \
npx tsx scripts/smoke-patch-soft-alpha27.ts
```

## 开发版独立专项实际结果

根代理协调后，开发版独立专项 `artifacts/alpha27-patch-native-focus-cua/report.json` 实际 **PASS 12/12，errors=[]**，版本 `0.3.0-alpha.27`。四组主进程 IPC 输出与真实 UI 鼠标输出均逐字节一致；取消、单步撤销及诱饵保护均通过。

|封存原生样本|覆盖 RGB MAE|最大 RGB 通道误差|完整 RGBA 与原生|本项目/原生变化像素|
|---|---:|---:|---|---:|
|lowpeak6-feather8|0|0|逐字节一致|1049 / 1049|
|lowpeak14-feather8|0|0|逐字节一致|1871 / 1871|
|slanted-feather2|0.7281985996180776|6|仍有残差|2618 / 2437|
|slanted-feather6|0.33783783783783783|8|仍有残差|4252 / 4111|

所有样本的选区覆盖以外 RGBA 和全部 alpha 改动为 0，诱饵层资产字节不变。该结果只代表本项 RGB8 固定样本和操作，不代替整个项目、打包版或 Windows 的统一验收。

自动原生激活先后在 `artifacts/alpha27-patch-native-focus-retry` 与 `artifacts/alpha27-patch-native-focus-regular` 失败，功能检查为 0；单纯重复 app/window focus、regular activation policy 与 moveTop 未证明能够自动解决问题。失败报告与首次失败均保留。最后一次诊断使用 `COMPOSITOR_NATIVE_FOCUS_TIMEOUT_MS=60000`，根代理通过 CUA 按精确 `node_modules/electron/dist/Electron.app` 路径选择/激活 owned PID 71380，无鼠标/键盘编辑输入。脚本的第 43 次采样取得真实 `BrowserWindow.isFocused()=true` 与 `webContents.isFocused()=true`，之后根代理停止原生输入，全部功能检查由脚本执行。**不能据此称自动焦点已修好**；严格原生焦点门槛未删除、未 mock，默认仍为 15 秒，诊断环境变量范围为 15–60 秒。

本次 PASS 报告物理 SHA-256：`86cc300df48589919f1e3d5d5d20e37eb61c9db4479ced851392885a022e242f`。图层选择首次脚本语义错误与后续焦点失败继续作为独立证据保留，后续统一验收不应覆盖或合并成一次无失败的运行。
