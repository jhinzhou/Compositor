# Compositor 原版对齐 alpha.6 验收记录

日期：2026-10-10。工作目录：`/Users/zhoujin/Documents/PS/Compositor_Electron`。本轮只实施原版对齐；Photoshop 能力增强按用户要求延后。

## 参考版本与统计口径

当前 Electron 版本为 **0.3.0-alpha.6**。本轮核验远端 HEAD 为 `d0ec2f35b6358108ac3e59593da1688deb83a559`，相较原参考 `75147a27d90c681215151a6301373dd2b07b7aa2` 新增 9 个提交。最新源码固定快照已拉取至 `../Compositor_Upstream/d0ec2f3`，29 个变更文件逐个核验 Git blob，重建完整 Git tree `0bfc74dd9837696a11f318c0cd9155f7bbef8519`，与上游提交一致。Git fetch 连接超时，因此没有把原仓库伪称为成功 git pull；原仓库保持原提交与干净工作区。证据：`artifacts/upstream-alpha6-source-pull.json`、快照旁 `d0ec2f3-source-provenance.json`。

安装的原应用仍是 1.4.7；历史同图 UI 操作证据和本轮最新源码/C oracle 证据分别使用，不能混称为操作最新原应用。参照：[官方提交](https://github.com/robbietilton/Compositor/commit/d0ec2f35b6358108ac3e59593da1688deb83a559)。

原方案的 **29 个工作包**是差异分组，不是缺少 29 个顶级工具。现分为 **18 组流程/规则已实现并验收、8 组部分对齐且有边界、2 组模型输出差异、1 组发布阶段延后**。这是按下表验收范围分类，不能换算为“像素一致率”。新增源码变更另列 D01–D05，避免更改旧方案编号。

## 原方案 29 项处理结果

| ID / 工作包 | 当前状态 | 本轮结果 | 证据 / 剩余边界 |
| --- | --- | --- | --- |
| C01 魔棒透明色与 alpha | 已实现并验收 | 按 premultiplied RGBA 匹配透明色与 alpha。 | 54 个实际原版 C mask 字节参考；selection-retouch tests |
| C02 魔棒采样参数 | 已实现并验收 | Point/3×3/5×5、This Layer/All Layers、AA 参数已贯通工具栏和协议。 | native-parity-ui.json；parity-protocol/validation.json |
| C03 Color Range完整交互 | 已实现并验收 | 参考色、包含/排除色、Invert、合成图取样与黑白预览；取消保留 revision。 | parity-protocol/validation.json；native-parity-ui.json；8 个原版 C 参考 |
| C04 裁剪框与视图状态 | 已实现并验收 | 默认裁剪框、工作区遮罩与裁前 zoom/pan 的 Undo 恢复。 | native-parity-ui.json；smoke-interaction.ts |
| C05 Select Subject采样与组合 | 已实现并验收 | 主体选区读取 visible composite，支持组合模式、文件夹和空白目标；提交校验 revision。 | subject-mask/editor tests；parity-subject/acceptance.json |
| C06 文档坐标采样与缩小质量 | 部分对齐，有边界 | 当前图层走原版文档坐标 sampler、减半及最终插值。 | document-sampler tests；parity-protocol/validation.json；**边界：**All Layers 仍以 CanvasKit 合成；与 Core Graphics 的采样逐像素一致尚未证明。 |
| C07 复合选区外轮廓 | 已实现并验收 | 由最终复合选区生成 boolean 外轮廓，清除内部消失边。 | selection-outline tests；100 MP outline benchmark |
| C08 羽化、扩缩与AA | 部分对齐，有边界 | Gaussian 羽化平方和累积、圆形扩缩与 AA 覆盖已替换旧算法。 | selection coverage/Gaussian/morphology tests；**边界：**算法和参数规则已对齐；未证明所有 Core Graphics 栅格化边缘逐字节一致。 |
| C09 画笔/橡皮/修复实时反馈 | 部分对齐，有边界 | 画笔、橡皮与修复使用实际像素 worker 预览，提交复用相同内核。 | native-parity-ui.json；pointer-brush/desktop.json；**边界：**常用图像预览/提交已核验；所有大图尺寸的逐帧延迟和原版性能尚未统一验收。 |
| C10 长笔画与复杂选区预算 | 部分对齐，有边界 | 移除 2048 点丢弃，保留端点/折返压缩，ROI 分段与明确错误取代静默截断。 | stroke/brush/selection-outline tests；**边界：**仍有 100k 笔画点、100k 轮廓 runs、复杂选区和访问像素等显式资源预算。 |
| C11 大图完整操作能力 | 部分对齐，有边界 | 选中像素移动按 ROI 处理，100 MP 实图移动与 Undo/Redo 完成。 | parity-capacity/selection-roi-100000000.json；**边界：**全图 PNG 解码/编码仍约 2.02 GB 峰值；未完成全部操作分块架构、200 MP 全工具、RAW/HEIF 大图验收；识别 32 MP 等限制保留。 |
| C12 大Gaussian/Motion精度 | 已实现并验收 | 大半径 Gaussian/Motion 使用集成核 FFT，替换三 box 近似。 | parity-capacity/large-blur-reference.json；14 组实际 Core Image 参考；**边界：**参考点最大 premultiplied 通道误差 1；不是任意输入的逐字节承诺。 |
| C13 ASCII桌面与MCP字形 | 部分对齐，有边界 | 桌面和 MCP 共用授权 IBM Plex Mono Bold 95 字符 atlas。 | ASCII shared/render tests；许可证；**边界：**两端已一致，但字形不同于原版 macOS Menlo，不能冒充原版字体输出。 |
| C14 Object单实例点选 | 模型仍有差异 | 单击对象选择改为含软边的连通实例组件。 | subject-mask/object selection tests；**边界：**U²-NetP 的连通区域不能区分所有相互接触对象；不是 Vision 实例模型。 |
| C15 主体与去背景模型输出 | 模型仍有差异 | 合成图/源图选择及去背景路径、取消和事务已对齐。 | parity-subject/acceptance.json；**边界：**继续使用跨平台 U²-NetP；与 Apple Vision 的主体 mask 输出不同。 |
| C16 高级matte及边缘后处理 | 已实现并验收 | Basic/Advanced、Refine/Contrast/Shift Edge 及实际蒙版预览；粗识别缓存复用且取消失效。 | parity-subject/acceptance.json；subject-preview-cache tests；**边界：**参数/流程验收基于本软件模型的粗 mask；继承 C15 模型差异。 |
| C17 工具控制条与字体入口 | 已实现并验收 | Type/Shape/Hand/Zoom 顶部控制条、字体浏览、scrub 和取色对照环；Image Size 单位/比例锁/DPI/Resample/采样面板。 | parity-render/electron-render-acceptance.json；pointer-brush/desktop.json |
| C18 文字原位编辑真实合成 | 已实现并验收 | 文字草稿进入实际图层合成，保留遮挡、蒙版、效果、透明度、blend 和 flip/nonuniform。 | parity-render/electron-render-acceptance.json；**边界：**预览/提交核验不等于 AppKit 字体栅格化完全相同，见 C20。 |
| C19 文字填色与清空语义 | 已实现并验收 | 无选区 Fill 保留文字/字形 alpha 并更新颜色；选区 Fill 栅格化；空文字提交生效。 | editor/content text fill tests |
| C20 文字排版与字体策略 | 部分对齐，有边界 | 系统字体列表、别名映射、加载等待及缺字体保护已落实。 | font catalog/content tests；parity-render/electron-render-acceptance.json；**边界：**CanvasKit/浏览器与 AppKit 字体排版、CJK fallback 和栅格化仍可能不同。 |
| C21 形状拖动预览 | 已实现并验收 | Shift Line 八方向约束与实际预览透明度。 | shape draft tests；parity-render/electron-render-acceptance.json |
| C22 移动/缩放修饰键 | 已实现并验收 | Shift 移动、Alt 中心缩放、跨锚翻转、角投影及组子层同步变换。 | layer-drag/group resize tests；pointer-brush/desktop.json；**边界：**旋转非等比 Image Size 的 affine baking 已补齐，采样边界见 C06。 |
| C23 持续变换与独立蒙版变形 | 已实现并验收 | CmdT 持续草稿；多字段只在 Apply 创建一个事务；独立蒙版四角变形保留 image/link/enable。 | native-parity-ui.json；parity-protocol/validation.json |
| C24 添加蒙版的选区与覆盖保护 | 已实现并验收 | Add Mask 使用选区，Alt 隐藏、已存在拒绝、多选原子保护；清选区与蒙版创建一次 Undo。 | parity-protocol/validation.json；mask/editor tests |
| C25 六种效果坐标阶段 | 部分对齐，有边界 | 六种效果在源层局部坐标及蒙版后、图层变换前计算，导出全分辨率。 | layer effect/CanvasKit render tests；**边界：**视口效果仍有有界缩小缓存；全分辨率导出有 512 MiB 预算；不能保证任意缩放的原版预览像素完全相同。 |
| C26 效果面板及删除目标 | 已实现并验收 | 对应效果面板、数字/slider/scrub、Enter/Esc 及删除选中效果。 | parity-render/electron-render-acceptance.json |
| C27 上下文快捷键 | 已实现并验收 | 选区/图层箭头、Primary 选中像素、文字间距、双数字 opacity 等上下文快捷键。 | native-parity-ui.json；parity-render/electron-render-acceptance.json |
| C28 快捷键改绑完整覆盖 | 已实现并验收 | 统一快捷键 registry，工具/临时模式/Apply/Cancel 改绑，旧组合不再执行。 | shortcuts tests；parity-render/electron-render-acceptance.json |
| C29 签名、安装与自动更新 | 发布阶段延后 | 提供当前 macOS unsigned alpha 目录包、zip 与完整性校验。 | release-integrity.json；packaged upstream smoke；**边界：**按用户顺序延期 Windows 原生验收、正式签名/公证、安装器和更新服务。 |

## 最新上游增量

| ID | 变更 | 当前结果 |
| --- | --- | --- |
| D01 | 尺寸变化和调整时保留 effects/live text | 实际 Image Size 时效果像素参数按 `sqrt(sx×sy)` 缩放；相同尺寸/仅 DPI 变更保持文字及资产；所有目标像素量在解码/分配前预检，五层各 200 MP 超限时零解码并保留原 state；Canvas Size/Crop/Trim/filter 不无故移除效果。新增保存重开、独立 mask 与 Undo 测试。旋转/翻转层的非等比 shear 按原版烘焙到 upright PNG/implicit mask，独立 mask placement 用原版 QR 缩放且 bytes 保持。32 组 CG 参考的 bounds 全同、image 31/32 和 mask 29/32 全同；精确像素相位/外边缘仍有差异，归于 C06。Image Size 面板补单位、比例锁、打印尺寸/DPI 联动、Resample 和采样。 |
| D02 | WebP 导入 | 原有真实解码已具备；通过原版新增的有损/无损、透明像素 fixture 在实际 import dialog 的验证。 |
| D03 | Camera Raw 色彩匹配 | CRT3 763 张实测表、Mixer/Calibration、参数曲线、Grading 四轮及 Blending/Balance、两种 vignette 已移植；最新原版 C 的 57 个实际图像 case 通道误差 ≤1。 |
| D04 | Camera Raw 预览加速 | 条件满足时折叠为一次 LUT；亮度统计缓存、图片解码 Promise 及 scopes 缓存；失败重试与迟到结果保护。相同 1024×768 输入的 shared Node 热缓存核耗时中位数 186.8ms，对照三遍查询 658.3ms，3.52×。不是完整 Electron 延迟，也不宣称原版“5–20×”。 |
| D05 | 标签页 Untitled 规则 | 唯一空白页隐藏关闭按钮且 Primary W 不关；新页使用最小空闲编号；最后实际工程关闭后回到干净 Untitled。 |

CRT3 资源保持压缩 delta planes，仅存 1,779,975 字节压缩数据；首次解码为 11,245,857 字节并核验 SHA256。`pako` 与 IBM Plex Mono 字形许可证已随包交付。详情见 [Camera Raw 参考记录](CAMERA_RAW_UPSTREAM_PARITY.md)。

## 统一验收

全部桌面脚本使用临时 profile/工程和本软件独立进程，没有操作用户剪贴板、替换原应用或修改用户工程。真实键盘/鼠标操作应串行执行；初次字体加载的启动等待为 60 秒。

- `npm run typecheck`：通过。
- `npm test`：**481/481 通过**，无跳过。
- `npm run build`：通过，包含 renderer、main/preload、MCP 和 subject worker。
- 最新参考：Wand **54** 个 mask 字节 case、Color Range **8** 个 mask 字节 case；Camera Raw **62** 项测试含 **57** 个最新 C 图像 case；大 Gaussian/Motion **14** 组实际 Core Image 参考，检查点最大 premultiplied 通道误差 1。
- `smoke-native-parity.ts`：**10 项**，CmdT 草稿/撤销、双数字透明度、图层 nudge、实际画笔预览/提交、裁剪框与 125% zoom/pan Undo、魔棒参数、Color Range 加减取样。
- `smoke-upstream-delta.ts`：**5 项**，标签页规则和原版 WebP fixtures。
- `smoke-parity-render.ts`：**8 项**，字体/文字真实合成、蒙版/FX/翻转/遮挡、Shape Line、效果删除目标、快捷键改绑。
- `smoke-parity-protocol.ts`：**7 项**，Color Range、当前/全部图层 Wand、Add Mask 一次 Undo、独立蒙版 Distort 预览与最终 PNG/placement 一致。
- `smoke-parity-subject.ts`：**5 项**，Advanced 预览/提交 mask 一致、Undo、取消、真实参数面板。
- `smoke-pointer-brush.ts`：**11 项**，真实指针/修饰键、brush size/hardness、取色、Shift 线段、smoothing、组变换。
- `smoke-image-size.ts`：**4 项**，单位/锁比例/Cancel、只改 DPI 的 Enter、cm/DPI 联动/Nearest/Undo、单表面 200 MP 与非法 DPI 拦截。
- `smoke-camera-preview.ts`：**4 项**，实际 scopes、clipping/sharpen/normal、Point Color、Cancel/Apply/Undo。
- `smoke-interaction.ts`：**6 项**，选中像素草稿、梯度、HSV、裁剪、套索与 All Layers clone。
- `smoke-upstream.ts`：开发模式 **5 项**，真实 MCP 的 24 blend/192 原版参考像素、菜单、folder copy/ungroup/Undo。
- 100 MP 真实 PNG 选中像素 ROI Move/Undo/Redo：8.407 秒、峰值 RSS 2.016 GB；这是已测场景，不外推为 200 MP 全工具性能。

最终构建的串行 runner **10/10 脚本、65/65 聚合检查通过**，各项报告的 renderer errors 均为空；完整记录及本次 out 文件 SHA256 见 `artifacts/native-parity-final/acceptance.json`。Image Size 的真实输入和文字显示均复核，Units/Sampling 内部高度 32px、实测单行文字 15px。早期新增行高测量的失败证据保存在 `artifacts/native-parity-image-size-metric-failure/`，其 `normal` 行高解析问题已改成 DOM 实测；修复后完整重跑，不放宽尺寸或布局期望。

## 最终交付

- 版本：**0.3.0-alpha.6**，`package.json` 与应用 `Info.plist` 一致。
- macOS ARM64 应用：[Compositor Electron.app](</Users/zhoujin/Documents/PS/Compositor_Electron/release/0.3.0-alpha.6/mac-arm64/Compositor Electron.app>)。
- 分发包：[Compositor-Electron-0.3.0-alpha.6-mac-arm64.zip](/Users/zhoujin/Documents/PS/Compositor_Electron/release/0.3.0-alpha.6/Compositor-Electron-0.3.0-alpha.6-mac-arm64.zip)，241,182,142 字节。SHA256：`276e8442021f795cbef026a43a981ccf2929f289f647782fdff88e5222ab482f`。
- 打包后实际运行验证：**2/2 聚合检查通过**；真实 renderer/IPC/MCP 完成 24 种混合模式、192 个原版参考像素，以及文件夹整树复制、解组与一次 Undo。混合参考 premultiplied 通道最大差 2，renderer errors 为空。记录：`artifacts/upstream-0.3.0-alpha.6-packaged-validation.json`。这个结果不替代开发版的键鼠验收，也不代表最新原应用的全部画面像素一致。
- 包内容验证：`artifacts/release-integrity.json` 与 `release/0.3.0-alpha.6/SOURCE_MANIFEST.json` 核验全部当前 out bundle、模型、图标和许可证；ZIP SHA256 已核验，另有 `artifacts/native-parity-zip-content.json` 检查解压所得 app.asar/模型/图标/Info.plist/可执行文件等 6 个文件与当前应用完全一致。
- 构建：使用项目本地已安装 Electron 44.7.0 创建目录包，当前未签名；旧 alpha.2–alpha.5 发布目录保留。没有启动/关闭用户当前应用、替换原版应用、编辑用户工程，也没有操作剪贴板。

打开新版前先在旧窗口保存并退出，再从上面的 alpha.6 路径启动；macOS 可能复用尚未退出的旧实例。`release/mac-arm64/Compositor Electron.app` 为历史 alpha.2，不能用它验收本轮。

## 未关闭的边界与后续顺序

1. C06/C08/C25：All Layers Core Graphics/Skia 插值、CG 边缘栅格化和缩小视口 FX 缓存仍有像素差异可能。流程可验收，不称任意输入逐像素相同。
2. C09–C11：常用实际像素反馈、长笔画和 100 MP ROI 有验证；全部工具的 tile pipeline、大图编码峰值及 200 MP 完整操作尚未完成。资源不足会明确拒绝，不静默丢点。
3. C13/C20：桌面/MCP ASCII 已共用字形；仍不同于 Menlo。安装字体列表/别名/缺字体保护已完成，跨平台文字排版和 AppKit 会有差异。
4. C14/C15：Apple Vision 专有模型不能直接用于 Windows；当前 U²-NetP 无法承诺等同实例或主体 mask。交互与参数调整完成不代表模型相同。
5. D01 的几何 baking 已补齐；32 组参考中 image 的 36 个边界像素（36 个通道、最大差 35）和 mask 的 52 个边界像素（最大差 255）仍有 Core Graphics 采样相位/clip 差异，非边界像素差异为零。不是全像素一致；High quality 放大/gray mask 插值也不作此承诺。证据：`artifacts/parity-image-size/validation.json`。
6. C29：本轮提供未签名 macOS alpha；Windows 原生验证、签名/公证、安装器/更新服务继续按用户要求延后。

上述差异仍列在机器清单 `artifacts/capability-audit-2026-10-10.json`，不会以“全部工具可点击”替代结果核验。本轮没有启动 Photoshop 能力增强，也没有将它的 36 个差距组记为已实现。
