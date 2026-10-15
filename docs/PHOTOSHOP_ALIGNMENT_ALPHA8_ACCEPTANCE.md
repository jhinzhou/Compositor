# Photoshop 操作对齐与基础能力增强：alpha.8

日期：2026-10-10。版本：0.3.0-alpha.8。上一轮源码基线：`ad9c75bde904801b52f913652558f1d44cb39cd0`。本轮按「操作习惯 → 现有功能缺口 → 精细抠图和复杂 PSD」推进，保留 Compositor 操作配置以及已有工程和 MCP 兼容行为。

本机没有安装 Photoshop，以下验收是本项目的真实 Electron、Skia、编辑内核和 PSD 往返结果。Adobe 官方文档用于确定操作规则；没有 Photoshop 同图实测，不能据此宣称像素、字体栅格化、复杂发丝或 PSD 重新合成已与 Photoshop 相同。

## 如何使用

默认操作配置为 Photoshop。打开命令搜索，查找「键盘快捷键」，或按 `Cmd/Ctrl+Alt+Shift+K`，可切换 Photoshop / Compositor。用户已有自定义快捷键保留；自定义键与另一命令的默认键冲突时，自定义键优先，冲突的默认键停用。语言仍通过标题栏 ZH / EN 一次点击切换。

| 操作 | Photoshop 配置 |
| --- | --- |
| 显隐工具栏和侧面板 | Tab；Shift+Tab 只切换侧面板 |
| 工具选择和工具组 | 字母选择当前工具；Shift+字母切换已实现的组内工具，不再用 Tab 切换工具 |
| 合并 / 合并可见 | Cmd/Ctrl+E；Cmd/Ctrl+Shift+E |
| 盖印选中 / 盖印可见 | Cmd/Ctrl+Alt+E；Cmd/Ctrl+Alt+Shift+E，源图层保留 |
| 填充 | Shift+F5 打开前景、背景、黑、白、自定义颜色对话框 |
| 前景 / 背景填充 | Alt+Backspace/Delete；Cmd/Ctrl+Backspace/Delete |
| 图像尺寸 / 画布尺寸 | Cmd/Ctrl+Alt+I；Cmd/Ctrl+Alt+C |
| 色阶 / 曲线 / 图像反相 | Cmd/Ctrl+L；Cmd/Ctrl+M；Cmd/Ctrl+I |
| 重复上次滤镜 | macOS：Control+Cmd+F；Windows：Ctrl+Alt+F |
| 导出为 | Cmd/Ctrl+Alt+Shift+W |
| 旋转视图 | R，拖动旋转，Shift 按 15° 吸附；支持数值输入和重置 |
| 画笔不透明度 / 流量 | 数字 / Shift+数字；支持连续两位数字，0 表示 100% |

R 只改变视图，不旋转工程像素，也不产生撤销记录。指针到图像坐标、图层拖动、选区、裁剪、浮动像素手柄及可见区域渲染已适配视图旋转。旋转时暂时隐藏屏幕标尺、辅助线和网格；它们仍保存在工程中，恢复零角度后显示。

## 本轮已实现

| 能力 | 交付范围 | 仍有的边界 |
| --- | --- | --- |
| 缩略图载入选区 | Cmd/Ctrl 点击图像载入 alpha；点击蒙版载入白区，保留灰度覆盖。加 Shift 为添加，加 Alt 为减去，加 Shift+Alt 为相交 | Compositor 配置保留原版黑区阈值行为；命名选区和 Channels 未实现 |
| 合并与盖印 | 按当前选择合并、合并可见、盖印选中、盖印可见；隐藏图层及含隐藏子项的文件夹保留，盖印保留源层 | 复杂 Photoshop 隔离组与高级混合语义仍需专题实现 |
| 图层锁定 | 全锁定、位置锁定、祖先文件夹保护；UI、MCP、后台提交共用内核校验；锁定组不能插入图层 | 尚无独立「只锁透明像素」「只锁图像像素」编辑规则 |
| 排版 | 相对选中范围或画布的六方向对齐；横/纵中心分布，旋转边界与文件夹整树移动 | 暂无等间隙分布和图像自动对齐 |
| 画笔 | 独立 Flow；逐点笔压；压力控制大小/透明度；柔圆、硬圆、压感圆三种预设；实时预览与提交一致 | 真实数位板硬件、倾斜、ABR、自定义笔尖、散布、纹理和完整预设库尚未验收或实现 |
| 主体细化 | RGB 颜色引导、灰度原版模式、独立羽化、保留细边预设；支持 32MP 分块；透明源保护，输出可编辑蒙版 | U²-NetP 的粗分割仍限制质量，未恢复被漏掉的发丝；无局部 Refine Edge 画笔和颜色去污染 |
| PSD / PSB | 原生水平文字、简单矢量形状、六类效果、八类调整、锁定信息；未修改的部分复杂描述符保留；16bit RGB 显式量化导入 | 不提供完整智能对象、智能滤镜、任意路径编辑、高位深工作面、CMYK 和所有样式；详见独立能力矩阵 |

图层锁定不是单纯禁用界面按钮：锁定的内容不能通过 MCP 或后台任务绕过修改。允许读取、载入选区、复制、重命名和切换可见性。原子批中解锁后再编辑有效；拒绝的批不保留前面的部分修改。

画笔压力采用浏览器 pen 事件或 MCP 的逐点 pressures，鼠标不会把固定的模拟 pressure 当成真实笔压。Flow 控制积色速度，Opacity 限制单笔覆盖；100% Flow 且不使用压力时，保留原版画笔参考路径。

PSD 写出不仅检查文件可解析，还检查实际结构和再次渲染。编辑文字、蒙版、效果或保护规则后，会使相应原始 Photoshop 快照失效，防止删掉的旧样式、密度、文字变形在再次导出时复活。

## 验收证据

检查使用隔离 profile、测试工程、植物照片和合成素材，没有使用选品调研图片，也没有关闭用户正在编辑的应用。

- Photoshop 桌面操作流程：13 项通过，包含旋转后真实画笔落点、选区坐标、裁剪应用与撤销、盖印、合并、蒙版白区和配置切换。`scripts/smoke-photoshop-workflow.ts`；`artifacts/photoshop-workflow/checks.json`。
- 画笔桌面：7 项通过，包含低 Flow 积色、单笔透明度上限、模拟 pen 逐点压力、worker 预览与提交逐像素一致、保存重开和双语。`scripts/smoke-photoshop-brush.ts`；`artifacts/photoshop-brush/checks.json`。
- 主体桌面：5 项通过，包含真实植物 JPG、Basic/Advanced 预览、RGB/1.5px 羽化、取消、幂等、预览与提交逐像素一致、Undo 保留原图。`scripts/smoke-parity-subject.ts`；`artifacts/parity-subject/acceptance.json`。
- RGB 分块细化有整图参考与跨块接缝误差测试；24MP 合成实验约 2.63s、峰值 RSS 约 549MB，属于单个本地案例，不是 Photoshop 性能比较。`artifacts/color-matte/acceptance.json`。
- PSD 复杂组合 fixture 覆盖文件夹、图层/文件夹蒙版、剪贴、效果、文字、调整、DPI 和保护信息；经过真实 CanvasKit 渲染、导出、导入、重新渲染，RGBA 最大差值不超过 1。这是本项目往返证据，不是 Photoshop 输出黄金基准。

最终统一检查、原有桌面回归及目录包记录见本文件后面的最终验收结果。

## 后续按用户顺序推进

1. 常用操作层：补齐 Quick Mask、局部选择画笔、命名选区、完整蒙版 Density/非破坏 Feather；完善历史面板、等间隙分布与可保存工作区。新增工具继续采用 Photoshop 快捷键和同一事务/MCP 链路。
2. 现有编辑深度：更多调整层、填充层、画笔资源库与笔尖参数，修复/填充采样区和常用滤镜；每项都需要预览、应用、取消、撤销、保存重开完整流程。
3. 复杂发丝：建立局部 trimap、细化画笔、颜色去污染和更强 matting 模型，用有透明真值的发丝/毛发/半透明材质集验证。当前“保留细边”只是这一阶段的基础，不算完整发丝能力完成。
4. 复杂 PSD：智能对象与链接资源、智能滤镜、高级组混合、任意路径、多重样式；先定义工程节点和渲染模型，再对 Photoshop 保存的实际 PSD 做双向验收。
5. 高位深/ICC/CMYK 与大工程 tile/scratch 属于后续基础架构专题；Windows 原生验证仍按用户此前要求延后。

这些项目没有换算成人日，也不把已经有按钮但不具备完整工作流的能力标记为完成。上一轮 38 组差距清单保留为 alpha.7 历史基线；本轮改变 P02、P09、P11、P18、P29、P36、P37 的部分状态，不能把全部组数当成待做的独立功能数或完成率。

## 对照来源

[Adobe 默认快捷键参考](https://helpx.adobe.com/content/dam/help/en/pdf/photoshop_reference.pdf)、[Adobe 合并与盖印](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/get-started-layers/merge-and-stamp-layers.html)、[Adobe 显隐面板](https://helpx.adobe.com/uk/photoshop/desktop/get-started/learn-the-basics/hide-show-panels.html)。其他能力和快捷键来源见 [alpha.7 调研清单](PHOTOSHOP_CAPABILITY_GAP_2026-10-10.md)；格式支持见 [PSD / PSB 能力矩阵](PHOTOSHOP_FORMAT_SUPPORT.md)。

## 最终验收结果

| 检查 | 最终结果 | 记录 |
| --- | --- | --- |
| npm run check | PASS：543 tests，0 fail；国际化、vue-tsc、生产构建通过 | artifacts/photoshop-final-check.log |
| PSD 格式专项 | PASS：52 项，包含在全量测试中 | docs/PHOTOSHOP_FORMAT_SUPPORT.md |
| 旧流程统一桌面回归 | PASS：10 个脚本全部退出 0，共 65 项执行检查 | artifacts/photoshop-alpha8-regression/acceptance.json |
| 新增专项桌面 | PASS：Photoshop 流程 13、画笔 7、主体 5 | 上述专项报告；主体检查与旧回归有重叠，不累计为独立功能数 |
| macOS arm64 打包版操作 | PASS：13 项，同一套真实指针/键盘工作流 | artifacts/photoshop-packaged-workflow/checks.json |
| 包内真实 MCP | PASS：app.asar stdio 服务、12 tools/protocol v2、实际 PNG 预览及任务 begin/finish | artifacts/packaged-mcp-validation.json |
| 包完整性 | PASS：16 个当前运行文件、ONNX/metadata、图标和 28 个许可证文件逐字节一致 | artifacts/release-integrity.json；release/0.3.0-alpha.8/SOURCE_MANIFEST.json |
| 最后脚本类型检查和 diff 空白检查 | PASS | artifacts/photoshop-typecheck-final.log；git diff --check |

应用目录：`release/0.3.0-alpha.8/mac-arm64/Compositor Electron.app`，Info.plist 已确认版本 0.3.0-alpha.8。当前 app.asar SHA-256 为 `6541b54ba9b80a099b4c66ee3c18a920a2a7996ce02a904a5c4ac5d04352f487`。这是未签名目录包，Windows 原生验证未包含在本轮范围。

复现打包（使用本机已安装、版本已核验为 44.7.0 的 Electron 分发目录）：

```sh
npm run check
npx electron-builder --mac dir -c.directories.output=release/0.3.0-alpha.8 -c.electronDist=node_modules/electron/dist
npx tsx scripts/verify-release.ts mac-arm64
```

打包版 Playwright 的 Electron firstWindow 连接最初超时，未计作 PASS。最终测试使用独立 CDP 连接到打包版可见窗口，仍执行同样的指针、键盘和文档像素检查；没有使用开发入口替代打包版验收。

旧裁剪回归首次出现过“拖动产生框，但 Apply Crop 未启用”的时序失败。单独重跑和随后完整 10 组串行回归均通过；随后又连续 3 次完整执行该裁剪所在脚本，全部退出 0，记录于 artifacts/photoshop-crop-repeat.json。这个初次失败没有算作通过，也未声称已经定位并修复其根因。
