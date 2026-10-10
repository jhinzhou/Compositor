# Camera Raw 最新原版参考与验证

当前实现：`0.3.0-alpha.6`。参考原版提交 `d0ec2f35b6358108ac3e59593da1688deb83a559`，完整源码固定在 `/Users/zhoujin/Documents/PS/Compositor_Upstream/d0ec2f3`。该目录的完整 Git tree 已与官方提交一致核验；原本 `../Compositor` checkout 保留 `75147a2`，重新生成时不要误用旧资源。

## 运行时

- `camera-raw-table-data.ts` / `camera-raw-adaptive.ts`：CRT3 **763 张 17³ RGB 实测表**，按 signed delta × step 重建。压缩 delta planes 为 **1,779,975 字节**；`pako.inflate` 同步解压后的 RGB atlas 为 **11,245,857 字节**，完整 SHA256 与原版资源一致。
- 保留基础白平衡、Exposure/Contrast/Highlights/Shadows/Whites/Blacks/Vibrance/Saturation 的原版顺序。Color Mixer 按 Luminance → Saturation → Hue，Calibration 按原版 primaries 和 Shadow Tint 规则；参数曲线在默认分界和 Refine Saturation 为零时走实测表，其余情况使用原公式。
- Color Grading 使用四轮、轮内 hue/saturation 插值，Shadow/Highlight 的 Blending 0/50/100 三档插值，以及 Balance 对饱和度份额的调整；每 stage 最多八表混合。
- Lens Vignette 使用随位置变化的 Exposure 表；Post-crop Vignette 使用新版 ellipse/rectangle coverage 与线性光 gain/white blend。
- 满足原版 `foldsColor` 条件时把 Curve/Mixer/Grading 折叠进一次 LUT。Point Color、Refine Saturation、clipping、sharpen mask 等路径保留必要的独立计算。sRGB 256 项 decode cache、alpha 加权亮度统计及 scopes 的 band 内 step 2 采样按原版实现。
- worker 的 `CameraRawPreviewCache` 保存有限的 source brightness 统计，按 session/layer/source hash/selection 等失效；不缓存错误目标。Renderer 的 `CameraRawPreview.vue` 按 URL 复用两张图片解码 Promise，按实际 graded pixels 复用 histogram/vectorscope；失败可重试，迟到结果不覆盖新状态。

所有运行时均为跨平台 TypeScript、typed arrays 和打包的 pako，无 Swift/AppKit/Core Image 依赖。源码和独立 C oracle 只用于参考生成，不随应用执行。许可证见 `licenses/Compositor-MIT.txt` 与 `licenses/pako-MIT.txt`。

## 重现与验收

```sh
python3 scripts/check-camera-raw-upstream.py
npx tsx --test tests/camera-raw-upstream.test.ts
npx tsx scripts/bench-camera-raw-shared.ts
npx tsx scripts/smoke-camera-preview.ts
```

生成器默认使用固定快照 `../Compositor_Upstream/d0ec2f3`，并拒绝旧版 285 张 CRT2 资源覆盖新 atlas。它实际编译最新 `AdjustPixels.c` / `LensPixels.c`，记录 native source SHA256，产出可跨平台复验的 JSON fixture。生成需要 macOS C 编译器/SDK，消费 fixture 的单测无需原应用。

**62/62 单测通过**，其中 **57 个实际原版 C 图像 case**，折叠和非折叠路径的每通道误差均 **≤1 个 8-bit 单位**。覆盖移动曲线分界、Refine ±、Point Color、四轮 Grading 的 15 组 Blending/Balance、镜头及 Post-crop Vignette、多个亮度、透明像素等。完整 atlas hash、亮度统计、WB 搜索、scope sampling、六个上游实测色彩和两个 vignette 角点另有参考断言。

Renderer cache **3/3** 和 worker cache **2/2** 测试通过。实际 Electron Camera Raw smoke **4/4**，无 pageerror/console/Vue 异常；覆盖 scope/clipping/sharpen/normal 切换、Point Color 原图采样、range、Cancel、Exposure Apply 与 Undo。证据：`artifacts/camera-preview/desktop.json`。

## 性能证据和范围

`artifacts/parity-camera-raw/shared-performance.json` 使用同一 1024×768 合成图、Node shared kernel 测量：

| 路径 | 耗时 |
| --- | ---: |
| 首次 atlas 解压重建 | 113.5 ms |
| Source brightness | 13.7 ms |
| 首次折叠执行 | 552.0 ms |
| 热缓存折叠中位数 | 186.8 ms |
| 三遍查询参考中位数 | 658.3 ms |
| 热缓存比值 | 3.52× |

这不是 native C 或完整 Electron 预览耗时，不宣称达到上游“5–20×”。折叠与三遍参考的中间舍入/插值点不同，此性能样本最大通道差 3；正确性以最新原版折叠 C oracle 为准。上述参考证明指定路径与当前原版代码匹配，不证明 Adobe Camera Raw、Photoshop 任意文件或所有输入完全一致。
