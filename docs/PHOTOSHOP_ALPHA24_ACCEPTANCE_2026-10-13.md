# alpha.24 修复工具、选区与透视、紧凑工具栏验收

日期：2026-10-13。版本：0.3.0-alpha.24。参考：本机 Photoshop 2026 27.11.0。当前状态：本批开发、真实开发版/目录包统一验收通过；效果残差仍按下文保留。

## 实现和使用方式

- 工具栏使用18px图标、30px按钮；较矮窗口17px/28px，低于640px双列；窗口最小高度调整到600px。色板和全部工具保持可见，点击范围至少28px。
- 右键/长按/Shift-F10打开二级菜单。子项带独立图标、勾号、快捷键；当前项/组内记忆项决定外层图标、默认焦点及点击激活。Shift+J按污点修复、移除、修复、修补、内容感知移动、红眼循环。
- 移除：涂抹对象或画闭合圈，抬笔应用一次；Esc取消。执行本地内容补全，有硬度、大小、不透明度及透明度保护。
- 内容感知移动：先建立选区，在内部拖动，保持预览；Enter或应用按钮确认，Esc、切换工具或窗口失焦取消。移动对象、填旧位置、融合目标和移动选区共同形成一个历史步骤。
- 红眼：点击瞳孔或框选眼部；瞳孔大小、变暗量均默认50%，保留白色高光和不相连的红色区域。
- Patch：修正零透明度/零位移造成重新编码、移动选区、丢失Redo的问题；真正no-op保留源文件和历史。
- 修复了跨笔划预览编号重用引起的缓存污染：预览资源使用实际内容身份，不再用从1重新开始的局部请求编号标识图像。

## Photoshop 原生效果

本轮使用自制测试图，不使用用户“选品调研”图片。原生工具由本机UI操作，脚本只负责打开自建文档、保存PNG及读取尺寸/历史。所有参考有RGBA哈希，已转成仓库内不可变fixture，可从干净克隆复算。

| 项目 | 修改前 | 修改后 / 当前差距 |
|---|---|---|
| 快速选择圆形原生覆盖 | 1112像素不同，MAE0.37109375 | 0像素不同，MAE0，IoU1；只有一个原生圆形样本 |
| 透视矩形401×241 RGB MAE | 0.947424 | 0.018232，最大差15；实际生产核，包括整数精确采样分支 |
| 透视反向四角384×219 RGB MAE | 1.025899 | 0.361642，最大差41 |
| 红眼诊断ROI RGB MAE | 7.8242 | 4.2907，最大差149；中心原18/19/16→32/32/32，PS31/31/31 |
| Patch有效原生样本 | 原生此前无有效输出 | 默认Adaptation=1时选区RGB MAE7.0251，最大20；保留残差，不依据单例改采样坐标 |

透视仅在Photoshop交互配置将鼠标像素中心转换为公共边界坐标，预览与应用同一转换，MCP/core语义不变。上表透视明确使用原生输出尺寸，**自动输出尺寸仍不同**。快速选择的原生单例与人工独立回归不能泛化为发丝/自然照片一致。红眼原生参考包含两次动作，PS外围软影响与产品保守连通区域仍有差异。

首次Patch导出没有像素变化且后续历史未含Patch，被排除；重新明确源模式后获得含“修补选区”历史的有效样本。失败证据保留于artifacts，详见[修复算法报告](PHOTOSHOP_RETOUCH_ALPHA24_2026-10-13.md)及[选择/透视报告](PHOTOSHOP_SELECTION_EFFECTS_ALPHA24_2026-10-13.md)。

## 验收范围与已发现的问题

完整门禁保留alpha.23原有25套，新增紧凑工具栏和新修复工具两套。实际鼠标/键盘、私有预览、源像素、Undo/Redo和保存重开均验；原生文件对话框仅替换路径，不替换编辑效果。

第一轮真实运行在内容感知移动预览断言失败，定位为缓存键冲突并修正；单独复测还发现测试窗口未真正激活，改为真实app.focus和焦点检查，不通过伪造失焦事件规避。失败报告保留，正式门禁使用冻结后的相同构建从头运行。

| 门禁 | 结果 |
|---|---|
| 源码 | 1875项测试通过，0失败/跳过/取消；类型检查、构建通过 |
| 国际化 | 40个Vue组件、2167条唯一消息、768个literal key，0问题 |
| 实际开发版 | 27套 / 364项通过，0运行错误、0截图替代 |
| 实际macOS ARM64目录包 | 27套 / 364项通过，0运行错误、0截图替代；实际app版本0.3.0-alpha.24 |
| 专项覆盖 | 每个runtime均含32项工具栏、8项新修复工具、52项面板布局；另外保留原有25套回归 |

两种runtime均冻结在同一构建，SHA256：`4381ff3f4f15363fcba38c8f3a222a4f3a0e4c16323b142f6f70a3d9d601c4c3`。每套开始/结束核对构建摘要，目录包由实际.app可执行文件启动，不以开发版代替。

机器证据位于 `artifacts/alpha24-check-release.log`、`artifacts/alpha24-development-validated/acceptance.json`、`artifacts/alpha24-packaged-validated/acceptance.json`；汇总见 `artifacts/alpha24-unified-acceptance.json`。菜单实际截图在两种runtime的 `toolbar-alpha24/j-six-tools-zh.png`，除DOM断言外还核对实际PNG中的高亮像素。

## 新版应用和发布核对

- 应用：`release/0.3.0-alpha.24/mac-arm64/Compositor Electron.app`，未签名macOS ARM64目录包。
- 压缩包：`release/0.3.0-alpha.24/Compositor-Electron-0.3.0-alpha.24-mac-arm64.zip`，241058983字节。
- ZIP SHA256：`28674fcad12adda3107ac56b0e6552afe3497dc4567e599b4cf98b353485950a`。
- 发布核对使用 `npx tsx scripts/verify-release.ts mac-arm64`；对实际asar中的全部当前runtime文件及模型、图标、许可证逐文件比对。源快照见同目录的 `SOURCE_MANIFEST.json`，最终结果见 `artifacts/release-integrity.json`。
- 更新时先保存并退出旧窗口，再打开上述alpha.24路径；历史发布包保留，本批不强制退出用户未保存工程。


## 仍需继续完成

三个新修复工具仅RGB8当前栅格层、最多200万源像素；Patch最多400万。16位/HDR不静默降级，明确拒绝并保留源和历史。没有生成式移除、自动干扰物检测、所有图层取样、独立输出新层、Extend、Transform on Drop或Adobe私有Diffusion等效保证。移除需要周围有可用供体；复杂纹理、自然人像和大图仍需专题验证。

截图22子工具为8基础/10部分/4缺少，剩余切片、切片选择、注释、计数。112能力族仍14基础/67部分/31缺少：本轮新增归属原已部分的C051/C052，不重复计为整族完成。Windows真机、HDR显示器、自然发丝及任意外部复杂PSD均是独立门槛。

## 可复现命令

```sh
npm run check
npx tsx scripts/measure-tools-alpha24.ts
npx tsx scripts/measure-perspective-alpha24.ts
npx tsx scripts/measure-red-eye-alpha24.ts
npx tsx scripts/measure-patch-alpha24.ts
npx tsx scripts/check-alpha24-runtime.ts artifacts/alpha24-development-validated
```

本次不提交或推送Git，保留工作区之前未提交改动。构建、运行报告和临时样本继续由现有gitignore排除；不可变原生fixture与回归源码可纳入后续提交。
