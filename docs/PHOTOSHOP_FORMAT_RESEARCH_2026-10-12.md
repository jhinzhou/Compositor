# Photoshop 文件格式与可编辑结构研究

日期：2026-10-12。范围：PSD/PSB RGB16/32、颜色管理、智能对象、文字、矢量及图层样式。性质：阶段 1 只读研究与开发建议。本次仅增加本文，没有修改产品、依赖或运行 GUI；真实 Photoshop 作者语料由主流程另行生成。

## 结论与证据边界

当前 `.comp` v12 PNG16、v13 EXR 与高位深工具已完成 alpha.16 的统一验收；**PSD/PSB 通道链仍然是 RGB8 编辑与输出，RGB16 导入明确量化，RGB32 导入拒绝**。这两个能力必须分别表述。已有高位深合成和持久化可用于下一批接入，但不能由此推导复杂 Photoshop 文件兼容。当前统一验收范围见 [alpha.16 报告](HIGH_DEPTH_ALPHA16_ACCEPTANCE_2026-10-12.md)。

截至本次只读研究，不将新 Photoshop 作者语料计入已通过数量。旧语料中的 ImageIO 层 RLE 坏包是异常输入证据；ag-psd 自行生成并自行读取是项目回归；手写通道是独立格式 oracle；OpenEXR/浮点 TIFF 的独立编码器是其各自编码证据。上述均不能代替 Photoshop 创建、重开、修改、重算的实际验收。已有来源分类见 [C2 语料报告](PHOTOSHOP_CORPUS_C2_2026-10-10.md)。

后续每项功能分别记录：**读取结构、保存结构、用户可编辑、同图重算外观、精度/颜色**。不能用一个“支持 PSD”勾选项代替这五类结果，也不能给出无定义的“兼容率百分比”。

## Adobe 官方资料核验

Adobe 公开格式规范定义 PSD v1 / PSB v2、8/16/32 通道深度及 Raw、RLE、ZIP、ZIP prediction。高位深层信息涉及 `Lr16` / `Lr32`；部分 PSB 长度字段为 64 位，RLE 行长度也有区别。层透明通道与用户蒙版/real mask 需分开；ICC 资源为 1039。文档的合成预览位于独立区段，不能代替图层重算。该规范描述存储结构，并不承诺公开 Photoshop 的全部渲染解释或算法。[Adobe PSD/PSB 格式规范](https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/)

Adobe 当前 32-bpc 支持页（2026-10-06 更新）列出 PSD/PSB 的图层支持，也列出 HDR 下有限的工具与调整集合。它列出 15 个混合模式；本项目当前 HDR 合成支持其中 6 个。因此不能把 PSD32 接通后的目标定义为“所有 RGB8 的功能自动可用”。[Photoshop 32-bpc HDR 功能支持](https://helpx.adobe.com/photoshop/desktop/adjust-color/hdr-and-channel-manipulation/features-that-support-32-bpc-hdr-images.html)

Photoshop 的 Assign Profile 保持数字并改变解释，Convert to Profile 改变数字以尽量保持外观；转换还涉及引擎、意图、黑点补偿与抖动。Preserve Embedded Profiles 与 Convert to Working Space 是不同策略。直接丢弃 ICC 后标记 sRGB 不等价于色彩转换。[更改颜色配置](https://helpx.adobe.com/photoshop/desktop/adjust-color/color-profiles/change-a-documents-color-profile.html)、[颜色管理策略](https://helpx.adobe.com/photoshop/desktop/adjust-color/color-profiles/color-management-policy-options.html)

智能对象保留源内容和可重复的变换；嵌入对象与链接对象依赖关系不同。光栅化会失去原有对象变换/滤镜的可编辑性，嵌入则把源内容装入文档。这些语义决定了仅保留显示像素不能称为支持智能对象。[Adobe 智能对象说明](https://helpx.adobe.com/vn_en/photoshop/using/create-smart-objects.html)、[嵌入链接对象](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/smart-objects/embed-linked-smart-objects.html)

字体缺失时 Photoshop 有激活或替换流程；因此字体身份、字体可用性和替换决定都需要纳入文字验收。矢量蒙版是与分辨率无关的路径；光栅化后不能直接恢复为原路径。图层样式具有轮廓、扩展、混合、全局光等属性，外观对齐需要这些语义而不仅是同名按钮。[缺失字体处理](https://helpx.adobe.com/uk/photoshop/desktop/text-typography/select-manage-fonts/replace-missing-fonts.html)、[矢量蒙版](https://helpx.adobe.com/photoshop/using/masking-layers-vector-masks.html)、[图层样式选项](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/apply-layer-effects/layer-style-effects-and-options-overview.html)

## 当前项目差距矩阵

以下是当前源码核验结果，不是沿用旧版状态。旧 [格式能力表](PHOTOSHOP_FORMAT_SUPPORT.md) 标记 alpha.10；其 PSD 适配边界仍可参考，高位深工程的能力应读本次 alpha.16 报告。

| 能力/行为 | 当前真实入口与行为 | 差距及下一步边界 |
| --- | --- | --- |
| RGB16 层像素读取 | `photoshop-io.ts` 允许深度 16；`pngFromPixels` 将 `Uint16Array` 除以 257 再写 PNG8；manifest 固定 v11 | 应改为保留 straight RGBA16 的原始样本编码，另建 premultiplied Uint16 工作层；不能以 PNG8 代理作为编辑输入 |
| RGB16 保存 | `encodePhotoshop` 固定 `bitsPerChannel: 8`；固定 ag-psd writer 明确拒绝非 8 位写入 | 需真实 16 位通道 writer/受限适配，不能只改 header 或库的类型声明 |
| RGB32 PSD/PSB | header 明确拒绝，Float32 的现有 `.comp` 能力未进入此链 | 需按真实作者通道验证数值空间/透明关联与传递函数，再接 HDR asset；不得把所有 Float32 无条件解释为当前 encoded extended sRGB |
| 蒙版精度 | 原 PSD16 蒙版也经过 `pngFromPixels`，项目原生蒙版是 PNG8 灰度 | 第一批要么扩展深度蒙版模型，要么保留未编辑的源通道并明确蒙版编辑降为 8 位；“RGB16 无损”不得包含被量化蒙版 |
| 通道解码/压缩 | Raw/RLE 8/16 有边界校验，16 RLE 预展开解决固定库问题；ZIP 路径未获得同等完整验证 | 增加 bounded ZIP/prediction、实际层 block 选择、重复/重叠/截断拒绝；现有 RGB16 RLE 补丁不能代表 ZIP32 已通过 |
| PSB 大文件 | 版本 2 可读写，但产品边长 30,000、单文件 512 MiB；工作/工作区预算另有限制 | 继续明确 PSB 容器支持与超大文档支持不同；首批只做预算以内的 PSB16/32，后续 tile/streaming 才讨论扩容 |
| ICC/工作空间 | PSD adapter 没有读取/保存/转换 ICC 1039；转换 manifest 直接写 sRGB | 色偏风险优先处理。首批识别、保存 source profile 与工作 profile，支持验证过的 RGB matrix/TRC 转换；LUT/CMYK 等先拒绝或明确预览导入，不假标 sRGB |
| 智能对象 | `skipLinkedFilesData: true`；有像素回退时转换普通像素；不保存 `placedLayer` 和嵌入源 | 从源数据不可变保存、对象身份和只读预览开始；再做双击编辑、替换源、实例同步。首批不处理 AI/PDF/RAW 私有解释与任意智能滤镜 |
| 文字 | 横排基础文字与 UTF-16 font/color run、点/框文字可导出 TySh；未编辑高级描述符可保留；导入像素用于回退 | 字体度量、基线、框换行、抗锯齿、warp、竖排、路径/OpenType 仍不同。文字编辑需明确能力范围和字体替换，不能由描述符保留推导视觉一致 |
| 基础形状与任意矢量 | 矩形/均匀圆角/椭圆可编辑；任意路径/描边保留部分描述符及像素回退，修改像素/几何后原描述符失效 | 先支持 cubic path、填充规则、boolean 组合、描边，再做路径编辑与矢量蒙版；不要把 raster fallback 当成可编辑路径 |
| 图层样式 | 六类基础样式：投影、内阴影、描边、颜色叠加、外/内发光；通常单实例、Normal 效果合成 | 多实例、轮廓、spread/choke、居中描边、不同效果混合与复杂样式缺失；斜面/缎面/渐变/图案保留但不重算；高位深可见效果当前拒绝 |
| 高级合成 | 隔离 Normal 组显示为 pass-through；独立 Fill/effect opacity 无等价实现；Blend If 不完整；剪贴仅特定连续兄弟堆栈 | 先做组隔离、Fill 与 Opacity 分离和组蒙版/剪贴组合；这些会影响所有复杂文件，优先级高于增加更多样式名称 |
| 调整层 | PSD adapter 当前转换八类；复杂 Gradient Map 等被拒绝转换或跳过并报告；alpha.16 原生调整集合更大 | 参数映射与渲染核分别验收；unsupported source adjustment 不能静默消失，严格模式应拒绝或显式使用合成/像素降级 |
| 文档资源/未知结构 | 只保存 DPI、参考线、全局光和少量层元数据 | 额外 alpha/spot channels、命名选择资源、画板、图层复合、混合范围、未知块没有整体保真保证；需按资源类别预算化保留与失效规则 |

源码定位：[`photoshop-io.ts`](../src/core/photoshop-io.ts)、[`photoshop-channel-validation.ts`](../src/core/photoshop-channel-validation.ts)、[`photoshop-editable.ts`](../src/core/photoshop-editable.ts)、[`photoshop-vector.ts`](../src/core/photoshop-vector.ts)、[`photoshop-effects.ts`](../src/core/photoshop-effects.ts)、[`photoshop-metadata.ts`](../src/core/photoshop-metadata.ts)、[`photoshop-adjustments.ts`](../src/core/photoshop-adjustments.ts)。当前依赖 `node_modules/ag-psd/dist/psdWriter.js` 的 `bitsPerChannel other than 8 are not supported for writing` 是写入阻点；不要修改 node_modules 作为交付。

HDR 的混合模式差距可精确界定为本次目标集合中的 **9 项**：Dissolve、Darker Color、Lighter Color、Subtract、Divide、Hue、Saturation、Color、Luminosity。当前六项已实现，不能重新列为未实现。这个 9 项计数只是 HDR 合成的该集合，不是整个 Photoshop 的功能差距数量。源码：[`hdr-composite.ts`](../src/core/hdr-composite.ts)。UNORM16 合成已支持项目的普通混合模式集合，但仍拒绝可见高位深图层效果与未烘焙的矢量蒙版；源码：[`deep-composite.ts`](../src/core/deep-composite.ts)。

当前颜色能力也不是“完全没有”：HEIF 的 RGB matrix/TRC 和浮点 TIFF 的线性矩阵配置已有受限转换，EXR primaries 可实际变换；但 PSD 并未调用这些转换。复用时需重命名中性的错误描述、保留不支持配置的拒绝，并验证 16/32 精度；不得把现有 8 位曲线 LUT 无条件应用于 float。源码：[`foreign-color.ts`](../src/core/foreign-color.ts)、[`hdr-tiff.ts`](../src/core/hdr-tiff.ts)、[HDR 编码边界](HDR_CODEC_REFERENCE.md)。

## 分批开发方案

以下按 AI 连续执行的验收批次安排，不用“人日”表示。每批结束产出源码、独立 fixtures、桌面/MCP 动作证据和明确支持表；下一批以统一 gate 通过为前提。

### F1：PSD/PSB RGB16 像素与 profile 基础

1. 增加不分配像素的 header/resource/channel preflight，按实际深度、bbox、block、压缩、PSB 长度计预算；同时计原文件、raw/expanded、working、display、worker transfer、历史与多文档资产，不只看文件大小。
2. 将现有 16 位读入保留为真正 PNG16 asset，原 straight 样本与不可变编码分开保存；复用 v12、公开深度字段、Undo/Redo 和深度编辑，但蒙版的独立精度规则必须显式。
3. 开发受限 16 位 writer。第一轮输出 Raw 可便于规范 oracle；再加压缩，准确写深度层区段、透明/蒙版、PSD/PSB 的长度与合成。普通 RGB8 回归继续走既有稳定路径。
4. 首批 profile 策略：已知 sRGB 与验证过的 RGB matrix/TRC → 工作 sRGB；源 profile/转换报告仍保留。未标记文件必须有明确默认策略。非支持配置严格拒绝；完整 document-preserve-profile 编辑引擎留到 F3。
5. 支持表先限定普通 RGB16 光栅层、坐标、可见、opacity、支持混合、组与已支持剪贴。没有高位深样式/未知结构重算能力的文档不得标为完整兼容。

退出条件：Photoshop 作者 RGB16 PSD 和 PSB 能读取 → 元数据编辑 → `.comp` 保存/恢复 → 16 位 PSD/PSB 导出 → Photoshop 重开；通道深度真实 16、未编辑不经过 display PNG8、明确蒙版/profile边界，拒绝操作不改变文档/history/source hash。

### F2：PSD/PSB RGB32 与 HDR 通道

复用 Float32 working 与 v13 source，但先通过 PS 作者样本确定 PSD32 的通道编码、profile、alpha 约定和合成透明标识；扩展 Raw/ZIP/prediction32 及 Float32 writer。原始 32 位通道作为 source 保留，解码/编码只在明确的边界进行传递函数转换。拒绝 NaN/Inf、不能表达的 alpha-zero emissive 和无法解释的配置，不 clamp 后伪称保真。

首轮限定普通 RGB32 光栅层和当前 HDR 支持堆栈；metadata-only 不重算 source；像素编辑/合成/导出的 Float32 误差分别测量。第一批应优先 Exposure/Levels、Normal/Multiply/Linear Dodge，再增加已通过的其他组合。HDR 显示仍是独立 SDR 预览与 EDR 设备验收，不能从文件值 >1 推导屏幕 HDR 已实现。

退出条件：负值、>1 高光、低 alpha、跨传递函数存储的实际样本无 8 位中转；输出由 Photoshop 重开并测 raw/reference 值。显式降低位深可 undo；任何不支持混合/效果/资源有可见原因，原工程保留。

### F3：完整 profile 模型与基础复杂合成

先统一 `sourceProfile`、`workingProfile`、输出 profile 和转换记录，避免一个 `colorSpace: 'sRGB'` 同时代表源与工作颜色。新文件格式模型需要版本迁移和旧文件兼容。实现 Assign/Convert 两条明确操作：Assign 不变数字；Convert 转换样本且可 undo。基于真实 sRGB/Adobe RGB/Display P3/线性 profile 样本验证 matrix/TRC；LUT/CMYK/Lab、多意图/黑点补偿/soft-proof 应另立评估批次，不能冒充 Adobe ACE 等价。

同时先补隔离组、Fill opacity 与 layer/effect opacity、组蒙版/剪贴、Blend If 的支持/拒绝。这些基础行为统一后再增加效果核，否则单层样式通过仍会在综合文档失败。

### F4：智能对象源保留与受限编辑

第一轮只读保存嵌入源 bytes、source hash、对象 ID、实例关系、placement/warp 与未知滤镜结构，加预算/循环/坏嵌入文件检查；保存/export 不应恢复已失效 source。第二轮做 PNG/TIFF/受限 PSD/PSB 源替换与内部子文档编辑，关闭子文档后刷新所有实例，支持 Undo/Redo。链接对象首批只能用户明确选择重新链接；不自动读取任意文件路径、不网络解析外部链接。

AI/PDF、Camera Raw 参数、第三方插件滤镜与复杂 warp 先保持只读结构和原预览，显示边界。用户选择光栅化后另建普通层，不继续标记为可编辑智能对象。扩展源结构保留需避免把大对象塞入当前 4 MiB manifest JSON，可用受预算保护的独立附件模型。

### F5：文字、矢量和效果重算

文字先匹配同一已安装字体、横排点/框文字、UTF-16 run、字号/基线/leading/tracking 和换行；选择明确字体替换，不静默改变。路径/竖排/warp/OpenType 等另立支持级别。矢量先路径 cubic/闭合/填充规则、基础 stroke 与 mask组合，再添加节点编辑；独立矢量蒙版必须能变换、密度/羽化且保持路径。

效果先把单实例投影/描边/叠加的核和 alpha/Fill 语义对齐，再补 multiple、contour、spread/choke、center stroke 与 gradient overlay，最后研究 bevel/pattern/satin。每种效果在 8/16/32 的支持范围分开，不能在高位深先 rasterize8 后仍显示完整支持。

## Photoshop 作者语料与统一验收

语料需要由真实 Photoshop 生成并记录来源，不能在本项目写出同格式后当作作者输入。可从自制网格、渐变、透明边缘和彩色色块开始，无需用户业务图片。保存时记录 Photoshop 版本/OS、文件深度/模式、document profile、字体 PostScript 名/版本、颜色设置、是否最大兼容、文件 SHA256、操作序列及参考输出。只读输入保持不可变；项目输出另存。

| 样本族 | 建议作者内容与重复操作 | 必须验收的结果 |
| --- | --- | --- |
| P16-A/B | RGB16 不透明非 257 倍数梯度、1/半/极低 alpha，PSD 与预算内 PSB | 原通道深度与样本；导入未量化；保存重开；metadata-only export 同位深 |
| P16-C | 两个像素层 + 16 位 mask / 灰度渐变 + 越界 mask patch | alpha 与 mask 分开；mask 深度/默认值/位置；密度/羽化是否原值或显式降级 |
| P16-D | 高位深 crop/resize/paint/undo；奇数尺寸、翻转/缩放 | 操作前后 source不变、Undo恢复、导出通道真实16；变换后的透明边无halo |
| P32-A/B | Photoshop RGB32 PSD/PSB；RGB >1、低 alpha，与作者 EXR参考 | 数值空间解释正确；高光未截断；Float32 单独误差报告；文件不是16位替身 |
| P32-C | Exposure/Levels + Normal/Multiply/Linear Dodge，透明背景 | 调整结构和数值；PS重算与项目各层/合成差异；unsupported堆栈原子拒绝 |
| C-PROFILE | 相同数字分别 Assign sRGB、Adobe RGB、P3；另建 Convert版本 | Assign数字不变且外观改变；Convert数字改变且视觉对齐；输出ICC与实际数字一致 |
| C-UNTAGGED | 无配置、坏ICC、LUT/CMYK及超预算资源 | 明确默认/拒绝；无假sRGB；不发布半个工程；后续正常导入仍能执行 |
| SO-EMBED | 嵌入PNG与PSD/PSB对象；两实例；缩小后放大；替换内容 | 源hash/bytes可导出；对象身份与实例同步；替换后PS重开可双击编辑 |
| SO-LINK | 用户选定链接源，移动/删除后重开，再明确重新链接 | 缺失链接提示；不得无授权路径解析；对象source不被静默光栅替换 |
| T-RUN | 中英混合/emoji、多font/color UTF-16 runs，点/框，tracking/leading | 内容、run范围、字体身份；换行/基线/几何；编辑与未编辑各自重算 |
| T-ADV | 同字体缺失、竖排、路径、warp | 源结构保留或明确拒绝；替换需明确；不靠缓存截图假通过 |
| V-PATH | 闭合cubic、孔洞/多子路径、stroke、矢量mask与raster mask共存 | 路径结构/填充规则；缩放后仍可编辑；mask组合；边缘单独误差指标 |
| FX-BASIC | 六类样式 + Fill/Opacity分离 + 全局光 + 低alpha | 参数、层样式图标/PS可编辑；PS重新计算后外观与alphabounds |
| FX-COMPLEX | 两个投影/描边、spread/contour、中心stroke、gradient/bevel | 按支持等级拒绝或保留，不丢实例；编辑相关组件后原描述符不复活 |
| MIX-GROUP | 隔离/穿透组、clip、mask、文字/形状/FX/adjustment组合 | 层序、可见、剪贴基底、group隔离；逐层与整体参考，实际重算不能只看merged |

### 固定验收动作与比较方式

1. **PS → 项目**：打开原作者文件，记录 warnings/支持级别/每层 bbox 与深度。不要只比较截图；直接验证通道和 mask；原文件 SHA256不变。
2. **项目元数据编辑 → `.comp` 保存/Save Copy/恢复/Undo/Redo**：改名、隐藏、移动后验证 source引用/bytes和回退结构，跨文档复制保留对象身份语义。不能靠重新导入原文件恢复。
3. **项目导出 → PS**：真实 PS 打开输出，检查深度/ICC/字体/层类型/对象内容；再执行该结构的实际编辑，例如文字改一个字、对象替换内容、效果改半径、路径移一个节点。仅显示 merged preview 不算通过。
4. **强制验证重算**：在独立副本上使用能触发对应层重算的操作并撤销、切换效果/可见状态、重新编辑结构，再导出 PS reference。不要破坏原作者文档来制造证据；不同效果应记录具体触发步骤。
5. **数值与外观分开**：8/16 精确数据只在约定未编辑 raw通道/不涉及颜色转换的路径要求相等。低 alpha 的 straight→premul→straight 本身会舍入，未编辑输出要从保留原 straight 来源取值；edited/composite用最大误差、均值、不同样本计数、alpha单独统计。32位传递转换报告绝对/相对/ULP与值范围，不伪称所有 Float32逐位不变。
6. **共同颜色参考**：双方 reference 用同一明确 profile 转到同一空间，记录 intent；SDR用PNG16/TIFF16作reference，HDR用作者EXR/floatTIFF与曝光档位参考。EDR截图、屏幕色温或系统截图的色彩标记不等于源浮点样本。
7. **视觉参数**：原尺寸逐像素比较，以及100%文字/路径/透明边局部图。使用差异热图、最大/平均RGB误差、alpha误差、bbox/位移、换行一致性；SSIM或截图相似不能掩盖少数高光/细线/字符缺失。每种算法预先定义门槛，不事后挑阈值。初轮报告测量值，尚未得到作者reference前不宣布统一像素误差≤1。
8. **失败原子性与资源**：坏包、超预算、未知配置/结构、取消/超时、失效worker均不得发布部分assets/改变history；检查失败后普通导入正常。所有原文件与source retained在预算内，worker传输/暂存/显示缓存与工作区历史共同计量。

### 两类保真不能混写

“元数据没有改”时源编码可保持，但重新写 PSD 容器不一定逐字节一致，时间/压缩/索引都可能变化。验收应比较 source通道、source对象bytes、描述符语义与文件深度，文件hash不同并不必然错误；同一个原始PSD hash也不能证明用户修改被保存。

“像素修改后的导出”需要单独测量数学/颜色/浮点误差。本项目 FLOAT EXR 的已测传递往返存在 Float32 舍入，这一事实同样提醒 PSD32 不能无测量承诺逐位等价。高位深在内存存在并不等价于 Photoshop 的颜色/合成/效果核相同。

## 必须明确拒绝或经用户显式降级的情况

- 32 位样本存在 NaN/Inf、无法表达的透明关联、未知/不支持的颜色解释；禁止 clamp后无提示继续。
- 不支持的模式/profile、组合蒙版、smart/filter/未知结构缺少可靠raster fallback；严格可编辑导入应拒绝，不能把该层删掉继续声称完整导入。
- 高位深 source要经过8位图层效果、剪贴板、合并/盖印、All Layers采样或其他未保深路径；保持原层并提示可选择显式降深/光栅化。
- 层/蒙版长度、bbox、压缩展开、PSB64位值不合法或超总预算；拒绝而非尝试巨量分配。
- 嵌入对象路径循环/越预算、未选择的外部链接、需要外部私有格式/plugin的重算；不自动解引用，不声称可编辑。
- 用户编辑了原组件后，旧高级描述符与新像素不一致；作废相应 source组件，不能数值改回后自动复活。Undo按历史恢复原组件是另一条合法路径。

明确降级可以提供“保留原文件 + 合成预览作新图层”或“转8位/光栅化”的动作与报告；必须说明损失哪些结构/精度，不能静默替代正常读入。

## 本批交付与后续验收状态

本批完成官方资料研究、当前源码差距核验、F1–F5边界和作者语料方法。没有新增产品实现或宣称 Photoshop运行通过。主流程的真实PS作者语料一旦完成，应另存独立provenance/acceptance报告，逐项更新本矩阵。Windows运行、HDR/EDR硬件输出、未验证的Photoshop结构继续保留独立gate。

同日后续 Stage3 源码准备已经加入 bounded RGB16 PSD/PSB 导入及真实 Photoshop 27.11.0 plain pixel 作者语料。具体数值、手工 PSB provenance、8 位 mask/写入边界以及资源交接见 [RGB16 导入参考](PHOTOSHOP_RGB16_IMPORT_REFERENCE_2026-10-12.md)。它更新了本研究初稿的 F1 读取现状；统一实际运行验收仍由主流程单独记录，不能据此把 RGB32 或完整复杂 PSD 编辑标为通过。
