# Photoshop 透视裁剪自动尺寸：alpha.26

本批实际修复 Photoshop 配置的自动尺寸建议：用文档中心恢复可识别的矩形比例，用最长源边和角点最大源像素面积密度共同确定输出尺度。保留原有 `perspectiveCropSize` 默认值、公共 MCP 的显式尺寸以及裁剪源精度路径。**恢复的比例已经得到独立原生几何支持，Photoshop 的绝对自动输出尺度仍未完全还原。**

## 真实输入证据与旧记录的修正

本批在 Photoshop 27.11.0 中安装只服务于 `alpha26-tools-owned` 图层的 scoped notifier，记录用户实际 GUI `perspectiveCrop` 的 ActionDescriptor；不再只依赖屏幕中角点视觉位置。递归序列化只读几何/数值，排除 alias、raw 和 reference 数据，避免文档句柄或路径授权数据进入测量记录。

实际 GUI 旧四角在事件中为 `(60,40),(431,55),(401,281),(75,261)`，`center` 为 `paint` 类型的 `(256,160)`，不含目标 width / height，输出 **387×257**。旧屏幕记录的右、下角像素标记与事件的源边界相差1px，必须区分像素标记与边界坐标。新尺寸 helper 直接接受事件里的边界坐标，**不暗中添加1**。采样/界面交互坐标是否转换由单独的采样验收负责。

为排除鼠标精度及工具创建路径，本批又由原生 Photoshop 执行两组各9例 ActionManager 透视裁剪：只提供 quadrilateral、四个精确边界和 camera center，完全省略目标宽、高、分辨率。每例重新打开原始512×320 PNG；只修改/关闭本任务新建的文档。第一组 center=(0,0)，第二组 center=(256,160)，输出目录独立保留。它们是 **原生内核脚本证据**，不是GUI操作证据。两组包括轴矩形、斜平行四边形、旧四角、强梯形、反方向几何、平移、镜像、180°旋转以及独立留出四角。

## 可解释的比例模型

令源边界四角的单位矩形逆映射为

```text
H = [ a b c ; d e f ; g j 1 ]
principal point = (cx, cy)
A = a - cx*g, D = d - cy*g
B = b - cx*j, E = e - cy*j
focal² = -(A*B + D*E) / (g*j)
aspect² = (A²+D²+focal²*g²) / (B²+E²+focal²*j²)
```

这是方形相机像素、正交平面矩形轴、给定主点的单视图矩形几何。`center` 实际改变原生尺寸比例：旧四角 center0 输出382×359，而 document center 输出387×256；相应恢复比例为1.064578和1.513083。反方向四角 center0 输出539×315，而 document center 得不到正焦距、原生回退到402×259。独立留出 `(65,35),(440,65),(395,285),(80,250)` 的原生 center0 / document-center 输出分别395×396、395×264，对应恢复比例0.997733、1.499075。平移会改变与文档主点的关系，镜像和180°旋转保持比例。这些独立变化支持 camera-center 模型，不是对两个尺寸样本进行拟合。

这类 metric rectification 的基础可参照原作者的 [Single View Metrology](https://robots.ox.ac.uk/~vgg/publications/2000/Criminisi00a/) 与 [planar rectification research](https://www.robots.ox.ac.uk/~dl/planar.html)。相机模型本身不唯一决定像素输出的绝对尺度，不能用比例吻合宣称自动尺寸完全一致。

## 本批生产尺度及边界

`photoshopPerspectiveCropSize(corners, sourceWidth, sourceHeight, aspect?, sourceCenter?)` 是独立 opt-in helper。正常界面不传 sourceCenter，采用文档中点；第五参数仅用于原生中心实验复算。

- 无正焦距、近无穷远消失点或推断无效时，采用最长宽边与最长高边的比例。
- 有效 metric aspect 的单位矩形映射在四角计算 `area=abs(det(H)/D³)`，取最大值。分母 `D=gu+jv+1` 在有效凸四角内保持同一符号，其最小绝对值发生在角点；因此无需按图片内容或样本名查表，便可得到整个映射的最大局部源像素面积。保持这个面积密度，同时覆盖最长源边：`width=max(longestWidth,longestHeight*aspect,sqrt(area*aspect))`、`height=max(longestHeight,longestWidth/aspect,sqrt(area/aspect))`，最后取整。
- 面积推断仅用于有效 metric camera。显式比例、负焦距和近无穷远消失点继续采用最长边方案；任何面积推断不有限，或任一面积推断轴超过相应最长源边4倍，整个额外面积下限回退。这避免近地平线角点迫使分配巨大画布。解析物理矩形的稳定性测试实际触发该回退。
- 自动推断的比例与源边比例相差超过4倍时回退。这是项目的数值稳定性保护，不是声明 Photoshop 存在同样阈值。自动输出每轴不会超过最长源边4倍；显式用户比例仍按资源限制验证。
- 手填宽/高不应被自动 helper 重写；公共 command/MCP 尺寸没有任何变化。helper 不读取、写入或量化像素，因此不影响8/16/HDR源精度、历史或原子性。

没有采用按 case 名称或角点坐标分支、对已知原生宽高常量回填、负焦距的绝对值、以插值核隐藏尺寸误差或凭两例拟合 scale。

## 原生验收结果

不可变 `fixtures/parity/photoshop-27.11-perspective-size-alpha26.json` 收录18个脚本输出和1个精确GUI事件，区分来源，保存源/输出PNG的 SHA256。自动尺寸测试无需 artifacts；PNG hash 是证据追踪，不代表已经做逐像素等价测试。

| 文档中心或真实GUI几何 | 原生 | 原mean建议 | 新建议 |
|---|---:|---:|---:|
| 轴矩形边界 | 201×134 | 201×134 | 201×134 |
| 斜平行四边形 | 331×200 | 331×200 | 331×200 |
| 旧四角精确脚本 | 387×256 | 348×224 | 387×256 |
| 强梯形 | 330×244 | 265×239 | 330×244 |
| 反方向负焦距 | 402×259 | 363×242 | 402×259 |
| 旧四角平移 | 382×259 | 348×224 | 382×259 |
| 旧四角镜像 | 387×256 | 348×224 | 387×256 |
| 旧四角180° | 387×256 | 348×224 | 387×256 |
| 独立留出四角 | 395×264 | 347×220 | 398×265 |
| 真实GUI旧四角事件 | 387×257 | 349×225 | 387×257 |

正常文档中心及GUI10例总宽高绝对误差 **570→4px（减少99.3%）**，9/10例尺寸精确匹配，最差宽 **65→3px**、最差高 **44→1px**。全部19例（包括非GUI主点0实验）的总误差 **1506→190px（减少87.4%）**，精确尺寸符合数 **4→14/19**。与本批前一轮单纯最长边保守尺度相比，总误差398→190px，7例改善、12例不变、0例退步；正常文档中心及GUI误差163→4px。测量脚本分组报告这三个阶段，不把异常主点实验混作用户界面效果。

主点0的9例仅作为诊断，相应误差936→186px，5/9精确，最差剩余64×38px，正常界面不会采用这个主点。面积密度模型同样应用于所有有效几何，没有按中心0特设例外。

**本批是有边界的改善，并未通过“所有透视自动尺寸与 Photoshop 一致”验收。** 精确GUI旧四角387×257已经一致；独立留出仍为398×265对原生395×264，差3×1px，明确保留而不硬拟合。面积密度具有通用几何解释，原生留出及旋转/镜像/平移证据支持改善，但没有证明它就是Photoshop未公开的完整自动分辨率算法。原生事件已建立精确参数参考，后续可直接追加独立几何。

## 验证与清理

57项定向测试通过，包括原native8bit固定尺寸采样、RGBA16/HDR真实源精度回归、旧公共edge语义、19例尺寸改善、独立留出剩余误差、近地平线面积回退和4倍稳定边界、错误参数以及scoped脚本对用户文档/notifier保护。`npm run typecheck` 通过。

```sh
npx tsx scripts/measure-perspective-size-alpha26.ts
npx tsx --test tests/photoshop-perspective-size-alpha26.test.ts tests/photoshop-crop-observer-alpha26.test.ts tests/photoshop-perspective-actionmanager-alpha26.test.ts tests/photoshop-perspective-alpha24.test.ts tests/photoshop-perspective-alpha25.test.ts tests/crop-projective.test.ts
```

另已准备 `scripts/smoke-perspective-alpha26.ts`，只能由根代理统一串行运行。它使用真实 Electron 鼠标创建矩形并拖三个角、从 SVG 核对实际事件边界、严格验证自动建议387×257与显式原生尺寸、比较真实 RGB8 输出，并验证 RGB16/HDR 原精度、Undo/Redo 和保存重开。两种交互配置分别检查 inclusive / exclusive 创建跨度。编写代理只完成 ESM 构建解析与 typecheck，**没有运行此GUI专项，不把代码已写等同于运行通过**。

实际 native event 已验证监听成功：Adobe 公开 [Action event documentation](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/photoshopaction/) 描述事件名与descriptor关系，旧 [event codes](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/eventcodes/) 列表没有覆盖所有新事件。`perspectiveCrop` descriptor 候选来自 Adobe Community 原作者的实际 ActionManager 示例，本地真实执行及GUI事件已验证其可用性；这不是 Adobe 公开保证的稳定DOM API。

结束前由根代理通过 Photoshop Browse 执行 `photoshop-crop-events-alpha26-remove.jsx`，**仅按精确eventFile删除本任务监听，恢复初始notifiersEnabled，保留用户全部其他notifier**。根代理新增的 `patchSelection` 共用同一scoped handler，也由相同清理规则移除。不能调用 `removeAll()`。脚本安全 mock 验证不能替代真实清理状态文件验收。
