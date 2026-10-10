# 原版与 Electron 同图操作对照：alpha.5

日期：2026-10-10。测试图片改为多肉植物照片 `artifacts/subject-photo.jpg`，987 × 1481；没有使用「选品调研」图片。用户原有工程和 alpha.4 窗口保留。

## 基准与方法

- 实际操作的原版：`/Applications/Compositor.app`，安装版本 **1.4.7**。
- 源码参考：本地 `Compositor` 仓库的 **1.4.8 / 75147a27**。源码计算结果与安装版实际截图分开标注。
- 修复前 Electron：**0.3.0-alpha.4**；修复后：**0.3.0-alpha.5**。
- 两边均通过实际应用界面导入同一 JPEG，在独立测试文档上选择工具、输入参数、拖动画布、提交和撤销。按文档坐标匹配路径；窗口尺寸、Retina 换算和 Fit 策略不同，因此不直接比较截图像素或状态栏缩放百分比。
- 原版照片显示区域约 `[868,262]–[1763,1604]`；Electron 约 `[824,260]–[1663,1523]`，单位为截图物理像素。
- 原版在新建 `Untitled 2` 标签操作。修复后 Electron 使用独立测试 profile；最终又打开 alpha.5 Mac 目录包确认运行路径来自其 `app.asar`。

## 实际发现与修复

| 操作 | 原版行为 / alpha.4 差异 | alpha.5 改动及证据 |
| --- | --- | --- |
| 线性渐变 | 黑色到透明，文档约 `(150,200) → (700,200)`；原版显示操作线、两端手柄。alpha.4 没有手柄，预览落后 | 增加可拖端点、Shift 45°约束、拖动中像素预览；两端调整均验证画布像素改变 |
| 渐变撤销 | 原版 Cmd+Z 取消尚未提交的渐变、恢复原图；alpha.4 报 `DOCUMENT_BUSY` | 优先取消草稿并释放交互锁；实际操作恢复原图，无报错，后续画笔可执行 |
| 渐变重复预览 | 源码检查发现不同预览复用相同 asset hash，移动手柄可能仍显示旧像素 | 每次请求使用不同预览标识，取消后忽略旧响应；加入端点调整后的实际像素变化断言 |
| 渐变作用范围 | 原版可覆盖缩小图层周围的画布；旧实现只修改源图范围 | 按画布扩展栅格，保留采样比例、旋转/翻转，处理独立/关联蒙版，裁去透明边；8项核心用例通过 |
| 魔棒显示 | 原版只显示区域外轮廓；旧实现逐行 stroke RLE 小矩形，产生内部条纹 | 从 RLE 生成外轮廓，去除相邻行内部边，保留孔洞及分离区域；同图实际显示无内部条纹 |
| 矩形选区 | 起点约 `(180,300)`，终点约 `(780,1100)`；旧版拖动时多画一条笔画对角线 | 笔画 SVG 仅用于画笔类工具；实际选区只有矩形轮廓 |
| 裁剪反馈 | 原版有框外暗色遮罩、三分网格、小手柄；旧版没有遮罩且手柄过大 | 增加图片范围内 60%遮罩，缩小可见手柄并保留透明点击区域；实际同图复核 |
| 裁剪与撤销 | 原版裁剪后重新 Fit；alpha.4 保留原缩放，结果缩在视口中央 | 应用裁剪及尺寸变化的 Undo/Redo 后重新 Fit；实际 599 × 800 裁剪、恢复987 × 1481；大画布回归验证缩放变化 |
| 画笔反馈 | 黑色，40px，硬度100%，不透明度100%，平滑0，同水平路径；旧 SVG 预览固定半透明 | 预览遵守画笔 opacity，单点也一致；实际照片产生完整黑色笔画。软笔、橡皮和 retouch 的逐帧反馈仍有下文限制 |
| 数值粘贴 | alpha.4 实际输入框粘贴没有生效 | 输入框通过当前窗口原生 WebContents 编辑命令；实际粘贴40成功，空值失焦恢复有效数值 |
| 后台渲染期间命令 | 短预览渲染被当成文档忙，会阻止保存等操作 | 隐藏渲染窗口串行排队；同文档等待短渲染最多3秒，等待前后保留真正交互锁检查；过期revision明确拒绝 |

两边人工拖动框的尺寸分别为原版600 × 799、新版599 × 800。这是不同屏幕坐标换算、取整与实际落点的差异；本次没有以近似拖动路径证明裁剪输出逐像素等同。严格的输入几何和 Undo 结果另由回归测试覆盖。

## 截图与复核证据

截图均在 `artifacts/native-operation-comparison/`，保留原版、修复前和修复后版本：

- 渐变：`native-gradient-pending.png`、`native-gradient-undo.png`、`electron-alpha4-gradient-undo.png`、`electron-alpha5-gradient-pending.png`、`electron-alpha5-gradient-adjusted.png`、`electron-alpha5-gradient-undo.png`。
- 画笔：`native-brush.png`、`electron-alpha4-brush.png`、`electron-alpha5-brush.png`。
- 选区：`native-marquee.png`、`electron-alpha5-marquee.png`；`native-wand.png`、`electron-alpha5-wand.png`。
- 裁剪：`native-crop-pending.png`、`native-crop-applied.png`、`electron-alpha4-crop-pending.png`、`electron-alpha4-crop-applied.png`、`electron-alpha5-crop-pending.png`、`electron-alpha5-crop-applied.png`、`electron-alpha5-crop-undo.png`。
- 最终目录包：`packaged-alpha5-gradient.png`、`packaged-alpha5-gradient-undo.png`；这些来自真正的Mac发布包，区别于开发窗口截图。

## 验证范围

- `npm run check`：typecheck、**334/334**单元测试和构建通过；最后的预览标识/零长度/裁剪Undo改动后重新构建并通过12项针对性UI回归及typecheck。最后的手柄hover样式修复由Mac发布包实际界面复核。
- 新画布 UI 回归 **12/12**：`artifacts/native-operation-comparison/electron-ui-regressions.json`。包含拖动中真实像素预览、两端手柄及像素刷新、零长度点击、同目标第二条线替换草稿、Enter单次提交、Cmd+Z/Escape释放锁、数字设置渐变opacity、非法笔径、选区无多余线、Crop Fit/Undo Fit和原生菜单粘贴。没有renderer错误。
- 新渲染回归 **8/8**：`artifacts/usability-render-queue.json`；短预览Save/Undo、并发预览、真实交互锁、等待后重新检查、过期快照和本地文本编辑隔离。
- 文件生命周期 **10/10**：`artifacts/usability-editor-lifecycle.json`；保存/故障退出/恢复、空工程、导入目标、选择器分支等。
- 现有使用流程 **18/18**：`artifacts/usability-audit/desktop.json`；现有真实画笔/变换指针回归：`artifacts/pointer-brush/desktop.json`。
- Mac目录包工具栏 **15** 个按钮、包内功能 **13** 项、MCP **3** 项通过：`artifacts/toolbar/packaged.json`、`artifacts/packaged/features.json`、`artifacts/packaged-mcp-validation.json`。
- 发布包逐文件完整性见 `artifacts/release-integrity.json`；Windows二进制/资源静态检查见 `artifacts/windows-package-validation.json`，不代表在Windows执行过。

这些是具体测试范围，不能解释为全部功能与原版100%一致。

## 尚未一致的行为及下一轮顺序

1. **魔棒采样与透明区域。** 同一不透明987 × 1481像素输入、Point `(150,200)`、Tolerance32、Contiguous的原版1.4.8 C算法与Electron都选376,516像素，差异0。证据 `wand-algorithm-audit.json`。原版还比较premultiplied RGBA并能选择透明颜色；Electron当前默认RGB比较/保护透明像素。原版在文档大小上渲染采样，Electron从源图采样，缩放/旋转/图层外画布有区别。3×3/5×5平均采样、All Layers、可选AntiAlias尚未接入UI/协议。这应作为下一轮首项。
2. **画笔、橡皮和retouch实时反馈。** 提交使用真实栅格算法，但拖动中的SVG轮廓不是原版Metal实时像素预览；软边、擦除、选区裁切和修复类工具仍可能出现预览与提交不同。下一轮应共用真实预览/提交栅格路径，再做硬笔、软笔、半透明、蒙版及选区内笔画对照。
3. **复合选区显示。** 本轮修复单个raster内部条纹；add/subtract/intersect的轮廓仍按各shape显示，尚未统一为最终组合覆盖的轮廓。
4. **裁剪后持续操作与视图。** 原版Apply后仍显示新画布的裁剪框；新版清空草稿。原版框外遮罩覆盖整个工作区，新版限制到文档范围。Undo现在重新Fit，不保证恢复用户裁剪前任意自定义缩放/平移。
5. **渲染速度与完整输出等价。** 大图CPU预览仍可能落后于原版Metal；本次没有做所有工具的原版导出PNG逐像素验收，也没有完整ICC/字体/滤镜等价保证。原有范围仍见 `UPSTREAM_CURRENT_USABILITY_AUDIT.md` 和 `UPSTREAM_1_4_8_IMPLEMENTATION_STATUS.md`。

先处理上述画布差异，再做Windows实机验证，符合当前开发优先级。

## 交付与测试事故记录

- Mac：`release/0.3.0-alpha.5/mac-arm64/Compositor Electron.app`。
- Windows：`release/0.3.0-alpha.5/win-unpacked`；本轮只有静态校验，尚未进行Windows实机编辑验证。
- 用户运行中的alpha.4/default profile没有被覆盖或强制关闭。alpha.5实际对照窗口使用独立测试profile，当前展示多肉测试照片。
- 打包使用项目中已有的Electron44.7.0发行内容，避免重复下载；Mac使用 `node_modules/electron/dist`，Windows使用 `artifacts/electron-win-x64`。两包使用同一最终out。
- 测试首轮剪贴板恢复失败：Electron44不允许直接写回只读ClipboardItem，原内容只在已退出测试进程的内存里，无法找回，系统剪贴板被测试文本`23`替换。已向用户说明。脚本现先将所有类型的数据写为0600私有临时备份，再用新的ClipboardItem恢复；恢复失败保留备份。后续复跑恢复成功，但不能宣称首轮原内容已恢复。没有影响工程文件或原图。
