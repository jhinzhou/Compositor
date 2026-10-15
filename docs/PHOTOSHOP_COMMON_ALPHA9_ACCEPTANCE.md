# alpha.9：常用选区、蒙版与裁剪

日期：2026-10-10。按用户要求先补 Quick Mask、局部选择画笔、命名选区、蒙版属性，统一验收后再进入复杂发丝与 PSD；HDR 与网页版参考研究进入后续路线。

## 已实施

| 功能 | 操作方式 | 数据与撤销 |
| --- | --- | --- |
| Quick Mask | Q / 左侧快速蒙版按钮；黑色保护、白色选中、灰色部分覆盖；X 交换颜色，D 恢复黑白，B/E 绘制/擦除 | 红色保护区覆盖层，只改灰度选区；逐笔撤销重做；Q 退出保留选区，恢复原前背景色 |
| 局部选择画笔 | 左侧独立虚线画笔图标；Photoshop 配置 Shift+L 与套索切换；加/减模式，Alt 临时减选 | 支持 Size/Hardness/Opacity/Flow/笔压；空选区从零开始加选，不改图片或蒙版 PNG |
| 命名选区 | 命令面板搜索“命名选区”；保存、覆盖、加载、重命名、删除 | 固化 0–255 覆盖，保留羽化/反选/抗锯齿；加载支持替换、加、减、交集；支持撤销、工程保存重开，随裁剪/尺寸/旋转/翻转变化 |
| 蒙版属性 | 图层操作面板 → 蒙版属性 → 密度、羽化；输入即预览，应用提交，取消回到原值 | 密度 0–100%，羽化 0–250 源蒙版像素；不破坏原始 PNG；普通层、组、调整层、蒙版单独视图与导出共用 effective mask |
| 裁剪 | 原有 C、拖框、框边手柄、Enter 应用 / Esc 取消 | 收尾期间捕获草稿、保持操作 owner；过期版本取消不完整草稿；工具切换/文档任务等待租约结束，手柄无位移不生成编辑 |

Quick Mask 的填充、删除、方向键操作的是灰度通道；对本批尚未实现的通道剪贴板、复制到新层、滤镜和像素变换，明确提示先退出 Quick Mask。不会把这些快捷键悄悄作用到图片。图像与 Quick Mask 的 Shift 连线历史分开。绘制中 Undo 会先取消未完成的笔画。

暂存选区仍是会话状态，普通保存不会持久化；需要保留时保存为命名选区。命名选区只保存于本项目 `.comp`，这一批不宣称支持 PSD Alpha 通道。

## 裁剪证据与其他修复

旧 alpha.8 构建已使用真实 Electron IPC barrier 复现：裁剪注册 `interaction(busy:true)` 后延迟其回复，在期间执行合法用户编辑推进 revision。等待完成后，旧代码留下裁剪框而 `cropRequest` 未生成，应用按钮持续禁用。另一次测试证明旧工具切换会越过仍在等待 `interaction(false)` 回复的前一操作。

修复采用 `PointerFinish` 统一收尾、同步捕获 points/selection/crop/action、等待旧租约释放、取消过期草稿；用相同 barrier 脚本验收。历史一次故障是否由输入框 blur 提交触发没有证据，不作断言。旧版对应截图：`artifacts/crop-alpha8-readiness-failure.png`。

另一个边界已通过修改前构建复现：拖动默认裁剪框的手柄后按 Esc，会把原先不存在的草稿恢复成全画布待应用编辑。取消事件现在恢复拖动前的草稿与请求身份；已有待应用框也恢复到原框，仍可应用。修改前截图：`artifacts/crop-alpha9-handle-cancel-before.png`。最终 native 验收增加两种手柄取消，共 15 项通过。

截图人工复核额外发现蒙版面板 `Image` 未指定 `crossOrigin`，虽然错误被界面捕获，页面没有崩溃，但预览读取像素被浏览器拒绝。已使用应用原有 CORS 图片协议修复；验收同时检查 `.error-toast`，避免仅检查 `pageerror` 的漏检。

## 范围与限制

- 灰度选区绘制最大 64 MP、100,000 个非零 run；超过预算原子拒绝，原图保持不变。
- 命名选区最多 32 个，合计 100,000 个 run、64 MP 通道像素、2 MiB JSON，同时受工程 4 MiB 限制。
- 羽化单位为源蒙版像素，会随蒙版缩放；PSD 均匀缩放可换算描述符，非均匀缩放使用显式烘焙以保持显示。
- 本项目工作表面仍为 RGBA8/sRGB。此次是 Photoshop 常用行为对齐，不是与 Photoshop 渲染逐像素相同的证明。
- 复杂发丝、完整 PSD 智能对象/智能滤镜、HDR、Windows 原生验收尚不属于本批完成声明。

## 验收

以下结果对应 `0.3.0-alpha.9` 最终产品构建，已包含手柄取消修复。桌面检查使用隔离 profile 和合成素材，不使用选品调研图片，不关闭用户未保存的旧版窗口。

| 检查 | 结果 | 本机证据 |
| --- | --- | --- |
| `npm run check`：国际化、类型、单元与构建 | PASS，585 / 585 单元测试，0 失败 | `artifacts/alpha9-final-check.log` |
| 最终构建串行桌面回归 | 10 / 10 脚本 PASS；native 专项 15 / 15，页面错误 0；聚合报告含实际 bundle SHA-256 | `artifacts/photoshop-alpha9-final-regression/acceptance.json` |
| 常用功能开发版 UI | 11 项 PASS；含灰度、源资产不变、预览/提交、命名选区与工程重开 | `artifacts/photoshop-common/checks.json` |
| Photoshop 操作配置开发版 UI | 13 项 PASS，含旋转视图画笔/选区/裁剪、Fill 与合并 | `artifacts/alpha9-final-workflow.log` |
| 实际 macOS ARM64 包常用功能 | 12 项 PASS；另含 20 轮 Quick Mask 取消、切换工具、绘制和 Undo；无错误提示/页面错误 | `artifacts/photoshop-packaged-common/checks.json` |
| 实际包 Photoshop 操作配置 | 13 项 PASS | `artifacts/photoshop-packaged-workflow/checks.json` |
| 实际包 MCP stdio | 5 项 PASS；12 工具/协议 v2、实时 PNG、任务生命周期；选区画笔/命名选区及蒙版属性经真实 MCP 执行 | `artifacts/packaged-mcp-validation.json` |

这些检查证明本项目当前实现和真实 Electron 操作链成立，不是 Photoshop 本体同图像素等价或 Windows 实机证据。20 轮组合验证针对 Quick Mask 生命周期；裁剪的延迟、取消与过期请求由 native 专项分别验证。超预算、过期版本、批量原子性和错误恢复由核心测试覆盖。

当前可运行目录包：`release/0.3.0-alpha.9/mac-arm64/Compositor Electron.app`，未签名。包与当前构建的字节一致性另由 `scripts/verify-release.ts mac-arm64` 检查；不将构建成功代替包执行。`artifacts/`、`out/` 与 `release/` 已被 `.gitignore` 排除，源码仓库只保存脚本、测试输入和文档。

后续 C1 trimap 与 C2 独立 PSD 语料是下一批实验与验证代码；未接入 alpha.9 编辑器，不计入本批 UI 或发布功能。

## 行为参考

- [Adobe Quick Mask：黑/白/灰、覆盖层和 50% 选区边界](https://helpx.adobe.com/photoshop/desktop/create-masks/layer-masks/create-a-temporary-quick-mask.html)
- [Adobe Selection Brush](https://helpx.adobe.com/photoshop/desktop/make-selections/freehand-selections/create-quick-selections-with-selection-brush-tool.html)
- [Adobe 保存选区与 Alpha 通道](https://helpx.adobe.com/photoshop/using/saving-selections-alpha-channel-masks.html)

后续专题见 `PHOTOSHOP_WEB_HDR_ROADMAP_2026-10-10.md`。
