# Compositor 上游增量与 Photoshop 习惯兼容审计

核查日期：2026-10-13。实际 `git fetch origin main` 获取上游；本批基线 `f5ae5bad0b25b32dda9f254e62d2f07f59478698`，本批目标 `87e2283bae4cea45b857a1bb386f8a56ad4e99b6`。这两点之间 12 个提交，28 个文件，1,210 行新增、131 行删除。Swift 源不能直接 Git merge 到 Vue/TypeScript/Electron；这里是按行为移植与回归验收。

源码快照：`../Compositor_Upstream/87e2283`；旁边 `87e2283-source-provenance.json` 记录296个文件的 Git blob SHA1 与 SHA256，已验证。原 Swift 工作目录没有被 checkout/reset。

| 提交 | 上游行为 | 与 Photoshop / 跨平台的关系 | 本项目处理 |
|---|---|---|---|
| [59025aa](https://github.com/robbietilton/Compositor/commit/59025aa) | CMYK 印刷校样、警告、输出 | 能力方向相容；不能把 macOS Generic ICC 和 ColorSync 当跨平台后端 | 保留为 C011–C013 依赖任务；现阶段不开放假 CMYK 菜单 |
| [896d5c8](https://github.com/robbietilton/Compositor/commit/896d5c8) | CMYK PSD 读取、配置文件解释 | 需要原始四色通道、真实 CMM、ICC 与渲染意图；简单 CMYK 公式会造成外观差异 | 审计后不盲开 mode4；先修复 RGB8 PSD 静默忽略非sRGB ICC 的问题 |
| [dac3bc6](https://github.com/robbietilton/Compositor/commit/dac3bc6) | 普通导出默认 RGB | 相容；项目工作空间目前固定sRGB | 已有RGB输出保持；不把原CMYK ICC 附在已转RGB像素上 |
| 1071f4f、3beab33 | 1.5 版本及更新feed | 原版发布机制不同 | 不复制 Sparkle feed 到 Electron；本项目独立 alpha.22 版本 |
| [905efc5](https://github.com/robbietilton/Compositor/commit/905efc5) | 16位源先合成，屏幕最后抖动量化 | 相容；CPU/Skia 与 Metal 私有噪声不能假称完全相同 | 普通16位层也走高位合成；仅最终SDR屏幕量化；不支持效果/预算有明确兼容提示，保存和导出不变 |
| [3ae11cd](https://github.com/robbietilton/Compositor/commit/3ae11cd) | Progressive Blur | 空间变化模糊有用，但不是 Photoshop Blur Gallery 的全部 pins/bokeh 功能 | 已新增8/16/HDR变量模糊、文档坐标起终点、线性/径向/反向；当前数值控制完整，画布拖线交互尚未加入 |
| 539a78d、5a18e8b、f2747c4 | 1.5.1、更新feed与说明 | 发布元数据 | 不复制原产品版本、feed地址或发行签名 |
| 5e9033f | 原生更新窗口宽度 | 不同UI机制 | Electron既有对话框布局验收复用；未添加无后端的更新窗口 |
| [87e2283](https://github.com/robbietilton/Compositor/commit/87e2283bae4cea45b857a1bb386f8a56ad4e99b6) | 清空单个快捷键、部分恢复配置、Delete映射修复、CMYK命令可自定义键 | 前三项相容；上游刻意不给Proof默认键，而Photoshop使用Cmd/Ctrl-Y；未来支持校样时按Photoshop方案处理 | 显式Clear/Reset、单条加载、平台冲突检查、Delete/Backspace录制已移植；未虚构不可执行的CMYK快捷键 |

菜单按当前已实现能力排列为 File → Edit → Image → Layer → Type → Select → Filter → View → Window → Help；macOS前置应用菜单。Photoshop的 Plugins 不因排序对齐而伪造。Select Modify、Image Adjustments、Layer Mask 与 Edit Fill/Transform 放回熟悉位置；真实缺少的子项记录在目录，不以可点击空入口替代。

裸 Backspace/Delete、工具字母、Space、Tab、Shift-only 按键不注册成原生全局菜单 accelerator；由渲染器检查输入框/弹窗状态再处理。修改数字字段或快捷键搜索时不会穿透清除图片。该修复有新回归证据，但并不证明历史 alpha.21 偶发清除事件的唯一根因。

色彩管理详细边界见 [颜色审计](UPSTREAM_87E2283_COLOR_AUDIT_2026-10-13.md) 与 [PSD RGB ICC策略](PSD_RGB_ICC_POLICY_2026-10-13.md)；新算法及统一门禁见 [alpha.22验收](PHOTOSHOP_ALPHA22_ACCEPTANCE_2026-10-13.md)。
