# alpha.28 透视裁剪自动尺寸：最近相机深度下限

本批在 Photoshop 配置的自动尺寸建议中加入解析相机模型的最近深度分辨率下限。37个已记录尺寸中，总宽高绝对误差从238降至195px，10例改善、27例不变、零退步；正常文档中心的28例从52降至26px。**这仍是有边界的改善，自动尺寸尚未与Photoshop完整一致。**

旧alpha.26文档中心独立例398×265对395×264的3×1残差保留；旧alpha.27的strong两例从309×215变成310×215，对原生311×216仍差1×1。新6例独立原生参考中，4例各剩1×1、2例精确；新真实GUI原生421×306，项目仍420×306，剩1×0。

## 参考与冻结顺序

原alpha.26/27的26例全部已见，本批只将其作为旧参考，不宣称新的盲测。root另外在Photoshop 27.11.0中实际通过Browse运行4个自动尺寸校准：512×384新源上的强透视、同形平移以及另一自动透视几何。全部不提供目标宽高或分辨率，每例重新打开独立物理输入，源RGBA逐字节精确，偏好保持不变。

root在候选文件冻结前的消息中已披露4校准输出，所以4例始终标记 `calibration-not-blind`。最近深度机制提案早于该披露；但冻结时间边界不能据此移到更早。正式candidate源码在2026-10-14T05:58:46.474Z冻结，SHA256 `f26949c57de80292fb6b3eaac2ab4f70ae28d31c05551c124ad2fc1e49293793`，原始冻结记录为 `artifacts/alpha28-size/candidate-freeze.json`。校准输出用于验证，不用于选择系数。

随后root实际采集6个独立自动尺寸案例，包含新strong、围绕同一文档中心的0.5及1.12倍几何、90°旋转后384×512源、非对称几何和单消失点梯形。该6例是在原candidate SHA冻结后采集与释放，不参与推导或调参。root又通过真实C工具鼠标拖角点和Return采集独立GUI；它的四角以observer记录的ActionDescriptor为准，不以手写或屏幕估算的坐标替代。

几何fixture分别保存于：

- `fixtures/parity/photoshop-27.11-perspective-size-calibration-alpha28.json`：4例已披露校准。
- `fixtures/parity/photoshop-27.11-perspective-size-independent-alpha28.json`：6例原冻结后独立ActionManager参考。
- `fixtures/parity/photoshop-27.11-perspective-size-gui-alpha28.json`：独立真实GUI事件，仅几何、PNG头尺寸与hash，不解码或评估采样效果。
- `fixtures/parity/perspective-size-alpha28-crossgate.json`：36例旧/校准/独立的原baseline及冻结candidate结果；算法结果字段不是新增原生参考。

## 几何依据与实现

此前模型从单位矩形逆映射 `H` 与文档中心主点 `(cx,cy)` 推断正交相机比例，按最长源边和最大角点源像素面积取输出下限。面积包含投影的缩短效应，无法保证一个倾斜平面在最靠近相机处的正面分辨率。

令 `H=[a b c;d e f;g j 1]`，先按现有代码恢复 `focal²`，主点平移后的三维列为：

```text
A = (a-cx*g, d-cy*g, focal*g)
B = (b-cx*j, e-cy*j, focal*j)
W = norm(A), Hrect = norm(B)
Dmin = min(abs(1), abs(1+g), abs(1+g+j), abs(1+j))
nearestDepthWidth  = W / Dmin
nearestDepthHeight = Hrect / Dmin
```

`K^-1 H`给出的物理矩形边长为W/focal、Hrect/focal；最小角点相机深度为Dmin。相同焦距下，该深度的正面像素密度为focal/Dmin，因此两者相乘得到W/Dmin和Hrect/Dmin。这个候选没有拟合系数，也没有按图片内容、角点身份或原生目标尺寸分支。

生产只在已有有效metric相机推断中把该密度作为额外下限，与原最长边和面积下限取max，再使用原Math.round规则。无有效正焦距、近无穷远消失点、自动比例超4倍时继续回退。显式aspect保留原优先级，`perspectiveCropSize`的legacy平均边长与公共command/MCP的显式输出尺寸不变。未添加统一+1、ceil补像素或针对留出的坐标例外。

代码仅改 `src/shared/crop-projective.ts` 的自动helper，不读取或量化栅格数据，不改变8/16/HDR源、采样核或历史。复杂度是固定四角的常数运算。

## 数值稳定性修复与第二次冻结

生产整合时旧解析近地平线测试发现安全回归：原面积推断已因近地平线密度超4倍回退到1526×1526；新深度下限自身虽低于4倍源边，却可将结果重新拉到5000×5000。这不能通过放宽旧测试接受。

工程修复让深度下限与现有metric面积推断共用有限值及4倍稳定性门槛：面积推断被判为不稳定时，整个额外密度推断保持原保守回退。深度下限自身也继续受4倍源跨度及有限值约束，最终复用画布资源验证。这不是按原生fixture拟合的新规则，三个独立解析近地平线平面验证其合同。

原candidate源码与SHA仍完整保存；新增安全保护在最后生产冻结中单独记录，不能把整合后的代码冒称为此前未变的冻结文件。生产源码于2026-10-14T06:13:13.221Z重新冻结，SHA256 `3d378d313aa2d7900fb3c04ed1d4f79ef9a12300aef8f7769cbcecf2d9dd3c05`。此前独立6例及GUI在安全修复后属于已知验证，原尺寸预测不变、门槛未变，没有以它们再调参数。记录见 `artifacts/alpha28-size/production-freeze.json`。

## 结果与未修差距

| 分组 | 例数 | 原baseline误差 | 当前误差 | 改善 / 不变 / 退步 | 当前精确数 |
|---|---:|---:|---:|---:|---:|
| 已见alpha.26/27含主点0诊断 | 26 | 196 | 177 | 5 / 21 / 0 | 19 |
| 新已披露校准 | 4 | 16 | 9 | 1 / 3 / 0 | 1 |
| 原冻结后独立ActionManager | 6 | 25 | 8 | 4 / 2 / 0 | 2 |
| 原冻结后独立实际GUI | 1 | 1 | 1 | 0 / 1 / 0 | 0 |
| 全部 | 37 | 238 | 195 | 10 / 27 / 0 | 22 |
| 正常文档中心（上述子集） | 28 | 52 | 26 | 7 / 21 / 0 | 17 |

误差为宽、高绝对差的总和，主点0诊断不混作正常用户界面。总体主点0误差仍占169px，正常界面不采用该主点。

| 关键几何 | 原生 | 原baseline | 当前 |
|---|---:|---:|---:|
| 旧alpha.27 strong左右 | 311×216 | 309×215 | 310×215 |
| 新校准另一透视 | 464×374 | 458×370 | 462×373 |
| 新独立strong | 391×262 | 387×259 | 390×261 |
| 新独立0.5倍 | 196×131 | 194×129 | 195×130 |
| 新独立1.12倍 | 438×293 | 434×290 | 437×292 |
| 新独立90° | 262×391 | 259×387 | 261×390 |
| 新独立非对称 | 325×305 | 325×305 | 325×305 |
| 新独立单消失点 | 362×249 | 362×249 | 362×249 |
| 新实际GUI事件 | 421×306 | 420×306 | 420×306 |
| 旧文档中心独立 | 395×264 | 398×265 | 398×265 |

新strong-center、upper-left校准仍为419×305对420×306、418×306对420×308；lower-right420×304精确保持。不能将4个新独立例恰好都差1×1作为全局加1的依据。

研究中还比较了保持焦距的整相机正交旋转尺度、最近视线欧氏距离尺度，以及两个尺度的几何平均。整相机与几何平均在主点0旧案例显著退步，未采用；这些否决结果在 `artifacts/alpha28-size/seen-metric-candidates.json` 保留。几何平均即使使旧strong尺寸精确，也不满足整体不退步条件。

## 验证边界

75项定向测试、`npm run typecheck`通过，覆盖37原生尺寸中的生产行为、冻结机制复算、4校准/6独立分区、旧3×1与新1px残差、旋转/镜像协变、显式比例/legacy兼容、随机有限/4倍边界、3个近地平线解析保护，以及原采样和高位深精度回归。旧alpha.27六例残差总和的断言从6更新为真实更严格的4；没有增大任何误差上限。

证据日志：`artifacts/alpha28-size/focused-tests.log`、`typecheck.log`。编写代理没有运行GUI、没有修改版本/runner或提交Git。root的真实Photoshop采集与最终Electron工程/包验收属于单独证据；此文不把尺寸helper与Photoshop像素效果等价混为一谈。最终runtime结果待root统一验收后补充。

新增 `scripts/smoke-perspective-alpha28.ts` 及其同运行时纯核心oracle，共9项计划检查：GUI四角三种深度先观察真实自动420×306，再用UI显式421×306作原生RGB8效果对照；独立strong三种深度直接提交真实默认390×261，不编辑宽高字段、不通过MCP直接输入尺寸；legacy exclusive矩形及Cancel；独立opaque/alpha小数角点的720×540放大各一项。所有适用流程包含源字节、深度、alpha、单次历史提交、键盘Undo/Redo和save/reopen。独立放大除原生门槛外还检查每个alpha与旧模型baseline精确相等；same-runtime核心精确不等于Photoshop效果等价，报告保持PARTIAL。

该新smoke的typecheck、ESM解析和diff检查通过，源码冻结记录为 `artifacts/alpha28-size/smoke-freeze.json`；编写代理未执行GUI。GUI原生像素fixture已由root确认actualGUI与ActionManager同descriptor重放全RGBA精确一致，但smoke仍使用未放宽的旧baseline门槛MAE1.5996537965938553、max26、alpha0。两项独立放大使用sampling代理不可变fixture的原baseline门槛，未按当前输出扩大限制。最终执行由root统一串行完成。

```sh
npx tsx --test tests/photoshop-perspective-size-alpha28.test.ts tests/photoshop-perspective-size-alpha27.test.ts tests/photoshop-perspective-size-alpha26.test.ts tests/crop-projective.test.ts tests/photoshop-perspective-alpha24.test.ts tests/photoshop-perspective-alpha25.test.ts tests/crop-sampling-alpha26.test.ts tests/crop-lanczos-alpha27.test.ts tests/crop-decode-budget-alpha27.test.ts
npx tsx scripts/measure-perspective-size-alpha28.ts
```

测量脚本比较保存在 `artifacts/alpha28-baseline` 的原helper与冻结机制，因此在本地保留采集原始资料后才能重跑；测试本身只依赖提交范围内的几何fixture，不依赖该baseline目录或native像素文件。
