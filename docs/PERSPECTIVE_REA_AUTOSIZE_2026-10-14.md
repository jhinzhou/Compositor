# REA 透视自动尺寸与输出相位接入

日期：2026-10-14（Asia/Shanghai）。Photoshop 2026 27.11.0。范围：Photoshop interaction profile 的透视自动宽高；显式 ratio、手动输出宽高与 command/MCP 边坐标合同保持原有语义。没有改采样内核。

## 机制与来源

`src/shared/crop-projective.ts` 的自动尺寸路径由最长边／面积／最近深度下限近似，改为 REA 恢复的有效相机机制：以 source center 为主点求对边消失点和正焦距，将四角整平，在四条边两端分别取 10% 源线段，比较源长度与整平后长度；8 个比例最大值乘整平后对边平均长度。原生 `.9`、`1-.9`、`.1` 常数的不同 double 数值保留。

来源项目 `/Users/zhoujin/Documents/REA`：

- 原生几何函数 `0x104f38b64`，REA Evidence `ev_9b782e07baa573a43ed31571e662b742c15f1882e68fbd2dc833ff9e925e7be2`。
- 正值尺寸取整函数 `0x104e05fcc`，Evidence `ev_7b74aa2eae7bb3606a24431161d830f37c2909426b5b63fdcc7c90314cd688c6`。
- 独立研究候选 `research/perspective-size-candidate-v2.py` SHA256 `9c4643671ea24c9c29c7b7df3b3dd18aa7cebffb93505f0bbd88ead17c0f0aba`。
- 具体原生输出、冻结次序、失败与取整证据在 `reports/2026-10-14-rea-photoshop-research.md`。本次代码没有重新执行 Photoshop。

非正焦距、无限消失点或近 affine 形状保留最长边回退。推断 aspect 仍限于源跨度比的 1/4..4，最大角点面积仍必须保持四倍源跨度内；面积拒绝时保留原有 aspect 约束的最长边估计，避免近地平线产生巨大资源需求。整平过程新增有限性、同号分母、微小法线、有效线段比检查；自动输出还继续经过 side／surface 预算验证。危险区域的回退不宣称原生等价。

显式 aspect 沿用此前 longest-span 计算，不进入相机/phase分支。显式 MCP/command 输出尺寸不调用自动 helper，原 `perspectiveCropMatrix` 的 edge convention 没有修改。

## 尺寸回归与证据强度

产品 fixture `fixtures/parity/photoshop-27.11-perspective-size-rea.json` 只包含几何、原生尺寸、来源摘要；无需 REA 二进制提取或 Photoshop 安装即可测试。

- 旧已披露 37 例、第一次研究冻结后 10 例、第二次 v2 冻结后 9 例，共 56 例精确匹配。
- 只有最后 9 例属于**前次研究 v2 冻结后的独立原生验证**；所有 56 例现在都是本次实现已披露的回归数据，不称本次产品盲测。
- 旧 37 例原产品宽高误差合计 195 px，现 helper 在这批数据上为 0。
- 398×265 → 395×264；310×215 → 311×216；390×261 → 391×262；GUI 420×306 → 421×306。
- 旧 alpha26/27/28 fixtures 和旧研究候选保留。旧 alpha28 `nearestDepthPerspectiveSize` 脚本依赖 mutable production helper，不能在产品 helper 更换后再称它是旧冻结算法的独立求值器；历史尺寸与误差以旧 fixture 中已保存的候选输出为准。

## 输出相位不是拉伸额外像素

自动尺寸先 `rounded=floor(raw+.5)`，矩形平移 source center 后再形成整数 canvas extent：

```text
phase = center - floor(center)
extent = ceil(center + rounded) - floor(center)
originalQuadUV = ((pixel + .5) - phase) / rounded
```

`photoshopPerspectiveCropGeometry` 返回 `roundedSize`、`extent`、`phase` 与派生 `corners`。`perspectiveCropExtentCorners` 将原 source homography 外推到整数 canvas 覆盖区域；原采样器继续使用公开 edge map，在 extents 下自然得到上式坐标。用户绘制的四角保留，派生四角只用于自动尺寸提交。整数 center 与显式 ratio 的派生四角和原四角相同。手动指定尺寸应使用原四角。

纯 helper 在除法前检查外推范围的分母；一个原始合法 quad 的 pole 可能位于边框稍外侧，不能仅凭外推端点“仍然凸”放行。遇到跨 pole、非有限坐标或上限超出时安全拒绝，不分配像素，也不修改源图。

对前次保留原生 PNG 的只读复算，采用同一当前 High quality 内核，比较“直接把原 quad 拉伸到 extent”与“按 roundedSize/phase 外推 quad”：

| 已披露案例 | phase | RGB MAE 原映射 → 相位映射 | RGB max 原映射 → 相位映射 |
|---|---|---:|---:|
| fresh-half-tie | .5,.5 | 3.676888 → 0.473480 | 165 → 19 |
| even-center-quarter | .25,.75 | 6.455150 → 2.094422 | 206 → 58 |
| even-center-three-quarter | .75,.25 | 6.537330 → 2.087132 | 219 → 59 |
| odd-source-quarter-center | .25,.75 | 6.455578 → 2.087676 | 195 → 58 |
| even-center-integer | 0,0 | 2.093377 → 2.093377 | 59 → 59 |

所有这些图为 opaque，alpha MAE/max 均为 0；不能据此宣称透明图效果。half-tie 的不减 phase 外推 MAE 8.815828，反向 phase 17.258307；quarter 的相应值为 13.131398／25.028111。这些控制说明额外 extent 不能直接拉伸。此表是**已披露原生输出的诊断**，不是新模型冻结后的原生像素验收。RGB 尚有明显残差，完整采样内核、透明边界与新 GUI/安装包效果仍需独立验证。

复算使用原生 cohort 的 `nativeSourcePath`（此前 source RGBA exact 验证）和 `nativePath`；在 `perspectiveCropMatrix(originalCorners)` 上映射四个 extent 端点 `(-phase.x/rounded.width,-phase.y/rounded.height)` 至 `((extent.width-phase.x)/rounded.width,(extent.height-phase.y)/rounded.height)`，将得到的 quad 交给同一个 `perspectiveCropRaster`。本次没有执行原应用、变更插值偏好或改原生文件。

## 验证

本次新增测试除 56 例原生回归外，还覆盖：整数/quarter/负 center 相位与源奇偶解耦；直接 3D 正交矩形的透视除法解析尺度（不复写恢复法线算法）；phase增加1像素后 side/surface预算越界；explicit ratio 无 phase；输出外推立即跨 horizon 的解析反例；原quad不可变。

```bash
./node_modules/.bin/tsx --test tests/crop-*.test.ts tests/photoshop-perspective-*.test.ts tests/photoshop-crop-*.test.ts
npm run typecheck
```

尺寸精确、旧采样回归保持与 Photoshop 像素效果等价是不同验收。此文没有把单元/源代码证据扩张为真实 GUI、打包或发布完成。
