# 纹理减重 · 2026-10-28

## 范围与约束

按用户要求减小 Lightmap、展品标签、模型贴图及离屏纹理占用。原始素材全部保留，交付副本位于 `public/optimized/`，由 `sources.js` 统一引用；不修改 `iphone.glb`、模型几何、节点、变换、装配或 NDS 输入。

下载体积与 GPU 纹理内存是不同指标。EXR / WebP 编码减小传输，分辨率和 GPU 通道数减小运行时内存；不能仅根据显存占用认定首次约 30 秒的管线准备全部由贴图引起。

## 已实施

### 静态素材

| 素材 | 原文件，十进制 MB | 运行时副本，十进制 MB | 处理 |
| --- | ---: | ---: | --- |
| Controller Shell Lightmap | 50.36 | 1.50 | 2048² FLOAT32 RGB → 1024² HALF RGBA / ZIP EXR |
| detail.glb | 6.60 | 2.22 | 内嵌贴图长边上限 512，几何字节不变 |
| rhyzome_plant.glb | 1.76 | 0.66 | 内嵌贴图长边上限 512，几何字节不变 |
| 手机 UI 双联图 | 1.81 | 1.35 | 原尺寸、无损 WebP |
| Game Home 参考图 | 2.83 | 1.42 | 原尺寸、无损 WebP，保留固定坐标裁切 |
| 六张游戏封面，合计 | 11.46 | 0.68 | 等比长边上限 1024，WebP quality 90 |
| 本轮处理素材，合计 | **74.83** | **7.83** | 11 项派生素材 |

完整首屏 21 项静态资源由 **83.31 MB 降为 16.31 MB**，减少约 **80.4%**；不包括 JS / CSS / 后续 WASM / ROM。GLB 中 PNG 仍是 PNG，JPEG 仍是 JPEG，不引入新的 glTF 扩展。

Lightmap 使用线性浮点 2×2 面积平均，不经 ImageMagick 非 HDR 量化；原图数值存在大于 1 的高光及少量负值，必须保留。导出后逐像素检查 HALF 量化误差及行序；运行时继续使用 `LinearSRGBColorSpace`、`flipY=true`、`channel=1` 和强度 1。降尺寸有空间分辨率损失，并非整张纹理无损。

### 运行时纹理

- `ExhibitLabel` 默认宽 2048 → 1024，短标签最低高度 256 → 128；六张标签从约 42.1 MiB 降到约 10.5 MiB，逻辑文字坐标、几何尺寸、alpha 和各向异性不变。
- AO 降噪输出由 RGBA16F 改为 **R8**；仍使用全分辨率、32 个 GTAO 样本与原深度 / 法线预通道，主材质只读取遮蔽的 `.r`。单个降噪目标每像素 8 bytes → 1 byte，灰度会量化到 1/255。
- `Glass_Clean_Backdrop` 相对画布的缩放 0.75 → **0.5**，保留 HDR 半浮点、mipmap、实时捕获与恢复状态逻辑。降采样只影响玻璃折射源，不改变主画面分辨率。
- **主画面的 HDR 输出、4× MSAA、深度格式及 2048² 阴影保留。** 截图约 30 MiB 的 `depth` 是 4× MSAA 深度附件，不能像图片一样压缩；贸然改成低精度或取消 MSAA 会影响遮挡、Z-fighting 和物体边缘。

### 构建与原始资源

`vite.config.js` 根据派生清单排除已被替换的 11 项原始文件，避免生产构建同时携带原件和副本；开发服务仍可读取原文件用于对照。未处理的公共文件保持原复制行为，`public/nds` 继续排除。

`public/optimized/manifest.json` 记录每项输入 / 输出 SHA-256、字节数及尺寸。原图更新后应重新生成，不能直接手工修改派生副本而不更新清单。

## 重生成与验证

在仓库根目录执行：

```powershell
# 仅重生成需要本机 ImageMagick 7（带 WebP/PNG/JPEG）；可用 MAGICK_PATH 指定命令路径。
node scripts/optimize-textures.mjs
node scripts/verify-textures.mjs
npm run build
node scripts/verify-textures.mjs --dist
```

生成 EXR 使用当前已安装的 Three.js EXRLoader / EXRExporter，不增加 npm 依赖。验证检查原始哈希、派生哈希、HDR 数值、降采样、标签构造 / 释放、GLB 非布局 JSON 及非图片 bufferView 字节，`--dist` 另检查生产副本和原图 / ROM 排除。

最终视觉验收重点：Parts 展板文字、内部元件丝印、铭牌、小封面、折叠 / 装配时 Lightmap 接缝、玻璃折射细节。原始素材随时可用于恢复较高质量档位。

## 浏览器复测

同机 Chrome 156 / NVIDIA Lovelace / WebGPU，1920×1080 视口，实际 Canvas 1920×1031，DPR 1；使用独立 profile，不将本地加载速度当线上冷缓存承诺。

基线：初始化 38.78 s，其中首次 warmup 36.33 s；约 59.7 FPS，537 次绘制 / 帧。Three.js 跟踪的全部纹理内存估值 **357.0 MiB**，与 Needle 截图的约 239.5 MiB 不是同一覆盖范围，不混用绝对值。

基线附件实测格式：AO 法线 rgba16float、深度 depth24plus（单采样）；主场景 rgba16float + 4× MSAA 与 depth24plus（4×）；AO 原始 r8unorm，降噪原先 rgba16float。保留主场景深度而不是把它误当成 32-bit RGBA 图片。

### 优化前后实测

| 指标 | 基线 | 优化后 |
| --- | ---: | ---: |
| Needle 资源列表纹理估值，44 项 | 239.5 MiB | **129.6 MiB，减少 45.9%** |
| Three.js 原生纹理跟踪估值，59 项 | 357.0 MiB | **231.6 MiB，减少 125.4 MiB / 35.1%** |
| Lightmap GPU 估值 | 32.0 MiB | **8.0 MiB** |
| PartsLegend_Labels GPU 估值 | 21.7 MiB | **5.4 MiB** |
| ProductPlaqueLabel_Labels GPU 估值 | 9.7 MiB | **2.4 MiB** |
| AO 降噪目标 | 15.1 MiB / rgba16float | **1.9 MiB / r8unorm** |
| 玻璃折射背景，独立浏览器视口 | 11.3 MiB | **5.0 MiB** |
| 初始化总时间 | 38.779 s | **38.792 s，无明显改善** |
| 首次 warmup | 36.333 s | **36.629 s** |
| 本机资源加载与解码 | 741 ms | 543 ms |
| 稳态 Game Home FPS | 59.70 | 59.95 |
| 帧间隔 P95 | 17.0 ms | 16.9 ms |
| CPU 渲染提交 | 9.10 ms | 8.98 ms |
| Draw calls / 帧 | 537 | 537 |

两套内存估算覆盖范围不同，只在各自内部比较；都不是整个进程的完整显存统计。纹理内存与传输收益已确认，但首屏时长没有同步下降，**反证不能把首次慢渲染主要归因于纹理体积**。目前剩余等待仍集中在首次管线与 GPU 队列准备，需要另行诊断材质 / shader 变体与预热策略，不在本次素材处理范围内。

独立 WebGPU 验证确认降噪 GPU 格式确为 `r8unorm`；主画面仍为 `rgba16float`、4× MSAA、`depth24plus`，原生预算断言通过，未捕获 JS / GPU 错误。Hero 与 Play 近景截图已做对照，仍需用户最终验收标签、丝印和 Lightmap 清晰度。生产 preview 首屏渲染通过，11 项派生资源请求均与 manifest 哈希一致。

采样材料：

- 基线截图和报告：`C:/Users/f1686533/AppData/Local/Temp/opencode/duo-textures-JhkVUu/`。
- 优化后截图和报告：`C:/Users/f1686533/AppData/Local/Temp/opencode/duo-textures-ltGZfc/`。
- 生产浏览器报告：`C:/Users/f1686533/AppData/Local/Temp/opencode/duo-textures-trlW1X/`。
- 临时探针：`C:/Users/f1686533/AppData/Local/Temp/opencode/duo-texture-probe.mjs`。开发服务 HMR 会给模块增加时间戳，探针从实际资源 URL 获取已运行的 Experience，不导入另一个同名单例。早期探针定位失败及模块重载失败不作为初始化时长数据。
