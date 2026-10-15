# Frame 与 Pen/Path 工程基础能力

日期：2026-10-14（Asia/Shanghai）。范围为矩形/椭圆 clip-frame 和可编辑 cubic Bézier path；复杂 Photoshop boolean、Style/PSD vector 构造与原生逐像素效果仍为 PARTIAL。这批模型与渲染机制是本项目工程选择，不是已通过 REA 还原的 Photoshop 私有 Frame/Pen 内核。

## Frame：源图与剪裁边界分开

`shared/frame.ts` 严格验证 `{kind:'rectangle'|'ellipse',bounds:[x,y,w,h]}` 并计算 cover/contain content placement。`core/frame-edit.ts` 提供 create/place/set_bounds/set_content_transform 独立 actions。

Frame 图层 `imageFile` 始终保留原始完整 raster；`layer.transform` 是可独立移动/旋转的 content placement。`frame.bounds` 是 clip 边界，真实 clip 由 `maskFile + maskPlacement + maskLinked=false` 实施。mask 外部显式为 0，矩形 mask 也不被边框白色平均误判为无限 reveal；最低 2×2 网格避免既有 1×1 均匀 mask 的无限覆盖合同。椭圆 clip 使用 2×2 supersampling，均经过尺寸、512 MiB 与工作量预算。

因此移动图像可以显示之前在 Frame 外的原始像素；调整 frame bounds 不会缩放或破坏源图。默认 cover，contain 可选。place/replace 复用一个现有 raster 图层的 immutable source Asset，复制拥有者文件名，保留 PNG16/HDR buffers，不使用显示代理。通用 core place 不隐藏 donor；UI 可把 place 与 donor hide 放在同一 undoable batch，使源层保留、隐藏，并说明这一行为。

Frame 通过原有渲染、mask、保存资产列表与 undo stage 管道工作，不引入额外不可追踪的 sourceFile。`manifest.ts` 语义验证要求 frame 有自己的 enabled independent clip mask；普通 mask 修改不能默默拆掉其 container 语义。当前 raw image placement 不继承 donor 的图层 effects、opacity 或 transform，等同置入该图层的源图像素。

## Pen/Path：真正的锚点与控制柄

`shared/vector-path.ts` 定义严格 cubic knots：每个 knot 有稳定 id、document-coordinate `point`、可选绝对 `inHandle/outHandle`。多 subpath 支持 open/closed 与 nonzero/evenodd fill。整体限制 64 subpaths、4096 knots、10万 flatten points；坐标有限并限制在 ±100万。

提供：

- cubic 求值、adaptive de Casteljau flatten 与 SVG path；collinear control overshoot 不被错误压成简单直线。
- move knot 同步平移 handles；独立/symmetric handle 编辑；delete knot；exact cubic segment split，增加节点不改变已有曲线。
- 4×4 scanline AA coverage、nonzero/evenodd compound hole、真实 raster selection。填充或转换选区时，open contour 以直线闭合，类似 SVG fill；描边/编辑仍保留 open 状态。
- 整体扫描工作预算在覆盖 buffer 分配前检查，选区 runs 继续限于 10 万。

`core/path-edit.ts` 把 paths 作为 `manifest.vectorPaths:[{id,name,path}]` 保存；支持 set/delete/select/fill/vector-mask。fill 复用既有 source-depth 填充核，与当前选区相交后恢复原选区。Vector mask 保存 editable path metadata 与真实 PNG8 grayscale fallback，现有 renderer/export/deep paths 直接使用 mask。编辑同一 stored path 会重新生成关联 vector masks；锁住的关联 mask 或超预算使整次更新拒绝，不部分更新路径或 masks。path 删除保留已经应用的 mask raster/独立 vector geometry；重建工作 path 后可重新关联。

Frame 已占用 clip mask，因此不会被路径蒙版覆盖。复杂 boolean 组合、导出 Photoshop 原生 vector-mask descriptors、任意旋转/剪切 Frame boundary、path stroking、高阶 Pen 自动曲率与 shape-layer Style 仍未称为完成。

## 坐标变更与持久性

`mapVectorPath(input, pointMapper)` 映射 anchors 与两侧 handles；它适用于 affine 变化，不能把 projective cubic 变换当成精确 rational curve。

`core/vector-frame-metadata.ts` 的 `transformVectorFrameMetadata(stage, mapper)` 同步 document paths、layer vector-mask path 和 frame 四角 envelope。Frame 只接受 translation、flip、90°转向、轴向缩放；任意旋转/剪切安全拒绝，不拿 envelope 冒充原 clip。全部 metadata 先验证后赋值。调用者同时使用既有 raster/placement 变换；这不额外重采样源图。当前 straighten/perspective 含 Frame 的组合需要明确拒绝或单独实现，不静默丢 container 数据。

新 metadata 有 typed contracts 及 `manifest.ts` 验证。`.comp` 保存使用原有 manifest 与 imageFile/maskFile 资产路径，旧无这些字段的项目不受影响。Path/Frame 实际 action Undo、MCP、UI integration 验收由本轮最终工程检查记录，不能仅用模型测试替代。

## 组件与控制接口

- `VectorPathOverlay.vue` props：path,width,height,zoom,mode pen/path/edit、disabled、spacePan、可选 mapClientPoint；emit update/commit/interaction/cancel/selected/deletePath。Pen 背景点击/拖拽添加锚点/双柄，点击首点闭合。黑箭头 Path Selection（A，path mode）命中轮廓/填充后统一平移当前 named path 的全部 subpaths、anchors 与两侧 handles；隐藏节点控制，不改变曲线形状，Delete 删除整个 named path。白箭头 Direct Selection（Shift+A，edit mode）编辑单个节点/handles，Alt 打断对称，Delete 只删除选中节点。黑箭头拒绝 Add/Delete/Convert 节点 API；切换工具会取消拥有的手势。expose finish(cancel)、splitSelected、deleteSelected、convertSelected。高级多 named paths 联合选择与 boolean 仍为 PARTIAL。
- `VectorPathPanel.vue` 为 stored path 选择、新建、删除、selection/fill/mask 操作发出独立 events。
- `FrameOverlay.vue` props frame/contentTransform/mode/zoom/viewAngle；边界与 content drag 分离。expose finish(cancel) 同时终止原 CropOverlay 与 content 手势；取消、失焦、unmount 都恢复草稿并释放 interaction。
- `FrameContentPanel.vue` 选择现有源图、cover/contain 和边界/content模式；title说明 source保留隐藏。语言字典在 `locales/vector-frame.zh-CN.ts`，已由本轮中央 catalog 接入。

所有 pointer 控制按 pointer ID 归属，commit 在 lease release 之后发出。root App 负责 lease/revision、selected owner/session 校验、工具切换取消和真实 batch/action dispatch。

## 已验证证据

专有 tests 当前 30 项：严格模型/不变性、解析 cubic midpoint与曲线误差、exact split、compound hole与fractional AA、真实 frame mask/cover/content独立移动、8/16/HDR source保留与 `.comp` roundtrip、16-bit真实 clip composite、8/16/HDR path fill与live mask、locked/非法大图原子拒绝、metadata affine同步与Frame危险变换拒绝、真实SFC pointer/anchor/handle/close/cancel/selection操作、黑箭头 compound path 平移/整路径删除与白箭头独立节点编辑、真实 Editor batch/clientRef/UndoRedo 与几何 clip guard。

```bash
./node_modules/.bin/tsx --test tests/vector-path.test.ts tests/frame-path-edit.test.ts tests/vector-frame-overlay.test.ts tests/vector-frame-metadata.test.ts tests/frame-path-command-alpha29.test.ts
```

这些是实际模型、资产与Vue SFC控制器运行证据，没有启动桌面 app 或 Photoshop，也没有新独立原生 Pen/Frame 样本。因此不能从这组测试宣称 Photoshop 像素效果或高级格式完全对齐。

`scripts/smoke-vector-frame-alpha29.ts` 是 root-only 串行桌面验收入口：真实 K 创建/取消/置图/独立 content preview/边界调整，P cubic 创建闭合，A 整路径移动与 Shift+A 节点移动/删除，以及黑箭头整路径删除、真实 stdio MCP 路径与 Frame commands、RGB8/PNG16 保存重开。脚本只准备与静态检查；其运行结果须以实际 desktop report 为准。
