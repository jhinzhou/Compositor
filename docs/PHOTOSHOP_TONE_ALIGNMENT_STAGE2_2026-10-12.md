# Stage 2：曲线横向端点与 HDR 有符号曝光

2026-10-12。本次只修改曲线端点表示/处理/UI/PSD 转换及 HDR Exposure 负值语义。不修改原有曲线的内段插值，不扩展色域配置，也不将便携测试标称为 Photoshop 像素参考。

## 曲线端点

- 四个通道的曲线现在允许在 0…255 内任意严格递增的输入端点，如黑点 `(16,0)`、白点 `(239,255)`。端点外固定使用端点输出；中间仍是已有 Hermite 插值和单色通道后总通道顺序。
- 全范围旧曲线/默认恒等表示保持兼容。特别处理短对角线：`(32,32),(224,224)` 不是全范围恒等；端点外仍需裁到 32/224，不能由深色滤镜的恒等快捷路径跳过。
- 滤镜 UI 解锁首末 Input 数值框，按相邻点约束输入；端点依然不可删除，以保证至少两个点。图形展示使用同一个端点核。
- PSD 导入保留原始横向端点，不再添加合成的 0/255 点。PSD 导出保存精确输入/输出点；已有导入后带补点的历史工程仍按其原始点处理，不主动重写。
- 16 位直接计算保留非 257 倍数的通道值及原 Alpha。HDR 曲线仍采用已有 native normalized16/peak restoration 桥接；这次不改变其负值截断和量化限制，不能认为已与 Photoshop 32 位曲线等效。

官方功能依据：[Adobe Curves 的黑白端点](https://helpx.adobe.com/photoshop/desktop/adjust-color/color-corrections/adjust-color-and-tone-with-curves.html)。本轮新增测试覆盖阈值/区间、反向输出、16 位精度、HDR 高光尺度、PSD 二进制往返，以及 16 位/HDR 命令与调整层的 Undo/Redo。初次端点实现时没有真实参考；后续已采集 Photoshop 27.11 `(16,0),(239,255)` 的RGB8输出。该真实分析网格上的所有可见/预乘RGB及Alpha都0差异，归档在 `photoshop-27.11-effects.json`。这仅证明该两点线性案例，仍不声称全部多点插值逐像素一致。

## HDR Exposure

项目在 extended sRGB 解码后执行 EV 与 Offset，然后采用有符号 Gamma：

`u = linear(v) × 2^EV + Offset`

`corrected = sign(u) × |u|^(1/Gamma)`

最后 extended sRGB 编码并恢复原预乘 Alpha。负值与超白均可保留；默认 EV=0、Offset=0、Gamma=1 精确返回源副本，避免传递函数舍入改变恒等数据。

此处有意偏离原版 Compositor 的 `max(0,u)`，采用 [Adobe HDR Exposure 对负值 Gamma 的描述](https://helpx.adobe.com/photoshop/using/adjusting-hdr-exposure-toning.html)。Adobe 文档没有公开全部内部精度，因此本次依据是文档语义和独立数学期望，不是实际 Photoshop 负值输出。本地 Photoshop 已采集的 Levels/Gaussian/Invert 图像不覆盖该能力。

原有 `native-f5ae5ba-hdr.json` 保持不变。C Exposure 参考测试标题与范围现明确限定为非负线性域；负线性域改用单独的有符号代数测试。既有 Normalize、Restore、Paint、Alpha、Half 等 C 参考仍比较原始全范围。不得把旧的完整 Exposure C 一致性继续当作当前产品结论。

风险：过去含负通道的 HDR 工程上的 Exposure 调整会显示不同结果；变化是保留负通道而非消除它们。8/16 位 UNORM Exposure 不改动，其他 HDR 颜色调整仍保留原归一化桥接限制。实际 Photoshop 负值的导入/调整/浮点输出验证由主流程继续采集。

## 验证记录

- 定向命令：`npx tsx --test tests/curves-endpoints.test.ts tests/deep-color-filters.test.ts tests/hdr-pixels.test.ts tests/photoshop-adjustments.test.ts tests/image-filters.test.ts tests/deep-edit.test.ts tests/hdr-integration.test.ts`。
- 结果：112 个测试通过，0 失败；包含原曲线 C 参考与新增端点/有符号曝光回归。
- `npx vue-tsc --noEmit` 通过；限定文件的 `git diff --check` 通过。
- GUI、构建、打包、Windows 验证和提交不在本子任务范围。UI 源改动由主流程统一运行验收。

## 实际参考跟进及最终定向门禁

随后补充普通 HSL 的 RGB Lightness 顺序修正；来源、全部误差与原版语义差异见 `PHOTOSHOP_EFFECT_MEASUREMENTS_2026-10-12.md`。当前同一组定向命令增加 `tests/photoshop-effect-reference.test.ts` 后 **127 项通过，0失败**（原有两项普通 Lightness 的 native 精确比较已按语义变化缩小范围，其历史 fixture 未变）。定向测试并未模拟 Photoshop UI。

本次最终 `vue-tsc` 首次运行因并行新增的 `tests/layer-rasterize.test.ts` 梯度 action 缺少必填 `radial` 而失败；不将全项目类型门禁标为通过。该项由主流程修复/重跑。本子任务没有运行构建、打包或GUI。

## 主流程最终门禁

并行test radial字段已修，当前完整i18n/typecheck/1,226 tests/production build通过；开发与macOS ARM64目录包的实际桌面和stdio MCP结果统一记录在 [alpha.17验收](PHOTOSHOP_ALPHA17_ACCEPTANCE_2026-10-12.md)。上文类型首次失败属于子任务交接记录，未将该失败当作通过。
