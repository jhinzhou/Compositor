# 侧栏隐藏工具对照与接入说明（2026-10-13）

本表对照截图的 C / I / L / J / W 五组 **22 项**工具。alpha.24 当前有 **8 项基础可用、10 项部分实现、4 项尚缺**。本轮新增移除、内容感知移动和红眼的独立交互与执行链，三项均属于部分实现，不能等同 Adobe 私有算法。alpha.23 的8/7/7保留为历史基线。源码、实际桌面与Photoshop效果证据分开验收；见 [alpha.24报告](PHOTOSHOP_ALPHA24_ACCEPTANCE_2026-10-13.md)。

| 组 | 截图中的工具 | 当前状态与执行路径 |
| --- | --- | --- |
| C | 裁剪 | 已实现。`cropMode=crop`，`document.crop`；普通裁剪保留画布外源像素。 |
| C | 透视裁剪 | 部分实现。`cropMode=perspective`，`document.perspective_crop`；全工作位深重采样，不能标为非破坏。组、调整、可编辑文字/形状、效果、参考线及羽化蒙版等有明确限制。 |
| C | 切片 | 缺少。无切片区域模型、命名、独立导出与操作模式。 |
| C | 切片选择 | 缺少。无切片选中、移动、尺寸编辑与自动切片管理。 |
| I | 吸管 | 已实现。`sampleDocumentColor` 对当前渲染画布取色；取样范围与全精度源读取仍不能由入口存在推断对齐。 |
| I | 颜色取样器 | 基础可用。I组 `color-sampler`：10个编号点、1–101px取样、原始8/16/HDR读数、merged/current来源、移动/Alt删除、保存重开/Undo；CMYK/Lab读数模式尚缺。 |
| I | 标尺工具 | 基础可用。I组 `ruler`：两点、Shift45°、端点/整线拖动、Alt第二臂、像素/毫米/厘米/英寸、DPI、持久化/Undo；不等于PSD测量日志/比例标定全套。 |
| I | 注释 | 缺少。无附着位置的注释数据、作者、文本和注释导航。 |
| I | 计数 | 缺少。无计数点、编号与计数组数据。 |
| L | 选区画笔（项目当前称“选择画笔”） | 已实现。`selection-brush` → `selection.paint`，直接绘制选区覆盖率，可增减选区。 |
| L | 套索 | 已实现。`lassoMode=freehand`，拖拽点形成多边形选区。 |
| L | 多边形套索 | 已实现。`lassoMode=polygon`，逐点建立多边形，完成或取消通过现有交互边界。 |
| L | 磁性套索 | 部分实现。L组 `lassoMode=magnetic`：图像边缘吸附、自动/手动锚点、宽度/对比/频率、Backspace、Enter/Esc和视图坐标；专有PS核、弱边及全部临时切换仍有差距。 |
| J | 污点修复画笔 | 部分实现。`retouchMode=spot-heal` → `layer.retouch`，含现有三种 healingMode；不据此声明达到 Photoshop 污点修复效果。 |
| J | 移除工具 | 部分实现。`remove` → `layer.remove`：涂抹/闭合圈选、独立预览、逐笔本地PatchMatch补全、一笔撤销；RGB8当前层≤2MP，无生成式AI、自动干扰物检测和跨层采样。 |
| J | 修复画笔 | 部分实现。`retouchMode=heal` → `layer.retouch`，Alt 选择取样源，再修复。 |
| J | 修补工具 | 部分实现。J组 `tool=patch` → `layer.patch`：选区Source/Destination拖拽、冻结供体和边界融合预览、Alpha保护、一笔撤销；alpha.25 RGB8源≤16MP、选区工作区≤4MP限定；Destination半像素误移已修复，高级内容感知与16/HDR链尚缺。 |
| J | 内容感知移动 | 部分实现。`content-move` → `layer.content_aware_move`：拖动选区、补原位置、融合目标，Enter应用/Esc取消，一步Undo；RGB8当前层≤2MP，Extend、Transform on Drop和多层取样尚缺。 |
| J | 红眼工具 | 部分实现。`red-eye` → `layer.red_eye`：单击/拖框、中心邻近红色连通区域、中性化、瞳孔大小/变暗量；alpha.25 RGB8源≤16MP、眼部工作区≤2MP。真实PS人工瞳孔样本已量化，外围软覆盖/自然眼睛仍不同。 |
| W | 对象选择 | 部分实现。`object` 的矩形范围交给 `selection.subject`；当前模型能力和自然边缘质量仍有独立验证边界。 |
| W | 快速选择 | 部分实现。W组 `quick-selection` / `selection.quick`：多种子区域增长、加减、All Layers、透明/颜色边界、一次撤销；Enhance Edge、语义识别和PS边界覆盖仍不同。 |
| W | 魔棒 | 已实现。`magic` → `selection.wand`，有容差、连续、取样范围、取样图层、选区组合参数；不能据此声明与 Photoshop 原生选区逐像素相同。 |

另有截图 22 项以外的 **裁剪拉直**（C 组中以独立模式显示）及 **矩形/椭圆选框**（M 组）。这3项不计入截图22项的状态。I组现有吸管、颜色取样器和标尺三个子工具，可右键/长按展开及Shift-I轮换。

alpha.25分组箭头为固定4px三角形；侧栏沿用18px图标/30px按钮，较矮窗口17px/28px，低于640px使用双列；外层记忆项、子菜单勾号和首次激活保持一致，子菜单每项有图标。界面仍不宣称所有参数和行为与Photoshop完全相同。名称/图形差异继续归入P1交互对齐。

源码证据：`src/renderer/App.vue` 的 Tool 类型、工具参数 refs、`chooseCropMode`、`applyCrop`、`selectionPaintAction`、`sampleDocumentColor`、`strokeAction`、`finishPolygon` 及 pointerDown/pointerUp；`src/shared/pixel-contracts.ts` 的 `selection.paint`、`selection.wand`、`layer.retouch`、`document.straighten`、`document.perspective_crop`；`src/core/pixel-actions.ts` 的对应 dispatch；`src/core/crop-actions.ts` 的拉直及透视实际执行。工作区标尺的独立证据是 App 的 `rulers` view 状态与 `WorkspaceOverlays`。缺项的结论限于当前 Tool union、registry、模式、action schema 及上述执行链，不以近似名称判为已有功能。

## 注册表与菜单接口

使用入口：侧栏带三角的按钮可以右键或长按约400ms展开；聚焦后Shift-F10也能展开。Shift-M/L/W/C/J/I轮换本组已经实现的全部模式。菜单中的上/下箭头、Home/End选择，Enter/Space应用，Escape或外点关闭。切换模式走真实工具事务清理，不能在绘制未完成时直接改一个图标。

### 原12个缺项及本批进度

| 工具 | 图片编辑中的用途 | 独立交付和验收要点 |
|---|---|---|
| 快速选择 | 刷过目标区域，选区随图像边缘扩展 | 图像驱动区域增长；加/减、边缘与透明区域、跨图层采样；不能仅绘制圆形覆盖 |
| 磁性套索 | 沿轮廓移动时吸附边缘并建立控制点 | 自动/手动锚点、吸附宽度与阈值、删除末点、完成/取消；低对比度留出样本 |
| 修补 | 用另一处图像修复一块选中区域 | 拖拽源/目标、纹理和亮度融合、一笔事务、透明和选区边界 |
| 移除工具 | 以笔划指定对象，再补全背景 | 对象范围、连续笔划、逐笔/批量应用、纹理延续；普通选区填充不能冒充该链 |
| 内容感知移动 | 移动对象，同时补原位置并融合目标 | 目标变换、原位置补全及目标融合必须在一次可撤销操作中完成 |
| 红眼 | 修正闪光造成的红色瞳孔 | 局部范围和强度控制、保留高光/周围皮肤、非红眼不得误改 |
| 颜色取样器 | 保留多个位置的颜色读数，比较调整前后 | 持久点位/编号、Info读数、真实源精度与取样范围、保存重开 |
| 标尺工具 | 测量画布上的距离和角度，辅助对齐 | 两点测量、单位/分辨率、旋转/缩放视图下坐标一致；工作区刻度不代替测量 |
| 注释 | 在图像位置记录编辑说明 | 位置、作者/文本、导航和持久化；导出是否包含注释须明确 |
| 计数 | 给图像中的目标编号并统计 | 点位、编号/分组、可见性和保存；缩放后标记位置不漂移 |
| 切片 | 将设计分成多个可单独输出的区域 | 区域模型、名称、边界、导出尺寸/格式；不会自动等于Web页面代码生成 |
| 切片选择 | 选择和调整已定义的切片 | 选择/移动/尺寸、区域关系和Undo；依赖切片模型先完成 |

开发顺序仍遵循已接受方案：先完成现有部分实现链的交互、像素与保存，再按依赖添加以上缺项。详情见 [AI批次计划](PHOTOSHOP_ALIGNMENT_PLAN_2026-10-13.md)；这张用途表是缺口定义，不是完成承诺。

新增 `src/renderer/tool-groups.ts`，真实模式顺序固定：

- M：矩形选框 → 椭圆选框。
- L：选择画笔 → 自由套索 → 多边形套索 → 磁性套索。
- W：对象选择 → 快速选择 → 魔棒。
- C：普通裁剪 → 透视裁剪 → 拉直（项目额外模式；不插在两个原版裁剪工具中间）。
- J：污点修复 → 移除 → 修复画笔 → 修补 → 内容感知移动 → 红眼；模糊属于其他组，不列入 J 菜单。
- I：吸管 → 颜色取样器 → 标尺。

导出 `TOOL_GROUPS`、`toolGroup(id)`、`toolGroupForTool(tool)`、`selectedToolGroupEntry(id,state)`。每个 entry 包含 `id`、翻译 key `label`、`tool`，以及其模式需要的 `ellipseSelection` / `lassoMode` / `cropMode` / `retouchMode`。所有注册项只读且冻结。`selectedToolGroupEntry` 按模式精确匹配；例如遗留 `retouchMode=blur` 不会误打勾成“修复画笔”。

新增 `src/renderer/ToolGroupMenu.vue`，props：

```ts
{ open: boolean; group: ToolGroupId; selected?: string;
  anchor: {left:number;top:number;width:number;height:number}; disabled?: boolean }
```

`anchor` 使用触发按钮 `getBoundingClientRect()` 的视口坐标。菜单 Teleport 到 body，以 fixed 定位在触发按钮右侧，空间不足时收进视口；小窗口有滚动和宽度限制。事件为 `select(entry)` 和 `close()`，组件不修改工具或父级开关状态。选择时先发 select 再发 close；外部点击、窗口失焦、Escape、Tab 只关闭。键盘 Up/Down 循环、Home/End 跳到首尾、Enter/Space 应用。role=menu/menuitemradio，ARIA checked 指向实际父级选中模式，roving tabindex，不让菜单键盘和 pointerdown 传给画布快捷键/笔划逻辑。关闭后的焦点恢复由父级负责。

接入必须调用现有 `await chooseTool(entry.tool)`，确认实际 `tool` 已切换且当前不 busy/drag 后，才应用模式；裁剪调用 `chooseCropMode(entry.cropMode)`，不能只改 ref 绕过 overlay 与 draft 清理。同一个主工具也须更新 variant（自由套索与多边形、两种修复、三个裁剪模式）；不能只对 Tool 字符串循环。右键、长按、Shift+F10 和工具三角标识由 App 接入。Shift+L / Shift+J / Shift+C 等循环复用 registry 的完整 entries，避免只轮到两个工具值而遗漏同工具的模式。

## 历史组件验收证据（alpha.22）

`npx tsx --test tests/tool-groups.test.ts`：7 项通过。覆盖完整真实模式清单与顺序、排除缺失占位工具、模式精确选中、视口位置、小窗口、实际 SFC handlers 的选中聚焦/UpDown/HomeEnd/Enter/Space、受控状态不被修改、Escape/Tab/外点/失焦关闭、listener 清理、disabled 阻止应用、父级切换组和重新打开、template 编译及菜单语义。`npx vue-tsc --noEmit`：通过。

这些是注册表及真实组件处理器的定向验证；实际桌面长按、右键、快捷键与编辑事务组合的验证由主任务执行，尚未在本报告中当作完成证据。

主流程已接入右键、400ms长按、Shift+F10及真实模式轮换；alpha.22分组基线保留在[历史验收](PHOTOSHOP_ALPHA22_ACCEPTANCE_2026-10-13.md)，新增模式的最终实测与截图见[alpha.23统一验收](PHOTOSHOP_ALPHA23_ACCEPTANCE_2026-10-13.md)。组件定向检查不代替整个桌面门禁。

## alpha.23 使用和验收补充

已补齐五个真实工具入口；原12个缺项中的磁性套索、快速选择、修补、颜色取样器和标尺已进入本轮实际操作验收。其余7项为切片、切片选择、移除、内容感知移动、红眼、注释、计数。原12项用途表是依赖说明，不能据该历史表头判定本轮仍缺12项。

Info面板通过 Window → Info / F8 打开。持久化点位随 Canvas Size、Crop、Image Size、Flip/Rotate、Straighten、Perspective Crop 映射，裁掉的点可保留负坐标以便扩画布恢复；15项真实Editor几何/Undo/保存重开测试已通过。单纯metadata编辑不清除Reselect。

新增工具的真实桌面验证与源精度边界见 [本轮验收](PHOTOSHOP_ALPHA23_ACCEPTANCE_2026-10-13.md)。注册表/组件测试不代替桌面效果；自然照片/发丝及专有算法仍按独立PS样本门槛推进。

## alpha.24 使用和验收补充

新增3项独立修复工具，J组为6项；侧栏根据当前子工具或记忆项显示图标、名称及快捷键，弹出菜单的图标、勾号和默认焦点使用同一项。悬停只改变高亮，不冒充选中。图标18px、按钮30px；较矮窗口使用17px/28px，低于640px双列。实际桌面四种尺寸、中文/英文菜单与全部子工具切换见[alpha.24统一验收](PHOTOSHOP_ALPHA24_ACCEPTANCE_2026-10-13.md)。

移除使用局部内容补全；内容感知移动拖动后Enter确认、Esc取消；红眼点击或框选。三项当前限RGB8当前栅格层及200万源像素，没有生成式、所有图层采样或输出新图层保证；效果和原生残差详见统一验收。
