# Compositor 1.4.8 独立功能审查

日期：2026-10-09。比较基准为本地官方标签 `v1.4.8` / `24ef2885daae750537ec8d094f33e8556a8dfc9a`，对照当前 Electron 运行路径、核心测试和实际桌面产物。本文件是独立审查记录，原始 41 行计划是开发前快照，不能作为当前缺口数量。已安装的原应用为 1.4.7；这里的 1.4.8 原生文件证据来自真正的 Swift `ProjectStore` load/save，不冒充运行过 1.4.8 GUI。

“流程已有”表示找到可执行入口和对应编辑/存储路径；不表示所有图像逐像素完全相同。“本轮补齐”必须结合最终桌面产物确认。原版也不支持的 Photoshop 特性不计入新增缺口。

| 编号 | 当前审查结果 | 依据与需要保留的边界 |
| --- | --- | --- |
| L01 | 流程已有 | 24 模式；192 个原生参考像素、真实 MCP/CanvasKit 与 hover/Escape 桌面记录。 |
| L02 | 流程已有 | 整树复制、解组、折叠；parent/clip ID 重映射，真实桌面与核心事务。 |
| L03 | Copy/Paste、跨文档事务已有；跨文档拖拽已通过实际检查 | 初查 dropLayers 拒绝不同 session，已反馈 root 补 tab hover/drop + transfer；不能用跨文档粘贴替代真实 drag 验证。 |
| L04 | 流程已有 | 合并选层/向下/组、Copy Merged；实际像素合并和一次撤销桌面记录。 |
| L05 | 流程与独立 mask Option-drag 已有 | 原生灰度 PNG、link/placement/羽化/启禁用已测试；新增 copy_mask 保存源 mask 的文档位置并替换目标 mask。 |
| L06 | 流程已有 | 连续 Alpha clip、脱离/栈验证、clipboard/transfer live mask bake；原生文件回读覆盖引用。 |
| L07 | 流程已有 | 12 native adjustment 类型、参数 UI、非破坏渲染、文件双向回读。 |
| L08 | 流程与独立 effect Option-drag 已有 | 六类效果；新增 copy_effect 仅替换指定类型，保留目标其它效果、enabled 与参数。 |
| T01 | 流程已有；画布 Cmd+Shift 多选已通过实际指针检查 | panel Ctrl/Shift 不是 canvas modifier 的替代；已向 root 指明原版 EditorCanvas 1676–1682。共同旋转/缩放/翻转有核心和桌面记录。 |
| T02 | 流程已有 | 四角 preview/cancel/apply、轴约束、实际桌面与透视像素测试；原版也是提交后栅格化。 |
| T03 | 流程已有 | 数字字段 scrub、draft、一次提交、Snap geometry、旋转 mask 字段和取消验证。 |
| S01 | 流程已有 | rectangle/ellipse/freehand/polygon，加减反选/移动与共享 coverage。 |
| S02 | 流程已有；浮动选中像素交互已通过实际检查 | wand/color range/羽化/蒙版载入/clipboard 已测试；root/layers 在补 floating transform/画布拖拽，不以单纯数值变换等同完整交互。 |
| S03 | 识别、抠图、内容填充流程已有；Object 拖框已通过实际检查 | 实际 ONNX、CPU mask、独立 worker 和撤销已通过；初查 Object 只有数值框，已交 root/layers 补画布框选。识别模型与 Vision 不会对每张照片产生完全一样的选区。 |
| P01 | 流程已有；相关画笔手势已通过实际指针检查 | 选区覆盖、逆坐标、笔触平滑/轴约束、不可变历史；right-drag/Shift-brackets/Alt picker 交 root，验证应看实际 pointer 路径。 |
| P02 | 流程已有 | blur/smudge/warp、heal/clone、aligned/current/all layers、source crosshair；实际像素与 preview 验证。 |
| P03 | 流程已有 | gradient 端点、radial、opacity、可取消 preview、取色/前背景/颜色面板。 |
| P04 | 基础创建与 native size redraw 已有 | shape drag 的 Shift/Alt/45° line；set_transform size 改变重新绘制 source PNG，radius/lineWidth 不随尺寸拉伸；移动/旋转保留 source。 |
| P05 | 原位文字、点文字与段落手柄已有 | UTF-16 font/color runs、多行、tracking/leading；click 无 boxSize，drag 固定段落，手柄保持字号与现有变换缩放。缺字体明确阻止改写，CJK OS fallback 明示。 |
| F01 | 流程已有 | adjustments/filter shared specs、Auto、选区 apply，原生文件类型回读。 |
| F02 | 流程已有，原生参考只覆盖代表样本 | 大模糊近似和采样策略在 FILTER_PARITY_LIMITATIONS 公开；不能据此宣称全部图像的 Core Image 像素相同。 |
| F03 | 流程已有，部分 native 像素对照待扩充 | Camera Raw 多分区、WB/geometry/detail；geometry 插值仍在明确 parity limitations 中。 |
| F04 | 流程已有，部分 native 像素对照待扩充 | Dither/Scanlines 参数、ASCII；字体/下采样/glow resampling 边界公开。 |
| F05 | 流程已有 | Filter preview/cancel/selection/Last Filter/参数；对应核心与实际桌面。 |
| C01 | 流程已有 | Crop/Canvas Size/Image Size/Trim/flip/rotate；pixel versions/selection/mask 不可变，Undo 与尺寸 tests。 |
| C02 | 流程已有 | ruler/guide/grid/pixel grid/snap；geometry tests，原版网格细分与 screen tolerance。 |
| C03 | 流程已有 | >=300% Navigator，独立整文档缩略图与视口框；真实 800% viewport 桌面。 |
| C04 | 流程已有 | viewport 裁切渲染原像素，pan/zoom anchor、F 画布全屏；不能把视口裁切等同整层 texture 瓦片化。 |
| U01 | 流程与 Shape Tab/Shift-U 已有 | command search/remap/main native menu；按键重映射与 modifier gesture 的边界要保留。 |
| U02 | 基础完整操作可用，交互回归通过；外观边界保留 | panel auto scroll、context、mask thumbnail；原版控件的所有外观/布局细节仍不是一张截图能证明。 |
| I01 | 流程已有 | PNG/JPEG/BMP/GIF首帧/WebP/SVG/HEIF + 当前 TIFF；磁盘-backed File drop 验证，不接受任意 renderer 路径授权。 |
| I02 | PSD/PSB report/cancel/confirm、native adjustments 与基础 vector fallback 已有 | 原版实际只解析 Levels/Curves/Hue-Saturation；ag-psd hue2 narrow adapter 含真实 Adobe byte record、Colorize/六色带、生产 ESM test。其它 Photoshop adjustments 按原版报告 skipped。缺少 raster channels 的基础矩形/等圆角矩形/椭圆用纯 RGBA 重绘；legacy vmsk 只恢复真实轴对齐矩形，diamond/复杂 path 不冒充矩形。2×2 AA 与 Photoshop 原生边缘可能不同，不能声称 native 像素完全相同。 |
| I03 | 流程已有，有独立解码器预算 | RAW/HEIC 实际公开样本 WASM 解码、参数 preview/confirm/cancel；RGBA8/sRGB。WASM 512MiB/RAW sensor working budget 不等于 engine 200MP 许可范围。 |
| E01 | 流程已有 | PNG/JPEG/PDF preview/size/DPI 与回读，实际渲染 export；额外 PSD export 为 ordinary raster/folder/mask/blend，text/shape 和独立 adjustment/effect 降级明确报告。 |
| E02 | 流程已有 | DPI、PDF physical size、真实 QuickLook JPEG 保存且捕获 revision 一致。 |
| D01 | 流程已有 | per-document background save；fs.watch parent/package/images，无全资产 idle polling；干净 auto reload / dirty Keep/Reload/Copy、坏文件保留、save lifecycle 拒绝冲突。 |
| D02 | 原版真实双向文件回读通过 | artifacts/native-project/validation.json：44 layers /34 assets，native metadata UUID 规范后相同、RGBA最大误差0；含 masks/clip/text/shape/effects/all adjustments/all blends。fixture 为 opaque/gray，不代表透明 hidden RGB 的所有 native encoder 情况。 |
| D03 | 容量规范对齐，10000层保存及单层100MP桌面已通过 | 30000边/200MP surface/800MP doc/10000layers/512MiB asset；root 已做10000层保存。CPU/GPU、解码预算与大图实际可用规模必须分开报告。 |
| D04 | 流程已有，系统原生验证分平台 | Recent/open-file/argv/second-instance、opaque recent IDs、fileAssociations metadata；Windows argv 目前 Mac 模拟，不等于真实 Windows registry/DPI/Finder打开包验收。 |
| A01 | 配置、stream/tool/MCP/停止/回退流程已有 | OpenAI-compatible 已确认；用户尚未配置实际 endpoint/model/key，真实指定服务任务验收待配置。模拟 HTTP + 真实 MCP 已覆盖执行链，不代替真实模型表现。 |
| R01 | 开发包/图标/许可具备；正式分发与 Windows 原生验收待做 | 当前目录构建；签名公证、installer/update 与原生 Windows运行是单独交付门槛，不宣称功能 tests 已覆盖它们。 |

## 原生工程双向证据的范围

`scripts/verify-native-project.ts` 生成全功能工程，再调用 `scripts/native-project-oracle.ts` 编译官方 1.4.8 的实际 Codable 类型、验证和整个 `ProjectStore.swift`，执行原生 load → save → load。Electron 重新读取原生输出并比较 metadata/资产像素。提取脚本检查 exact tag commit、保留 MIT 版权许可、清理临时编译产物。未使用原应用 1.4.7 冒充 1.4.8 GUI。

本轮审查发现的确定功能缺口已分别交给负责 Agent 实施。最终当前状态应以同一 build 的串行 desktop/test/build 记录刷新，不能仅把本文件“本轮补齐”改成完成。

## 本轮独立模块实际桌面验收

`artifacts/content-import/desktop.json` 记录 13 项实际 Electron 检查且无 pageerror，包括：真实 PSD codec worker 的转换报告/取消零新文档/确认；缺 raster 基础圆角矩形生成有效 PNG 与可编辑 Levels；后台 PSB 导出；画布鼠标创建 shape/中文段落；缺字体阻止改写；原位更新/保存/取消；click 点文字、真实手柄转段落；Tab/Shift-U；共同 shape 变换重新绘制并一次 Undo。

`artifacts/component-copy/desktop.json` 记录 4 项实际 Option/Alt-drag 与 Undo 检查且无 pageerror：蒙版保留 placement/link/disabled 和源 bytes，单独 Stroke 保留目标其它效果。核心和生产 ESM 共 19 项新增测试通过（content-transform / layer-component-copy / photoshop-adjustments / photoshop-vector / photoshop-production），另有既有 Photoshop raster 14 项通过。`npm run typecheck` 与 `npm run build` 通过。

这些记录验证对应模块，不替代 Windows 原生验收、完整滤镜像素对照或真实用户模型服务的配置后验收。其它 Agent 负责的共同选择、跨文档 drag、floating pixels、Object box 与画笔手势需以它们最后桌面记录刷新。

## 最终交付补充

alpha.3最终264项核心测试、143项桌面检查、18项Mac打包检查通过。跨文档拖拽/快捷键3项、指针多选/画笔手势11项、浮动像素/Object8项、100MP6项和Camera Raw真实protocol预览3项均有独立JSON且0 pageerror。Mac/Windows各16个运行时bundle与当前out字节一致，模型/图标/26项许可资源一致，zip校验通过。Windows13项静态检查标明`STATIC_PASS_NATIVE_PENDING`；已修复EXE版本/图标、附官方运行库安装脚本，不能将这些等同Windows原生推理/渲染。最终文件见当前实施记录及`artifacts/validation-summary.json`、`artifacts/release-integrity.json`。
