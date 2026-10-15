# 16 位调色与模糊笔刷 A2 验收（2026-10-12）

## 当前状态

**统一验收通过，版本 `0.3.0-alpha.13`。** A1 工程读取、保存、撤销已单独验收并冻结在 alpha.12。本记录依据实际源码、桌面、安装包和独立像素参考报告。

脚本：`scripts/smoke-deep-edit.ts`。开发版和实际安装包均使用独立临时 profile 串行执行；不关闭用户已有窗口。

## 计划检查

| 范围 | 检查内容 | 当前结果 |
| --- | --- | --- |
| 源图 | 由大端扫描行、CRC32、zlib 独立组装的 PNG16，非 257 倍数样本、交替纹理、不同透明度；打开后源字节不变 | 通过 |
| 调色 | Levels、Curves、Exposure、Hue/Saturation、Black & White、Color Balance、Gradient Map、Invert | 通过 |
| 调色预览与历史 | 每个滤镜的预览不产生历史；提交后的 PNG8 显示代理与预览字节一致；源保持 PNG16，透明度保留，撤销／重做恢复完整源字节 | 通过 |
| 实际调色界面 | 命令搜索打开 Exposure，改变参数，等待预览，应用，再撤销 | 通过 |
| 局部选择 | 软选区调色保留远离选区的 canonical RGBA16 样本 | 通过 |
| 模糊笔刷 | 保护透明度／不保护透明度的 strokePreview 与提交代理一致；源仍为 PNG16；选区外 canonical 样本不变 | 通过 |
| 多笔画与实际鼠标 | 连续两笔使用当前深色源；逐笔撤销；实际画布拖动产生一个完整事务 | 通过 |
| MCP | 实际 stdio 的 document.apply 执行 Invert，history.undo 恢复原始源字节 | 通过 |
| 原子拒绝 | 未支持的高位深 Fill 拒绝，源／历史／revision 不变 | 通过 |
| 保存与重开 | 调色和模糊后的 v12 工程保存、关闭、重开，PNG16 与再生成代理一致，原始测试工程保持不变 | 通过 |

开发版 19 项通过；新增导出面板精度提示与 API 输出深度检查后，实际安装包 20 项通过，两者页面错误均为 0。

## 执行入口

开发版（构建完成后）：

```sh
COMPOSITOR_SMOKE_OUTPUT=artifacts/deep-a2-development npx tsx scripts/smoke-deep-edit.ts
```

安装包：指定 `COMPOSITOR_EXECUTABLE` 为本轮实际 app 内的 `Contents/MacOS/Compositor Electron`，使用另一个输出目录。脚本分配独立 profile/CDP 端口，只退出自身测试进程；不会关闭用户已有文档窗口。

## 结论边界

- PNG16 输入由测试脚本自产，编码独立于产品 Asset/Editor 实现；不是原版应用或 Photoshop 保存的外部工程。
- 预览与提交一致证明编辑链路一致；像素算法与上游独立 C 内核的比较由另一个 oracle 验收负责，不能由本脚本的内部一致性推出质量等价。
- 保存字节完整、canonical RGBA16 局部样本、显示 PNG8 代理分别核验。UI 仍显示 8 位代理，不将代理渲染当作高位深显示输出。
- 本轮不包含高位深调整图层合成、PNG16 合成导出、PSD16、浮点 HDR、Windows 原生运行或原版应用往返。

## 实际结果

- `npm run check`：786/786 测试通过，类型、国际化与构建通过。新增验收脚本的最后 TypeScript 复核也通过。
- 独立参考：基础 deep/dither/cube 20 组完全一致；调色 C/Swift cube hash 与 deep 输出 9 组完全一致，最大差值 0。模糊与独立 Simpson 积分 Gaussian 标量参考差值至多 1 个 16 位样本，不等同于 Core Image 整条管线参考。
- 开发版：`artifacts/deep-a2-development/acceptance.json`，19 条实际流程通过。
- 实际 ARM64 app：`artifacts/deep-a2-packaged/acceptance.json`，20 条实际流程通过，包含真实鼠标拖动、Exposure 对话框、MCP stdio、导出精度提示及保存重开。
- 既有 8 位桌面回归：`artifacts/deep-a2-regression/acceptance.json`，10 组全部通过，覆盖画笔、选区、裁剪/尺寸、交互、主体、Camera Raw、渲染与协议。
- 两个 deep 桌面报告页面错误均为 0。修复临时 TypeScript 空字符串联合类型错误、旧版测试未来版本号和现有图层改文件名绕过精度保护后复测通过。
- 包完整性报告：`artifacts/release-integrity.json` 与 `release/0.3.0-alpha.13/SOURCE_MANIFEST.json`，16 个运行 bundle、模型、图标、28 个许可证与当前输入一致。

新版：`release/0.3.0-alpha.13/mac-arm64/Compositor Electron.app`，macOS ARM64 无签名目录包。A1 包 alpha.12 保留独立冻结证据；本次源码改动保留本地工作区。

效果边界：Levels/Curves/Exposure 使用直接高精度公式，未复制原版 low/near/far 三次字节重建近似；Blur 使用可移植集成 Gaussian，Core Image 内核及超大采样自动降分辨率未照搬，超预算拒绝。已有边界均不是源图偷偷降成 8 位。高位深非破坏调整图层合成、普通绘制/涂抹/液化/重采样/合并、导入导出以及 RAW 自动镜头配置仍属后续阶段。原版应用完整往返未通过：Sparkle 下载阻断已单独记录。
