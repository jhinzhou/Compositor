# alpha.22：上游同步、Photoshop 操作习惯和工具组验收

日期2026-10-13。版本 `0.3.0-alpha.22`；本机 macOS ARM64，Photoshop 27.11.0。本报告区分源码、实际 Electron 开发版、实际目录包、原生 Photoshop 输出、发布文件完整性和平台硬件门槛。

## 本批交付

1. 实际拉取上游 main 到 `87e2283bae4cea45b857a1bb386f8a56ad4e99b6`，相对已同步基线有12个提交。Swift代码按行为移植，原始工作目录不做reset。全部增量决策见 [上游审计](UPSTREAM_87E2283_DELTA_AUDIT_2026-10-13.md)。本批成功fetch之后的两次可选远端刷新失败，不能把最后一次远程复查写作成功。
2. 原生菜单依当前已实现功能排列为 File / Edit / Image / Layer / Type / Select / Filter / View / Window / Help；macOS前置应用菜单。调整、修改选区、图层蒙版和填充回到熟悉位置。缺少的功能不添加空菜单。
3. 快捷键支持单条Clear、Reset、部分有效配置恢复、平台修饰键和冲突校验。裸Backspace/Delete及工具字母不注册为原生全局菜单accelerator；输入字段编辑不再穿透到清除图片。该路由修复不能证明历史alpha.21偶发清除的唯一根因。
4. 增加Reselect（Cmd/Ctrl-Shift-D）、All Layers，区分图层蒙版Reveal/Hide All与Reveal Selection；重新选择缓存按会话隔离，并在几何及对应历史变化时失效。
5. 增加Select > Modify > Smooth/Border，整数参数、邻域预算和事务失败原子性。尚未宣称私有核逐像素等效。
6. 增加Threshold/Posterize RGB8/16独立滤镜，原生输出校准亮度边界和输入分桶。HDR明确拒绝，不静默降位深，也不把它们冒充已具备完整非破坏调整图层。
7. 移植Progressive Blur，支持8/16/HDR、文档坐标起终点、线性/径向/反向；当前数值参数可用，画布拖线仍未加入，不是完整Photoshop Blur Gallery。
8. 普通RGB16源也先高位合成，再做最终SDR屏幕量化；对明确不支持的可见效果和预算限制显示8位兼容预览提示，源、撤销和导出保持原位深。PSD RGB8/16共同检查嵌入ICC，不再静默忽略非sRGB配置文件；完整跨平台ICC CMM及CMYK仍未实现。
9. 新增真实工具组右键、400ms长按、Shift-F10及Shift字母完整轮换，支持键盘导航、Escape/外点关闭。中文快捷键窗口的Save As / Save a Copy漏译补齐，小窗口footer实测。

## 用户截图22个工具的状态

**6个基础可用、4个部分实现、12个缺少**；10条对应功能路径不等于10个Photoshop等效算法。逐项路径、限制与工具组顺序见 [侧栏工具审计](TOOL-GROUP-AUDIT-2026-10-13.md)。

| 组 | 基础可用 | 部分实现 | 缺少 |
|---|---|---|---|
| C | 裁剪 | 透视裁剪 | 切片、切片选择 |
| I | 吸管 | — | 颜色取样器、标尺工具、注释、计数 |
| L | 选择画笔、套索、多边形套索 | — | 磁性套索 |
| J | — | 污点修复画笔、修复画笔 | 移除工具、修补、内容感知移动、红眼 |
| W | 魔棒 | 对象选择 | 快速选择 |

选择画笔是直接绘制覆盖率，快速选择则需要图像边缘/区域增长；工作区标尺不等于两点距离/角度测量工具；独立内容感知填充不等于交互移除工具。截图之外的裁剪拉直和M组矩形/椭圆选框不用于抵消这12个缺项。I组只有吸管，不显示误导性的隐藏工具三角。

## 验收记录

最终数值和路径由 `artifacts/alpha22-unified-acceptance.json` 记录。源码及两种实际runtime的统一门禁已通过；发布文件一致性依据同版本 `artifacts/release-integrity.json` 与 `release/0.3.0-alpha.22/SOURCE_MANIFEST.json`。

| 门禁 | 结果 / 证据 |
|---|---|
| i18n / vue-tsc / 源码测试 / build | PASS；2057消息键 / 38 Vue组件，1712源码测试全部通过，日志 `artifacts/alpha22-check-final.log`；最终harness修改后另一次typecheck也PASS |
| 开发版：新菜单、快捷键、工具组及局部编辑 | 最终语言及显示边界修正后16组PASS，`artifacts/alpha22-development-new-final5/checks.json` |
| 开发版：高位屏幕与预算 | 8组PASS，增加隐藏MCP预览与可见屏幕边界对照，`artifacts/alpha22-development-deep-screen-final3/acceptance.json` |
| 开发版：15组PS工作流 + 5组高位/布局/MCP回归 | 全PASS；15组139项 + 5组117项，含52项布局；`artifacts/alpha22-development-photoshop-final/acceptance.json`、`artifacts/alpha22-development-high-depth-final/acceptance.json` |
| macOS目录包：同组门禁 | 全PASS；新功能16、高位屏幕8、PS工作流139、高位/布局117，合计22套件280项；`artifacts/alpha22-packaged-new/checks.json`、`artifacts/alpha22-packaged-deep-screen/acceptance.json`、`artifacts/alpha22-packaged-photoshop/acceptance.json`、`artifacts/alpha22-packaged-high-depth/acceptance.json` |
| app.asar / 模型 / 图标 / 许可证 / ZIP哈希 | PASS；16个构建文件与最终out逐字节相同，模型、图标、28个许可证文件及ZIP SHA256通过。复核 `npx tsx scripts/verify-release.ts mac-arm64`；完整结果及源码快照见 `artifacts/release-integrity.json` / `release/0.3.0-alpha.22/SOURCE_MANIFEST.json`；此门禁不代替Windows执行 |

新功能脚本 `scripts/smoke-photoshop-alpha22.ts` 通过实际Electron原生MenuItem回调确认路由与顺序，再通过真实键盘、按钮和鼠标进行操作。MenuItem回调不是原生菜单栏逐项人工点击。高位屏幕脚本 `scripts/smoke-deep-screen-alpha22.ts` 检查真实DOM canvas字节及实际window.capturePage，不使用截图fallback；包含普通16位源、8次缩放、400%及中键平移、两语言兼容提示、Undo恢复及36MP预算回退。自己的输入与高位源哈希保持不变，未用这些自产输入冒充原生Photoshop效果参考。

开发版最终总数：**22套件、280项**（16新入口 + 8高位屏幕/隐藏预览 + 139 PS流程 + 117高位/布局/MCP），所有报告errors为空。目录包按相同范围独立验收，不以开发版结果代替。

目录包最终同样为 **22套件、280项全部PASS**；两种runtime合计560项执行记录，不把相同断言在两个runtime执行算作560种不同功能。每种runtime的52项布局均为真实截图、fallback 0；高位屏幕每种各6张实际window.capturePage。开发版和目录包最终16个构建文件的SHA清单一致。

本批应用：`release/0.3.0-alpha.22/mac-arm64/Compositor Electron.app`；ZIP：`release/0.3.0-alpha.22/Compositor-Electron-0.3.0-alpha.22-mac-arm64.zip`。应用未签名/未公证，本轮只在macOS ARM64实际执行。

既有回归检查画笔与连续低Flow、蒙版羽化、裁剪/拉直/透视、原生PS RGB16 PSD/PSB、选区、取消、Undo/Redo、保存重开、布局footer及实际stdio MCP。桌面剪贴板路径在部分旧脚本中用进程局部double；不将它写作系统剪贴板真机证明。

最初开发版回归发现隐藏HDR预览被屏幕抖动影响；这是产品渲染边界问题，不是原生参考容差问题。保留首失败 `artifacts/alpha22-development-high-depth-first-failure`，增加独立屏幕量化开关，隐藏渲染器明确停用；最终构建重跑全部门禁。源码Skia及实际Electron额外逐值验证隐藏MCP预览保持原确定性像素。两条中文翻译也在最终构建重新验收。旧中间构建的15组PASS不计入最终统一总数。

## 原生Photoshop效果校准与保留差异

本批通过本机Photoshop File > Scripts > Browse运行自有输入脚本，真实执行DOM Threshold/Posterize，再读取原生输出。版本、输入、参数、PNG/raw RGBA、SHA和无操作转换控制保存在独立fixtures，不以产品输出作为oracle。原用户活动文档和未保存标记保留，study文档独立创建并关闭。该证据是实际原生Photoshop执行，不是私有核复制，也不是所有手工对话框的操作体验门禁。

- v2的8个操作与v3的29个操作：**37个直通颜色核比较全部零误差**，用于修正原来的Rec.709亮度和最近palette公式。
- 完整产品预乘alpha路径：v2 **8/8**、v3 **24/29**逐值相等；4项Posterize最多差1个16位单位。
- 1项Threshold128透明输入在 `(23,2)`、alpha32895处存在二值边界差异；预乘RGB最大差32895。没有通过放宽阈值、加epsilon或量化所有源来掩盖。
- 原生无操作转换也会对8→16及真正16位输入产生少量通道变化；这些与产品算法差异分别记账。源/alpha/Undo持续保留完整16位数据。

全部样本和残差见 [原生阈值/色调分离报告](PHOTOSHOP_THRESHOLD_POSTERIZE_C080_2026-10-13.md)。旧画笔、羽化及透视残差继续沿用原生参考门槛，本批没有为了PASS放宽阈值。

## 失败记录与范围

保留早期新功能harness的错误对话框定位、在build结束前启动造成的旧bundle读取、ARIA标签误判，以及高位显示harness将普通导入提示误认兼容回退的失败目录。后续修正定位、启动顺序和精确断言，重新运行，不删失败证据。

历史alpha.21布局验收曾出现一次选区清除事件，没有当时输入trace；首失败截图/JSON继续保存在 `artifacts/alpha21-packaged-layout-first-failure`。本批有明确的输入框Backspace保护实测，仍不把所有偶发问题宣称根治。

本批不代表完整Photoshop、任意自然发丝/复杂PSD、PSD16写出、CMYK/CMM、HDR显示器、Windows真机或代码签名/公证已完成。112能力族仍为 **14基础可用、66部分实现、32缺少**；子项增加不自动改变整族。下一阶段依赖及执行顺序见 [开发计划](PHOTOSHOP_ALIGNMENT_PLAN_2026-10-13.md)。
