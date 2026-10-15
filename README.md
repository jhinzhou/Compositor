# Compositor Electron

Compositor 的 Electron/Vue/TypeScript 跨平台实现，当前版本 **0.3.0-alpha.29**。2026-10-13实际 fetch 原版 main 到 [`e8c9e29`](https://github.com/robbietilton/Compositor/commit/e8c9e29701528413cc0e608d61187c1c61790add)，相对87e2283新增4个提交。保留原Swift工作目录和298文件源码快照，兼容行为通过本项目共享命令链移植；详见[最新上游审计](docs/UPSTREAM_ALPHA25_E8C9E29_AUDIT_2026-10-13.md)。Windows真机与HDR显示仍独立验收。


alpha.29 使用 REA/Ghidra 原生证据优化现有功能，再补工具链：Photoshop 透视自动尺寸在56组实测几何上匹配，并将画布取整的像素相位用于自动裁剪；已有默认D5修补改用原生confidence金字塔和1 px ROI，19组旧与8组新实测最多差2个RGB通道、每通道1字节。补齐单行/单列选框、铅笔、油漆桶、减淡/加深/海绵、历史/艺术历史画笔、混合器画笔、Frame和可编辑Bezier路径，各自接共享命令、撤销与工程保存。Frame保留完整源图与独立clip；路径可转选区、填充和创建实时更新的矢量蒙版。新工具的功能验收与Photoshop像素等效分别记录：油漆桶硬/no-AA原生样本RGBA全一致；tonal、Art History和Mixer为明确近似模型，复杂AA/发丝、高频透视采样和透明修补仍有缺口。验收见[alpha.29报告](docs/PHOTOSHOP_ALPHA29_ACCEPTANCE_2026-10-14.md)、[工具链](docs/PHOTOSHOP_TOOLBAR_ALPHA29_2026-10-14.md)、[REA修补](docs/PATCH_REA_PYRAMID_ALPHA29_2026-10-14.md)、[Frame与Path](docs/FRAME_VECTOR_PATH_2026-10-14.md)。

alpha.28 本批按用户要求收尾：已有左侧工具按Photoshop相对顺序排列，普通/背景/魔术橡皮擦设独立E组，Shift+E轮换，子工具图标、勾号与记忆同步；R为Rotate View，Blur/Smudge移到渐变后。背景与魔术擦除接入共享预览/事务，RGB16保留高位数据，HDR明确拒绝；全部图层取样先检查16MP预算和修订。两组关闭AA的魔术擦除原生参考alpha/可见RGB/预乘RGB逐像素一致，AA参考仍有256个alpha差异，背景擦除尚未完成原生效果验证。透视尺寸与全图放大采样有量化改进；高频缩小、Patch抗锯齿/软尾及部分工具仍未对齐。完整缺项标记见[侧栏工具清单](docs/PHOTOSHOP_TOOLBAR_ALPHA28_2026-10-14.md)，本批验证范围与新版路径见[alpha.28验收](docs/PHOTOSHOP_ALPHA28_ACCEPTANCE_2026-10-14.md)。历史alpha.26/27验证不算alpha.28重新验收，Windows/HDR显示和全部Photoshop效果均未宣称完成。

alpha.26 修正Photoshop配置透视框拖动终点和源边界角点语义；自动尺寸恢复有效透视比例，结合最长源边和角点最大源像素面积密度估算尺度。10个原生文档中心/GUI案例尺寸总误差570→4px，9/10完全一致；全部19例1506→190px，14/19完全一致。实际GUI四角387×257精确匹配，独立留出仍为398×265对原生395×264（差3×1px），未宣称完整自动尺寸等价。High quality缩小采样按源映射足迹抗锯齿，8/16/HDR保留原精度并检查实际采样预算。修补仅对无显式羽化、弱覆盖均紧邻50%核心的锐利抗锯齿选区采用内部128核心；羽化、宽软边和无核心选区保留旧软覆盖路径，推断扫描计入预算并支持取消。D5浅木纹MAE/max 1.218065/23→1.206097/14、已公开研究老木纹6.024618/99→3.142408/39、第三自然木纹2.038695/37→1.264435/21，合成0.189286/1不变。新增程序AA样本MAE退步1.352256→1.782872（max12→10）；羽化4保留有效弱覆盖后仍与原生差3.569717/35，不能称效果完全对齐。第三图与程序样本是在首版核心冻结后采集，随后公开用于通用软域安全纠正，最终限定版本不再称完全未见的盲留出。58条定向修补检查通过；没有暴露假的Diffusion参数。实际统一验收和残余见 [alpha.26验收](docs/PHOTOSHOP_ALPHA26_ACCEPTANCE_2026-10-13.md)。

alpha.25 将侧栏分组箭头改成固定4px三角形；Camera Raw增加10组独立重置、修改后才显示eye/reset、隐藏分组保留参数且不参与预览和应用，滚动条避让控件。修复Patch Destination半像素位移偶发错移一列；Patch和红眼按局部工作区计算，支持最多1600万源像素RGB8，工作区分别最多400万/200万。移除和内容感知移动仍限200万源像素，16位/HDR不会静默降级。新增5例Photoshop真实透视输出对照，自动建议尺寸仍存在差异；修补也不能宣称全部Diffusion参数等效。交付、统一验收和剩余差距见 [alpha.25验收](docs/PHOTOSHOP_ALPHA25_ACCEPTANCE_2026-10-13.md)。

alpha.24 增加J组移除、内容感知移动、红眼；侧栏缩小并在低高度窗口使用双列，二级菜单图标/勾号/记忆项一致。快速选择边缘与Photoshop配置的透视采样有原生量化改善。移除使用本地算法，非Adobe生成式AI；历史门禁见 [alpha.24验收](docs/PHOTOSHOP_ALPHA24_ACCEPTANCE_2026-10-13.md)。

alpha.11 接入图片文件夹导入、Gaussian Blur 的5 px默认与保留透明度/画布贴边行为、上游新图标和窄面板修复；新增可交互的实验性边缘细化工作台。可以用命令搜索 **Refine Selection Edges / 细化选区边缘** 打开，绘制确定前景、确定背景和未知区约束，点击 Preview 后应用成选区、蒙版或新图层。低对比、缺少样本和颜色变化仍会失败；没有RGB去杂色、自然发丝或Photoshop等价保证。最新修复算法、RAW与v12工程的最终接入及实际包证据见 [alpha.11验收记录](docs/PHOTOSHOP_ALPHA11_ACCEPTANCE.md)。

本轮完成中文 / English 国际化，标题栏 **ZH / EN** 单击切换，当前语言加粗高亮，切换结果在重启后保留。界面、编辑面板、原生菜单与内置诊断共用词典；工程内容和 MCP 协议值保持原样。实现和验收见 [国际化记录](docs/I18N_IMPLEMENTATION.md)。

手动编辑和 Agent 共用事务服务：**编辑 → MCP → 实际图像预览 → 撤销 → 保存/恢复**。内置 Agent 已接通可配置的 OpenAI-compatible Chat Completions（另支持 Anthropic Messages），密钥在应用内设置并使用系统加密存储。真实厂家服务尚需用户在应用内填写地址、模型和密钥；模拟服务验证不能代替真实服务验收。

本轮 alpha.8 默认使用 **Photoshop 操作配置**：Tab/Shift+Tab 显隐面板、Shift+字母切换工具组、R 旋转视图、Shift+F5 填充、Cmd/Ctrl+E 合并和可见盖印；蒙版缩略图载入白区及灰度选区，支持加减交集。快捷键设置可切回 Compositor，已有自定义键保留。新增 Flow/逐点笔压、图层锁定、对齐与中心分布，并增强 RGB 边缘细化和 PSD/PSB 原生文字、形状、效果、调整层往返。交付范围和验收见 [alpha.8 Photoshop 对齐](docs/PHOTOSHOP_ALIGNMENT_ALPHA8_ACCEPTANCE.md) 与 [PSD 能力矩阵](docs/PHOTOSHOP_FORMAT_SUPPORT.md)。复杂发丝、智能对象和完整 Photoshop PSD 兼容仍有明确缺口。


alpha.10 增加 PSD Raw/RLE 通道合法性检查，修复 RGB16 RLE 和奇数宽度 Raw padding 的实际像素解码；失败导入不会改变现有工程。16bit 输入仍明确转换成 RGBA8，并保留精度降级警告。复杂边缘的 trimap 核心当时仅建立独立合成基准；alpha.11 已接入实验性工作台，能力边界仍保留。详见 [alpha.10 验收记录](docs/PHOTOSHOP_ALPHA10_ACCEPTANCE.md)、[PSD 语料与24项计划](docs/PHOTOSHOP_CORPUS_C2_2026-10-10.md)。

alpha.9 补齐 **Q 快速蒙版、局部选择画笔、命名灰度选区和非破坏蒙版密度/羽化**，并修复裁剪异步收尾、过期草稿及手柄 Esc 取消问题。585 项单元检查、10 组桌面回归、实际包的常用功能/Photoshop 操作配置及真实 MCP 已通过。使用方式和证据见 [alpha.9 常用功能验收](docs/PHOTOSHOP_COMMON_ALPHA9_ACCEPTANCE.md)。命名选区保存于 `.comp`；当前 HDR、完整发丝和 PSD Alpha 通道/智能对象支持仍是后续专题，按 [Photoshop Web 与 HDR 实施计划](docs/PHOTOSHOP_WEB_HDR_ROADMAP_2026-10-10.md) 分批推进。

## 开发与运行

Node.js 22.12+。从仓库获取源码后运行：

```sh
git clone https://github.com/jhinzhou/Compositor.git
cd Compositor
npm ci
npm run dev
```

生产构建：`npm run build`；启动构建版：`npm start`。检查：`npm run check:i18n`、`npm run typecheck`、`npm test`。早期统一验收命令：`npx tsx scripts/check-native-parity.ts`（先运行 `npm run build`），10 组桌面脚本串行执行。alpha.6 的 481 项测试和 65 项桌面聚合检查通过；alpha.7 增至 491 项测试并追加双语桌面验收，打包后的真实 MCP 验证见统一验收记录。alpha.8 当前 543 项测试通过，追加 Photoshop 工作流、Flow/压感和 RGB 主体细化专项；原有 10 组桌面回归通过，打包版操作与真实 MCP 也已验收，见 alpha.8 记录。桌面回归脚本在 `scripts/smoke-*.ts`，会使用临时 profile 和测试工程；鼠标/键盘测试须串行运行，避免系统焦点互相干扰。

alpha.26最终统一工程验收：1955项源码测试及双语/类型/生产构建PASS；最终开发版和实际macOS ARM64包各29组387项PASS，0运行错误/截图替代；包内MCP6项PASS，16个运行文件、模型/图标、28个许可文件和ZIP SHA256一致。Photoshop效果对齐仍为PARTIAL，已披露独立AA均值退步与尺寸、采样、羽化/Diffusion残差；不把工程通过当成效果完全一致。

欢迎页默认 1920 × 1080、透明、72 DPI。最多 8 个文档标签，各有独立历史、视图、选择和保存关联。Mac 当前目录包位于 `release/0.3.0-alpha.29/mac-arm64/Compositor Electron.app`，实际包版本以 Info.plist 为准；Windows 交叉构建不代表 Windows 原生验收。目录包、zip、验证记录与 SHA-256 见实施记录。Windows 历史 alpha.5 包在 `release/0.3.0-alpha.5/win-unpacked`，主体识别的 VC++ 运行库安装脚本和原生待验收项见 [Windows 交付说明](docs/WINDOWS-RELEASE.md)。

升级到 alpha.29 时，先在旧窗口保存工程并退出，再打开 `release/0.3.0-alpha.29/mac-arm64/Compositor Electron.app`。`release/mac-arm64/Compositor Electron.app` 是保留的 alpha.2 历史包，多数工具图标仍为禁用占位；旧发布目录均保留。macOS 可能复用仍在运行的旧实例，双击另一个路径不能保证切换版本。新增旋转视图工具；Photoshop 配置使用 Shift+W 轮换对象选区、快速选择与魔棒，Compositor 配置保留 W/Tab 行为。alpha.6 已补齐实际画笔/修复预览、持续变换、复合选区轮廓、默认裁剪框、文字/形状真实合成及上下文快捷键等流程；模型、字体、大图架构与视口采样仍有明确差异，见验收表。

alpha.12 已完成 v12 工程中 PNG16 sRGB 图层的读取、保存、撤销重做与恢复，源 PNG 字节及高位深样本保持完整。alpha.13 接入 8 类破坏式调色（色阶、曲线、曝光、反相、色相/饱和度、黑白、色彩平衡、渐变映射）与单层模糊笔刷的 RGBA16 处理，UI/MCP 共用同一路径。画布与滤镜预览使用明确标记的 PNG8 显示副本；渲染导出仍为 8 位，`.comp` 保存保留 16 位。尚不支持的高位深像素操作会明确拒绝；调整图层合成、独立 PNG16 导入、深度重采样、高位深合并和 PSD16 导出继续后续补齐。见 [A1 冻结验收](docs/DEEP_A1_ACCEPTANCE_2026-10-12.md)、[A2 统一验收](docs/DEEP_A2_ACCEPTANCE_2026-10-12.md)、[调色独立参考与边界](docs/DEEP_COLOR_REFERENCE.md)。

## 编辑功能

- 图层与文件夹：整树复制/解组/折叠、跨文档剪贴板和拖拽、Alt 拖动复制、多选共同变换/翻转、合并、24 种混合模式和悬停预览。
- 蒙版与外观：图层/文件夹灰度蒙版、启禁用、链接/独立位置、绘制/填充/反相/羽化、实时剪贴蒙版、6 类效果、12 类调整图层。跨文档复制会烘焙未被一起复制的剪贴依赖。
- 选区与像素：矩形/椭圆、自由/多边形套索、魔棒、色彩范围、加减/反选/扩缩/羽化、轮廓移动、复制/剪切/合并复制、选中像素的移动/缩放/旋转/四角扭曲。
- 绘画与修复：画笔/橡皮、大小/硬度/透明度/平滑/直线笔触、Clone Stamp 单层/全部图层和对齐、三类 Spot Healing、Blur、Smudge/Liquify；渐变端点/径向/色彩/透明度预览、HSV/RGB/Hex 颜色面板与取色。
- 内容与滤镜：可编辑文本、中文/多行、UTF-16 字体/颜色区段、段落框/点文字、形状创建/填充/描边/圆角；Levels/Curves 等基础调整、常规滤镜、Camera Raw、Dither/Scanlines、实时预览/取消/Last Filter。
- 画布与视图：Crop/Canvas Size/Image Size/Trim、翻转/90°旋转、标尺/辅助线/网格/吸附、Navigator、800% 等高倍率视口、F 画布全屏、命令搜索与快捷键设置。
- 智能编辑：本地 U²-NetP ONNX CPU 的 Subject/Object/Remove Background，框选对象，确定性 Content-Aware Fill；任务进度和取消。识别结果会与 macOS Vision 不同。

PNG/JPEG/BMP/GIF 首帧/WebP、TIFF、HEIF/HEIC、SVG 与 RAW 有真实解码路径。PSD/PSB 支持 8-bit RGB 和保留原始通道精度的 16-bit RGB 导入（已验证 sRGB 等效 ICC 或明确报告的无配置文件输入；蒙版和 PSD 写出仍为 8 位），先显示转换报告；八类调整可转换，水平文字、简单矢量形状和六类效果具有原生导出结构，未支持特性明确报告。导出 PNG/JPEG/单页 PDF，含尺寸、DPI、质量、背景、预览和物理尺寸；额外提供 PSD/PSB 导出并报告结构降级。

## Agent 与 MCP

点击标题栏 **Agent** 配置模型服务：协议、完整 API URL、模型名和 API Key。使用 OpenAI-compatible 时，根 URL 或 `/v1` 会补成 `/v1/chat/completions`，厂家特殊路径请填写完整端点。模型必须支持工具调用；若要通过 `document.preview` 看图，还需模型支持图像输入。不要把密钥写进工程或发到聊天。

流式响应、工具执行、Stop、修改前后预览、Undo Agent Task 已接通真实 MCP。任务绑定开始时的文档；人工编辑造成 revision 冲突时会拒绝过期写入。整轮回退只撤销历史顶部属于该任务的连续事务，保护后续人工修改。

外部 Agent：点击标题栏终端图标，复制应用生成的 MCP 配置。打包版使用 Electron 自带 Node，无需另外安装 Node。12 个 MCP 工具和共享动作见 [MCP 协议](docs/MCP.md)。MCP 不开放任意路径、shell 或 JavaScript。

## 工程、容量与边界

`.comp` 目录包为 manifest.json + images 中的 PNG，可读取原版 v1–11，以及仅含8-bit资源的v12，并写出 v11（v12读取/保存版本有明确警告；16-bit v12返回 NEEDS_CONVERSION），保留 ID、未知 JSON 和不可变像素版本。蒙版/剪贴/调整/效果/文字/形状已经纳入原版读写回归；44 层/34 资产的综合工程经过官方 1.4.8 实际 Swift ProjectStore 双向读写，规范化元数据相同、资产 RGBA 最大差值 0。该结果是文件互操作证据，不等于所有画面的像素一致。

限制为单边 30,000 px、单表面 200 MP、10,000 图层、512 MiB 编码资产、4 MiB manifest；文档/历史/多文档保留预算按物理 RAM/16 计算并限制在 200–800 MP。视口缓冲限制 16 MP；部分选中像素变换仍受独立资源预算约束，ROI 移动实测 100 MP；智能识别 32 MP。RAW/HEIF/TIFF 有独立输入/解码工作预算。允许的画布尺寸不代表每个操作都能在该尺寸上完成，也不代表 10,000 层与 200 MP 的组合性能已全面验证。

显示/合成表面为 RGBA8/sRGB；v12 PNG16 图层与上述调色/模糊操作使用 RGBA16/sRGB 工作数据。TIFF 支持无压缩/LZW/Deflate/PackBits、strip/tile、平面分离及无符号 1/2/4/8/16-bit RGB/灰度/索引；16 位量化与 ICC 转换会报告。JPEG/CCITT TIFF、HDR、CMYK、LUT/灰度 ICC 需预转换。字体和栅格化会随系统变化；缺字体阻止重绘并保留原 PNG。大半径 Gaussian/Motion 已使用集成核 FFT 并有原版参考；Camera Raw 的 763 张实测表和最新 C oracle、其他插值对照范围见统一验收和实施记录。

Save 检测外部写入并使用暂存/备份/日志更新工程。Save As/Copy 要求新名称，避免覆盖另一个现有包。后台写盘绑定捕获 revision；后续编辑仍保持未保存状态。外部干净工程自动重载，存在本地编辑时提供 Reload/Keep/Save Copy；坏文件保留当前文档。Recovery 用独立副本恢复到新 session。

当前为未签名 alpha；正式签名、公证、安装器、更新服务及原生 Windows 的文件锁/Ctrl/Alt/DPI 验收仍是独立交付条件。原仓库与已安装的原版应用没有被替换。

## 源码仓库与生成文件

源码仓库：[jhinzhou/Compositor](https://github.com/jhinzhou/Compositor)。`.gitignore` 排除依赖、`out/` 构建输出、`release/` 发布包、`artifacts/` 测试/运行产物、缓存、临时配置、环境密钥和签名文件；这些文件仍保留在本地。

`build/icon.*`、`fixtures/` 中的模型/示例工程/参考数据、`tests/fixtures/`、锁文件和许可证附带源码归档属于运行、构建或测试输入，会随源码提交。历史报告中指向 `/Users/zhoujin/...`、PS 根目录或 `artifacts/` 的链接是本机验收证据；克隆仓库不会包含这些本地输出。核心测试和构建不要求这些历史输出；部分原版参考生成器需另备上游源码，主体照片及大图实操脚本需提供对应测试输入。

## 许可

工程沿用 MIT；上游算法、图标和独立参考提取的许可、ONNX/RAW/HEIF/CanvasKit 等第三方声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 与 `licenses/`。开发用 Swift/C/Metal oracle 不进入运行时，产品没有 AppKit/Core Image/Swift 依赖。


## alpha.16 上游同步与高位深/HDR（统一验收通过）

本轮源码同步到官方 `f5ae5bad0b25b32dda9f254e62d2f07f59478698`：新增真实图层位深转换、New 页图片粘贴与按图片尺寸建画布、整个标签栏拖放、图层/文件夹旋转边界自动建文档、调整/效果菜单和 JPEG/PNG + More 导出。PNG16与独立浮点HDR源通过共同命令/历史链路编辑；v13工程保存EXR资产，Export As提供16位PNG和HDR EXR。旧快速PNG/JPEG/PDF与屏幕/MCP预览保持8位SDR。

HDR工作数据为Float32 premultiplied extended-sRGB，独立于RGBA16整数数据；EXR/Radiance和受支持的浮点TIFF走显式颜色转换。EXR限制为平面scanline HALF/FLOAT RGB(A)与NONE/RLE/ZIPS/ZIP，浮点TIFF限制为classic RGB(A) IEEE16/32/64 strips（chunky/planar）与NONE/LZW/Deflate。HDR合成当前支持6种混合模式，可见栅格效果和超出支持范围的栈明确拒绝。深层修复/仿制/内容填充/栅格合并及盖印、all-layers采样、像素剪贴板、高位深PSD、HDR Camera Raw几何/光学校正及portable滤镜与Core Image的效果仍有差异；原生EDR/HDR显示与Windows执行未验收。

本节描述当前源码接入，不覆盖旧版本验收结果。开发版与未签名macOS ARM64目录包的5组114项运行检查分别通过，1,162项源码检查和既有10组桌面回归通过，包含真实MCP stdio共享动作/Undo；目录包不是已签名正式发布。详见[alpha.16统一验收](docs/HIGH_DEPTH_ALPHA16_ACCEPTANCE_2026-10-12.md)。范围与剩余差异见[本轮上游审计](docs/UPSTREAM_F5AE5BA_DELTA_AUDIT_2026-10-12.md)和[UI接入记录](docs/UPSTREAM_UI_DELTA_F5AE5BA_2026-10-12.md)。

alpha.16破坏滤镜已接入全部19个现有类型的UNORM16/HDR源，空间Gaussian/Motion/Bloom直接Float32，其余旧字节工具通过原版multi-probe桥重建。C参考证明桥的数值，不等于原生Camera Raw/Core Image完整效果；HDR Camera Raw几何/光学warp仍拒绝。Dither保持高位深是有意扩展，上游此工具明确降8位。范围、探针参考和工作预算见[高位深滤镜参考](docs/HIGH_DEPTH_FILTER_REFERENCE.md)，开发版与未签名ARM64目录包分别完成114项运行检查，详见[统一验收](docs/HIGH_DEPTH_ALPHA16_ACCEPTANCE_2026-10-12.md)。

高位深调整层源码接入12类（原八类调色 + Grain/AddNoise/Gaussian/Motion）。Normal Gaussian/Motion在同尺寸文档网格卷积RGBA，并按蒙版×opacity对四通道插值；nonNormal与Gaussian Preserve Transparency恢复原alpha，按原版规则保留透明边缘行为。开发版与未签名ARM64目录包分别完成HDR19、上游UI10、deep composite15、deep tools18和双语布局52项，共114项；剪贴板UI检查使用进程内mock，不改用户系统剪贴板。

## alpha.17 Photoshop研究与首批对齐

实际操作 Photoshop27.11.0，使用自制色块/透明边/阶跃/PNG16生成47个成功参考文件，归档真实通道和效果黄金数据。修复普通HSL明度顺序、曲线横向端点、软选区组合/轮廓、工具栏内部拖选，新增显式可撤销栅格化和绘画目标切换保留工具。真实RGB16 PSD/PSB读取保留canonical PNG16与独立display，不再静默量化；PSD写出/蒙版仍为8位，RGB32和任意ICC不在本批范围。

HDR普通raster流式合成与跨进程导入预算已优化；单层4K真实EXR合成/SDR预览通过。效果尚有Gaussian/羽化/复杂发丝等差异，HDR显示与Windows另行验证。详见 [原生研究](docs/PHOTOSHOP_NATIVE_RESEARCH_2026-10-12.md)、[误差表](docs/PHOTOSHOP_EFFECT_MEASUREMENTS_2026-10-12.md)、[性能](docs/PHOTOSHOP_CODE_PERFORMANCE_ALPHA17_2026-10-12.md)和[统一验收](docs/PHOTOSHOP_ALPHA17_ACCEPTANCE_2026-10-12.md)。

## alpha.18 原生 Photoshop 效果研究第二批

新增53个原生Photoshop羽化/圆笔输出，分别归档实际Alpha参考与参数读回。Photoshop配置修复选区羽化幅度、柔圆尾部、连续硬度和Flow到100%的分支跳变，新增间距百分比及Hardness/Opacity百分比。RGBA16/HDR画笔和擦除直接合成原始高位深源，保留低强度变化、负值和超白；显示PNG8不再作为绘画源。旧Compositor配置保留原覆盖语义。研究范围、误差和仍有的硬圆/中等硬度/量化差异见[原生研究](docs/PHOTOSHOP_ALPHA18_NATIVE_EFFECTS_2026-10-12.md)，当前门禁见[alpha.18验收](docs/PHOTOSHOP_ALPHA18_ACCEPTANCE_2026-10-12.md)。

alpha.18统一门禁：1,294项源码测试、国际化/类型/构建通过，开发版与实际未签名macOS ARM64包各通过13组187项桌面检查，含真实MCP PS模型/Spacing低强度PNG16绘画及Undo。新包：`release/0.3.0-alpha.18/mac-arm64/Compositor Electron.app`，具体限制和完整证据见上述验收报告。

## alpha.19 硬圆、裁剪与蒙版修复

继续真实Photoshop对照，硬圆边缘和程序dab相位使用多尺寸／小数落点参考校验；修复按住鼠标Enter裁剪、owner指针及blur租约清理，以及有限PSD蒙版外围覆盖、单独灰度视图、滤镜预览/提交和过期原参数。源码1,326项测试通过；最终开发版及macOS ARM64目录包分别通过14组198项桌面检查。具体实际桌面、安装包、误差与剩余未验证项见[alpha.19验收](docs/PHOTOSHOP_ALPHA19_ACCEPTANCE_2026-10-12.md)。


## alpha.20 画笔、蒙版羽化与非破坏裁剪

继续使用本机Photoshop 27.11.0实际操作和保存输出对照。112个RGB8圆笔参考中37例误差改善、70例保持、5例轻微退化；修正小笔尖硬度肩部和低Flow连续落点。蒙版属性增加显式Photoshop羽化模型与完整文档边界语义，16组原生参考中贴边max123→1/255，另修复1:1显示重复插值。非破坏裁剪明确保留源像素，可保存重开并扩画布恢复；RGBA8/16/HDR保持完整源。关闭／切换文档时的过期高位深渲染不再弹出旧错误或中断最新文档绘制。

统一验收：**1,442项源码测试**及国际化／类型／构建PASS，开发版和macOS ARM64实际目录包**各17组221项桌面检查PASS**。其中每种runtime的52项布局检查均使用真实截图，无fallback；新增画笔4、蒙版12、裁剪7项包含在总数内。

实际误差、原生取证、可复验命令与剩余缺项见[alpha.20验收](docs/PHOTOSHOP_ALPHA20_ACCEPTANCE_2026-10-12.md)。[Photoshop功能与效果完整目录](docs/PHOTOSHOP_FUNCTION_EFFECT_CATALOG_2026-10-12.md)按112能力族及具体工具／滤镜／混合模式／调整／图层样式／快捷键列出项目现状和后续开发顺序。尚有近硬笔尖、小半径羽化、任意变换蒙版、裁剪删除像素、智能对象／专业颜色管理／复杂PSD等差距。

## alpha.21 近硬笔尖、小半径羽化和裁剪几何

在本机 Photoshop 27.11.0 继续采集实际参数和保存输出。近硬圆笔保留原有112项参考，并新增46项不同参数参考；64px/95%硬度边缘误差降低，宽尺寸与100%硬度仍有残差。小半径蒙版属性羽化以连续小核计算，1–2源像素过渡到原宽核，2px以上及旧Compositor模型保持原路径；0.3px实际参考误差降至0，1px降至2/255，0.6和0.7px仍有残差。

Crop工具增加拉直参考线和透视四角模式。拉直旋转图层/蒙版位置并自动计算内接裁剪框，保留完整8/16/HDR源。透视裁剪重新采样各栅格层，保留工作位深，支持Undo/Redo和工程保存；建议尺寸按平均对边长度计算，Photoshop自动输出尺寸不同，可手动设定。当前专用透视裁剪对未栅格化文字/形状、组、调整、效果、辅助线以及非零属性羽化蒙版会明确拒绝并保持原工程，不宣称完整PSD透视编辑等效。

完整原生测量、桌面与目录包验收、限制见 [alpha.21验收](docs/PHOTOSHOP_ALPHA21_ACCEPTANCE_2026-10-13.md)。

## alpha.22 菜单、隐藏工具、选区与高位屏幕合成

主菜单按 Photoshop 常用顺序和位置排列；已实现的M/L/W/C/J组支持右键、400ms长按或Shift+F10展开，方向键/Enter选择、Esc关闭。Shift+L完整轮换选择画笔/自由套索/多边形，Shift+J轮换两种修复，Shift+C轮换普通裁剪/透视/拉直。截图22工具中6基础可用、4部分实现（10条对应功能链）、12仍缺，详细[侧栏工具清单](docs/TOOL-GROUP-AUDIT-2026-10-13.md)不把相似工具混算。

新增Reselect（Cmd/Ctrl-Shift-D）、All Layers、明确的Reveal All/Selection来源、Smooth/Border参数验证。显式Clear/Reset与快捷键部分恢复已实现；普通Backspace/Delete由renderer管理，避免输入框编辑穿透画布。MCP复用 `selection.reselect`、`selection.modify`的`smooth/border`和`layer.mask.useSelection`；省略useSelection保持旧调用语义，false明确全覆盖，true使用选区。Reselect缓存按session隔离，不写入工程；文档几何变动/对应history跳转清除缓存。

普通RGB16图层也先高位合成再输出RGBA8 SDR画面；unsupported栈和预算使用明确兼容提示，原始PNG16/EXR与Undo保持；隐藏MCP预览、调整预览和保存缩略图明确关闭显示抖动，维持确定性像素。PSD RGB8新增嵌入sRGB等效ICC校验，非sRGB要求转换，缺少profile明确按sRGB解释；没有实现通用ICC转换。新增Progressive Blur支持8/16/HDR、数值起终点，尚无拖线或PS Blur Gallery等价声明。

Image > Adjustments新增Threshold和Posterize，支持RGB8/16且拒绝HDR。真实PS27.11原生DOM控制样本修正亮度/分桶规则；透明RGB16阈值在一个cutoff边界像素仍有premultiplied表示差异，完整残差见[原生研究报告](docs/PHOTOSHOP_THRESHOLD_POSTERIZE_C080_2026-10-13.md)。该历史批次统一门禁和包路径见[alpha.22验收](docs/PHOTOSHOP_ALPHA22_ACCEPTANCE_2026-10-13.md)，当时剩余66部分与32缺少按[执行计划](docs/PHOTOSHOP_ALIGNMENT_PLAN_2026-10-13.md)继续分批处理，该历史批次目录为14/66/32，不冒充全部对齐。

alpha.22最终验收：国际化/类型/构建及1,712项源码测试PASS；macOS ARM64开发版与实际未签名目录包各22套件280项全部PASS，含每种runtime52项真实布局检查；包内16个构建文件、模型/图标、28个许可证文件及ZIP SHA256一致。门禁和残差见上述alpha.22报告，不构成完整Photoshop、Windows或HDR显示等效证明。

历史alpha.22桌面验收使用以下四条串行命令；不要同时启动多个鼠标/键盘套件。目录包验收需为每条命令设置`COMPOSITOR_EXECUTABLE`为实际包可执行文件路径。源码统一检查使用`npm run check`。

```sh
npx tsx scripts/smoke-photoshop-alpha22.ts
npx tsx scripts/smoke-deep-screen-alpha22.ts
npx tsx scripts/check-photoshop-stage-release.ts artifacts/photoshop-stage-release
npx tsx scripts/check-high-depth-release.ts artifacts/high-depth-release
```

## alpha.23：选择、修复、透视与 Info 工具

本轮新增 Magnetic Lasso、真正图像驱动的 Quick Selection、RGB8 Patch Source/Destination、持久颜色取样器与 Ruler，补齐 L/W/J/I 工具组、Shift 字母轮换和最后子工具恢复。`[` / `]` 调整快速选择笔径或磁性吸附宽度，Info 在 Window 菜单/F8。闭合自由套索使用整条路径 bounds，四点透视输入支持逐点、无效第四点重试和未完成拒绝提交。原生窗口失焦与 DOM blur 分开处理，避免 Electron 不转发 DOM blur 时遗留交互锁。

修补当前仅 RGB8 当前栅格层；采样读数区分原始8/16/HDR与合成。透视保持原源工作位深并参与Undo、工程保存重开，仍与Photoshop自动尺寸/插值存在已量化差距。五个新增子工具不代表Photoshop全部私有参数和效果等价。详细入口、限制与验收见 [alpha.23报告](docs/PHOTOSHOP_ALPHA23_ACCEPTANCE_2026-10-13.md)、[侧栏22工具](docs/TOOL-GROUP-AUDIT-2026-10-13.md)、[112族目录](docs/PHOTOSHOP_FUNCTION_EFFECT_CATALOG_2026-10-12.md)。

本批统一验收入口：`npm run check` 后运行 `npx tsx scripts/check-alpha23-runtime.ts artifacts/alpha23-runtime`，25套桌面流程串行执行；目录包验收设置 `COMPOSITOR_EXECUTABLE` 为上面的真实可执行文件。每套前后核对运行时SHA256，保留失败记录，不使用截图替代。

alpha.23最终验收：1828项源码测试及国际化/类型/构建通过，真实开发版和实际未签名macOS ARM64包各25套/324项PASS，各含52项布局检查，0错误/截图替代；完整性与剩余PS效果差异见本批验收报告。

## alpha.24：紧凑工具栏与修复工具

J组新增移除、内容感知移动和红眼，Shift+J按六项顺序循环；内容感知移动先拖动预览，再Enter提交或Esc取消。二级菜单具有独立图标与勾号，外层按钮/名称/命令面板与当前或记忆子工具一致。侧栏18px图标、30px按钮，矮窗口缩小或使用双列；四种实际窗口尺寸无工具/色板裁切。

本批1875项源码测试、国际化/类型/构建通过；实际开发版和未签名macOS ARM64目录包各27套/364项通过。当前RGB8和像素预算、原生效果残差及发布证据见[alpha.24统一验收](docs/PHOTOSHOP_ALPHA24_ACCEPTANCE_2026-10-13.md)，不表示完整Photoshop效果或Windows原生验收。


## alpha.27：等比例缩小、软选区修补和最新上游

本批同步官方 main `43d691b67995e924965bcd520f8b300f96b7d5b8`，接入空间自适应 Camera Raw Shadows 和 RAW 导入后直接打开 Camera Raw，保留实际提交图层/文档目标、顺序打开与取消边界。Swift版本及Sparkle发布源保持平台边界。Shadows与上游原生C的22组对照中20组RGBA exact，两大图各仅1/2个RGB通道差1；本机Photoshop缺可用Camera Raw入口，原生PS效果未验。

High quality等比例仿射缩小使用完整归一化Lanczos3，独立比例/旋转样本明显改善；新增实际鼠标透视292×163自动尺寸精确匹配。Patch羽化2/6的MAE降至0.7282/0.3378，两组独立低峰选区完整RGBA字节一致，真实鼠标与主进程命令一致；跨图层预算、原始16/HDR源、取消、Undo/Redo和保存重开均保留。

最终**2021项源码测试及国际化/类型/构建PASS；开发版与实际未签名macOS ARM64目录包各32套413检查PASS；安装包MCP6检查PASS**。统一入口 `npx tsx scripts/check-alpha27-runtime.ts artifacts/alpha27-runtime`，目录包设置COMPOSITOR_EXECUTABLE；所有原生输入与desktop套件串行执行。强透视自动尺寸、高频/放大采样、Patch AA/精确羽化尾部、Diffusion1–7映射和深位Patch仍部分欠缺；独立退步候选未合入。工程PASS与Photoshop效果PARTIAL分开，见[alpha.27统一验收](docs/PHOTOSHOP_ALPHA27_ACCEPTANCE_2026-10-14.md)。
