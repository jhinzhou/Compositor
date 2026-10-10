# 第二版开发与验证记录

日期：2026-10-09。版本：**0.2.0-alpha.1**。实施目录：`/Users/zhoujin/Documents/PS/Compositor_Electron`。

此页保留 alpha.1 基线记录。当前 alpha.2 和原版 1.4.8 补齐结果见 [新实施记录](UPSTREAM_1_4_8_IMPLEMENTATION_STATUS.md)。Mac 目录包现已更新为 alpha.2，旧 alpha.1 zip 保留。

本批已交付多文档、保存恢复、图层交互与 MCP 任务控制的可运行实现，并提供 Mac arm64 试用包。**第二版整体仍在开发**：内置模型对话、完整原版渲染对照、性能验收与 Windows 验收尚未完成。计划按 AI 执行批次更新，不再使用人工人日或工作周；本批未单独记录端到端执行耗时，不填未经测量的时间估算。

## 批次状态

| 批次 | 当前结果 | 剩余事项 |
| --- | --- | --- |
| M0 第一版基线 | 保留 src/package/桌面与打包 MCP 结果快照，复现原有行为 | 20 份原版图像样本尚未完成 |
| M1 多文档 | 新建/打开/切换/关闭，独立历史、视图与 session；8 标签和应用资源预算 | 完整大图内存/性能验收在 M6 |
| M2 保存与恢复 | Save、Save As、Copy、关闭/退出决策、外部修改冲突、保存日志、自动恢复 | Save As/Copy 仅限新目标；Windows 故障测试在 M7 |
| M3 原版交互 | Alpha 命中、多选、多层移动/属性/分组、真实层级拖拽；分组位置按原版源码修正 | 20 样本像素矩阵、采样差异和性能尚待验证 |
| M4 MCP 事务 | 12 个工具、批内引用、零部分提交、任务生命周期、取消、整轮撤销 | 内置模型调度在 M5；非短批像素工作尚不在支持范围 |
| M5 内置对话 | 用户已选指定模型服务，通用编辑任务层已准备 | API 地址、模型名和协议待提供；真实对话/图片/工具循环尚未交付 |
| M6 Mac 交付 | Alpha 包、真实打包 MCP、SHA256、回归记录 | 正式图标、完整功能与性能门槛、工具链审计处置未完成 |
| M7 Windows | 按用户要求延期到功能完成后 | 原生运行、DPI、文件系统、凭据与相同测试全待验收 |

## 本批功能

### 文档与视图

DocumentManager 以打开实例的 sessionId 路由，每个 Editor 独立保留工程 ID、revision、历史、幂等结果和任务。同一工程可打开两次；后台 MCP 请求不改变活动标签。关闭后句柄失效，恢复也生成新句柄。

每标签保留选择、多选、缩放、滚动、工具、Auto Select、比例锁和显示控制状态。最多 8 标签，应用资源预算以不可变资产哈希去重计 6400 万像素；当前/历史资源保守保留，关闭标签释放，当前 CanvasKit 解码缓存随资源与标签变化回收。解码/合成缓冲额外消耗尚未完成大图测量。

### 保存与恢复

Save 更新关联工程；Save As 切换关联；Copy 保留原关联和 dirty baseline。异步对话框捕获 session，切换标签不会改保存目标。Save As/Copy 当前仍要求新名称，不覆盖另一个既有工程。

既有包保存使用同卷完整暂存、回读验证、排他锁、内容指纹、旧包备份和用户目录日志。启动恢复验证内容指纹，安装完整旧版或新版；外部修改拒绝覆盖。已验证真实进程退出，不扩大为突然断电、网络盘或不遵守锁的第三方写入保证。

空闲 5 秒保存独立完整恢复副本，最多 32 份/512 MiB；达到上限显示错误，不静默丢弃既有草稿。启动发布完整临时副本、清理未发布的内部 UUID 半成品。恢复入口将副本打开为未保存的新文档，保留原工程。关闭和退出逐份 Save/Discard/Cancel；等待决策时禁止竞争编辑，Cancel 保留应用运行。

### 交互与任务

Auto Select 逆旋转/缩放/翻转到源像素并读取 Alpha，过滤不可见祖先和零有效透明度。多选操作使用统一批执行器；文件夹携带子树，选中父子不重复移动。文件夹插入共同父级的最高所选分支位置，子层保留绘制顺序；单选新建为空文件夹，邻接插入。

原版源码 `Compositor/Document/LayerGroups.swift` 已核对：文件夹是 pass-through，祖先 opacity 相乘，不能改成整体隔离合成。Electron 当前沿用这一语义；此源码核对不能代替完整 PNG 对照矩阵。

MCP 原有五工具继续支持，增加文档枚举、原子批操作、任务开始/状态/取消/结束和任务回退，总计 12 工具。每批最多 100 动作，一次 revision/历史，失败零提交；新对象用 clientRef/{ref} 引用。任务绑定 session，最多运行 5 分钟；停止拒绝后续写入，保留已提交内容。整轮撤销只允许任务所有事务连续位于历史顶部，不穿过后续人工操作。详见 [当前 MCP 协议](MCP.md)。

## 实际验证

| 检查 | 结果与实际范围 |
| --- | --- |
| `npm run check` | PASS：Vue/TypeScript、34 项核心测试、main/worker/preload/renderer/MCP 生产构建 |
| 核心文件故障 | PASS：prepared、backed_up、installed 三阶段真实子进程强制退出，重启日志恢复完整工程 |
| 核心内容保护 | PASS：Save/Copy、外部冲突、临时恢复发布、层级顺序/循环、失败批零提交、幂等、任务回退保护人工修改 |
| `npm run test:desktop` | PASS：第一版九项实际 Electron/stdio/PNG/手势/保存/导出/初始化/新建回归，工具数更新为 12 |
| `npm run test:v2` | PASS：十项多文档/多选/拖拽/后台 MCP/任务/保存/关闭/退出/硬退出恢复联合回归 |
| Mac arm64 目录包 | PASS：0.2.0-alpha.1 构建；Info.plist 版本核对 |
| 打包 MCP | PASS：包内 Electron Node 启动 app.asar 服务、协议 v2/12 工具、真实 512×384 PNG、任务 begin/finish |
| 原版源码语义 | 已核对文件夹绘制顺序、插入位置、祖先透明度；20 份真实 PNG 对照未完成 |
| Windows | 未运行第二版测试，按要求安排最后阶段 |
| 真实模型 | 未调用，待指定服务接入；没有模拟响应验收 |

桌面测试在临时独立用户目录运行，不修改日常用户目录或原 demo。文件对话框注入了测试路径/响应，文件写入、图像、权威内核和 MCP 都走实际实现；原生对话框交互不在这些注入测试的验收范围内。退出测试实际调用 app.quit 并验证取消决策和竞争写入；硬退出测试实际退出并用同一临时 profile 重启。

输出：

- `artifacts/v2-check.log`：最终类型/核心/构建日志。
- `artifacts/desktop-validation.json`：第一版行为回归。
- `artifacts/desktop-v2-validation.json`：第二版十项联合回归。
- `artifacts/desktop-v2-tabs.png`、`desktop-v2-recovery.png`：实际 UI 截图。
- `artifacts/packaged-mcp-validation.json`：第二版打包 MCP。
- `artifacts/v1-baseline/`：第一版源代码与原验证结果。

## 试用包与下一批

Mac arm64：`release/mac-arm64/Compositor Electron.app`。压缩包：`release/Compositor-Electron-0.2.0-alpha.1-mac-arm64.zip`；同名 `.zip.sha256` 提供校验值。测试包未签名，图标仍为默认 Electron 图标；当前不能称为 M6 完整验收通过。

第一版 Windows 文件仍保留在 release 中，版本 0.1.0；不要将它与本次 Mac alpha 视为同一批双平台交付。第二版 Windows 打包和原生验证在功能完成后再执行。

下一批继续原版图像对照与用户指定模型服务接入。指定服务需地址、模型名、协议和图片/工具能力；密钥不在聊天提供，将在凭据设置功能完成后于应用内配置。模型适配、工具循环、前后预览、停止和整轮撤销都必须经过真实任务验证。画笔/选区/蒙版按已接受方案留在后续 0.2.x。

构建保留 CanvasKit 浏览器分支 externalize 和 Zod 注释警告；当前验证路径正常。此前打包工具链 audit 的 moderate 问题没有在本批关闭；其历史记录见 [第一版实施记录](V1_IMPLEMENTATION_STATUS.md)，不把旧审计快照冒充新审计。

原 Swift 仓库没有修改；本地 Electron 工程未初始化 Git，本批没有 commit 或 push。
