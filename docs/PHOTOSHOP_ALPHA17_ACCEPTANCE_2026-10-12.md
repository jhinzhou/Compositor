# alpha.17 Photoshop 对齐首批统一验收

日期：2026-10-12；项目 `Compositor_Electron`；版本 `0.3.0-alpha.17`。当前报告为最终门禁汇总，执行状态在下表单独记录。范围是最新 Compositor 移植之后的第一批本地 Photoshop 研究、常用行为/效果修复、真实 RGB16 PSD/PSB 读取，以及有测量依据的 HDR 合成/内存预算优化。不是全部 Photoshop 能力已实现的声明。

## 本轮实际修改

- 普通 HSL 先 RGB Lightness 再 Hue/Saturation，支持真实 Photoshop 正/负方向色块参考；曲线横向端点、区间外端值与 PSD 原始参数保留。
- HDR Exposure 用有符号 Gamma 保留负值，默认恒等精确复制；该负值行为来自 Adobe 官方语义与代数测试，仍没有实际负 HDR Photoshop 作者输出。
- 选区 Feather/Anti-alias 参数保留；组合独立覆盖，避免重羽化旧区域；蚂蚁线按最终≥50%覆盖生成；Add/Subtract/Intersect 从已有选区内部开始依然组合。
- 文字/形状绘画前中英文栅格化提示与共享 `layer.rasterize`，取消不修改、确认可撤销，蒙版/Quick Mask 不转换文字。Photoshop 操作模式点击蒙版保留画笔，避免自动跳回移动工具。
- PSD/PSB RGB16 原始通道读取为 canonical PNG16、premultiplied Uint16 working 与独立 PNG8 display；Raw/RLE/ZIP/prediction、strict parser、profile 和资源预算验证。普通 RGBA8 写出不变，高位深 PSD 导出明确拒绝直到用户显式转8位。
- HDR raster 流式合成减少整面临时缓冲，固定512MiB预算保留；主控制器/worker transfer/文档历史/剪贴板/preview 的存活字节在导入前合计，失败不替换工程。

## Photoshop 证据与效果

实际本地版本27.11.0，使用自制分析网格、17³色块、透明边、阶跃/脉冲、非字节网格PNG16。3轮原生脚本通过 File→Scripts→Browse，另有原生手工 PSB16 Save As，共47个成功输出文件。早期脚本失败及PSB构造器失败保留，不计通过。

普通 HSL RGB8色块联合 H25/S30/L-10 最大误差26→2，MAE4.1258→0.3570；RGB16同组最大误差6666→230，MAE1036.4723→42.6500。两点曲线(16,0),(239,255)分析网格的可见/预乘RGB及Alpha全0差异。Gaussian和羽化仍有差距；不能以这两组结果推导全部调色核相同。

真实4份RGB16层文件累计2,647,180通道值与Photoshop独立作者PNG16比较，最大误差0。这证明这些简单图层文件的通道保真；不证明任意复杂PSD外观、文字重排、智能对象或RGB32。PS自身对65×33原输入open/save有6530值变化、max2，比较对象是实际保存的作者参考。

详见 [原生研究](PHOTOSHOP_NATIVE_RESEARCH_2026-10-12.md)、[效果误差](PHOTOSHOP_EFFECT_MEASUREMENTS_2026-10-12.md)、[RGB16读入](PHOTOSHOP_RGB16_IMPORT_REFERENCE_2026-10-12.md)、[结构与性能](PHOTOSHOP_CODE_PERFORMANCE_ALPHA17_2026-10-12.md)。这些独立作者通道和效果参考已归档在 fixtures 中，不用产品自己生成expected。

## 统一门禁

| 门禁 | 状态 / 证据 |
| --- | --- |
| i18n/typecheck/1,226 tests/production build | PASS，`artifacts/alpha17-check-release.log`；追加脚本类型检查 `alpha17-typecheck-final.log` |
| 7组开发版 Photoshop 阶段桌面 | PASS，`artifacts/alpha17-photoshop-dev/acceptance.json`；选择、合成RLE16、实际PS PSD16/PSB16、common、workflow、interaction |
| 5组开发版高位深/UI/MCP | PASS，`artifacts/alpha17-dev/acceptance.json`；114项，包含52个双语/双窗口布局检查 |
| 7组包内 Photoshop 阶段桌面 | PASS，`artifacts/alpha17-photoshop-packaged/acceptance.json`；使用实际alpha.17 executable，隔离profile |
| 5组包内高位深/UI/MCP | PASS，`artifacts/alpha17-packaged/acceptance.json`；114项，使用实际alpha.17 executable |
| 裁剪component capture/透明命中/Escape恢复 | PASS，`artifacts/alpha17-crop-overlay.log`；fixture按真实父组件cancel事件契约恢复draft，几何/像素和gesture检查 |
| 追加真实窗口crop handle Escape | PASS，开发/包内interaction/checks.json与interaction-final.log；恢复pending draft、release lease后再裁剪，两种运行环境均7项通过 |
| 真实4K EXR编码/解码/合成/只读preview | PASS，`artifacts/alpha17-hdr-real-source/results.json`；源数据不改，negative/overwhite保留 |
| macOS ARM64未签名目录包 / 最终一致性 | PASS，`artifacts/alpha17-integrity-final.log`；16个runtime bundle、28个license文件及model/icon一致，最终source manifest已刷新 |

开发版与实际应用包各通过174项桌面检查：Photoshop阶段60项（包含阶段汇总之后追加的真实裁剪手柄Escape检查），高位深/UI/MCP阶段114项。同一批案例在两种环境重复验收，不计作348项独立功能。应用包app.asar SHA-256：`a1a708d7127d4e5d86746816adef9d9d76de6cd5d63b5513915b90728ca5aa3e`。

所有桌面GUI串行运行，临时profile/self-authored工程；不替换用户工程或访问Photoshop业务图片。部分既有clipboard测试使用process-local doubles，不能代表系统外部剪贴板互操作；真实stdio MCP与core typed action共享路径独立执行。裁剪仍保留原始图层source，不声称与Photoshop默认Delete Cropped Pixels破坏行为相同。

包路径：`release/0.3.0-alpha.17/mac-arm64/Compositor Electron.app`；开发版从当前 `out` 启动。运行构建不等于Windows通过，目录包没有签名、公证或正式安装器。本轮没有Git提交或推送；完整开发改动和历史alpha批次保持在工作区。

## 下一批明确缺口

Gaussian/feather核与历史参数迁移、画笔完整Opacity/Flow/笔尖动态的实际PS参考、Camera Raw/修复/液化效果、RGB16 PSD writer、RGB32 PSD/PSB和ICC转换、隔离组/Fill/高级剪贴/Blend If、智能对象/智能滤镜、任意矢量路径/文字样式、复杂发丝与颜色净化均继续按计划单独推进。现有实验性细化不能当作PS发丝等价；HDR存储/处理不能当作HDR/EDR屏幕输出。
