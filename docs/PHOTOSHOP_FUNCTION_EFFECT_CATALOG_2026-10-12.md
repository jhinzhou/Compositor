# Photoshop 功能、操作与图片效果目录：Compositor Electron 对照

日期：2026-10-12；本批更新2026-10-13。研究对象：本机 Photoshop 2026 **27.11.0**，项目当前开发批次 **Compositor Electron 0.3.0-alpha.25**，前一完整实测基线为alpha.24；alpha.17–20数据保留为历史对照。阅读对象是想知道“能做什么、怎么做、图片会有什么变化、我们的软件还差什么”的使用者和后续开发者。

**结论：项目已有常用编辑骨架，也已用真实 Photoshop 输出修正部分画笔、选区羽化、色相饱和度与 RGB16 导入；目前尚不能代替 Photoshop 的完整非破坏合成、专业颜色管理、修图、文字矢量、Camera Raw、复杂 PSD 与生成式编辑。** 同名工具、相似界面、内部单元测试通过，均不足以证明图片效果相同。本目录把这三类证据分开。

<a id="navigation"></a>
## 阅读导航

先看 [实测效果与本轮进展](#native-results)，再按下面的工作流程找能力；需要具体命令名称、图片变化或快捷键时，直接打开附录。每项都有“怎么操作 / 效果 / 项目差距”，证据链接可在本机打开。

| 想做什么 | 对照入口 |
|---|---|
| 打开、保存、撤销、交换 PSD | [A 文件与历史](#family-a)、[H 图层与非破坏合成](#family-h) |
| 裁剪、旋转、缩放、找回裁剪外内容 | [C 裁剪与几何](#family-c)、[具体工具清单](#appendix-6) |
| 选物体、画选区、蒙版、抠发丝 | [D 选区](#family-d)、[E 蒙版与抠图](#family-e) |
| 画笔、涂抹、修复、液化 | [F 绘画](#family-f)、[G 修图](#family-g) |
| 调明暗、颜色、滤镜与合成外观 | [J 调整](#family-j)、[K 滤镜族](#family-k)、[混合模式](#appendix-1)、[调整名称](#appendix-2)、[图层样式](#appendix-3)、[滤镜库](#appendix-4)、[Filter 菜单](#appendix-5) |
| 文字、路径、形状、画板 | [I 文字与矢量](#family-i)、[高级选项](#appendix-7) |
| 16 位、HDR、ICC、RAW | [B 颜色与位深](#family-b)、[L Camera Raw](#family-l)、[版本/平台边界](#version-boundaries) |
| AI、自动化、导出、Web 借鉴 | [M 生成与对话](#family-m)、[N 输出与扩展](#family-n)、[高级/历史边界](#appendix-8) |

其他入口：[计数和状态解释](#scope)、[快捷键](#shortcuts)、[菜单索引](#menus)、[同图同动作研究方法](#research-method)、[开发顺序与验收门槛](#roadmap)、[证据和维护日期](#evidence-index)。

**alpha.22更新（2026-10-13）**：同步上游87e2283的兼容特性；普通16位图层先高位合成再屏幕量化，unsupported栈/预算给兼容提示；PSD RGB8补ICC检查；菜单位置/快捷键Clear/Reset/部分加载、输入框Delete、Reselect、All Layers、Layer Mask来源区分、Smooth/Border、Threshold/Posterize与工具组入口已进入本批。真实原生阈值/色调分离参数与统一验收结论见[alpha.22报告][A22]；工具组隐藏子项逐项清单见[侧栏22工具][TOOLS22]；剩余66部分/32缺少的依赖顺序见[执行计划][PLAN22]。整族状态仍14/66/32，不能把几项子功能新增算为全族完成。

**历史实现更新（alpha.21，2026-10-13）**：近硬笔尖158参考中15改善/142覆盖不变/1轻微MAE退化，64px/h95最大差41→21–22；小半径蒙版31输出最大差最坏19→6，0.3px为0、1px为2。参考线自动拉直与四角透视裁剪已实现，8/16/HDR原始位深采样、取消/Undo/保存重开分别验收。拉直参考角度和整数尺寸一致；透视自动尺寸仍不同，固定尺寸RGB MAE4.486470/max237，不假称像素等效。源码1,550项全PASS；开发版与安装包各20组256项全部PASS，布局52项/截图fallback0；发布完整性PASS（16个构建文件、模型/图标、28个许可证文件和ZIP SHA256），完整结果见[A21]。以下alpha20内容保留为历史，不代表alpha21当前残差。[本批报告][A21]

**历史验收基线（alpha.20，2026-10-12）**：alpha.20 产品源码已冻结；1,442/1,442个源码测试、typecheck/i18n/build已通过，macOS ARM64目录包已生成，**开发版与安装包正式门禁各17组/221项全部PASS**。112个原生画笔参考按union MAE为37改善/70不变/5轻微退化；16个有效蒙版参考的贴边最大误差123→1，小半径0.3仍19/255。实际GUI另外发现并修复1:1整数对齐蒙版被再次插值模糊，6case/12checks的实际灰度bitmap、Preview/Apply、Undo及保存重开通过。非破坏裁剪指定RGB8样本保存重开后完整恢复且RGBA零差，项目原生引用回归通过。以下是特定样本和注明门禁的结论，**不表示全部 Photoshop 功能和效果等效**。alpha20两种runtime统一门禁已通过；当时发布完整性也已PASS：16个构建文件及模型／图标／28个许可证文件与当时构建一致，详见 [alpha.20记录][A20]，官方文档日期与访问日的区别见 [维护规则](#evidence-index)。

<a id="scope"></a>
## 范围和计数方法

目录覆盖桌面 Photoshop 主要菜单、工具族、选项、滤镜族和完整工作流程，按 **112 个能力族、14 类、每类 8 项** 编号。一个能力族可含多个命令，例如“文字段落”包括对齐、缩进、连字符、排版器、样式；“噪点滤镜”包括多个具体滤镜。参数、快捷键、位深分支、平台分支和同一算法在不同入口的复用不单独累加。跨工作流程会引用相同底层能力，因此这些数字是目录规模，**不是 Photoshop 总功能数，也不能除出项目完成百分比**。

**alpha.25更新**：兼容移植上游Camera Raw10组重置/显隐/滚动条；分组箭头4px。Patch/红眼局部工作区支持16MP RGB8源，Patch Destination半像素误移修复。5个真实透视样本固定原生尺寸下RGB MAE≤0.387，但自动尺寸最大宽差66px/高差33px；Patch不同Diffusion仍有量化差异。112族仍14/67/31。[本轮验收](PHOTOSHOP_ALPHA25_ACCEPTANCE_2026-10-13.md)。

**alpha.24历史更新**：移除、内容感知移动、红眼已接入真实交互/预览/事务，RGB8当前层≤2MP；三项属于C051/C052原有部分族，112族仍14/67/31。快速选择与透视采样有新增原生量化，工具栏和菜单统一；详见[本轮报告](PHOTOSHOP_ALPHA24_ACCEPTANCE_2026-10-13.md)。

**alpha.23历史更新**：补闭合自由套索、图像驱动Quick Selection、Magnetic Lasso、Source/Destination Patch、Info颜色取样器和标尺，增强四点透视输入。C052首次有真实Patch链，从缺少改为部分；112族仅这一项改变，当前14/67/31。五个侧栏子工具的新增不能视作五个能力族完成。[本轮报告](PHOTOSHOP_ALPHA23_ACCEPTANCE_2026-10-13.md)、[侧栏当前状态](TOOL-GROUP-AUDIT-2026-10-13.md)。

按当前首状态分类：**14族可用（其中部分只到基础操作）、67族部分、31族缺少**。这是按族归纳，部分族可含大量缺项；也不是“14族已经和Photoshop效果完全相同”。具体残差/未验证项以每行与实测表为准。

未声称列尽第三方插件、每个字体功能、全部历史版本、私有算法或每个参数组合。科学分析、视频、印刷、云协作仍列入差距，但优先级低于用户当前的图片编辑需求。菜单路径以英文名为识别锚点；中文翻译和所在工具组可能受语言、工作区、版本、键盘自定义影响。

状态列分为：**可用**＝项目有实际入口和核心操作链；**部分**＝相关能力存在，但本族有明确缺项或语义不全；**缺少**＝目前没有这项可用工作流程。效果证据分为 **PS实测**（只限注明样本）、**项目验收**（项目行为通过，不保证与 PS 像素相等）、**未对照**（有实现，但尚无有效原生对照）、**进行中**（本轮采集/修复尚未完成统一门禁）。“可用”不表示每项专业选项已齐。

取证依据：Adobe 官方帮助与开发文档、当前代码的 UI → command → raster/composite → save/history 链，以及已保存的真实 Photoshop 参考和验收报告。本目录没有新增原生 GUI 操作；原生证据引用团队本机实际采集的文件。官方功能说明不能代替像素测试。

<a id="version-boundaries"></a>
## 版本和平台边界

Adobe 官方更新页把 2026 年 9 月版列为 **27.11**，包含 AI Enhance Edge 和 GPT Image 2 图像生成/编辑；8 月版 27.10 包含 Light 调整层和 **AI Assisted Editor (Beta)**。本机 27.11.0 是本次参考，不把 Beta、账号可选模型、其他平台或未来功能视为每台安装都有。[Adobe 桌面更新，2026-10-05](https://helpx.adobe.com/photoshop/desktop/whats-new/whats-new-in-adobe-photoshop-on-desktop.html)

Camera Raw 是独立组件。官方当前文档列 **18.7，2026 年 9 月**，本机 ACR 安装版本尚未在本轮目录中读回；不能由 Photoshop 27.11 推断本机已有所有 ACR 18.7 功能。[Camera Raw 发布说明，2026-09-29](https://helpx.adobe.com/camera-raw/desktop/whats-new/release-notes.html)

Photoshop Web 是独立产品。官方桌面/Web 对照表更新时间为 **2025-10-28**，晚于该日期的新功能应再看 2026 Web 更新，不能拿旧矩阵宣布今天完全没有某功能。当前 Web 文档适合作为简化工具、上下文任务栏、云版本与 AI 交互的参考，而不是桌面全部功能的承诺。[Web/桌面对照](https://helpx.adobe.com/photoshop/web/get-set-up/learn-the-basics/compare-photoshop-web-and-desktop-features.html)、[Web 更新，2026-08-28](https://helpx.adobe.com/in/photoshop/web/whats-new/whats-new-in-adobe-photoshop-web.html)

旧 3D 工作流程不能直接作为当前桌面缺项补齐。Adobe 的 Substance 3D Viewer Beta 已在 **2025-10-16** 停止提供；官方预设页仍出现旧 3D/Viewer 建议，存在历史说明与新公告时间差，应优先使用停用公告并实查菜单。Save for Web (Legacy)、旧滤镜与某些 GPU 功能也必须按当前菜单和位深判断，不照抄 CS6 的整套目录。[Viewer 停用公告，2025-09-25](https://helpx.adobe.com/substance-3d-viewer/desktop/getting-started/substance-3d-viewer-decomission.html)、[预设与历史项目](https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/brushes-presets/photoshop-presets-locations.html)

项目证据来自 **macOS ARM64 开发版与未签名目录包**。当前alpha21的完整门禁记录见[A21]。Windows 真机、签名/公证、HDR 显示输出、任意外部复杂 PSD 都仍是独立门槛；支持相应文件或编译配置不代表这些门槛已通过。[alpha.20 验收][A20]

<a id="native-results"></a>
## 实测效果：哪些已经比过，哪些还没有

| 已采集的原生基准 | 已确认结果 | 可推断范围和不能推断的范围 |
|---|---|---|
| HSL，8 位色立方和 16 位参考 | RGB8 最大通道误差约 26→2；RGB16 约 6666→230 | 适用于记录的参数/色块；不代表所有色相区间、全色域、所有调整层栈或 Photoshop Color/Vibrance 等价。[alpha.17][A17] |
| 指定的两控制点 Curves | `(16,0),(239,255)` 样本逐像素误差 0 | 仅该曲线和测试输入；复杂曲线、自动端点和 ICC 场景尚不能外推。[alpha.17][A17] |
| Photoshop 产生的 RGB16 PSD/PSB | 4 个参考、2,647,180 个通道值与 **PS 保存后基准**完全一致 | 这是读取链保真；不是 RGB16 PSD 写出完成，也不是 PS 打开后保存前后与原始来源绝对一致。PS 自身在该链曾出现 1–2 值变化。[RGB16 参考][RGB16] |
| 选区 Feather，中心/贴边/孔洞/反选/重复羽化、多半径 | 21 个有效输出，PS 模型最大覆盖误差 0–6/255；未标记旧模型保留原 Compositor 语义 | `featherModel` 模型显式选择；是通用近似，未复制私有核；取消的 `full-f20` 不计有效参考。[alpha.18][A18]、[原生选区 fixture][FSEL] |
| 圆画笔（alpha.19 已验收基线） | 18 个 99/100% 硬度参考 union Alpha MAE 9.0182→1.5256；32px 最大误差约 80→10，留出尺寸 8–11；软/硬低 Flow 最大误差仍 29/44 | 51 个 8 位实际原生回归；90% 小笔尖、自由手绘、真实数位笔、更多模式未齐。5 个 16 位参考明确保留差异。[alpha.19][A19]、[画笔回归][TBRUSH] |
| alpha.21近硬笔尖 | 158参考：15改善/142覆盖不变/1轻微MAE退化；64px/h95 max41→21–22，Flow20线21→18 | 原112参考无退化且原门槛不放宽；96/128px h100仍34/32，真实自由筆势未等效。[分析][BRUSH21]、[验收][A21] |
| alpha.21小半径蒙版 | 31个原生输出，最坏max19→6，0.3px为0、1px为2，无max退化 | 0.6/0.7仍6/5，3px仍3；≥2px原核不变，显示和Apply同链。[参考][MASK21]、[验收][A21] |
| alpha.21自动拉直/透视裁剪 | 原生拉直角度/430×269匹配；透视固定输出alpha零差 | 原生默认387×257 vs建议348×224；固定348×223 RGB MAE4.486470/max237。透视会重新采样，有限拒绝边界明确；8/16/HDR保存重开另验收。[裁剪][CROP21]、[验收][A21] |
| 圆画笔（alpha.20实测与统一GUI验收通过） | 112个RGB8参考union MAE：37改善/70不变/5轻微退化；8px/h50 max58→6，8px/h75 96→6，16px/h75 52→9，32px/h90 64→9；Soft32/Flow20/Spacing20 max41→5，Hard对应51→19 | 64px/h95仍75→41；5个MAE轻微退化样本保留，不放宽旧51个参考门槛。Spacing请求12.5%原生读回13%，按实际值比较，项目公共参数不静默取整。数位笔、真实自由笔势和16位工具量化仍不等效。[alpha.20记录][A20]、[逐例测量][MBRUSH20]、[v6原生fixture][FBRUSH20] |
| RGB16 画笔不透明度 | PS 1/2/10/50% 峰值 772/1286/6682/32895；项目数学比例 655/1311/6554/32768 | 高位深来源保留与 Photoshop 工具量化是两件事；尚无原生量化模式。[alpha.19][A19] |
| 蒙版 Density，Feather0（alpha.19） | 100/50% 两个有效控制逐像素 Alpha 误差 0 | 仅 alpha.19 的有效控制；该阶段非零属性 Feather 脚本未通过参数读回，失败输出仍排除。不由选区 Feather 推断蒙版属性。[alpha.19][A19]、[蒙版核心][MASK] |
| 蒙版 Properties（alpha.20实测与统一GUI验收通过） | 16组有效原生参考；完整画布贴边max123→1，Feather0.5 26→3，10/20 4→1，50 6→2，反选/孔洞4/5→1；Feather0.3仍45→19，1仍5，3由2微退至3，其余0–2 | 中心Feather0/0.1/0.3/0.5/1/2/3/4/6/10/20/50共12组，加Density byte128+Feather10和贴边/反选/孔洞f10共16组。UI输入0.25实际读回0.3，Density50读回128/255。产品显式PS模型使用连续box4与采样方差，源蒙版不改写；clamp仅适用明确完整文档边界，不能套到有限patch。任意蒙版变换、灰度/16/HDR的原生效果未完整覆盖，最坏19/255不能概括为全部≤3。[原生与SHA][FMASKUI]、[读回日志][LMASKUI]、[16组最终逐例测量][MMASK20]、[alpha.20记录][A20] |
| 1:1整数对齐蒙版显示 / 属性预览与提交 | 实际GUI6case/12checks：灰度canvas bitmap、Preview/Apply截图、Undo、保存重开PASS | 已修复CanvasKit MitchellCubic在1:1时再次模糊：仅显式PS蒙版、无旋转、源与设备像素1:1、原点整数对齐直接传递像素；其他缩放/旋转及旧模型保持原采样。不把Retina/CSS截图插值误当原始像素差，也不外推任意变换等效。[开发版灰度与交互记录][GMASK20]、[alpha.20记录][A20] |
| 非破坏 Crop，保存/重开/恢复 | PS Delete Cropped Pixels=false：恢复512×320原图RGBA零差；true删除对照有414,164个通道值不同。项目原生引用回归 PASS | 指定RGB8诊断图，裁剪框(60,40,300,200)，保存PSD→关闭→重开→扩画布并恢复图层位置。项目裁剪、重开、恢复渲染与对应PS参考一致，源asset保留；不是所有图层/变换/位深裁剪效果证明，也不代表项目删除选项已齐。[原生fixture][FCROPNATIVE]、[测量与SHA][MCROPNATIVE]、[项目原生引用测试][TCROPNATIVE] |
| 文档关闭/切换后的异步重绘生命周期（alpha.20源码回归） | 新增6个竞态测试PASS：过期重绘错误不弹toast，等待中的最新文档继续重绘，过期缩略图结果忽略；当前文档真实错误仍保留 | 捕获session/revision/current-view身份并检查提交时效，避免已关闭文档的延迟结果污染新文档。属于项目交互/状态正确性，不是PS像素等效证据；两种runtime正式GUI门禁均通过，语义仅限记录的竞态/操作。[重绘调度][LATESTDRAW]、[6个回归][TLATESTDRAW] |
| alpha.20正式runtime门禁（两种runtime通过） | 开发版与安装包各：Photoshop阶段12组104项＋高位深5组117项＝17组221项，全PASS；子报告均无错误 | 包括crop7项source byte保真/无旧文档toast、mask12项和新增native brush4项；每种runtime布局52项，中英文实际截图均无fallback。相同221项在两个runtime重复，**不是442项独立功能**。发布完整性PASS：16个构建文件和资源／许可证一致。[alpha.20记录][A20] |
| 保存重开、Undo/Redo、高位深源、布局、MCP（alpha.19稳定基线） | alpha.19 1,326 源码测试；开发版和包各 14 组 198 项 | 同一套测试重复在两个 runtime，不算 396 项独立功能；大部分属于项目一致性，并非 Photoshop 视觉对照。[alpha.19][A19] |

HDR 负值/超过白点、16 位低有效位已有项目内核与保存测试，但真实 HDR 显示、ICC/OCIO、全模式滤镜和完整 PSD 并未因此等价。当前不能把 PNG8 预览看起来相同作为高位深保真的证据。

<a id="capabilities"></a>
## 112 个能力族对照

<a id="family-a"></a>
### A. 文件、工作区和历史（C001–C008）

官方菜单与工作区分类参考 [桌面帮助目录](https://helpx.adobe.com/photoshop/desktop.html)。以下项目情况来自实际工作区命令、文档管理和存档实现，而不是原生 Compositor 的功能清单。

| 编号 / 能力 | Photoshop 入口、主要操作 | 图片或工作流程效果 / 建议复现 | 项目状态、差异与证据 |
|---|---|---|---|
| C001 新建、多文档、切换 | File > New/Open；文档标签；大小、分辨率、模式、背景 | 新建透明/白底，复制层到另一文档后比较位置和色值 | **可用 / 项目验收**；文档/session 隔离已有；没有 PS 全部新建模板、画板和颜色配置。[UI][UI]、[文档管理][DOC] |
| C002 普通图像导入、放置 | Open、Place Embedded/Linked、拖放；先区分打开文档和放入现有文档 | 同图打开 vs 放入，检查初始缩放、画布尺寸、层类型 | **部分 / 项目验收**；图片/文件夹导入已有；放入仍为项目图层，不是 Linked Smart Object。[UI][UI]、[项目IO][IO] |
| C003 工程保存、恢复 | Save/Save As/Save a Copy、Revert、自动恢复 | 修改→保存→关闭→重开；模拟恢复后核对源精度/位置 | **可用 / 项目验收**；自有工程及恢复存储已有；alpha20修复关闭/切换后的过期重绘与缩略图，最新文档继续绘制，当前真实错误仍可见（6个源码回归PASS）；保存重开不持久化全部 Undo 时间轴，也不是 Adobe 云版本。[项目IO][IO]、[恢复][REC]、[重绘竞态][TLATESTDRAW] |
| C004 PSD/PSB 交换 | Open、Save As PSD/PSB；保留层/蒙版/文字/effects | 外部 PSD 导入→编辑→回 PS 检查可编辑性与像素 | **部分 / PS实测局部**；RGB16 读取已保真，写出和高级语义仍受限；未知块保留不等于可编辑、合成相等。[PSIO][PSIO]、[alpha.17][A17] alpha.22对RGB8/16的嵌入sRGB等效ICC共同检查，非sRGB明确要求转换，不再静默忽略；仍没有通用ICC CMM/CMYK/RGB32 PSD链。[RGB ICC策略][ICC22]。 |
| C005 RAW/HEIF 容器 | 打开相机 RAW 启动 Camera Raw；HEIF 随系统/解码器 | 同 RAW 各自解码，检查方向、白平衡、饱和高光和 profile | **部分 / 项目验收**；LibRaw/HEIF worker 及导入面板已有，当前 `ForeignImage.rgba` 为 Uint8，不能称完整原始 RAW 高位深链。[解码][FOREIGN]、[RAW面板][RAWUI] |
| C006 工作区、面板 | Window > Workspace；停靠、浮动、保存/重置布局 | 切换照片/绘画工作区；检查遮挡与控件可达 | **部分 / 项目验收**；Layers/工具面板/命令搜索，Tab 隐藏已有；任意停靠、双屏工作区、PS 面板生态欠缺。[UI][UI]、[样式][CSS] |
| C007 偏好、语言、快捷键 | Preferences/Settings；UI 大小、单位、键盘方案 | 切中/英文，小窗口，表单与 footer 不换错行 | **部分 / 项目验收**；ZH/EN、profile、自定义键已有，完整 GPU/暂存盘/色彩偏好缺少。[profile][PROFILE]、[快捷键][KEYS] alpha.22主菜单顺序/常用子项位置对齐、显式Clear/Reset、单项有效配置恢复、跨平台冲突检查、输入框Backspace保护已新增；不能说完整快捷键和菜单已与PS相同。[键盘审计][KEY22]。 |
| C008 History、快照与历史画笔源 | Window > History；Undo/Redo、Snapshot、History Brush source | 在任意历史状态分叉，选择历史源涂回局部 | **部分 / 项目验收**；线性 Undo/Redo 和 agent task Undo 已有；可浏览快照/历史源/历史画笔未实现。[编辑器][EDITOR]、[历史测试][THISTORY] |

<a id="family-b"></a>
### B. 颜色模式、通道和 HDR（C009–C016）

Assign Profile 改变色值解释，Convert to Profile 改变颜色编码；二者不能混为一个“转 sRGB”按钮。[官方 profile 语义，2026-02-23](https://helpx.adobe.com/photoshop/desktop/adjust-color/color-profiles/change-color-profile-for-documents.html) 打开文件时还有 RGB/CMYK/Gray 的策略和 profile mismatch 提示。[打开策略，2026-09-30](https://helpx.adobe.com/photoshop/desktop/adjust-color/choose-colors/manage-color-profiles-when-opening-images.html)

| 编号 / 能力 | Photoshop 入口、选项 | 效果 / 建议复现 | 项目状态、差异与证据 |
|---|---|---|---|
| C009 RGB8 / RGB16 编辑 | Image > Mode，8/16 Bits/Channel | 低有效位渐变经调整/Undo/重开后不应变成 256 级 | **可用 / PS实测导入+项目验收编辑**；16 位调整合成、绘画、涂抹、重采样有独立链，工具量化仍不同。[高位深合成][DEEP]、[alpha.19][A19] alpha.22普通无调整16位层也先高位合成再量化，屏幕抖动可有兼容fallback，源/保存/导出保持；不是HDR显示或Metal逐像素等效。[显示审计][COLOR22]。 |
| C010 RGB32 浮点 HDR 工程 | Image > Mode >32 Bits/Channel | 输入负值与 4.0 高光，曝光后读回高光和源值 | **部分 / 项目验收**；Float32 源、EXR、部分 TIFF 与编辑已有；RGB32 PSD、全部 filters/modes 和 PS HDR 外观未齐。[HDR合成][HDR]、[HDR集成][HDOC] |
| C011 CMYK / Lab / Gray / Indexed / Bitmap / Duotone / Multichannel | Image > Mode；带模式转换与位深限制 | 单通道修图、印刷分色、索引调色板与双色调输出 | **缺少**；工程色空间固定 sRGB；读取拒绝/降级提示不构成对应模式编辑。[工程契约][CONTRACT]、[PSIO][PSIO] |
| C012 ICC Assign/Convert、工作空间 | Edit > Color Settings/Assign Profile/Convert to Profile | 同 RGB 数字挂不同 profile；转换后比较 Lab 色差 | **缺少**；有来源颜色识别/警告，但无完整每文档 ICC 工作空间转换与渲染。[foreign颜色][FCOLOR]、[工程契约][CONTRACT] |
| C013 Soft Proof、Gamut Warning、输出色彩意图 | View > Proof Setup/Proof Colors/Gamut Warning | 模拟纸白/墨黑，观察超印刷色域区域，不修改原像素 | **缺少**；无软校样、CMYK 输出链和打印 profile 策略。[工程契约][CONTRACT]、[导出选项][EXPORT] |
| C014 RGB 分通道、Alpha/Spot Channels | Window > Channels；单独显示/编辑、存载选区 | 红通道改变而 G/B 不动；alpha 另存，专色印版独立 | **部分 / 项目验收**；命名选区可保存覆盖，非完整 Channels 面板；任意通道编辑/专色/通道组合欠缺。[命名选区][NAMED]、[PSIO][PSIO] |
| C015 HDR 显示与 OCIO/ACES | Preferences > Technology Previews、HDR OS/GPU/monitor；OCIO | 同 EXR 在匹配 HDR 显示环境下比较亮度与颜色 | **缺少 / 显示未验证**；保存浮点不能证明显示 HDR；目前显示代理/SDR 预览，不是 OCIO/ACES 显示管线。[HDR显示转换][HDRPIX]、[HDR集成][HDOC] |
| C016 Histogram、Info、采样器与测量 | Window > Histogram/Info；Color Sampler/Ruler/Count | 看全图/选区分布、多个采样点，识别剪切与数值变化 | **部分 / PS实测局部**；拾色器/采样环有入口；alpha23有持久多点Info与标尺/量角/单位/DPI/保存，8/16/HDR原始与merged读数；完整多通道直方图、计数和测量日志欠缺。[拾色器][PICKER]、[UI][UI] |

HDR 真显示要有操作系统、显卡和显示器配合，且 Photoshop 自身支持的工具仍与模式相关。[HDR 显示设置，2026-09-30](https://helpx.adobe.com/photoshop/desktop/adjust-color/hdr-and-channel-manipulation/set-up-hdr-display-support-in-photoshop.html)、[32 位工具说明，2026-10-06](https://helpx.adobe.com/photoshop/desktop/adjust-color/color-profiles/tools-with-32-bit-support-in-photoshop.html)、[OpenColorIO](https://helpx.adobe.com/photoshop/using/opencolorio-transform.html?trk=article-ssr-frontend-pulse_little-text-block)

<a id="family-c"></a>
### C. 导航、裁剪与几何（C017–C024）

Photoshop 非破坏裁剪由 Delete Cropped Pixels 控制，并可恢复隐藏画布内容。Ruler Straighten、Trim、Crop And Straighten Photos 是不同工作流程。[非破坏编辑，2026-09-28](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/create-layer-compositions/non-destructive-editing-techniques.html)、[裁剪/自动分图/拉直，2026-10-06](https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/resize-adjust-resolution/crop-and-straighten-images.html)

| 编号 / 能力 | Photoshop 入口、选项 | 效果 / 建议复现 | 项目状态、差异与证据 |
|---|---|---|---|
| C017 Hand/Zoom/Navigator | H/Z、Space；Fit/100%，Navigator | 连续定位细节，缩放不改变图像文件像素 | **可用 / 项目验收**；Fit/100%/百分比/平移/Navigator 有入口；鸟瞰/跨文档同步导航未齐。[UI][UI]、[视图][VIEW] |
| C018 Rotate View 与屏幕模式 | R；拖动视图角度；F、Tab | 只旋转查看，输出方向不变；笔势坐标仍准确 | **可用 / 项目验收**；旋转查看、复位、隐藏面板已实现；PS 三种屏幕模式细节有差异。[旋转视图][ROTATEVIEW]、[profile][PROFILE] |
| C019 Move、自动选择、对齐/分布、吸附 | V；Auto Select、Show Transform Controls、align/distribute | 多层对象等距、对齐边缘/中心；吸附不跳错层 | **部分 / 项目验收**；移动、多选、对齐/分布/网格标尺guides/snap 已有；完整 smart guides、测距提示/画板范围未齐。[图层布局][LAYOUT]、[UI][UI] |
| C020 Free Transform、Scale/Rotate/Skew/Distort | Edit > Free Transform；数值、参照点、插值 | 缩放旋转图片，检测边缘AA、重复缩放损失 | **部分 / 未对照**；数值/句柄变换、透视四角和高位深warp已有；PS 参考点与全部 Warp 等欠缺。[distort][DISTORT]、[UI][UI] |
| C021 交互 Crop、非破坏恢复 | C；比例/尺寸，移动/调整/旋转框，Enter/Esc | 裁剪→扩大画布找回边缘；不丢 16/HDR 源 | **部分 / PS实测RGB8恢复+项目验收**；非破坏裁剪已有，本轮8/16/HDR source恢复/保存/Undo/reopen 7 tests PASS；新增RGB8原生保存重开/扩画布恢复RGBA零差，项目原生引用回归PASS；高位深与任意场景的PS效果未外推。当前deleteCroppedPixels:false为明确支持语义，true原子拒绝，不显示伪可用删除选项；删除模式、完整preset/overlay未齐；alpha21新增参考线拉直与透视裁剪，具体精度/保守拒绝边界见[A21]，本批开发版与安装包全套GUI门禁已PASS，不能外推未覆盖的裁剪模式。[crop][CROP]、[无损裁剪测试][TCROP]、[原生引用测试][TCROPNATIVE]、[alpha.20记录][A20] |
| C022 Perspective Crop / Ruler Straighten | Crop模式；拉直参考线、透视四角、手动输出尺寸、Enter/Esc | 把倾斜票据变矩形；最近水平/垂直线旋正，保留/重采样策略 | **部分 / PS实际GUI几何和像素对照**；alpha21参考线自动角度与内接裁剪、四角透视交互、8/16/HDR源采样及Undo/保存重开已实现；拉直原生−7.125016°和430×269匹配且源保留，最终PS栅格化效果未等效；同四角PS自动387×257 vs项目建议348×224；固定348×223 alpha零差、RGB MAE4.486470/max237，保留实质差距。透视重新采样并对组/调整/效果/参考线/非零羽化蒙版保守原子拒绝；alpha23新增四点逐次输入、前三点拒绝提交、无效第四点重试及取消清理，未换生产采样核；自动分图未做。[crop][CROP]、[alpha21裁剪][CROP21]、[验收][A21] |
| C023 Image Size / Resolution / Resample | Image > Image Size；resample off、nearest/bilinear/bicubic 等 | 分辨率-only不改像素；2×放大比较细线/锐度/16位样本 | **部分 / 项目验收**；高位深重采样与 resolution已有；PS自动、Preserve Details/算法核/锐化细节未匹配。[尺寸面板][SIZE]、[16重采样][RESAMPLE16]、[HDR重采样][RESAMPLE32] |
| C024 Canvas Size / Trim / Flip / Rotate | Image > Canvas Size/Trim/Rotation | 锚点扩边、透明/背景边裁切；正确更新层和mask坐标 | **可用 / 项目验收**；核心几何命令已有；Trim全部颜色/边选项和 Reveal All 专用入口需逐项核对。[像素动作][PIXEL]、[尺寸效果][SIZEFX] |

<a id="family-d"></a>
### D. 选区（C025–C032）

**Selection Brush 是直接画覆盖，Quick Selection 是依据图像边缘扩展区域**，二者不是换一个名称的同一工具。前者有不透明度/硬度与增减模式，后者有 Sample All Layers/Enhance Edge 等图像相关选项。[Selection Brush，2026-02-23](https://helpx.adobe.com/photoshop/desktop/make-selections/freehand-selections/create-quick-selections-with-selection-brush-tool.html)、[Quick Selection，2026-02-23](https://helpx.adobe.com/photoshop/desktop/make-selections/automatic-color-based-selections/paint-a-selection-with-quick-selection-tool.html)

| 编号 / 能力 | Photoshop 入口、选项 | 效果 / 建议复现 | 项目状态、差异与证据 |
|---|---|---|---|
| C025 Rect/Ellipse/Single Row/Column Marquee | M；New/Add/Subtract/Intersect、Feather、AA、Style | 几何覆盖；0.5px/边缘/很小选区检查透明覆盖 | **部分 / PS实测羽化局部**；矩形/椭圆、组合、AA羽化已实现；单行/列、全部固定尺寸样式未齐。[coverage][SEL]、[像素契约][PCONTRACT] |
| C026 Free/Polygon/Magnetic Lasso | L/Shift+L；混合Alt线段、backtrack | 不规则范围、直线边、磁吸图像边 | **部分 / 项目验收**；alpha23修复闭合自由套索并新增磁性吸附、自动/手动锚点、Enter/Esc/Backspace；PS私有边缘核和完整临时切换未齐。[UI][UI]、[coverage][SEL] |
| C027 Magic Wand | W组；tolerance、contiguous、AA、sample area/all layers | 相近颜色连通区域；检查透明与平均取样行为 | **可用 / 未对照**；point/3×3/5×5、连续/全部层已有；原生色差尺度、抗锯齿边缘待实测。[像素契约][PCONTRACT]、[pixel actions][PIXEL] |
| C028 Quick Selection / Object Selection | W组；对象矩形/套索/悬停、识别区域、增减 | 沿物体边界扩展；无需手工描边 | **部分 / PS实测局部**；Object point/box已有；alpha23新增真正多种子/边缘区域Quick Selection及All Layers、加减；原生圆形样本覆盖IoU98.46%，边缘1112像素不同；Enhance Edge、hover Finder/全部检测选项仍缺。[subject][SUBJECT]、[选择工具][OBJECTUI] |
| C029 Select Subject / People / Sky / Remove Background | Select、Contextual Task Bar；本机/云处理依功能 | 自动主体、人脸部件/衣服/天空；输出选区或蒙版 | **部分 / 未对照自然图**；subject/remove-background 有链；People各部位/Sky专用模型欠缺，不能叫复杂发丝已经完成。[subject][SUBJECT]、[matte][MATTE] |
| C030 Color Range / Focus Area | Select > Color Range/Focus Area；fuzziness/localized | 同色跨不连通区域、明暗段/肤色、景深主体 | **部分 / 未对照**；基础 Color Range已有；PS全部预置、吸管增减、Focus Area欠缺。[像素契约][PCONTRACT]、[UI][UI] |
| C031 Modify / Feather / Border / Grow / Similar | Select > Modify；扩展/收缩/平滑/边界/羽化 | 将硬选区变软，组合/反选后保留覆盖 | **部分 / PS实测局部**；expand/contract/feather/invert已有，羽化多半径已测。[羽化][FEATHER]、[morphology][MORPH]、[fixture][FSEL] alpha.22补Smooth取样半径1–100与Border居中总宽1–200，软覆盖物化并避免重复羽化；整数/ROI/邻域预算及原子性通过定向检查，原生私有核尚未逐像素对齐。Grow/Similar仍需补。[Smooth/Border][SMOOTH22]。 |
| C032 Transform Selection、Save/Load、Reselect | Select菜单、Channels；边界变换 vs 像素变换 | 保存软选区重开；移动边界不得移动图片 | **部分 / 项目验收**；命名覆盖保存/载入/组合和像素transform已有；完整 Transform Selection 边界任意变形、跨文档alpha仍需补。[named][NAMED]、[选区变换][SELTRANS] alpha.22新增Reselect与Cmd/Ctrl-Shift-D；缓存按session隔离，文档几何动作及对应历史跳转失效；载入/存储命名选区菜单指向现有面板，不是全部Channels对话。[本批验收][A22]。 |

Adobe 存载选区以 Alpha Channels 为正式载体，提供跨同尺寸文档和组合方式；项目命名 RLE 选区保留覆盖，但不等于完整通道系统。[存载选区，2026-10-06](https://helpx.adobe.com/photoshop/desktop/create-masks/layer-masks/save-and-load-selections.html)

<a id="family-e"></a>
### E. 蒙版、通道组合和抠图（C033–C040）

Raster mask 的黑/白/灰控制隐藏/可见/部分覆盖，Vector Mask 则保留路径边界；两者不能只存一个 PNG 然后声明相同。属性 Density 与 Feather 不修改源蒙版，destructive Gaussian Blur 则修改像素。[图层蒙版](https://helpx.adobe.com/photoshop/desktop/create-masks/layer-masks/add-layer-masks.html)、[编辑蒙版](https://helpx.adobe.com/photoshop/desktop/create-masks/layer-masks/edit-and-refine-layer-masks.html)、[矢量蒙版](https://helpx.adobe.com/photoshop/using/masking-layers-vector-masks.html)

| 编号 / 能力 | Photoshop 入口、选项 | 效果 / 建议复现 | 项目状态、差异与证据 |
|---|---|---|---|
| C033 Raster Layer Mask | Layers加mask；Reveal/Hide All/Selection、Disable/Apply/Delete | 原图不删，画灰形成半透明边；Apply才烘焙 | **可用 / 项目验收**；增删/反转/禁用/烘焙/画笔目标已有；保留明确范围/外围默认值；本批修复PS蒙版1:1整数对齐再次插值模糊，实际灰度/Preview/Apply/Undo/保存重开6case/12checks PASS，其他变换原生效果未外推。[mask][MASK]、[bake][BAKE]、[灰度与交互记录][GMASK20] alpha.22菜单Reveal All/Hide All明确忽略当前选区，Reveal Selection单独使用选区；启用/停用/删除蒙版具有typed命令。 |
| C034 Mask Density / Feather / Properties | Window > Properties；density、feather、mask border | 保留底层mask，属性改变最后覆盖；组合顺序决定边缘 | **部分 / PS实测密度、羽化局部**；源与属性分离已实现。alpha21共31个有效原生输出（半径有重复），小核采样方差与连续Gaussian/box4过渡使最坏最大差19→6/255，无max退化；0.3为0、1px为2，0.6/0.7仍6/5，3px仍3。≥2px和旧模型保持；1:1灰度bitmap/Preview/Apply/Undo/保存重开由正式GUI门禁验收。PS UXP文档feather可到1000而项目UI250；变换单位/灰度/16/HDR仍未完整原生对照。[属性][MASKPROP]、[mask][MASK]、[alpha21参考][MASK21]、[验收][A21] |
| C035 Mask link/unlink、独立移动、显示/载选区 | thumbnail Alt/Shift/Ctrl；link图标，变换 | unlink后图层移动mask不跟随；外部有限mask外白/外灰正确 | **可用 / 项目验收**；独立placement、mask-alone/effective覆盖已修复；有限1×1与无限均匀语义仍须明确。[placement][PLACE]、[显示][MASKDISPLAY]、[边界测试][TMASK] |
| C036 Quick Mask / Selection Brush 局部覆盖 | Q；灰度画笔，Exit转选区，overlay color | 黑/白/灰画出软选区，退出后coverage一致 | **可用 / 项目验收**；局部绘制、增减、undo、命名覆盖已有；与PS全部overlay选项/快捷手势还需对照。[selection paint][SELPAINT]、[UI][UI] |
| C037 Vector Mask、path密度/羽化 | Layer > Vector Mask；Paths生成 | 缩放圆/贝塞尔边不丢精度，保留路径编辑 | **部分 / 未对照**；部分PSDvector识别/回退存在；没有完整向量蒙版作者工具与路径编辑。[PSD vector][PSVECTOR]、[content schema][CONTENT] |
| C038 Apply Image / Calculations / Channel Operations | Image > Apply Image/Calculations；源层/通道/模式 | 两通道Multiply/Screen得到发丝alpha或纹理混合 | **缺少**；无通道运算完整入口/来源模型。[动作契约][PCONTRACT]、[工程契约][CONTRACT] |
| C039 Select and Mask / Refine Hair / Decontaminate Colors | Select > Select and Mask；视图、radius/smart radius、refine brush、output | 发丝透明度与前景颜色分离，换黑/白/彩底不带原背景边 | **部分 / 自然发丝未验证**；matte、refineEdges/contrast/shift/feather 面板已有；专用局部Refine Edge画笔、颜色净化/全输出语义和复杂自然图证据不足。[refine UI][REFINE]、[matte][MATTE] |
| C040 AI Enhance Edge（27.11） | masked layer Contextual Task Bar > Enhance edge | 处理背景残色并改善毛发/半透明边，检查RGBA而不只alpha | **缺少**；本地matte不是Adobe RGBA diffusion功能；账号/credits/服务条件与普通羽化不同。[matte][MATTE]、[Agent][AGENT] |

属性 API 的范围仅说明公开接口，不证明任何内核：[Adobe UXP Layer](https://developer.adobe.com/photoshop/uxp/ps_reference/classes/layer/)。27.11 Enhance Edge 目标包括移除边缘背景残色，与几何模糊不是同一效果。[Enhance Edge，2026-10-05](https://helpx.adobe.com/photoshop/desktop/create-masks/layer-masks/use-enhance-edge-to-refine-masks.html)

<a id="family-f"></a>
### F. 绘画、笔刷和填充（C041–C048）

尺寸/硬度改变笔尖覆盖；Opacity 限制一笔上限，Flow 控制各落点累积，Spacing 决定落点间距，Smoothing 控制输入路径；这些参数必须分开研究。[画笔选项](https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/brushes-presets/display-brush-panel-brush-options.html)、[画笔/铅笔绘画](https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/brushes-presets/paint-with-brush-or-pencil-tool.html)

| 编号 / 能力 | Photoshop 入口、选项 | 效果 / 建议复现 | 项目状态、差异与证据 |
|---|---|---|---|
| C041 普通圆笔尖、颜色、模式、硬度 | B；tip size/hardness、blend mode | 单点、直线、转弯、重复一笔；在1:1比较alpha边缘 | **部分 / PS实测局部**；alpha21近硬连续有界半径修正，158项原生参考union MAE为15改善/142覆盖不变/1轻微退化（48px/h92 MAE+0.018，max仍9）；原112项无退化且旧限值不放宽。64px/h95 max41→21–22，96/128px h95→25/27；大尺寸h100仍34/32。自由笔势/数位板/画笔混合模式/所有硬度及ABR尚不全。[coverage][BRUSH]、[原生测试][TBRUSH]、[alpha21分析][BRUSH21]、[验收][A21] |
| C042 Opacity / Flow / Spacing / Airbrush | 数字/Shift数字、笔刷选项/Brush Settings | 同一路径单笔vs抬笔重画，低flow稠密dab，停笔喷涂 | **部分 / PS实测残差**；opacity/flow/spacing有链；连续弧长/单精度spacing修复后Soft32 Flow20 Spacing20 max41→5、Hard51→19，alpha21另采64px/h95 Flow20线条最大差21→18，仍有残差；完整airbrush time积累欠缺。[dynamics][DYNAMICS]、[alpha.20记录][A20] |
| C043 Pressure / Tilt / Stylus / Smoothing | pen pressure开关、Brush Settings；smoothing | 同笔迹压力渐变，速度/倾斜改变笔迹 | **部分 / 项目验收**；pressure-size/opacity和smoothing有模拟事件测试；真笔压/倾角/延迟/预测未实机对照。[dynamics][DYNAMICS]、[UI][UI] |
| C044 Presets / ABR / Shape Dynamics / Texture / Dual Brush / Scatter | Window > Brushes/Brush Settings | 纹理刷、散点、双笔尖、湿边等不同材质，不是圆刷大小变化 | **缺少**；没有完整预设库、ABR导入或这些独立动态。[dynamics][DYNAMICS]、[brush controls][BRUSHUI] |
| C045 Pencil / Color Replacement | B隐藏组；硬像素/采样、limits/tolerance | 1px像素画不AA；只换色保持明暗纹理 | **缺少**；硬圆Brush不等于Pencil的像素语义；未实现颜色替换专用采样流程。[工具UI][UI]、[动作][PCONTRACT] |
| C046 Mixer Brush / History / Art History Brush | B/Y组；wet/load/mix/flow、history source | 油画混色或从历史状态按笔迹恢复局部 | **缺少**；Smudge不能替代湿混色或历史源。[retouch][RETOUCH]、[工具UI][UI] |
| C047 Eraser / Background / Magic Eraser | E组；删除透明/背景取样/颜色容差 | 普通擦除alpha；背景擦除保留前景色与细边 | **部分 / 项目验收**；alpha.28增加独立E组、背景与魔术擦除（RGB8/16）；两组关闭AA原生Magic基础测试像素一致，AA边缘仍有256像素差异，BG原生效果未验。Find Edges、边缘去污和HDR仍欠缺，见[本批侧栏标记](PHOTOSHOP_TOOLBAR_ALPHA28_2026-10-14.md)。[paint][PAINT16]、[动作][PCONTRACT] |
| C048 Fill / Paint Bucket / Pattern / Gradient | Edit > Fill；G组，color/pattern/mode/opacity、gradient editor | 全区/连通bucket、pattern平铺、线性/径向/角度等渐变 | **部分 / 项目验收**；前背景填充、线性/径向2色/透明渐变已有；真正bucket、pattern、多stop/角度/反射/菱形与PS interpolation未齐。[fill][FILL]、[deep fill][DEEPFILL]、[UI][UI] |

Texture/Dual Brush 有独立图案、深度与第二笔尖参数，不能在“已有动态画笔”的计数里视为实现。[纹理/双笔尖，2026-10-07](https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/brushes-presets/textured-and-dual-brush-settings.html)

<a id="family-g"></a>
### G. 修复、涂抹、液化（C049–C056）

修图的目标包括取样位置、纹理连续、颜色融合、非破坏输出和重复操作稳定；只有“污点看似消失”不能证明算法相同。Patch 可手动指定来源；Content-Aware Fill 有专用采样区域和输出。[Patch，2026-09-29](https://helpx.adobe.com/photoshop/desktop/repair-retouch/remove-objects-fill-space/use-the-content-aware-patch-tool.html)、[Content-Aware Fill，2026-06-02](https://helpx.adobe.com/photoshop/desktop/repair-retouch/remove-objects-fill-space/remove-objects-with-content-aware-fill.html)

| 编号 / 能力 | Photoshop 入口、选项 | 效果 / 建议复现 | 项目状态、差异与证据 |
|---|---|---|---|
| C049 Clone Stamp / Clone Source / Pattern Stamp | S；Alt sample、aligned、current/below/all、source transform | 复制纹理；跨层取样不重复叠调整，来源旋转缩放可控 | **部分 / 未对照真实纹理**；aligned/current/all和采样overlay已有；多个source、samplecurrent&below/ignoreadjustments/source变换/patternstamp欠缺。[retouch][RETOUCH]、[source UI][CLONEUI] |
| C050 Healing Brush | J；Alt sample、diffusion、sample/ignoreadjustments | 搬纹理并融合周围色调，不应产生硬贴片 | **部分 / 未对照**；alpha23有Photoshop交互配置下的冻结原供体、预乘双线性软边和边界色调融合；旧Compositor调用保持；扩散尺度、自然照片与PS像素仍未统一对齐。[retouch][RETOUCH]、[deep strokes][DEEPSTROKE] |
| C051 Spot Healing / Remove / Red Eye / Find Distractions | J组；content-aware/proximity/texture，Remove options | 去痘/电线/人群；自动检测分散物和红眼 | **部分 / 局部原生对照**；3种spot-heal已有；alpha24新增独立Remove笔划/闭环与Red Eye拖框/单击，红瞳中性化有原生量化。alpha.25红眼RGB8源≤16MP、眼部工作区≤2MP，Remove仍≤2MP；Adobe AI Remove/自动干扰物检测与自然人像质量未齐。[retouch][RETOUCH]、[UI][UI] |
| C052 Patch / Content-Aware Move / Extend | J组；Source/Destination、structure/color、Move/Extend | 选区拖到来源修补；移动物体后填旧洞 | **部分 / 项目验收**；alpha23有真实RGB8当前层Patch Source/Destination拖拽、预览、融合、选区更新与Undo；alpha24新增Move选区拖动→填旧洞→融合目标→Enter应用，一步Undo；Content-Aware Patch、Pattern、Diffusion、Extend及16/HDR仍缺。[content fill][CFILL]、[动作][PCONTRACT] |
| C053 Content-Aware Fill 专用工作区 | Edit > Content-Aware Fill；sample overlay/output | 选择允许样本、保护人物、输出独立层，检查纹理/重影 | **部分 / 未对照真实图**；有本地patch填充与取消/确定；完整取样工作区/PS结构及输出行为未齐。[fill][CFILL]、[native patch][PATCH] |
| C054 Blur / Sharpen Brush | Blur/Sharpen/Smudge组；strength、protect detail、sample all | 局部柔化/锐化，重复stroke变化与细节保护 | **部分 / 未对照**；8/16/HDR Blur笔刷有链；Sharpen Brush和ProtectDetail缺少，原生radius/strength尺度待测。[deep blur][DEEPBLUR]、[retouch][RETOUCH] |
| C055 Smudge / Finger Painting及局部调色笔刷 | Smudge；strength、fingerpainting、sampleall | 推动颜色，前景色起笔，处理透明边不带黑 | **部分 / 未对照**；高位深/浮点smudge存在；完整手指画/多层采样与PS笔尖演化未齐；Dodge/Burn/Sponge专用工具缺少。[retouch][RETOUCH]、[HDR strokes][HDRSTROKE] |
| C056 Liquify（含 Face-Aware / Freeze / Mesh） | Filter > Liquify；push/twirl/pucker/bloat/reconstruct/freeze | 身形/脸部局部warp，保护区不动，保存mesh可重用 | **部分 / 未对照**；当前brush推移形式liquify不等于完整dialog；面部参数/冻结/网格保存/重建/全部工具欠缺。[retouch][RETOUCH]、[deep warp][DEEPWARP] |

Liquify、Warp、Puppet Warp 和普通 Distort 是不同可控变形层级，面部滑块不是普通推移的别名。[变形工具，2026 文档](https://helpx.adobe.com/photoshop/desktop/effects-filters/artistic-stylize-filters/overview-of-distortion-tools.html)、[Freeze/Thaw](https://helpx.adobe.com/photoshop/desktop/effects-filters/artistic-stylize-filters/freeze-or-thaw-areas.html)

<a id="family-h"></a>
### H. 图层与非破坏合成（C057–C064）

Smart Object 保留来源及重复变换，Smart Filters 是可编辑、可重排/遮罩/独立混合的滤镜栈；不是“保存filter参数”即可等价。[Smart Objects](https://www.adobe.com/products/photoshop/smart-objects.html)、[Smart Filters，2026-10-04](https://helpx.adobe.com/photoshop/desktop/effects-filters/smart-filters/apply-and-manage-smart-filters.html)

| 编号 / 能力 | Photoshop 入口、选项 | 效果 / 建议复现 | 项目状态、差异与证据 |
|---|---|---|---|
| C057 Layer / Group / Merge / Lock / Order | Layers；multi-select、rename、visible、merge/stamp、lock types | 保留层结构，多层组合和Undo不改变错误对象 | **可用 / 项目验收**；基本层/组/merge/stamp、全锁/位置锁已有；完整按属性filter/颜色标签/锁类型未齐。[layers][LAYER]、[locks][LOCK] |
| C058 Blend Modes / Opacity / Fill | Layers / Layer Style；mode、opacity、fill | 灰度/彩色色块叠加，比较所有通道及alpha | **部分 / 未对照全模式**；24 modes有契约；Dissolve/DarkerColor/LighterColor及独立Fill欠缺，8/16/32与PS模式计算仍须分开测。[契约][CONTRACT]、[8模式表][BLENDS]、[合成][DEEP] |
| C059 Clipping Masks 与多层裁切链 | Layer > Create Clipping Mask；Alt分界 | 多层依基础层alpha显示，组/调整clip不泄漏 | **可用 / 项目验收**；有maskSourceID裁切；PS复杂裁切链、隔离组/混合交互需外部PSD验证。[工程契约][CONTRACT]、[合成][DEEP] |
| C060 Layer Styles / fx | Double-click layer；stroke/shadow/glow/overlay/bevel/satin等 | 增加边线、光、立体/材质；scale/globallight/contours影响结果 | **部分 / 未对照**；stroke/shadow/colorOverlay/innerShadow/outerGlow/innerGlow共6类；Bevel/Emboss、Satin、Gradient/PatternOverlay、多实例、轮廓/全局光未齐。[effects][EFFECTS]、[PSD effects][PSEFFECTS] |
| C061 Adjustment / Solid / Gradient / Pattern Fill Layers | Layer > New Adjustment/Fill Layer | 参数可重开，mask局部化；源像素保持不变 | **部分 / PS实测HSL/Curves局部**；12类nativeadjustment（含项目扩展）有链；填充层/新Light/Color/Vibrance/Clarity-Dehaze等PS整套未齐。[filters][FILTERS]、[16调整合成][DEEPADJ] |
| C062 Embedded/Linked Smart Objects | Layer > Smart Objects；contents/relink/replace/copy | 多次缩放保持原source；更新链接同步实例 | **缺少可编辑工作流**；PSD metadata/像素fallback保留不等于contents editor、链接、实例/无损warp。[PSD editable][PSEDIT]、[PSIO][PSIO] |
| C063 Blend If / knockout / channels / isolation / pass-through | Layer Style > Blending Options；split sliders等 | 按明暗把纹理隐藏；Fill/opacity差异；组是否隔离改变效果 | **缺少关键语义**；部分来源metadata可能保留，当前合成无完整BlendIf/knockout/Fill/隔离实现。[契约][CONTRACT]、[composite][DEEP] |
| C064 Layer Comps / Auto Align / Auto Blend / Stacks | Window > Layer Comps；Edit > Auto-Align/Auto-Blend | 保存构图状态，照片对齐、景深堆栈或全景融合 | **缺少**；普通group、merge或手工对齐不能代替自动图像配准/融合及composition快照。[layers][LAYER]、[动作][PCONTRACT] |

Layer Style 入口和高级混合行为分别参考 [样式，2026-02-23](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/apply-layer-effects/work-with-layer-styles.html)、[高级混合，2026-10-06](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/apply-layer-effects/use-advanced-blending-options.html)。独立 Fill 尤其影响样式/特殊模式，不能用层Opacity直接代替。

<a id="family-i"></a>
### I. 文字、形状和路径（C065–C072）

Photoshop 文字保持可编辑，支持点/段落、纵排、路径和变形；段落排版与 OpenType 功能也是图片效果的一部分，因为字体度量/字距/换行差异会改变布局。[文字类型](https://helpx.adobe.com/photoshop/desktop/text-typography/type-layers-creation/type-layers-in-photoshop.html)、[点/段落创建，2026-10-10](https://helpx.adobe.com/photoshop/desktop/text-typography/type-layers-creation/create-point-type-and-paragraph-type.html)

| 编号 / 能力 | Photoshop 入口、选项 | 效果 / 建议复现 | 项目状态、差异与证据 |
|---|---|---|---|
| C065 Point/Paragraph Type，文字编辑 | T；拖框/点创建，插入选区，commit | 中英混排、emoji、字体fallback；重开仍可编辑 | **可用基础 / 项目验收**；横排点/固定框、字体/颜色runs和TySh写出已有；像素字形/基线与PS不可保证。[text schema][CONTENT]、[text raster][TEXTRASTER]、[PSD editable][PSEDIT] |
| C066 Character / OpenType / Font Variations | Window > Character；kerning/tracking/leading/style | 精细控制字间距、连字、轴、上下标与baseline | **部分 / 未对照**；font/color/size/tracking/leading和局部runs；全部kerning方式、variable轴、OpenType、glyphs欠缺。[content][CONTENT]、[font UI][FONTUI] |
| C067 Paragraph / Composer / Styles | Window > Paragraph/Paragraph Styles | 端点/两端对齐、缩进、连字符、样式跨层更新 | **部分 / 未对照**；Left/Center/Right与box已有；justify/indent/hyphenation/composer/style系统缺少。[content][CONTENT]、[text raster][TEXTRASTER] |
| C068 Vertical / Type Mask / On Path / Warp Type | T隐藏组、Paths、Warp Text | 沿曲线排字、竖排、弧形文本保持字符可编辑 | **缺少完整作者流程**；PSD相关层可像素fallback；不存在path/vertical编辑与PSwarp参数。[PSD editable][PSEDIT]、[content][CONTENT] |
| C069 Shape / Fill / Stroke / Polygon / Custom Shape | U组；shape/path/pixels、corners/stroke | 不丢矢量边；描边对齐/虚线/角点决定像素效果 | **部分 / 未对照**；Rectangle/Ellipse/Line与圆角基本型；Polygon/Custom、完整stroke/style、任意路径未齐。[shape schema][CONTENT]、[raster][TEXTRASTER] |
| C070 Pen / Curvature / Freeform / Work Path | P；Bezier anchor、handles、closed/openpath | 精确商品抠图，路径可转换selection/vector mask | **缺少**；SVG导入或矩形shape不是交互Pen/Paths系统。[content][CONTENT]、[SVG][SVG] |
| C071 Path/Direct Selection / Boolean / Fill-Stroke Path | A、Paths；pointedit/adddelete/union/intersect | 控制单个锚点/复合路径，再填/描边/转选区 | **缺少**；无完整path节点模型和工具链。[content][CONTENT]、[动作][PCONTRACT] |
| C072 Frame / Artboards / SVG placement | K、V隐藏画板、SVG放置 | frame替换内容裁切；多画板独立尺寸导出 | **部分 / 项目验收SVG导入**；SVG可导入，但Frame/Artboard作者/导出、独立vectorasset与smartsource欠缺。[SVG][SVG]、[导出][EXPORT] |

参考 [段落，2026-10-10](https://helpx.adobe.com/photoshop/desktop/text-typography/characters-glyphs/format-paragraphs.html)、[OpenType，2026-02-23](https://helpx.adobe.com/photoshop/desktop/text-typography/select-manage-fonts/apply-opentype-features.html)、[段落样式，2026-10-10](https://helpx.adobe.com/photoshop/desktop/text-typography/characters-glyphs/create-and-manage-paragraph-styles.html)、[Pen，2026-02-23](https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/draw-paths-with-the-pen-tool.html)、[锚点编辑，2026-10-09](https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/edit-path-segments.html)、[Custom Shape](https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/draw-custom-shapes.html)。

<a id="family-j"></a>
### J. 明暗、颜色调整（C073–C080）

Image > Adjustments 的像素调整与 Adjustment Layer 是两条路径，参数相同也要分别验收选区、蒙版、stack、位深与Undo。官方当前命令族包括 Levels/Curves/Exposure/Selective Color/Channel Mixer 等。[颜色调整命令，2026-10-06](https://helpx.adobe.com/photoshop/desktop/adjust-color/color-corrections/color-adjustment-commands.html)

| 编号 / 能力 | Photoshop 入口、选项 | 效果 / 建议复现 | 项目状态、差异与证据 |
|---|---|---|---|
| C073 Brightness/Contrast / Exposure / Light / Shadows-Highlights | Adjustments、调整层；legacy/offset/gamma、light参数 | 曝光改总体亮度；局部亮暗压缩要保细节，不只是整体gamma | **部分 / 未对照全族**；Exposure及CameraRaw相关参数；PS新Light/独立BrightnessContrast/ShadowHighlight完整入口欠缺。[filters][FILTERS]、[HDR pixels][HDRPIX] |
| C074 Levels / Auto Color-Contrast-Tone | Levels，分通道in/out、gamma、吸管/autooptions | 黑白点映射、midtones改变，auto不可偷偷剪高光 | **部分 / 未对照全选项**；基础Levels有8/16核；PS auto策略/吸管/所有通道与边界需对照。[deep filters][DEEPFILTER]、[filters][FILTERS] |
| C075 Curves / Pencil / Targeted / Per Channel | Curves；控制点、通道、draw、auto | 调tone曲线/交叉处理；暗部微调可看16位低位变化 | **部分 / PS实测一个曲线**；基本/通道曲线已有；插值、多点极端/auto/targetedtool未全测。[deep filters][DEEPFILTER]、[alpha.17][A17] |
| C076 Hue-Saturation / Colorize / Vibrance / Color | HSL按颜色区间；newColor-Vibrance | 换商品色而保光影；vibrance与saturation保护肤色不同 | **部分 / PS实测HSL局部**；HSL及部分CameraRaw振动度；PS Color/Vibrance新layer/全部目标区间/Colorize细节未齐。[filters][FILTERS]、[deep filters][DEEPFILTER] |
| C077 Black-White / Color Balance / Desaturate | RGB颜色权重、tones/protectluminosity | 不是简单灰度平均；不同颜色可在黑白里分离 | **可用基础 / 未对照**；blackWhite/colorBalance/invert有8/16与部分HDR路径；PS参数默认与保护亮度需色块实测。[filters][FILTERS]、[deep filters][DEEPFILTER] |
| C078 Selective Color / Channel Mixer | CMYK sliders within RGB colorfamilies、relative/absolute；monochrome mix | 只改红/灰等颜色中的墨量，或交换/组合通道 | **缺少**；HSL无法替代SelectiveColor/ChannelMixer；需要独立非破坏参数/位深核。[filters][FILTERS]、[deep filters][DEEPFILTER] |
| C079 Gradient Map / Color Lookup / Photo Filter | gradient stop/LUT/intensity/preserve luminosity | 灰度→渐变配色，3D LUT色彩映射，暖冷滤镜 | **部分 / 未对照**；基础GradientMap已有；复杂gradient编辑、3DLUT管理/ColorLookup/PhotoFilter缺少。[filters][FILTERS]、[UI][UI] |
| C080 Match/Replace Color / Posterize / Threshold / Invert | Image > Adjustments | 匹配另一图色调、目标换色、离散色阶/二值化/反相 | **部分 / PS实测局部**；Invert已有。[filters][FILTERS]、[动作][PCONTRACT] alpha.22补独立Threshold(1–255)/Posterize(2–255)与RGB8/16链，真实PS原生参数对照修正亮度边界和输入分桶；37个原生操作的直通颜色核对齐，产品预乘alpha路径仍有1处阈值边界及4项最多1个16位单位的色调分离残差，HDR拒绝。Match/Replace Color与这两项完整非破坏调整层仍缺。[原生阈值/色调分离][TONAL22]。 |

Selective Color 的 relative/absolute 改变量不同，应专门设计数字测试；不要用HSL冒充。[Selective Color，2026-09-30](https://helpx.adobe.com/photoshop/desktop/adjust-color/selective-color-adjustments/make-selective-color-adjustments.html) LUT 工作流参考 [Adobe Color Lookup 示例](https://www.adobe.com/learn/photoshop/web/edit-photo-color-lookup-adjustment)。

<a id="family-k"></a>
### K. 滤镜与效果族（C081–C088）

Filter 菜单中能否用某项取决于位深/模式/层类型/GPU/组件；官方兼容表只是筛选线索，实际 27.11 菜单和有效参数读回才是每例依据。不要默认 Photoshop 全滤镜都有 16/32 位路径。[滤镜参考，2026-10-04](https://helpx.adobe.com/photoshop/desktop/effects-filters/blur-sharpen-filters/filter-effects-reference.html)

| 编号 / 能力 | Photoshop 子族 / 入口 | 效果 / 建议复现 | 项目状态、差异与证据 |
|---|---|---|---|
| C081 基本 Blur | Gaussian、Box、Motion、Radial、Surface、Lens、Smart、Average/Blur/More | Gaussian柔化、motion拖影、surface保边、lens模拟景深；各核不等价 | **部分 / 未对照原生核**；Gaussian/Motion有链；其余及Lens aperture/depth图欠缺。[filters][FILTERS]、[deep filter][DEEPFILTER] alpha.22新增上游Progressive Blur扩展，线性/径向/反向与数值起终点支持8/16/HDR；未对齐CoreImage私有核、未提供拖线，不计作C082 Blur Gallery已实现。[渐进模糊][PROGRESSIVE22]。 |
| C082 Blur Gallery | Field/Iris/Tilt-Shift/Path/Spin；pins、bokeh、motioneffects | 空间变化的模糊，条带景深、运动轨迹/旋转 | **缺少**；vignette或统一blur不能替代pins/路径/深度控制。[filters][FILTERS]、[UI][UI] |
| C083 Sharpen | Sharpen/More/Edges、Unsharp Mask、Smart Sharpen | 边缘对比，threshold减少噪点，removeblur避免halo | **部分 / 未对照**；CameraRaw detail参数不等于PS滤镜；独立SmartSharpen/USM等完整入口缺少。[camera kernel][CRKERNEL]、[filters][FILTERS] |
| C084 Noise / Dust | Add Noise、Despeckle、Dust&Scratches、Median、ReduceNoise | 噪点分布/monochrome、去脏点、保边平滑 | **部分 / 未对照**；AddNoise/Grain及CameraRaw去噪有链；其他核、原生随机统计、纹理保留欠缺。[filters][FILTERS]、[camera kernel][CRKERNEL] |
| C085 Distort / Lens / Perspective / Vanishing Point | Displace/Pinch/Polar/Ripple/Shear/Spherize/Twirl/Wave/ZigZag；lenscorrection | 映射贴图、弯曲、水波、消失点平面透视 | **部分 / 未对照**；层distort、liquify、LensCorrection已有；大部分专用filters/Displace map/VanishingPoint、Puppet/PerspectiveWarp缺少。[distort][DISTORT]、[filters][FILTERS] |
| C086 Filter Gallery 创作族 | Artistic / Brush Strokes / Sketch / Texture；多效果栈 | 绘画/铅笔/炭笔/纸纹理等风格，参数改变材质 | **缺少**；grain/scanlines/dither不等于整套FilterGallery与previewstack。[filters][FILTERS]、[UI][UI] |
| C087 Stylize / Render / Pixelate / Other / Video | Emboss/FindEdges/GlowingEdges/OilPaint；Clouds/Fibers/Flame/Tree；Mosaic/Mezzotint/Pointillize；HighPass/Offset/Custom；De-interlace/NTSC | 轮廓、云纹、像素化、高通与周期移动等独立图像结构 | **部分 / 未对照**；Bloom/Vignette/TonalContrast/Dither/Scanlines是项目扩展；绝大多数PS具体滤镜尚无独立对应。[filters][FILTERS]、[camera kernel][CRKERNEL] |
| C088 Smart Filter / Neural Filter 基础设施 | SmartObject下filterstack/mask；Filter > Neural Filters | 可重开/排序/遮罩；皮肤平滑、上色、修复/风格、深度效果 | **缺少**；普通adjustment layer或filter预览不是SmartFilters；也无AdobeNeural组件/相应模型。[filter edit][FILTEREDIT]、[PSD editable][PSEDIT] |

具体创作族检索索引：Artistic 包括 Dry Brush、Fresco、Neon Glow、Paint Daubs、Palette Knife、Plastic Wrap、Poster Edges、Rough Pastels、Smudge Stick、Sponge、Underpainting、Watercolor；Brush Strokes 包括 Accented Edges、Angled Strokes、Crosshatch、Dark Strokes、Ink Outlines、Spatter、Sprayed Strokes、Sumi-e；Sketch 包括 Bas Relief、Chalk/Charcoal、Chrome、Conté、Graphic Pen、Halftone、Note Paper、Photocopy、Plaster、Reticulation、Stamp、Torn Edges、Water Paper；Texture 包括 Craquelure、Grain、Mosaic Tiles、Patchwork、Stained Glass、Texturizer。列表用于逐项定位，非宣称当前全部模式均启用。[Filter Gallery，2025-12-02](https://helpx.adobe.com/in/photoshop/desktop/effects-filters/get-started-with-filters/filter-gallery.html)

空间模糊参考 [Blur Gallery，2026-10-04](https://helpx.adobe.com/photoshop/desktop/effects-filters/blur-sharpen-filters/use-blur-gallery-depth-of-field-effects.html)、[Spin Blur，2026-10-09](https://helpx.adobe.com/photoshop/desktop/effects-filters/blur-sharpen-filters/apply-spin-blur-effects-in-blur-gallery.html)。Smart Sharpen 需研究 Amount/Radius/ReduceNoise/Remove 的区别。[官方 Smart Sharpen，2025-12-02](https://helpx.adobe.com/uk/photoshop/desktop/effects-filters/smart-filters/sharpen-controls-with-smart-sharpen.html)

Neural Filters 官方分类含 Featured 与 Beta，模型下载、账号/网络与可用性需逐例记录；不能只复制滑块名称。[Neural Gallery，2026-10-04](https://helpx.adobe.com/photoshop/desktop/effects-filters/neural-filters/neural-filters-gallery.html)、[输出方式，2026-02-23](https://helpx.adobe.com/photoshop/desktop/effects-filters/neural-filters/use-neural-filters-to-enhance-images.html)

<a id="family-l"></a>
### L. Camera Raw 与照片工作流程（C089–C096）

当前项目 CameraRaw 有许多参数，来自项目/上游内核；**不等于 Adobe Camera Raw**。应分别研究 RAW解码、调整算法、局部mask、AI增强、profile/镜头库、批处理与输出。官方 ACR 18.7 增加 Grid、Match Exposure 等，版本与 Photoshop 独立。[Camera Raw 发布说明](https://helpx.adobe.com/camera-raw/desktop/whats-new/release-notes.html)

| 编号 / 能力 | Photoshop/ACR 入口与选项 | 效果 / 建议复现 | 项目状态、差异与证据 |
|---|---|---|---|
| C089 RAW source、Process Version、profiles、XMP | Open RAW；ACR；Open/OpenObject/Done | 选择camera/profile/processversion，重新开发不覆盖原RAW | **部分 / 项目验收解码**；RAW preview/settings已有；Uint8解码结果、Adobe相机profile/processversion/XMP/RAW smartobject往返欠缺。[foreign][FOREIGN]、[raw settings][RAWSET] |
| C090 Light / WB / Color / Texture / Clarity / Dehaze / Glow | ACR Edit；temp/tint、tone、vibrance | 压高光提阴影、局部对比/去雾/亮部光晕；避免噪点/halo | **部分 / 未对照真实照片**；同名kernel和面板已有；算法/参数默认/色温单位不应按名字判相同。[camera kernel][CRKERNEL]、[RAW UI][RAWUI] |
| C091 Curves / Color Mixer / Grading / Calibration | ACR编辑子面板、点/参数曲线、3色轮 | 调单色、按明暗染色、相机原色校准 | **部分 / 未对照**；相关参数已有；细节通道尺度、targetedadjust与真实profile交互未测。[camera kernel][CRKERNEL]、[filters][FILTERS] |
| C092 Detail / Denoise / Raw Details / Super Resolution | ACR Detail/Enhance；版本/输入限制 | 保纹理去噪、重新推断细节、2×线性分辨率超分 | **部分 / 未对照**；传统detail/denoise可调，不能替代AdobeAI去噪/RawDetails/SuperResolution。[camera kernel][CRKERNEL]、[foreign][FOREIGN] |
| C093 Optics / Geometry / Crop / Defringe | ACR Optics/Geometry；lensprofile、CA、upright | 矫正桶/枕形、紫绿边、建筑透视与镜头阴影 | **部分 / 未对照**；手动lens/geometry已有；相机镜头profile库、自动Upright/完整Defringe欠缺。[camera kernel][CRKERNEL]、[raw settings][RAWSET] |
| C094 ACR Masks / Adaptive profile / local AI | ACR Masking；subject/sky/people/object/linear/radial/range/combinations | 非破坏局部曝光/颜色；自适应profile结合内容 | **部分 / 未对照**；项目adaptive相关kernel/主体mask不等于ACR独立局部maskstack/AIpeople、完整范围组合。[adaptive][CRADAPT]、[filters][FILTERS] |
| C095 HDR Merge / Panorama / Focus / Lens Blur | ACR photo merge/HDR/全景、depth/lensblur | 多曝光合成防ghost，全景投影、深度背景虚化 | **缺少完整工作流**；单幅HDR解码/合成不是多曝光merge；无完整全景/焦点堆栈或ACR深度lensblur。[HDR][HDR]、[camera kernel][CRKERNEL] |
| C096 Presets / Sync / Batch / AI Edit Status / advanced output | ACR filmstrip/grid、copy/sync、XMP/preset、AIstatus、DNG/HDRgainmap | 多张保持风格、AI依赖变化后重算、保来源输出 | **部分 / 项目验收preset**；RAW settings保存与参数重用有链；ACR批量同步、AIstatus、DNG/AVIFgainmap等缺少。[raw settings][RAWSET]、[RAW UI][RAWUI] |

官方增强页旧版曾使用独立 Enhance/DNG 流程，当前流程已有变化，应以对应安装的版本实查，不把 2024 页限制外推到 18.7。[Enhance 历史说明，2024-10-14](https://helpx.adobe.com/ph_fil/camera-raw/desktop/edit-and-enhance-images/sharpening-and-noise/enhance.html) AI处理顺序也有影响，例如降噪与去反光/生成式编辑之后的更新依赖。[AI Edit Status，2026-09-01](https://helpx.adobe.com/id_id/camera-raw/desktop/ai-and-generative-features/ai-edit-status.html)

<a id="family-m"></a>
### M. 生成式编辑与对话（C097–C104）

Adobe 生成式图像能力涉及模型、服务、账号、许可、region/credits，输出也不是传统确定性滤镜。同一提示词并不保证相同图片，验收应检测局部约束/边界/可撤销/保留原图，不把重复像素一致作为全部目标。[生成式功能，2026-05-20](https://helpx.adobe.com/photoshop/desktop/generative-ai/generative-ai-features-overview.html)

| 编号 / 能力 | Photoshop 入口、主要控制 | 效果 / 建议复现 | 项目状态、差异与证据 |
|---|---|---|---|
| C097 Generative Fill | 选区后Contextual Task Bar；prompt/model/reference | 增删/替换内容，外部未选区域保持；独立结果层 | **缺少**；传统ContentAwareFill和对话MCP不提供图像生成模型效果。[content fill][CFILL]、[Agent][AGENT] |
| C098 Generative Expand | Crop外扩/生成式扩展 | 填充扩出的空间，与原边缘语义和光线连续 | **缺少**；透明扩画布/填色不是语义扩图。[crop][CROP]、[Agent][AGENT] |
| C099 Generate Image / Reference / Model picker | Generate Image、prompt/style/composition/reference | 从描述生成素材；记录模型版本/variation来源 | **缺少**；OpenAI-compatible对话配置不是图片生成或Adobe/partner模型集成。[Agent][AGENT]、[动作][PCONTRACT] |
| C100 Prompt to Edit / selective AI edit | Edit/contextbar；区域+自然语言 | 改衣服/对象，保持脸、文字logo和其余场景 | **缺少**；已有agent命令可编排确定性工具，不能承诺语义图像模型编辑质量。[Agent][AGENT]、[动作][PCONTRACT] |
| C101 Sky Replacement / Generate Background | Edit > Sky Replacement；生成背景contextbar | 换天空同时处理前景光/色/细边，保留层结构 | **缺少**；subject mask可手工换底，但无天空专用/自动前景光色和背景生成。[subject][SUBJECT]、[Agent][AGENT] |
| C102 Harmonize / Reference-guided composite | subject像素层contextbar | 自动把光、颜色、阴影匹配新背景 | **缺少**；ColorBalance/HSL人工调色和layerfx不是AI Harmonize。[filters][FILTERS]、[Agent][AGENT] |
| C103 Generative Upscale / Generate Similar / Variations | Image > Generative Upscale；generation resultvariation | 扩大/补细节或得到可挑选变体，同时标明生成改变 | **缺少**；bicubic放大不是生成式超分，也无variation管理。[resample][RESAMPLE16]、[Agent][AGENT] |
| C104 AI Assisted Editor / Chat / Agent workflow | Photoshop AI Assisted Editor **Beta**；Web assistant/markup | 自然语言执行可审计步骤/批改，允许预览与undo | **部分 / 项目验收MCP链**；项目OpenAI-compatible Agent+12MCP tools已有；各厂家toolcalling/视觉/生成接口仍需实际服务验证，不能声称等同AdobeBeta。[Agent][AGENT]、[MCP契约][CONTRACT] |

Sky Replacement 的边缘/前景光与单纯换图片不同。[官方天空替换，2025-12-02](https://helpx.adobe.com/my_en/photoshop/desktop/effects-filters/artistic-stylize-filters/replace-the-sky-in-images.html) Harmonize 的输入层和输出条件需照版本验证。[Harmonize，2026-05-20](https://helpx.adobe.com/ca/photoshop/desktop/repair-retouch/remove-objects-fill-space/blend-subjects-with-harmonize.html) 生成式超分与传统插值目标不同。[Generative Upscale，2026-05-20](https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/enhance-image-quality-with-generative-upscale.html)

<a id="family-n"></a>
### N. 输出、自动化、协作与扩展（C105–C112）

| 编号 / 能力 | Photoshop 入口、选项 | 效果 / 建议复现 | 项目状态、差异与证据 |
|---|---|---|---|
| C105 Export As / Quick Export / Layer-Slice-Artboard assets | File > Export；format/quality/size/metadata/sRGB | 看alpha、JPG matte、缩放舍入、层/画板独立导出 | **部分 / 项目验收**；PNG/JPEG/PDF/EXR选择/预览/尺寸已有；完整layer/artboard/slice资产、预设/批量命名欠缺。[export][EXPORT]、[export codecs][EXPORTCODEC] |
| C106 Advanced format / bit depth / metadata | PSD/PSB/TIFF/PNG16/EXR/DNG/AVIF/JPEGXL等依版本 | 输出源值/层语义/profile与metadata不丢，显式拒绝不支持项 | **部分 / PS实测导入**；PNG16/EXR输出及HDR-TIFF读写相关链；PSD写RGB8、RGB32/ICC和全部格式仍不齐，需按格式版本验收。[deep export][DEEPEXPORT]、[PSIO][PSIO]、[HDR codecs][HDRCODEC] |
| C107 Print / CMYK / Separation / PDF-EPS page layout | File > Print；profile/intent/layout/bleed | 输出可校样印刷，纸白/墨量/专色可控 | **缺少**；PDF图像导出不是PS打印管理/CMYK分色/EPS排版。[export][EXPORT]、[工程契约][CONTRACT] |
| C108 Actions / Batch / Droplet / Variables / Data Sets | Window > Actions；File > Automate / Scripts | 记录/重复工具步骤，目录批处理、数据替换模板 | **缺少PS工作流 / 有MCP批命令基础**；apply_batch原子编辑不等于actionrecorder、droplet、外部文件batch。[契约][CONTRACT]、[编辑器][EDITOR] |
| C109 Scripts / UXP / Plugins / MCP extensions | File > Scripts、Plugins；automation APIs | 插件有明确权限/版本/错误路径，不破坏原工程 | **部分 / 项目验收MCP**；自有stdio MCP+command service已有；无AdobeUXP兼容、PSplugin ABI/DOM。[契约][CONTRACT]、[编辑器][EDITOR] |
| C110 Cloud docs / Versions / Share for Review / Invite edit | Cloud Open/Save；Share/Version history | 多设备/多人评论与历史版本，不丢同期修改 | **缺少**；本地recovery与agent对话不是cloudsync/协作版本系统。[恢复][REC]、[项目IO][IO] |
| C111 Timeline / Frame GIF / Video / Audio | Window > Timeline；frames/keyframes/video；Render Video | 动态帧/位置透明度样式随时间变化，输出GIF/视频 | **缺少**；工程只描述静态图层，无时间/音轨或GIF动画导出。[工程契约][CONTRACT]、[导出][EXPORT] |
| C112 Libraries / Stock / Content Credentials / File Info / Measurement | Libraries/Stock、File Info、metadata、contentcredentials | 复用素材与授权来源、证明生成/编辑来源；测量分析 | **部分基础 / 未对照**；来源metadata/许可打包有处理；无Stock/云libraries、C2PA内容凭证/完整XMP编辑/科学测量流程。[PS metadata][PSMETA]、[foreign][FOREIGN] |

输出参考 [Quick Export，2026-02-23](https://helpx.adobe.com/photoshop/desktop/save-and-export/export-files-to-different-formats/export-your-work-using-the-quick-export-as-option.html?linkId=100000383290567)、[PNG/GIF，2026-10-10](https://helpx.adobe.com/photoshop/desktop/save-and-export/save-files/save-in-png-and-gif-formats.html)、[Artboard导出](https://helpx.adobe.com/photoshop/desktop/save-and-export/export-files-to-different-formats/export-artboards-as-files.html)、[Slices，2026-09-28](https://helpx.adobe.com/photoshop/desktop/save-and-export/save-files/manage-slices-in-photoshop.html)、[印刷排版，2026-10-10](https://helpx.adobe.com/photoshop/desktop/print/prepare-images-for-page-layout-programs.html)。

自动化参考 [Batch，2026-02-23](https://helpx.adobe.com/photoshop/desktop/automate-tasks/process-a-batch-of-files/batch-process-files.html)、[工具录制，2026-10-04](https://helpx.adobe.com/photoshop/desktop/automate-tasks/automation-settings-and-presets/record-tools-in-actions.html)。动画参考 [Timeline，2026-10-10](https://helpx.adobe.com/photoshop/desktop/add-video-and-animation/create-animation-frames/timeline-panel-controls-and-features.html)、[视频导出，2026-10-10](https://helpx.adobe.com/photoshop/desktop/save-and-export/export-files-to-different-formats/export-video-from-photoshop.html)。

<a id="shortcuts"></a>
## 工具栏操作与快捷键对照

以下是默认 Photoshop 习惯的**常用子集**，不是每个原生动作的完整快捷键清单。官方历史 PDF 仍含旧插件，表中只采用与当前项目 profile 对照的常用按键；快捷键自定义、系统功能键、布局/输入焦点会覆盖默认值。项目 `Primary` 在 macOS 为 Command，在其他平台为 Ctrl；“Win绑定”表示配置映射，**不等于已在Windows硬件验收**。[官方快捷键PDF](https://helpx.adobe.com/content/dam/help/en/photoshop/using/default-keyboard-shortcuts/photoshop-keyboard-shortcuts.pdf?TVGll=wnKKa)、[当前快捷键设置说明，2026-09-08](https://helpx.adobe.com/photoshop/desktop/get-started/settings-and-preferences/view-keyboard-shortcuts.html)、[项目默认profile][PROFILE]、[项目命令][UI]

| 操作族 | Photoshop 习惯 / mac 与 Win | 项目当前情况 |
|---|---|---|
| Move、Marquee、Lasso、Wand/Object、Crop | V / M / L / W / C | 主工具已有；同组全部PS隐藏工具未齐 |
| Brush、Eraser、Healing、Clone、Gradient、Shape、Type | B / E / J / S / G / U / T | 已有基础入口；Mixer/Pencil/Patch等需按本目录差项补齐 |
| Hand、Rotate View、Zoom | H / R / Z；Space临时Hand | Photoshop profile映射；视图旋转不改输出像素 |
| Quick Mask | Q | 已支持切换、画软覆盖、退出；非历史缺项 |
| 分组切换 | Shift+工具键（PS偏好可改） | 已映射Shift M/L/W/B/E/J/S/G/U；不能切到未实现工具 |
| 面板 / 屏幕模式 | Tab / Shift+Tab；F | 已支持面板隐藏及canvas-only；完整三种PS屏幕模式仍不同 |
| 新建 / 打开 / 保存 | Cmd/Ctrl+N / O / S | 已支持，但Open Project与PS普通Open语义不完全一致 |
| Undo / Redo | Cmd/Ctrl+Z / Shift+Z | 已支持；历史快照与分叉未齐 |
| Copy / Cut / Paste / Copy Merged | Cmd/Ctrl+C/X/V；Shift+C | 已支持上下文像素/层；需继续核对文字编辑、选区、锁层优先级 |
| Duplicate / Merge / Merge Visible | Cmd/Ctrl+J / E / Shift+E | 已映射；Ctrl/Cmd+J在有选区时PS语义需专门检查，不能只当全层duplicate |
| Stamp Visible | Cmd+Option+Shift+E / Ctrl+Alt+Shift+E | 已映射 |
| Free Transform | Cmd/Ctrl+T | 已支持；选区边界、源像素、文字/shape切换上下文尚应逐项对照 |
| Select All / Deselect / Inverse | Cmd/Ctrl+A / D / Shift+I | 已支持；“隐藏边缘”与deselect须保持不同语义 |
| Foreground / Background / default | X / D | 已支持；文字/输入框焦点不能截获 |
| Fill / Feather | Shift+F5 / Shift+F6 | Photoshop profile已映射；mac功能键可能需Fn |
| 前景填充 / 背景填充 | Option+Delete / Cmd+Delete；Alt+Backspace / Ctrl+Backspace | 项目提供backspace及forwarddelete映射；需保持mask/selection/image上下文 |
| 画笔Size / Hardness | [ ] / Shift+[ ] | 已支持；输入键盘布局及不同工具上下文仍需覆盖 |
| Opacity / Flow数字 | 1–0 / Shift+1–0 | 已支持；重复数字/输入组合/临时擦除等更细手势未全齐 |
| Zoom Fit / Actual | Cmd/Ctrl+0 / 1 | 已支持 |
| Image Size / Canvas Size | Cmd+Option+I/C；Ctrl+Alt+I/C | 已映射 |
| Levels / Curves / Invert | Cmd/Ctrl+L / M / I | Photoshop profile已映射；Compositor profile保留旧import快捷键，勿混用 |
| Export As | Cmd+Option+Shift+W / Ctrl+Alt+Shift+W | Photoshop profile已映射，不再占MergeVisible的Shift+E |
| Repeat Last Filter | mac Cmd+Ctrl+F / Win Ctrl+Alt+F | 平台条件映射；重复过滤参数/位深/选区仍需验证 |
| Shortcut settings | Cmd+Option+Shift+K / Ctrl+Alt+Shift+K | 已有自定义设置，profile切换保留用户override |
| Pen / Path / Dodge-Burn-Sponge / History Brush | P / A / O / Y | 对应核心工具未实现，不能安排空快捷键冒充功能 |
| Liquify / Select and Mask | 常用Cmd/Ctrl+Shift+X / Cmd/Ctrl+Alt/Option+R | 项目仅部分工具/面板；完整快捷键与原生工作区待实现后再对齐 |

未完全对齐的常用手势还包括：暂时激活工具后释放恢复、Brush按~临时擦除、Alt右键/Control-Option拖动尺寸硬度、Shift连接上次笔点、Alt取样/恢复、拖动中Space移动选区框、doubleclick工具行为、Enter/Esc多层modal优先级、Alt将Cancel变Reset、历史/图层缩略图修饰键全部组合。这些不能仅检查图标“可点击”；必须记录起始状态→按键/拖动→释放→commit/cancel→Undo→save/reopen。

<a id="menus"></a>
## 应用菜单覆盖索引

下面用菜单而非功能族再次定位入口，不增加功能计数。

| 主要菜单 | 应研究的命令组 | 对项目的含义 |
|---|---|---|
| Photoshop（mac）/Edit Preferences（Win） | 工作区、工具、历史、GPU、暂存盘、颜色/文件/导出偏好 | 多语言/快捷键已有；全部性能与颜色偏好欠缺 |
| File | New/Open/Recent、Place、Close/Save/Revert、Import/Export/Print、Automate、Scripts、FileInfo | 文件/工程/MCP强于普通demo；专业输出/批处理/云/印刷差距明确 |
| Edit | Undo/Cut/Copy/Paste、Fill/Stroke、ContentAware、FreeTransform/Warp/Puppet/Perspective、Define presets、ColorSettings、Shortcuts | 优先修复像素上下文，再补缺项；不能所有命令都操作全层 |
| Image | Mode、Adjustments、Auto corrections、Size/Canvas/Rotate/Crop/Trim/RevealAll、ApplyImage/Calculations、HDR/Stacks | 高位深基础已有；多模式、通道组合/merge与专业颜色管理是结构性差距 |
| Layer | New/Duplicate/Group/Merge/Lock、Masks/Clipping、Styles/Blending、SmartObjects/Fill/Adjustment、Comps | 需要独立Fill/isolation/SmartObject模型，而非不断加PNG滤镜 |
| Type | 字体/方向/抗锯齿、OpenType、Warp、转换shape/path、字符/段落样式 | 当前基础横排可用，专业排版与矢量文字差距大 |
| Select | All/Deselect/Reselect/Inverse、Subject/Sky/People/Object、ColorRange/FocusArea、Modify、Grow/Similar、Transform、Save/Load、SelectAndMask | coverage作为统一数据更可靠；自动选区要按图片与mask效果验证 |
| Filter | Repeat、CameraRaw、LensCorrection、Liquify、VanishingPoint、Neural、Gallery、各滤镜族、SmartFilter | 先对齐常用有效核/参数，勿按菜单数盲目补几十个滤镜 |
| View | Zoom/屏幕/RotateView、Proof/HDR、PixelAspect、Rulers/Guides/Grid/Snap、Extras | 几何视图已有；softproof/HDR/display不能按SDR截图验收 |
| Plugins | UXP插件、管理/发现插件 | 项目MCP是自己的扩展接口；兼容AdobePlugins是另一项工程 |
| Window | Panels/Workspace、Arrange、多文档同步、Layers/Channels/Paths/History/Brush/Character/Timeline等 | 当前UI是精简工作区；缺少完整Channels/Paths/Smartfilter/排版与时间轴 |
| Help | Discover/Search、Learn、SystemInfo/Updates、GPU诊断 | 命令搜索已有；需要帮助/快捷键/不支持说明与可复现诊断信息 |

<a id="research-method"></a>
## 按相同图片、相同动作进行深度研究的方法

每个算法要先形成 Photoshop 原生基准，再写产品修复。不能凭官方名词或一张“看起来像”的截图对齐。建议固化如下协议。

1. **锁定输入**：使用授权普通照片与自行生成诊断图，不使用选品调研图；记录原图SHA、尺寸、ICC、bit depth、alpha、EXIF方向。诊断图至少有灰阶/色立方/低位梯度/线条/透明边；真实图涵盖皮肤、头发、毛发、玻璃、布料、天空、建筑和重复纹理。
2. **锁定起点**：PS版本、ACR版本、OS/GPU、图层类型/transform/mask/default、selection、foreground/background、brushpreset与所有动态、resampling都要明确。RGB8、RGB16、RGB32要分开，sRGB与其他ICC分开；一次只改待测因素。
3. **记录操作**：菜单/工具位置、点击点/路径、工具全部参数、鼠标/笔压、键盘修饰与释放时机、确认/取消/Undo、输出层方式。可脚本设置时必须读回descriptor；失败的参数不能把PNG当“该参数的PS结果”。GUI属性读回与截图作为无法可靠脚本设置时的依据。
4. **保留输出**：输入、原PS PSD/PSB、平面PNG16/EXR、alpha/原通道、脚本、参数日志与SHA独立存档。PS保存前后是否量化也要独立测。不得先把16/HDR转PNG8再比较并宣称无损。
5. **比较效果**：Alpha/RGB分别报告max/MAE/非零并集MAE/误差热图；透明边在白/黑/彩背景看fringe；真实图给100%局部对照与整图。不用只有大面积0背景的全图MAE掩盖边缘差异。
6. **比较交互**：在项目真实运行版按同动作执行，检查preview与Apply、pointerowner、离开窗口、异步取消、lease/revision、Undo/Redo、save/reopen。将效应差异和交互错误分开。
7. **区分拟合与验证**：一部分尺寸/图片用于校准，另外尺寸/半像素/边界/图片留出测试。通用算法优先，避免每个半径或每张图片特殊常数。误差界限如未达标要保留、列差距，不降门槛包装成一致。
8. **统一验收**：源码→实际开发runtime→实际目录包→跨平台/硬件，逐层通过。性能记录硬件、冷/热、4K/多层、峰值内存、p50/p95和source fidelity；不得拿PS商业优化程度口头保证自己的响应速度。

建议下一批深度效果研究矩阵：

| 批次 | 输入与相同动作 | 应观测的图片变化 | 最小独立原生参考目标 |
|---|---|---|---|
| 蒙版属性 | 已取得binary中心12半径、Density byte128+f10、贴边/反选/孔洞f10共16组；后续灰度/1px、scale/rotate、16/HDR | 边缘宽度、全画布clamp与有限mask外默认值、density顺序/量化、源是否不变 | 16组PSD/PNG与实际参数读回已归档；产品贴边123→1，f0.3仍19；6case实际灰度/Preview/Apply/Undo/重开通过，开发版与安装包全套统一GUI验收已PASS；任意变换/灰度/高位深另留出 |
| 画笔剩余残差 | 1/8/16/32/64/128 tip，hardness0/50/90/99/100，flow1/20/100，spacing/phase | 单点核、连笔密度、16位工具量化、origin相位 | 每族训练/holdout分开；含真鼠标与真笔压，明确哪些未采集 |
| Clone/Heal/Spot | 人像瑕疵、墙面纹理、透明边；same source/path/diffusion | 纹理连续、色调融合、halo、source all-layer语义 | 同图同路径+背景和source独立验证，保留RAW/16输入 |
| Blur/Smudge/Liquify | 线格图、透明彩块与授权人像；same path/strength | 扩散范围、色拖动、位移场、保护区和重复stroke | 诊断图数值+真实图局部；不得把普通推移称完整Liquify |
| 颜色与Blur核 | RGB cube/ramp/HDR signed，Levels/Curves/Exposure/Balance/BW/Gaussian/Motion | 色值映射、边界/alpha、通道、暗部和HDR高光 | native每族多参数+16/HDR有效档；非支持模式显式拒绝 |
| PSD/SmartObject | 外部作者允许的真实设计PSD，fill/isolatedgroup/blendif/linkedsource | 各层可编辑性、重开、reference composite | 区分独立外部文件与自生成fixture；完整操作后回PS验证 |
| Hair/Color Decontamination | 黑/白/花背景的头发、毛、透明玻璃 | alpha细丝和RGB背景污染，换底仍自然 | 外部独立自然图+trimap/GT条件，多个背景留出；不能只用合成图 |
| Camera Raw | 多相机RAW、固定版本/profile与同参数 | 去噪纹理、tone/WB/去雾/高光、crop与mask输出 | 读回ACR版本/processprofile；真实图和colorchart都比较 |

<a id="roadmap"></a>
## 分阶段开发计划与验收门槛

估计单位使用 **AI工作批次**：每批是一组有原生参考、代码、回归与实际安装包验收的可交付任务，不用人日；原生GUI/服务/硬件取证会影响实际时间，不能按固定“分钟数”虚假承诺。

| 顺序 | 工作范围 / 对应目录 | 结构和实现要点 | 退出门槛 |
|---|---|---|---|
| P0 历史批 | alpha20蒙版羽化、画笔残差、crop生命周期/布局；C021/034/035/041/042 | 保留旧工程兼容；16个有效mask refs用于box4/方差/外界修复，保留f0.3残差；1:1对齐PSmask直接pixel transfer；preview与commit同链；关闭/切换时过期重绘和缩略图不发布；crop preserve source已有原生RGB8对照 | **本批两种runtime统一GUI验收PASS**；1442/1442源码测试（新增6个重绘竞态回归）/typecheck/i18n/build已PASS，macOS ARM64包已生成；原生metrics保留所有残差和微退化；crop引用测试及6case mask GUI已PASS，正式开发版与安装包各17组221项全部PASS；每种runtime布局52项且无截图fallback；发布完整性也PASS（16个构建文件及模型／图标／28个许可证文件一致） |
| P0 当前批 | alpha21近硬笔尖、小半径蒙版、参考线自动拉直与透视；C021/022/034/041/042 | 连续有界tip与小核过渡；source-preserving straighten、precision inverse homography；明确重采样与原子拒绝 | 1,550源码测试PASS；开发版/安装包各20组256项全PASS，发布完整性PASS；原生效果残差详见[A21]；自动尺寸与高频透视像素仍需继续对齐 |
| P1 常用编辑 | Clone/Heal/Spot/Blur/Smudge，fill/选区移动；C027–039/048–055 | 先校正现有算法与上下文，补真实Photoshop快捷手势；空白retouch层、source排除adjustment | 授权真实图同动作同源+diagnostic；透明/缩放/16位；preview/apply不漂移，不悬挂interaction |
| P2 专业基础调色 | Levels/Curves/Exposure/BW/Balance、USM/SmartSharpen、SelectiveColor/ChannelMixer；C073–084 | 统一8/16/HDR数值策略、通道/选区/mask；新调整族走typedcommand+composite，不只UI | 多参数原生golden与位深精度；stack+mask与单独滤镜都验证 |
| P3 非破坏合成与PSD | Fill vs Opacity、组隔离/pass-through、BlendIf；RGB16 PSD写出；SmartObjects/Filters第一版；C004/058/062–064/088/106 | 先文档模型/renderer/export/history一致，再作者工具；来源/实例/滤镜栈显式可保存 | 外部独立PSD baseline、修改后回PS、重新打开逐层结构及flatten输出误差；不承诺任意PSD |
| P4 复杂抠图/液化 | C039/040/056及必要通道工具 | matte前景RGB去污染与alpha共同处理；局部refinebrush/保护区；图像模型与确定性算法分开 | 自然发丝/毛发/玻璃、多底色独立holdout；可取消/undo；不宣称复制Adobe云模型 |
| P5 RAW/颜色/HDR显示 | C009–016/089–096 | 端到端RAW16/浮点、每文档ICC、color-managed preview、OCIO可选；硬件HDR另验收 | 实际profile/RAW参考、输出源值，HDR monitor/OS/GPU实际读取和亮度验证；Windows另平台门槛 |
| P6 排版/路径/批处理/AI | C065–072/097–104/108–112 | 矢量路径节点/排版器、action录制批处理、可插拔图像服务；云协作和视频后置 | 字体许可/实际glyph、路径/PSD可编辑；Provider有效接口/结果可审计；每新增族独立验收 |
| 持续架构优化 | 所有阶段各自瓶颈 | renderer/UI、command、sourceasset、composite、codec职责清晰；tile/ROI与worker、取消、cache预算；避免预览代理反写原source | 真实profile后再优化；4K/多层p95、峰值内存、保存/Undo，精度与输出不得回归 |

优先借鉴 Web 的简化上下文任务栏、当前选区的可发现操作、生成结果/版本可撤销、语言/字体可读性；不要为了“像PS”把所有不适用按钮堆到顶部。专业工具也要有完整来源/选项/反馈/取消链，不能只换图标。[Web工作区](https://helpx.adobe.com/photoshop/web/get-set-up/learn-the-basics/workspace-overview.html)、[Web设置，2026-06-24](https://helpx.adobe.com/photoshop/web/get-set-up/preferences-and-settings/app-settings-and-preferences.html)

<a id="evidence-index"></a>
## 证据索引和维护规则

所有项目链接指向本地实际文件。代码是实现边界，测试/验收是已运行的行为证据，原生fixture是特定图片效果证据；三者不可相互冒充。`docs/PHOTOSHOP_CAPABILITY_GAP_2026-10-10.md` 与 `PHOTOSHOP_FORMAT_SUPPORT.md` 的早期表格含旧 alpha 阶段描述，本目录优先使用 alpha17–19 实测和当前代码，不据旧表把已实现的QuickMask/16位/HDR重新标为缺少。

本报告的 source date 是链接旁 Adobe 显示的 Last updated 日期；原目录访问日2026-10-12，本批新增Adobe拉直/透视页面访问日2026-10-13；没有发布日期的产品页不补造日期。发布页会持续变化，后续复查要保存实际版本/内容快照。历史alpha20对应记录的源码与双runtime门禁已通过；当前alpha21结果以[A21]为准；后续能力仍以有效原生参考、修复与独立验收为准，不能只把“采集成功”升级成“已修复”，也不能把本批验收外推全部PS能力。

**alpha.21当前验收**：源码1,550/1,550 tests、typecheck/i18n/build全部PASS。开发版与安装包各15组139项Photoshop阶段 + 5组117项高位深阶段 = **20组256项PASS**；每种runtime布局52项，中英文1050×720/1440×840截图无fallback、无renderer errors。最终预览遮角问题修正后，开发版与安装包各20组均从头新执行；裁剪实截图检查四个角点在SDR预览上方。历史失败与首次完整PASS另存，不计为额外独立功能。两种runtime重复同256项，不能当成512个独立功能。发布完整性PASS：16个构建文件、模型/图标、28个许可证文件与当前构建一致，811源文件快照及ZIP SHA记录见 `release/0.3.0-alpha.21/SOURCE_MANIFEST.json`。聚合：`artifacts/alpha21-final-acceptance.json`；完整报告[A21]。158画笔/31蒙版/3裁剪原生输出的具体误差不能用运行通过来替代。一次最终包布局组出现选区意外清空，之后3次专项和最终高位深复跑未复现；来源未定，保留失败截图/报告及新Activity/控制键诊断，不宣称已修复，详见[A21]。

alpha.20历史源码冻结记录：1,442/1,442 tests、typecheck、i18n、build已PASS。正式全套桌面输入按开发版与安装包串行复验：开发版记录目录为 `artifacts/alpha20-photoshop-dev-final`、`artifacts/alpha20-dev-final`；安装包为 `artifacts/alpha20-photoshop-packaged-final`、`artifacts/alpha20-packaged-final`。开发版与安装包的两套门禁均已全部PASS（各12组104项＋5组117项，共17组221项），子报告无错误；各自布局52项，中英文截图无fallback。**221项在两种runtime重复验收，不能合计成442项独立功能**。发布完整性也已PASS：16个构建文件及模型／图标／28个许可证文件与当前构建一致，由 [alpha.20验收报告][A20] 汇总实际hash和输出，alpha20完整性记录另保存于 `artifacts/alpha20-release-integrity-before-alpha21.json`，永久发布快照位于 `release/0.3.0-alpha.20/SOURCE_MANIFEST.json`。过期重绘被忽略的范围只限已失效文档/视图结果，不吞掉当前有效文档的真实错误。


[FMASKUI]: /Users/zhoujin/Documents/PS/Compositor_Electron/fixtures/parity/photoshop-27.11-mask-feather-ui.json
[LMASKUI]: /Users/zhoujin/Documents/PS/Compositor_Electron/artifacts/photoshop-native/outputs/mask-feather-ui-study/native-results.tsv
[MASKCAND]: /Users/zhoujin/Documents/PS/Compositor_Electron/artifacts/photoshop-native/measurements/mask-feather-candidates/report.md
[FCROPNATIVE]: /Users/zhoujin/Documents/PS/Compositor_Electron/fixtures/parity/photoshop-27.11-crop-preserve.json
[MCROPNATIVE]: /Users/zhoujin/Documents/PS/Compositor_Electron/artifacts/photoshop-native/measurements/crop-preserve/comparison.json
[TCROPNATIVE]: /Users/zhoujin/Documents/PS/Compositor_Electron/tests/photoshop-crop-preserve-reference.test.ts
[LATESTDRAW]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/renderer/latest-draw.ts
[TLATESTDRAW]: /Users/zhoujin/Documents/PS/Compositor_Electron/tests/latest-draw.test.ts
[A20]: /Users/zhoujin/Documents/PS/Compositor_Electron/docs/PHOTOSHOP_ALPHA20_ACCEPTANCE_2026-10-12.md
[MMASK20]: /Users/zhoujin/Documents/PS/Compositor_Electron/artifacts/photoshop-native/measurements/mask-alpha20/comparison.md
[MBRUSH20]: /Users/zhoujin/Documents/PS/Compositor_Electron/artifacts/photoshop-native/measurements/alpha20-brush-candidates/comparison.md
[FBRUSH20]: /Users/zhoujin/Documents/PS/Compositor_Electron/fixtures/parity/photoshop-27.11-brush-v6.json
[GMASK20]: /Users/zhoujin/Documents/PS/Compositor_Electron/artifacts/alpha20-photoshop-dev-final/mask-feather-ui/checks.json
[A19]: /Users/zhoujin/Documents/PS/Compositor_Electron/docs/PHOTOSHOP_ALPHA19_ACCEPTANCE_2026-10-12.md
[A18]: /Users/zhoujin/Documents/PS/Compositor_Electron/docs/PHOTOSHOP_ALPHA18_ACCEPTANCE_2026-10-12.md
[A17]: /Users/zhoujin/Documents/PS/Compositor_Electron/docs/PHOTOSHOP_ALPHA17_ACCEPTANCE_2026-10-12.md
[RGB16]: /Users/zhoujin/Documents/PS/Compositor_Electron/docs/PHOTOSHOP_RGB16_IMPORT_REFERENCE_2026-10-12.md
[HDOC]: /Users/zhoujin/Documents/PS/Compositor_Electron/docs/HDR_INTEGRATION_REVIEW_2026-10-12.md
[UI]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/renderer/App.vue
[DOC]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/document-manager.ts
[IO]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/project-io.ts
[REC]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/recovery-store.ts
[EDITOR]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/editor.ts
[CONTRACT]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/shared/contracts.ts
[PCONTRACT]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/shared/pixel-contracts.ts
[PSIO]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/photoshop-io.ts
[FOREIGN]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/foreign-import.ts
[FCOLOR]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/foreign-color.ts
[RAWUI]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/renderer/RawImportPanel.vue
[RAWSET]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/shared/raw-settings.ts
[PROFILE]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/renderer/interaction-profile.ts
[KEYS]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/renderer/command-shortcuts.ts
[CSS]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/renderer/style.css
[THISTORY]: /Users/zhoujin/Documents/PS/Compositor_Electron/tests/pixel-history.test.ts
[DEEP]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/deep-composite.ts
[HDR]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/hdr-composite.ts
[HDRPIX]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/shared/hdr-pixels.ts
[HDRCODEC]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/hdr-codecs.ts
[EXPORT]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/shared/export-options.ts
[EXPORTCODEC]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/export-codecs.ts
[DEEPEXPORT]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/deep-export.ts
[PICKER]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/renderer/ColorPickerPanel.vue
[VIEW]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/renderer/view-geometry.ts
[ROTATEVIEW]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/renderer/rotated-view.ts
[LAYOUT]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/layer-layout.ts
[DISTORT]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/distort-raster.ts
[CROP]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/renderer/crop-geometry.ts
[TCROP]: /Users/zhoujin/Documents/PS/Compositor_Electron/tests/crop-nondestructive.test.ts
[SIZE]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/renderer/ImageSizeDialog.vue
[SIZEFX]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/image-size-effects.ts
[RESAMPLE16]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/deep-resample.ts
[RESAMPLE32]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/hdr-resample.ts
[PIXEL]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/pixel-actions.ts
[SEL]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/shared/selection-coverage.ts
[FEATHER]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/shared/selection-gaussian.ts
[MORPH]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/shared/selection-morphology.ts
[NAMED]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/named-selections.ts
[SELTRANS]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/selection-transform.ts
[SELPAINT]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/shared/selection-paint.ts
[SUBJECT]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/subject-mask.ts
[OBJECTUI]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/renderer/ObjectSelectionTools.vue
[MATTE]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/shared/subject-matte.ts
[REFINE]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/renderer/EdgeRefinementPanel.vue
[FSEL]: /Users/zhoujin/Documents/PS/Compositor_Electron/fixtures/parity/photoshop-27.11-feather.json
[MASK]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/mask-operations.ts
[MASKPROP]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/shared/mask-properties.ts
[MASKDISPLAY]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/renderer/mask-display.ts
[PLACE]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/shared/mask-placement.ts
[BAKE]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/live-mask-bake.ts
[TMASK]: /Users/zhoujin/Documents/PS/Compositor_Electron/tests/mask-properties-boundaries.test.ts
[PSVECTOR]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/photoshop-vector.ts
[BRUSH]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/shared/brush-coverage.ts
[DYNAMICS]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/shared/brush-dynamics.ts
[BRUSHUI]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/renderer/BrushDynamicsTools.vue
[TBRUSH]: /Users/zhoujin/Documents/PS/Compositor_Electron/tests/photoshop-brush-reference.test.ts
[PAINT16]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/high-depth-paint.ts
[FILL]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/renderer/FillDialog.vue
[DEEPFILL]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/deep-raster-fill.ts
[RETOUCH]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/retouch-edit.ts
[DEEPSTROKE]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/deep-stroke-edit.ts
[HDRSTROKE]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/hdr-stroke-edit.ts
[DEEPBLUR]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/deep-blur-edit.ts
[DEEPWARP]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/shared/deep-warp.ts
[CLONEUI]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/renderer/CloneSourceOverlay.vue
[CFILL]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/content-fill.ts
[PATCH]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/shared/native-patch-fill.ts
[LAYER]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/layer-operations.ts
[LOCK]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/layer-locks.ts
[BLENDS]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/renderer/blend-modes.ts
[EFFECTS]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/shared/layer-effects.ts
[PSEFFECTS]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/photoshop-effects.ts
[FILTERS]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/shared/image-filters.ts
[FILTEREDIT]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/filter-edit.ts
[DEEPFILTER]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/shared/deep-color-filters.ts
[DEEPADJ]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/high-depth-adjustment.ts
[PSEDIT]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/photoshop-editable.ts
[PSMETA]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/core/photoshop-metadata.ts
[CONTENT]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/shared/content-style.ts
[TEXTRASTER]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/renderer/content-raster.ts
[FONTUI]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/renderer/FontPicker.vue
[SVG]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/renderer/svg-import.ts
[CRKERNEL]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/shared/camera-raw-kernels.ts
[CRADAPT]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/shared/camera-raw-adaptive.ts
[AGENT]: /Users/zhoujin/Documents/PS/Compositor_Electron/src/renderer/AgentChat.vue

<a id="appendices"></a>
## 具体名称与效果附录（不另增112个能力族计数）

这里把“滤镜族、调色、样式”进一步拆成可检索的具体名称。效果列只给辨认目标的简短说明；后续每项仍须按上面的原生协议独立研究参数/图片/位深。工具/模式存在也不代表私有算法相同。下面明确区分项目作者入口、只导入像素/metadata、相似替代与原生实测。

<a id="appendix-1"></a>
### 附录1：27种标准图层混合模式

参考 [Adobe 模式描述，2026-02-23](https://helpx.adobe.com/photoshop/desktop/repair-retouch/adjust-light-tone/blending-mode-descriptions.html)；项目命名枚举/renderer/高位深核证据见 [contracts][CONTRACT]、[blend UI][BLENDS]、[16合成][DEEP]、[HDR合成][HDR]。**当前有24个作者入口，缺3个；没有27模式×8/16/32全组合原生golden。** 下面“有”仅说明入口，不证明所有位深或PS色域/Fill语义等价。

| 模式 | 识别效果 | 项目入口 / 原生效果 |
|---|---|---|
| Normal | 普通叠放 | 有；全族PS效果未对照 |
| Dissolve | 随机颗粒透明 | 缺少 |
| Darken | 逐通道取暗 | 有；全族PS效果未对照 |
| Multiply | 相乘变暗 | 有；全族PS效果未对照 |
| Color Burn | 加深对比 | 有；全族PS效果未对照 |
| Linear Burn | 线性减亮 | 有；全族PS效果未对照 |
| Darker Color | 择整色较暗 | 缺少 |
| Lighten | 逐通道取亮 | 有；全族PS效果未对照 |
| Screen | 滤色提亮 | 有；全族PS效果未对照 |
| Color Dodge | 减淡提亮 | 有；全族PS效果未对照 |
| Linear Dodge (Add) | 加色发光 | 有；全族PS效果未对照 |
| Lighter Color | 择整色较亮 | 缺少 |
| Overlay | 依底色增对比 | 有；全族PS效果未对照 |
| Soft Light | 柔和调对比 | 有；全族PS效果未对照 |
| Hard Light | 强光调对比 | 有；全族PS效果未对照 |
| Vivid Light | 强化亮暗 | 有；全族PS效果未对照 |
| Linear Light | 线性亮暗 | 有；全族PS效果未对照 |
| Pin Light | 替换亮暗 | 有；全族PS效果未对照 |
| Hard Mix | 强分色 | 有；全族PS效果未对照 |
| Difference | 差值/对位 | 有；全族PS效果未对照 |
| Exclusion | 低对比差值 | 有；全族PS效果未对照 |
| Subtract | 通道减法 | 有；全族PS效果未对照 |
| Divide | 通道除法 | 有；全族PS效果未对照 |
| Hue | 替换色相 | 有；全族PS效果未对照 |
| Saturation | 替换饱和度 | 有；全族PS效果未对照 |
| Color | 换色保明度 | 有；全族PS效果未对照 |
| Luminosity | 换明度保色 | 有；全族PS效果未对照 |

另有 **Pass Through** 属于组混合语义，**Behind/Clear** 属于特定绘画工具模式，不计为这27个普通图层模式。Fill 与总Opacity、色彩gamma和组隔离需要另外实现/验证。[Opacity/Fill/Pass Through，2026-09-28](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/apply-layer-effects/set-layer-opacity-and-blending-modes.html)

<a id="appendix-2"></a>
### 附录2：调整、填充层与Image专用调整

官方菜单说明：[Adjustment options，2026-02-23](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/color-adjustment-fill-layers/adjustment-layers-options.html)、[调整流程，2026-09-30](https://helpx.adobe.com/photoshop/desktop/adjust-color/color-corrections/adjust-image-color-and-tone.html)。项目证据统一 [filter种类/参数][FILTERS]、[deep内核][DEEPFILTER]、[调整层合成][DEEPADJ]；nativeeffects范围见 [alpha17][A17]，不得从一个HSL/Curve样本升级全族一致。

| 调整/填充类型 | 图像识别目标 / 关键区别 | 项目情况 |
|---|---|---|
| Brightness/Contrast | 整体亮暗/对比；legacy分支不同 | 缺独立PS等价工作流；CameraRaw contrast不是相同命令 |
| Levels | 黑白点/中间调/输出范围 | 有像素+调整层；全PS参数未测 |
| Curves | 非线性色调曲线 | 有像素+调整层；指定两点曲线实测0差异，其他未齐 |
| Exposure | 曝光/offset/gamma | 有像素+调整层；HDR signed核有项目测试，原生全参数未测 |
| Vibrance（传统） | 振动度区别于饱和度 | CameraRaw有参数；缺完整独立PS调整层 |
| Hue/Saturation | 颜色范围的H/S/L与着色 | 有像素+调整层；局部PS8/16实测有残差 |
| Color Balance | 阴影/中调/高光的偏色 | 有像素+调整层；原生效果未测 |
| Black & White | 按颜色控制灰度转换 | 有像素+调整层；原生权重/参数未測 |
| Photo Filter | 暖冷镜头染色 | 缺少专用类型 |
| Channel Mixer | 通道混合/单色 | 缺少专用类型 |
| Color Lookup | LUT整体色彩风格 | 缺少3D LUT类型/管理 |
| Selective Color | 指定颜色的relative/absolute墨量变化 | 缺少专用类型；HSL不能代替 |
| Invert | 通道反相 | 有像素+调整层；全模式未测 |
| Posterize | 离散色阶 | 缺少专用类型 |
| Threshold | 二值明暗 | 缺少专用类型 |
| Gradient Map | 明度映射渐变 | 有基础像素+调整层；多stop/PS插值未齐 |
| Light（27.10/27.11） | 曝光/对比/highlight/shadow/white/black | CameraRaw类似参数，不是原生Light调整层；缺该类型 |
| Color and Vibrance（2026） | temp/tint/vibrance/saturation | CameraRaw类似参数，缺完整PS新调整层 |
| Clarity and Dehaze（2026） | 中调结构和雾 | CameraRaw类似参数，缺该非破坏PS类型 |
| Grain（2026） | 非破坏颗粒 | 项目有Grain调整层；原生统计/参数/PSD映射待测 |
| Solid Color Fill | 固定颜色填充层 | 普通填色不是live fill layer；缺完整专用语义 |
| Gradient Fill | 位置/角度/比例可编辑渐变层 | 普通gradient raster不是live gradient fill；缺类型 |
| Pattern Fill | 可编辑平铺图案层 | 缺少作者流程 |

新类型参考 [Light，2026-09-09](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/color-adjustment-fill-layers/adjust-image-lighting-with-light.html)、[Color/Vibrance，2026-02-23](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/color-adjustment-fill-layers/correct-color-balance-with-color-and-vibrance.html)、[Clarity/Dehaze，2026-08-18](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/color-adjustment-fill-layers/adjust-contrast-with-clarity-and-dehaze.html)。Grain新layer在 [27.x发布说明](https://helpx.adobe.com/photoshop/desktop/whats-new/photoshop-on-desktop-release-notes.html) 中独立列出。

Image > Adjustments 中另有 **Auto Tone / Auto Contrast / Auto Color / Desaturate / Match Color / Replace Color / Equalize / Shadows-Highlights / HDR Toning** 等，不应都记为调整层。建议复现分别为自动端点、去色、跨图匹配、目标色替换、直方图重分布、亮暗部压缩、HDR→SDR；当前项目缺完整专用作者流程。Image/RAW中Exposure/contrast近似选项不算已补齐。[颜色调整命令](https://helpx.adobe.com/photoshop/desktop/adjust-color/color-corrections/color-adjustment-commands.html)、[Match Color保存](https://helpx.adobe.com/photoshop/desktop/adjust-color/selective-color-adjustments/save-and-apply-settings-in-match-color.html)

项目原生adjustment枚举中的 Gaussian Blur、Motion Blur、Add Noise 是项目可编辑效果扩展；不能因此宣布 Photoshop SmartFilter 栈已实现。

<a id="appendix-3"></a>
### 附录3：10种图层样式及关键效果选项

参考 [Adobe Layer style effects，2025-12-02](https://helpx.adobe.com/in/photoshop/desktop/create-manage-layers/apply-layer-effects/layer-style-effects-and-options-overview.html)；项目实际类型/参数/PSD映射见 [effects][EFFECTS]、[photoshop-effects][PSEFFECTS]。

| 样式 | 图片效果 | 项目情况 |
|---|---|---|
| Bevel & Emboss | 边缘立体高光阴影 | 缺作者类型/完整核 |
| Stroke | 对象边线 | 基础有；渐变/图案/完整position/多实例未齐 |
| Inner Shadow | 内边凹陷阴影 | 基础有；原生全选项未测 |
| Inner Glow | 内沿发光 | 基础有；原生全选项未测 |
| Satin | 内部缎面明暗 | 缺作者类型 |
| Color Overlay | 统一覆盖色 | 基础有；blend/fill复杂交互未测 |
| Gradient Overlay | 可编辑渐变覆盖 | 缺作者类型 |
| Pattern Overlay | 图案纹理覆盖 | 缺作者类型 |
| Outer Glow | 外沿发光 | 基础有；原生轮廓/噪点/参数未测 |
| Drop Shadow | 对象后投影 | 基础有；全局光/轮廓/多shadow未齐 |

还须研究：Global Light（跨效果共享角度）、Contour/Gloss Contour（改变衰减/立体轮廓）、Spread/Choke（先改变轮廓再柔化）、Noise/Jitter、Technique、Knockout、隐藏层内容但保留fx的Fill、Scale Effects、Copy/Paste/Clear Style，以及重复同类实例。它们直接改变像素效果；导入metadata或复制基础6类不能算完整样式系统。

<a id="appendix-4"></a>
### 附录4：Filter Gallery 具体滤镜名称

这是 **47个经典Gallery个项** 的可检索列表；当前官方概览对Stylize族还列了Solarize/Wind，它们也在普通Filter菜单有入口，不能仅凭帮助分类认为本机Gallery显示完全相同。Artistic/Sketch的一些效果受前背景色、纹理和8位限制影响。

采用官方 [Gallery概览，2026-02-23](https://helpx.adobe.com/photoshop/desktop/effects-filters/get-started-with-filters/filter-gallery.html)、[经典滤镜参考，2024-10-14（历史）](https://helpx.adobe.com/in/photoshop/using/filter-effects-reference.html)、[当前滤镜参考，2026-10-04](https://helpx.adobe.com/photoshop/desktop/effects-filters/blur-sharpen-filters/filter-effects-reference.html)、[Texture surface选项，2026-09-30](https://helpx.adobe.com/photoshop/desktop/effects-filters/artistic-stylize-filters/apply-texture-and-surface-effects-to-filters.html)。效果词为识别索引，不是算法说明。**项目没有Gallery作者栈，下面均缺直接对应入口/原生效果验证；名称相似的Grain也不构成Film Grain/Texture Grain等价。** 代码边界 [FILTERS][FILTERS]、[UI][UI]。

| 族 | 具体滤镜 | 效果识别词 | 项目 |
|---|---|---|---|
| Artistic | Colored Pencil | 彩铅 | 缺少；未测 |
| Artistic | Cutout | 剪纸 | 缺少；未测 |
| Artistic | Dry Brush | 干刷 | 缺少；未测 |
| Artistic | Film Grain | 胶片颗粒 | 缺少；未测 |
| Artistic | Fresco | 湿壁画 | 缺少；未测 |
| Artistic | Neon Glow | 霓虹 | 缺少；未测 |
| Artistic | Paint Daubs | 油彩块 | 缺少；未测 |
| Artistic | Palette Knife | 画刀 | 缺少；未测 |
| Artistic | Plastic Wrap | 塑膜 | 缺少；未测 |
| Artistic | Poster Edges | 海报轮廓 | 缺少；未测 |
| Artistic | Rough Pastels | 粗粉彩 | 缺少；未测 |
| Artistic | Smudge Stick | 短划涂抹 | 缺少；未测 |
| Artistic | Sponge | 海绵 | 缺少；未测 |
| Artistic | Underpainting | 底画 | 缺少；未测 |
| Artistic | Watercolor | 水彩 | 缺少；未测 |
| Brush Strokes | Accented Edges | 强调边线 | 缺少；未测 |
| Brush Strokes | Angled Strokes | 斜刷 | 缺少；未测 |
| Brush Strokes | Crosshatch | 交叉排线 | 缺少；未测 |
| Brush Strokes | Dark Strokes | 暗刷 | 缺少；未测 |
| Brush Strokes | Ink Outlines | 墨线 | 缺少；未测 |
| Brush Strokes | Spatter | 泼点 | 缺少；未测 |
| Brush Strokes | Sprayed Strokes | 喷刷 | 缺少；未测 |
| Brush Strokes | Sumi-e | 水墨 | 缺少；未测 |
| Distort | Diffuse Glow | 漫射亮光 | 缺少；未测 |
| Distort | Glass | 玻璃折射 | 缺少；未测 |
| Distort | Ocean Ripple | 水面纹 | 缺少；未测 |
| Sketch | Bas Relief | 浅浮雕 | 缺少；未测 |
| Sketch | Chalk & Charcoal | 粉笔炭笔 | 缺少；未测 |
| Sketch | Charcoal | 炭笔 | 缺少；未测 |
| Sketch | Chrome | 铬面 | 缺少；未测 |
| Sketch | Conté Crayon | 康特蜡笔 | 缺少；未测 |
| Sketch | Graphic Pen | 钢笔排线 | 缺少；未测 |
| Sketch | Halftone Pattern | 半调纹 | 缺少；未测 |
| Sketch | Note Paper | 纸浮雕 | 缺少；未测 |
| Sketch | Photocopy | 复印 | 缺少；未测 |
| Sketch | Plaster | 石膏 | 缺少；未测 |
| Sketch | Reticulation | 网状纹 | 缺少；未测 |
| Sketch | Stamp | 印章 | 缺少；未测 |
| Sketch | Torn Edges | 撕纸 | 缺少；未测 |
| Sketch | Water Paper | 湿纸 | 缺少；未测 |
| Stylize | Glowing Edges | 发光边 | 缺少；未测 |
| Texture | Craquelure | 龟裂 | 缺少；未测 |
| Texture | Grain | 纹理颗粒 | 缺少；未测 |
| Texture | Mosaic Tiles | 马赛克砖 | 缺少；未测 |
| Texture | Patchwork | 拼布 | 缺少；未测 |
| Texture | Stained Glass | 彩玻璃 | 缺少；未测 |
| Texture | Texturizer | 纹理化 | 缺少；未测 |

Gallery可堆多个效果、调整顺序/可见性；SmartObject上的可重开Gallery需SmartFilter基础，不能先把多个效果烘焙成PNG后仍称同等非破坏。

<a id="appendix-5"></a>
### 附录5：普通Filter菜单具体算子与Neural个项

以下按菜单类别展开，某些Gallery项会在菜单显示，**不重复加入112的计数**。本段列出的老滤镜在当前GPU、位深和菜单配置下是否可选须实查；特别Lighting Effects/旧render项目不能无条件记为27.11有效入口。当前/历史原生语义来源同附录4；常用blur/sharpen另见 [Smart Sharpen](https://helpx.adobe.com/uk/photoshop/desktop/effects-filters/smart-filters/sharpen-controls-with-smart-sharpen.html)、[Blur Gallery](https://helpx.adobe.com/photoshop/desktop/effects-filters/blur-sharpen-filters/use-blur-gallery-depth-of-field-effects.html)、[Spin Blur](https://helpx.adobe.com/photoshop/desktop/effects-filters/blur-sharpen-filters/apply-spin-blur-effects-in-blur-gallery.html)。项目算子与核 [FILTERS][FILTERS]、[DEEPFILTER][DEEPFILTER]、[CRKERNEL][CRKERNEL]。

| 类别 | 单项名称 | 图片识别效果 | 项目 / 原生验证 |
|---|---|---|---|
| Blur | Average | 均色 | 缺独立入口；未测 |
| Blur | Blur | 轻柔化 | 缺独立入口；未测 |
| Blur | Blur More | 更强柔化 | 缺独立入口；未测 |
| Blur | Box Blur | 盒均值 | 缺独立入口；未测 |
| Blur | Gaussian Blur | Gaussian柔化 | 有基础；原生完整核未测 |
| Blur | Lens Blur | 景深散景 | 缺独立入口；未测 |
| Blur | Motion Blur | 方向拖影 | 有基础；原生完整核未测 |
| Blur | Radial Blur | 旋转/缩放拖影 | 缺独立入口；未测 |
| Blur | Shape Blur | 形状核 | 缺独立入口；未测 |
| Blur | Smart Blur | 保边柔化 | 缺独立入口；未测 |
| Blur | Surface Blur | 表面平滑 | 缺独立入口；未测 |
| Blur Gallery | Field Blur | 点控模糊 | 缺独立入口；未测 |
| Blur Gallery | Iris Blur | 椭圆焦区 | 缺独立入口；未测 |
| Blur Gallery | Tilt-Shift | 条带焦区 | 缺独立入口；未测 |
| Blur Gallery | Path Blur | 路径运动 | 缺独立入口；未测 |
| Blur Gallery | Spin Blur | 角度旋转 | 缺独立入口；未测 |
| Distort | Displace | 贴图位移 | 缺独立入口；未测 |
| Distort | Pinch | 内外挤压 | 缺独立入口；未测 |
| Distort | Polar Coordinates | 极坐标 | 缺独立入口；未测 |
| Distort | Ripple | 波纹 | 缺独立入口；未测 |
| Distort | Shear | 曲线偏移 | 缺独立入口；未测 |
| Distort | Spherize | 球面 | 缺独立入口；未测 |
| Distort | Twirl | 扭转 | 缺独立入口；未测 |
| Distort | Wave | 波形 | 缺独立入口；未测 |
| Distort | ZigZag | 径向波纹 | 缺独立入口；未测 |
| Noise | Add Noise | 随机噪点 | 有基础；原生完整核未测 |
| Noise | Despeckle | 去斑 | 缺独立入口；未测 |
| Noise | Dust & Scratches | 去尘划 | 缺独立入口；未测 |
| Noise | Median | 中值 | 缺独立入口；未测 |
| Noise | Reduce Noise | 降噪 | CameraRaw有近似；非独立PS等价 |
| Pixelate | Color Halftone | 分色半调 | 缺独立入口；未测 |
| Pixelate | Crystallize | 晶格 | 缺独立入口；未测 |
| Pixelate | Facet | 小面 | 缺独立入口；未测 |
| Pixelate | Fragment | 偏移叠片 | 缺独立入口；未测 |
| Pixelate | Mezzotint | 随机点线 | 缺独立入口；未测 |
| Pixelate | Mosaic | 像素块 | 缺独立入口；未测 |
| Pixelate | Pointillize | 点彩 | 缺独立入口；未测 |
| Render | Clouds | 云纹 | 缺独立入口；未测 |
| Render | Difference Clouds | 差值云纹 | 缺独立入口；未测 |
| Render | Fibers | 纤维 | 缺独立入口；未测 |
| Render | Lens Flare | 镜头光斑 | 缺独立入口；未测 |
| Render | Lighting Effects（历史/条件） | 打光材质 | 缺独立入口；未测 |
| Render | Flame | 火焰 | 缺独立入口；未测 |
| Render | Picture Frame / Frame | 相框 | 缺独立入口；未测 |
| Render | Tree | 程序树 | 缺独立入口；未测 |
| Sharpen | Sharpen | 锐化 | 缺独立入口；未测 |
| Sharpen | Sharpen More | 强锐化 | 缺独立入口；未测 |
| Sharpen | Sharpen Edges | 边线锐化 | 缺独立入口；未测 |
| Sharpen | Smart Sharpen | 可控锐化 | 缺独立入口；未测 |
| Sharpen | Unsharp Mask | 反差锐化 | 缺独立入口；未测 |
| Stylize | Diffuse | 扩散 | 缺独立入口；未测 |
| Stylize | Emboss | 浮雕 | 缺独立入口；未测 |
| Stylize | Extrude | 挤出 | 缺独立入口；未测 |
| Stylize | Find Edges | 边检测 | 缺独立入口；未测 |
| Stylize | Oil Paint | 油画 | 缺独立入口；未测 |
| Stylize | Solarize | 正负混影 | 缺独立入口；未测 |
| Stylize | Tiles | 错位砖 | 缺独立入口；未测 |
| Stylize | Trace Contour | 等亮轮廓 | 缺独立入口；未测 |
| Stylize | Wind | 横向风线 | 缺独立入口；未测 |
| Other | Custom | 卷积核 | 缺独立入口；未测 |
| Other | High Pass | 高通 | 缺独立入口；未测 |
| Other | Maximum | 扩白 | 缺独立入口；未测 |
| Other | Minimum | 扩黑 | 缺独立入口；未测 |
| Other | Offset | 平移/环绕 | 缺独立入口；未测 |
| Video | De-Interlace | 去交错 | 缺独立入口；未测 |
| Video | NTSC Colors | 电视色域 | 缺独立入口；未测 |
| 独立工作区 | Camera Raw Filter | 照片调整 | 有同名项目核；非AdobeACR等价 |
| 独立工作区 | Lens Correction | 镜头矫正 | 有手动近似；profile/原生未齐 |
| 独立工作区 | Liquify | 局部变形 | 有推移笔刷；完整workspace未齐 |
| 独立工作区 | Vanishing Point | 平面透视 | 缺独立入口；未测 |
| 独立工作区 | Neural Filters | 模型效果 | 缺独立入口；未测 |
| 独立工作区 | Filter Gallery | 风格栈 | 缺独立入口；未测 |

Neural Filters进一步核对 **Featured**：Smart Portrait、Skin Smoothing、Super Zoom、JPEG Artifact Removal、Colorize、Style Transfer、Makeup Transfer；**Beta**：Photo Restoration、Harmonization、Landscape Mixer、Depth Blur、Color Transfer。它们分别涉及人像表情/皮肤、清晰/压缩修复、上色/风格/妆、老照片、色光/风景/景深；当前项目这些模型工作流均缺少。Beta/Featured以及可下载模型会随版本/地区/账号变化，不能写死为每台机器始终可用；它们也不等于27.11新的Harmonize/Enhance Edge。参考 [Neural Gallery，2026-10-04](https://helpx.adobe.com/photoshop/desktop/effects-filters/neural-filters/neural-filters-gallery.html)。

<a id="appendix-6"></a>
### 附录6：具体选区、裁剪与修图工具清单

每行把操作与图像效应分开，以免左侧“两个一样图标”重新变成功能无法辨认。依据本目录D–G来源及当前 [UI][UI]、[像素契约][PCONTRACT]、[retouch][RETOUCH]；缺项的证据是当前工具注册/动作模型没有作者入口。

| 具体工具/命令 | 要研究的主要操作/参数 | 效果与项目差距 |
|---|---|---|
| Rectangular / Elliptical Marquee | 4组合模式、AA、Feather、Normal/Fixed Ratio/Fixed Size | 现有几何选区；全style和输入手势未齐 |
| Single Row / Single Column Marquee | 1像素行列 | 缺专用入口 |
| Freehand / Polygonal Lasso | 临时Alt线段、关闭/backtrack、拖动Space | 已有基本自由/多边形；全手势未齐 |
| Magnetic Lasso | Width/Contrast/Frequency、锚点、pen | 图像边磁吸；缺 |
| Selection Brush | Opacity/Hardness/Size、Add/Subtract、overlay色 | 手动覆盖；已有，非QuickSelection |
| Quick Selection | 图像相关扩展、tip、SampleAll/EnhanceEdge | 缺完整自动扩展笔刷；不是manualpaint |
| Object Selection | hoverfinder、rectangle/lasso、hardedge、sampleall | 现point/box主体链，Finder/全参数未齐 |
| Magic Wand | Tolerance、sampleaverage、contiguous、AA/sampleall | 基础有，PScoverage未测 |
| Select Subject / People / Sky | 本机/云、人物部位/目标区域 | 基础subject有；peopleparts/sky缺 |
| Color Range / Focus Area | 取样增减、fuzziness/range、肤色/景深 | 基础color range有，Focus/完整预设缺 |
| Select and Mask / Refine Edge Brush | 多背景视图、refinebrush、radius/smartradius、decontamination、output | 有部分refine/matte；局部发丝/颜色净化和自然图未齐 |
| Crop | ratio/size/resolution、overlay、straighten、DeleteCroppedPixels、ContentAware/GenExpand | 非破坏基础有；删除选项/拉直/自动填/生成扩图欠缺 |
| Perspective Crop | 四边透视、grid、width/height/resolution | 缺作者流程 |
| Slice / Slice Select | 按层/用户slice、锁定/尺寸/输出 | 缺作者与输出链 |
| Ruler / Straighten / Color Sampler / Count / Note | 测线角度、多个采样点、计数/注释 | alpha23新增Info持久颜色取样点、原始8/16/HDR读数与Ruler长度/角度/第二臂/单位；Count/Note与完整测量比例/日志仍缺 |
| Brush / Pencil | tip/dynamics/mode/AA/opacity/flow/spacing | 圆Brush局部PS实测；Pencil/全动态欠缺 |
| Mixer / Color Replacement | wet/load/mix；采样/色模式/限制 | 两项缺完整作者流程 |
| History / Art History Brush | historysource、style/area/tolerance | 两项缺；historyundo不能替代 |
| Eraser / Background / Magic Eraser | opacity/flow；sampling/limits/protectfg；tolerance/contig | 普通erase有；其他专用工具缺 |
| Clone / Pattern Stamp | sources、align/samplelayers/ignoreadjustments、transform/pattern | clone基础有；source高级/pattern缺 |
| Healing / Spot Healing | sampled/contents/proximity/texture、diffusion/samplelayers | 基础有；实际照片PS融合效果未测 |
| Patch / Content Aware Move | source/destination、structure/color、move/extend | 完整拖拽/内容搬移缺 |
| Remove / Red Eye | detection/distractions、cloud/device条件；pupil/darken | Adobe Remove/RedEye专用工作流缺；spot近似不能替代 |
| Blur / Sharpen / Smudge | strength/mode/sampleall/protectdetail/fingerpaint | Blur/Smudge基础有；Sharpen/fingerpaint全选项缺，效果未测 |
| Dodge / Burn / Sponge | range/exposure/protecttones/airbrush；saturation/vibrance | 专用局部亮暗/饱和度工具缺；Exposure全图不等价 |
| Adjustment Brush | 调整类型、创建mask、Applytoobject、add/subtract/overlay | 缺一步作者入口；手工建adjustment+mask仅能组合实现部分目标 |
| Liquify各工具 | ForwardWarp、Smooth、Twirl、Pucker、Bloat、PushLeft、Freeze/Thaw、Reconstruct、Face、Mesh | 当前只局部推移；其余完整UI/模型缺 |
| Transform Warp / Split Warp / Cylindrical / Puppet / Perspective Warp | grid/分割/圆柱、pinmesh、planes | 普通四角distort不足；大部分专用工作流缺 |

新增专业工具来源：[Dodge/Burn，2026-02-23](https://helpx.adobe.com/photoshop/desktop/repair-retouch/adjust-light-tone/dodge-or-burn-image-areas.html)、[Adjustment Brush，2026-09-29](https://helpx.adobe.com/photoshop/desktop/repair-retouch/adjust-light-tone/use-the-adjustment-brush-tool.html)、[Art History Brush，2026-10-04](https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/create-fill-with-patterns/paint-stylized-strokes-with-the-art-history-brush.html)、[Smudge，2026-10-04](https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/fill-objects-selections-layers/smudge-image-areas.html)。注意最新Smudge页的快捷键描述与主shortcut表有差异，**本机真实设置为准**，目录不照抄该页的R作为通用默认。

<a id="appendix-7"></a>
### 附录7：文字、路径与画板的高级选项

依据 [Character formatting，2026-10-10](https://helpx.adobe.com/photoshop/desktop/text-typography/characters-glyphs/format-characters.html)、本目录I类的Paragraph/OpenType/Pen官方页面；项目实际 [content schema][CONTENT]、[text raster][TEXTRASTER]、[PSD vector][PSVECTOR]、[PSD editable][PSEDIT]。

| 子族 | 具体名称与目标效果 | 当前项目边界 |
|---|---|---|
| 字符度量 | kerning Metrics/Optical、Tracking、Leading、Baseline Shift、Horizontal/Vertical Scale | 仅基本tracking/leading；其余作者选项/PS度量未齐 |
| 字体表现 | Variable Font axes、fontstyle、FauxBold/Italic、AllCaps/SmallCaps、super/subscript、underline/strikethrough、anti-alias methods | font/name/size/color及局部font/color runs；其余完整选项缺，PSAA未测 |
| OpenType与Glyphs | ligatures、contextual/discretionary alternatives、swash、stylisticsets、fractions/ordinals、alternate glyph selection | 缺完整Glyphs/OpenTypeUI/模型 |
| 段落 | justify variants、indent、spacebefore/after、hyphenation、single/everyline composer、bullets/numbers | 基础left/center/right与固定框；高级段落缺 |
| 样式 | Character Styles、Paragraph Styles、overrides/clear、跨层同步 | 缺完整样式模型/作者入口 |
| 方向/语言 | vertical type、EastAsian/WorldReady排版、RTL、禁则/标点等依版本/偏好 | 横排基础；复杂脚本/竖排/PS排版效果未验证 |
| 文字形态 | Type on Path、Warp Text、Type Mask、convertToShape/path、rasterize | rasterize基础有；path/warp/mask作者缺 |
| Pen | Pen/Freeform/Curvature、Add/Delete/ConvertAnchor、Bezierhandles、rubberband | 缺完整节点编辑 |
| Paths面板 | work/named/clippingpaths、fill/stroke/makeselection、duplicate/import/export | 部分PSD来源识别；作者工作流缺 |
| 路径选择 | PathSelection/DirectSelection、point/groupselect、boolean Combine/Subtract/Intersect/Exclude | 缺完整模型/UI |
| Shape属性 | Rectangle/Rounded/Ellipse/Polygon/Star/Line/Custom；fill/stroke/dashes/join/cap/align/arrowheads | 仅Rectangle/Ellipse/Line及基础圆角/线宽；其余缺 |
| Frame/Artboard | frame替换图源与裁切、画板背景/guide/独立尺寸、assetexport | 缺作者模型；SVG导入不是这些语义 |

这些选项影响最终像素排版、可编辑性和PSD结构，应有真实字体/许可证、baseline、换行、路径缩放、再次编辑/保存回PS的对照；不能仅用截图确认“文字出现了”。

<a id="appendix-8"></a>
### 附录8：容易遗漏的高级/新功能与历史边界

| 功能 | 具体效果/操作 | 项目情况、版本边界与证据 |
|---|---|---|
| Paint Symmetry | Vertical/Horizontal/Dual Axis/Diagonal/Wavy/Circle/Spiral/Parallel Lines/Radial/Mandala、自定义path；一笔实时镜像/多方向重复 | 缺作者流程；不等于Duplicate/Flip图层。[Brush模型][DYNAMICS]；[官方对称绘画，2026-10-04](https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/create-fill-with-patterns/paint-symmetrical-patterns.html) |
| Pattern Preview / Define Pattern | 画布外实时平铺，边缘连续，存pattern供后续fill | 缺作者流程/预设模型；单纯Offset/GalleryTexture不是无缝pattern工作区。[UI][UI]；[官方Pattern，2026-02-23](https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/create-fill-with-patterns/create-a-new-pattern.html) |
| Dynamic Layer（2026） | Prompt to Edit结果转Dynamic，slider重调生成效果强度 | 缺该模型；普通Opacity/调整层不能承诺相同语义。[工程模型][CONTRACT]；[官方Dynamic layer，2026-08-28](https://helpx.adobe.com/uk/photoshop/desktop/create-open-import-images/create-images/create-a-dynamic-layer-from-a-generated-edit.html) |
| Image Stack modes | Entropy/Kurtosis/Maximum/Mean/Median/Minimum/Range/Skewness/Standard Deviation/Summation/Variance；跨多幅非透明样本统计，去噪/去过客 | 缺图像栈模型；普通layerblend不是统计栈。[工程模型][CONTRACT]；[官方stack，2026-10-06](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/create-layer-compositions/image-stack-rendering-modes.html) |
| Content Credentials（Beta界面） | 保存作者/编辑来源；导出时附文件/云存储，预览披露内容 | 缺C2PA签名/凭证链；工程history/SHA日志不冒充内容凭证。[metadata][PSMETA]；[官方启用，2026-08-25](https://helpx.adobe.com/photoshop/desktop/save-and-export/metadata-content-credentials/use-content-credentials.html)、[官方导出](https://helpx.adobe.com/photoshop/desktop/save-and-export/metadata-content-credentials/export-your-work-with-content-credentials.html) |
| Adobe 3D / Substance 3D Viewer Beta | 历史3D/Viewer工作流程 | Viewer已停用；不作为27.11常规作者功能缺口优先实现。[停用公告](https://helpx.adobe.com/substance-3d-viewer/desktop/getting-started/substance-3d-viewer-decomission.html) |
| Pattern Maker / Extract旧optionalplugins | 旧插件重组样本pattern或提取前景 | 可选/历史插件，不能默认为27.11自带。新版日期的PatternMaker帮助仍要求macOS32位模式，说明页面日期新也可能保留旧流程；本机ARM64兼容必须单独查验。项目不支持该插件接口。[官方PatternMaker，2026-10-04](https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/create-fill-with-patterns/generate-patterns-with-pattern-maker.html) |
| Legacy Save for Web / Lighting Effects | 历史web优化与打光 | 不按历史菜单截图推断当前所有mode/GPU可用；现代ExportAs另验收，legacy功能实机菜单尚未逐项确认。[预设历史说明](https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/brushes-presets/photoshop-presets-locations.html)、[当前filter参考](https://helpx.adobe.com/photoshop/desktop/effects-filters/blur-sharpen-filters/filter-effects-reference.html) |

这份目录的“齐全”指主要内置能力、具体名称和效果目标可查找，并把缺项与证据写清；它不是全部参数组合都已实机试用的声明。真正产品对齐仍依赖逐阶段原生图像/操作验收。

[A21]: /Users/zhoujin/Documents/PS/Compositor_Electron/docs/PHOTOSHOP_ALPHA21_ACCEPTANCE_2026-10-13.md
[BRUSH21]: /Users/zhoujin/Documents/PS/Compositor_Electron/docs/PHOTOSHOP_ALPHA21_NEAR_HARD_ANALYSIS_2026-10-13.md
[MASK21]: /Users/zhoujin/Documents/PS/Compositor_Electron/docs/MASK_FEATHER_ALPHA21_REFERENCE.md
[CROP21]: /Users/zhoujin/Documents/PS/Compositor_Electron/docs/CROP-ALPHA21-REFERENCE.md

[A22]: PHOTOSHOP_ALPHA22_ACCEPTANCE_2026-10-13.md
[TOOLS22]: TOOL-GROUP-AUDIT-2026-10-13.md
[PLAN22]: PHOTOSHOP_ALIGNMENT_PLAN_2026-10-13.md
[KEY22]: KEYBOARD-AUDIT-2026-10-13.md
[COLOR22]: UPSTREAM_87E2283_COLOR_AUDIT_2026-10-13.md
[ICC22]: PSD_RGB_ICC_POLICY_2026-10-13.md
[SMOOTH22]: SELECTION-SMOOTH-BORDER-REFERENCE.md
[TONAL22]: PHOTOSHOP_THRESHOLD_POSTERIZE_C080_2026-10-13.md
[PROGRESSIVE22]: UPSTREAM_PROGRESSIVE_BLUR_3AE11CD.md
