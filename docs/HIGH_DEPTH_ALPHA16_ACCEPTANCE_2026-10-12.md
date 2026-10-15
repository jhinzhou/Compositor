# alpha.16 高位深与上游同步统一验收

更新时间：2026-10-12。项目 `Compositor_Electron`。本批继续用户要求的 16 位调整合成、画笔／涂抹／液化／重采样与界面布局，移植已拉取的上游 `f5ae5bad0b25b32dda9f254e62d2f07f59478698`。保留此前 alpha.8–15 的工作；本报告不宣称 Photoshop 全功能、Windows 原生或 HDR 屏幕输出完成。

## 最终能力

| 路径 | 实现与精度边界 |
| --- | --- |
| 工程与撤销 | v12 PNG16 原编码数据与 Uint16 工作数据；v13 EXR 原编码数据与 Float32 工作数据；保存、复制、Undo/Redo 保留不可变源版本 |
| 调整层 | 12 类：Hue/Saturation、Levels、Curves、Exposure、Gradient Map、Invert、Black & White、Color Balance、Grain、Add Noise、Gaussian、Motion；支持蒙版、密度／羽化、不透明度、组、连续剪贴堆栈 |
| 模糊调整透明边界 | Normal Gaussian/Motion 同尺寸卷积真实 RGBA，蒙版×不透明度对四通道插值；非 Normal 或 Gaussian Preserve Transparency 保持原 alpha |
| 像素编辑 | 19 类既有破坏滤镜、Paint/Erase、Fill/Gradient/Clear、This Layer Blur/Smudge/Liquify、三种 Image Size 重采样；预览和提交使用共同核心路径 |
| 高位深导入 | PNG16、平面扫描行 EXR HALF/FLOAT、Radiance RGBE/HDR、文档所列经典浮点 TIFF 子集；不支持的编码与色彩配置明确拒绝 |
| 导出 | Export As 的 PNG16 使用高位深合成后最后量化到 SDR16；EXR FLOAT+ZIP 保留浮点高光。普通 PNG/JPEG/PDF 与快速 PNG 是现有 8 位路径。PNG16 默认 API 参数保留透明度 |
| 位深转换 | `layer.convert_depth` 8↔16、HDR→16/8；显式剪裁／量化为普通源，可撤销，图层标识同步更新 |
| 上游交互 | 调整按钮移到效果前、实际菜单；JPEG/PNG 主格式与 More；标签栏拖入文件／图层生成按内容适配的独立文档；新画布粘贴、复制时图层快照与深度标识 |
| 双语布局 | 拾色器、最近项目、缩放选项栏、Agent 设置及其他弹窗、六个图层 footer 按钮；1050×720 与1440×840，ZH/EN分别检查文本高度、溢出、遮挡和可达性 |

## 已完成检查

- `npm run check`：**1,162 / 1,162** 测试，`check:i18n`、`vue-tsc`、生产构建通过。证据：`artifacts/alpha16-check-release.log`。
- `check-high-depth-release.ts artifacts/alpha16-dev`：开发版五组实际 Electron 检查全部通过，总 **114 项**：HDR 19、上游交互10、16位调整15、16位工具18、双语布局52。证据：`artifacts/alpha16-dev/acceptance.json` 与各子报告。
- HDR 及16位工具检查实际启动 MCP stdio 客户端，验证共享动作与 Undo；独立的 provider／vision 模型联调不包含在这些检查中。
- 独立参考覆盖未修改上游 C 桥接、原版颜色／画笔、Core Graphics重采样、OpenEXR及浮点 TIFF 编码器。参考性质和误差边界见 `HIGH_DEPTH_FILTER_REFERENCE.md`、`HDR_CODEC_REFERENCE.md`、`HDR_SPATIAL_REFERENCE.md`、`DEEP_RESAMPLE_REFERENCE.md`。
- 只读复查发现并修复 HDR→16 后遗留EXR误选合成器、PNG16默认透明度、草稿完整缓存预算、合计导出工作预算、工作区／历史预算及保存指纹基线。复查 **8项通过**，详见 `HDR_INTEGRATION_REVIEW_2026-10-12.md`。
- 实际 macOS ARM64 目录包已生成，版本 `0.3.0-alpha.16`，未签名；16份运行 bundle、28份许可、模型及图标与当前产物相同。`app.asar` SHA256：`2e2fe35e6fb6949b0fd965f55d0eb0d058cd64224b316bf66049265b04856701`。完整性检查与运行验收分别记录。
- 既有十组桌面回归全部通过：`artifacts/alpha16-native-parity/acceptance.json`。上述 macOS ARM64 未签名目录包五组实际运行检查全部通过，**114项**，包含真实 MCP stdio；`artifacts/alpha16-packaged/acceptance.json`。与开发版使用同一组源／草稿／保存／布局检查。

## 已知边界

HDR 合成暂支持 Normal、Multiply、Darken、Lighten、Linear Dodge (Add)、Difference 六种混合；可见 raster effects、矢量蒙版及未支持堆栈拒绝。高位深合并／盖印、像素剪贴板转换、All Layers 采样和复杂PSD高位深编辑仍有显式限制。PSD/PSB 现有转换主链仍为 RGB8，不能从 v13 EXR 能力推导 PSD32 完成。

HDR Camera Raw 非中性几何、镜头畸变和色差位置变换需要完整浮点有序管线，当前明确拒绝；独立 Lens Correction 已支持浮点几何。部分旧字节滤镜通过四／十探针重建，HDR normalize/restore 会裁剪负色；与私有 Core Image/GPU 或 Photoshop 的全部算法等价尚未证明。Dither 保留高位深资产是本项目扩展。

原 EXR 编码字节可以精确保留。新编辑采用 FLOAT scene-linear EXR，在重新解码到 extended-sRGB Float32 时可能有传递函数舍入；实测4096像素、16384样本最大1 ULP，不宣称所有工作浮点逐位一致。显示代理和 MCP 图像仍是 SDR RGBA8，HDR/EDR 输出及Windows实际硬件验收独立进行。

图层payload拖放使用DOM事件，文件拖放使用原生CDP File数据；粘贴检查用进程内ClipboardItem双份实现，数字文本使用隔离paste adapter，不写用户系统剪贴板。这验证应用动作链路，不能替代系统多格式pasteboard专项。
