# Alpha.23：图像驱动选择与磁性套索

本说明涵盖选区分析内核与文档坐标接入；工具入口、快捷键、鼠标操作、主进程 revision 校验与最终桌面验收由统一集成验收覆盖。没有声称复刻 Photoshop 的私有选择算法。

## 已有选择执行路径审计

- `selection.wand`：`pixel-actions.applySelectionRaster` → `selection-retouch.magicWandSelection`。PNG 直通道转换为预乘 RGBA 比较；支持 point / 3×3 / 5×5 clipped average、连续或全局、四种组合。现有 `selection-native-parity` 使用原版 `WandPixels.c` 编译 oracle 的 54 个 wand + 8 个 Color Range 对照。保留该匹配公式及透明像素语义。
- `selection.color_range`：相同 document sample 管线 → 多包含／排除颜色匹配、softness、invert。不会将颜色范围改名为快速选择。
- `selection.paint`：`shared/selection-paint` 直接灰度覆盖笔划，属于选区画笔／Quick Mask 编辑。它不提供图像边缘吸附，本批快速选择不调用该内核。
- 选择图像先经过 `sampleLayerInDocument`，遵循图层 placement、rotation、flip、sampling 和透明区，参数及结果均用文档坐标。全部图层须由 command controller 提供同 revision 的合成图。
- `appendSelectionShape` 保留已有反相／羽化覆盖，按 replace/add/subtract/intersect 组合。新操作的 AA 标记在追加时传入，而非生成之后修改；新快速选择自己生成灰度 AA raster、feather 仍使用已有 Selection 模型。

既有 wand 的 AA 开关对于整数对齐二值 raster 目前没有额外边缘 AA，其效果不应描述为等同 Photoshop。采样平均可能不匹配点击像素属于原版已验证行为，不能当 bug 强行改掉。

## 快速选择

`quickSelection(image, points, {size, tolerance=32, edgeSensitivity=.65, antialiased=false}) → RasterSelection`。

1. 依笔划行程插值画笔足迹，足迹的非透明像素作为连接种子，并训练最多 32 个色彩代表。
2. 连通 frontier 生长同时约束颜色代表距离、局部相邻色差及 alpha 边界；允许小幅纹理变化，但限制离开画笔实际颜色的累计漂移。
3. 连通区域可扩展到画笔之外；跨强色差／透明 gap 的增长受阻。再次画过另一颜色可有意增加新的种子类别。
4. AA 启用时，对二值边界做一次 3×3 加权覆盖，零 alpha 位置仍为零。它是一像素边界模型，并非 Photoshop Auto Enhance 或发丝抠图。
5. 输出是只读 RGBA 图分析结果，不改变图像。`selection.quick` dispatch 完整生成覆盖及有界 RLE 后才安装 Selection，支持 feather 及四种 operation。

Action 字段：`type='selection.quick'`，`layerId`，`points`，`size`，`tolerance`，`edgeSensitivity`，`sampleAllLayers`，`antialiased`，`feather`，`operation`。默认值以 `pixel-contracts` 为准；主界面可按 Photoshop 习惯使用 W 工具组、Alt 暂时减选与 [ / ] 笔径。

分析用当前层保存的 SDR display proxy 或 revision-matched SDR composite。RGB16 / HDR 源字节和精度数组完全保持；色彩差异判断本身不是 16-bit / HDR 浮点颜色比较，暗部与高亮细节可能难以区分。

## 磁性套索

`magneticLassoPath(image, points, {width=24, contrast=.1, frequency=20, closed=false}) → PixelPoint[]`。

- 按鼠标行程放置分析锚点，减少不同 pointer event 密度造成的结果差异。
- 在 width 范围内根据预乘颜色和 alpha 的梯度吸引锚点；contrast 排除弱梯度。
- 以梯度为权重，对相邻锚点的有限 corridor 做 8 邻域最短路径搜索，曲线边缘可产生弯曲路径，而非把粗略鼠标轨迹直接当多边形。
- 不可见 RGB 不产生颜色梯度；alpha 边界可被识别。邻近强边缘可能吸走锚点，需要减小 width 或增加控制点。
- `frequency` 越高，行程锚点越密。width 的单位是文档像素。本批没有 pressure 自动改变宽度或 Photoshop 手动强制锚点／临时多边形的私有实现。

`magneticSelectionPath(stage, {layerId,points,width,contrast,frequency,closed,sampleAllLayers}, composite?)` 是 readonly 文档 wrapper：先校验文档预算，再读 display source，经 `sampleLayerInDocument` 分析，返回文档坐标。它不会改 selection、asset、manifest 或 history；命令控制器需校验 revision，完成之后由现有 polygon 选区模型应用 AA、feather 和加减交。取消不产生工程变更。

## 预算与失败原子性

| 项目 | 上限 |
|---|---:|
| 分析图 / 当前层 source | 16 MP |
| 用户笔划输入 | 4,096 点 |
| 快速选择插值足迹 | 4,096 个 |
| 快速选择足迹像素访问 | 4,000,000 |
| 快速选择邻居访问 | 64,000,000 |
| 快速选择颜色模型比较 | 128,000,000 |
| 磁性单段搜索 ROI | 262,144 像素 |
| 磁性累计吸附 / 路径搜索 | 各 4,000,000 |
| 磁性输出路径 | 100,000 点 |
| 序列化选择 RLE | 沿用 100,000 runs |

快速选择工作数组最多约 7 bytes / pixel（RGBA sample 和 source 解码另计），AA 阶段另加 1 byte / pixel。实际可选区域复杂度可能先触发 RLE 或颜色计算预算。超预算明确失败，保留已完成工程状态；不会静默降采样、截断笔划或借低位代理改写源。

## 验证及效果界限

独立测试：`tests/image-driven-selection.test.ts`、`tests/image-selection-integration-alpha23.test.ts`。覆盖纹理区域增长、多个颜色种子、透明 barrier、AA、曲线梯度路径、鼠标轨迹细分稳定性、四种 selection operation、feather、翻转与文档 placement、RGB16/HDR 原数据保留、prepared composite、Editor revision/idempotency/undo/redo、拒绝时状态保留与资源边界。

受控 1000×1000双色纹理样本，本机单次 Quick Selection + AA 为约 37ms；960px 磁性路径约 11ms。仅为合成样本初步性能观察，不能外推自然复杂图片质量或最坏耗时。

质量边界：快速选择使用颜色与局部梯度模型，缺少 Photoshop 智能语义、多尺度纹理学习、Auto Enhance、复杂毛发识别；磁性在低对比、纹理噪声、拥挤近邻边缘上可能选错边。两者基础实现仍需用户真实图片和原生 Photoshop 操作的统一验收后评价，不将测试通过当作视觉等价。

## 磁性套索交互生命周期

`renderer/use-magnetic-lasso.ts` 暴露 `useMagneticLasso({state, selectedId, options, canStart, point, identity, send, commit, onError?})`，返回 `active`、`points`、`start(event)`、`move(event)`、`finish(cancel?)`、`backspace()`、`dispose()`。

首次点击捕获 document/revision、当前图层、工具参数、Shift/Alt 加减交操作，并持有一个 interaction lease。随后未按鼠标的移动也持续跟踪，按行程控制点抽样，点击增加控制点；双击或上层 Enter 调用完成。`points` 显示实际内核吸附路径。Backspace 回退上个控制点及后续段；上层 Esc/tool 切换调用 `finish(true)`，窗口 blur、document/revision/图层切换自动取消。

预览最多单航班，多个移动合并到最新轨迹，通过 ticket 丢弃过期回复。完成等开放预览退出后再请求 `closed:true`，重新检查 revision，然后仅对非退化闭合路径提交一次。取消不必等待晚到预览即可释放 lease；最终闭合预览晚到也不会提交。4096 点交互预算取消整个 draft、保留已有 Selection，并通过可选 `onError` 提示；不会截断尾段后提交。

`tests/magnetic-lasso-gesture.test.ts` 使用真实 Vue refs/watch 与可控异步桥，验证 acquisition 期间取消、hover 自动跟踪、modifier 固定、coalescing、旧回复丢弃、Backspace、canvas clamp、预算、revision/session/图层变化、closed 单提交、窗口 blur 和 pending closed 取消的 lease 生命周期。该测试属于 renderer 状态及竞态验证，不是原生 Photoshop 鼠标操作或真实 Electron 桌面验收。
