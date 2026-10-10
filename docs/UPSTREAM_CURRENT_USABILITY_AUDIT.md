# 0.3.0-alpha.4：使用问题排查与上游同步

日期：2026-10-10。项目：`/Users/zhoujin/Documents/PS/Compositor_Electron`。

这一版围绕用户实际反馈修复画笔、选区、裁剪、文字编辑、Agent 面板和工程数据保留。原 alpha.3 的功能入口覆盖不等于实际交互没有问题；本轮增加真实鼠标/键盘回归，保留失败基线和修改前源文件。项目目录没有 Git 仓库，本轮没有初始化仓库或创建提交；历史发布目录未覆盖。

## 上游基准

原克隆 `/Users/zhoujin/Documents/PS/Compositor` 已从干净的 v1.4.8 `24ef2885daae750537ec8d094f33e8556a8dfc9a` 快进至 `75147a27d90c681215151a6301373dd2b07b7aa2`。这次有4个提交、9个文件变更，版本声明仍为1.4.8，不称为新发布版本。

| 更新 | Electron 实现 |
| --- | --- |
| 更新 feed | 属于原版发布渠道元数据；Electron 有独立交付目录，未直接使用原版更新 feed |
| Cmd / Ctrl + 中键拖动缩放 | 普通中键平移；Cmd / Ctrl + 中键向上100屏幕像素放大一倍，工具和工程 revision 保持不变 |
| Camera Raw Light / Color 测量表 | 285个17³ RGB表、33³组合表、色温色调插值、曝光/对比度/高光/阴影/白黑场/自然饱和度/饱和度顺序 |
| 亮度自适应及效果/细节 | alpha加权线性亮度、自动白平衡、自引导纹理与清晰度、去雾、锐化、降噪；接入实际 applyImageFilter 完整路径 |

来源：[上游提交](https://github.com/robbietilton/Compositor/commit/75147a27d90c681215151a6301373dd2b07b7aa2)。数据与算法保留 MIT 许可，运行时不依赖原应用、Swift或macOS API。独立编译实际上游C代码生成24组像素参考，包含透明/半透明图片，每通道误差不超过1个8-bit单位；来源、命令和边界详见 [Camera Raw 记录](CAMERA_RAW_UPSTREAM_PARITY.md)。

## 本轮修复

| 范围 | 确认的问题 | alpha.4 行为 |
| --- | --- | --- |
| Agent 显示 | Protocol内容高度只剩约7px，文字被裁；Close浮到标题栏下方 | 控件独立高度/行高/内边距；Close在标题栏；窄窗内部滚动、底部按钮换行 |
| Agent 提交 | 配置保存失败仍清空key并关闭表单；发送失败仍丢掉输入 | 异步确认成功后才清空，失败保留输入；阻止重复提交；错误不会直接渲染可能含key的异常 |
| Agent 说明 | 0 MCP tools像工具缺失；密钥说明与实际加密持久化矛盾 | 未开始任务时说明连接时机；密钥说明改为系统加密后本机保存，Clear删除 |
| 图标与分组 | Object与Gradient重复ScanLine图标，无法辨认 | Object归入Magic模式，W/Tab切换；Gradient、Shape、Type各有独立图标，工具栏15按钮 |
| 画笔/橡皮 | 缺少笔径光标；按下单点SVG无可见反馈；橡皮预览黑线 | 随缩放的双轮廓光标、Alt采样十字、单点圆形反馈、橡皮浅色反馈 |
| 空格平移 | Magic按空格拖动仍执行魔棒/改选区 | 平移优先于魔棒、采样及选区移动，保持像素与revision |
| 选区组合 | 反选后加减/交集错误；自由套索Vue reactive数据无法structuredClone | 按真实覆盖率规范化反选基底；数值叶子复制生成IPC plain数据；反选显示画布外边界 |
| 选区修饰键 | 矩形拖动中Shift无法约束正方形 | 起手Shift追加选区；起手不按Shift、拖动中按Shift约束正方形；Alt仍为减选 |
| 裁剪 | 只能重画，不能移动/调现框；改变比例不改当前框 | 从实际选区或整个画布开始，内部移动、8手柄、比例立即生效；Alt中心缩放；Ctrl暂停吸附；Escape撤回拖动；支持负坐标扩展 |
| 裁剪几何 | 分别取整起点和宽度导致1px差；隐藏文件夹子层参与吸附 | 按两个端点取整；排除祖先隐藏的图层；按画布/可见图层边缘/网格/参考线吸附 |
| 渐变/多边形草稿 | 切工具后预览和交互锁残留，后续命令失败 | 渐变先确认提交；未完成多边形取消并释放锁；重复点当前工具不重置草稿 |
| 变换数值 | 0或非法宽高触发失败，输入框留下错误值 | 不发送非法修改，恢复真实数值；兼容number输入的实际v-model值类型 |
| 文字草稿 | 切工具、新建、点画布其他位置会丢稿；提交失败仍移除draft | 先确认提交；失败保留可编辑草稿及锁；画布外点先提交当前文字，下一次点击再创建 |
| 文字图层 | 编辑A时选B，属性面板可能把B内容写回A；编辑期间其他修改导致永久旧revision | 锁定当前编辑对象，原位draft不随selected覆盖；其他UI修改先提交draft；中文IME组合期间不替换editable DOM |
| 输入框Undo/Redo | 原生菜单撤销了画布而不是输入文字 | 输入焦点时走文字编辑命令；画布历史保持独立 |
| 滤镜预览 | RPC失败只全局toast，面板一直Updating/无法Apply；旧响应可覆盖新响应 | 面板显示具体错误并停止等待；Apply阻止无效预览；ticket及面板identity忽略过期响应 |
| 保存/退出 | 窗口销毁后引用仍发送消息，Object has been destroyed；worker停了请求仍等超时 | 窗口引用清理；RPC立即ENGINE_UNAVAILABLE；错误关闭保留恢复并让用户明确选择 |
| 空工程 | 删除最后层跳过保存确认并删恢复；干净welcome被算dirty；空恢复可能被welcome替换 | dirty空工程仍询问/保存恢复；welcome clean；实际Create canvas仍dirty；恢复空工程不会静默替换 |
| 导入与文档 | 多图中途切tab导致后续图导入错目标；newDocument绕过交互锁 | 普通图片绑定原session；PSD开新文档才跟随；new遵守锁；关闭决策期间不异步提交新导入 |
| Windows选择器 | .comp目录与PSD/PSB文件共享目录选择，无法选文件 | 先选类型，分别调用目录/文件选择器；macOS隔离进程验证主进程分支参数，原生Windows仍待验收 |

## 验证证据

- `npm run typecheck`、`npm run build`：通过；`npm test`：316/316通过。日志 `artifacts/usability-{typecheck,build,core-final}.log`。
- 18个已有桌面套件、143个检查通过：`artifacts/usability-full/validation.json`；包括MCP、实际画布拖动、导入、PSD、retouch、独立文档、保存恢复、浮动选区、快捷键和100MP/800%可视区域。
- 新增实际交互18/18通过：`artifacts/usability-audit/desktop.json`；捕获console error、Vue Unhandled、unhandledrejection、pageerror均为空。覆盖裁剪、选区、草稿、文字A/B独立内容、保存回读与asset hash。
- 最终生命周期10/10通过且没有外部手动干预：`artifacts/usability-editor-lifecycle.json`。故障注入只针对临时测试进程，确认worker故障、关闭决策和恢复。
- 滤镜预览冲突与重新打开2/2：`artifacts/usability-audit/preview-errors.json`。
- Agent 420×800、320×450、280×450布局通过，无横向溢出；RAW两种窗口通过；`artifacts/usability-audit/{agent-layout,raw-brush-layout}.json`。实际完整窗口：`agent-desktop.png`。
- Mac正式目录包实际15个工具按钮输入事件通过、13项包内功能检查通过、3项包内MCP检查通过：`artifacts/toolbar/packaged.json`、`artifacts/packaged/features.json`、`artifacts/packaged-mcp-validation.json`。

Playwright的Page API在Electron44打包窗口里没有注册实际window事件，所以完整18项Page交互套件在开发构建运行；打包版改用BrowserWindow实际输入事件和renderer IPC验证上述按钮/功能，不能把Page挂接超时算作18项包内通过。包与最终out的全部运行时文件逐个SHA256比对，结果见 `artifacts/release-integrity.json`。

## 交付与使用

- Mac：`release/0.3.0-alpha.4/mac-arm64/Compositor Electron.app`。
- Windows x64：`release/0.3.0-alpha.4/win-unpacked`，EXE名称/alpha.4版本/图标资源已更新，机器代码与ASAR完整性资源保持不变。
- 历史alpha.3目录保留。当前用户打开的alpha.3窗口及默认profile没有被测试/覆盖；所有故障测试使用临时profile。
- 保存当前工程、退出旧窗口，再打开alpha.4。macOS可能复用旧进程，只双击另一个app路径不能证明已升级。

## 仍需区分的边界

这次修复不等于所有操作和原生外观100%一致。原有41项功能域映射见 [1.4.8实现记录](UPSTREAM_1_4_8_IMPLEMENTATION_STATUS.md)，alpha.4是在其基础上的交互与上游更新。

Windows已生成目录包并核对静态内容，未在原生Windows执行编辑、字体、文件选择、MCP或ORT推理；尚无正式签名/安装器验收。用户尚未填写真实模型服务，已有兼容协议及mock服务测试不能代表所有DeepSeek/MiniMax/GLM/千问/混元服务实测。PSD/TIFF/字体、ONNX与原版Vision选区结果、大半径滤镜、Camera Raw几何插值等现有范围仍以记录和 `FILTER_PARITY_LIMITATIONS` 为准。画笔/retouch拖动反馈并非原版Metal逐帧像素预览，文字工具新建时保留上一段所有属性仍有UX差异。
