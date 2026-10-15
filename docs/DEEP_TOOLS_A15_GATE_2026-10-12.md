# 16 位画布工具及布局阶段验收

阶段源码版本 `0.3.0-alpha.15`，承接 alpha.14 调整图层验收。继续移植上游新增 HDR 前，`npm run check` 已完成 902/902 测试、双语检查、类型检查和生产构建；实际 Electron 工具验收 18 项与双语／两种窗口大小布局验收 52 项通过。

报告：`artifacts/deep-tools-dev/acceptance.json`、`artifacts/layout-dev/report.json`。此为开发构建阶段验收；最终安装包需要在合并最新上游后另做验收，不把开发构建结果冒充安装包结果。

工具覆盖普通画笔、橡皮擦、Smudge／Liquify（保护 alpha 开关），Nearest／Smooth／High quality 三种重采样；预览与提交相同、源 PNG16 保持、操作按一次事务 Undo／Redo、Escape 取消不改像素，MCP 重采样走同一命令边界，保存重开保留高位深。原版 `deep_take_painted` 的独立 C 像素参考与标量 warp 参考分别见 `DEEP_STROKE_REFERENCE.md`；后者不是 Metal GPU 逐像素验收。

布局 52 项检查覆盖拾色器、最近项目、缩放工具、Agent 设置、图像大小、滤镜、导出、填充、快捷键、命名选区、蒙版属性、对象选择与图层底部按钮；中文／英文 × 1050×720／1440×840。拾色器 Hex 标签不换行，主次动作横向排列；缩放百分号保持输入框旁边，0.1 仍表示 0.1%，不改计算；最近项目空状态与操作区分行。检查按钮几何、可达性、控件高度、交互及文档像素／历史不变。

该阶段仍拒绝无法保留精度的全部图层采样等编辑，不把 RGBA8 代理写回原始资产。Windows、完整 Photoshop 等效与 HDR 显示器输出均不属于本阶段验证范围。
