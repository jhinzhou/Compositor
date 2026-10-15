# Photoshop 常用效果的语义研究与同图验收计划

研究日期：2026-10-12。范围：Levels、Curves、Exposure、Gaussian Blur、Hue/Saturation、蒙版 Density/Feather。本阶段只读产品源码并查阅 Adobe 第一方资料，未修改产品、未操作 Photoshop、未生成 Photoshop 输出。

**当前不能据此宣布与 Photoshop 的像素效果一致。** 已有 Compositor C 参考、Metal 的标量模型、项目单元测试证明各自标注的实现范围；它们不是 Photoshop 参考。真正的 Photoshop 参考必须由本地 Photoshop 对同一输入执行指定操作，再保存输出与设置证据。

## 1. 已确认与待验证的差异

| 优先级 | 项目 | 现有行为 | Photoshop 对照及证据等级 | 后续动作 |
| --- | --- | --- | --- | --- |
| P0 | HDR Exposure 的负值 | `applyHDRExposure` 在 Gamma 前以 `max(0, …)` 截断负数；零参数也会消除负值 | Adobe 明确写 Gamma 对负值以零为中心镜像处理，保持负号。已确认文档语义与源码不一致；实际版本输出仍需留证 | 导入带负通道的浮点输入，分别测试零参数、负 Offset、Gamma 0.5/2；先确认真正输出，再实现 Photoshop 语义路径 |
| P1 | Curves 的横向端点 | 存储必须从 x=0 到 x=255，不能表示首端点 x=16、末端点 x=239 | Adobe 明确支持移动黑/白端点的输入位置。已确认表达能力差异 | 保存 Photoshop 的端点设置与灰阶输出，设计兼容旧工程的曲线端点表达 |
| P1 | Gaussian 数值手感 | `radius` 实际直接作为标准差 σ；积分核截断至 ±ceil(3σ) | Adobe SDK 定义像素半径，却没有公开它与 σ 的完整关系。暂不能判断同数字的效果是否一致 | 用 Photoshop 的脉冲/阶跃真实输出拟合，不猜测“半径就是 σ”或固定换算系数 |
| P1 | 蒙版 Feather 的单位 | 源蒙版像素；随蒙版尺寸缩放；高质量采样目前仍为双线性 | Adobe 公开参数是 px；源坐标/文档坐标、缩放前后的应用顺序没有由所读资料完整确定 | 同蒙版在 0.5×/1×/2× 与旋转下比较边缘宽度，区分参数单位与采样影响 |
| P1 | HSL 的颜色公式和插值 | 33³ 三维色立方插值；分区响应按四端点线性渐变，色相权重使用取整角度 | Adobe 公开颜色分区与渐变语义，未公开完整逐像素公式。不能把 Compositor 的色立方称为 Photoshop 等价实现 | 用色相环、饱和度阶梯、照片和低 Alpha 色块取得 Photoshop 输出，分辨公式与 LUT 误差 |
| P2 | Levels 的联合通道顺序/精度 | 先单色通道，再 RGB 总通道；8 位最后取整，16 位直接计算高精度后取整 | 基本黑白点/中间调方向符合官方描述；顺序、内部量化和颜色管理仍未由真实输出确认 | 普通曲线与单色/总通道联合设置分开测试 |
| P2 | HSL 参数范围 | 非着色色相也允许 -360…360，着色可采用 activeRange 的设置 | Photoshop API 普通模式 -180…180；着色 0…360 且不使用局部分区。这是已确认 API 表达差异，桌面具体交互仍需核对 | UI/兼容模式限制与工程兼容策略分开设计，不直接删掉已有参数 |
| P2 | Gaussian 工作流 | 项目可使用 Gaussian 调整图层；Normal 模糊可改变下方合成 Alpha | Photoshop 对应普通滤镜或智能滤镜；Adobe 调整图层清单没有 Gaussian 类型。工作流不是一一对应 | 首轮比较破坏性普通滤镜；智能滤镜及项目调整图层另立合成场景 |

Exposure 的负值依据：[Adobe HDR Exposure](https://helpx.adobe.com/photoshop/using/adjusting-hdr-exposure-toning.html)。Curves 端点依据：[Adobe Curves](https://helpx.adobe.com/photoshop/desktop/adjust-color/color-corrections/adjust-color-and-tone-with-curves.html)。Gaussian 参数依据：[Adobe UXP Layer.applyGaussianBlur](https://developer.adobe.com/photoshop/uxp/ps_reference/classes/layer/#applygaussianblur)。HSL 参数依据：[Adobe Photoshop API 调整层参数](https://developer.adobe.com/firefly-services/docs/photoshop/guides/photoshop-v2/v1-to-v2/layer-operations-adjustments)。调整层类型依据：[Adobe 调整层与填充层](https://helpx.adobe.com/in/photoshop/desktop/create-manage-layers/color-adjustment-fill-layers/work-with-adjustment-and-fill-layers.html)。

## 2. 参数与便携实现逐项核对

下文公式均描述**项目当前算法**，不是 Adobe 公布的算法。便携色彩处理固定采用 sRGB 转换；首轮对照必须统一为 sRGB，其他 ICC 配置另列色彩管理差距。

### Levels / 色阶

项目 `src/shared/image-filters.ts` 的四组参数分别为 RGB 总通道、R、G、B。每组：输入黑点 0…254（默认 0）、输入白点 1…255（默认 255，必须大于黑点）、Gamma 0.1…9.99（默认 1）、输出黑/白点 0…255（默认 0/255）。输出黑点大于输出白点允许反相。

对归一化直色通道 v，当前计算：

`L(v) = [outBlack + clamp((255v − black)/(white − black), 0, 1)^(1/gamma) × (outWhite − outBlack)] / 255`

执行 `L_master(L_channel(v))`。16 位在解预乘后的值上运算，最终乘回原 Alpha 一次取整；不会先变成 8 位。HDR 非 Exposure 的颜色调整走 Compositor 的逐像素峰值归一化、UNORM16 调整、峰值恢复；负 RGB 在归一化时变零，不能认为这是 Photoshop 的 32 位色阶算法。

典型效果：输入黑/白点收紧增加端点裁切；Gamma >1 提亮中间调；输出黑点抬升、白点降低压缩对比度。Adobe 说明黑/白输入映射到输出端点，且给出黑点 5、白点 243 的裁切例子；公开帮助未给出完整内部精度与计算顺序。[Adobe Levels](https://helpx.adobe.com/photoshop/desktop/adjust-color/color-corrections/adjust-levels-in-an-image.html)、[Adobe Levels 中间调说明](https://helpx.adobe.com/uk/photoshop/using/levels-adjustment.html)。

对照设置：默认；黑/白 16/239；Gamma 0.5/1.4/2；输出 16/239；红通道 Gamma 1.2 + 总通道 Gamma 0.8；端点极窄 127/128。检查端点精确裁切、单通道串联顺序、灰阶是否产生新增断层以及 Alpha 是否改变。自动色阶、吸管校正属于另一个工作流，不能以手动参数测试覆盖。

### Curves / 曲线

项目每通道 2…32 点，点的 x/y 均 0…255；x 严格递增且首/末 x 必须为 0/255。使用分段三次 Hermite：端点斜率取相邻割线；内点相邻割线异号或为零时斜率为零，否则取调和平均；插值输出限制到 0…255。先单色通道，再 RGB 总通道。16 位输入不按 8 位网格量化。

典型效果：S 曲线增强中间调对比；抬低端压高端缩小对比；非单调曲线产生反转局部色调。Adobe 桌面帮助公开最多 14 个控制点、输入/输出图表和可移动端点；未公布插值方程。因此项目的 32 点不是“更接近 Photoshop”，只是另一种容量；Hermite 也不能称 Photoshop 曲线。[Adobe Curves 官方说明](https://helpx.adobe.com/photoshop/desktop/adjust-color/color-corrections/adjust-color-and-tone-with-curves.html)。

对照设置：默认；三点 `(0,0),(128,160),(255,255)`；五点 S 曲线；非单调 `(0,0),(64,160),(128,64),(255,255)`；首末横移 `(16,0),(239,255)`；联合通道。沿密集灰阶比较 LUT、斜率变化位置、过冲/平台和最大误差；横移端点当前只能记录表达缺口，不能用额外点冒充完全相同参数。

### Exposure / 曝光

项目 Exposure -20…20 EV（默认 0）、Offset -0.5…0.5（默认 0）、Gamma 0.01…9.99（默认 1）。这组范围与 Adobe Photoshop API 当前定义一致；API 的名称 `gammaCorrection` 与项目 `gamma` 应明确映射。[Adobe Photoshop API Exposure 参数](https://developer.adobe.com/firefly-services/docs/photoshop/guides/photoshop-v2/v1-to-v2/layer-operations-adjustments)。

8/16 位当前 `encode_sRGB(max(0, decode_sRGB(v) × 2^EV + Offset)^(1/Gamma))`。16 位最终限制在 UNORM16 范围。HDR 使用有符号 extended sRGB 的解码/编码和 Float32 运算，保留超白但在幂运算前裁掉负值。即使输入参数全为默认，含负通道的 HDR 输入也不是恒等变换。

典型效果：正 EV 扩大线性亮度；Offset 移动暗部；Gamma 改变中间调。Adobe 明确曝光计算在 Gamma=1 的线性空间，并描述 Gamma 对负数保持负号；没有将完整变换顺序和所有通道精度公开。HDR Preview 的查看曝光与调整层 Exposure 必须区分，截图亮度相似不证明原始像素相同。[Adobe HDR Exposure](https://helpx.adobe.com/photoshop/using/adjusting-hdr-exposure-toning.html)、[Adobe HDR 预览显示](https://helpx.adobe.com/photoshop/desktop/adjust-color/hdr-and-channel-manipulation/adjust-the-hdr-preview-display.html)。

对照设置：EV 0/±1/±2；Offset ±0.05；Gamma 0.5/2；EV -1 + Offset 0.05 + Gamma 1.4。浮点输入包括线性 -0.25、-0.01、0、0.18、1、4、16 和 Alpha 0.25/1。保存浮点输出验证负号、超白能否通过降低曝光恢复、Alpha 保持和变换顺序，禁止先导出 PNG8 再评价 HDR 精度。

### Gaussian Blur / 高斯模糊

项目参数 `radius` 0.1…250（默认 5），`preserveTransparency` 默认 false。Adobe UXP 公开同样的半径范围，但不公布截断、边界延拓或半径到标准差映射。[Adobe UXP 高斯模糊](https://developer.adobe.com/photoshop/uxp/ps_reference/classes/layer/#applygaussianblur)。

当前是 σ=radius 的可分离积分高斯：每个 tap 对像素宽度积分，通过 erf 近似计算，截断 ±ceil(3σ) 后归一化。大核采用同权重的 FFT，不改成三次盒式模糊；8 位预乘颜色有量化边界，高位深空间模糊用 Float32 预乘 RGBA。这里的积分、截断和 FFT 是项目代码事实，不是 Photoshop 实现事实。

破坏性滤镜的透明图层可向源外扩边 `ceil(3σ+2)` 后按 Alpha 裁掉透明界限；未旋转且覆盖画布边界时按对应方向延拓边缘。选区在完整源图模糊之后以覆盖率混合结果，所以选区外颜色会进入选区内。该选区采样方向符合 Adobe 公布的模糊语义；准确边界与 Alpha 数值仍需对照。Adobe 还要求在模糊图层边缘时关闭“锁定透明像素”。[Adobe Filter Effects — Blur](https://helpx.adobe.com/photoshop/using/filter-effects-reference.html)。

项目 `preserveTransparency=true` 保留原 Alpha，颜色按模糊 Alpha 恢复。项目 Gaussian 调整层在 Normal 模式默认可卷积 Alpha，再经调整层蒙版/不透明度混合四通道；非 Normal 恢复原 Alpha。**不能用 Photoshop 普通高斯滤镜的数据替代这套调整层合成场景的验证**。Photoshop 智能滤镜需单独记录智能对象、滤镜蒙版、滤镜混合模式和不透明度。

对照半径：0.1、0.5、1、2、5、20、80、250；中心/边缘脉冲、黑白阶跃、半透明色边、选区紧贴高对比区域；透明锁定分别开/关。测脉冲总能量、质心、二阶矩 σ_eff、FWHM、尾部能量，以及阶跃 10%→90% 的宽度，先判断参数映射，再讨论核形状和边界。

### Hue/Saturation / 色相饱和度

项目 Master 和六分区：Reds/Yellows/Greens/Cyans/Blues/Magentas。普通 Hue -360…360、Saturation/Lightness -100…100；Colorize 默认 false。四个色相端点是渐入、全效起、全效止、渐出，处理跨 0° 范围；另有 activeRange 和 invertRange。

Adobe Photoshop API 普通 Hue -180…180、Saturation/Lightness -100…100；Colorize Hue 0…360、Saturation/Lightness 0…100；Colorize 不接受 localRange。这是 API 契约范围，不能直接假设所有桌面版本 Colorize 的 UI 与云 API 限制完全相同。四端点命名为 beginRamp/beginSustain/endSustain/endRamp。[Adobe HSL 参数与分区](https://developer.adobe.com/firefly-services/docs/photoshop/guides/photoshop-v2/v1-to-v2/layer-operations-adjustments)。

项目采用 max/min 的 HSL：负饱和度按比例减少 S；正饱和度为 `S/(1−amount)` 并限制上限；正 Lightness 向白插值、负值向黑缩放。各分区增量按权重加到 Master，分区权重的色相为取整角度；最终通过 33³ 浮点色立方三线性插值。8 位还会先模拟预乘的 Alpha 量化，低 Alpha 下可能有额外色偏；16 位直接用高精度预乘输入。HDR 走峰值归一化桥接，因此不能保证负值或超白区间的 Photoshop HSL 等效。

典型效果：单色物体换色、饱和度增强/降低、灰阶着色；范围外侧渐变用于避免突变。Adobe 公开分区与 Colorize 工作流，没有给出上述饱和度增长公式、33³ 色立方或取整策略。[Adobe 桌面 Hue/Saturation](https://helpx.adobe.com/in/photoshop/desktop/adjust-color/color-corrections/apply-a-hue-or-saturation-adjustment.html)。

对照设置：Master Hue ±30/180，Saturation -100/-30/+30/+100，Lightness ±20；Reds 范围 315/345/15/45；移动色相边界到非整数；跨 359°/0°；Colorize 30/40/0；联合 Master+Reds+Yellows。测环形色相误差、灰阶是否被着色、饱和度阶梯连续性、分区边缘导数、低 Alpha 色偏，以及 LUT 格点附近误差是否聚集。

### Mask Density / Feather / 蒙版属性

项目存储 Density 0…1（默认 1），UI 是 0…100%；Feather 0…250 源蒙版 px（默认 0）。Adobe Photoshop API 的 userMask 公布 Density 0…100、Feather 0…250 px。这里是该 API 的范围；智能滤镜蒙版或其他 SDK 属性不能混作图层像素蒙版上限。[Adobe userMask 与 pixelMask](https://developer.adobe.com/firefly-services/docs/photoshop/guides/photoshop-v2-beta/v1-to-v2/manifest-migration)。

项目先给 8 位灰阶蒙版填充原外围色并扩边 `ceil(3×feather)+2`，做积分 Gaussian，再向白混合 Density：`M_effective = 1 − density + density × G_sigma(M)`，分别有 8 位取整。黑=隐藏、白=显示；Density 为零显示全部，为一使用原蒙版。原 PNG 不写回；源蒙版缩放、旋转后采样有效覆盖。外围色优先来自 `photoshopMaskDefault`，否则多数边界色推断；Nearest 最近邻，其他采样双线性。1×1 蒙版按无限均匀覆盖处理，Feather 不改变它。

Adobe 官方描述 Density 控制遮挡强度，降低后原隐藏区域更多可见；Feather 软化可见与隐藏边缘。旧 CS6 官方资料的这项语义仍可作方向参考，但当前精确核与空间坐标必须使用本地版本输出；当前官方向量蒙版帮助也保留这两个属性。源 PNG 与非破坏属性分离方向一致，不代表边缘每个像素一致。[Adobe 官方 CS6 蒙版属性（搜索索引仍保留第 179 页，直接访问现已重定向）](https://helpx.adobe.com/pdf/cs6/photoshop_reference.pdf)、[Adobe 向量蒙版属性](https://helpx.adobe.com/photoshop/using/masking-layers-vector-masks.html)。

对照：Density 0/25/50/100%，Feather 0/0.5/2/10/50；白底黑洞、黑底白圆、硬阶跃、软灰边、边界不全同色、1×1；属性先设置再缩放与先缩放再设置两条操作链；链接/独立蒙版、旋转和裁剪。测有效覆盖、50% 等值线位置、10%→90% 宽度、范围外值以及源蒙版文件是否被改变。属性 Feather 与“直接模糊蒙版像素”是两种操作，不应混测。

## 3. 同图参考的采集要求

1. 采用一张非敏感外部照片作为视觉样本，统一来源 SHA-256，避免使用用户要求排除的“选品调研”图片。另用诊断输入定位公式：灰阶阶梯/渐变、RGB 色块和色相环、脉冲/阶跃、透明彩边、蒙版几何、带负值和超白的浮点图。
2. 所有诊断输入都可以由项目生成；**只有 Photoshop 实际处理的输出是 Photoshop reference**。输入生成程序、项目执行程序、Compositor C 程序都不能生成标称 Photoshop 的期望文件。
3. 记录 Photoshop 完整版本/build、操作系统、RGB 模式/位深、ICC 配置、是否转换配置、智能对象/普通层、缩放/变换、透明锁定、完整选区、蒙版、混合模式、不透明度。首轮设普通层、Normal 100%、sRGB、100% 视图、无选区/无蒙版，再逐项加入复杂条件。
4. 8/16 位保存无损 PNG/TIFF/PSD 等实际支持的原始通道，另保存参数截图/动作描述；32 位保存可以复核线性浮点数据的 TIFF/EXR，明确 alpha 与编码。若导出路径会转换色域、量化或套用 HDR Toning，单独记录并禁止当作原始算法结果。
5. 每个案例存 `input hash → Photoshop settings → raw output hash → project settings → raw output hash → metrics`。按参数值命名，保留 Photoshop 源文件和输出，读取像素与显示截图分别留证。
6. 首轮明确各功能在实际 Photoshop 8/16/32 位文档是否可用。帮助/云 API 的覆盖不能自动等同于桌面全部位深可用；灰掉的能力记“该版本/位深不可用”，不通过转 8 位伪装完成。

## 4. 像素指标与验收规则

### 共用指标

- 先统一尺寸、坐标、色域/传递函数和通道格式。整数逐通道 MAE、RMSE、最大值、P95/P99；列出超过 1/2/4 LSB 的比例。16 位保留真实 16 位结果，不先用 PNG8 预览比较；预览的抖动误差单列。
- 分别比较 straight RGB、premultiplied RGB、Alpha。完全透明像素的 straight RGB 不纳入颜色误差，透明边缘主要看预乘颜色/Alpha，以及合成到黑/白/灰底的结果。
- 浮点列绝对/相对误差、负值保留率、超白保留率、NaN/Inf、通道裁切、新增零值；颜色管理转换后的线性亮度另列。只有两边确实转换到同一 Lab 白点/观察条件后才报告 ΔE00，不能对任意 RGB 字节直接算 ΔE。
- 检查恒等设置、未选区像素、原 Alpha、源图/源蒙版是否精确保留；变换或模糊有意改变 Alpha 的案例不能套用“不变”指标。
- 评价操作手感时单列滑块范围、默认值、键盘步进、预览/提交/撤销、保存重开、坐标单位；像素接近不能覆盖工作流差异。

### 功能特定指标

| 功能 | 核心诊断指标 | 最需要隔离的变量 |
| --- | --- | --- |
| Levels | 灰阶 LUT、端点裁切阈值、联合通道的顺序、量化平台数 | 工作配置、内部精度、总通道与单通道顺序 |
| Curves | 每段残差、拐点/过冲位置、单调性、横移端点与平台长度 | 插值、控制点编码、端点外延与取整 |
| Exposure | 线性域 EV 比率、Offset/Gamma 顺序、负号/超白、Alpha | HDR 视图曝光与实际调整、ICC、浮点导出 |
| Gaussian | σ_eff/FWHM、10–90% 宽度、能量/质心/尾部、透明边缘 | 参数映射、核截断、边界延拓、透明锁定、选区 |
| HSL | 色相环误差、饱和度连续性、分区渐变、低 Alpha 残差 | 33³ 插值、整角度响应、着色与普通模式 |
| Mask properties | 覆盖率 L1、0.5 阈值 IoU、等值线/软边宽度、外围覆盖 | 源/文档单位、缩放顺序、外围色、8 位蒙版量化 |

**验收顺序：**先取得默认恒等、尺寸/位深/色域、负值/Alpha 等语义结果；再校准参数映射；最后比较逐像素误差。整数最大误差 ≤1 LSB 可以作为逐像素接近的目标，但本研究未测量真实 Photoshop，不预先宣布这个阈值已满足或适用于全部 16 位/浮点能力。每类取得真实结果后冻结阈值和失败样本，修复后用未参与拟合的照片与参数复验。

## 5. 实施顺序与产出

1. **参考采集：**本地 Photoshop 先执行默认、基础单参数和关键透明/负值案例。输出实际能力/参数矩阵及原始参考，不以项目自测通过数换算 Photoshop 完成度。
2. **最小语义修复：**确认 Exposure 负值、Curves 横移端点和 HSL 参数映射；涉及兼容已有工程的地方保留原表示或版本迁移，不能无声改变历史工程。
3. **模糊与蒙版标定：**根据真实核/边缘输出决定 σ 映射、Feather 坐标与边界策略；普通滤镜、透明锁定、智能滤镜、项目调整层分别验收。
4. **HSL 与曲线精度：**用真实 LUT/色块定位公式与插值误差。若需修改，使用独立测试/留出样本，避免只拟合一张图片。
5. **统一验收：**照片视觉操作、无损像素指标、预览/提交一致、撤销恢复、保存重开，高位深数据保留一并完成。此后才扩展其他 Photoshop 增强能力。

本轮研究只增加本文。未运行 GUI、未新增产品算法、未将任何项目自产期望值标记为 Photoshop 输出。

## Stage 2 后续状态

上述参数/差异表是本轮只读研究时的基线。后续实现已放开 Curves 横向端点，并采用 Adobe 文档的 HDR 有符号 Gamma；实现与验证范围见 [Stage 2 色调对齐](PHOTOSHOP_TONE_ALIGNMENT_STAGE2_2026-10-12.md)。该更新不把尚未采集的 Photoshop 负值输出或曲线插值当作已通过。
