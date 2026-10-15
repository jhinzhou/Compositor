# Photoshop 桌面 / Web 对齐与 HDR 后续路线

核验日期：2026-10-10。项目源码基线：`0.3.0-alpha.10` 开发工作区；常用功能验收基线 alpha.9。

本计划承接用户要求：先完成 Photoshop 常用操作，再做复杂发丝与复杂 PSD，随后评估 HDR，同时核实 Photoshop Web 和网页图像编辑项目值得借鉴的能力。以 AI 开发批次、产物和验收条件安排工作，不使用人日估算。每批完成后统一验收，再进入依赖它的下一批。

此文档是来源核实与实施计划，不代表 HDR 或全部复杂 PSD 能力已经实现。本次查阅了官方文档、项目仓库及本地依赖源码，未执行 Photoshop 桌面版或 Photoshop Web 登录后的同图操作验收。

## 1. 执行顺序及当前状态

| 顺序 | 批次 | 当前状态 / 交付目标 | 进入下一批的条件 |
| --- | --- | --- | --- |
| 1 | C0：常用功能统一验收 | alpha.9 已通过 585 项检查、10 组桌面回归及真实包的常用功能/工作流/MCP；手柄 Esc 与过期裁剪修复已纳入最终构建 | 已通过；详见 alpha.9 验收记录 |
| 2 | C1：复杂边缘与发丝 | 已开始：独立 trimap 核心及 13 项安全/质量测试、7 类合成边缘报告；尚未接入 UI，自然发丝质量未验收 | 原图保护、取消、撤销、边缘质量和性能达标 |
| 3 | C2 / C3：复杂 PSD 与非破坏编辑 | 已开始：独立文件来源、按结构/重算/外部预览分开的语料 runner；已修复 Raw/RLE 坏包静默导入、RGB16 RLE 与 Raw 行 padding 解码；有效外部复杂语料仍为0，智能对象尚未实施 | 支持项有文件结构及视觉证据；降级项明确、可追溯 |
| 4 | H0：HDR 可行性评估 | 建立独立浮点原型，决定存储、渲染、颜色管理、编码器及资源预算 | 能保留 >1 的真实像素值；确认保存/重开和显示链路，不只验证 API 存在 |
| 5 | W1—W3：网页参考能力优先实施 | 情境操作、明确编辑目标、画笔预设、局部版本和信息面板 | 复用同一编辑动作与历史；不破坏已通过的画布工作流 |
| 6 | H1—H3 / W4：分批扩大 | HDR 数值编辑、必要的显示输出；可选生成式编辑与协作另分能力模块 | 按各自 gate 开放，不一次性承诺完整 Photoshop 等价 |

W1—W3 不依赖完整 HDR 成品，可在 H0 给出明确结论后继续；不能因为 HDR 硬件或编码器未准备好而无限期搁置普通编辑体验。Windows 全面验收按照用户先补功能的顺序安排，但真正宣称跨平台 HDR 显示前必须有 Windows 实机证据。

alpha.9 的命名选区保存的是 0—255 灰度覆盖率，支持保存、载入、重命名、删除及 replace/add/subtract/intersect，随画布几何变化更新，纳入撤销与 `.comp` 重开。它不是完整 Photoshop 通道面板，也尚未实现 PSD Alpha 通道往返。Quick Mask 编辑的是选区通道；当前选区为瞬时状态，只有显式保存成命名选区才作为工程内容持久化。

旧 [能力差距清单](PHOTOSHOP_CAPABILITY_GAP_2026-10-10.md) 是较早版本快照，不能将其旧缺失数量或比例直接套用到 alpha.10。PSD 已验证边界以 [格式能力矩阵](PHOTOSHOP_FORMAT_SUPPORT.md) 为准；后续每批更新矩阵，而不是以菜单数量计算“完成百分比”。

## 2. 已核实的参考能力与本项目差距

Adobe 的 Web / 桌面比较表更新于 2025-11-06，2026 年具体功能页面有更新。应以比较表和对应功能页共同判断，不将该表当作所有新功能的实时全集。[Adobe 官方比较表](https://helpx.adobe.com/ca/photoshop/web/get-set-up/learn-the-basics/compare-photoshop-web-and-desktop-features.html)

| 参考对象 | 已核实的能力或方式 | 本项目对应差距 / 实施选择 |
| --- | --- | --- |
| Photoshop 桌面：复杂选区 | Select Subject 后进入 Select and Mask；Refine Hair、边缘检测及输出控制 | 现有主体结果与一般边缘处理尚无复杂发丝等价证据。优先做手工约束边缘区与可靠输出，随后评估模型 |
| Photoshop 桌面：PSD | 文字、矢量、样式、调整层、蒙版、智能对象等结构共同参与重算 | 当前支持部分可编辑结构及明确回退；保留描述符不等于编辑器能实时渲染。先补真实复杂语料，避免只靠自生成文件验证 |
| Photoshop 桌面：32bpc HDR | 浮点图像数据、预览曝光与 HDR 显示设置是不同链路 | 当前整个图像编辑链仍为 RGBA8；需 H0 架构验证 |
| Photoshop Web：任务导向 | 根据当前图层、选区或文本显示操作；变换预览后 Done | 可借鉴情境操作入口、可见的确认/取消和当前编辑目标提示。调用现有动作，不增加第二套历史 |
| Photoshop Web：选区与对象操作 | 单击对象后扩展/减少选择，再进入调整、移除等操作 | 当前对象选择需继续实测复杂场景；下一步在结果预览中直接细化，而不是隐藏执行目标 |
| Photoshop Web：文字和属性 | 基础文字的字体、大小、颜色、字距、行距等集中编辑 | 进一步合并属性入口及提交边界；路径/竖排/复杂排版仍另列，不能因有文字工具宣称齐全 |
| Photoshop Web：版本历史 | 预览旧版本，恢复产生新版本 | 借鉴本地检查点、预览和恢复为新状态，优先本地实现 |
| Photoshop Web：高级功能 | 比较表注明智能对象及部分调整功能有限，Smart Filters 等不支持 | Web 不是桌面全部功能的替代标准；不要为了复制 Web 而删掉项目已有魔棒、多边形套索等能力 |
| Photopea：智能对象 | 原始源与实例分离；不同实例变换；编辑源更新引用；智能滤镜 | 作为 C3 的行为参考。项目现在没有该完整源/实例/滤镜模型 |
| Photopea：通道和边缘 | 灰度通道、Quick Mask、trimap 前景/背景/未知区、预览及输出目标 | 命名选区只是第一步。去色边会改变 RGB，不能只输出蒙版并声称已去色边 |
| miniPaint：本地浏览器编辑 | 文件粘贴/拖入、图层、直方图与 EXIF 等；图像不必上传服务器 | 借鉴本地优先流程与信息面板。已实现的工具不重复开发 |
| Klecks：绘画交互 | 压感、稳定器、多种笔刷、触摸操作与响应式界面 | 重点核验采样、丢失 pointer capture、压感重放和工具预设，避免只模仿外观 |

以上桌面复杂选区依据 [Adobe Refine Hair](https://helpx.adobe.com/photoshop/desktop/make-selections/automatic-color-based-selections/make-improved-hair-selections.html)，Web 行为分别依据 [工作区](https://helpx.adobe.com/au/photoshop/web/get-set-up/learn-the-basics/workspace-overview.html)、[对象选择](https://helpx.adobe.com/photoshop/web/edit-images/make-selections/select-objects-with-a-single-click.html)、[变换](https://helpx.adobe.com/in/photoshop/web/edit-images/transform-and-crop/modify-images.html)、[文字编辑](https://helpx.adobe.com/uk/photoshop/web/add-effects/add-text/edit-text.html) 和 [版本恢复](https://helpx.adobe.com/photoshop/web/get-set-up/learn-the-basics/view-and-restore-document-versions.html)。

Photopea 的行为依据其官方 [智能对象](https://www.photopea.com/learn/smart-objects)、[通道](https://www.photopea.com/learn/channels)、[选区](https://www.photopea.com/learn/selections) 和 [Refine Edge](https://www.photopea.com/learn/refine-edge) 教程。源码参考来自实际编辑器仓库 [miniPaint](https://github.com/viliusle/miniPaint) 与 [Klecks](https://github.com/bitbof/klecks)，不把教程当作算法源码。

## 3. HDR 的真实架构阻塞点

| 链路 | 当前源码证据 | HDR 改造要求 |
| --- | --- | --- |
| 文档模型 | `src/shared/contracts.ts` 固定 `colorSpace: 'sRGB'`，无像素格式/动态范围/传递函数模型 | 分离像素类型、工作色域、传递函数、场景/显示参考及显示变换；工程迁移须兼容旧 RGBA8 文档 |
| 图层资产 | `src/core/project-io.ts` 存储 PNG，拒绝 16bit PNG 资产；灰度蒙版为 8bit | 浮点颜色资产及其分块存储、校验、缓存和历史不能经 PNG8 中转；蒙版覆盖率不必机械提升为 HDR RGB |
| 滤镜与编辑 | `PixelImage.data` 是 `Uint8ClampedArray`；少量 Float32 暂存后仍输出 8bit | 逐个动作声明数值域；先支持浮点曝光、正常合成、变换，再扩展滤镜。8bit LUT 不能直接复用处理高光 |
| 主合成 | `src/renderer/canvas-engine.ts` 使用 CanvasKit/Skia；上传、读回指定 `RGBA_8888` / `SRGB` | 新建经过测试的浮点 Surface/图像与读回路径，避免中间层钳制；保留现有 RGBA8 后端兼容 |
| 辅助画布 | 文本栅格化和部分 overlay 用 Canvas2D | 覆盖层不必全部浮点化，但写入图像的文本/图形必须显式转换，不能误用显示预览作为源像素 |
| PSD 输入 | `src/core/photoshop-io.ts` 只接受 RGB 8/16bit；16bit 量化为 8bit并告警；拒绝 32bit | 首先定义32bit导入策略、编码器与颜色语义。读到 Float32Array 不代表可以编辑或保存 |
| PSD 输出 | 固定 `bitsPerChannel: 8`；本地 ag-psd 31.0.3 writer 拒绝非8bit写出 | 评估扩展当前库或独立编码器；未实现前不能声称 16/32bit PSD 无损往返 |
| 最终显示/导出 | PNG8 合成和 sRGB 显示路径 | 区分 SDR 色调映射导出、浮点源导出和 HDR 显示。不能以普通 PNG 截图证明 HDR |

这些阻塞来自当前代码和固定依赖，不是对浏览器的一概判断。本地 CanvasKit 类型存在 `RGBA_F16`、`RGBA_F32` 及其他色域接口，只说明可以进一步试验；本项目没有启用，也未确认 Electron、操作系统、显示器的端到端 HDR 输出。[CanvasKit 官方说明](https://docs.skia.org/docs/user/modules/canvaskit/)

Adobe 将 HDR 编辑、HDR 预览及显示设置分别说明：32bpc 使用浮点数；预览曝光可改变观看方式而不改源图；真正 HDR 显示还依赖操作系统、显卡及显示器设置。因此“16bit 精度”“宽色域”“HDR 数值”“HDR 显示”必须分别验收。[HDR 图像](https://helpx.adobe.com/photoshop/desktop/adjust-color/hdr-and-channel-manipulation/hdr-images-in-photoshop.html)、[HDR 预览](https://helpx.adobe.com/photoshop/desktop/adjust-color/hdr-and-channel-manipulation/adjust-the-hdr-preview-display.html)、[HDR 显示设置](https://helpx.adobe.com/photoshop/desktop/adjust-color/hdr-and-channel-manipulation/set-up-hdr-display-support-in-photoshop.html)

Adobe 的公开 PSD/PSB 规范定义文件结构，并不提供 Photoshop 的完整合成算法，PSDC 云文档格式也没有公开在该规范中。PSB 标识不能绕过本项目文件、像素和内存预算。[Adobe 文件格式规范](https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/)

ag-psd 上游 README 的部分 16bit/PSB 声明与本地 31.0.3 实现、已验证夹具不完全同步。本项目应以固定版本源码及独立字节夹具为准，并记录版本；不能仅凭 README 升级兼容声明。[ag-psd 仓库](https://github.com/Agamnentzar/ag-psd)

## 4. AI 开发批次与验收

### C0：常用功能收口，先验证组合操作

产物：alpha.9 验收记录、复现步骤、失败修复及对应回归；沿用现有中英国际化、快捷键和 MCP 动作，不新建重复编辑状态。

- 完整检查与构建通过；不把单个测试文件通过当作整批通过。
- 同一非用户业务测试图，依次执行画笔、选区、Quick Mask、裁剪、移动、蒙版、命名选区保存/载入、撤销/重做、保存/重开。
- Q 模式下 Delete、Fill、Cut/Paste、滤镜、复制图层等操作要有明确通道语义或明确禁用，不能落到图像像素；无图层、锁定层也能安全编辑选区。
- 选区编辑前后比对 image assets 的 hash；只编辑选区时原图必须不变。命名选区持久化与当前瞬时选区分别验证。
- 连续切换工具、窗口失焦、Esc、pointer cancel 和 Undo 在20轮组合操作中不遗留 busy 状态；失败、超时或预算拒绝后不出现部分提交。
- 保存/重开检查灰度覆盖率、蒙版属性和图层结构；同步检查中英文窄窗口、面板滚动与确认/取消按钮。

### C1：复杂边缘细化，先可靠可控再扩大自动化

产物：边缘细化工作区、前景/背景/未知区约束画笔、边缘预览、输出为选区/蒙版/新图层、独立基准语料和指标报告。

首先在现有算法基础上建立 trimap 与局部细化，不将一般羽化称为 Refine Hair 等价实现。用户修改只影响明确边缘区；去色边改变 RGB 时输出新图层，并保留原图。算法或模型替换前核实许可证、模型体积、离线运行、内存上限和推理取消。

验收：合成已知 alpha 的细丝、半透明边缘和尖角夹具，固定归一化边缘区域 alpha MAE 目标 ≤0.03；稳定前景/背景区覆盖率不漂移。自然图至少30张，分发丝、卷发、浅色发/浅背景、运动模糊、毛发、半透明物体六类，记录授权来源和边缘参考，报告失败案例。质量指标仅与已定义参考对比，不承诺所有图片等同 Photoshop。黑、白、棋盘背景都检查色边；预览取消、撤销、批量输出和资源拒绝时源图 hash 不变。

### C2：真实复杂 PSD 验收与针对性修复

产物：不少于24份不同组合的合法测试文件、逐项结构/视觉报告、更新格式矩阵；按实际失败点扩大支持。

覆盖嵌套组、组蒙版、剪贴、非默认组混合、八类已支持调整层、富文本/字体缺失、基础形状、复杂矢量、六类基础样式与多实例样式、16bit警告和大尺寸预算。包含至少一组由独立应用生成的文件及其参考合成，避免全部由同一库生成再读取。

验收分别记录：打开可用、编辑结构保留、未编辑往返、修改后往返、实际重算效果。平坦区域同色域且无近似算法时平均误差目标 ≤1/255；抗锯齿边缘单独统计，不能以整图平均掩盖局部错误。明确近似的样式/字体项使用单独阈值与截图，不纳入“像素等价”结论。至少覆盖样式修改再改回、文字重绘、像素绘制、蒙版替换、锁定修改及 Undo；过时源描述符不能重新出现。

真实 Photoshop 导出参考需要有授权的 Photoshop 环境或合法提供的参考文件。尚无该证据时，仍可完成独立结构、项目往返和稳定性测试，但最终报告必须保留“未进行 Photoshop 本体视觉验收”。已有格式专项52项是结构和本项目 Skia 往返证据，不是这批新语料全部达标。

### C3：非破坏对象及复杂格式逐步增强

先实现项目内嵌栅格源对象：独立 immutable source、实例引用、各自变换、替换源、恢复源、重复实例同步及撤销。然后才支持受预算限制的嵌套项目/PSD，最后评估 PSD 智能对象结构导入导出和链接资源。

智能滤镜以显式有序栈管理启用状态、参数和蒙版，不能靠隐藏旧描述符代替真实编辑。每步验证缩小再放大从原源重算、实例差异不串扰、保存/重开保持引用、循环/超深嵌套拒绝、源文件缺失有明确回退。外部链接不自动访问网络，不在导出中悄悄展开或丢弃。

完成前，优先补用户能直接使用的 PSD Alpha 通道往返、路径/矢量蒙版编辑及必要的文字布局；这些仍是独立缺口，不因有基本形状/命名选区就标记完成。CMYK/完整 ICC、RAW 显影、复杂变形与完整样式内核另列后续，不把本批扩大为全部桌面能力。

### H0：HDR 原型和决策门槛

产物：实验性独立浮点数据与 Skia 后端、编码器对比、内存/性能结果及继续/调整范围的架构决策记录。普通 RGBA8 工程继续可用，H0 不直接开放正式“HDR 编辑”声明。

1. 定义 Float32 作为候选源精度、Float16 作为候选显示/缓存格式，明确线性工作空间、alpha 与负值策略；不把 sRGB 数值直接当线性光。
2. 测试0、0.18、1、4、16及临界高光，曝光 ±2 EV、合成、变换、保存/重开和 Undo 不发生无提示0—1钳制。Float32基础运算相对误差目标 ≤1e-5，零附近用另设绝对误差阈值；Float16结果另测，不能混用标准。
3. 拒绝 NaN/Infinity 与损坏资产；在超预算时原子失败。统计峰值内存、读回次数和交互延迟，先确定 tile/ROI/历史增量预算。
4. 单24MP全画幅仅颜色像素约需 RGBA8 96MB、RGBA_F16 192MB、RGBA_F32 384MB；10份 Float32 全画幅为3.84GB，尚未包括历史、Skia拷贝及滤镜临时区。不能只提高全图数组限额来实现大图 HDR。
5. 验证输入、工程保存、源格式输出、SDR预览、HDR显示五条独立路径；ag-psd目前8bit输出是明确阻塞，比较可维护的扩展/编码器方案后再决定。

### H1—H3：通过 H0 后才扩大 HDR

| 批次 | 可交付范围 | 验收边界 |
| --- | --- | --- |
| H1 | 浮点源保留与 SDR 预览/显式 SDR 导出 | 预览曝光不改源；显示色调映射不写回主数据；持久化 >1 像素，已支持编码器单独验证 |
| H2 | 分块浮点基础编辑、颜色管理及滤镜逐项适配 | 每个动作注明支持格式；未适配动作明确拒绝或用户选择转换；保存精度和峰值内存达标 |
| H3 | macOS / Windows 实机 HDR 显示输出 | 记录 OS、Electron、GPU、显示器和模式；验证实际 HDR 高光与 SDR 回退，不能只依据接口存在或截图 |

16bit TIFF/32bit PSD/EXR等输出不在此文档中宣布支持；需编码器、颜色标记、数值重开及独立应用验证后逐格式开放。合并曝光生成 HDR、RAW 相机显影、PQ/HLG 交付也各有算法和格式条件，不用一个“HDR”开关包揽。

### W1—W4：借鉴网页流程，补真实日常可用性

| 批次 | 实施内容 | 验收 |
| --- | --- | --- |
| W1：情境操作与目标反馈 | 选区后直接载入/取消/反选/蒙版，文本/变换显示适当属性；明确目标是图像、蒙版还是选区通道；属性按上下文变化 | Q模式、工具切换、Esc/Done、输入框快捷键不冲突；中英窄屏可用；同UI/MCP操作执行同一核心动作 |
| W2：画笔与设备交互 | 可保存笔刷预设、稳定器、压力/倾斜可用性提示、触摸平移缩放和取消收口；选择性参考 Klecks 模块 | 固定压力轨迹重放结果可重复；mouse无压力时默认值合理；pointercancel不卡住；高缩放与旋转视图落点一致 |
| W3：本地版本与图像信息 | 检查点缩略预览、恢复为新历史状态、直方图/取样值/EXIF及资源预算提示 | 不覆盖唯一旧版本；资产去重、保存失败恢复、权限错误与预算拒绝可复现；新数据有版本迁移 |
| W4：按能力接入生成式任务 | 在现有 OpenAI-compatible Agent 之外，独立声明图像服务的生成/修复/扩图能力；新层、预览、取消与撤销 | 聊天兼容不代表有图像生成 API；实际服务协议和能力检测通过再开放，失败不破坏原层 |

Adobe 的情境任务栏是流程参考；不接入其私有端点，也不把其他厂商服务称为 Firefly。[桌面情境任务栏](https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/boost-workflows-with-the-contextual-task-bar.html)

评论协作、远程版本与云同步需要服务端、权限、冲突及数据保留设计，排在本地可靠版本之后。现阶段不因借鉴 Web 自动上传用户图片；有明确后端和用户需求再实施。Adobe 版本恢复方式是可借鉴的交互，云存储实现不是当前必须依赖。

## 5. 源码、资产与许可证复用边界

| 来源 | 核验结果 | 可采用方式 |
| --- | --- | --- |
| Adobe Photoshop / Web | 产品文档与格式说明，不是开源编辑器实现 | 自行实现公开工作流；使用有授权的测试文件。公开 PSD 格式说明不提供内部算法或 PSDC 实现 |
| Photopea | 官方仓库明确不是完全开源，主要用于错误报告/功能讨论 | 参考官方教程与可观察行为。不能将 issues 仓库称为可复用编辑器源码；不复制线上打包代码、商标与素材 |
| miniPaint | 实际编辑器源码，MIT许可证文件已核验 | 选定提交和模块后保留版权及许可证，审查模块依赖与图像素材，再决定直接复用或独立实现 |
| Klecks | 实际编辑器源码，MIT许可证文件已核验 | 选择性参考笔刷/指针模块，保留许可证；Kleki 品牌、Logo 等不随代码许可证自动获得使用权限 |
| ag-psd | 当前依赖及官方仓库为 MIT；许可证明确图片/笔刷不包含在代码许可中 | 固定版本验证和最小扩展；测试素材逐份查来源，不把库代码许可套到全部夹具 |
| CanvasKit/Skia | 当前依赖声明 BSD-3-Clause | 保留现有 notices；新模块和间接依赖逐项确认；不因Skia支持格式枚举就承诺运行时能力 |

许可证事实依据 [Photopea 仓库说明](https://github.com/photopea/photopea)、[miniPaint MIT-LICENSE.txt](https://github.com/viliusle/miniPaint/blob/master/MIT-LICENSE.txt)、[Klecks LICENSE](https://github.com/bitbof/klecks/blob/master/LICENSE)、[Klecks README](https://github.com/bitbof/klecks#readme) 和 [ag-psd LICENSE](https://github.com/Agamnentzar/ag-psd/blob/master/LICENSE)。此阶段只做来源核实，尚未引入这些参考项目的新代码或依赖。

## 6. 尚未确认的能力与报告规则

- 未获得 Photoshop 本体同图操作/输出证据；先能做结构与本项目回归，跨应用“完全一致”需后续实测。
- Photoshop Web 比较表和新功能页可能存在更新时间差异；实施某项前再核对对应页面，不将未登录实测功能标记为已验收。
- Photopea列出EXR/HDR文件格式，不足以证明其全链路浮点编辑精度或本项目可直接采用的算法。
- 尚未确认本机及Windows设备的端到端HDR显示条件，也未选择正式浮点编码器/ICC方案；H0必须给出实证。
- 自然发丝效果受图像、模型和背景影响；在固定测试语料与背景上报告指标、失败样本及性能，不使用“达到Photoshop”的笼统结论。
- 每批交付注明“源码已实施 / 单测通过 / 桌面交互通过 / 跨应用效果通过 / 实机平台通过”中的实际状态；报告对应版本与证据，未完成项留在矩阵中。

本计划文件不改变当前工程像素类型、导入允许范围或PSD能力声明；后续代码按C0验收结果继续推进C1/C2，完成后再进行H0与网页参考功能开发。

## 7. 本轮开始实施的证据

- 常用功能已交付：[alpha.9 常用功能统一验收](PHOTOSHOP_COMMON_ALPHA9_ACCEPTANCE.md)，包含真实目录包、20轮 Quick Mask 生命周期检查和真实 MCP 新动作验证。
- C1 第一批已实施：[trimap 核心与边界报告](TRIMAP_MATTE_C1_PROTOTYPE.md)。4类受限合成场景的 unknown 区 alpha MAE 为 0.000802—0.002108；另记录3类失败场景，尚无自然图或 Photoshop 本体参考。源RGB仍保留，未实现去色边或成品“Refine Hair”声明。
- C2 第一批已交付：[独立语料、导入修复及24项计划](PHOTOSHOP_CORPUS_C2_2026-10-10.md)。RGB16 RLE 与合法奇数行 padding 已按独立字节 oracle 修正；4份 ImageIO 坏包源在导入前明确拒绝，后续阶段为 not-run。有效外部复杂 PSD 和 Photoshop 作者语料仍为0，不能据此宣称完整兼容。
- alpha.10 的集中构建与真实包结果见 [本批验收记录](PHOTOSHOP_ALPHA10_ACCEPTANCE.md)，与 alpha.9 历史记录分开保存。
- H0—H3 和 W1—W4 保持按依赖安排，尚未开放 HDR 入口或新增生成服务。当前实现不因为此计划变成浮点编辑器。
