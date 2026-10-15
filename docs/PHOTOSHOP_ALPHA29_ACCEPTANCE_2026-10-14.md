# Photoshop / REA alpha.29 验收

2026-10-14。交付版本 `0.3.0-alpha.29`。本轮按用户指定顺序执行：REA 优化现有透视裁剪、修补与选择交集；随后补齐另一会话明确列出的主要工具缺项。保留原工作树及历史包；没有 Git 提交或推送。

## REA 研究与现有功能优化

REA 工作区 `/Users/zhoujin/Documents/REA` 已配置 REA 6.4.0、Ghidra 12.1.4、Java 21 与 MCP。读取本机 Photoshop 2026 27.11.0 原始 arm64 指令、只读派生分析文件及真实 Photoshop 输出，保留证据、失败探针、模型冻结和源哈希。没有修改或执行派生 Photoshop 二进制。

- **透视自动尺寸**：恢复相机整平与 8 个局部线密度比例，加入正值取整及画布小数相位。已记录 56 个尺寸全部匹配；旧 37 例宽高误差合计 195 px → 0。研究模型冻结后的 9 个真实新样本亦匹配；所有已披露样本现在作为产品回归，不能称为本次新盲测。手动宽高与显式比例保持原语义。整数 extent 额外像素不再直接拉伸四边形。详见 [尺寸与相位](PERSPECTIVE_REA_AUTOSIZE_2026-10-14.md)。
- **默认 Patch D5**：恢复 confidence-normalized reduce/expand pyramid、原生五抽头核与 1 px ROI。生产输出对 19 旧 + 8 新 D5 样本最大差异 1 byte，整图最多 2 个 RGB 通道不同；编辑域、域外和 alpha 精确。独立冻结候选另在新 D1/D5/D7 24 例上 21 byte-exact，其余仅 1 byte。产品仍只提供既有 D5，透明区域回退原算法。详见 [Patch](PATCH_REA_PYRAMID_ALPHA29_2026-10-14.md)。
- **选择手势**：Shift+Option 使用真实交集；自由、磁性及多边形选择捕获正确的手势模式，保持原有选区与撤销语义。真实 Electron 交集检查和 handler tests 验证；失败的 Photoshop Polygon 自动滚动探针未计入原生通过。
- **油漆桶原生参照**：真实 Photoshop hard/no-AA/opaque 样本与实际 Editor action 全 153,600 RGBA 通道精确。单样本结果不扩张至 AA/自然纹理/所有参数。

## 主要工具缺项

| 工具 | 实际能力 | 效果边界 |
|---|---|---|
| Single Row / Column | 一像素整行/整列，组合选区与撤销 | 全套 Photoshop 羽化/固定比例手势仍部分 |
| Pencil | 独立无 AA 硬像素笔尖、Quick Mask、8/16/HDR | Auto Erase / 完整 ABR 未完成 |
| Paint Bucket | 容差、连续、AA、Opacity、All Layers、真实预览与提交 | All Layers 只支持 RGB8；AA/pattern/full blend modes 未对齐 |
| Dodge / Burn / Sponge | 局部色调/饱和度、范围/Exposure/Flow 等、保留 alpha/精度 | 便携近似，原生响应尚未还原 |
| History / Art History | 会话源快照、局部恢复/源色块风格化、原子历史 | Art Style/Area/Tolerance 原生模型未完成；快照不存入 `.comp` |
| Mixer Brush | Wet/Load/Mix/Flow、吸取/清洗/装载及明确 reservoir | 湿颜料局部近似，非 Photoshop 私有求解器 |
| Frame | 矩形/椭圆边界、置图、cover/contain，源图与边界独立移动 | 复杂容器/PSD 原生语义未完成 |
| Pen | cubic Bézier 锚点/控制柄、闭合、多子路径、选区/填充/蒙版 | 自动曲率、描边和完整 boolean 未完成 |
| Path / Direct Selection | 黑箭头整条路径移动/删除；白箭头锚点/柄编辑，Shift+A 轮换 | 多 named paths 联合选择未完成 |

上述 14 个新增入口均接入实际命令、画布操作、预览取消、撤销重做及保存链路；Frame/Path 实施工程模型，没有宣称通过 REA 还原其完整私有内核。工具/参数详见 [工具栏](PHOTOSHOP_TOOLBAR_ALPHA29_2026-10-14.md)、[Frame/Path](FRAME_VECTOR_PATH_2026-10-14.md)、[History](HISTORY_BRUSH_2026-10-14.md)、[Mixer](MIXER_BRUSH_ALPHA29_2026-10-14.md)、[MCP](MCP.md)。

## 最终工程门禁

最终源码：国际化、类型、**2206/2206 tests** 和生产构建 PASS。真实桌面与包验收结果如下；源码测试不能代替桌面、原生效果或平台运行。

| 门禁 | 开发版 | 实际 macOS ARM64 包 |
|---|---:|---:|
| perspective-alpha29 | 9 PASS | 9 PASS |
| patch-rea-alpha29 | 12 PASS | 12 PASS |
| toolbar-alpha29 | 13 PASS | 13 PASS |
| vector-frame-alpha29 | 14 PASS | 14 PASS |
| eraser-regression | 8 PASS | 8 PASS |
| layout-panels | 52 PASS | 52 PASS |
| 合计 | 108 PASS | 108 PASS |

真实包内 stdio MCP **15/15 PASS**（12 tools、protocol v2），直接调用包内 `app.asar/out/mcp/server.cjs` 与桌面权威命令，不是源码 mock。覆盖新像素 actions、idempotent retry、单次 Undo、History source、wet/dry reservoir、Frame clientRef batch、Path live mask 和 malformed/stale/失败批次无损拒绝。MCP runner 的失败探针保留：不支持的 destructive crop；默认 Mitchell 显示过滤的 1px 颜色断言；Wet 吸取增加 reservoir 的预期。最终改为 non-destructive crop、隔离源层/显式 Nearest 和独立 dry consumption 检查，没有据此修改产品算法。

最终 runtime SHA256：`73310ab19d69390a79523f5da90b2d06a48049681d9354d808dd07deb644bf62`。

机器报告：[开发版](../artifacts/alpha29-final-development-v2/acceptance.json)、[实际包](../artifacts/alpha29-final-packaged-v2/acceptance.json)、[包内 MCP](../artifacts/packaged-mcp-alpha29-validation.json)、[资源完整性](../artifacts/release-integrity.json)。

macOS ARM64 未签名目录包：`release/0.3.0-alpha.29/mac-arm64/Compositor Electron.app`。Zip：`release/0.3.0-alpha.29/Compositor-Electron-0.3.0-alpha.29-mac-arm64.zip`，附 `.sha256`。发布完整性脚本核对全部 16 个 runtime bundles、模型、图标、28 份许可与实际 zip；最终 SOURCE_MANIFEST 同时记录本次 source snapshot。包一致性与实际 Windows 运行是不同门禁。


## 仍需研究的差异

Photoshop 效果整体仍是 **PARTIAL**。透视高频/缩小采样与透明边界还存在像素残差；Magic Eraser AA 仍有 256 个 alpha 像素差异，REA 本轮未恢复其 AA kernel，未用猜测常数修改生产算法。Background Eraser 的复杂毛发边缘尚未得到独立原生验收。Patch 透明/16-bit/HDR、完整 Diffusion 1..7 产品参数尚未完成。O/Mixer/Art 与复杂 Frame/vector 仍有上表范围；Artboard/Slice/Note/Count/Pattern Stamp/Color Replacement/ABR/Adjustment Brush 等更广 Photoshop 缺项也没有宣称本轮完成。

本轮实际平台为 macOS ARM64；Windows 原生、HDR 屏幕、GPU/外设/真实平台性能是独立门禁。本轮聚焦改动的真实桌面套件和擦除/布局回归，没有重复全部历史桌面套件。首次擦除 runner 因固定旧工具栏顺序失败，原记录保留；alpha.29 runner 更新预期顺序后通过。截图检查另发现 Path 两行按钮被固定高度截断，已改为单行并加入真实 control bounds 检查；最终代码和安装包重新验证。资源限制、取消、源精度和无损事务持续保留。
