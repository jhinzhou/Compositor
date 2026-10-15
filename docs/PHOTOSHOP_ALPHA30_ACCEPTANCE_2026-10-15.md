# Photoshop effect alignment alpha.30 — 2026-10-15

本轮先研究透视裁剪采样与透明边界，再研究 Magic Eraser AA。Photoshop 原生对照版本为 2026 27.11.0。研究使用 REA 静态证据、独立数值原型和真实 Photoshop 工具/ActionManager 输出；产品修改发生在候选冻结后的新原生样本验证之后。当前效果对齐状态为 **PARTIAL**，限定范围已经恢复，不能把安装包工程验收与 Photoshop 全功能像素等效混为一项。

## 产品变化和原生对照

透视裁剪接入 RGB8 完整源矩形、偶数源中心、两个轴都放大的原生 Smoother 分支。恢复 128 相位、14bit 权重、先横后纵、逐轴整数舍入，以及 RGB 延边和 alpha 零边界。6 个冻结后原生样本整图 RGBA exact；另 4 个奇数中心或彩色透明洞样本保持旧输出字节。详见 [裁剪专项](CROP_AXIS_SMOOTHER_REA_ALPHA30_2026-10-15.md)。

Magic Eraser AA 恢复六通道颜色兼容度、列/行顺序的边缘统计和扩展、统计阈值与整数覆盖映射。旧 alpha.28 残差样本的 alpha 差异由 256 像素、max252、MAE0.8538802083 降为 0。新候选独立 4 例中，3 个工具不透明度100%的样本 alpha/可见RGB/预乘RGB exact；43%工具不透明度仍有5175个alpha像素各差1（max28→1、MAE0.1766927083→0.134765625），没有通过改参数掩盖该残差。完全透明像素仍遵守项目的隐藏RGB规范，因此不能把可见结果一致称为完整原生PNG字节一致。

## 保留的失败、兼容边界

透视研究 v1 在新奇数中心样本失败；v2 补相位后仍有边界差异。最终仅接入验证过的 v3 守域。一般仿射两段 skew 原型已将四张披露控制的RGB MAE降至0.0046285、max2，alpha仍有2个像素各差1；中间ROI边界尚未闭环，未写入产品。一般强透视、缩小、复杂彩色A0、奇数相位和所有透明外缘不在本次exact声明内。

Magic AA v1 的三通道候选在新彩色样本失败，完整失败批保留。通过 REA 恢复额外三个色差LUT后另冻结v2；前4已披露样本不再冒充v2独立证据，后4才是冻结后独立样本。AA关闭、合成取样、RGBA16/HDR及背景橡皮擦不因这次RGB8当前图层优化获得新的原生等效声明。源资产不写回，selection、placement、canvas、取消与资源边界仍由实际编辑链控制。

## 验收记录

源码、开发运行时、macOS ARM64包、包内MCP与发布完整性分别验收。本轮真实运行结果如下：

| 门禁 | 结果 |
|---|---|
| 全量源码测试 | 2240/2240 PASS，0 fail/cancel/skip |
| 国际化 | PASS，2351条消息、0 issue |
| 干净源码副本类型检查 | PASS；1251个文件，无out/release/artifacts导入和仓库外源码依赖；复用现有node_modules，未声称重新npm ci |
| 生产构建 | PASS |
| 实际开发版Electron | 8组/130项 PASS |
| 实际alpha.30 macOS ARM64包 | 8组/130项 PASS |
| 包内实际MCP | 15项 PASS，实际capabilities版本alpha.30 |
| 发布内容完整性 | PASS，16个运行时文件与当前out逐字节一致，28个许可证文件及模型/图标一致 |

开发版与包内验收共同运行时tree SHA256：`8f0fc42dfdb45be3301c32a8d77f4e011b90e7de4b9ec2c91fdb6655dcde3407`。每组运行前后均核验该hash，避免用旧包或变化中的构建代替验收。

新增裁剪脚本实际通过10组：首例真实工具栏四角与尺寸字段/Apply，其余实际Editor命令，6例直接比较Photoshop RGBA，4例比较冻结旧路径RGBA，全10例真实键盘Undo/Redo与保存重开。新增AA脚本实际通过4例/12项：旧残差、冻结后透明源100%、非连续色块和43%残差，核对真实鼠标预览只读、单次提交、原生像素边界、键盘Undo/Redo与保存重开。除隔离profile和文件选择路径外，没有用编辑器状态或像素oracle替身。

两种运行时还分别执行透视几何、Patch、工具栏、Frame/Bezier、Eraser和布局回归。包内MCP使用实际stdio/命令链验证，不将Playwright操作称为MCP。Windows真机与HDR显示不在本轮原生平台验收内。

本机报告：`artifacts/alpha30-source-gates.json`、`artifacts/alpha30-clean-source-types/report.json`、`artifacts/alpha30-runtime/acceptance.json`、`artifacts/alpha30-packaged-runtime/acceptance.json`、`artifacts/alpha30-packaged-mcp-validation.json`、`artifacts/release-integrity.json`。源码回归可通过不可变fixture在无Photoshop/REA环境复测。

```sh
npm run check
COMPOSITOR_CLEAN_SOURCE_OUTPUT=artifacts/alpha30-clean-source-types npx tsx scripts/typecheck-clean-source-alpha28.ts
npx tsx scripts/check-alpha30-runtime.ts artifacts/alpha30-runtime
# 验证实际安装包时额外设置COMPOSITOR_EXECUTABLE，再运行相同runner。
npx tsx scripts/verify-release.ts mac-arm64
```

本机构建包：`release/0.3.0-alpha.30/mac-arm64/Compositor Electron.app`。app.asar SHA256 `0f1f16a50b0b68454d61e7640d83ecc7ca317c57bed92a3701d3f530bd0d3515`。

## Git 交付边界

开始时远端main仍为alpha.7时代的基础提交，本地已存在之前会话交付的alpha.29完整实现。该基线在本次修改前归档并生成独立Git tree `c61c7bb391d37ff6f17db9e7cda2a8c610287b36`，包含1237个源码/文档/资源文件。最终交付分为alpha.29历史基线提交和本轮alpha.30效果修复提交，避免把前序功能归于本轮。REA中的Adobe派生分析镜像、原二进制、Ghidra工程和原生临时输出不进入产品仓库；可移植回归只包含项目自制输入与对应原生结果。

本轮alpha.30相对归档基线的diff whitespace检查通过。历史基线保留两份Photoshop原始TSV中的CR换行与失败记录；Git将这些旧原始记录识别为行尾空白，本轮未重写原生证据。
