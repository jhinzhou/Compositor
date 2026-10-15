# Patch Diffusion alpha.26 参数与内核研究

当前状态：已冻结保守的 Normal Patch 锐利抗锯齿核心修复；显式羽化、宽软覆盖和无128核心回退旧软覆盖路径。58/58 条定向工程检查通过，根代理统一源码验收已通过1955项。没有在产品暴露 Diffusion 1–7；三张自然木纹与合成图改善或保持，但新增程序AA的平均误差退步、羽化仍存在效果差异，不能称 Photoshop 修补已完成。下文保留各阶段研究记录，最终结果见文末。

## 已验证语义

[Adobe 官方修补工具说明](https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/repair-a-selected-area-with-the-patch-tool.html)及[修复实例](https://helpx.adobe.com/ph_fil/photoshop/using/healing-examples.html)说明：Diffusion 控制粘贴区域适应周围图像的速度，低值适用于颗粒/细节，高值适用于平滑图像。它没有给出专有像素内核、参数到迭代次数或卷积半径的公式。

现有 `adaptation:0..1` 仅乘最终的颜色差修正，不能代表原生 1–7 空间扩散参数。已有未指定 Diffusion 的 MCP、UI 和项目操作需要继续保留兼容行为。

## 现有原生资料

三份持久化且有效的 Photoshop 27.11.0 原生 Patch 输出：

- alpha.24：Normal Source、Diffusion 5、50×50 选区、[-160,0]。当前 harmonic adaptation 1 MAE 7.0250667。
- alpha.25：同一自制图、Diffusion 1、51×51、[-160,0]。当前 harmonic MAE 0.5568371。
- alpha.25：同一自制图、Diffusion 5、51×51、[-160,0]。当前 harmonic MAE 14.2215814。

不能把这三项当改进前后比较；不能把一幅合成图的一个值拟合为 Photoshop 的完整 Diffusion。

alpha.25 Diffusion 5 另有需要重复核验的颜色差：像素 (350,150) 原生输出 [154,206,201]，Diffusion 1 为 [171,162,158]；alpha.24 Diffusion 5 同点为 [155,145,142]。只有选区一像素差，却导致非红通道显著过冲。外圈目标/供体颜色差不足以通过单纯 harmonic 传播产生该通道关系。需要从干净输入重复固定鼠标位移与参数，结合自然纹理留出样本，才能判断是空间内核、选区/动作差异或原生状态问题。

## 数值诊断与候选

只读 `scripts/diagnose-patch-diffusion-alpha26.ts` 比较边界均值与目标差初值、SOR 1/1.4/1.8/1.95、不同迭代。它不改 fixtures、生产算法或参数默认值。

- Diffusion 1 最小诊断 MAE 约 0.48，充分收敛 harmonic 与现有方法接近。
- Diffusion 5 最小诊断仍约 12.77，且最大差 74。简单调整初值、SOR 或迭代不能可靠表达该样本的原生参数语义。
- 此扫参仅排除不够充分的简单假设，不把最小误差组合投入产品。

候选方案：

1. **单纯强度映射**：保持 harmonic 并把 Diffusion 映到颜色差强度。不能表达空间传播，且已有 sweep 证明无充分效果，不采用。
2. **空间长度/多频带融合**：保留供体细节，按空间尺度移交低频亮度/颜色。应由自然纹理/平滑图像对照校验，而不能假定半径公式就是 Adobe 内核。
3. **带边界斜率/曲率约束的修正**：允许比 harmonic 更强的过冲，但存在不稳定或把目标对象色差带回结果的风险。只有独立样本支持时才考虑。

## 验收约束

根代理采集自然纹理与不规则选区；第一组用于诊断，第二组作为留出。Normal Source / Transparent 关闭，每个样本固定真实选择 mask 和位移，从干净源分别采 Diffusion 1/5/7。先校验历史、像素变化、选区外与 alpha，再计算效果误差。

生产修复必须继续保留：选区外 RGBA、隐藏 RGB、alpha 锁、ROI 限额、取消、同路径预览/提交、幂等重试、撤销重做与保存重开；不静默编辑 RGB16/HDR。参数和内核改动在该证据链确认后记录，当前本文件是研究，不代表这些模型已经上线。

## 已撤回的初版空间参数实验（历史记录）

曾实验性新增 `layer.patch.diffusion?: integer 1..7`，随后因原生效果退步撤回，以下只描述已归档历史代码。省略参数继续保持旧动作解析及旧像素路径；显式 1 也保持旧 2 px halo 与旧 harmonic 字节结果。更高值使用局部模型：只在选区外计算目标减供体的颜色差，按空间尺度做 alpha 置信度归一化高斯平滑，再把该外部颜色场作为 harmonic 边界。它不直接模糊供体纹理，也不会读取被选目标对象的颜色来拟合修复区。

该空间模型与原来的 `adaptation` 强度独立；`sigma=diffusion-1` 是本地实现选择，不是宣称 Adobe 使用同一公式。preparePatch 按采样 halo 扩大私有工作区，继续检查 16 MP 源 / 4 MP 工作区及 1.2 亿计算预算。归一化卷积计入计算预算并逐行检查取消。

`tests/patch-diffusion-alpha26.test.ts` 包含独立棋盘纹理、非均匀外部照明、目标对象色差不污染、透明置信度、单次 opacity、旧字节路径、参数/预算/取消、真实 Editor 提交/撤销重做/保存等证据。这些证明功能和数据边界，不证明 Photoshop 效果一致。

**原生自然纹理诊断与留出门槛尚未完成。**在该门槛完成前不把 UI 默认切成 5，也不将 sigma 映射描述为已验证的 Photoshop Diffusion 参数映射；新模型如果不能减少独立样本差异，旧默认保持并记录残差。

## 第一组自然木纹校准的有效性与失败记录

原生输入为 Kurt Kaiser 的 CC0 [Wood texture, light](https://commons.wikimedia.org/wiki/File:Wood_texture,_light.jpg)，实际 native clean PNG 为 330×247。使用原生抗锯齿多边形覆盖，固定 offset [-95,45]，Normal Source、Transparent 关闭。原生操作由根代理设置 GUI 参数后执行 Photoshop Action Manager，不能描述为纯鼠标参考。源、选区覆盖、结果 decoded bytes 均以 SHA-256 固化在 `fixtures/parity/photoshop-27.11-patch-natural-alpha26.json`。

三次 native 结果各修改 2556 像素，选区外 RGBA 与 alpha 变化均为 0；结果 SHA-256 完全相同 `ba6bff20fdf24ec82d0ba9d415d780e6fe28baedf3a17f01718ba293b81147ca`。这些能作为自然图普通 Patch 的有效参考，但不能证明 effective Diffusion 1/5/7 生效；GUI 字段与 Action Manager 的执行参数可能不同。需要补 descriptor 明确参数或记录真实鼠标事件后重采。

| 模型 | 对同一 native 的 RGB MAE | 最大差 | 边缘 MAE | 相邻梯度 MAE |
|---|---:|---:|---:|---:|
| 旧 harmonic / explicit 1 | 1.218065 | 23 | 1.970126 | 0.414424 |
| exterior spatial tone 5 候选 | 2.751071 | 29 | 4.075472 | 0.526570 |
| exterior spatial tone 7 候选 | 3.031746 | 30 | 4.520440 | 0.555141 |

候选退步，不能使用它支持“Diffusion 5 已对齐”的结论，也不能默认在 UI 启用。早期迭代诊断保留为研究；后续发现研究工具 Buffer.slice 共享底层数据，已修复为 Uint8Array.from。阈值候选的有效新结论见下文，不能使用旧别名污染的 sweep 作晋级或拒绝证据。

[原始 ScriptListener 作者分享](https://community.adobe.com/questions-712/script-for-patch-tool-1066505)显示 patchSelection 可明确携带 patchAdaptation / patchAdaptationType 的七档枚举，可用于下一步验证参数是否真正生效；它不能直接证明 Photoshop 27.11 的 Diffusion 数字对应关系。

## 显式参数重新采样：基线已纠正，候选未晋级

根代理读取原生 `currentToolOptions`，验证实际键为 `healSmoothFactor: 5`，再以带 `null -> channel/selection` target reference 的 Action Manager 指令分别显式设置 1、5、7。脚本首轮漏 target reference 导致 Patch 不可用，失败日志保留；补 reference 后三档确实产生三个不同 hash，不能把首轮失败解释为参数不支持。

自然木纹三档 source 都与前组 source SHA 相同，native mask 原样保留，结果外部 RGBA/alpha 改动均为 0。此前仅 GUI 设置再运行缺参数 descriptor 的三个同 hash 结果，全部与显式 5 相同，证明其实际执行默认 5。新的 `photoshop-27.11-patch-natural-explicit-alpha26.json` 将参数效应标为 verified；旧组保持 unverified 记录。

| 显式原生设置 | 现有核对自然木纹 MAE / Max | 现有核对合成 repeat MAE / Max |
|---|---:|---:|
| 1 | 4.962207 / 31 | 0.556837 / 3 |
| 5 | 1.218065 / 23 | 0.189286 / 1 |
| 7 | 2.448980 / 23 | 0.194412 / 1 |

合成 repeat 源 hash 为 `6ec9414ff0202c9c9eb715670ea98085eb5af7bbdc92cb93c7da315495c596b7`，51×51 像素整数矩形、offset [-160,0]。显式 1 与 alpha25 的 GUI 1 输出完全相同；显式 5 为 `1ba47742195c69e22964298924d61ea3866a2ed7bfe682f4d1ef692107aaa6d6`，与旧 GUI 5 的绿污染输出不相同。旧 GUI 拖动实际参数/精确 offset 未由事件 observer 固化，因此旧 MAE 14.221581 不能继续用作 controlled Diffusion 5 基线。它仍保留为历史合法 Patch 效果记录，不能误报“本轮算法把 14.22 降到 0.19”；降低来自可靠参考的纠正，产品旧核没变。新合成 fixture 正确标注为项目自写源，不沿用 wood CC0 文案。

空间平滑候选在两种校准都退步：自然 5 为 2.751071 / 29，合成 5 为 1.611432 / 4。它已撤出产品源码及 `layer.patch` schema，完整快照与原先 53 条测试日志保留在 `scripts/research/` 和 artifacts 中用于重现，不在 UI 或 MCP 暴露成假的 Photoshop Diffusion。产品仍保留原 harmonic、alpha25 ROI/16MP source/4MP working/撤销/高位深拒绝边界。

早期 soft-mask threshold sweep 曾报告全部退步，但它对解压 Buffer 使用 slice 后共享底层数组，后续候选改写了源；该组数值作废。生产 preparePatch 与固化原生源不受此研究错误影响。后续脚本每候选使用 Uint8Array.from 私有副本，计算 donor + tone 后先 clamp，再验证源 SHA 未变，且 threshold1 必须严格复现生产旧基线，才使用 sweep 结果。

## 冻结后独立留出验收：效果门槛仍未通过

在向根代理明确冻结产品核、拒绝候选后，才接收并读取第二张 Titus Tscharntke 的 public-domain [Old wood texture](https://commons.wikimedia.org/wiki/File:Old_wood_texture.jpg)。源 330×264，六角原生抗锯齿多边形 [[180,95],[218,86],[242,110],[230,148],[200,158],[170,135]]，offset [-110,45]；原生 exact coverage 由根代理在独立 owned 文档中黑白 fill 保存，不经过产品 rasterizer。native 1/5/7 均显式 healSmoothFactor、Normal Source、Transparent false，每档 fresh source hash 完全一致。结果、源与 coverage 以 gzip + SHA-256 归档在 `photoshop-27.11-patch-natural-heldout-alpha26.json`。

| 原生设置 | 冻结旧核 MAE / Max | 拒绝空间候选 MAE / Max |
|---|---:|---:|
| 1 | 12.343845 / 79 | 12.343845 / 79（exact legacy） |
| 5 | 6.024618 / 99 | 11.298383 / 148 |
| 7 | 8.095777 / 143 | 17.818239 / 164 |

三档原生变化分别为 3584/3585/3585 像素，产品旧核变化 3703 像素。每档 native 和旧核/候选的选区外 RGBA 与 alpha 变化均为 0，三个 native 输出 hash 确实分离。固定 5 旧核边缘 MAE 10.555085、内部 MAE 5.716849、相邻梯度 MAE 1.063406，比第一张浅木纹明显差。源源不同及高对比纹理让小校准样本不能代表自然图。

当时的冻结结论是：**自然复杂纹理的 Photoshop 效果门槛没有通过，Diffusion 1–7 尚未实现**。空间候选的退步在第二图再次确认，不能在 UI 增加假 Diffusion。合成 5 最大 1 byte 的结果不能代替自然效果验收。随后根代理授权继续研究，此老木纹被公开用于诊断，已不再是下一候选的独立留出。

后续另设新的训练/留出组研究原生 healSmoothFactor 对空间传播与边界算子的关系；本张老木纹已经用于终验，不应继续称盲留出。代码改动需要另一个独立自然验证集才能晋级。当前仍显式拒绝 RGB16/HDR Patch，保留原始像素和历史，未静默量化。最终定向 51 条工程测试（7 条 native integrity/baseline + 44 条既有保护/ROI/历史/保存）与 typecheck 是源级回归证据，不能描述为自然 Photoshop 效果通过。

## 膜场、像素几何与边界诊断

`diagnose-patch-gradient-alpha26.ts` 在固定三组源/mask/offset 上计算原生 RGB 修正膜的 Laplacian 残差，扫供体 ±1 / ±0.5 px 只用于排除几何假设，不调产品 offset。三组最小残差均在原有 [0,0]，不支持补偿 donor 半像素偏移。encoded RGB 原生 Laplacian MAE 为浅木纹 0.983188、老木纹 1.410999、合成 0.410385；sRGB 转 linear 后为 1.865495、18.832282、0.550520，因此线性空间不能解释本组原生膜。

2 px ring + 原 multigrid 严格复现旧误差；改 1 px ring 或充分收敛 SOR 使两自然图退步。独立私有数组和 output clamp 修复之后，只有 50% 核心域同时改善两自然并保持合成。完整阈值 sweep 保留在 soft-domain-diagnostic.json；它没有给 Photoshop Diffusion 数值造一个标量映射。

## 原生 50% 核心依据和首版无限定候选（历史）

`measure-patch-native-weak-alpha26.ts` 直接比较固化 native bytes：浅木纹 coverage 1–127 共 90 像素、老木纹共 125 像素，在显式 Diffusion 1/5/7 中实际改动均为 **0**；coverage 128–254 两图分别 85/111 像素，均有实际修补（老木纹 D1 其中 110）。因此核心阈值不仅降低指标，它纠正原生未修改而旧核修改的像素域。

首版无限定候选仅在 `preparePatch` 启用内部 `selectionCoreThreshold:128`。邻域 harmonic 的角色由此原生核心重建，核心内实际 coverage 和 opacity 仍各混合一次。默认 threshold1 保持 Healing Brush 完全原样，完整255覆盖 Patch 字节结果不变。所有 coverage<128 RGBA 保留原字节；若整块选择无128核心则回退旧 soft 预测，以免薄/低峰选区静默丢操作。此回退是兼容策略，尚待 feather/低峰的新增原生 probe 验证，不能称与 Photoshop 一致。ROI 16MP source / 4MP working / 120M work、取消、锁和 RGB16/HDR 显式拒绝不变。

| 数据（均已公开研究） | D5 旧 harmonic MAE / Max | 50% core MAE / Max |
|---|---:|---:|
| 浅木纹不规则 AA | 1.218065 / 23 | 1.206097 / 14 |
| 老木纹不规则 AA | 6.024618 / 99 | 3.142408 / 39 |
| 合成整数矩形 | 0.189286 / 1 | 0.189286 / 1 |

当时测量区分旧核、首版128候选及被拒空间候选；最终脚本现明确区分 legacy-harmonic（归档旧核）、unrestricted-core-128（归档首版无限定128）、sharp-aa-core-128（最终 preparePatch）、exterior-spatial-tone（被拒候选），不把新核误称旧基线。两自然图已经用于该研究，下一独立照片必须另采。

`tests/patch-core-mask-alpha26.test.ts` 增加独立 synthetic 的127/128阈值、一次 soft coverage/opacity、隐藏RGB/alpha、透明/取消/预算、全软低峰/孤立软峰、默认 Healing Brush 字节兼容，以及真实 Editor Source/Destination 同路径预览/提交、幂等、Undo/Redo、save/reopen。与原生 integrity 及既有定向回归共 **56/56**，typecheck 通过。它是源级工程证据，尚不代表本机新版包或独立自然效果验收。

第三张此前未读取的 CC0 自然图由根代理负责采集；另准备 `generate-patch-probe-alpha26.ts` 生成 256×192 项目自写纹理，输入 SHA 72412ad7d2e9bc12902ecdd71d3416181d149c47e0d741df06e7dd583ea9d155。`photoshop-patch-probe-alpha26.jsx` 在 owned fresh copy 上运行固定 offset[-92,40]、healSmoothFactor5 的 irregular-AA / feather4 / 6×6 feather8 三组，并存储原生 alpha selection 后生成 exact mask。此前没用这组纹理选参数。等待根代理执行，失败/无历史必须原样记录，不能从验收移除后算成功。

## 原生脚本入口故障的只读排查（历史，已恢复）

根代理实际 Browse 新脚本后无 entry 文件/alert，新第三自然图第一轮仅有 D1 后 File.copy 失败；这不是完整原生 cohort，也不能计独立效果通过。静态检查 execution-check 有/无 target 两文件均纯 ASCII、无 BOM/NUL/CR、0644；Node vm 语法解析通过只证明现代JS解析，不代替 Photoshop ES3 实际执行。输入仍存在且权限正常。本项目 JSX 未重定义 app/File/Folder/alert/$，未设置 targetengine、$.level/flags 或原型；$.global 只含 alphaXX 自有状态。PS进程已加载 ExtendScript 和 ScriptingSupport；1秒只读 sample 中主线程处于正常应用事件循环、BridgeTalk线程wait，没有脚本执行或调试器栈。这不能证明内部引擎状态正常，也不能断言缓存/权限/污染就是根因。

[Adobe官方扩展入口说明](https://developer.adobe.com/photoshop/)仍区分 JSX ExtendScript 与 PSJS UXP，不能改后缀到 psjs 就假定同一脚本可跑。安装的 Photoshop.sdef 另有 do javascript 命令，但本代理未调用该入口，也没有重启或改用户首选项。新增 entry-throw.js 仅为根代理可选的无File/app访问第一句throw诊断，未执行。

[File API规范](https://extendscript.docsforadobe.dev/file-system-access/file-object/)表明 copy 返回布尔值，File.error 才有详细原因；旧失败日志只有手写 generic error，因此无法从现有证据归因。probe已去掉每轮 ExtendScript File.copy：Node generator预写三个独立owned物理输入，其encoded SHA全部95eb7b1609756bd525040a897f812934134dea630b85e6c0acc2ca7730b1065c，每次native打开不同输入并duplicate，随后只改副本。输入保留可重跑。元数据显式Unix lineFeed，freezer兼容实际发现的CR-only文件，避免漏掉history/error。


## 最终独立样本、软覆盖回归与限定修复

原生入口后来恢复：根代理确认 Photoshop 在19:58因 CoreAnimation TooManyOpenFiles 崩溃，安全重启并恢复用户文档后，脚本入口实际运行。此前新第三图仅D1成功后copy失败的首轮以及无entry/无历史执行均明确排除；它们是历史失败，不是完整cohort。恢复后第三图显式 healSmoothFactor 1/5/7及原生mask、程序AA/feather4/低峰三组均完整采集、hash/history核验并固化，不能再写作待采集。

第三照片为Bango Textures的CC0 [Wood Texture Background](https://commons.wikimedia.org/wiki/File:Wood_Texture_Background.jpg)，330×220；选区顶点[[185,80],[220,78],[234,101],[222,133],[192,138],[174,111]]，offset[-110,30]，Normal Source、Transparent false。原生mask由Photoshop自身选区填充得到，未使用产品rasterizer。原图decoded SHA为ccc4bce43376330460250690ecf2d91bf6e8a82ef0a5825e13866c995d427196，mask SHA为d5a6cea651cb2fb7a8bee47c019057390cd0087c633c781deeabf8f1ff6613b7。

新增自制程序纹理256×192，含各向异性细纹、低频照明、暗纹及待修补对象，decoded SHA为72412ad7d2e9bc12902ecdd71d3416181d149c47e0d741df06e7dd583ea9d155。三个物理owned输入在生成时预写，每轮从干净输入打开并编辑副本；真实native选择分别为不规则AA、相同多边形feather4、6×6矩形feather8（mask最大20），固定offset[-92,40]及healSmoothFactor5。原生选择先在原owned副本储存alpha通道，复制后显式load，避免依赖duplicate隐式保留选择；无用户文档参与。

首版无限定128候选在第三图仍改善，但程序羽化证明其适用域过宽：锐利AA弱coverage1–127原生改动0/77；feather4弱覆盖原生实际修改991/1760，孤立soft峰20原生修改890。无条件忽略弱覆盖会漏掉真实羽化操作，即使MAE看上去更低也不能晋级。最终版本只在可保守识别的锐利AA域用128：selection.feather或任一shape.feather非零直接旁路；无显式羽化的baked raster，只要有弱覆盖像素在一像素八邻域内没有>=128核心，就拒绝核心规则并回退旧路径。没有任何有效128核心也回退旧路径。弱像素邻域判断内联到既有有界ROI扫描，每次检查记入120M work预算，拒绝后短路，逐行检查取消，没有另增无预算全图扫描。

这一判定是保守推断，不是Adobe内核公式；它保护宽软域并保留锐利AA边界改善，不会证明Diffusion 1–7或所有灰度mask效果一致。默认Healing Brush仍为阈值1；完整255选择保持旧字节路径；核心内coverage与opacity只混合一次，选区外RGBA和alpha保留；16/HDR继续显式拒绝而不量化。

所有七组D5精确coverage内RGB误差如下。Max是单通道byte最大差；各组均已核对原生及产品选区外RGBA变化0、alpha变化0。变化像素数记录用来防止以漏编辑降低MAE。

| 数据 | 旧核 MAE / Max /变化像素 | 无限128 MAE / Max /变化像素 | 最终限定128 MAE / Max /变化像素 | 原生变化像素 |
|---|---:|---:|---:|---:|
| 浅木纹（已研究） | 1.218065 / 23 / 2618 | 1.206097 / 14 / 2554 | 1.206097 / 14 / 2554 | 2556 |
| 老木纹（已研究） | 6.024618 / 99 / 3703 | 3.142408 / 39 / 3585 | 3.142408 / 39 / 3585 | 3585 |
| 合成整数矩形 | 0.189286 / 1 / 2569 | 0.189286 / 1 / 2569 | 0.189286 / 1 / 2569 | 2574 |
| 第三自然木纹 | 2.038695 / 37 / 2737 | 1.264435 / 21 / 2641 | 1.264435 / 21 / 2641 | 2641 |
| 新程序不规则AA | 1.352256 / 12 / 1351 | 1.782872 / 10 / 1295 | 1.782872 / 10 / 1295 | 1289 |
| 新程序feather4 | 3.569717 / 35 / 2358 | 1.432834 / 18 / 1240 | 3.569717 / 35 / 2358 | 2223 |
| 新程序孤立soft峰20 | 0.935062 / 4 / 488 | 0.935062 / 4 / 488 | 0.935062 / 4 / 488 | 890 |

**程序AA平均误差退步1.352256→1.782872；不能把最大差12→10和修改域更接近原生等同于全部效果通过。** feather4最终恢复旧核字节行为，修掉本批新增的弱域漏编辑回归，但仍有MAE3.569717/max35及变化像素2358对2223的残差。孤立soft峰也只是保留旧行为，488对890表明仍未达到原生效果。第三图D1/D7旧核MAE3.316109/2.545730，最终为2.535056/1.411693，max34/40变28/16；这是同一本地核对不同原生参考的测量，不是本地实现了各Diffusion档位。

独立性记录：第三图和程序probe均在首版无限定128生产核冻结后才交付结果；最初评估是独立新输入。其结果随后公开，仅用于上述通用软域安全纠正，没有再拟合sigma、阈值、供体几何或扩散参数。**最终限定版本因此是公开后回归验证，不称完全未见的盲留出**。老木纹早已公开用于研究；measurement JSON保留原始首次独立采集分类，本节披露后续使用阶段。

## 最终工程验证与复现

`tests/patch-core-mask-alpha26.test.ts` 最终7条加上native integrity7条和既有保护/ROI/历史/保存44条，共58/58通过，日志artifacts/alpha26-patch-sharp-core.log。新增检查对Source/Destination、adaptation0与0.7、opacity0.5，验证显式global/shape羽化、baked宽软域、低峰回退与旧核字节一致；另外证明锐利分类邻域计算占用预算且取消不改asset。已有检查覆盖opacity0、阈值边界、隐藏RGB/alpha、Healing Brush字节兼容、预览/提交同路径、幂等重试、Undo/Redo、save/reopen及高位深显式拒绝。根代理另报告统一源码1955项通过；打包运行验收由根代理维护，本研究记录不代替实际包门槛。

冻结生产SHA：src/core/patch-edit.ts为7b3554eaef807967a7c4104dde9814a6ade1b500dfc3429b801709e1569ace46，src/shared/sampled-healing.ts为f066a6c374569e5268f3be5622860f592dc4a3b93e45e4de936a8b096cd23532。最终measure-patch-natural-alpha26.ts四模型报告均位于artifacts/photoshop-native/measurements/patch-alpha26/，逐组stdout日志为artifacts/alpha26-patch-final-*-measure.log。新增合法持久fixture为photoshop-27.11-patch-natural-third-independent-alpha26.json及photoshop-27.11-patch-independent-{irregular-aa,irregular-feather4,isolated-soft-peak}-alpha26.json；失败cohort、旧不生效GUI参数和被拒空间模型仍保留，不并入成功参考。
