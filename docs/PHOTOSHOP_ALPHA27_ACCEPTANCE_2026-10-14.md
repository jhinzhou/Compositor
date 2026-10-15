# alpha.27 透视采样、软选区修补与最新上游接入

日期：2026-10-14；版本：0.3.0-alpha.27；本机参考：Photoshop 2026 27.11.0。

**最终结果：工程验收 PASS；Photoshop 像素效果对齐 PARTIAL。开发版和实际 macOS ARM64 目录包各32套/413检查通过，MCP 6检查通过。**

## 本轮实际修改

- High quality 等比例仿射缩小采用完整归一化 Lanczos3，按合成后的源 Jacobian 识别；源边缘透明、蒙版外围默认值和跨图层 120M tap 预算保留。普通 sampler 默认 Mitchell，真实透视、放大、非等比例、剪切及低质量模式没有被全局替换。
- 修补软选区有 128 核心时，用核心颜色膜向羽化尾部调和延拓；没有核心的低峰选区只按真实 coverage 复制供体。保留锐利 AA 路径、一次 opacity/coverage、供体透明度、预算和取消/撤销保护。RGB16/HDR Patch 仍明确不支持。
- 上游 main 从 e8c9e29701528413cc0e608d61187c1c61790add 更新到 **43d691b67995e924965bcd520f8b300f96b7d5b8**；4 提交、11 文件、+392/-34。移植空间 Camera Raw Shadows 和 RAW→Camera Raw 按钮。Swift v1.5.2 版本及 Sparkle 更新源不复制到 Electron。
- RAW 导入实际提交由 worker 原子返回 EditorState，不把 EditResult 当成完整状态。完成目标以实际 session/layer/revision 排队，只有面板打开后才消费；批量关闭第一面板唤醒第二。导入进入 committing 后不能假取消；早取消不写入。失效目标反馈后消费打开意图，已导入内容保留。

## Photoshop 实际操作与独立参考

只编辑本任务自制或有来源的测试副本，没有使用用户业务图片或关闭用户未保存工程。真实鼠标/键盘与原生脚本参考分别标注。

- 新实际鼠标透视四角事件为 [[45,39],[337,51],[317,210],[55,202]]，原生自动尺寸 **292×163**，冻结模型预测相同；本轮没有据此改尺寸参数。输出和精确事件位于 artifacts/photoshop-native/outputs/gui-alpha27 与 crop-events-alpha27。
- 羽化 2px 原生脚本预建选区后，使用真实鼠标拖动 Patch Source 位移 [-108,28]，实际事件读回 Normal/Transparent=false/Diffusion 5。保存输出与同参数原生 ActionManager 参考全 RGBA 逐字节一致，证明本轮脚本参考与真实拖动效果相符；不能声称选区本身是鼠标绘制。
- 20 个初始原生透视参考、8 个背景/明确 Image Size 核控制、2 个新比例/旋转留出、2 个透明真透视缩小留出；每例打开独立物理输入。透视 interpolation 请求四个核的输出哈希均相同、返回字段为空，因此不把它们算成四种有效原生核。
- 透明输入原生导出丢掉 2,550 个 alpha=0 隐藏 RGB 通道；所有 alpha 及非零 alpha 的 RGB 完全一致，预乘 RGBA 差异为 0。明确保存原始与实际源 SHA，不能声称这些透明源未预乘 RGBA 全哈希一致。
- 本任务三项专属 notifier 已移除，notifiersEnabled 恢复原 false，用户其他观察器保留。自建灰阶/裁剪/修补副本关闭，用户恢复工程保留。

## 量化效果与剩余差异

MAE/max 以 0–255 通道单位统计；Patch 在原生非零 coverage 区内统计 RGB。

| 对照 | alpha.26 → alpha.27 | 结论 |
|---|---|---|
| 独立等比缩小 384×256→240×160 | MAE 7.647917→3.091580（实际两套runtime），max 58→43，alpha max 20→11 | 明显改善，未像素等价 |
| 独立 90°旋转缩小→160×240 | MAE 7.805582→3.043064，max 56→42，alpha max 20→11 | 明显改善，未像素等价 |
| 新羽化2px D5 | MAE 2.903459→0.728199，max 22→6 | 尾部修改域仍不同 |
| 新羽化6px D5 | MAE 4.027027→0.337838，max 33→8 | 尾部修改域仍不同 |
| 新低峰20 / 异背景低峰92 | MAE 0.904477 / 2.223906→0，max 5 / 19→0 | 两个完整输出逐字节一致 |
| 旧羽化4px | MAE 3.569717→0.947865，max 35→21 | 改善但仍有残差 |
| 旧程序锐利AA | MAE 1.782872/max10 不变 | 仍欠对齐，不计效果 PASS |
| 新 strong 左/右自动尺寸 | 建议309×215，原生311×216，两例均如此 | 各2×1px差距未修 |
| 旧独立自动尺寸 | 建议398×265，原生395×264 | 3×1px差距未修 |
| 新透明透视放大500×320 | MAE约11.410/max80/alpha max6，不变 | 放大仍欠对齐 |

候选 2×2 面积积分在旧高频校准改善，却在冻结后新的透明透视180×120上 MAE31.545→34.376/max181→211；另一255×160由14.701→15.057/max112→118，已否决，不合入生产、不继续按留出调参。全局 Lanczos、固定相位、4×4积分和 AA 双调和等失败研究也保留证据，不靠降低门槛宣称通过。

上游 Shadows 与真实上游 C 对照22组：20组 RGBA exact，两个1200×800大图分别只有1和2个 RGB 通道相差1/255，alpha exact；3组灰阶流水线 exact。新上游空间算法在 Shadows+80/Highlights-90 的八个固定灰阶位置各下降1级，原生 C 与 TypeScript 同样如此。复合检查改为实际 C 全 RGBA 精确契约，原 single 严格检查保留；没有特定图片/参数组合回退。额外旧 Highlights+100 在灰阶241反降1的诊断只记录，未扩本轮调色修改范围。

**本机 Photoshop 未发现可用 Camera Raw 菜单/快捷键入口，搜索的已安装插件目录未见相关文件，因此独立 Photoshop Camera Raw 效果未验。** 上游 C 一致性不替代 Photoshop、RGB16/HDR 私有效果、HDR 显示器或 Windows 真机验证。深位源/小数 alpha/HDR负值与超白值保持由工程门禁验证，不能扩大为原生像素等价。

## 最终统一门禁

最终 `npm run check`：**2021/2021 PASS，0失败/取消/跳过**，国际化41组件/2188消息/773字面量键、typecheck与build PASS。全部最终脚本准备及清理后再次typecheck PASS。源码日志 artifacts/alpha27/check-final.log；最后脚本类型日志 artifacts/alpha27/typecheck-all-final-after-cleanup.log。

开发版与实际 macOS ARM64 目录包 **各32套/413检查 PASS**，运行错误0、截图替代0。共同冻结运行摘要为 `fcfd95d108629c4449354f4aea3649661aad4d73b8b14529c219ade445e846b7`。32套包含新RAW6、Patch12、透视8以及原29套387检查；其中布局52项使用实际截图。开发先验证原29套，再在相同runtime摘要下校验其脚本/参数、错误与截图记录并汇入32套结果，没有跳过新专项或复用旧构建结果。包端32套从头串行运行。两端新透视和修补实际测量一致。

安装包 MCP **6检查 PASS**：12工具、protocol v2，实际预览、task链路、灰度选区、蒙版属性、真实隔离worker边缘细化及Undo。包内**16个运行文件、28个许可证文件、模型和图标**与当前构建/源文件字节一致，实际ZIP SHA256通过。目录包未签名；Windows真机及HDR显示器未验。

结果：artifacts/alpha27-development-final/acceptance.json、artifacts/alpha27-packaged-final/acceptance.json、artifacts/alpha27-packaged-mcp-validation.json、artifacts/alpha27-release-integrity.json，最终总体为 artifacts/alpha27-unified-acceptance.json。

新版应用：`release/0.3.0-alpha.27/mac-arm64/Compositor Electron.app`；ZIP：`release/0.3.0-alpha.27/Compositor-Electron-0.3.0-alpha.27-mac-arm64.zip`，241147108字节，SHA256 `1620b0007ce830b85fcb5ad5927d00e0a5ae26bfcc89b2058d75e3d8adff78bf`。SOURCE_MANIFEST.json记录最终源码清单；实际编译/运行/发布产物在gitignore范围内。

### 首次失败、诊断与恢复

RAW新smoke首次错误假设 Photoshop 配置 Cmd/Ctrl-I 是导入，实际为正确的 Invert；改用实际 Import Images 命令面板保持task忙状态，保留真实键盘Undo。Patch新smoke首次误把侧栏临时选择视为工程activeLayerID，改用真实DOM选中状态；非目标资产和实际目标写入门槛保留。

Patch启动时数次不能取得native focus，全部发生在功能前并保留报告。没有去掉焦点门槛、关闭用户旧实例或伪造focus。根代理按精确owned Electron路径原生激活后，独立12检查通过；最后开发及包端运行均重新确认真实focus并通过。不能把恢复根因声明为regular activation policy或重复focus调用已完全解决。最后脚本保持有界等待和真实原生聚焦检查。

透视新smoke最初跨表示比较HDR编码前工作数组与EXR编码/解码后的值，656个蓝通道有最多3.72529e-9差；源往返为0差，实际与预期输出EXR字节一致。随后等比缩小发现host Node24.14/V8 13.6与Electron Node24.21/V8 15.2在Lanczos的127.5附近产生65个RGB通道1级差，alpha0；同源、精确四角、相同参数的纯Electron CLI核心输出与实际GUI像素和完整PNG字节一致，排除已知源/参数污染。新smoke核对源SHA及实际runtime版本，使用同应用运行时的离线核心oracle精确检查UI数据与精度；独立PS fixture统计和原生门槛保持。Undo/Redo/save仍保留同运行时编码byteexact，没有加像素/浮点容差或修改生产核。

首次失败、原始报告和各次独立诊断保留，不计为通过。最终类型检查的第一次失败是清理临时runner时与文件枚举并发；清理后完整类型检查通过，运行构建未改变。

### 数据保真与预算补核

RGB8透视的源解码缓冲现在在PNG读取之前计入512 MiB工作预算，全工程考虑保留源/输出估算及串行最大临时解码；deep/HDR主图不重复计已保留数组，蒙版PNG路径仍计入。超限在资产、图层及命名选区变更之前拒绝。Shadows的相同512 MiB预算提前到整图转换分配之前。新增四项crop、两项Shadows保护测试均不分配巨图；没有增加预算或改变像素算法。

没有 Git 提交/推送；编译、研究运行和发布产物保留在 gitignore 范围内。原历史安装包与原 Swift 克隆保留。

## 复验与关联报告

- [采样机制、原生控制和拒绝候选](PERSPECTIVE_ALPHA27_RESEARCH_2026-10-14.md)
- [修补软域、低峰与剩余 AA 差异](PATCH_SOFT_DOMAIN_ALPHA27_2026-10-14.md)
- [最新上游接入审计](UPSTREAM_ALPHA27_43D691B_AUDIT_2026-10-14.md)

```sh
npm run check
npx tsx scripts/check-alpha27-runtime.ts artifacts/alpha27-development-final
# 同一 runner 的 packaged 验收设置 COMPOSITOR_EXECUTABLE 为 alpha.27 实际应用路径
npx tsx scripts/verify-release.ts mac-arm64
```
