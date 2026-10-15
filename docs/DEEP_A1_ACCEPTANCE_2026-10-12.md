# A1 16 位工程基础验收 — 2026-10-12

状态：通过，冻结版本 `0.3.0-alpha.12`。完成 A1 验收后才开始 A2 调色与模糊笔刷接入。

- `npm run check`：739/739 测试、类型检查、国际化、构建通过；随后新增的文件名替换精度保护测试也通过，deep-editor 共 10/10。
- 独立上游 C 参考：20 组量化和 trilinear cube 数据完全相同，最大差值 0。
- 实际开发版桌面：10 条高位深读取、双语显示、保存、撤销重做、复制删除、恢复和原子拒绝流程通过。
- 实际 macOS ARM64 包：同样 10 条高位深流程通过；另 5 条 v12 PNG8/PNG16 兼容及未来 v13 拒绝流程通过。
- 包完整性：16 个运行 bundle、模型、图标、28 个许可证文件与构建输入一致。

包：`release/0.3.0-alpha.12/mac-arm64/Compositor Electron.app`。
报告：`artifacts/deep-a1-packaged/acceptance.json`、`artifacts/deep-a1-v12-packaged/acceptance.json`、`artifacts/deep-a1-integrity.log`。

源 PNG16 和源 hash 逐字节保留；工作数组为 premultiplied sRGB RGBA16；显示为明确标记的抖动 PNG8 副本。蒙版保持 PNG8 灰度。撤销历史保留完整 immutable 源资产；失败操作不会改变 revision、历史或源数据。支持 PNG16 sRGB 的 v12 工程；8 位工程保持 v11 行为。

限制：这是 16 位整数 sRGB 工程保留，不是 HDR。A1 尚不开放高位深像素编辑、独立 PNG16 导入、深度重采样、PSD16 导出和混合合成的高位深导出。当前渲染导出为 PNG8 显示链路，API capabilities 明示这一点。原版 app 的完整往返未验证：固定快照 Xcode 构建停在 Sparkle 网络依赖下载，已停止此次独立构建；上游原始 C 源参考独立完成。Windows 运行、签名、公证均未验收。
