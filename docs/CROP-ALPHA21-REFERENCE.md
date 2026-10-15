# alpha.21 自动拉直与透视裁剪

本批为可用的裁剪工具增加两种模式，通过已有 document.apply 命令、revision/idempotency 和交互租约完成提交。普通裁剪保持 alpha.20 的非破坏行为；自动拉直保留原始图像资产；透视裁剪明确重新采样，不能称为非破坏性编辑。

## 操作和持久化

- **拉直**：裁剪模式选择“拉直”，沿照片的水平线或垂直线拖参考标尺。计算 `- (atan2(dy,dx) − round(angle/90) × 90)`，修正至最近的水平或垂直方向。预览使用每层原始资产及旋转 placement；提交时不重写图像或 mask 资产。裁剪框居中内接，保持原比例或选择的比例，输出落到整数像素；角度限制 ±45°。
- **透视裁剪**：拖出四边形，移动四个角点或整体移动，网格随投影变形。“建议输出尺寸”取两组对边的平均长度；可输入输出宽高。它与 Photoshop 的自动尺寸算法不同。右下角小预览使用原文档的 SDR 缩略图；最终提交从原始工作位深逐层采样，绝不从预览提交。
- Apply / Enter 经同一个命令边界提交，Esc 取消当前草稿；拖拽中的 Esc / blur 还原这次拖拽前的草稿，并且只释放该 pointer 拥有的 lease。更换文档或工具不会将前文档的角度/四角草稿套到新文档。
- 普通/拉直裁剪后，画布外源像素仍保留，可扩展画布重新显示。透视提交的新像素替换当前资产；本会话 Undo 可恢复旧资产。保存重开保留新结果的位深和负值/超白 HDR，**不会保存旧资产用于取消透视裁剪**。没有新增持久化 homography、隐藏原图副本或虚假的可逆标识。

## 透视采样的精度边界

按用户给定顺序，将四角对应至输出的左上、右上、右下、左下。四边形须有限、凸、边长至少 1 像素、无退化面积，homography 分母不得在输出区域穿零。输出像素 `(x,y)` 映射 `H((x+.5)/W,(y+.5)/H)`，再按各层的 origin/size/rotation/flips 反算源坐标。默认 High quality 使用与现有 compositor/CanvasKit 一致的 Mitchell B=C=1/3 cubic，Smooth 为透明边界的 premultiplied bilinear；Nearest 使用源像素中心所属单元，不经过 8 位 proxy。

RGBA8 在 premultiplied 域插值后还原；RGBA16 使用 Uint16 原数据，最后一次舍入，不丢低 8 位；HDR 使用 Float32 原数据，RGB 不截断为 0..1 或 alpha，负值和超白保留。蒙版与图层分别使用各自 placement，独立蒙版的 link 语义保留；命名选区按相同 inverse map 重新采样，活动选区取消。单色 1×1 蒙版无需改写。

单面尺寸 ≤30,000，像素面积 ≤200 MP；进一步根据层/蒙版数量限制总输出像素和 120 M 实际源采样工作量（High quality 每输出像素 16 tap、Smooth 4 tap、Nearest 1 tap），估算源资产、结果、codec/proxy 的工作占用，超过 512 MiB 就在分配和提交前拒绝。16/HDR 还进入现有 deep asset budget。共享资产通过原始资产快照分别采样，并写入每层独立的规范文件名，避免前一层覆盖源后导致下一层重复重采样。蒙版密度为标量，保持属性；非零蒙版羽化不能以原半径投影，先原子拒绝。当前保守拒绝未栅格化文字/形状，以及包含组、调整、图层效果或参考线的透视文档，以及羽化非零的蒙版，给出中文/英文错误；不留下已变形的像素和仍宣称可编辑的旧几何 metadata。拒绝不改变 revision/Undo。

## 实际 Photoshop 27.11 参考

原图为自建 `artifacts/photoshop-native/inputs/crop-alpha20-source.png`，512×320，本轮在 Photoshop 中命名 `alpha21-crop-ui`。`scripts/native-reference/photoshop-crop-alpha21-ui-study.jsx` 仅负责打开源图；操作是实际 GUI，不由脚本替代裁剪。图像在 100% 下原点 `(742,710)`。

| 项目 | 原生 GUI 参数和结果 | 当前实现 |
|---|---|---|
| 拉直 | 源坐标 `(60,132)→(380,172)`，角度 −7.125016°；取消 Delete Cropped Pixels，输出 **430×269** | 同参考角度与整数输出 **430×269**；源资产不变，以 placement 表达旋转 |
| 透视自动尺寸 | 四角 `(60,40),(430,55),(400,280),(75,260)`，输出 **387×257** | 对边平均建议 **348×224**；自动尺寸 **未对齐**，界面明确提示并可手动修改 |
| 固定尺寸透视 | 同四角、明确输入 **348×223** | 输出尺寸与 alpha 匹配；RGB 重采样 **未达到像素一致** |

真实导出参考：`artifacts/photoshop-native/outputs/crop-alpha21-ui/capture-1791856238137.*`（拉直）、`capture-1791856412697.*`（透视自动）、`capture-1791856464186.*`（固定尺寸）。PS 会重采样拉直后的图层，当前源保持实现不能宣称拉直像素级相同。

固定尺寸 348×223 的同源/同四角比较，当前 High quality 与原生 RGB：MAE **4.486470/255**，RMSE **14.537943**，最大通道差 **237**；232,812 个 RGB 通道中 194,393 不同。alpha 最大差 **0**。这是真实测量出的差距，不应将定向测试通过解释为 Photoshop 像素一致。滤波器、边缘和采样相位仍需要进一步独立参考分析；没有针对这张图做 lookup 或逐 case 校正。独立诊断表 `sampling-diagnostic.json` 比较 bilinear/Mitchell/Catmull、统一角点 ±0.5 偏移、输出 center/endpoints 相位。Mitchell 无偏移略有改善；(+0.5,-0.5) 偏移能降低 RMSE 至 9.112，edge endpoints 降至 12.626，但单图没有证明该非对称偏移或端点规则为一般语义，均未采用。当前高频误差不能解释为微小 kernel 差异，也没有宣称完全对齐。

独立参考 fixture `fixtures/parity/photoshop-27.11-crop-alpha21-ui.json` 保存源图/原生固定结果的压缩 RGBA、SHA256、实际参数、两种默认输出差异和比较统计。当前像素结果位于 `artifacts/photoshop-native/measurements/crop-alpha21/electron-controlled.png`；统计位于同目录 `comparison.json`。`scripts/measure-photoshop-crop-alpha21.ts` 直接读取归档的原生RGBA和SHA重算测量，仅写artifacts，不覆盖原生fixture或限值。Native 参考只有 8 位；16/HDR 的精度保证来自独立数学及实际保存重开测试，不是假称原生高位深 GUI 已比较。

## 定向验证

`tests/crop-projective.test.ts` 验证独立梯形方程、逆像素中心、旋转/翻转、premult alpha、16 低位、HDR 负值/超白、mask/命名选区、原子拒绝、Undo/Redo、保存重开；`tests/crop-geometry-overlay.test.ts` 执行真实 Vue SFC pointer/keyboard/lifecycle handlers 验证四角/标尺/多指/旋转视图/Esc/blur；`tests/crop-lifecycle.test.ts` 验证实际 App applyCrop 只走既有命令边界，释放 lease 后一次提交。

`tests/photoshop-crop-alpha21-reference.test.ts` 固定 native 拉直几何门槛，记录默认透视尺寸仍不同；固定尺寸比较要求 alpha 精确及明确的非一致 RGB 误差预算，不能替代完全一致性 gate。旧 crop-geometry / crop-nondestructive / photoshop-crop-preserve-reference 回归继续保留。
