# 实施记录入口

当前开发版本：**0.3.0-alpha.6**。当前结论、最新上游源码快照、29 项对齐范围与剩余边界见 [alpha.6 统一验收](NATIVE_PARITY_ALPHA6_ACCEPTANCE.md)。本轮优先原版功能对齐，Photoshop 增强与 Windows 原生验证延后。下面 alpha.4 及更早的链接保留历史实施事实，不作为 alpha.6 未经重跑的证明。

- [alpha.4 排查与上游同步](UPSTREAM_CURRENT_USABILITY_AUDIT.md)：历史改动、真实交互回归、源码和发布包证据。
- [1.4.8 功能补齐与验证](UPSTREAM_1_4_8_IMPLEMENTATION_STATUS.md)：41 项当前实现映射、已完成实际回归、兼容边界和最终交付结果。
- [独立 1.4.8 审查](INDEPENDENT_1_4_8_AUDIT.md)：源码/执行链与原生文件证据，不混淆 1.4.7 原应用与 1.4.8 oracle。
- [原始差异与补齐方案](../../Compositor_1.4.8功能差异与补齐方案.md)：保留开发前 41 行快照，末尾追加 alpha.3 当前进展。
- [第二版 alpha.1 实现与验证记录](V2_IMPLEMENTATION_STATUS.md)：保留基线事实，不作为 alpha.3 验收。
- [第二版原始实施方案](V2_IMPLEMENTATION_PLAN.md)：AI 实施批次，功能优先、Windows 最后。
- [第一版历史记录](V1_IMPLEMENTATION_STATUS.md)：0.1.0 原始交付事实。
- [当前 MCP 协议](MCP.md)：12 个工具、批事务、任务控制和文档路由。

当前仍需区分：TIFF/PSD/字体兼容范围、全部大图操作的性能、ONNX/Vision 结果差异、Core Graphics 采样边界、真实 provider 尚未配置，以及 Windows 原生/正式签名分发验收。实时 retouch 像素反馈及浮动像素事务的已验收范围见 alpha.6 记录。

- [Windows交付说明](WINDOWS-RELEASE.md)：便携包运行、官方VC++安装脚本和Windows原生验收边界。


## 2026-10-10 alpha.6 原版对齐

本轮当前状态见 [统一验收](NATIVE_PARITY_ALPHA6_ACCEPTANCE.md)。实现与最新源码参考升级至 `d0ec2f3`，包括 CRT3 Camera Raw、尺寸更新保留效果/live content、WebP 与 Untitled 规则；29 工作包逐项保留已验收范围和剩余边界。本文较早章节为历史实施记录，不能代替 alpha.6 当前结论。Photoshop 增强及 Windows 原生验证延后。
