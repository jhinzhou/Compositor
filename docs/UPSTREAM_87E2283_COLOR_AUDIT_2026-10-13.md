# 上游 87e2283：CMYK、PSD 色彩管理与16位显示审计

审计时间：2026-10-13。上游对照范围为 `f5ae5bad0b25b32dda9f254e62d2f07f59478698..87e2283bae4cea45b857a1bb386f8a56ad4e99b6`；通过本地克隆的 `origin/main` 读取，未切换或修改原版工作区。Electron 对照当前工作区源码，包含此前的16位、HDR和 Photoshop 实测修正；这份文档不替代历史批次报告。

证据层次：上游源码及其测试源码、本项目定向核心/真实 Skia CPU 数值测试、Adobe/ICC 官方说明。此次没有运行原版新包、Photoshop CMYK 实操、Electron桌面输入或 Windows 包验收。新增屏幕路线的实际桌面及目录包验收由主流程完成后补充。

## 1. 上游新增的真实范围

| 提交 | 实际行为 | 不应扩大的能力声明 |
|---|---|---|
| [59025aa](https://github.com/robbietilton/Compositor/commit/59025aa) | RGB编辑文档通过选定 CMYK ICC 配置文件做屏幕校样、简化色域警告，JPEG/TIFF/PDF 平面导出能转 CMYK；新增 RGB TIFF | 不是 CMYK 文档编辑、印刷分色/专色通道或完整 Photoshop 软校样 |
| [896d5c8](https://github.com/robbietilton/Compositor/commit/896d5c8) | 8位 CMYK PSD 的 C/M/Y/K 颜色平面通过嵌入配置文件转 sRGB，采用配置文件供后续校样/导出 | 不是原始 CMYK 通道与文档色彩空间往返保真，也不是16位 CMYK PSD支持 |
| [905efc5](https://github.com/robbietilton/Compositor/commit/905efc5) | 普通16位图层直接上传 RGBA16 UNORM纹理，HDR使用 RGBA16 float，缩小纹理保留格式；画面最终8位显示时做固定噪声抖动 | 没有将8位显示器变成16位/HDR显示器；也没有证明与 Photoshop GPU 或显示配置逐像素相同 |
| [dac3bc6](https://github.com/robbietilton/Compositor/commit/dac3bc6) | 每次打开导出默认 RGB，避免一次 CMYK 导出影响后续普通屏幕图像 | 可以借鉴默认行为；没有转换后端时不先显示可选择的 CMYK功能 |

此范围还包含 Progressive Blur、快捷键和更新提醒；由其它模块单独处理。

## 2. CMYK 的转换链及需要避开的移植错误

原版 `Compositor/IO/CMYK.swift` 利用 macOS ColorSync/Core Graphics 解析 CMYK ICC；内部编辑仍为 sRGB。导出先在 RGBA8 sRGB 中铺底，再画入 CMYK8、relative colorimetric 的 CGContext。JPEG/TIFF随后编码该颜色空间的图像；PDF在页面上下文画CMYK图像。CMYK TIFF/JPEG/PDF 的透明部分需要铺底，不能承诺保留alpha。

PSDReader只接受 depth=8。mode=4时，资源1039的嵌入ICC用于颜色转换，无配置文件则尝试 macOS Generic CMYK。PSD颜色平面是反向存储，解码时先做 `255-plane` 得到实际墨量；没有的色通道按无墨处理。Alpha和灰度蒙版独立处理，专色及额外通道跳过。转换后使用原有 RGB 图层树；文本、矢量及调整信息继续原有解析路径。CMYK模式的调整元数据放到RGB工作文档后的语义，需要独立参考文件验证，不能只凭打开成功认定外观一致。

需要修正而不能照抄的细节：

- Profile对象只验证颜色空间模型为CMYK，未明确检查ICC的输出设备类别或完整结构/尺寸预算。Electron应在工作线程解析有界输入，限定支持的profile类别、tag结构、转换缓存和总内存。
- 原版以名字保存所选配置文件，安装列表也以名字去重，校样LUT缓存以 `profile.name` 为键。两个同名不同字节的ICC可能复用错误LUT。可移植实现应以ICC内容SHA-256及转换选项为缓存身份，名字仅供显示。
- 自动采用的ICC存在应用配置文件目录及全局偏好中；`proofProfile`/校样开关是Session状态，未见写进 `.comp` 文档模型。跨机器重开工程不能依赖相同名字的系统ICC。将来工程若要持久化，需绑定配置文件字节/哈希、来源模式和转换选项。
- “Generic CMYK Profile”是macOS环境能力，Windows不能假设存在或等价。无嵌入配置文件必须明确选择解释策略及来源，不能默默使用简单数学公式。
- 原版33³校样LUT通过 RGB8→CMYK8→RGB8 获得；色域警告仅检查回转RGB最大分量差是否大于10/255。它是简化可视提示，不是经过验证的 Photoshop gamut warning。
- PDF测试接受 `/DeviceCMYK` 或4分量ICC标记；这不能证明PDF输出意图、嵌入目标ICC、PDF/X或印刷交换合规。

CMYK数字依赖设备配置文件，经PCS转换才具有明确的颜色意义；同一组墨量在不同设备上不一定产生同色。CMM与转换选项也会影响结果。[ICC FAQ](https://www.color.org/faqs/)

Photoshop自定义校样还能指定设备、Preserve Numbers、rendering intent、Black Point Compensation、纸白及黑墨模拟；上游没有完整提供这些控制。因此“选择同一ICC”不足以证明上游与 Photoshop 校样一致；对照时必须记录这些选项。[Adobe：Proofing colors](https://helpx.adobe.com/in/photoshop/using/proofing-colors.html)

## 3. Electron 当前路径与差异

| 路径 | 当前已验证的源码行为 | 剩余差异 / 最小安全处理 |
|---|---|---|
| `src/core/photoshop-io.ts:header` | PSD/PSB仅允许RGB mode3，8/16位；CMYK、其它模式和32位HDR明确拒绝 | 保留拒绝，不能仅解开mode4 |
| 同文件 `photoshop16ProfileWarning` | 有界解析1039/1041；16位仅接受经matrix/TRC检查的sRGB等效ICC；未嵌入时明确按sRGB解释，无实际颜色转换 | 这是有限兼容桥，不是通用ICC CMM |
| 同文件8位导入 | 审计时确认1039曾被忽略；本批次已复用16位的有界ICC检查，sRGB等效接纳、无ICC明确按sRGB解释、其它ICC明确拒绝 | 消除静默重新标记；没有增加颜色转换。真实Adobe RGB/P3非sRGB源应在Photoshop另存sRGB副本后导入 |
| `node_modules/ag-psd/dist/psdReader.js:cmykToRgb` | 库用反向色平面 `R=C×K/255` 等简单公式，没有ICC参与；1039处理只在关闭的mock-handler路径中 | 不能作为CMYK支持后端；必须提取原始四色平面送真实CMM，绕过这个库的公式 |
| `src/core/foreign-color.ts:inspectICC` | RGB、XYZ PCS、matrix/TRC有限解析，1MiB profile限额；LUT/CMYK不支持 | 不能称为通用ICC转换，更不能套入CMYK |
| `.comp` manifest | `colorSpace`限定sRGB，高位PNG16/浮点EXR源与显示代理分离 | 有利于统一工作空间；若新增原始CMYK/配置文件元数据，需明确源解释和输出空间，不把CMYK ICC附到已转sRGB的像素 |
| PSD/PSB导出 | RGB8，16位需显式转层；目前未写通用ICC1039 | 应补明确的工作空间标记/实际sRGB配置文件能力，不能声称保留任意原始ICC或CMYK源 |
| TIFF导入 | 支持的RGB/灰度/索引等路径；CMYK/需额外色彩转换明确拒绝 | 同CMYK PSD，留给后端共用CMM后再开放 |
| ExportAs | PNG/JPEG/PDF/EXR；高位PNG16/EXR走原始源合成编码；普通PDF使用DeviceRGB | TIFF、CMYK输出及软校样均待实施；不能仅增加下拉选项 |

## 4. 16位屏幕显示：已授权的有限移植

原版最新画布在Metal纹理中保持16位源，最终画面才加固定空间噪声。Electron原有源码仅对HDR或“16位且含调整图层”的文档走 `deepCompositePreview`；普通16位图层在Skia中从各自PNG8代理开始变换/混合，提前量化。源PNG16及历史没有损失，但普通16位合成的屏幕精度落后于905efc5。

本批次已修改以下有限路径：

1. `src/renderer/canvas-engine.ts`：普通绘制只要快照含16位/HDR资产，都尝试工作线程高位合成，包括没有调整层的文档和注册的笔画draft。原有display缓存仍用于命中检测。
2. `src/core/deep-preview.ts`：明确在密集合成前检查当前可见图层能力、32MP/512MiB及计算预算。屏幕请求通过可选 `screenQuantization` 使用新量化；不传该字段的旧RPC行为保持。
3. `src/shared/deep-screen-display.ts`：新增只用于屏幕的uniform噪声，幅度±0.4995个8位level；alpha只舍入、不加噪声；HDR仅在SDR显示边界裁到可显示范围。固定输出像素坐标产生确定性噪声，重复绘制不变。不会改变源数组。
4. 不支持的可见效果、矢量蒙版或预算限制，普通屏幕回退到既有PNG8兼容路径，并以 `CanvasEngine.getDisplayWarning()` 提供session、revision、code及原因。App主流程需显示本地化提示。过期快照、损坏源及未知错误继续明确报错，不隐藏失败。
5. `setFullResolutionEffects(true)` 的导出路由保留既有判断及旧量化，不因屏幕升级改变历史输出；保存代理、PNG16/EXR编码、滤镜像素、旧独立native oracle均未修改。

主流程统一回归额外发现：隐藏渲染器的缩放预览不能仅依赖`fullSize`去区分屏幕抖动。已增加独立`setScreenQuantization(false)`用于隐藏的MCP取图、调整预览及工程缩略图；可见编辑器默认保持屏幕量化。保留最初HDR回归失败，不放宽原来的逐值比较。最终核心、实际Electron与目录包结果见 [alpha.22统一验收](PHOTOSHOP_ALPHA22_ACCEPTANCE_2026-10-13.md)。

精度边界：Electron使用CPU RGBA16/Float32，原版使用Metal UNORM16/HALF及Core Image。新的噪声分布遵循上游意图，具体序列不复制CIRandomGenerator。Electron量化发生在透明文档画面上，界面棋盘在其它层显示；上游在最终画面上抖动。因此透明边缘与缩放等显示不能声称逐像素一致。当前并未新增10位显示输出、EDR显示窗口或显示器ICC软校准。

CanvasKit hit test仍使用8位display代理，极低alpha精度的命中差异是独立事项；本批次没有把鼠标命中伪称为16位操作。16位无调整文档也开始密集合成，主流程实际验收需测持续缩放/平移，缓存命中及预算回退，不能用小fixture测试代替大图性能。

## 5. 验收门槛与后续顺序

### 已完成定向数值 / 真实CPU渲染验证

新增 `tests/deep-screen-display.test.ts` 10项：256个准确8位level不变、半level仅邻近100/101且比例误差<0.02、通用ramp每通道误差<1 level且平均有符号偏差<0.015、重复结果稳定、alpha/HDR显示裁剪且源不变、非法输入拒绝、完整16位合成/采样后量化、旧默认RPC结果保持、draft/commit精确相同、真实Skia接入与UNSUPPORTED/RESOURCE fallback及SNAPSHOT_EXPIRED错误策略。

与 deep-preview、deep-pixels、high-depth-filter-integration、hdr-integration、local-effects-render 合计83项通过，包括历史独立native quantizer和高位源/Undo/保存回归。这里只能证明核心与真实Skia CPU路径；Electron实际桌面、目录包和Windows门槛留主流程，尚未在此审计中执行。

### 推荐实施顺序

| 顺序 | 可交付范围 | 必须通过的门槛 |
|---|---|---|
| A（本批次） | 16位普通图层先合成再screen量化、显式兼容warning | 实际dev和目录包中普通16位叠层、半像素变换、蒙版、缩放/平移、draft/commit、unsupported效果、预算fallback；source/hash/history不变；ZH/ENwarning实际可见 |
| B（核心已完成，桌面门槛待主流程） | 有界PSD8 ICC检查、已知sRGB标记与未支持profile的清晰解释；[实现及34项新增测试](PSD_RGB_ICC_POLICY_2026-10-13.md) | 独立Photoshop sRGB/AdobeRGB/P3/未tagged文件；缺失、重复、损坏1039/1041；源/历史原子性。先明确旧文件兼容策略，不能静默改变8位外观 |
| C（共用后端） | 跨平台ICC配置文件与CMM服务，转换契约/预算/缓存 | macOS和Windows使用同一配置文件、intent/BPC设置；profile内容哈希；CMYK/LUT/out-of-gamut、同名ICC、恶意profile、取消；与受控Photoshop实测记录最大/平均色差及像素差，不设任意“匹配率” |
| D（进口） | CMYK PSD8颜色平面→sRGB，明确有损工作空间转换 | Photoshop独立文件，四色基准、黑版/纯K、透明、蒙版、负坐标、RLE/ZIP、嵌入/无ICC、组与调整层；spot/CMYK16显式拒绝；原CMYK容器不可宣称可回写 |
| E（校样/出口） | 明确简化CMYK proof、RGB TIFF、CMYK JPEG/TIFF；PDF单独受控 | 导出编码器实际四色+ICC，Photoshop打开无错误解释；matte/DPI/方向；proof是显示状态不改像素/历史；profile+options缓存；PDF检查ICC/output intent后才扩大印刷声明 |

不先开放空壳菜单。不能以设备CMYK简单公式等同ICC，也不能把RGB→CMYK→RGB回转通过视为独立Photoshop参考。首次CMYK门槛应使用用户有权使用且确定内容哈希的ICC，以及真实Photoshop独立导出；macOS Generic配置文件不能充当默认Windows等价假设。
