# PSD/PSB RGB8与RGB16的有限ICC导入策略

日期：2026-10-13。关联[上游87e2283色彩审计](UPSTREAM_87E2283_COLOR_AUDIT_2026-10-13.md)。本批次修复的是原来RGB8 PSD静默忽略嵌入ICC、把颜色数字标成sRGB的问题；没有实现CMYK或通用ICC色彩转换。

## 导入前检查

`src/core/photoshop-io.ts` 中的 `photoshopProfileWarning(bytes, depth)` 由8位与16位RGB共同调用，位置在 `ag-psd.readPsd` 图层解码之前：

| 来源 | 处理 |
|---|---|
| 无ICC1039 | 允许，报告“无嵌入ICC，源数字按sRGB解释，没有颜色转换”。不能推断无profile的图像原本是sRGB；这是明确的解释策略 |
| RGB/XYZ matrix/TRC ICC通过既有sRGB等效阈值 | 允许，源数字原样保留，报告“已检查为sRGB等效，没有颜色转换” |
| 非sRGB或不支持的ICC | `UNSUPPORTED_FEATURE`，提示在Photoshop转换一份相同位深的sRGB副本再导入；`details`包括 `conversionPerformed:false` 和 `sourceBitDepth:8|16` |
| 有嵌入ICC，但1041声明忽略profile | 拒绝，不偷偷把已声明忽略的profile强行采用 |
| 无ICC，1041声明untagged | 仍采用明确的无profile→sRGB解释策略，保持旧16位行为 |
| 重复ICC、尺寸不足/超过1MiB、异常资源长度、超过16384个资源、错误/重复1041 | `INVALID_IMAGE`，不进入图层解码 |
| CMYK及其它模式 | 原有入口明确拒绝；不调用ag-psd简单CMYK公式 |

既有16位的颜色空间判定原样复用：RGB、XYZ PCS，matrix转换与单位阵分量差不超过0.002，三条256采样TRC与sRGB曲线差不超过0.0002。它是有限的matrix/TRC解释检查，不能验证任意ICC、LUT、设备链接、Proof/色域映射或显示器校准。没有引入新CMM、没有更改源颜色数字、工作manifest仍为sRGB。原ICC容器资源仍不作为任意来源profile保真往返承诺。

RGB8行为变化是有意的：此前非sRGB嵌入配置文件会被静默忽略；现在明确拒绝，避免把看起来能打开但颜色错误的结果当作已兼容。合法sRGB文件、无配置文件的旧8位工程/PSD及其像素编码路径保持。

## 工作线程及现有工程保护

Photoshop导入controller在解码失败后显示可取消错误报告；没有解码快照就不能confirm，也不会调用 `DocumentManager.importPhotoshopSnapshot`。新增测试通过真实独立工作线程验证，取消返回null，已有工程的manifest、资产、历史状态、workspace列表与来源输入字节保持不变。

本批次不修改App、main、共享locale或产品版本。根流程负责将以下新增8位字符串接入中英文显示：

- `8-bit Photoshop document has no embedded ICC profile; source channel numbers are explicitly interpreted as sRGB without a color conversion.`
- `8-bit Photoshop embedded ICC was verified as sRGB-equivalent; source channel numbers are preserved without a color conversion.`
- `The 8-bit Photoshop document has a non-sRGB or unsupported ICC profile. Convert a separate copy to 8-bit sRGB in Photoshop before importing it.`

16位既有字符串不变。1041恶意重复的诊断为 `Invalid Photoshop color resources: invalid or duplicate untagged-profile flag.`；普通损坏资源沿用原有动态错误前缀。

## 验证证据

新增 `tests/photoshop-icc-import.test.ts` 34项：

- 真实Photoshop27.11保存的RGB8 sRGB PSD验证既有provenance哈希；导入后PNG8像素与独立的Photoshop输出PNG相同，输入字节未改变。
- PSD/PSB × RGB8/RGB16：无profile、合法sRGB、untagged、非sRGB矩阵、无法解析profile、忽略嵌入profile的标记。
- 四种组合中的短/超1MiB/重复ICC、重复/错误长度1041；color-mode长度、资源block长度、payload长度、Pascal名称长度及超量记录拒绝。
- 独立工作线程中的RGB8不兼容报告、禁止confirm、取消及已有文档不变。

非sRGB矩阵和恶意资源测试通过向小型Adobe结构fixture注入独立资源构造；这是输入防护测试，不把它称作真实Adobe RGB/P3文件的颜色转换oracle。真实sRGB测试来自已有不可变Photoshopfixture；未新增或修改native参考文件。

定向回归合计91项通过：新增ICC、真实Photoshop高位深导入、基础PSD/PSB I/O、通道校验、16位RLE、复杂图层真实Skia合成往返、import controller、Node生产导入、独立PSD corpus及metadata。类型检查、修改范围diff检查由本批次执行；实际桌面ZH/EN报告、目录包及Windows验收由根流程完成，不能从工作线程通过推导GUI或跨平台发布已完成。
