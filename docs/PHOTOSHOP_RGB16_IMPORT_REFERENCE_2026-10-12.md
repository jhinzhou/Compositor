# Photoshop RGB16 PSD/PSB 导入参考与边界

日期：2026-10-12。源码阶段交付，统一运行验收由主流程另外记录；本文件不代表 Windows、复杂 PSD 完整可编辑性或 RGB32 PSD 支持通过。

## 实现

`photoshop-io.ts` 的 RGB16 导入直接读取原始层通道，按大端 uint16 解释 Raw、PackBits/RLE、ZIP、ZIP prediction。PSB 使用其实际通道长度与行长度字段。`photoshop-channel-validation.ts` 在展开前校验尺寸、行表、包边界、重复通道、输出长度与压缩流尾部。原始 PSD/PSB 和通道 buffer 不进行原位字节交换。

输出 canonical PNG16 保存解码后的 **straight RGBA16**；工作 `deep` 为 premultiplied sRGB RGBA16，`displayBytes` 为单独的 PNG8 代理及独立哈希。原始低 alpha/alpha=0 的 RGB 不通过工作 premultiplied 值重编码；仅做元数据编辑时，工程保存、Save Copy 和 Undo/Redo 继续保留原始 PNG16 bytes。工作 premultiply 本身存在整数舍入，不能宣称工作值与原始 straight RGB 相同。

含真正 RGB16 图像资产的工程版本为 v12。8 位 PSD/PSB 读取和写入路径保留既有行为。尚未编写 RGB16 PSD/PSB writer：直接输出仍明确拒绝，必须对独立副本显式执行图层转 8 位后使用现有 writer。Photoshop raster mask 当前转换为 8 位灰度；导入报告明确说明此边界。

ICC1039 在解码前从资源块读取。仅接受已验证为 sRGB 等价的 matrix/TRC 配置；不做颜色转换。不支持、冲突或损坏的 profile 明确拒绝。没有嵌入 ICC 的文件保留数值并给出“按 sRGB 解释、未进行转换”警告；这是一项显式颜色解释，不能称为颜色转换通过。ICC 识别沿用 PNG16 入口的 matrix/TRC 容差。

## 独立作者语料

目录：`fixtures/photoshop-corpus/photoshop-27.11.0-rgb16/`。输入为项目自制合成图片，无用户照片及第三方图片。`provenance.json` 记录实际来源、文件字节数、SHA256、通道压缩以及日志；fixture 复制后不修改原文件。

| 实际作者输出 | 深度、结构 | 核对结果 |
| --- | --- | --- |
| `rgb16-layered.psd` | Photoshop 27.11.0；RGB16；两层 | 原始四通道均为 ZIP prediction(3)，与作者 `rgb16-identity.png` 完全一致 |
| `rgb16-layered-rle.psd` | 同版本；RGB16；两层 | **名称不是压缩证据**；实际仍为 ZIP prediction(3)，同样完全一致 |
| `precision-rgb16-layered.psd` | 同版本；65×33；两层 | 每层与作者 `precision-rgb16-identity.png` 的 8,580 个值完全一致 |
| `precision-rgb16-native.psb` | 同版本；手工 Save As Large Document Format；65×33；一层；版本 2 | 四通道均为 ZIP prediction(3)，与作者 PNG16 的 8,580 个值完全一致 |
| `rgb8-layered.psd` | 同版本；RGB8；两层 | 读入像素与作者 PNG8 一致，既有 8 位 writer 回归通过 |

上述 4 份 RGB16 层文件累计比较 **2,647,180 个通道值**，最大误差 0。数值 oracle 用 `node:zlib` 与独立大端逐行差分恢复，不调用产品解码函数或 ag-psd 像素解码器；ag-psd 仅定位原始通道。各导入资产 canonical PNG16 再与作者参考比较，premultiplied 工作值按独立标量公式验证。

补充日志中的 `LargeDocumentFormatSaveOptions` 构造失败保留为真实 FAIL，**不是 PSB 通过记录**。PSB 来自主流程另行操作真实 Photoshop Save As 窗口，选择大型文档格式并勾选最大兼容性；该手工操作的 provenance 单独记录。

不能把 PS 自己生成的参考误称为原输入逐位不变：65×33 输入 `precision-rgba16.png` 到 PS `precision-rgb16-identity.png` 的 8,580 个值中，有 6,530 个变化，最大差 2，平均绝对差约 1.14697。导入保真比较对象是 **PS 已保存文件实际通道** 与其作者参考；没有对这一 Photoshop 内部读取/保存误差作额外补偿。PNG 文件 uint16 范围也是完整 0..65535，未对文件通道误做所谓内部 0..32768 范围的再次放大。

独立字节语料补充 Raw/RLE/PSB 行长度、NOP、隐藏 RGB、坏压缩流等分支。这些是 Adobe 规范语料，不冒充 Photoshop 原生 RLE 作者样本。尚无 RGB32、复杂智能对象、文字重排或组合效果的本批作者兼容性证明。

## 资源与失败原子性

RGB16 路径额外启用 pinned ag-psd 的 strict mode 与 handler 错误传播：损坏源不能通过其 permissive readBytes 的补零分配路径发布部分层树。8 位路径保持原设置。parser resource buffers 预留并限制为 64 MiB；源编码与完整 backing store、已经生成的资产 backing stores、当前通道/PNG/显示缓冲共同进入 512 MiB 图像工作预算。共享 backing stores 去重计量。它是图像数组/编码缓冲预算，**不等于 Node 全进程 RSS 或所有 JavaScript 对象堆的精确上限**；独立 worker 的 JS 堆限制仍是另一层约束。

组或调整层蒙版的小 patch 可能铺满整个文档。该整面扩展在 PNG 创建前检查，不能仅按 patch bbox 或在创建后检查。恶意通道声明、超尺寸、坏行表、膨胀压缩流、重复通道与未知颜色解释均拒绝，已有文档不发布部分资产。

主流程还需统一处理 controller 暂存 snapshot、跨 worker 克隆、manager 重解码副本和现有工作区历史 **同时存活** 的总预算。解码模块的单次 512 MiB 限制本身不能证明这些并存副本已经合计；交接复查已明确提出该缺口，统一 gate 需以主流程修复和对应行为测试为准。

## 测试与运行交接

`tests/photoshop-high-depth-import.test.ts` 覆盖实际作者文件与哈希、独立通道数值 oracle、透明边、RGB8 回归、元数据 Undo/Redo、工程 Save/Save Copy/reopen、manager 接收、显式降深后写入、坏 ZIP/声明通道长度、整面组 mask 预算与 profile 拒绝。

`scripts/smoke-photoshop-channel-import.ts` 已更新为真实 Electron/main/codec worker/protocol 检查：错误报告取消后正常导入，canonical PNG16 与显示 PNG8 的独立哈希，元数据 Undo 保留原始资产，实际 Save/Save Copy/reopen 保留 v12 和每层 source hash。此 subagent **没有执行 GUI 或产品 build**。主流程可以分别使用默认独立 RLE 输入和实际 PSB 路径运行该脚本，运行记录另行归档。

基础格式、长度/大端与 PSB 字段依据：[Adobe Photoshop File Formats Specification](https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/)。压缩与位深数值兼容性结论以这里实际作者文件和独立通道验证为证据，不从格式文档推断算法完全等价。

## 主流程后续统一接入

跨进程预算缺口已由root接线：main保留snapshot的完整backing字节、worker接收副本/readonly preview与clipboards及已有文档历史，统一进入manager preflight；6项独立budget测试通过。真实桌面默认RLE16、PS作者PSD16与手工PSB16导入/取消/Save/SaveCopy/reopen，在开发与alpha.17 macOS ARM64目录包均通过。最终证据见 [alpha.17统一验收](PHOTOSHOP_ALPHA17_ACCEPTANCE_2026-10-12.md)，上文子任务未执行GUI属于交接时状态，不代表当前主流程未运行。
