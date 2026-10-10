# 第一阶段实施记录

日期：2026-10-09。目录：`/Users/zhoujin/Documents/PS/Compositor_Electron`。版本：0.1.0。

## 本次交付边界

已实现可运行的跨平台代码基线，并在 macOS arm64 完成真实应用和 MCP 联合验证。Windows x64 目录包已构建，尚未在 Windows 实机运行。原版 Swift 仓库保留为参照，没有修改。

### 界面参照

用户指出初版界面与原版差异后，实际打开 `/Applications/Compositor.app` 1.4.7，完成以下体验：

- 原版 New canvas 的 1920 × 1080 默认值、透明 / Pixels / 72 DPI、Open project / Import image / Create canvas。
- 新建后的透明画布、默认 Layer 1、顶部 X/Y/W/H/比例/Scale/旋转/采样/翻转。
- 导入本地生成的 PNG；修改 X 和透明度，确认数值提交与图层显示。
- 原版 File 菜单，以及项目标签、Fit、100%、缩放、完整工具列、图层区与底部提示的位置。
- 原版实际打开本项目 `fixtures/demo.comp`：1200 × 900、五个图层、选中 Sun，全部成功读取和显示。

Electron 界面已恢复这一结构及灰黑配色、蓝色选中框。macOS 标题栏使用真实系统窗口按钮；Windows 使用原生窗口控制覆盖区域。图标当前采用跨平台 SVG，字体和控件有原生 / Web 的细节差异；不是逐像素完全相同的承诺。

### 实际能力

- 新建透明画布、导入 PNG/JPEG、打开受支持的 `.comp` 子集、保存到新名称、全尺寸 PNG 导出。
- 图层可见性、透明度、八种混合模式、复制、重命名、排序、文件夹层级和删除。
- 移动、输入变换、蓝色手柄缩放、宽高比例锁、圆点旋转、采样、翻转、平移、缩放。
- 共享串行文档服务、monotonic revision、session 失效、幂等重试、定向撤销 / 重做。
- 五个真实 MCP 工具和真实 PNG 预览；人工操作和 Agent 操作共享文档及历史。

## 本机验证

| 验证 | 结果 / 边界 |
| --- | --- |
| TypeScript / Vue 类型检查 | 通过 |
| 核心测试 | 16 项通过；内容、历史、过期请求、幂等、工程读写、PNG CRC、路径与资源限制等 |
| 生产构建 | Electron main、utilityProcess、CJS preload、Vue renderer、CanvasKit WASM、MCP bundle 通过 |
| 真正 Electron 窗口 | 通过；不是网页 mock |
| MCP stdio | 五工具发现、SDK 调用及 `2025-11-25` 初始化兼容通过 |
| 图像修改 / 回退 | 修改透明度后像素改变，重复请求不增加 revision，撤销后像素与修改前一致 |
| 手动变换 | 真实指针拖动、缩放比例和旋转手柄验证通过，每次手势一个事务 |
| 保存 / 导出 | 临时 `.comp` 回读与完整 1200 × 900 PNG 通过；测试注入了对话框目标路径 |
| 新建页面 | 默认值、透明 PNG 和默认空白图层验证通过 |
| 原版消费测试工程 | 本地原版 1.4.7 成功打开五图层 demo；尚不是完整格式 / 色彩一致性验证 |
| Mac 应用目录包 | 构建通过，直接打开并实际查看 New canvas 页面通过 |
| 打包版 MCP | Electron 自带 Node 运行时直接执行 app.asar 内 stdio 服务，五工具与 PNG 预览通过 |
| Windows x64 目录包 | Mac 上交叉构建通过；未在 Windows 实机启动 |
| 生产依赖 audit | 当前 0 个报告漏洞 |
| CI | Mac / Windows workflow 已编写，尚未推送执行 |

机器结果及截图：`artifacts/desktop-validation.json`、`desktop-new-canvas.png`、`desktop-layers.png`、`desktop-automation.png`、`mcp-preview.png`。`artifacts/` 和 `release/` 均为本地输出，不纳入源码。

打包输出：`release/mac-arm64/Compositor Electron.app` 和 `release/win-unpacked/Compositor Electron.exe`。两者均是未签名测试目录包。Windows 需拷贝完整 `win-unpacked` 目录，或传输 `release/Compositor-Electron-0.1.0-win-x64.zip` 并完整解压。

运行时下载因当前网络代理环境进行过人工补全；Mac / Windows Electron archive 均与安装的 Electron npm 包提供的 SHA256 校验值匹配。本项目没有改动系统代理或全局 npm 配置。

构建仍有 CanvasKit 的 Node 分支被浏览器 externalize 和 Zod 注释优化警告，不影响已验证路径。开发依赖的 npm audit 仍报告 8 条 moderate，源头为 electron-builder 的传递依赖 sprintf-js 精度参数 DoS；生产依赖报告为 0。未执行会降级打包器的强制修复，正式发布前需单独解决打包工具链审计。

## 尚未完成

原版多文档标签、Save 原位替换、崩溃恢复；像素级 Auto Select；选区、画笔、橡皮擦、修复、克隆、涂抹、渐变、裁切；图层蒙版、剪贴、调整、效果；文本与形状内容编辑；PSD/RAW/HEIC/TIFF；16 bit/HDR/色彩管理；GPU 性能与 C/WASM 算法；内置 Agent 对话、任务取消、原子批事务、任务级回退；安装器、正式图标、签名、公证、更新；Windows 实机验收。

左侧未实现工具和右侧蒙版 / 效果 / 调整入口禁用，不产生假的编辑结果。包含这些未实现功能的工程会拒绝打开，避免静默丢失。

## 后续按小批次推进

1. **Windows 实机基线验收**：运行同一核心 / 桌面测试；检查标题栏、文件选择、中文路径、DPI 缩放、PNG/`.comp`、MCP stdio，记录 Windows 版本与 GPU。先把系统差异封在桌面边界。
2. **原版交互继续对齐**：多文档标签、打开/导入进入新文档的行为、像素命中、图层列表多选和拖拽；建立原版与 Electron 的同尺寸截图基线。
3. **格式与渲染基线矩阵**：从原版保存/导出真实样例，覆盖透明度、组嵌套、八种混合、旋转/翻转/采样、文本回退；比较尺寸、Alpha、像素差和色彩空间。尚未达到矩阵验收前不承诺无损替代。
4. **迁移像素工具**：先选择/画笔/橡皮擦及蒙版，再迁移源 C 算法至 WASM；将每笔操作接入同一事务/历史，分别验收原版图像差异与性能。
5. **内置对话**：先用已有 MCP 外部客户端跑实际编辑任务，补批事务、任务取消、任务回退和成本/错误呈现，再接入可配置模型运行时。密钥保存在系统凭据存储，不写入 `.comp`。
6. **发布工程**：解决工具链 audit，收集并验证依赖许可、签名、公证、Windows 安装器及自动更新。

详见父目录方案 `../Compositor_跨平台与Agent_MCP实施方案.md`。这里记录已实现事实与剩余边界，不替代完整迁移计划。
