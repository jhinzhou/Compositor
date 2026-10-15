# alpha.26 透视裁剪与修补效果验收

日期：2026-10-13；版本：0.3.0-alpha.26；原生参考：本机 Photoshop 2026 27.11.0。

## 已实现的修复

1. Photoshop操作配置下，新建透视框包含拖动终点像素；后续角点使用真实源边界坐标。预览和提交采用同一四角，不再二次扩展。修复初始满画布透明路径吞掉新建拖动的问题；未画裁剪框时显示操作提示。
2. 自动尺寸恢复可用相机模型的正交矩形比例，结合最长源边与角点最大源像素面积密度确定尺度；无效几何或超过4倍源跨度的面积推断回退，手工输出尺寸仍可覆盖。10个真实文档中心/GUI案例的宽高总绝对误差570→4px（降低99.3%），9/10尺寸完全一致，最大宽差65→3、最大高差44→1。19个含其他中心实验的误差1506→190，精确尺寸4→14例；与前一轮保守尺度比较，7例改善、12例不变、0例退步。实际GUI四角输出387×257已精确一致；独立留出仍为398×265对原生395×264，保留3×1px差异。该通用几何估算不按样本硬拟合，仍不能称完全复刻Photoshop自动分辨率。
3. High quality在输出像素覆盖多个源像素时，按源映射Jacobian足迹扩展并归一化Mitchell采样支撑；使用完整支撑而非只归一化画内部分。局部足迹不超过一个源像素时保持既有核，精确对齐继续保留原始值，RGB16和HDR不经过8位中转。跨图层、图层蒙版统计实际采样tap，超过1.2亿预算原子拒绝；增加对应中文提示。公共API的源边缘四角和显式输出尺寸语义保持。
4. 采样局部性能优化：RGBA8两轴权重复用，深位数据格式判断移出内循环。同核40万次、7轮交替基准约1.60/1.52/1.40倍（8/16/HDR），checksum一致。该基准只测不需要扩展足迹的采样函数，不代表扩大核的缩图路径或整体应用速度。

## 原生效果与未完成项

全部使用自制校准图或有来源的公开纹理，没有使用用户业务图片。实际鼠标/键盘验证GUI角点；精确参数输出另外由Photoshop原生ActionManager执行。二者在fixture中分别标注，不把脚本调用声称为纯鼠标操作。MAE、max以0–255通道单位统计。

| 对照 | 修复前 → 当前 | 结论 |
|---|---|---|
| GUI四角自动输出 | 精确事件边界：旧平均边长349×225 → 387×257；PS为387×257 | 本例尺寸精确一致；开发与安装包的实际输入验收分别记录 |
| 独立透视尺寸 | 当前398×265；PS395×264 | 仍差3×1px，保留独立留出误差 |
| 高频透视缩小300×200 | RGB MAE6.5365→5.7071，max120→103，alpha max42→28 | 抗锯齿改善，仍非像素等价 |
| 另一组显式四角缩小300×200 | RGB MAE7.6003→6.6808，max137→118，alpha0 | 独立四角残差改善，仍非像素等价 |
| 全图轴向缩小300×200 | MAE7.6868→3.1437，max111→47，alpha max28→14 | 明显改善，边缘仍有差异 |
| 高频透视放大600×400 | MAE5.9004/max107/alpha max40 | 未改善，保留差距 |
| 已有低频GUI透视387×257 | MAE0.349618/max30/alpha0 | 原门槛保持 |
| controlled修补Diffusion5合成 | MAE0.189286/max1 → 0.189286/max1（字节不变） | 完整覆盖保持原核，不代表自然纹理 |
| 浅木纹Diffusion5 | MAE1.218065/max23 → 1.206097/max14 | 128核心边界改善，仍有差异 |
| 已公开研究老木纹Diffusion5 | MAE6.024618/max99 → 3.142408/max39 | 明显改善；已用于研究，不再称当前候选独立留出 |
| 第三张自然木纹Diffusion5 | MAE2.038695/max37 → 1.264435/max21 | 首次独立照片验证改善，仍非等价 |
| 独立程序抗锯齿选区D5 | MAE1.352256/max12 → 1.782872/max10 | 均值退步；最大差与弱边修改域改善，不能计效果全PASS |
| 羽化4px程序选区D5 | 最终与旧核字节一致：MAE3.569717/max35 | 撤回对此类选区的128规则；仍修改2358像素，原生2223，不等价 |
| 低峰20程序选区D5 | 与旧核字节一致：MAE0.935062/max4 | 产品修改488像素，原生890，仍不等价 |

### 采样剩余差异与源码风险

上述四个显式目标采样参考来自fresh-source的原生ActionManager，源图、四角、输出尺寸和RGBA哈希均归档；其中600×400结果与另一轮实际GUI裁剪的RGBA哈希完全一致。评估使用公共API直接源边缘映射的`publicEdgeProduction`，没有套用旧inclusive-center辅助profile。早期仅凭屏幕观察四角的calibration/holdout仍标注`geometryVerified=false`，保留失败记录，不用于证明核已对齐。

全图均值会隐藏局部差距。当前确切四角缩小案例的高频分区RGB MAE为24.1206，放大为25.6591；放大案例平滑分区MAE为0.1803，不能据此认定棋盘、锐边和细纹理也已对齐。缩小/放大的源边界alpha max仍分别为28/40；轴向全图缩小alpha MAE为0.1169、max14。新版改善抗锯齿，但仍不能称全面复刻Photoshop的Bicubic Automatic。把所有采样换成更模糊或更锐的核、固定亚像素偏移、或统一clamp画外像素，均没有跨独立样本的一致证据，未进入生产。

`crop-sampling.ts`使用源X/Y方向的可分离Mitchell支撑，尚未验证完整方向性足迹或原生Automatic内部核；RGBA8仍在既有编码颜色域内按预乘alpha插值，本批没有上线线性sRGB/ICC转换。原生本机偏好已读取为`BICUBICAUTOMATIC`，输入PNG无ICC，但原生完整颜色管理链未证实相同。RGB16/HDR测试证明保留原始精度、HDR负值/超白值、小数alpha和源缓冲不变，尚无原生高位深像素参考，不能扩大为高位深效果等价。

`crop-actions.ts`对扩大支撑计入实际tap，因此大幅缩小、强透视或多图层工程可能比旧固定16tap估算更早收到`RESOURCE_LIMIT`，是保持原1.2亿工作预算的实际行为。Smooth/Nearest没有加入本批抗锯齿策略；透视裁剪仍有既有的文字/形状先栅格化、组/调整/图层效果、带羽化蒙版和斜向参考线限制。本批没有通过静默栅格化或降低精度解除这些保护。

旧alpha.24/25参考保持原fixture及误差门槛全部通过，部分平滑案例MAE有小幅变化（strong-trapezoid 0.307146→0.309701），不能声称每个指标都下降。alpha.21固定348×223快照的不同RGB通道数194393→194442增加49，但MAE4.48647→4.47902、RMSE14.53794→14.38924改善，max237、P99 77及alpha0不变。测试更新精确计数并新增MAE/RMSE/max/P99不得超过旧实测值的断言；没有扩大原MAE<5/RMSE<15预算。

原生“自动透视后再Image Size”与直接显式目标透视在相同四角下也不等价：300×200两者MAE5.0522/max115，600×400为8.7059/max152；只有轴对齐全图案例RGBA哈希相同。因此本批没有用简单两阶段重采样替代公共API。

### 修补剩余差异

修补研究确认原生有效字段为healSmoothFactor。仅改变工具栏数字、但没有在ActionManager中携带该字段的旧样本，实际全部执行默认5；这些样本不能用于判断三档参数差异。另一个旧合成“Diffusion5”操作的精确拖动位移没有事件证实，不能继续把其MAE14.22作为本轮fixed-offset基准。新的显式参数采样已归档，1/5/7确实产生不同结果。

本批在Patch内部收窄使用128选区核心的范围：显式global/shape feather沿用旧软覆盖路径；烘焙后没有羽化元数据的覆盖，在原ROI扫描中检查弱像素是否存在一像素范围内的≥128邻点，发现宽软覆盖即回退旧路径。分类只是一项保守推断，不能仅凭灰度覆盖精确恢复选区生成过程。新增邻点访问计入原120M工作预算，沿用逐行取消；没有扩大ROI、预算或去掉资源保护。其他Healing Brush仍为原threshold1；预览/提交、完整覆盖、选区外RGBA、隐藏RGB、Undo/Redo和保存重开保留。

原生自然木纹与无羽化程序AA的弱覆盖像素不被修改；新羽化4px参考却修改了991个coverage1–127像素，说明早期统一128候选适用范围过宽。该候选虽使羽化全局MAE下降，却漏掉原生实际修改域，因此已撤回对宽软选区的应用。最终羽化与低峰路径保持旧字节，但它们的修改域和原生仍不一致，不能称修补羽化已经完成。新增58/58定向检查包括显式/shape羽化、烘焙宽软覆盖、Source/Destination、半透明强度、预算扣费和取消原子性。

自然木纹3组D5均改善，完整覆盖合成参考不变；独立程序AA的MAE上升，max下降，保留为真实残差。没有上线退步的空间颜色场、未经验证的Diffusion1–7数值映射或按图片身份切换的核。第三张CC0木纹首先用于冻结128候选的独立评估；随后做的通用修改域保护参考了新羽化probe，因此最终候选不能称完全未看过新增资料的盲测。原生fixture与失败候选均保留，后续需要新的留出样本验证。

Photoshop于2026-10-13 19:58被系统COREANIMATION终止，崩溃记录给出打开Metal资源失败“Too many open files”。早期键盘/Browse无响应的全部原因未证实，未再误判锁屏；重新打开后看到恢复文档、原生快捷键与脚本入口恢复响应，才补齐第三自然图和AA/feather/低峰三组。没有通过关闭用户未保存文档来继续；本任务只关闭自己创建的校准副本。记录为`artifacts/alpha26-photoshop-crash-summary.json`。

RGBA8原生对照不能替代RGB16/HDR Photoshop效果等价；高位深实际UI验收验证数据保真。Windows真机、HDR显示器和复杂PSD仍是独立验收项。

## 验收与交付

采样专项最终78项定向测试通过（78/78，0失败），包括不可变原生参考、8/16/HDR默认核精确值、缩小保真、源缓冲不变、跨图层预算和源边缘事件案例；最终专项typecheck通过。日志为`artifacts/alpha26-sampling/antialias-final-tests.log`及`typecheck.log`。这是专项证据；整体check、开发运行与安装包统一验收以随后机器结果为准。

最终宽软覆盖保护后，1955/1955项源码测试通过（0失败、0取消、0跳过），双语检查41组件/2183消息/771字面量键无问题，typecheck与生产构建通过；日志`artifacts/alpha26-source-check-final4.log`，其中Patch定向58/58。最终开发版和真实macOS ARM64目录包各29组/387检查PASS，运行错误0、截图替代0，两者冻结运行摘要均为`0cc13d6eb34a48eaa5cfca4ae9c085b983662cf41f0e5fc2efdf43696b78ecd0`。本批actual GUI透视输出的RGB8/16/HDR measurement对象在两套运行中完全一致。安装包MCP6检查PASS（12工具、protocol v2、实际预览、task链路、灰度选区、非破坏蒙版和worker细化/Undo）。包内16个运行文件、模型/图标、28个许可证文件与当前源文件字节一致；实际ZIP SHA256验证通过。此前旧128候选运行记录归档，不代替本节最终结果。


工程验收PASS；Photoshop像素效果对齐为PARTIAL，不能合并成全面效果通过。最终机器记录为`artifacts/alpha26-unified-acceptance.json`，原生七组D5效果摘要为`artifacts/alpha26-native-effect-summary.json`。开发记录`artifacts/alpha26-development-sharp-final/acceptance.json`，安装包记录`artifacts/alpha26-packaged-sharp-final/acceptance.json`，MCP记录`artifacts/alpha26-packaged-mcp-validation.json`，包完整性记录`artifacts/alpha26-release-integrity.json`。

安装包：`release/0.3.0-alpha.26/mac-arm64/Compositor Electron.app`；ZIP：`release/0.3.0-alpha.26/Compositor-Electron-0.3.0-alpha.26-mac-arm64.zip`，241065697字节，SHA256 `2497206ec23ad51cc33b81f4334d03ba12ae3ffbfb580ceb088c7a25085aafe5`。未签名macOS ARM64；本批未验证Windows真机或HDR显示器。`SOURCE_MANIFEST.json`记录最终源快照，运行、压缩包和研究产物在gitignore范围内。

失败与恢复：旧crop-alpha21 smoke假设进入透视即有4角，已改为真实取消旧草稿、严格0→4实际拖动，再校验revision/源字节不变；没有跳过创建路径。首轮失败保留在`artifacts/alpha26-development-final-first-failure.json`和对应crop归档。旧安装包运行一度在功能操作前无法获得native focus，失败的`first-failure.json`保留；随后独立24状态诊断baseline已真实聚焦，原retouch严格断言复跑通过，最终完整包29组通过。未删除断言、未关闭用户旧实例，没有证据把环境恢复归因于额外聚焦代码。

后续按原生效果继续缩小差距：自动尺寸3×1px留出；透视高频/放大/边缘alpha采样；修补程序AA与羽化/低峰修改域；在新增未见自然输入上验证真正Diffusion1–7参数映射。工程检查与效果指标继续独立记录。

## 证据与复算

- [自动尺寸原生与数学分析](PHOTOSHOP_PERSPECTIVE_SIZE_ALPHA26_2026-10-13.md)
- [透视采样与独立native参考](PERSPECTIVE_SAMPLING_ALPHA26_RESEARCH_2026-10-13.md)
- [修补参数、自然纹理与失败候选](PATCH_DIFFUSION_ALPHA26_RESEARCH_2026-10-13.md)
- 原生观察器已经清理本任务3项，notifiersEnabled恢复原false，用户其他观察器和未保存文档保留。
- 没有提交或推送Git，历史工作区改动和历史安装包保留。

```sh
npm run check
npx tsx scripts/measure-perspective-size-alpha26.ts
npx tsx scripts/compare-native-perspective-stages-alpha26.ts
npx tsx scripts/measure-patch-natural-alpha26.ts fixtures/parity/photoshop-27.11-patch-natural-explicit-alpha26.json
npx tsx scripts/measure-patch-natural-alpha26.ts fixtures/parity/photoshop-27.11-patch-natural-heldout-alpha26.json
npx tsx scripts/check-alpha26-runtime.ts artifacts/alpha26-development
# COMPOSITOR_EXECUTABLE指向alpha.26应用内部可执行文件后，重复同一runner
npx tsx scripts/verify-release.ts mac-arm64
```
