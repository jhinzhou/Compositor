# Photoshop 实测修复第四批：alpha.20

日期：2026-10-12。项目 `Compositor_Electron`，版本 `0.3.0-alpha.20`。本批聚焦画笔硬度、低 Flow 连续落点、蒙版属性羽化、完整文档蒙版边界，以及非破坏裁剪的持久化与交互。下面的“通过”针对注明的参考、误差界和工作流程；不表示复制 Photoshop 私有算法或补齐所有 Photoshop 能力。

## 原版实际操作与来源

原版为本机 Photoshop 2026 **27.11.0**。通过实际 File → Scripts → Browse 执行原生画笔路径／Crop 动作，在实际 Properties 面板输入蒙版 Feather/Density，随后读回描述符并导出 PSD/PNG。使用自制透明、纯白和512×320彩色诊断图，没有使用选品调研图片。仅关闭明确命名的自建参考文档，最后确认恢复原先的 `analysis-grid.png` 未保存文档。

- 新增61组有效原生RGB8画笔输出，累积112组逐例 before/after。原生工具把请求Spacing12.5%读回为13%；fixture保留请求和实际两值，项目公共spacing不会被静默取整。
- 16组有效蒙版属性参考：中心 Feather0/0.1/0.3/0.5/1/2/3/4/6/10/20/50、Density byte128＋Feather10，以及贴边、反向、有孔蒙版Feather10。UI输入0.25实际读回0.3，50%密度实际原生值128/255，归档遵循读回值。
- 原生Crop的 DeleteCroppedPixels=false/true 两组控制，均保存PSD、关闭重开、扩回原画布并还原图层位置。保留模式完整RGBA零差；删除模式有414,164个通道不同，证明恢复验证不是只检查原图文件存在。

参考归档位于 `fixtures/parity/photoshop-27.11-brush-v6.json`、`photoshop-27.11-mask-feather-ui.json`、`photoshop-27.11-crop-preserve.json`。实际PNG/PSD、参数日志、脚本与压缩样本保持SHA验证。alpha.19失败的非零羽化脚本输出继续排除。

## 修复与误差

| 对照问题 | 结果与边界 |
|---|---|
| 小尺寸中等硬度笔尖过尖 | 用统一解析AA卷积与肩部可解析宽度连续混合，避免逐dab17×17采样；8px/h50 max58→6，8px/h75 96→6，16px/h75 52→9。已解析的32/64px中间肩部保持原结果。 |
| 近硬笔尖边缘 | 32px/h90 max64→9；8/16px h90为115→10、92→11；64px h90为58→20。64px/h95仍75→41，不能称等效。 |
| 低Flow连续笔触末端 | Photoshop模型间距用单精度 `Math.fround(size*spacing)`，保留连续弧长；不使用按案例跳末点。Soft32/Flow20/Spacing20/160px max41→5，Hard32对应51→19；Soft64/Spacing10 35→8。159/161px控制限制外推。 |
| 蒙版非零属性羽化 | 显式photoshop模型共用连续box4＋通用采样方差；Feather0.5 max26→3、10/20 4→1、50 6→2。0.3仍45→19；1仍5；3由2微退至3。原蒙版PNG不改写。 |
| 贴文档边缘的蒙版被模糊到黑色外围 | 根据原生证据持久化完整文档蒙版clamp边界，max123→1；有限PSD patch补大后不能误标为完整文档。有限、旋转、缩放、组蒙版有项目回归，没有任意原生外观等效承诺。 |
| 像素一一对应时蒙版显示再次变模糊 | 实际GUI发现CanvasKit的Mitchell cubic在对齐1:1也增加模糊。Photoshop蒙版仅在无旋转、源与设备像素1:1、原点整数对齐时直接传递像素；其它缩放／旋转和旧模型采样保持既有行为。实际灰度canvas、属性预览／提交、Undo/保存一起验证。 |
| 关闭／切换文档后的迟到渲染 | 实际裁剪验收暴露旧高位深渲染失败误报“文档已关闭”，并中断最新文档重绘。现为每轮记录视图epoch、session和revision，旧结果不更新缩略图、旧错误不弹出，继续最新待绘制文档；当前请求真实错误仍显示。新增6项异步时序回归。 |
| 非破坏裁剪 | 现有裁剪已经保留源图层像素；本批明确 `deleteCroppedPixels:false` 和UI提示，保存重开、扩画布实际恢复RGBA8／16和HDR源。true目前原子拒绝，UI没有伪装成可用的删除像素选项。 |

112个画笔参考按union MAE：37改善、70相同、5轻微退化。三个32px/h99案例MAE约增加.004但max19→15；64px/h99 MAE增加.0428/max10→11；Flow1/h90 MAE增加.026/max仍1。旧51个参考的最大误差／MAE门槛没有放宽；唯一历史产品峰值metadata230→227明确记录，原生refPeak230及rawAlpha不变。详见 `artifacts/photoshop-native/measurements/alpha20-brush-candidates/comparison.md`。

蒙版16组完整before/after：`artifacts/photoshop-native/measurements/mask-alpha20/comparison.md`；新源网格最坏19/255，不能概括为“全部≤3”。裁剪原生验证：`artifacts/photoshop-native/measurements/crop-preserve/comparison.json`。这些本地运行产物不提交Git；fixture、脚本、测试和技术说明可复现。

## 兼容、架构与性能

- UI、MCP、内置Agent继续共用严格类型命令。`layer.mask_properties` 可指定 `featherModel` / `featherEdgeMode`；工程保留 `maskFeatherModel` / `maskFeatherEdgeMode`，缓存key与灰度显示包含两者。
- 未标记旧工程和Compositor画笔保持原模型。PSD导入的蒙版明确PS模型；clamp仅依据原始mask patch与原文档完整边界推断。已有显式标记在裁剪／位置改变后保留；蒙版移除、重建、复制和精修生命周期一致处理。
- 蒙版高位深合成处理原始RGBA16／HDR图像；显示PNG8不替代编辑源。密度／羽化只是可逆属性，Preview不修改revision，Apply不改写源PNG，Undo/Redo、保存重开保持源与模型。
- 大核复用通用FFT线卷积，小核直接卷积，限制512MiB估计临时内存及既有尺寸预算。统一画笔解析公式避免每落点二维卷积。保留float中间结果，末端量化，不新增每尺寸查表或按参考半径魔法分支。

## 统一验收

**统一验收 PASS（2026-10-12）**。国际化检查、严格类型检查、**1,442/1,442源码测试**及构建均通过，零失败。开发版和实际macOS ARM64目录包分别通过**17组、221项桌面检查**；是同一套检查在两种runtime重复执行，不算442个独立功能。

| 门禁 | 最终结果 | 证据 |
|---|---|---|
| 国际化／类型／源码／构建 | PASS；1,442 tests，0 fail | `artifacts/alpha20-check-final.log` |
| 开发版 Photoshop 工作流 | 12组／104项 PASS | `artifacts/alpha20-photoshop-dev-final/acceptance.json` |
| 开发版高位深／布局 | 5组／117项 PASS | `artifacts/alpha20-dev-final/acceptance.json` |
| 安装包 Photoshop 工作流 | 12组／104项 PASS | `artifacts/alpha20-photoshop-packaged-final/acceptance.json` |
| 安装包高位深／布局 | 5组／117项 PASS | `artifacts/alpha20-packaged-final/acceptance.json` |

各项子报告也检查PASS及空错误列表，不能仅依据启动成功或父脚本退出码。新增原生画笔4项、蒙版12项、裁剪7项包含在104项内，不重复计数。每种runtime的布局52项涵盖中文／英文与1050×720／1440×840，实际截图均成功，无截图fallback。真实鼠标画笔、按住指针Enter裁剪和组件控件使用实际桌面；foreign pointer end／blur为明确标记的合成DOM边界事件，桌面剪贴板用进程内替身，真实数位笔和系统剪贴板仍不能由这些检查推断。

安装包 `release/0.3.0-alpha.20/mac-arm64/Compositor Electron.app` 的Info.plist实际读回 `0.3.0-alpha.20`。开发版与安装包高位深门禁记录的当前`out`文件SHA列表完全相同。发布完整性**PASS**：包内16个构建文件、模型、图标及28个许可证文件与当前构建一致；app.asar SHA-256为 `0c52eb8d852f92754e86c93c30c19e1ddcdb712af445f0691b9494593073749b`。最终完整性记录见 `artifacts/release-integrity.json`；源文件、包内代码与资源清单见 `release/0.3.0-alpha.20/SOURCE_MANIFEST.json`。本批仅交付本地未签名macOS ARM64目录包，未生成新zip，不声称Windows或HDR显示器验收通过。

本轮真实桌面新增低Flow／中间硬度鼠标操作、六组属性输入／readonly预览／实际灰度画布／Apply／Undo／保存重开，以及裁剪按住Enter、pointer ownership、blur、8/16/HDR重开恢复。设备像素1:1的蒙版画布对照采用实际canvas bitmap；普通屏幕截图包含CSS缩放/Retina插值，不能直接混作原图字节误差。实际截图的Preview与Apply必须相同。

复验依次运行（所有桌面输入串行，彼此隔离profile）：

```sh
npm run check
npx tsx scripts/check-photoshop-stage-release.ts artifacts/alpha20-photoshop-dev-final
npx tsx scripts/check-high-depth-release.ts artifacts/alpha20-dev-final
npx electron-builder --mac dir --arm64 --config.directories.output=release/0.3.0-alpha.20 --config.electronDist=node_modules/electron/dist
COMPOSITOR_EXECUTABLE="$PWD/release/0.3.0-alpha.20/mac-arm64/Compositor Electron.app/Contents/MacOS/Compositor Electron" npx tsx scripts/check-photoshop-stage-release.ts artifacts/alpha20-photoshop-packaged-final
COMPOSITOR_EXECUTABLE="$PWD/release/0.3.0-alpha.20/mac-arm64/Compositor Electron.app/Contents/MacOS/Compositor Electron" npx tsx scripts/check-high-depth-release.ts artifacts/alpha20-packaged-final
npx tsx scripts/verify-release.ts mac-arm64
```

## Photoshop 功能与效果完整目录

根目录 `PS/PHOTOSHOP_FUNCTION_EFFECT_CATALOG_2026-10-12.md` 按112个能力族覆盖桌面主要菜单、工具、工作流程，附27blend、23调整／填充类型、10图层样式、47Filter Gallery个项、72Filter菜单条目、具体画布工具、高级文字路径、Camera Raw、Web及快捷键。每项区分实际入口、图片效果、复现、项目可用／部分／缺少及证据，附AI工作批次计划。目录规模不是Photoshop总功能数或项目完成率，不声称列尽插件、历史版本和每个参数组合。

仍需后续修复的效果：64px/h95近硬笔尖、小半径0.3属性羽化、RGB16原生工具不透明度量化、更多真实自由手绘／数位笔、任意有限／独立缩放／旋转蒙版；裁剪删除像素、自动拉直／透视／角度裁剪；Blend If、智能对象／智能滤镜、专业颜色管理和复杂PSD。Windows真机、HDR显示器输出、签名公证保持独立门槛。本批未提交或推送，旧工作区改动和历史发布目录保留。
