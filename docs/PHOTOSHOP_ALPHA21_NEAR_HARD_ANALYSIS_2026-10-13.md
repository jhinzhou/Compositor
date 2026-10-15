# alpha21 近硬画笔环带分析与保守修复

2026-10-13。范围：computed round tip 的 document-pixel Alpha 覆盖；沿用实际 Photoshop 27.11.0 `strokePath` 的原生透明诊断图。本报告不声称取得 Photoshop 私有笔尖算法，也不把原生脚本执行 PASS 当成项目效果一致。

## 原生依据与冻结边界

原有 v2–v6 共112个 RGB8 参考保留。Root 在实际 Photoshop 新采 v7：47次执行、46种唯一设置，16px/h85 重复设置相同。新覆盖包括48/64/96/128px 的85–100%硬度，16/32px 的92/94/96/97/98%，8/16px80/85%，以及64px硬度90/95/97、Flow20/Spacing20的线条。

源 PNG 与 rawAlpha 不作修改。旧RGB16参考仍由原测试验证。以下文件冻结修复前源码、coverage和候选数学源代码：

- `artifacts/photoshop-native/measurements/alpha21-near-hard/alpha20-brush-dynamics.ts`
- `alpha20-coverage.json`：原112项，创建后不重新生成。
- `alpha20-v7-coverage.json`：新46项，修复前源SHA与上文件相同。
- `alpha21-candidate-before-adoption.ts`：独立候选源，SHA与新增限值文件一致。
- `fixtures/parity/photoshop-alpha21-brush-limits.json`：只新增v7候选阈值，原51/v6阈值不修改。

两个覆盖快照对应 alpha20 源SHA：`56a5c5c42bb2ba558c2487d0c016404ace7f624be303a69e3cc0c2884439b1c9`。

## 误差位置与候选排除

64px/h95 原误差 max41；几乎全部是正的环带差异。R±2环带MAE16.84，内部MAE.027，平均带符号误差+3.70。因直接比较Alpha，该差异不是透明RGB或premultiplication造成的。高位深源合成也不参与此数学覆盖对比。

此前near-hard filtered shoulder向固定hard CDF过渡时，core几何修正只存在于shoulder分支；混合的硬边会使足够宽的肩部偏亮。将所有core修正直接套到硬边会使64px/h99和16px/h96–98变差，故未采用。无上限宽度位移虽64px/h95 max41→14，却使128px/h95 41→47；未采用。

诊断性的 apparent radius/AA 拟合仅用于发现空间规律，不作为产品lookup。原生32px h94/h96/h98拟合半径分别约R−.24/R−.28/R−.08；64px h95/h99约R−.40/R−.06。原生的非单调偏差不能由单调hardness曲线全部消除。拟合脚本 `scripts/measure-photoshop-alpha21-effective-edge.py` 和 `effective-edge.json` 保留了这些不利证据。

## 采用的统一连续规则

仅对显式Photoshop model改变近硬tip数学：

```
sigma = radius * (15/32) * (1-hardness)
b = smoothstep(clamp((hardness-.9)/.1)) // 原有 hardBlend
w = smoothstep(clamp((sigma-.375)/.375))
g = .25 * w * hardness^8 * 8*b^2*(1-b)
```

将同一个g同时从near-hard shoulder core和hard CDF radius减去。参数是document-pixel AA尺度：保留既有.75px AA，以其半宽控制已解析肩部，用quarter-pixel尺度约束最大几何影响。没有按fixture名称、尺寸、硬度分支的lookup。

该保守规则保留h0、h100、h≤.9与sigma≤.375，且在宽度阈值、90%过渡与100%endpoint连续。更强.375/.5px候选使64px/h95降至max14/13，却使48px/h95 max12→14/18，因留出退化被排除。最终.25px并非完整私有内核重建，而是减少经多尺寸验证的过亮环带。

Compositor/未标记legacy、arc spacing、Math.fround距离、dab计数、opacity/flow累积、压力、ROI/growth footprint、80M visits/200k dabs预算均沿用。新增计算每dab一次，不引入卷积采样或额外像素遍历。RGB16/HDR仍由同一个覆盖乘入源精度合成，不经过PNG8目标回写。

## 158项实际产品结果

独立候选与实际产品的158条coverage数组全部逐字节相同；所有行见 `adopted-results.tsv`，完整候选、空间分区和剖面见 `comparison.json`。

按unionMAE变化：15改善、142逐字节相同、1轻微退化。原112项中1改善/111相同，无退化；v7中14改善/31相同/1轻微退化。唯一退化是48px/h92：MAE增加.018，max仍9。这里没有隐藏退化或将阈值放宽成“对齐”。

| 独立参考 | alpha20 max / MAE | alpha21 max / MAE |
|---|---:|---:|
| v6 64px h95 dot | 41 / 3.709 | 21 / 1.872 |
| v7 48px h95 dot | 12 / 1.369 | 11 / 1.226 |
| v7 64px h95 dot | 41 / 3.711 | 22 / 1.866 |
| v7 96px h95 dot | 41 / 2.648 | 25 / 1.595 |
| v7 128px h95 dot | 41 / 2.097 | 27 / 1.413 |
| v7 64px h95 Flow20 Spacing20 line | 21 / 2.251 | 18 / 1.700 |
| v7 64px h97 Flow20 Spacing20 line | 19 / 1.706 | 19 / 1.639 |

仍有实质差异：96/128px h100保持原产品结果，max34/32；48px h90 max26；部分95–99肩部仍有10–27级差异。原生hardendpoint大尺寸的AA轮廓不同于8–64px测试，不能把已通过的旧端点门槛外推为大尺寸等效。v7固定阈值用于锁住当前实测边界，不是完美一致证书。真实自由手绘/笔尖速度、tablet压力、其它形状/角度/texture未由这些strokePath诊断验证。

## 定向验收

- 原画笔spacing/dynamics、51原生参考和v6：134/134 PASS，原阈值未改。
- 新v7 rawSHA/46原生边界、尺寸/硬度连续性、低Flow稀疏/密集事件等价：49/49 PASS。
- 新16/HDR近硬环带paint/erase低opacity源精度、preview/commit、Undo/Redo，加已有高精度目标：99/99 PASS。
- 严格定向TypeScript：PASS。共282目标测试PASS。

测试log为本目录 `existing-tests.log`、`new-tests.log`、`high-depth-tests.log`。目标严格TS命令：

```
npx tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler --esModuleInterop --skipLibCheck --types node src/shared/pako.d.ts scripts/measure-photoshop-alpha21-near-hard.ts tests/photoshop-brush-alpha21.test.ts tests/high-depth-brush-alpha21.test.ts
```

`.001` opacity只用于我们源精度保真，不当作Photoshop .1% UI黄金。负值/overwhite HDR、premultiplied源、擦除alpha与完整Undo源引用均由新高位深测试验证。整包/GUI/版本发布验收由Root单独负责，本分支不操作实际Photoshop GUI，不运行完整check或提交Git。
