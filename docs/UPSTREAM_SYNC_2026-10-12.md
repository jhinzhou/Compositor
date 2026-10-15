# 上游同步：2026-10-12 / alpha.11

> 后续实施更新：alpha.12 已验收 v12 PNG16 工程读取/保存/历史保留；alpha.13 已接入 8 类 RGBA16 破坏式调色与单层模糊笔刷。下文原始审计中的“16位图层拒绝/未移植”是开发前状态，当前支持边界及真实验收见 [A1](DEEP_A1_ACCEPTANCE_2026-10-12.md) 与 [A2](DEEP_A2_ACCEPTANCE_2026-10-12.md)。高位深合成/调整层、其他笔刷、导入导出与 RAW 自动镜头配置仍未完成。

本轮读取并拉取 [robbietilton/Compositor](https://github.com/robbietilton/Compositor) 的实际源代码，将适用于 Electron 的改动移植到共享编辑链路。上游 Swift/AppKit/Metal 程序不会直接作为 Electron 的运行依赖。

## 已固定的源代码

- 最新提交：[`f01e2980fb76eb085d3f8ac96070a1c0c4a9afa9`](https://github.com/robbietilton/Compositor/commit/f01e2980fb76eb085d3f8ac96070a1c0c4a9afa9)，tree `96fde1906f7586647c33ad142b77561ff8e939a5`。
- 最新发布标签：v1.4.10 / `eb1fda73e97dbaf5a56ddbf237b712721b37050a`；所固定提交比标签多 6 个提交。
- 相对此前参考 `d0ec2f35b6358108ac3e59593da1688deb83a559`：22 个提交，81 个文件，2862 行新增 / 430 行删除。
- 原 clone 已 fetch 更新 `origin/main`，工作 checkout 保持 `75147a2`，便于保留既有对照；干净 tree 不被重写。
- 新完整 snapshot：`../Compositor_Upstream/f01e298`；292 个文件逐一核对 Git blob SHA1，并记录 SHA256。证据 `../Compositor_Upstream/f01e298-source-provenance.json`，所有文件 PASS。此前 snapshot 保留。

收尾再次查询远程后，从最初核验的 `6aea90a` 更新到 `f01e298`。新增两个提交仅修改16位调色和模糊笔刷路径。其9个文件的差异已逐项阅读；PatchPixels.c、HealPixels.c及8位工作路径未改变，因此本轮独立C内核参考仍固定在 `6aea90a`，不改写参考数据来源。

## 改动映射

| 上游提交 / 能力 | 本轮 Electron 处理 | 限制与验收依据 |
|---|---|---|
| b2a0c45：文件夹图片导入 | File 菜单、命令搜索、拖放共用文件夹展开；自然排序；只取直接可见常规文件；空目录/坏图显式报告 | 每次最多 256 图片，扫描最多 10000 项；不递归，不跟随子项符号链接；Windows 使用独立目录 picker。每图独立 Undo；RAW/HEIF 原有预览取消会停止队列 |
| 9a0ad3e：Gaussian Blur | 默认 5 px；可选 Preserve Transparency；保留原 alpha 时仅模糊归一化 RGB；贴画布边时只钳制相应边；共享 preview/apply；调整层保留本项目的透明度扩展字段 | 旋转层无法把源边轴向等同画布边，仍用原扩边规则；Core Image 与共享高斯实现不是全图片逐字节等价声明。破坏滤镜保留透明度对齐上游；调整层 blurPreserveTransparency 是Electron扩展，上游调整记录无此字段，不能声明该选项双向互通 |
| 23913d3 / 39d1257：多尺度 PatchMatch 与修复接缝 | 已移植最新 PatchPixels.c / HealPixels.c，并作为内容填充/Spot Healing默认；34组独立C oracle逐字节一致（最大差0），[算法记录](UPSTREAM_PATCH_KERNEL_6AEA90A.md) | 保留旧 1.4.8 oracle 及明确 legacy 路径，不改旧期待字节掩盖差异；严格计算/内存上限；内容填充取消实际杀辅助进程，Spot Healing仍为编辑worker内预算受限的同步操作 |
| 248d4d4：RAW 设置 | 接入 wavelet 阈值0–1000（0关闭）与高光重建3–9；默认旧行为保留，参数经实际production worker和controller验证 | LibRaw 与 Apple CIRAWFilter 算法/支持范围不同；lens metadata 不等于自动镜头配置纠正，暂不伪造支持控件 |
| 70b3e14：.hif / .heif | 已有扩展名、picker、HEIF 解码路径，本轮核查保留 | 既有 RGBA8 / sRGB 转换限制继续显式提示 |
| ce5ea67：应用图标 | 更新 build/icon.png 并用上游尺寸生成 macOS icns；Windows资源脚本仍读取同一 PNG | 来源为上游 MIT 资产；只核查当前 macOS 包，未声称Windows运行验证 |
| 0a5c8d9 / 7311d69：窄 Layers 面板与选项栏 | 最小 CSS 接入，避免窄面板内部控件溢出；选项栏仍可滚动但隐藏滚动条 | 不修改工具的交互语义；真实窄布局验收单独记录 |
| bdcedf2 / d9cdb81 / 6aea90a：16-bit 与工程 v12 | v12 仅含8-bit资源时可载入到v11编辑格式，明确保存版本；16-bit图层先返回 NEEDS_CONVERSION，不安装半个工程 | 未保留 RGBA16 深层资产与历史，因此不得设置v12后直接量化。DEEP-A/B与HDR独立后续批次；[代码审计及路线](UPSTREAM_V12_RAW_AUDIT_2026-10-12.md) |
| 2b9603f / f01e298：16位调色与模糊笔刷抗色带 | 已拉取完整源代码并记录：混合通道调整改为16位三线性颜色查找；选区混合保留16位；模糊笔刷实时使用抖动后的16位样本 | 当前RGBA8资产/历史链路不能执行这些16位修复，保留为DEEP-A/B后续任务；不添加未生效控件或宣称已支持。RAW镜头自动配置、16位编辑是本次功能迁移仍未完成的两类能力 |
| 759bcbe：更新提示 / Sparkle feed | Swift/Sparkle发布链路不搬到Electron | 不将macOS原版appcast误用为跨平台Electron更新源；Electron自动更新需独立签名/发布渠道专题 |
| 1.4.9 / 1.4.10版本、发布feed、CI截图/测试优化 | 作为上游历史与构建实现记录 | Electron版本独立alpha.11；不会将原版版本号标成自身完整兼容等级 |
| 216be97：本地 HDR计划忽略 | 仅上游忽略规则；本项目已有忽略运行/构建/证据目录规则 | 未把本地私有计划或构建产物加入提交 |

## 与此前开发的关系

本轮继续已授权的 C1 边缘细化工作台：前景/背景/未知区约束画笔、五种预览背景、ROI、Preview/Cancel 与选区/蒙版/新图层输出。共享 `selection.refine_edges` 可由 UI/MCP 调用。它是受约束的局部颜色实验工具，不能把合成边缘通过等同自然发丝抠图完成。

Quick Mask、局部选择画笔、命名选区、蒙版密度/羽化、PSD 通道合法性与裁剪修复保留既有实现，并在本轮统一回归。复杂自然发丝、独立 Photoshop 复杂 PSD 语料、Deep/浮点 HDR、Windows 原生验证保留独立门槛。

## 本轮统一验收

源代码、真实 Electron、实际 macOS ARM64 包与 stdio MCP 分开验收，实际macOS目录包10组、71项检查通过，开发桌面10组、70项回归通过，源代码696项测试通过；最终结果见 [alpha.11验收记录](PHOTOSHOP_ALPHA11_ACCEPTANCE.md)。测试运行产物放在已有忽略目录 artifacts / test-results / release；不提交用户图片、私有密钥、依赖安装与打包目录。内核参考数据和结构测试不替代自然照片主观质量或Windows运行验证。
