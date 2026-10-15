# alpha.11：最新上游同步与统一验收

日期：2026-10-12。项目版本：`0.3.0-alpha.11`。本报告把源码检查、开发桌面、实际 macOS ARM64 目录包和包内 MCP 分开记录，不将其中一种证据替代其他平台或自然照片效果验收。

## 上游来源与本轮范围

已 fetch 最新 `origin/main`：[`f01e2980fb76eb085d3f8ac96070a1c0c4a9afa9`](https://github.com/robbietilton/Compositor/commit/f01e2980fb76eb085d3f8ac96070a1c0c4a9afa9)，tree `96fde1906f7586647c33ad142b77561ff8e939a5`。相对先前参考 `d0ec2f3` 共22个提交、81个文件变化；最新发布标签仍是v1.4.10，main比标签多6个提交。

完整292文件快照为 `../Compositor_Upstream/f01e298`，文件逐个核对Git blob SHA1并记录SHA256；来源报告 `../Compositor_Upstream/f01e298-source-provenance.json` 为PASS。原Swift clone保持干净历史checkout `75147a2`，其 `origin/main` 已更新；既有快照保留。

本版移植文件夹图片导入、Gaussian Blur默认5px/保留透明度/画布贴边规则、多尺度PatchMatch内容填充及修复接缝、RAW小波降噪与高光重建、v12工程的8位读取、新图标、窄Layers面板及选项栏滚动修复。同时完成此前已授权的C1实验性边缘细化工作台。逐提交映射见 [同步记录](UPSTREAM_SYNC_2026-10-12.md)。

收尾新增的 `2b9603f` / `f01e298` 仅改变16位调色/选区混合/模糊笔刷显示，不改变本次已移植的Patch/Heal内核或普通8位路径。最新16位修复已拉取并审计，但尚不能在本项目RGBA8资产链路执行。它们与自动镜头配置纠正一起列为本次迁移未完成的功能；没有称为完整上游功能同步。Swift/Sparkle发布feed和原生CI不作为Electron产品功能直接移植。

## 源码与独立算法检查

`npm run check` 实际退出0：

| 检查 | 本次结果 | 证据 |
| --- | --- | --- |
| 中文/英文消息检查 | 35个Vue组件、1917条唯一消息、702个字面量键，0问题 | `artifacts/alpha11-final-check.log` |
| TypeScript/Vue类型检查 | PASS；新增桌面脚本后再次检查通过 | `artifacts/alpha11-final-typecheck-with-smokes.txt` |
| 测试 | 696/696，0失败 | `artifacts/alpha11-final-check.log` |
| 生产构建 | Electron主进程、渲染、preload、MCP与辅助worker均完成 | 同上 |
| 最新Patch/Heal独立C参考 | 34/34，逐字节最大差0 | `artifacts/patch-upstream/acceptance.json` |

Patch/Heal参考固定为未修改的上游 `6aea90a` C代码，在记录的macOS SDK/编译参数下独立执行，不从本项目TypeScript实现生成期待值；最新两个提交没有修改该内核。覆盖多尺度、种子、边界、ROI、透明洞和无供体情形。保留旧1.4.8参考与显式legacy入口。此结果不等于所有自然照片、其他编译器或不同颜色转换链路逐字节一致。详见 [内核记录](UPSTREAM_PATCH_KERNEL_6AEA90A.md)。

## 开发桌面回归

10组、70项回归全部通过，串行使用隔离profile。汇总 `artifacts/photoshop-alpha11-final-regression/acceptance.json`，各组日志及运行bundle hash保留在同目录。

| 范围 | 通过项 |
| --- | ---: |
| 上游增量 | 5 |
| 原版常用行为对齐 | 15 |
| 图像尺寸 | 4 |
| 画布交互/裁剪 | 6 |
| 画笔pointer与工具收尾 | 11 |
| 编辑协议与历史 | 7 |
| 主体预览/取消/应用 | 5 |
| Camera Raw式调整预览 | 4 |
| 真实渲染、文字及形状 | 8 |
| 既有上游操作 | 5 |

另外，C1工作台12项、Gaussian 5项、文件夹导入5项及RAW导入5项开发版检查通过；实际包检查如下，不把开发版成功作为包内成功的替代。

## 实际macOS包验收

已构建 `release/0.3.0-alpha.11/mac-arm64/Compositor Electron.app`，Info.plist与实际运行返回版本均为alpha.11。本次为本地未签名目录包，不包含Windows原生运行、发布签名、公证或自动更新验收。

实际包串行运行10组、71项，全部PASS；使用独立profile和生成/有许可证的测试输入，未关闭用户旧窗口、改写用户工程或使用用户选品图片。汇总 `artifacts/alpha11-packaged-suite/acceptance.json`。

| 范围 | 通过项 | 具体核查 |
| --- | ---: | --- |
| 常用Photoshop习惯功能 | 12 | Quick Mask、选择画笔、命名灰度选区、蒙版密度/羽化、保存重开；20轮取消/工具切换不遗留交互锁 |
| 工作流 | 13 | 既有编辑、图层、撤销和持久化流程 |
| PSD通道导入 | 4 | RGB16 RLE/奇数行/非法通道的既有修复回归；输入降为RGBA8仍明确报告 |
| C1边缘细化 | 12 | 前景/背景/未知画笔、ROI、只读预览、取消/过期结果、三种输出及中英窄窗口 |
| Gaussian及窄布局 | 5 | 默认5px、预览/提交像素一致、alpha不变、单步Undo、画布贴边不扩张或变透明、160px面板控件不溢出 |
| 文件夹导入 | 5 | 自然排序、隐藏/嵌套项跳过、坏图报告后继续、像素不变、Undo/Redo、空目录及中文菜单 |
| RAW | 5 | 合法实拍DNG、小波阈值及重建设置、中英文几何、非法参数拒绝、预览与确认像素一致、取消不写历史 |
| Patch/Spot Healing | 5 | 实际内容填充辅助worker对独立C像素、单步Undo/Redo、实际默认Spot Healing对独立C像素与Undo |
| v12工程 | 4 | 8位资源读取及源hash不变；Save a Copy写v11且源仍v12；重开像素/蒙版不变；16位原子拒绝 |
| 包内MCP | 6 | 从app.asar启动stdio、12个工具/协议v2/真实PNG预览、task begin/finish、灰度选区、蒙版属性、C1真实worker及Undo |

两处初次失败属于验收脚本问题，原报告保留：Gaussian在macOS缩放窗口后CDP截图超时，改用真实Electron `capturePage`，全部几何/像素断言保留且截图已查看；v12脚本将macOS `/var` 与规范路径 `/private/var` 当成不同路径，改用 `realpath` 后全部文件hash/状态断言通过。未通过放松产品断言或改期待像素掩盖失败。

v12 UI输入是自建的真实PNG8工程结构与独立编码的PNG16，用于格式/原子保护验收，不能称为原版应用保存的独立复杂工程语料。C1 UI输入是合成不透明边缘，RAW输入是有许可证的实拍DNG；没有Photoshop自然发丝同图人工质量评分。

## 保留的差异与后续顺序

1. **16位编辑**：v12全8位资源可进入v11编辑格式；16位图层返回 `NEEDS_CONVERSION`，包含源位深/目标位深/资源文件且 `conversionPerformed:false`。尚未保留RGBA16深层资产、编辑与历史，不能执行最新16位抗色带修复。下一阶段按DEEP-A资产与预算、DEEP-B操作规则分批实现。
2. **RAW自动镜头配置**：当前LibRaw绑定没有配置文件纠正接口。已实现小波降噪及重建模式；与Apple CIRAWFilter或Adobe Camera Raw的算法/质量/支持相机范围不等价。
3. **发丝与复杂PSD**：C1为受约束的编码sRGB局部颜色实验，无RGB去色边；自然低对比发丝、独立外部复杂PSD语料仍未完成。PSD16导入的RGBA8转换不是16位编辑。
4. **HDR与Windows**：浮点HDR、线性色彩/宽色域/显示映射、原生Windows运行均未通过本次验收，保留后续独立门槛。
5. **跨格式效果**：Gaussian破坏滤镜选项对齐上游；调整记录中的 `blurPreserveTransparency` 是Electron扩展，上游无该字段，不能称该扩展双向兼容。内容填充辅助任务取消会实际终止worker；Spot Healing仍在编辑worker内同步执行，有预算与原子保护，不能声称同样即时取消。

## 运行版本与产物

新包路径：`release/0.3.0-alpha.11/mac-arm64/Compositor Electron.app`。收尾进程检查发现用户仍在运行 `release/0.3.0-alpha.7/...` 的旧实例；测试仅退出自身隔离实例，没有动用户窗口。使用新包前应保存当前工程并退出旧实例，再从alpha.11绝对路径打开。双击新路径时macOS复用旧实例不代表升级成功。

包完整性记录由 `npx tsx scripts/verify-release.ts mac-arm64` 生成：比较app.asar中的当前out runtime bundle、模型、图标、许可证及版本，并写入 `release/0.3.0-alpha.11/SOURCE_MANIFEST.json` 与 `artifacts/release-integrity.json`。本次结果PASS：16个runtime文件、模型/图标、28个许可证文件均与当前构建逐字节一致；源码清单包含516个文件。此次未生成zip。该检查单独保留，不替代以上实际执行。

构建、依赖、runtime、测试截图和本地证据目录继续由既有 `.gitignore` 排除；上游内核JSON参考、源码测试、图标来源及许可证为可审查输入。当前大范围alpha.8–11既有未提交改动保持原样，本次未自动commit或push。
