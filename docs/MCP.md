# MCP 协议与编辑闭环

当前实现：0.3.0-alpha.3，应用协议版本 2，固定 MCP SDK 2.3.1，stdio 传输。SDK 调用和 `2025-11-25` 初始化兼容模式均有真实桌面验证。内置 OpenAI-compatible/Anthropic 对话与外部 Agent 共用下列真实工具；用户实际服务另行配置。

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
| layer.paint / fill / gradient | 文档坐标、颜色/灰度、opacity/target；paint 可含 smoothing，一笔一事务；gradient 可含 opacity/target |
| layer.retouch | kind: clone/spot-heal/heal/blur/smear；sourceMode、aligned、sourceAnchor/sourceOffset、healingMode、smearMode、blurRadius、smoothing；All Layers 先捕获真实合成，后检查 revision 再提交 |
| selection.* | set/invert/wand/color_range/from_alpha/from_mask/modify（expand/contract/feather）/translate/transform_pixels/subject 等；选区以形状或受限 raster runs 表示，不写进原版工程 |
| selection.transform_pixels | 原始 layerId、transform，可选四角 corners；切出的像素合回同一个图层、边缘可扩展，移动选区覆盖并一次撤销 |
| layer.mask* / set_clipping / copy_mask / copy_effect | 创建/绘制/羽化/placement/link/enable 与剪贴源；copy_* 用真实 sourceId，effect 仅复制指定种类 |
| layer.text / shape | 保存编辑结构并生成 PNG 回退；缺字体阻止文字改写；四角扭曲提交后栅格化 |
| layer.filter / adjustment.add / adjustment.set / layer.effects | 经过 schema 的 filter/adjustment/effect 参数，支持选区与原子历史；精确 type 名称以发现结果为准 |
| document.* | canvas/image size、crop/trim、flip/rotate 等；尺寸预算与中间工作预算都可能拒绝 |

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
