# Compositor Electron

Compositor 的 Electron/Vue/TypeScript 跨平台实现，当前版本 **0.3.0-alpha.7**。最新原版源码固定快照为 `d0ec2f35b6358108ac3e59593da1688deb83a559`，完整 Git tree 已核验；原始 checkout 保持 `75147a2`。本轮实施原版差异方案并移植新增 9 个提交涉及的 WebP、Camera Raw、尺寸调整和标签页规则。当前结果及已确认边界见 [alpha.6 统一验收](docs/NATIVE_PARITY_ALPHA6_ACCEPTANCE.md)，旧 alpha.5 同图证据见 [原版操作对照](docs/NATIVE_OPERATION_COMPARISON.md)，原方案保留在 [PS 根目录](../Compositor_原版对齐与Photoshop能力差距评估_2026-10-10.md)。Windows 原生验证与 Photoshop 能力增强按用户要求延后。

本轮完成中文 / English 国际化，标题栏 **ZH / EN** 单击切换，当前语言加粗高亮，切换结果在重启后保留。界面、编辑面板、原生菜单与内置诊断共用词典；工程内容和 MCP 协议值保持原样。实现和验收见 [国际化记录](docs/I18N_IMPLEMENTATION.md)。

手动编辑和 Agent 共用事务服务：**编辑 → MCP → 实际图像预览 → 撤销 → 保存/恢复**。内置 Agent 已接通可配置的 OpenAI-compatible Chat Completions（另支持 Anthropic Messages），密钥在应用内设置并使用系统加密存储。真实厂家服务尚需用户在应用内填写地址、模型和密钥；模拟服务验证不能代替真实服务验收。

## 开发与运行

Node.js 22.12+。从仓库获取源码后运行：

```sh
git clone https://github.com/jhinzhou/Compositor.git
cd Compositor
npm ci
npm run dev
```

生产构建：`npm run build`；启动构建版：`npm start`。检查：`npm run check:i18n`、`npm run typecheck`、`npm test`。当前统一验收命令：`npx tsx scripts/check-native-parity.ts`（先运行 `npm run build`），10 组桌面脚本串行执行。alpha.6 的 481 项测试和 65 项桌面聚合检查通过；alpha.7 增至 491 项测试并追加双语桌面验收，打包后的真实 MCP 验证见统一验收记录。桌面回归脚本在 `scripts/smoke-*.ts`，会使用临时 profile 和测试工程；鼠标/键盘测试须串行运行，避免系统焦点互相干扰。

欢迎页默认 1920 × 1080、透明、72 DPI。最多 8 个文档标签，各有独立历史、视图、选择和保存关联。Mac 当前目录包位于 `release/0.3.0-alpha.7/mac-arm64/Compositor Electron.app`，实际包版本以 Info.plist 为准；Windows 交叉构建不代表 Windows 原生验收。目录包、zip、验证记录与 SHA-256 见实施记录。Windows 历史 alpha.5 包在 `release/0.3.0-alpha.5/win-unpacked`，主体识别的 VC++ 运行库安装脚本和原生待验收项见 [Windows 交付说明](docs/WINDOWS-RELEASE.md)。

升级到 alpha.7 时，先在旧窗口保存工程并退出，再打开 `release/0.3.0-alpha.7/mac-arm64/Compositor Electron.app`。`release/mac-arm64/Compositor Electron.app` 是保留的 alpha.2 历史包，多数工具图标仍为禁用占位；旧发布目录均保留。macOS 可能复用仍在运行的旧实例，双击另一个路径不能保证切换版本。工具栏共 15 个按钮，W/Tab 切换魔棒与对象选区。alpha.6 已补齐实际画笔/修复预览、持续变换、复合选区轮廓、默认裁剪框、文字/形状真实合成及上下文快捷键等流程；模型、字体、大图架构与视口采样仍有明确差异，见验收表。

## 编辑功能

- 图层与文件夹：整树复制/解组/折叠、跨文档剪贴板和拖拽、Alt 拖动复制、多选共同变换/翻转、合并、24 种混合模式和悬停预览。
- 蒙版与外观：图层/文件夹灰度蒙版、启禁用、链接/独立位置、绘制/填充/反相/羽化、实时剪贴蒙版、6 类效果、12 类调整图层。跨文档复制会烘焙未被一起复制的剪贴依赖。
- 选区与像素：矩形/椭圆、自由/多边形套索、魔棒、色彩范围、加减/反选/扩缩/羽化、轮廓移动、复制/剪切/合并复制、选中像素的移动/缩放/旋转/四角扭曲。
- 绘画与修复：画笔/橡皮、大小/硬度/透明度/平滑/直线笔触、Clone Stamp 单层/全部图层和对齐、三类 Spot Healing、Blur、Smudge/Liquify；渐变端点/径向/色彩/透明度预览、HSV/RGB/Hex 颜色面板与取色。
- 内容与滤镜：可编辑文本、中文/多行、UTF-16 字体/颜色区段、段落框/点文字、形状创建/填充/描边/圆角；Levels/Curves 等基础调整、常规滤镜、Camera Raw、Dither/Scanlines、实时预览/取消/Last Filter。
- 画布与视图：Crop/Canvas Size/Image Size/Trim、翻转/90°旋转、标尺/辅助线/网格/吸附、Navigator、800% 等高倍率视口、F 画布全屏、命令搜索与快捷键设置。
- 智能编辑：本地 U²-NetP ONNX CPU 的 Subject/Object/Remove Background，框选对象，确定性 Content-Aware Fill；任务进度和取消。识别结果会与 macOS Vision 不同。

PNG/JPEG/BMP/GIF 首帧/WebP、TIFF、HEIF/HEIC、SVG 与 RAW 有真实解码路径。PSD/PSB 8-bit RGB 导入先显示转换报告；原版可解析的 Levels/Curves/Hue-Saturation 调整图层转换为可编辑结构，未支持特性明确报告。导出 PNG/JPEG/单页 PDF，含尺寸、DPI、质量、背景、预览和物理尺寸；额外提供 PSD/PSB 导出并报告结构降级。

## Agent 与 MCP

点击标题栏 **Agent** 配置模型服务：协议、完整 API URL、模型名和 API Key。使用 OpenAI-compatible 时，根 URL 或 `/v1` 会补成 `/v1/chat/completions`，厂家特殊路径请填写完整端点。模型必须支持工具调用；若要通过 `document.preview` 看图，还需模型支持图像输入。不要把密钥写进工程或发到聊天。

流式响应、工具执行、Stop、修改前后预览、Undo Agent Task 已接通真实 MCP。任务绑定开始时的文档；人工编辑造成 revision 冲突时会拒绝过期写入。整轮回退只撤销历史顶部属于该任务的连续事务，保护后续人工修改。

外部 Agent：点击标题栏终端图标，复制应用生成的 MCP 配置。打包版使用 Electron 自带 Node，无需另外安装 Node。12 个 MCP 工具和共享动作见 [MCP 协议](docs/MCP.md)。MCP 不开放任意路径、shell 或 JavaScript。

## 工程、容量与边界

`.comp` 目录包为 manifest.json + images 中的 PNG，可读取原版 v1–11 并写出 v11，保留 ID、未知 JSON 和不可变像素版本。蒙版/剪贴/调整/效果/文字/形状已经纳入原版读写回归；44 层/34 资产的综合工程经过官方 1.4.8 实际 Swift ProjectStore 双向读写，规范化元数据相同、资产 RGBA 最大差值 0。该结果是文件互操作证据，不等于所有画面的像素一致。

限制为单边 30,000 px、单表面 200 MP、10,000 图层、512 MiB 编码资产、4 MiB manifest；文档/历史/多文档保留预算按物理 RAM/16 计算并限制在 200–800 MP。视口缓冲限制 16 MP；部分选中像素变换仍受独立资源预算约束，ROI 移动实测 100 MP；智能识别 32 MP。RAW/HEIF/TIFF 有独立输入/解码工作预算。允许的画布尺寸不代表每个操作都能在该尺寸上完成，也不代表 10,000 层与 200 MP 的组合性能已全面验证。

工作表面为 RGBA8/sRGB。TIFF 支持无压缩/LZW/Deflate/PackBits、strip/tile、平面分离及无符号 1/2/4/8/16-bit RGB/灰度/索引；16 位量化与 ICC 转换会报告。JPEG/CCITT TIFF、HDR、CMYK、LUT/灰度 ICC 需预转换。字体和栅格化会随系统变化；缺字体阻止重绘并保留原 PNG。大半径 Gaussian/Motion 已使用集成核 FFT 并有原版参考；Camera Raw 的 763 张实测表和最新 C oracle、其他插值对照范围见统一验收和实施记录。

Save 检测外部写入并使用暂存/备份/日志更新工程。Save As/Copy 要求新名称，避免覆盖另一个现有包。后台写盘绑定捕获 revision；后续编辑仍保持未保存状态。外部干净工程自动重载，存在本地编辑时提供 Reload/Keep/Save Copy；坏文件保留当前文档。Recovery 用独立副本恢复到新 session。

当前为未签名 alpha；正式签名、公证、安装器、更新服务及原生 Windows 的文件锁/Ctrl/Alt/DPI 验收仍是独立交付条件。原仓库与已安装的原版应用没有被替换。

## 源码仓库与生成文件

源码仓库：[jhinzhou/Compositor](https://github.com/jhinzhou/Compositor)。`.gitignore` 排除依赖、`out/` 构建输出、`release/` 发布包、`artifacts/` 测试/运行产物、缓存、临时配置、环境密钥和签名文件；这些文件仍保留在本地。

`build/icon.*`、`fixtures/` 中的模型/示例工程/参考数据、`tests/fixtures/`、锁文件和许可证附带源码归档属于运行、构建或测试输入，会随源码提交。历史报告中指向 `/Users/zhoujin/...`、PS 根目录或 `artifacts/` 的链接是本机验收证据；克隆仓库不会包含这些本地输出。核心测试和构建不要求这些历史输出；部分原版参考生成器需另备上游源码，主体照片及大图实操脚本需提供对应测试输入。

## 许可

工程沿用 MIT；上游算法、图标和独立参考提取的许可、ONNX/RAW/HEIF/CanvasKit 等第三方声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 与 `licenses/`。开发用 Swift/C/Metal oracle 不进入运行时，产品没有 AppKit/Core Image/Swift 依赖。
