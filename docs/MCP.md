# MCP 协议与编辑闭环

当前实现：0.3.0-alpha.29，应用协议版本 2，固定 MCP SDK 2.3.1，stdio 传输。SDK 调用和 `2025-11-25` 初始化兼容模式均有真实桌面验证。内置 OpenAI-compatible/Anthropic 对话与外部 Agent 共用下列真实工具；用户实际服务另行配置。

## 工具与文档路由

| 工具 | 输入与用途 |
| --- | --- |
| `app.get_capabilities` | 空对象；读取版本、12 个工具、混合模式和资源限制 |
| `document.list` | 空对象；返回 activeSessionId、documents 和 retainedPixels |
| `document.get_state` | 可选 sessionId；省略时查活动标签，显式传入时查指定打开实例 |
| `document.preview` | sessionId、expectedRevision、可选 maxDimension；返回真实 PNG 和坐标信息 |
| `document.apply` | 文档身份字段、可选 taskId、action；一次图层操作 |
| `document.apply_batch` | 文档身份字段、可选 taskId/label、actions；1–100 个动作原子提交 |
| `history.undo` | 文档身份字段和 transactionId；仅撤销当前顶部事务 |
| `task.begin` | 文档身份字段和 label；建立绑定当前文档实例的任务 |
| `task.get_status` | sessionId、taskId；读取任务状态、revision 和已提交事务 |
| `task.cancel` | sessionId、documentId、taskId、idempotencyKey；停止后续编辑 |
| `task.finish` | cancel 的字段，加 state: completed/failed、可选 message；结束任务 |
| `history.undo_task` | 文档身份字段和 taskId；撤销历史顶部连续属于此任务的全部事务 |

“文档身份字段”是 sessionId、documentId、expectedRevision、idempotencyKey。UUID 使用工具返回的真实值；documentId 对应 manifest.documentID。同一个工程打开两次，documentId 可以相同，sessionId 不同。切换活动标签不改变显式 sessionId 请求的目标，也不让后台编辑自动切换标签。关闭或恢复文档后，旧 session 失效。

任务对象包含 taskId、sessionId、documentId、label、startedRevision、revision、state、transactions、startedAt、expiresAt 和可选 message。状态为 running、completed、cancelled、failed 或 undone。任务保存在当前文档实例内存中，最多 200 条；每文档最多一个 running 任务，预算 5 分钟。任务过程中人工编辑仍可提交，后续 Agent 请求必须使用新的 revision。

## 原子批操作与引用

所有请求经过认证的本地桥和 utilityProcess 串行权威服务。批操作先在工作副本上执行、校验，再一次提交。任何动作失败都不保留部分图层、资源、revision 或历史。成功时 revision 和历史各增加一次。

```json
{
  "sessionId": "当前打开实例 UUID",
  "documentId": "manifest.documentID",
  "expectedRevision": 12,
  "idempotencyKey": "本次提交唯一 key",
  "taskId": "可选任务 UUID",
  "label": "Group decorations",
  "actions": [
    { "type": "group.add", "name": "Decorations", "clientRef": "folder" },
    { "type": "layer.move", "layerIds": ["第一个实际图层 UUID", "第二个实际图层 UUID"], "parentId": { "ref": "folder" }, "beforeLayerId": null }
  ]
}
```

上例中的说明字符串需替换为真实 UUID。新建组、空白层和复制动作允许 clientRef；后续动作的 layerId、parentId、beforeLayerId 或 layerIds 元素可写 `{ "ref": "名称" }`，只引用之前创建的对象。名称以英文字母开头，随后为字母、数字、下划线或短横线，最多 80 字符；同批名称必须唯一。返回 createdIds 映射。

动作包括图层/文件夹基础操作、像素/蒙版编辑、选区、画布、内容、调整与效果。准确字段以工具发现的 Zod JSON Schema 为准，源定义在 `src/shared/contracts.ts` 与 `src/shared/pixel-contracts.ts`；不能给未支持的字段或自行猜测 ID。

| 动作族 | 用法与提交规则 |
| --- | --- |
| layer.paint / fill / gradient | 文档坐标、颜色/灰度、opacity/target；paint 可含 smoothing、flow、pressures、pressureSize、pressureOpacity；pressures 与 points 数量相同，一笔一事务；gradient 可含 opacity/target |
| layer.set_lock | layerId、lock: all/position、locked；祖先文件夹继承保护，UI/MCP/后台提交共用校验 |
| layer.retouch | kind: clone/spot-heal/heal/blur/smear；sourceMode、aligned、sourceAnchor/sourceOffset、healingMode、smearMode、blurRadius、smoothing；All Layers 先捕获真实合成，后检查 revision 再提交 |
| selection.* | set/invert/wand/color_range/from_alpha/from_mask/modify（expand/contract/feather）/translate/transform_pixels/subject 等；选区以形状或受限 raster runs 表示，不写进原版工程 |
| selection.transform_pixels | 原始 layerId、transform，可选四角 corners；切出的像素合回同一个图层、边缘可扩展，移动选区覆盖并一次撤销 |
| layer.mask* / set_clipping / copy_mask / copy_effect | 创建/绘制/羽化/placement/link/enable 与剪贴源；copy_* 用真实 sourceId，effect 仅复制指定种类 |
| layer.text / shape | 保存编辑结构并生成 PNG 回退；缺字体阻止文字改写；四角扭曲提交后栅格化 |
| layer.filter / adjustment.add / adjustment.set / layer.effects | 经过 schema 的 filter/adjustment/effect 参数，支持选区与原子历史；精确 type 名称以发现结果为准 |
| document.* | canvas/image size、crop/trim、flip/rotate 等；尺寸预算与中间工作预算都可能拒绝 |

`selection.from_mask` 新增 `coverage: visible/hidden`，省略仍默认 `hidden`，保持现有 MCP 黑区阈值行为；要按 Photoshop 白区/灰度载入，请显式使用 `visible`。`selection.from_alpha` 与 `from_mask` 均支持 `operation: replace/add/subtract/intersect`。界面操作配置不改变省略参数的 MCP 含义。

`selection.subject` 新增 `edgeMode: native/color` 和 `feather: 0–20`。`native` 保留灰度细化；`color` 使用源 RGB 引导边缘。二者仍受 U²-NetP 初始识别结果限制，不表示完整发丝恢复。

`layer.set_lock` 允许解锁再编辑的原子批；锁定写入返回 INVALID_ARGUMENT，不保留部分修改。全锁禁止像素、蒙版、外观和破坏性结构编辑；位置锁禁止显式位置/变换写入。读取、载入选区、复制、重命名和切换可见性仍可用。对齐/中心分布由多个 set_transform 原子动作表达；视图旋转仅属于界面，MCP 坐标始终为未旋转文档像素。合并和盖印目前通过桌面命令实现，没有在这轮新增相应 MCP 工具。

`selection.subject` 和 `layer.content_fill` 是长作业，`apply_batch` 不接这些异步操作；通过单动作提交并携带 taskId。MCP 本地请求最长 135 秒，内置客户端单工具 150 秒；任务总期限仍为五分钟。超时后先读任务/文档，不把超时当成零提交证据。

layer.set_blend 支持原版 24 模式，准确字符串与顺序通过 app.get_capabilities.blendModes 获取。layer.duplicate 支持文件夹及整树，新 ID/parentID/PNG 文件名重映射、内容字节保留。group.ungroup 的 layerId 必须是文件夹；直接子项在原组位置提升到父级，丢弃组自身外观，与原版一致；均可单步撤销。批内 clientRef 代表复制后的根对象，不表示自动创建每个后代的可命名引用。

layer.move 的 parentId 为目标文件夹 UUID 或 null；beforeLayerId 为目标父级下插入位置的下一兄弟 UUID 或 null。manifest 按底到顶绘制，null 表示该父级最上方。保留所选根对象的绘制顺序和子树；选择文件夹及其后代时避免重复移动。循环归属、移动到自身子树、落点属于所选子树或不在目标父级内，都在提交前拒绝。

结果包含 status、previousRevision、revision、transactionId、undoable，可含 createdIds。无实际内容变化返回 no_change，不增加 revision，不清空重做历史。文件夹按原版 pass-through 语义绘制，祖先透明度逐层相乘；当前只允许 Normal 文件夹混合。

## 任务、停止与回退

1. 读 capabilities、目标 state 和 preview，确定实际图层 ID。
2. task.begin，保留返回的 taskId；每次 apply/apply_batch 带上它和最新 revision。
3. 检查工具结果，再读 state 和 preview；完成后 task.finish。
4. 停止时 task.cancel。它不要求 expectedRevision，因为不会改变文档内容；它阻止后续任务编辑，已经提交的内容保留。
5. 需要撤销本轮时，读最新 state 后调用 history.undo_task。只有整个任务的事务连续位于历史顶部时才允许；后续人工编辑会返回 UNDO_CONFLICT。

一个短批提交不会从中间取消。取消和提交串行竞争时，先提交的批保留；客户端再查询状态确认结果。Subject/Object/内容填充使用独立可取消子进程；task.cancel 会中止所属未提交长作业，已提交的事务仍保留。内置 Agent Stop 同时取消流式请求与当前任务。整轮回退后，人工重做按原任务批次顺序恢复。历史截断、人工先撤销任务中的某一批等情况不能自动穿过回退。

running 任务存在时，其他 Agent 写入必须携带该 taskId，否则 TASK_BUSY。结束、取消或超时的任务不接受新的写入，返回 TASK_STOPPED。同一个已成功请求仍可按原 key/参数重试，获得已提交结果，不产生第二次修改。

## 坐标与预览

transform.origin 是未旋转矩形左上角的文档像素坐标；size 为宽高，最小 1 px。rotation 为绕中心顺时针旋转的度数；flipX/flipY 也绕中心。sampling 为 High quality、Smooth、Nearest。多层/文件夹共同移动、缩放、旋转、翻转由同一批叶图层和带蒙版文件夹 set_transform 表达。Shape 尺寸变化会预先重绘并原子提交；移动/旋转与文字变换保留源 PNG，遵循原版规则。

预览长边最多 2048 px，不放大小文档；返回 image 内容和 width、height、canvasSize、scale、revision、previewId。仅可请求最新 revision，过期返回 SNAPSHOT_EXPIRED。快照绑定 session 和不可变资源哈希，不混入后续参数。

文档坐标：`xDocument = xPreview × canvasSize[0] / width`，`yDocument = yPreview × canvasSize[1] / height`。scale 是宽度比例，整数舍入时高度比例可能略有差异。

## 重试与错误

| 错误 | 含义与处理 |
| --- | --- |
| REVISION_CONFLICT | 文档已改；重读 state/preview，重新规划，用新 key |
| SESSION_EXPIRED | 文档关闭、替换或恢复；重新查询 document.list |
| DOCUMENT_NOT_FOUND | 工程身份和 session 不匹配 |
| IDEMPOTENCY_CONFLICT | 同一 key 被用于不同参数，修正客户端调用逻辑 |
| DOCUMENT_BUSY | 目标正在字段编辑/拖动，或存在预览冲突；等待并重读 revision |
| UNDO_CONFLICT | 目标不再完整位于历史顶部，保留后续人工操作 |
| TASK_BUSY / TASK_STOPPED / TASK_NOT_FOUND | 查询任务状态，不能绕过运行或终止状态继续写入 |
| RESOURCE_LIMIT | 文档、资源或动作超限；失败保留既有状态 |
| INVALID_ARGUMENT / INVALID_PROJECT | 参数、引用或层级无效；批失败零提交 |
| APP_NOT_RUNNING | 启动桌面应用，使用当前连接路径 |
| TIMEOUT / REQUEST_TIMEOUT | 结果可能未知；先查 task/state，再用完全相同 key 和参数重试 |

revision 单调递增，撤销/重做也递增。幂等记录存在于当前 session 内存，最多 512 个请求；重启或超出缓存窗口后不承诺去重。历史最多 100 步。

## 连接与文件边界

点击标题栏终端图标或 View → Agent / MCP，复制应用生成的配置。打包版 command 为应用自带 Electron 可执行文件，args 指向 app.asar 内 server.cjs 和用户目录 automation.json，env 设 ELECTRON_RUN_AS_NODE=1，无需另装 Node。

automation.json 含随机 loopback 端口和 token。stdio 服务每次读取它，向 127.0.0.1 的受限 RPC 发送请求；桥验证 token，拒绝带 Origin 的浏览器请求，请求体最多 64 KiB。UI 不显示 token，工具不返回 token。macOS 文件权限 0600；Windows ACL 尚待最后阶段验收。

MCP 不开放任意文件路径、shell 或 JavaScript。导入、保存、导出由桌面文件入口执行。renderer 使用 sandbox、contextIsolation、关闭 Node 集成和 CSP。内置 Agent 提供流式对话、真实工具调用、前后预览、Stop 与整轮撤销；工具名称会在厂家协议边界映射成合法函数名，并在调用时恢复实际 MCP 名称。模型须支持 tool calls，看图须支持图像输入。配置与密钥通过应用设置，密钥用 Electron safeStorage 加密、不会放进 MCP 配置。


## 当前能力与工作预算

app.get_capabilities 返回精确版本、24 blendModes、批/任务/历史限制和 limitations。单边30,000、单表面200MP、10,000层、512MiB资产、4MiB manifest、8个标签；实际保留像素预算按照物理RAM/16限制在200–800MP，计入打开文档与100步历史（相同字节哈希去重）。视口最大16MP，选中像素变换64MP，Subject/Object32MP。RAW/HEIF/TIFF另有解码工作预算，不能由画布上限推断它们一定可处理200MP。

识别采用离线U2NetP，与原版Vision不同；大半径模糊和部分插值不承诺全部图像逐像素相同。完整 codec/字体/原生Windows边界通过 capabilities.limitations 明示。

## alpha.9 灰度选区与蒙版属性

新增 `selection.paint`（points/size/hardness/opacity/value/initial/flow/pressures 等）、`selection.fill`（value/opacity）、`selection.save_named`、`selection.load_named`、`selection.rename_named`、`selection.delete_named`、`layer.mask_properties`（density 0–1、feather 0–250 源像素）。均通过现有 `document.apply` / `document.apply_batch`；预览不提交历史。命名选区加载 operation 为 replace/add/subtract/intersect。

Quick Mask 是界面状态，Agent 可直接操作灰度选区；未命名的选区是会话状态，需要持久化时使用 save_named。mask_properties 不重写 PNG，撤销和保存重开保留属性。限额和使用边界见 [alpha.9 验收说明](PHOTOSHOP_COMMON_ALPHA9_ACCEPTANCE.md)。


## alpha.11：实验性边缘细化

`document.apply` 新增 `selection.refine_edges` 动作，UI 与外部 Agent 共用真实辅助进程和事务提交。参数：`layerId`、`output`（`selection` / `mask` / `new-layer`）、`boundaryRadius` 1–40（默认4）、`sampleRadius` 1–64（默认16）、`guidedRadius` 1–40（默认2）、可选原图整数 `region: [x,y,width,height]`、`strokes: [{value:0|128|255,size:1..512,points:[[x,y],...]}]`。最多256笔、总计10000点；必须普通不透明栅格层，原图≤32MP。

初始覆盖优先当前选区，否则读取现有有效蒙版；两者都没有则拒绝。0=背景、255=前景、128=未知；源像素坐标不随缩略图变化。selection输出保留灰度；mask显式替换旧蒙版（清旧密度/羽化/独立位置/矢量覆盖参数）；new-layer复制源图像并加新蒙版，原图PNG保留。锁定、revision、task与幂等均沿用现有规则；取消实际终止辅助计算，不提交半成品。

这是编码sRGB局部颜色实验工具，没有自动去杂色或完整发丝质量保证。低对比、缺少前景/背景样本和颜色变化时会保留回退覆盖；不要把结构验收或合成测试描述为Photoshop自然发丝等效。UI草稿/source/readonly-preview只开放本地编辑器；Agent调用的是上述已验证的事务动作。上游 `.comp` v12 8-bit兼容与16-bit转换要求见 capabilities；以上为alpha.11的历史限制；当前高位深动作以本文alpha.16/18段落和capabilities为准。

## alpha.13 高位深精度规则

v12 工程 PNG16 sRGB 资产公开 `bitDepth:16`、`pixelFormat:rgba16-premultiplied-srgb`、原始 `hash` 和独立 `displayHash`；公开状态不包含像素缓冲。`document.apply` 的 layer.filter 支持 levels/curves/exposure/invert/hsl/blackWhite/colorBalance/gradientMap，layer.retouch 支持 kind:blur + this-layer image，计算直接使用 RGBA16。选区混合、撤销与保存保留高位深，显示预览仍为 PNG8。

其他深度像素编辑及高位深调整图层创建会返回 UNSUPPORTED_FEATURE，原子 batch 不产生部分历史或源修改。当前渲染导出为 8 位，exportPreview/exportAsDialog 返回 bitDepth:8 和 sourceBitDepth；保存 .comp 保留 PNG16。PSD 导出未实现高位深，明确拒绝。先读取 app.get_capabilities 再制定编辑计划；这不是 HDR/Windows 执行或 Photoshop 像素等价声明。


## alpha.16 上游同步与源精度（统一验收通过）

新增共享动作 `layer.convert_depth`，参数 `{layerId,bitDepth:8|16}`：明确执行8↔16以及HDR→16/8并可撤销。`state.assets` 的 `hash` 仍指原始源文件；普通高位深使用 `bitDepth:16,pixelFormat:'rgba16-premultiplied-srgb'`，HDR另带 `isHDR:true,pixelFormat:'rgba32f-premultiplied-extended-srgb'`。`displayHash`仅区分SDR显示proxy缓存，公开state不包含源像素。v12 PNG16和v13 EXR工程读写、Undo/Redo及内置缓存图层复制均使用保留源；HDR/RGBE/浮点TIFF和导出由桌面可信文件入口执行，MCP未新增任意路径权限。

八类深层调色及已支持的调整栈、paint/erase、fill/gradient/clear、this-layer blur/smudge/liquify与image_size接源数据；HDR Exposure保留超白高光。HDR合成当前为Normal/Multiply/Darken/Lighten/Linear Dodge (Add)/Difference；可见raster effects和不支持栈拒绝。其余高位深选中像素变换、修复/仿制/内容填充/栅格合并及盖印、all-layers retouch、像素剪贴板及PSD导出仍受精度保护；不支持操作返回UNSUPPORTED_FEATURE并保持源和历史。不得把旧RGBA8工具的显示结果作为HDR源提交。

Export As提供16位PNG和HDR EXR，旧quick PNG/JPEG/PDF及 `document.preview` 仍为8位SDR；HDR数据支持不等于HDR屏幕输出。EXR为平面scanline全分辨率HALF/FLOAT RGB(A)、NONE/RLE/ZIPS/ZIP，相同data/display window与方形像素；multipart/tiled/deep和其他压缩拒绝。浮点TIFF限定classic RGB(A) IEEE16/32/64 strips（chunky/planar）与NONE/LZW/Deflate。各种codec和高位深工作预算独立于200MP画布上限，先读 `app.get_capabilities.limitations`。

本段描述alpha.16代码接口，前述alpha.11/13限制段落是对应版本的历史快照。开发版与未签名macOS ARM64目录包分别完成5组114项实际检查，含真实MCP stdio共享动作/Undo；1,162项源码检查及旧10组桌面回归通过，见[alpha.16统一验收](HIGH_DEPTH_ALPHA16_ACCEPTANCE_2026-10-12.md)。这些证据不等于Windows、EDR或Photoshop操作/像素等价，也不是已签名正式发布。参考[上游差异及当前范围](UPSTREAM_F5AE5BA_DELTA_AUDIT_2026-10-12.md)。

alpha.16 `layer.filter` 已开放全部19个现有滤镜类型的UNORM16/HDR源，数据源不读取PNG8 display proxy。Gaussian/Motion/Bloom及独立HDR Lens直接浮点空间计算；旧字节滤镜通过四/十探针重建，HDR版本normalize/restore与上游相同但会丢弃负色。HDR Camera Raw的非中性geometry（含Guided校正）、distortion、profileDistortion及chromatic shift拒绝，先用独立 `lensCorrection`。Dither保高位深属于扩展，不是上游bit-depth等价。32MP/512MiB及500M卷积操作预算先预检，Camera Raw需更多scratch。独立C桥参考与portable callback范围见[参考矩阵](HIGH_DEPTH_FILTER_REFERENCE.md)；开发版和未签名ARM64目录包的实际运行/MCP检查已通过，见[统一验收](HIGH_DEPTH_ALPHA16_ACCEPTANCE_2026-10-12.md)。

`adjustment.add` / `adjustment.set` 在支持的高位深栈中开放12类：八类调色以及Grain/AddNoise/Gaussian/Motion。Normal Gaussian/Motion真实卷积RGBA，在同尺寸网格按mask×opacity四通道插值；nonNormal blur与Gaussian Preserve Transparency恢复原target alpha。UI/MCP共用核心动作和compositor。最终开发版和未签名ARM64目录包分别通过HDR19项、上游UI10项、deep composite15项、deep tools18项及双语布局52项，共114项，包含真实MCP stdio。目录包不是签名正式发布；[统一验收](HIGH_DEPTH_ALPHA16_ACCEPTANCE_2026-10-12.md)记录版本与范围。UI剪贴板用进程内ClipboardItem mock、数字native-paste adapter模拟，不证明系统pasteboard集成或外部模型验收。

## alpha.17 显式栅格化与源保真

`document.apply` / batch支持 `layer.rasterize {layerId}`，只转换有有效fallback的editable text/shape层，保留encoded源/位深/transform/mask/effects，可Undo。直接对editable text/shape执行image paint/retouch/gradient会拒绝，先显式转换再绘画；mask和Quick Mask不转换文字。UI提示和MCP/Agent共用core guard；两次动作不被虚报为一个stroke。

RGB16 PSD/PSB导入保存真正PNG16源和RGBA8显示，工程v12 Undo/Save/reopen保留source hash。已验证sRGB-equivalent或明确说明的无profile输入；未知ICC/RGB32拒绝。PSD export仍8位，高位深需显式convert_depth或保存.comp。HSL普通明度与曲线端点现按真实PS参考修复，有符号HDR Exposure有意偏离上游负值clip。能力与限制见 [alpha.17](PHOTOSHOP_ALPHA17_ACCEPTANCE_2026-10-12.md)；不要把alpha.16 C/Swift数值核参考当作当前所有PS效果等价。

## alpha.18 原生效果与高位深绘画

`layer.paint`、`selection.paint` 新增可选 `brushModel: photoshop|compositor` 和 `spacing: 0.01..10`（间距/直径比，0.25=25%）。Photoshop模型的100% Flow与其他Flow共用按间距落点；Hardness 0使用经32/48/64 px原生参考核验的柔圆尾部。省略model/spacing保留旧动作行为。`opacity/hardness/flow`继续为0..1，界面的百分比不改变API数值。

几何选区和 `selection.modify` 可选 `featherModel: photoshop|compositor`；Photoshop模式幅度对应原生研究，未声明模式保留旧模型。混合历史参数先保留原覆盖再操作；命名选区是最终灰度覆盖。

RGBA16/HDR paint/erase直接合成源样本，不经PNG8 proxy重建；8位覆盖和蒙版精度仍是限制。工具的RGB16原生量化、硬圆/中等硬度和部分低Flow间距仍有误差，不能称完全PS等价。详见[原生效果研究](PHOTOSHOP_ALPHA18_NATIVE_EFFECTS_2026-10-12.md)与[验收](PHOTOSHOP_ALPHA18_ACCEPTANCE_2026-10-12.md)。

## alpha.19 画笔模型与蒙版边界

显式`brushModel: photoshop`使用统一实测硬圆边缘及像素对齐dab，弧长/Spacing保持连续；旧Compositor/未标记模型不变。`selection.from_mask`的visible路径保留显式PSD外围白/灰覆盖；蒙版属性/滤镜/位置编辑会使原参数快照失效，Undo保留原源。机器命令继续允许连续高位深Opacity，不模拟原生工具的8位比例量化。原生效果与真实stdio验收见[alpha.19](PHOTOSHOP_ALPHA19_ACCEPTANCE_2026-10-12.md)。


## alpha.20 蒙版模型与非破坏裁剪

`layer.mask_properties` 新增可选 `featherModel: "photoshop" | "compositor"`、`featherEdgeMode: "clamp" | "default"`。省略参数保留工程已有模型；PS模式的完整文档蒙版使用clamp边界，有限patch使用default。模型和边界是可逆工程属性，保存、撤销、复制均保留，缓存包含这两个值。不要把显示PNG8当作RGB16／HDR编辑源。

`document.crop` 可显式传入 `deleteCroppedPixels:false`，保留完整源像素并平移图层与蒙版；负坐标扩回画布可重新显示裁剪外像素。省略该参数兼容原有保留语义。`true` 尚未实现，返回 `UNSUPPORTED_FEATURE` 且不修改文档；不要重试成隐式破坏裁剪。UI裁剪调用明确传false。原生实测、误差范围及统一验收见 [alpha.20验收](PHOTOSHOP_ALPHA20_ACCEPTANCE_2026-10-12.md)。

## alpha.21 拉直与透视裁剪

`document.straighten` 接收 `angle`（度，±45）和可选整数 `crop:{x,y,width,height}`。旋转围绕当前画布中心，完整源像素不改变；传入裁剪框后平移所有图层/蒙版 placement、命名选区和画布。UI绘制水平或垂直参考线，以最近90度方向自动计算纠正角度及内接框。

`document.perspective_crop` 接收顺序四角 `corners:[[x0,y0],[x1,y1],[x2,y2],[x3,y3]]`、整数 `width/height` 与 `sampling`（High quality/Smooth/Nearest）。四角依次对应输出左上、右上、右下、左下，必须为非退化凸四边形。逆单应映射在像素中心采样，各图像保持RGBA8/16/Float32源精度；会改变栅格资产，Undo恢复源。输出尺寸由调用方明确给定，不等同Photoshop私有自动估算。

专用透视裁剪对未栅格化文字/形状返回 `RASTERIZATION_REQUIRED`；对组、调整层、效果、辅助线、非零属性羽化蒙版等尚不能正确投影的元数据返回 `UNSUPPORTED_FEATURE`，原子保持工程。尺寸、内存和重采样工作预算可能返回 `RESOURCE_LIMIT`；不要用隐式flatten/降位深绕过错误。具体误差与验收见 [alpha.21](PHOTOSHOP_ALPHA21_ACCEPTANCE_2026-10-13.md)。

## alpha.29 工具栏动作与工具状态

工具数量仍为 12、应用协议仍为 2。新能力通过现有 `document.apply` / `document.apply_batch` 的严格 action schema 公开；所有普通像素动作使用真实 session/document/revision/key，一笔一事务，共用 UI 的处理内核。动作可用并不代表 Photoshop 私有效果已完全还原。

| 动作 | 字段与实际边界 |
|---|---|
| `layer.paint` / `selection.paint`，`tip:'pencil'` | 硬像素 Pencil 的独立 tip；其余 points/size/opacity/pressure/target 规则保留。图像 8/16/HDR、蒙版和 Quick Mask 都走原数据链。Flow/软边不是 Pencil 的原生选项。 |
| `layer.bucket_fill` | layerId、point、color、tolerance 0–255、contiguous、antialiased、opacity、sampleAllLayers。支持新空白层；单层编辑保留 8/16/HDR 数据，All Layers 先取修订检查的 RGB8 合成并拒绝含高位图层的 merged 取样。限 16 MP/512 MiB。Foreground/Normal 当前可用，Pattern/full blend modes 未实现。 |
| `layer.tonal_brush` | layerId、kind: dodge/burn/sponge、points/size/hardness、amount 0–1、range: shadows/midtones/highlights、protectTones、mode: saturate/desaturate、vibrance；可带 smoothing/flow/spacing/pressures。只改变命中 RGB，alpha 和未命中 samples 不改；8/16/HDR 可用。色调响应为便携近似。 |
| `document.history_source` | operation: capture/select/clear；capture 可带 label，select 必须带 sourceId。是工具状态，成功返回 no_change，普通 revision/Undo 不增加；`document.get_state().historyBrush` 提供 sourceId/snapshots。打开/导入有 Initial state。工具源与图像编辑不可混在同一个 batch。 |
| `layer.history_brush` | layerId、显式 sourceId、kind: history/art-history、points/size/hardness/opacity、artSize 2–128、smoothing/flow/spacing/pressures。sourceId 必须为当前选中快照，源/当前 canvas、layer、grid、placement、precision 须匹配；快照保留在会话预算内，重开后重新初始化。Art 为局部源色块近似。 |
| `layer.mixer_brush` | layerId、points/size/hardness/opacity、wet/load/mix/flow 0–1、color、spacing/smoothing、cleanAfterStroke/loadAfterStroke、colorPickup: average/tip、protectAlpha、可选 reservoir。8/16/HDR 与空白层可用，4 MP/120 M 工作预算。实际 wet-paint 近似，不宣称 PS 湿混合内核等效。 |

Mixer 的 `reservoir` 是 `{premultipliedColor:[r,g,b,a],paintRemaining}`，是显式请求快照。成功结果的 `mixerReservoir` 是下一快照；Agent 可在下一笔传回它。preview 返回的颜料变化只属于预测，取消不安装；同 key 的幂等重试返回同一事务和同一 reservoir，不再消费颜料。缺省 reservoir 则按请求 color/load 建立一次载入。像素 Undo 恢复像素，颜料属于独立工具状态。

History 源可以这样使用，身份字段每次取当前工具返回值：先独立调用 `document.apply` 的 `{type:'document.history_source',operation:'capture',label:'Before retouch'}`，再读取 `document.get_state().historyBrush.sourceId`。修改图像后用新 expectedRevision 提交 `{type:'layer.history_brush',layerId,sourceId,kind:'history',points,size,hardness,opacity}`。如果 source 已选择到别的快照，旧 sourceId 会拒绝，不能默默换源。

## alpha.29 Frame 与贝塞尔路径

| 动作 | 数据、提交与兼容范围 |
|---|---|
| `frame.create` | name、kind: rectangle/ellipse、bounds:[x,y,width,height]；支持 clientRef，在成功 batch 的 createdIds 中回传真实 layer ID。持久化 frame 边界与独立 clip mask；不是普通 Shape 改名。 |
| `frame.place` | layerId 为 frame、sourceId 为真实 raster donor、fit: cover/contain；保留完整源像素和深位，donor 不被改。可在同一个 batch 中以 `{ref:'frameRef'}` 引用之前新建 frame。 |
| `frame.set_bounds` | layerId、bounds、可选 kind；更新 frame clip 边界，不将 content placement 强制同步缩放。 |
| `frame.set_content_transform` | layerId、transform；只移动/变换框内图像，frame 边界保持不动。 |
| `document.path_set` | 可选 pathId/name、path；不提供 pathId 则建立新记录并从 manifest.vectorPaths 读取真实 ID。提供 ID 编辑已有路径，已有 linked vector masks 会重新生成；修改不能绕过 mask 所在层的锁。 |
| `document.path_delete` | pathId；删除路径记录是一笔普通事务。已保存 vector mask 的几何和像素不会被悄悄删除，Undo 恢复路径记录。 |
| `selection.from_path` | pathId、operation、antialiased；在文档坐标把闭合路径转换成真实 coverage，并与当前选区组合。 |
| `layer.path_fill` | layerId、pathId、color；按 path 与当前 selection 的交集填充真实图像，保留此前选区。 |
| `layer.path_mask` | layerId、pathId；保存路径几何并建立可渲染 mask；当前 frame 已使用独立 clip mask，不能覆盖为 vector mask。 |

path 数据为 `{fillRule:'nonzero'|'evenodd',subpaths:[{id,closed,knots:[{id,point:[x,y],inHandle?,outHandle?}]}]}`。控制柄和节点都是文档坐标；最多 64 个 subpath/4096 个 knots，ID 在同一路径内必须唯一。节点/柄在工程中保持可编辑，A 的 Path Selection 移动整条路径，Direct Selection 编辑单个节点/控制柄，Shift+A 轮换；两者最终都以 document.path_set 提交真实几何，转换像素使用有界 cubic flattening。复杂 Boolean、完整 PS vector/PSD 排版与 Art/Mixer 原生效果仍属明确未对齐范围。

Frame/place、path 和其他普通动作可批量原子提交；任何后续动作失败都不保留前面临时建立的 frame、mask、path、assets、revision 或历史。新增工具不取消既有锁、位深、内存、busy、revision 和 idempotency 保护。

`smoke-packaged-mcp-alpha29.ts` 保留既有 6 项实际 app.asar/stdio/12-tools/protocol/task/selection/mask/refinement 验证，追加上述工具的真实 action、像素预览、sourceId、cache、reservoir、createdIds、单次 Undo、失败 batch/错误参数不损源检查。宿主 `smoke-packaged-alpha29.ts` 启动独立临时 profile 后调用该 client。实际安装包执行结果由最终验收报告记录；runner 源码和内部测试不能自行宣称打包 gate 或原生像素等效。
