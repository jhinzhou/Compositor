# Progressive Blur：上游3ae11cd移植边界与定向验收

2026-10-13。上游依据是 `robbietilton/Compositor` 的提交 `3ae11cdd6e296b4c58f99b78e553c650f6c52504`，已读取该提交的 `Compositor/Document/Filters.swift`、`Compositor/UI/FilterSheet.swift` 和 `CompositorTests/ProgressiveBlurTests.swift`。这份记录只报告本次滤镜路径；App入口和发行/GUI总验收由Root汇总。

## 上游功能的实际语义

Progressive Blur 沿一条线控制模糊半径：起点为From，终点及其后为To，线之前保持From，之间线性渐变；径向模式以起点为中心、起点到终点的距离为圆半径。Invert交换From/To。From/To是0–250的**图层像素**，start/end是**文档坐标**。不足一源像素的线退化为向下的一像素线。

上游滤镜使用 `CIMaskedVariableBlur`，输入mask是各处半径占最强半径的比例；其内部核不是公开算法。上游也处理文档到图层像素的逆变换、模糊grow `3*maxRadius+2`、画布边缘延伸、16位/HDR源精度和选区。

这与 Photoshop Blur Gallery 的 Field Blur 不同：本工具只有一条线或一个径向中心，不是可布置多个pin、各pin独立半径、带bokeh controls的多点Field Blur。本次没有虚构Field Blur或上游不存在的Progressive调整图层记录。

## 本次代码路径

- `src/shared/image-filters.ts`：严格schema、默认值、滤镜名、8位共享调用、预览samplingScale、明确parity limitation。
- `src/shared/progressive-blur.ts`：source坐标转换、native session初始线helper、线性/径向/invert半径场、有界Float32尺度空间核和预算预检。
- `src/core/filter-edit.ts`：8位grow、文档映射、画布边界clamp与选区blend，沿原路径携带linked mask。
- `src/core/high-depth-filter.ts`：Progressive纳入直接spatial路径，在canonical16/HDR源上运行；同grid的 `applyHighDepthSpatialPixels` 也可调用。
- `src/renderer/FiltersPanel.vue`：From/To、Linear/Radial、Invert、起/终点X/Y数值编辑、既有preview/apply/reset流程。
- `src/shared/locales/panels.zh-CN.ts`：必要中文新增。英文沿原key。

已修改的既有文件在 `artifacts/upstream-progressive-blur/backups/` 保留本次修改前副本，包括已有未提交改动；没有覆盖其它任务的修改。新增测试为 `tests/progressive-blur.test.ts` 和 `tests/progressive-blur-integration.test.ts`。原 `tests/image-filters.test.ts` 的完整kind控制测试只补一项Progressive，既有断言保留。

## 可移植核与性能边界

共享核处理premultiplied Float32，从身份层与.5px开始按半径倍增，最后包含精确最强半径层；每处按照请求半径的方差在相邻高斯层间插值。各层由原输入生成，不逐层积累离散化误差。一次仅保留前一层和当前层，不存储全部层。原范围内最多10个非零高斯pass。From=To的高位深结果与既有同半径Gaussian核逐值一致。

RGB8在处理前转premultiplied float，最后转回straight RGBA8；RGB16源直接除65535进入Float32并仅在最终写回Uint16；HDR负RGB和overwhite RGB保持。低/高位深选区与mask/history均沿现有原子编辑路径。不会对16位/HDR执行PNG8滤镜探测重建。

预算在任何卷积前计算，并在8位输入分配Float32前先预检：总估算卷积work不超过500M，浮点scratch加FFT工作面不超过512MiB；原core raster/deep预算仍生效。超过预算返回RESOURCE_LIMIT，不悄悄换成劣质box blur或flatten高位深。`.1`等非精确Float32半径在终点作上限钳制，防止浮点大于末层半径造成透明孔洞。

**这是与上游相同半径场语义的有界多尺度近似，不是已证明与CIMaskedVariableBlur逐像素一致。** 本轮未生成Core Image原生fixture，因此不能给出其max/MAE。下一步若需要像素精度对齐，应在实际上游原生程序采8/16/HDR的线性/径向/Invert/旋转映射与透明边缘留出图，再根据误差改核。

## App集成契约与尚未验收的交互

schema：`kind:'progressiveBlur'`、`from/to`、可选tuple `start/end`、`radial/inverted`。

`defaultProgressiveBlurLine(layer.transform,[canvasWidth,canvasHeight])` 返回文档start/end，符合上游beginFilter的可见范围35%→bottom初值。App可将其与 `defaultFilter('progressiveBlur')` 合并为initial，也传给FiltersPanel新增 `progressiveLine` prop，使切换工具或Reset保留符合当前图层的初值。滤镜执行时core自行将文档坐标逆映射到grow后源栅格，调用者不应提前把坐标改成source像素。

本模块完成数值端点编辑。上游的**主画布专用线/端点直接拖动overlay**不在本次子任务实现范围内；Root负责决定该交互是否纳入本批。尚未GUI实测，也不把数字编辑面板称为完全相同的上游拖动体验。

## 已完成的定向证据

114/114目标测试PASS，包含：

- 上游条纹语义：线起点前锐利、中段更软、终点后模糊；From与To均非零；径向与Invert。
- 旋转/翻转/缩放的端点逆映射、可见范围初值、短线fallback、有限参数校验。
- 0半径身份、constant radius与同gridGaussian相同、非整数半径末层、透明RGB不会污染、全画布clamp下constant HDR保持。
- RGB8/RGB16/HDR preview/commit一致、grow、linked mask、选区外源样本、完整Undo/Redo、16/HDR保存再读取。
- 原Gaussian上游参考、deep byte-probes、现有image/high-depth filter回归。

日志：`artifacts/upstream-progressive-blur/target-tests.log`。严格core+tests TypeScript PASS，FiltersPanel独立vue-tsc PASS（专用临时tsconfig包含现有env声明，不是完整project check）。日志分别为 `core-typecheck.log`、`panel-typecheck.log`。

本次未运行GUI、build、package、完整npmcheck或Git提交，未修改App.vue、src/main/index.ts、版本或功能catalog。
