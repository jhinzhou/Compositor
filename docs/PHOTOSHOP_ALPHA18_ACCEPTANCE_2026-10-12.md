# alpha.18 Photoshop 原生效果与高位深绘画验收

日期：2026-10-12；版本：`0.3.0-alpha.18`。本报告属于第二批实测与修复，整体 Photoshop 能力对齐仍在分阶段进行。本批源码、开发版与实际macOS ARM64包的统一门禁已全部通过；不将本批交付等同于整份Photoshop计划完成。

## 交付行为

- 在真实本地 Photoshop27.11.0 新增53个正式成功输出：21个选区羽化、32个圆笔设置/尺寸/硬度/笔画输出。早期试运行和失败案例保留但不计作成功参考。自制图，不使用用户选品调研或业务图片。
- Photoshop配置的羽化幅度、形状组合、重复羽化和旧覆盖迁移统一；未声明模式/Compositor保持旧参数映射。
- 柔圆尾部、连续硬度、Flow100%与间距落点共用数值核；新增默认25%间距，画笔Opacity/Hardness显示百分比。自定义间距会正确标为Custom，选择预设恢复默认间距。
- RGBA16/HDR Paint/Erase直接合成原始源，8位显示代理不作为绘画源；低强度、负值、超白与原始未命中样本得到保留。公共高位深合成模块用于两条数据路径，UI/预览/MCP沿用同一命令边界。
- 同时保留此前调色、曲线端点、显式栅格化、RGB16 PSD/PSB读取、Quick Mask、命名选区、蒙版、裁剪等能力，按当前实际运行重新检查。

## 实测效果与限制

| 项目 | 实测结果 | 结论范围 |
| --- | --- | --- |
| 羽化 | 21组修复后Alpha最大残差0–6/255，中心Feather10从73降到4 | 近似原生幅度与边界覆盖；不宣称私有Gaussian核完全一致 |
| 柔圆 | 10组非零并集平均MAE15.2480→0.9616/255；32/48/64尺寸单点max2 | 固定规则跨尺寸有效；低Flow/Spacing10仍max36 |
| 连续硬度 | 14组中间硬度平均MAE22.7407→3.3452/255；0→极小正值原29.26%覆盖跳变消除 | 64px留出平均MAE28.9661→3.4352；靠近全硬和密间距仍有残差 |
| 原生重测 | 柔圆重复max1，50%硬度单点exact0，中等硬度Flow20直线重复max5 | 部分落点/量化变化来自原生输出，不将其全部归为项目错误 |
| 高位深源 | 16位Opacity.001改变低有效位；HDR `[2,-.25,.5]`黑色Opacity.1保留`[1.8,-.225,.45]` | 直接源合成算术、Undo/预览/持久化；不等于PS RGB16笔刷量化一致 |
| 桌面实际鼠标对照 | 柔圆点对原生max2/255、Feather10选区对原生max4/255 | 同几何Alpha，另测预览提交/撤销；不代替真实数位板或任意照片质量 |

全硬笔尖Alpha边缘max80，硬度90/99 max64/91；RGB16原生1%画笔峰值772而产品655。这些明确不属于“全部一致”。覆盖和蒙版仍为8位，任意ICC/RGB32 PSD、HDR显示、复杂发丝/去杂色、智能对象/完整PSD、Windows原生均另设门槛。详细公式、样本、候选和研究顺序见[原生研究](PHOTOSHOP_ALPHA18_NATIVE_EFFECTS_2026-10-12.md)。

## 实际门禁

| 门禁 | 状态与证据 |
| --- | --- |
| 国际化、类型、源码测试、构建 | PASS，1,294/1,294测试；`artifacts/alpha18-check-release-final.log`；36 Vue组件/1948消息扫描无问题 |
| 最终脚本类型检查 | PASS，`artifacts/alpha18-typecheck-final.log` |
| 8组开发版常用PS流程 | PASS，70项；`artifacts/alpha18-photoshop-dev/acceptance.json` |
| 5组开发版高位深/UI/MCP | PASS，117项；`artifacts/alpha18-dev/acceptance.json` |
| macOS ARM64实际包 | 已构建；`artifacts/alpha18-package-final.log`，Info.plist版本0.3.0-alpha.18 |
| 8组实际包常用PS流程 | PASS，70项；`artifacts/alpha18-photoshop-packaged/acceptance.json` |
| 5组实际包高位深/UI/MCP | PASS，117项；`artifacts/alpha18-packaged/acceptance.json` |
| 包内字节完整性、模型、图标、许可 | PASS，16个runtime bundle、28份许可/模型/图标字节一致；`artifacts/alpha18-integrity-final.log`和`release/0.3.0-alpha.18/SOURCE_MANIFEST.json` |
| 工作区差异格式 | PASS，`git diff --check` |

开发版和实际包各187项桌面检查（70常用流程+117高位深/UI/MCP）；两种环境复验同一批案例，不计作374项独立功能。实际包app.asar SHA-256：`a243b316520cf0421ebac85ef4c12613f844618eb23f7c5a20b8e617a1e66b6e`。真实MCP新增PS模型/间距/低不透明度PNG16绘画和完整撤销验证。

所有GUI串行、隔离临时profile和测试工程。包内验收使用实际alpha.18 executable，不把开发版成功代替包内成功。真实stdio MCP独立验证；部分剪贴板桌面测试采用进程内模拟，不能据此声明系统外部pasteboard完全互通。

包路径：`release/0.3.0-alpha.18/mac-arm64/Compositor Electron.app`。原alpha.17及更早目录包保留。用户已打开的原应用与工程不被替换；使用新包时保存并退出旧实例，避免macOS复用旧窗口。本包未签名/公证，不代表Windows或EDR显示验收。

## 复核命令

```sh
npm run check
npx tsx scripts/archive-photoshop-feather-reference.ts
npx tsx scripts/archive-photoshop-brush-reference.ts
npx tsx scripts/measure-photoshop-soft-tip-candidates.ts
npx tsx scripts/measure-photoshop-hardness-family-candidates.ts
npx tsx scripts/check-photoshop-stage-release.ts artifacts/alpha18-photoshop-dev
npx tsx scripts/check-high-depth-release.ts artifacts/alpha18-dev
COMPOSITOR_EXECUTABLE="$PWD/release/0.3.0-alpha.18/mac-arm64/Compositor Electron.app/Contents/MacOS/Compositor Electron" npx tsx scripts/check-photoshop-stage-release.ts artifacts/alpha18-photoshop-packaged
COMPOSITOR_EXECUTABLE="$PWD/release/0.3.0-alpha.18/mac-arm64/Compositor Electron.app/Contents/MacOS/Compositor Electron" npx tsx scripts/check-high-depth-release.ts artifacts/alpha18-packaged
npx tsx scripts/verify-release.ts mac-arm64
```

归档/测量脚本读取已存在的原生输出，不会自行制造Photoshop期待数据。重新采集需要在Photoshop实际运行相应JSX。旧baseline由独立探索公式保留；产品修复后重新测量不会覆盖研究中的before指标。
