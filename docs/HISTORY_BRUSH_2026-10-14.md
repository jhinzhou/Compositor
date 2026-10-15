# 历史画笔与艺术历史画笔：保留源与局部恢复

日期：2026-10-14（Asia/Shanghai）。本文件说明独立 core/shared 实现及接入合同，实际工具栏/schema/Editor/worker验收以本轮最终集成结果为准。

## 功能依据与边界

Adobe 官方说明：History Brush 从选定的历史状态或 snapshot 取样，向当前同一图层局部绘制，其他编辑保持；用户选择历史源再用 Y 工具绘制。Art History Brush 使用 source 状态进行风格化笔触。参考 [History Brush 使用说明](https://helpx.adobe.com/ca/photoshop/desktop/get-started/set-up-toolbars-panels/paint-image-states.html) 与 [Art History Brush 使用说明](https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/create-fill-with-patterns/paint-stylized-strokes-with-the-art-history-brush.html)。

当前实现为功能恢复与产品近似：正常历史画笔局部恢复 source 的 RGBA；艺术历史画笔在当前笔触和选区范围，以 source 的预乘颜色平均形成局部色块，保留未覆盖区域。它不宣称实现 Adobe 私有 Style/Area/Tolerance 算法或原生像素效果。没有因为按钮同名就称效果对齐，也没有对缺乏具体函数问题的历史画笔做额外逆向。上述工具行为来自官方文档；恢复/艺术化的具体数学是本项目选择，不能标为 REA 原生内核证据。

## 保留源不是 Undo

`src/core/history-brush.ts` 提供 per-Editor `HistoryBrushSourceStore`。

```ts
store.capture(snapshot, {sessionId, revision, label, id?}, checkRetention?)
store.select(id)
store.selected(sessionId)
store.state() // {sourceId, snapshots:[{id,label,sessionId,revision,documentId,width,height}]}
store.clear()
store.retainedAssets()
```

捕获复制 Manifest 和资产 map，保留 Editor 的 immutable Asset 版本及真实像素 buffers，不向当前 assets map 临时按文件名找旧图，也不复制 displayBytes 作为高位深源。源在 source capture 后的变更、Undo/Redo 与新分支删除旧 future 时仍有效；capture/select 是工具状态，不把整个文档退回旧状态。最多保留 16 个 snapshot，超限移除最早者，允许显式选择已保留的源。

接入必须把 store 的源资产纳入 `Editor.retainedAssets()`、`assertAssetBudget()` 与全局 retained assets/checkAssets；capture 的 `checkRetention` 在任何 store 修改前执行，以实现使用宿主真实资源上限的拒绝。`install`、open/import/restore、新 session 必须 clear。source 元数据与旧 buffers 是本 session 的工具资源，不写入 `.comp`；完成的画笔结果是普通真实图层 Asset，由既有 commit 支持撤销、保存、重开。保存本身不清 source；重开会得到新的 session 并清 source。

## 像素路径

`applyHistoryBrushOperation(stage, action, source, sessionId?)` 的独立 `HistoryBrushStroke` 包含 `layerId,points,size,hardness,opacity,kind`，`kind` 为 `history` 或 `art-history`，继承 brush Flow/Spacing/Pressure，支持 smoothing。Art `artSize` 是 2..128 个 source pixels 的局部色块尺度，默认 8；UI 必须明确这是本项目近似的风格参数。

源与目标必须是同一文档、同一 layer ID，同文档网格、同图层位置/旋转/翻转/大小与 parent、同 raster 尺寸、同8/16/HDR精度。变更后的图层和源失配时拒绝，而不猜映射。图层名、透明度等不影响像素坐标的属性可保持当前编辑值。当前 locked、group、adjustment、text/shape 不被默默转换；editable source 也拒绝。当前选区和 brush coverage 限制恢复范围，source snapshot 的旧选区不替换当前选区。

- RGBA8 用预乘颜色与 alpha 插值，再还原直通 PNG RGB；透明源不把隐藏 RGB 混入可见颜色。
- RGBA16 和 HDR 在真实预乘工作网格上插值，完整覆盖直接恢复 source 值；16-bit low bits 与 HDR 负值、超白和 fractional alpha 保持。
- 同网格 blank source 可局部恢复透明；opacity 0 不产生新资产。
- Art 平均的是 source 预乘颜色/alpha；未覆盖部分不受影响。
- 所有 size/grid/512 MiB 工作预算在 source/target PNG8 解码前检查。brush 仍使用既有连续/dab coverage 和计算上限。像素输出完成、编码成功后才改 stage 图层和 map，不原地写 source/current buffers。

## 独立验证

`tests/history-brush.test.ts` 当前 15 项：每种8/16/HDR完整恢复；每种current选区局部恢复；每种Art真正改变覆盖区域且未覆盖区域保持；半透明/隐藏RGB与HDR部分插值；source在Undo分支删除后保留与newsession clear；capture预算失败原子性和snapshot选择；尺寸/placement/grid/precision/锁/editable拒绝；blank source与零opacity；大尺寸伪资产在PNG解码前拒绝。

```bash
./node_modules/.bin/tsx --test tests/history-brush.test.ts
npm run typecheck
```

这些为单元和现有Editor历史行为证据，不能替代后续 action/schema、worker、真实 pointer 交互、打包或独立原生 pixel 参考。
