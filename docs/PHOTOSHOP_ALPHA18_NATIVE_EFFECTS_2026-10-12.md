# Photoshop 原生效果研究与第二批修复

日期：2026-10-12。研究对象：本地 Adobe Photoshop 2026 / 27.11.0；改造对象：Compositor Electron 0.3.0-alpha.18。这一批在 alpha.17 的首轮研究之后继续实际操作 Photoshop，研究选区羽化、圆形笔尖、Opacity、Flow、Spacing 的效果，并修复本项目高位深绘画的源数据精度。整份 Photoshop 对齐计划仍在分批推进。

## 研究方法和范围

在 Photoshop 中通过 File → Scripts → Browse 执行可复核 JSX，打开自制 256×192 白色图和透明图，每个案例在独立文档内执行操作、保存 PNG 后关闭该测试文档。脚本记录 Photoshop 版本、位深、参数及成功/失败；画笔正式参考关闭纹理、散布、颜色动态、湿边、平滑和压力覆盖，设置和读回实际 Opacity/Flow/Spacing。结束后恢复之前的活动文档、前景色和画笔参数。用户业务照片、选品调研图片不参与研究。

脚本与实际输出分别保留：

- `scripts/native-reference/photoshop-feather-study.jsx`：矩形、画布边界、带洞、反选、重复羽化、小区域；0/1/2/3/5/10/20/40 px。21 个成功输出。全画布案例反选后没有可删除区域，记录失败，不计入验收。
- `scripts/native-reference/photoshop-brush-study-v2.jsx`：12 个成功输出，含 32 px 硬圆/柔圆/中等硬度、单点/路径、一次/两次笔画及 RGB16。
- `scripts/native-reference/photoshop-brush-study-v3.jsx`：6 个成功输出，补充 48/64 px、50% Opacity、10/25/100% Spacing。
- `scripts/native-reference/photoshop-brush-study-v4.jsx`：14 个成功输出，32 px 硬度0/1/10/25/50/75/90/99/100，64 px硬度25/50/75及两种间距的中等硬度笔画。
- 原始 PNG、参数读回及日志：`artifacts/photoshop-native/outputs/{feather-study,brush-study-v2,brush-study-v3,brush-study-v4}/`。正式研究新增 53 个成功输出；早期 7 个画笔试运行输出不作为正式结论。
- 入库独立参考：`fixtures/parity/photoshop-27.11-feather.json`、`photoshop-27.11-brush.json`。保留原始源、脚本、日志和 PNG 的 SHA-256，以及 Photoshop 作者 Alpha，不由本项目生成期待像素。

路径笔画用于隔离笔尖与叠加算法；它不证明自由手绘延迟、数位板驱动、纹理笔刷或天然发丝效果相同。实际界面另行用鼠标拖选、画点、笔压事件和 worker preview/commit 验收。

## 功能怎样影响图片

羽化将硬的选区边界变成连续灰度覆盖。填充、绘画或创建蒙版会按覆盖率改变图片，小选区的大羽化可能只有很低的最高覆盖，因而没有 50% 蚂蚁线。反选应当反转整张灰度覆盖，重复羽化继续软化已经存在的边缘，不只是移动一条轮廓。

Opacity 控制一次笔画的覆盖上限；Flow 控制每次笔尖落点的墨量，连续经过或回画会累积。Spacing 决定落点之间相对于笔尖直径的距离：低间距更连续、相同 Flow 下累积更密，高间距会显出分离的点。柔圆笔尖的有效尾部可能超出名义直径，不能直接在名义半径处硬截断。

这些语义参考 [Adobe 绘画工具](https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/brushes-presets/paint-with-brush-or-pencil-tool.html)、[Adobe 画笔设置](https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/brushes-presets/display-brush-panel-brush-options.html)、[Adobe 动态笔刷](https://helpx.adobe.com/photoshop/using/adding-dynamic-elements-brushes.html) 和 [Adobe Selection API](https://developer.adobe.com/photoshop/uxp/ps_reference/classes/selection/)。以下数值来自实际本地输出，不将公开帮助当作 Adobe 内部算法说明。

## 已修复差异与实测

### 选区羽化

原项目将 feather 数字映射为半数标准差，在 Photoshop 操作配置下相同数值的软边明显偏窄。新配置使用测量支持的 sigma=amount；遗留 Compositor 配置和未声明模式的旧动作保留原映射。覆盖、组合、ROI 和轮廓统一使用同一范围定义。添加新形状时各自保留原先软边；再次羽化通过方差组合，不把历史选区重解释为新参数。旧参数跨配置需要超出参数上限时先固化原覆盖，再继续羽化。

21 组独立参考中，修复后最大 Alpha 残差为 0–6 /255。几个例子：

| Photoshop 案例 | 修复前最大 Alpha 误差 | 修复后最大 Alpha 误差 |
| --- | ---: | ---: |
| 中心矩形 Feather 1 | 61 | 5 |
| 中心矩形 Feather 10 | 73 | 4 |
| 中心矩形 Feather 40 | 119 | 6 |

边界、洞、反选和重复羽化同样单列在 `measurements/feather-study/comparison.json`。小区域 Feather 40 的原生峰值为 1，候选为 0，仍保留这一私有核尾部差异；不称逐像素完全等价。命名选区保存最终灰度覆盖，Undo、Redo 和工程重开保留效果。

### 柔圆笔尖、Flow 和 Spacing

Photoshop 模式新增间距百分比，默认 25%；Flow 99% 和 100% 使用同一落点算法，移除旧算法分支导致的效果跳变。32 px 柔圆原型选择固定 `sigma = diameter × 0.234375`、4 sigma 尾部、按间距落点，不强制终点额外盖一枚笔尖。48/64 px 留作不同尺寸验证，没有每个尺寸另调常数。图层扩边、RGBA8、RGBA16、HDR、局部选择画笔及预览共享这一几何。

10 个柔圆参考以两边非零 Alpha 的并集计算 MAE，避免大面积透明背景稀释误差。相对于原有显式间距方案，平均 MAE 从 15.2480 降到 0.9616 /255；48/64 px 样本从 13.1528 降到 0.9324 /255，10/10 案例改善。

| 原生案例 | 修复前并集 MAE | 修复后并集 MAE | 修复后最大误差 |
| --- | ---: | ---: | ---: |
| 32 px 柔圆单点，Opacity/Flow 100% | 14.1517 | 0.4177 | 2 |
| 48 px 柔圆单点 | 14.0684 | 0.8517 | 2 |
| 64 px 柔圆单点 | 13.9926 | 0.7119 | 2 |
| 32 px 柔圆直线，Flow 100%、Spacing 25% | 25.6237 | 1.0094 | 5 |
| 32 px 柔圆直线，Flow 20%、Spacing 25% | 10.0457 | 0.7425 | 4 |
| 32 px 柔圆直线，Flow 20%、Spacing 10% | 17.7278 | 2.2846 | 36 |

最后一个残差仍明显，路径长度恰为间距的整数倍，不能归咎于终点额外落点。原生落点相位/步进尚待研究。最初的中等硬度单点最大残差为83，随后由下节的连续模型进一步修复；全硬单点边缘最大残差80仍保留，没有把它计作完全对齐。完整候选、能量比和脚本证据在 `measurements/soft-tip-candidates/comparison.json`；探索文件中的“product unchanged”描述的是候选研究阶段，本批采用上述固定候选后的产品结果由入库参考测试和桌面验收另行验证。

界面在 Photoshop 画笔配置下使用 Hardness/Opacity/Flow/Spacing 百分比，保存参数和 MCP 数值仍使用 0–1 或间距/直径比；切回 Compositor 保留原笔尖覆盖与默认历史动作语义。

### 硬度连续性与中等硬度

第一轮柔圆修复之后的独立审计发现，硬度0使用新模型、任意正值退回旧笔尖，会使32 px单点在0→0.000001时Alpha总量从90028骤降到63684（-29.26%）。这会造成硬度滑块明显跳变，不能直接交付。

补做v4后采用固定肩部族：半径R、sigma0=R×15/32、core=R×[1−(1−h)^1.25]、sigma=max(0.001,sigma0×(1−h))，core内覆盖为1、外围为Gaussian；h>.9用smoothstep逐渐混到已有全硬抗锯齿端点。最大范围固定4sigma0。系数由v2/v3中等硬度提出，v4不同硬度和64 px验证，不逐样本单独调参。共享源码与独立候选数据数值相符。

14个中间硬度案例平均非零并集MAE由22.7407降到3.3452 /255；64 px留出案例由28.9661降到3.4352 /255。0→0.000001两边的总量现在均为90028，范围外尾部保持23而不突然清零。32 px硬度50单点最大误差由83降到10，64 px硬度50最大误差20。32 px硬度90/99仍有最大残差64/91，全硬端点残差80，低Flow/Spacing10的中等硬度笔画最大残差43。连续近似改善了参数手感，不等于复现Adobe私有核。

同参数原生重测也有差异：柔圆单点max1，硬度50单点exact0，硬度50低Flow直线max5。不能把所有相位/量化残差都归为本项目错误。独立基线、候选族、重复试验与证据SHA见`measurements/hardness-family-candidates/comparison.json`。当前脚本设置全部笔尖参数，读回验证Opacity/Flow；完整嵌套tip descriptor读回仍待扩展。

### 高位深绘画和擦除

旧路径先对 PNG8 显示代理绘画，再将改动覆盖搬回高位深源：低强度变化会消失，HDR 原有负值和超白值可能被代理截断。新增公共 `high-depth-paint.ts`，直接从 immutable RGBA16 或 Float32 原始预乘源进行 source-over/erase；显示 PNG 仅在结果生成后制作。选区、覆盖、Opacity 乘到源强度，未命中像素精确保留。

- RGBA16 `[10001,20002,30003,65535]`，黑色 Opacity 0.001：现在为 `[9991,19982,29973,65535]`，此前低强度变化可能完全丢失。
- HDR `[2,-0.25,0.5,1]`，黑色 Opacity 0.1：现在为 `[1.8,-0.225,0.45,1]`（Float32），此前代理路径 RGB 约为 `[0.898039,0,0.450980]`。
- 擦除对原始预乘 RGB 和 Alpha 同比例处理；软笔范围外的尾部参与图层扩边，Preview/Commit、Undo/Redo 保留原始资产，不把 display 当源。

这证明直接合成精度修复，不证明 Photoshop RGB16 画笔量化一致。原生 1% Opacity RGB16 参考峰值 772，而本项目数学源合成峰值 655，差异明确保留。覆盖和选区平面仍为 8 位，蒙版仍为 8 位；这批没有实现完整 16 位笔尖/蒙版管线。

## 继续研究顺序

1. 圆笔所有硬度的连续性、硬圆抗锯齿、低 Flow/低 Spacing 落点、RGB16 原生量化；数位板真实输入与笔画延迟单独测量。
2. Photoshop 蒙版属性 Feather 的尺度/变换、Gaussian 边界/参数映射、裁剪 Delete Cropped Pixels 与非破坏模式。
3. 修复/仿制/涂抹/液化和 Camera Raw 在真实照片上的纹理、边缘、颜色变化，建立同源照片输出。
4. RGB16 PSD 写出、RGB32、ICC、组隔离/Fill、智能对象与复杂 PSD；复杂发丝/去杂色依赖真实照片样本再推进。
5. 按稳定类型/资产/事务边界优化代码，测量 4K/多层笔画、保存/撤销和峰值内存；不能以性能优化换掉原始高位深数据。

当前批次实际运行门禁、版本和包位置见 `PHOTOSHOP_ALPHA18_ACCEPTANCE_2026-10-12.md`。原生参考接近、工程源保真、界面交互通过和 Windows/EDR 支持是分别验证的结论。
