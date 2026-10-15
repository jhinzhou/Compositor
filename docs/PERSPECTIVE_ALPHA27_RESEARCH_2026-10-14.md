# alpha.27 透视裁剪尺寸与采样：原生研究和实现

本批以 Photoshop 27.11.0 的独立原生输出验证新增几何。生产改进限定为 **High quality 的等比例仿射缩小采用完整归一化 Lanczos3**；透视、放大、剪切、非等比例缩小、对齐身份采样保留已有路径。选择依据是合成图层 placement 后的源 Jacobian，而非图片名称、四角常量或输出 fixture 身份。高频透视与放大的剩余效果差异仍未全部解决。

## 原生证据与实验边界

所有输入由 `scripts/create-perspective-alpha27-inputs.ts` 确定性绘制，没有用户业务图片。校准图包含不同方向和频率的条纹、棋盘、两处单脉冲、阶跃和渐变；另一个输入保留独立频率及小数 alpha 边缘，由根代理在候选机制冻结前保管。

`photoshop-perspective-alpha27.jsx` 由根代理通过 Photoshop Browse 实际执行20例。每例将原始输入复制到新的带 runID 路径再打开，避免 Photoshop 复用用户已打开的文档；裁剪前导出源PNG，完成后只关闭这一新文档，恢复用户的 active document 和 displayDialogs。偏好和 notifiers 不写入。校准13例、独立 alpha 例和6个新自动尺寸明确分区。opaque各例源 RGBA 从原生裁剪前PNG重新解码，SHA与绘制输入精确一致。透明输入三例中，Photoshop源PNG导出将alpha=0的隐藏RGB替换为白色，共2550个通道与原图不同；全部alpha和alpha>0 RGB逐通道精确相同，预乘RGBA差异严格为0。原始authored输入保留用于采样，不把隐藏RGB变化声称为完整RGBA SHA相等。

请求 `interpolation/interpolationType` 的 Automatic / Bicubic / Sharper / Smoother 在同几何下的 decoded RGBA SHA **全部相同**，返回 descriptor 的 interpolation 也为null。该字段对 perspectiveCrop 没有得到有效性证明，不能将这些输出宣传为四种原生透视核。Adobe 的 [Generator ActionDescriptor 例式](https://github.com/adobe-photoshop/generator-core/wiki/Photoshop-Kevlar-API-Additions-for-Generator) 支持这种字段形式，但并未保证每个事件都接受该参数。

追加8个原生控制：2个真正 background 的轴缩放，6个普通层 DOM `resizeImage` 显式 BICUBIC / BICUBICSHARPER / BICUBICSMOOTHER。这些是独立 Image Size 控制，不是“先透视再resize”的两阶段流程，不改变用户全局 interpolation 偏好。实际 backgroundBeforeCrop=true 的两例保持背景类；源RGBA仍与普通层相同。普通PNG即使所有alpha255也被Photoshop打开为普通层，因此原20例中“normal”与默认opaque层不能算有效背景对照。

在明确排除4px边界的内部区域，原生 Automatic 轴向缩小与原生 DOM BICUBICSHARPER 的 RGB **逐像素一致**；轴向放大与 BICUBICSMOOTHER **逐像素一致**。Basic Bicubic 相应MAE为3.419526与4.208595，证明这些DOM参数有效。背景与普通层的内部RGB一致，但完整RGBA/边缘语义不同，不混算。Adobe [InterpolationMethod](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/modules/constants/) 也明确区分自动选择、Sharper的锐化与Smoother的平滑；此文报告的是本地原生控制，不推断完整私有算法。

## 已接入的等比例缩小

`cropIsotropicAffineMinification` 对实际 source inverse homography 验证：透视分母为常量，两个 Jacobian 列向量正交、长度相等且大于一个源像素。数值容差只处理浮点误差。检查列向量避免45°旋转的各向异性缩放恰好具有相等行长度时被误判。

该分支采用 `sinc(x)*sinc(x/3)` 的3源像素支撑，按源足迹扩大并归一化完整支撑；画外透明或指定蒙版背景仍参与，而非仅按画内权重归一化。基础 sampler 未提供 filter 时仍使用原Mitchell。真透视、放大、非等比、剪切、Nearest/Smooth以及精确对齐路径没有改核；公共边界坐标和显式目标尺寸不变。

机制在 `artifacts/alpha27-perspective/candidate-freeze.json` 中冻结后，根代理又用原生执行新比例与90°旋转留出，两例没有参与选择参数。

| 普通层原生参考 | alpha.26 RGB MAE / max / alpha max | 当前实际生产 RGB MAE / max / alpha max |
|---|---|---|
| 原有校准轴384×256→300×200 | 3.143678 / 47 / 14 | 2.094422 / 34 / 13 |
| 新频率校准轴384×256→300×200 | 5.276878 / 47 / 14 | 2.858494 / 37 / 13 |
| 未见比例384×256→240×160 | 7.647917 / 58 / 20 | 3.091727 / 43 / 11 |
| 未见90°旋转后160×240 | 7.805582 / 56 / 20 | 3.043064 / 42 / 11 |

这些是减少误差，尚非像素等价。完整参数和输出SHA见不可变 calibration、controls、affine-holdout fixtures；实际生产统计与独立诊断重算的极少量浮点舍入差异分开记录，以生产输出为准。

扩大核会增加工作量。例如足迹1.6的Lanczos3实际100 taps，而Mitchell为64 taps；footprint1.28分别为64/36。调用方继续使用原1.2亿共享tap预算，按真正支撑计数，常量仿射足迹会在生成输出前预算拒绝；跨层累计没有被每层重置。没有放宽资源限制，也不把局部性能基准套用于扩大核路径。

最终复核补上一个既有内存预算漏洞：RGB8源只保留压缩PNG，原估算没有包括裁剪时新解码的 `width×height×4` RGBA surface。现在本地预算在PNG解码前加入这一surface；全工程预算保留全部源与输出估算，并加入串行裁剪时最大的临时解码surface，共享源的多次placement不会重复累加同一解码surface。RGB16/HDR主图直接使用已计入的源typed array，不再多算RGB8 surface；蒙版需要PNG解码的路径仍计入。预算拒绝发生于选区、图层和asset map变更之前。四项预算回归使用虚拟尺寸和极小缓冲，不实际分配巨图，并验证单源超限、组合源超限、高位深不双计与串行峰值。

RGB16与HDR在原始预乘数据上使用相同几何和核，只在原有调用方最终格式处量化。独立窗口 sinc 算式验证具体高位深输出，小数alpha、HDR负值及超白值保留，原source缓冲不变；蒙版画外默认值和opaque alpha保留。这是工程数据保真，不代表已取得Photoshop高位深效果等价证据。

## 尺寸模型独立留出

alpha.26的相机主点比例和角点最大源像素面积下限 **保持冻结，没有按新尺寸拟合**。新六例左右gentle、strong、平移和180°对照中，4例精确；两个strong例为建议309×215、原生311×216，各差2×1，总误差6px。既有独立398×265对395×264的3×1px残差仍保留。新增真正鼠标GUI样本的native event为 `(45,39),(337,51),(317,210),(55,202)`，source384×256、paint center192×128，无显式目标尺寸；原生输出292×163，冻结模型预测精确。该样本及descriptor按native-gui-event独立归档，不混作ActionManager重放。这里仍不能宣称自动尺寸完整对齐。

## 拒绝的候选与仍需研究的差异

全局替换Lanczos3在自然频率图上增加最大误差，因此未采用。固定相位偏移也未采用：既有透视放大X/Y渐变出现不同方向偏差，新纯轴放大却不支持同一偏移，不能将某一图的+.25像素作为全局规则。

完整输出像素2×2或4×4中点积分在新高频透视校准上降低误差（5.788828 / max101降到4.929839 / 84或4.864167 /79），但自然图出现退步：fractional parallelogram max19→32/35，strong trapezoid45→48/50。未上线，也没有改旧fixture或放宽门槛。随后冻结“真正projective且两主方向均缩小”的2×2中点积分，完整子格支撑在源栅格内才启用，源边界保留原AA；大倍率每子格保留sourcefootprint/2的剩余低通，典型64tap并据实计预算。该机制降低三组校准MAE且旧自然图零选择，但冻结后独立留出**否决**它：alpha180×120从MAE31.545077/max181退到34.376389/max211；opposite255×160从14.700801/max112退到15.057271/max118，alpha max5保持。源预乘数据精确，排除了输入污染。没有继续按留出条件调规则，没有上线2×2；4×4与2×2失败结果保留，不能以模糊降低校准MAE代替效果还原。

冻结后的只读alpha-aware复核进一步排除“透明像素隐藏RGB导致伪退步”：180×120原生裁剪结果全alpha255，按alpha加权、预乘RGBA及可见RGB的MAE均从31.545077退到34.376389，可见max181→211；opposite255×160的加权MAE14.700708→15.057194、预乘MAE14.700792→15.057291，可见max112→118。两例hiddenAbsoluteError均为0。复核见 `artifacts/alpha27-perspective/root-alpha-aware-holdout.json`，不改变原冻结拒绝条件，不通过重新定义指标挽救失败候选。

真正透视放大600×400仍为RGB MAE5.900449 / max107、alpha max40；新轴放大保留旧路径，MAE1.870957/max28、alpha max50。新增独立alpha500×320透视放大仍为MAE11.410127/max80、alpha max6，原路径保持，积分候选选择0像素。参数核请求无效的原生实验与背景语义已经分开，后续须继续解析Automatic Smoother与透视映射细节，不能凭RGBA8参考推定RGB16/HDR私有效果。

## 已完成的专项检查

92项定向测试及 `npm run typecheck` 通过，包含新原生校准、冻结后新比例/旋转留出、高位深独立数值、源不变、蒙版背景、共享tap预算、四项源解码内存预算回归和原有alpha.24/25/26参考。另已写 `scripts/smoke-perspective-alpha27.ts`：真实UI对照新增GUI292×163、8/16/HDR等比例240×160以及独立真透视180×120，带撤销/重做、源字节和保存重开检查。新GUI与高频真透视门槛只用于工程回归，报告明确PARTIAL；原alpha.26自然图 .35/30 门槛仍在旧专项保留，未放宽。脚本ESM解析与typecheck通过，真实Electron与最终包验收由根代理统一串行运行，本代理没有操作GUI。

首次统一development运行通过该专项的RGB8及RGB16流程，HDR检查因测试跨表示比较失败，原始 `first-failure.json` 保留（SHA256 `e73efe061b403700edf9ee4203b4866e9418805cfc2961a7baded9deb71180a3`）。离线重建确认本例源EXR的保存/加载working样本零差，核心计算输出EXR的SHA与实际GUI资产SHA完全一致：`04f03f42216cdb42e4a59db25da57df85b5d1914671ba4d1539b96272086bc0e`。失败是 `decodeEXR(actual).hdr` 被拿来与编码前的 `expected.hdr` 比较；EXR存scene-linear FLOAT，输出经过transfer解码回working extended-sRGB后有656个蓝通道Float32舍入差，最大 `3.725290298461914e-9`。smoke改从裁剪前实际加载的source bytes构造独立核心预期，并将HDR解码数组与expected.bytes的解码数组精确比较，GUI与affine两分支均修正。没有使用浮点容差，没有改生产源码或任何RGB8原生门槛。诊断脚本 `scripts/diagnose-perspective-hdr-alpha27.ts` 不启动GUI，结果保存在 `artifacts/alpha27-perspective/hdr-smoke-first-failure-diagnosis.json`。

第三次development运行已通过GUI的8/16/HDR三个完整流程，随后affine RGB8因新加的跨host Node/Electron压缩字节断言失败（39068与39069字节）。该次原始report单独保留为 `third-failure-affine-png-encoding.json`，SHA256 `eaf630d4da32f37327bcaa4dfaeb59e5e3f36cef14680ef6c95229a9af7667cf`；当时未保存两PNG原文件，不能据字节差断言只是compression。第四次捕获原文件后，严格decoded检查确认65个RGB通道有1级差、alpha零差，位于52/62/67行，不是纯压缩差异。第四次report保留为 `fourth-failure-host-v8-pixel-ties.json`，SHA256 `71c43103594c3c0884b0783899e93fd8d05aa59cd81471eaf879dfe5ea2c4b80`，独立解码结果见 `artifacts/alpha27-perspective/host-v8-pixel-ties.json`。

随后在不启动GUI的 `ELECTRON_RUN_AS_NODE=1` 下，使用同一源、精确fullQuad、placement和High quality重建输出：host Node24.14/V8 13.6与host expected逐像素一致，Electron Node24.21/V8 15.2与实际GUI像素及整个PNG编码字节完全一致（SHA `2035673c891ab8a2c74958b48aa00debd694b46630f1ae1fa93448ea39ddec2b`）。因此差异归于跨V8的Lanczos浮点累积与127.5量化tie，未需要UI坐标或采样参数误差即可完整复现；kernel x=.8有末位浮点差，不能直接将所有差异归因于某一个sin调用。证据为 `affine-host.json`、`affine-electron.json` 和 `same-runtime-oracle-check-comparison.json`。这65通道不是Photoshop残差或产品参数翻译问题。

当前smoke将纯核心oracle打包到本次临时目录（不改out），由实际app的同一executable在RUN_AS_NODE模式计算，核对node/V8/Electron/zlib版本与裁剪前实际source编码SHA。同时捕获未round的SVG角点与实际public apply action，GUI及affine的8/16/HDR、projective的RGB8路径使用该参数和物理源作严格decoded对比，没有round epsilon或容差。Photoshop fixture及其native RGB8门槛仍由host独立解析统计，完全未改；捕获到的实际Electron affine RGB8 MAE为3.091579861、max43、alpha max11，仍通过原3.1/43/11门槛，host核心的3.091727单独保留。相同运行时内Undo、Redo与save/reopen编码字节仍精确断言。实际runtime结果仍由根代理串行重跑填写。

```sh
npx tsx --test tests/crop-decode-budget-alpha27.test.ts tests/crop-lanczos-alpha27.test.ts tests/photoshop-perspective-size-alpha27.test.ts tests/photoshop-perspective-native-alpha27.test.ts tests/photoshop-perspective-holdout-alpha27.test.ts tests/crop-projective.test.ts tests/crop-sampling-alpha26.test.ts tests/crop-antialias-alpha26.test.ts tests/photoshop-perspective-alpha24.test.ts tests/photoshop-perspective-alpha25.test.ts tests/photoshop-perspective-size-alpha26.test.ts tests/photoshop-crop-alpha21-reference.test.ts tests/photoshop-crop-observer-alpha26.test.ts tests/photoshop-perspective-actionmanager-alpha26.test.ts
npx tsx scripts/measure-perspective-controls-alpha27.ts
npx tsx scripts/measure-perspective-alpha27-candidates.ts fixtures/parity/photoshop-27.11-perspective-affine-holdout-alpha27.json artifacts/alpha27-perspective/affine-holdout
```
