# alpha.23：修复画笔与修补工具

日期：2026-10-13。本文记录核心实现与数值验证；原生 Photoshop 操作、Electron 桌面操作和统一打包验收由主任务另行记录，不把这些源码测试当作原生像素等价证据。

## Photoshop 使用约定

[Adobe 修补工具说明](https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/repair-a-selected-area-with-the-patch-tool.html) 将 Source 定义为选择需要修复的区域，将 Destination 定义为选择供体；在选区内拖动并释放后应用。Normal 类型还包含 Transparent、Pattern、Diffusion，Content-Aware 类型另有 Structure、Color、All Layers。[Adobe 修复效果示例](https://helpx.adobe.com/photoshop/using/healing-examples.html) 展示了纹理和周围亮度融合，以及 Diffusion 不同数值的效果。

本批实现 Source / Destination 的选区拖拽和周围颜色融合，仍未实现 Adobe 私有修复核、Diffusion 1–7 参数、Pattern、Content-Aware Patch 和 All Layers。界面的 Adaptation 是本项目自己的颜色校正强度，不应改名为已经像素对齐的 Photoshop Diffusion。

## 现有修复改进

`layer.retouch.healingModel` 是可选兼容开关。省略或 `compositor` 保留原先首点均值偏移与 nearest donor 的外观及所有旧调用；Photoshop 交互配置发送 `photoshop`。

该分支的 Healing Brush：

- 冻结笔划开始时原图供体；不从已经修复的像素反馈采样，重叠不会反复累积。
- 使用文档坐标的源偏移，保留小数。旋转、翻转、非等比图层按既有 document/source 变换映射。
- 双线性采样在 premultiplied RGBA 空间进行，透明像素不可见 RGB 不会污染边界。
- 计算选区外有效边界的 destination-minus-donor RGB 差分，通过 harmonic membrane 延伸到修复区域；供体纹理与颜色校正相加。
- 使用已算好的画笔与选区覆盖一次，避免原先再次乘软笔尖使软边偏弱。
- `protectAlpha` 保留目标 alpha；半透明供体的 alpha 降低力度，完全透明供体不产生修复。
- 无有效外围环时只保留供体纹理，不虚构周围颜色。没有 Adobe 原生像素等价声明。

Spot Healing 的现有上游核、模式与独立 C fixtures 不变。Photoshop 分支的外层应用尊重 `protectAlpha`，防止推断的 alpha 把透明洞扩展；默认模式的外观保持。

所有 retouch 的未覆盖像素现在保留原始 straight RGBA8 字节，避免无关的 premultiply/unpremultiply 舍入改变半透明像素。Opacity 0 返回原始 PNG bytes 与 placement，不经过解码/量化/生长；Photoshop alpha lock 同时保留已覆盖透明像素的隐藏 RGB。新采样修复仅 RGB8；16 位和 HDR 仍由高精度能力门禁拒绝，不会编辑 display proxy。

## 真正的 Patch 核心

动作参数：

```ts
{
  type: 'layer.patch',
  layerId: string,
  mode: 'source' | 'destination',
  offset: [number, number], // 文档坐标拖拽位移
  opacity?: number,        // 0..1，默认 1
  adaptation?: number,     // 0..1，默认 1
  protectAlpha?: boolean  // 默认 true
}
```

Source：当前选区是目标，目标点加 offset 采样原图。Destination：当前选区是供体，目标选区移到 offset 后，目标点减 offset 采样原图。两者均不清除原处；不像移动工具挖洞，也不像 Content Fill 自动搜供体。

`preparePatch(stage, action, {signal?})` 返回 `{png, transform, target:'image', selection, affectedPixels}`，不修改任何 manifest、assets、selection。`applyPatchOperation` 使用同一个纯准备函数，写入私有 stage；Editor 正常提交一次。Preview 调同一个函数并显示返回 PNG，取消丢弃即可；不能先 mutate 再 Undo 来模拟取消。Preview 与 Commit 都需要 revision/interaction 校验，以既有 controller 防止陈旧预览提交。

Source 保留目标选区；Destination 返回移动后的选区，与同一图像编辑一起提交和撤销。图层 placement、蒙版、供体原处及命名选区不变。RGBA8 PNG 原始资产作为供体，明确禁止高位深资产、组、调整、文本和形状图层；拒绝自身或祖先全锁。

不生长当前图层栅格，目标被文档和已有图层栅格裁切。完全没有有效 donor/destination 的请求给出错误；透明 donor 不会用黑色代替，也不会把 off-raster 坐标 clamp 到边缘。`protectAlpha=false` 允许正常 source-over 透明度合成，未选择的字节仍不变。

## 资源、精度与验证

共同求解器最多 4,000,000 个栅格像素、120,000,000 次保守工作计数；边界和求解只有覆盖区域的两像素扩展 ROI。超过预算或 AbortSignal 取消抛出错误，私有 stage 未提交，原图和 history 不变。不在 catch 后读取 8 位代理，也不隐式转换 16 位或 HDR。

针对测试：`tests/sampled-healing-alpha23.test.ts`。覆盖半像素 donor/透明隐藏色、纹理加颜色融合、单次软覆盖、alpha lock、Source/Destination 方向与供体保留、fractional/rotation/flip 映射、pure prepare 与 apply 字节一致、蒙版不变、取消、预算、无选区、高位拒绝、祖先锁、无效 donor，以及默认 legacy 与新分支差异。

邻近回归：`tests/retouch-edit.test.ts`，包括 9 组独立原版 C Healing fixtures、16 组 Warp fixtures、Clone All Layers、Gaussian/mask、growth、长反转笔划、100,000 输入路径与精确一次 Undo。

核心函数不等于 GUI 验收，Patch 选区绘制、拖拽预览、Escape、J/Shift+J 和一次 Undo 必须在统一实际应用验收中继续验证；原生 Photoshop 同图操作还需要专门效果对照。
