# 透视四角点选输入（alpha.23）

本批只改透视输入和 SDR 反馈，不修改原始位深提交算法、默认 Mitchell 插值核或裁剪矩阵。

`CropGeometryOverlay.vue` 新增可选 `pointMode:boolean`，默认 `false` 保留原拖框操作；新增 `ready:boolean` 事件，父级必须据此禁用 Apply，不能因旧 `corners` 仍存在就提交。

四角模式按左上、右上、右下、左下依次点击。完成前只有蓝色点与连接线，隐藏旧裁剪框／旧手柄／旧预览；每个单击释放独立 pointer lease。第四点必须通过原有凸四边形、输出尺寸和逆映射校验，并通过文档 y 向下坐标系的顺时针方向检查，才发出 `corners` 和 `ready=true`。无效第四点不发送角点，保留前三点，允许重新点击。旧默认角点不会参与未完成四点模式的 Enter 提交。

未完成时 capture 阶段阻止 Enter；完成时保留 Enter 给父级 Apply。Escape 清理点草稿并发送 cancel；blur、切换 pointMode／裁剪 mode、`finish(cancel)` 和 unmount 都清理点草稿和 pointer capture。鼠标右键、非当前 pointer、Space pan 和 disabled 状态保留原有行为。

已完成的四角支持同原拖框模式的角点／整框拖动。Shift 角点拖动以原角点为基准约束到文档水平／垂直轴，即使画布旋转也不按屏幕轴约束；整框拖动不施加 Shift 轴锁，四角保持相同位移。

SDR 缩略图从已经显示的 canvas 读取，按 edge-coordinate 双线性 premultiplied RGBA 采样；透明像素隐藏 RGB 不污染边缘，越界按透明处理。反馈最大 200×160，不把极小输出无意义上采样。反馈不是原图 asset，不参与 8／16／HDR 最终提交，也没有 Photoshop 最终效果等价声明。

`tests/crop-geometry-overlay.test.ts` 实际编译并执行生产 SFC 的 pointer／keydown／blur／watch／unmount 处理器，包括四点成功、非法第四点重试、输入切换、取消、旋转坐标、Shift 与四角平移，以及真实 `drawPreview` 获取源像素后写出的 premultiplied bilinear 结果。针对 SFC 共 11 组；与原有 crop geometry／projective 的 34 组共 45 项全通过。测试中的 DOM／canvas 是受控的元素和上下文替身；最终可视 DOM、原生 pointer 系统、父级 Apply 联动仍需要实际 Electron 统一验收。

新文案一项：`Click four corners clockwise: top-left, top-right, bottom-right, bottom-left`。父级统一国际化负责中文版本，不在本组件硬编码中文。
