# C2 首批：独立 PSD 语料盘点、执行报告及24项计划

核验日期：2026-10-10；产品基线：alpha.9。第一步添加独立脚本、测试、原创建图语料及报告；alpha.9统一gate及发布完整性确认后，继续实施C2最小导入修复，准备独立的alpha.10构建。没有修改UI或依赖，也没有覆盖alpha.9发布包。

## 1. 来源盘点与可执行结论

| 来源 | 当前可用内容 | 使用边界 |
| --- | --- | --- |
| 本仓库现有PSD单测 | 手写Adobe结构的RGB8/16字节、ag-psd生成的组/文字/样式/调整等组合、真实Skia渲染往返 | 手写结构是独立规范oracle；ag-psd自行生成/自行读取是项目回归，不是外部应用验收 |
| ag-psd官方测试图像 | 官方代码MIT，但LICENSE明确排除仓库图片和笔刷 | 无逐份图片授权证明，因此本批未下载或引入；仓库公开不等于图片可重分发 |
| 已安装独立工具 | macOS27.0/26A428的`/usr/bin/sips`，版本`sips-316`；`sips --formats`列PSD为Writable | 能立即生成并独立读取PSD合成预览。不能生成文字/组/智能对象等复杂编辑结构 |
| Photoshop / Krita / GIMP / ImageMagick | 本机未发现上述应用/命令；原版Compositor源码明确只读PSD，不写PSD | 尚无真实Photoshop作者文件/参考重算环境。未为本批安装新依赖或上传用户图片 |

ag-psd资产边界依据 [官方LICENSE](https://github.com/Agamnentzar/ag-psd/blob/master/LICENSE)。本次ImageIO图片是脚本自产8×6数学色块，不含下载照片、用户业务图像、商标、字体栅格或第三方笔刷，按本仓库MIT许可提供。源图、PSD、独立解码PNG的SHA-256及生成命令见 [provenance.json](../fixtures/photoshop-corpus/imageio/provenance.json)。

**实际结果：已取得4个合法的独立应用生成PSD，但它们的layer PackBits在此sips版本下出现坏包；有效独立复杂PSD仍为0。** 这4个文件保留为独立异常输入，不能计入24项复杂语料已完成，也不能宣称Photoshop本体验收通过。

## 2. 已执行的4份独立文件：修复前基线

| ID | 原创素材 | 图层字节独立检查 | 项目读取 | 原始源预览对比 | 项目未编辑/修改后往返 |
| --- | --- | --- | --- | --- | --- |
| C01 | opaque-color-grid：不透明RGB网格 | G通道行0/1截断，行2超宽 | 可读，未报告坏RLE | 阻塞：源层数据本身不合法 | 通过，限项目内证据 |
| C02 | alpha-coverage：0/1/64/127/128/192/254/255覆盖率 | R通道前几行截断/不足 | 可读，未报告坏RLE | 阻塞；透明像素处理需另判 | 通过，限项目内证据 |
| C03 | hard-edge-checker：绿/品红棋盘 | G行0仅展开7、B行0仅展开5，期望宽8 | 可读，未报告坏RLE | 阻塞；最大可见RGB差254字节 | 通过，限项目内证据 |
| C04 | transparent-border：透明外围和不透明中心 | G行0/1截断，行2超宽 | 可读，未报告坏RLE | 阻塞；覆盖率也有差异 | 通过，限项目内证据 |

项目未编辑往返检查真实图层PNG像素、几何、透明度及重算结果。修改后通过正式`Editor.apply`执行50%不透明度和中心画笔，再导出、重开和Skia重算，允许PSD透明度字节量化造成≤1字节差异。这证明编辑链稳定，不证明原始源图导入正确。

Apple ImageIO读取项目写出的合成预览后，4项均与项目渲染存在差异，报告为`different`。ImageIO这一流程读取merged composite，尚未验证独立应用按图层重算；尤其半透明颜色的预乘/解除预乘行为还需查证。不能将它笼统归责为项目颜色混合bug，也不能忽略这条红灯。

本次检测工具已实现独立RGB8原始通道和PackBits读取；它不使用ag-psd解析通道，并用手写合法raw/RLE结构的已知像素验证，避免把检测器“总判错”当证据。扩展工具前只用于其明确支持的普通RGB8光栅层；复杂蒙版/ZIP/16bit/PSB需要新增规范oracle，不能直接套此解析器。

## 3. 最小问题复现与下一批修复建议

复现路径：`fixtures/photoshop-corpus/imageio/hard-edge-checker.psd`。源PNG首像素和ImageIO合成预览是绿色；实际图层PackBits行不合法，项目导入颜色不正确且无警告。异常不只出现于8×6：另试16、32、64、128方形不透明网格，均出现层通道异常；JPEG作为输入也未获得合法layer info。因此本批不把增大尺寸或简单RGB互换作为修复。

建议下一批在本地PSD桥接层对**实际读取的raw channels**增加有预算的输入校验：

1. RLE行长度表必须在通道长度内；每个literal/repeat packet的数据必须在该行边界内。
2. 每行解码字节数必须与通道宽度×每像素字节数相符；层与蒙版分别用各自尺寸，PSD/PSB用正确长度表宽度。
3. 任意通道坏包时，明确拒绝该层结构导入或提供显式“仅导入合成预览”的降级选择。不能悄悄以合成预览替换编辑图层，更不能整体交换RGB。
4. 正确输入继续走原来结构转换，新增negative回归检验坏包不进入编辑工程、无部分提交；合法raw/RLE/NOP、16bit、蒙版和PSB分别测试。

上述是第一步收集时的真实红灯。alpha.9验收完成后，已经按以下最小范围实施产品修复，最新runner对4个异常源均记录`rejected-malformed`，后续往返/修改/外部查看全部为`not-run-rejected-input`，不再发布错误像素。原异常fixture仍保留，不重新生成“修好”的文件以掩盖来源缺陷。

### C2已实施的导入补丁

- 新增`src/core/photoshop-channel-validation.ts`，在已有preflight尺寸/文档预算后、像素解码前校验已消费RGB8/16的Raw和RLE。图层/两类蒙版各用其bbox，PSB表项为4字节；group/adjustment不使用的颜色、空通道与ZIP沿用原处理。只检查确证的包边界/展开尺寸异常，不把第三方库历史容忍描述为所有文件的安全问题。
- 按Adobe规范保留合法奇数行padding、PackBits NOP及允许的最终对齐。实际奇数宽度多行Raw padding在固定库中会串行读错，因此本地适配器剥除pad后走已有Raw解码；输入文件字节不变。
- 手写独立RGB16字节夹具证实固定库的RLE路径忽略bitDepth：同一像素Raw为`[255,128,0,0,1,255,128,255]`，RLE错误为`[1,0,0,0,1,0,0,0]`。补丁在已验证的16RLE通道上解压为新的大端Raw字节，再交已有正确Raw路径；不是整体换色，也没有修改node_modules。
- 规范化只创建每个转换节点的临时clone，不把扩大后的buffer写回原树；转换后的项目存PNG8。输入hash及parsed descriptor不变已测。预算包括扩展通道、RGBA16解码、量化及PNG暂存，超512MiB节点预算明确RESOURCE_LIMIT。
- ZIP没有新增字节校验；当前未验证所有32bit、其他颜色模式或所有独立应用的PSB实现。此补丁仍是16bit输入转RGBA8，不提供16bit编辑/无损输出或HDR。

行padding依据 [Adobe Channel image data规范](https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/)，固定库行为依据本地ag-psd31.0.3源码与独立字节实测。该适配器与已有文字/样式/矢量/调整映射无关，没有扩大这些能力声明。

## 4. 24项真实兼容语料目标

下表是24种文档目标，不是已有文件清单。每份必须具备作者/工具版本、素材授权、源PSD/PSB的hash、独立参考合成和操作记录；先验证层数据合法，才纳入有效语料。优先使用自制色块、授权字体或本地明确可再分发的素材，通过授权的Photoshop环境或能保留对应结构的独立编辑器输出。应用不能表示某项结构时，不强行用同库写出冒充外部作者。

| 目标 | 文档组合 | 四阶段验收重点 | 状态 |
| --- | --- | --- | --- |
| P01 | RGB8普通像素，raw/RLE，非零坐标 | 原通道及透明度、读取、未编辑往返、平移后重算 | 待合法外部文件；现C01仅异常负例 |
| P02 | 含低alpha与alpha0隐藏RGB的像素层 | 可见指标与原始straight RGB分别检查，不能互相替代 | 待合法外部文件；现C02仅异常负例 |
| P03 | 混合模式与Fill/Opacity组合 | 两种不透明度分离，普通模式与特殊模式重算差异 | 待外部文件；已有内部结构回归 |
| P04 | RGB16渐变和Alpha | 明确量化警告、颜色/精度降级及8bit输出标识 | 已有手写规范oracle；待外部文件 |
| P05 | PSB基础像素/小型结构 | version2、64位长度字段及资源拒绝 | 已有内部生成回归；待外部文件 |
| P06 | 单层蒙版，patch坐标、外部默认色 | 扩展到图层网格、移位、禁用/启用后重算 | 待外部文件 |
| P07 | 不链接蒙版、density/feather | 参数与像素分别保留，缩放与编辑蒙版失效边界 | 待外部文件 |
| P08 | 两层以上嵌套pass-through组蒙版 | 正确父子/顺序、组与层透明度、移动后重算 | 已有内部组合回归；待外部文件 |
| P09 | isolated Normal组与非默认组混合 | 结构保持与预览限制分开报告，不能假装等价 | 待外部文件 |
| P10 | 连续多个clip，组内/组外边界 | 剪贴基底/关系合法性，改序后明确降级 | 已有内部回归；待外部文件 |
| P11 | Levels/Curves+各自蒙版+clip | 参数、调整顺序、曲线插值及组合重算 | 待外部文件 |
| P12 | HSL色段/Colorize/Exposure/ColorBalance | 真实描述符、颜色范围和参数修改 | 已有内部字节回归；待外部文件 |
| P13 | BlackWhite/GradientMap+不支持调整 | 已支持结构可编辑，未支持部分警告/避免静默丢失 | 待外部文件 |
| P14 | 点文字，多颜色/字体run，UTF-16 | 原始文字结构、修改后字体/颜色/基线差异 | 已有内部结构回归；待外部文件 |
| P15 | 框文字、段落、tracking/leading、旋转 | 框尺寸、换行、缩放，字体缺失分开报告 | 待外部文件 |
| P16 | 竖排/路径文字/warp | 未编辑描述符保持、编辑后明确回退，旧结构不复活 | 已有部分内部回归；待外部文件 |
| P17 | 矩形/圆角/椭圆，旋转翻转 | SoCo/vmsk/vogk、实时边缘与修改后结构 | 已有内部结构回归；待外部文件 |
| P18 | 任意路径、描边、vector mask/real mask | 高级路径与组合蒙版边界，回退/保留分开验收 | 待外部文件 |
| P19 | 六类基础样式组合、全局光 | 结构保留与真实阴影/发光边缘重算分别评价 | 已有内部组合回归；待外部文件 |
| P20 | 多实例样式、Bevel/Pattern/Satin | 未编辑高级描述符、显式编辑后失效及回退 | 已有部分内部回归；待外部文件 |
| P21 | 嵌入智能对象，多实例变换 | 源/引用保留、改源同步、缩小再放大原图恢复 | 当前产品仅像素回退；待外部文件 |
| P22 | 链接智能对象、缺失链接/嵌套源 | 不自动网络访问，缺失/循环预算、明确资源报告 | 当前未实现；待外部文件 |
| P23 | 智能滤镜链+滤镜蒙版 | 顺序、启用、参数编辑与原源不变 | 当前未实现；待外部文件 |
| P24 | 综合文档：组/蒙版/clip/文字/矢量/样式/调整/智能对象/锁/参考线/ICC | 同文档读取→保存→编辑→重算，防止单功能通过却组合失败 | 待真实综合文件及Photoshop参考 |

对每份文档分别记录：①真实文件结构与合法性；②读取及报告；③未编辑往返；④修改后的图层重算。独立应用只读出存储composite时，报告“独立查看预览”，不能填“图层重算通过”。真实Photoshop本体验收需要额外来源/运行证据，目前仍缺失。

## 5. 已交付脚本及执行方式

```sh
# 只在macOS重新生成自产源图/PSD，更新版本和hash记录。
npx tsx scripts/psd-corpus/generate-imageio.ts

# 各阶段分别写报告及文件到已忽略的artifacts目录。
npx tsx scripts/psd-corpus/runner.ts

# 真正兼容门槛；当前因没有有效独立输入而返回2，拒绝坏输入不等于兼容全部通过。
npx tsx scripts/psd-corpus/runner.ts --strict

# 不依赖Photoshop；非macOS跳过实时sips输出检查并明确not-run。
npx tsx --test tests/photoshop-corpus.test.ts
```

生成产物：`artifacts/photoshop-corpus/report.json`、未编辑/修改后PSD、项目渲染PNG和独立ImageIO预览。它们不进Git。固定原始语料和provenance在`fixtures/photoshop-corpus/imageio/`，作为带来源的测试输入保留。

可复用手写fixture入口为`scripts/fixtures/photoshop-channel-fixtures.ts`的`photoshopChannelFixture(options)`，供单测和真实Electron导入链验收：16RLE用`{depth:16,mode:'rle'}`；PSB加`psb:true`；odd8 padding/NOP用`{depth:8,width:3,height:2,mode:'raw-row-pad'/'rle-row-pad'/'rle-nop'}`。这类文件是独立规范夹具，不冒充Photoshop作者文件。

本批新增**19项单测通过**（corpus6、guard/adapter10、独立16RLE/oddpad3），原PSD专项52项保持通过，合计**71项**。覆盖合法raw/RLE、16bit与PSB、mask尺寸、真实像素等价、NOP/padding、截断/超宽拒绝、source hash不变、资源预算及分类报告；`npm run typecheck`通过。该结果不是整个产品final gate，也不是24份复杂PSD或Photoshop视觉验证通过，集中构建/桌面验收由发布流程继续完成。

产品补丁已进入alpha.10集中验收和真实macOS ARM64目录包，4项导入桌面/包级检查通过，失败输入不会改变工程、随后正常16RLE输入像素正确；全量617项及真实包MCP等结果见 [alpha.10验收](PHOTOSHOP_ALPHA10_ACCEPTANCE.md)。这不会改变有效外部复杂语料为0的结论。
