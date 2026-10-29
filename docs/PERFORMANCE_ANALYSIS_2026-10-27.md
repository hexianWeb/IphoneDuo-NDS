# 页面性能分析 · 2026-10-27

## 结论

当前桌面 Game Home 可以稳定达到约 60 FPS。优化优先级应为：**首次 GPU 管线准备 → 首屏资源体积 → 多遍场景提交 → 标签纹理内存**。

本次通过 Needle MCP 采集正在打开的页面，并用独立 Chrome / CDP 复核 CPU、启动阶段和渲染统计。业务源码与资源未修改；消融实验仅在独立浏览器内存中执行。

## 测量条件与口径

- 页面：`http://localhost:5173/`，Vite 开发服务，Three.js r186 / WebGPU。
- Needle：Chrome 156 / Windows，设备报告 28 个逻辑核心、16 GB 内存；主界面处于 Home，NDS 未启动。
- 独立浏览器：Headless Chrome 156，新 profile，真实 `WebGPUBackend`，适配器报告 NVIDIA / Lovelace。
- 独立桌面视口 1920×1080，实际 Canvas 1920×1031，DPR 1。窄屏视口 390×844，实际 Canvas 390×799，DPR 1。
- 稳态每项至少采样 240 帧；帧间隔 / CPU 提交由项目已有 `?performance` 监控记录；GPU 时间由 Needle WebGPU timer query 记录。
- 独立浏览器和 Needle 所连接页面是不同会话，视口及工具负载不同，不能直接相减当作 Inspector 的开销。
- 本地资源加载不代表生产冷缓存网络；新 profile 不等于系统 / 驱动缓存完全清空。窄屏测试仍使用桌面 GPU，不代表手机性能。
- CPU 渲染提交时间不是 GPU 执行时间；二者也不能简单相加计算 FPS。

## 1. 首屏等待：当前最明显的问题

独立浏览器第一轮，从 PerformanceMonitor 创建到初始化完成：**32,277 ms**。不包含更早的 HTML / ESM 获取，也不包含后续 Intro 播放时间。

| 阶段 | 耗时 |
| --- | ---: |
| Renderer 初始化 | 278 ms |
| 全量资源加载与解码 | 1,056 ms |
| 场景创建及触控笔初始化 | 921 ms |
| 首次 `warmup-phone` | **29,629 ms** |
| `warmup-game-home` | 138 ms |
| `warmup-playing` | 197 ms |
| `warmup-folded` | 57 ms |

首次 warmup 的细分：seed 编译约 455 ms，实际渲染提交约 2,271 ms，`queue.onSubmittedWorkDone()` 等待约 **26,887 ms**。这证明主要等待集中在首次实际渲染 / GPU 管线就绪阶段，尚不能把全部队列等待细分归因到某个 shader 或纯 GPU 绘制。

第二轮新 profile 复测：初始化 **31,527 ms**，`warmup-phone` **28,666 ms**，其中队列等待 **26,148 ms**。两轮均有约 91–92% 初始化时间花在首次 warmup，说明不是一次偶发长帧。

相关代码：

- `src/js/Experience.js:55–69`：等待资源、场景和全部预热完成后才启动动画。
- `src/js/World/World.js:211–246`：临时关闭 Mesh 视锥剔除，以 Hero 姿态预热 phone / game-home / playing，再恢复 Folded。
- `src/js/Core/Renderer.js:92–145`：seed 编译、实际渲染及 GPU 队列等待。

**建议：**先对首次 warmup 按材质 / pass / 管线创建次数进一步归因，减少重复变体，评估真实管线的异步编译与分阶段准备。保留首帧位姿、阴影附件 generation、三屏切换和取消生命周期约束。简单删除预热只会把等待转移到用户可见帧。

原有进度文档第 18 节曾记录加载 28.30 秒、首次实际管线准备 26.68 秒，和本次现象方向一致；历史数据不作为本轮测量值。

## 2. 首屏资源：83.31 MB，EXR 占 60.5%

根据 `sources.js` 当前首屏清单和磁盘文件长度，21 项静态资源合计 **83,307,324 bytes / 83.31 MB**，不含 JS / CSS / WASM / ROM。

| 资源 | 文件体积，十进制 MB |
| --- | ---: |
| `lightmaps/Controller_Shell_lightmap.exr` | **50.36** |
| `img/game0.png` 至 `game5.png` 合计 | **11.46** |
| `glb/detail.glb` | 6.60 |
| `glb/airpods_pro.glb` | 4.49 |
| `12.png` | 2.83 |
| `iphone.glb` | 1.97 |
| `img/主页面.png` | 1.81 |
| `glb/rhyzome_plant.glb` | 1.76 |

直接读取 EXR 头部确认：2048×2048、RGB 三通道、每通道 FLOAT32、`compression = 0`，即 **NO_COMPRESSION**。

**建议顺序：**

1. 优先评估保持像素不变的 EXR ZIP / PIZ 无损编码；当前 EXRLoader 已支持。实际压缩比例和解码耗时需对候选文件验证。
2. 必要时另行评估 HALF 精度；当前 EXRLoader 默认已输出 HalfFloat 纹理，但文件精度调整仍需逐像素 / 视觉验证。
3. 游戏封面和参考图按实际 Canvas 使用尺寸制作 WebP / AVIF 候选，验证文字和像素画边缘。
4. 评估展品资源按视口 / 阶段加载。当前 `Resources.load()` 使用全量 `Promise.all`，窄屏隐藏展品仍会加载它们；仅把对象设为不可见不会减少下载。

**约束：**EXR 是外壳 lightmap，不是环境 HDR。保留 `uv1/channel=1`、`flipY=true`、线性色彩空间。Needle 推荐 FastHDR 环境贴图的说明不直接适用于这里。无损 EXR 压缩主要改善传输体积，不会自动降低解码后的 GPU 内存。原始用户资源应保留，经过授权和视觉验证后再选择交付副本。

`ControllerDisplay.js:31–32` 将封面与参考图的 `.image` 用于 Canvas 2D 绘制，因此这些源图不能直接用 GPU 压缩纹理替换。

## 3. 稳态 CPU / GPU

### Three.js 原生计数与消融

第一轮有效采样：

| 场景 | FPS | 帧间隔 P95 | CPU update | CPU render submit | Draw calls | 三角形 / 帧 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 桌面基线 | 59.95 | 17.0 ms | 0.07 ms | **4.96 ms** | **537** | 1,225,865 |
| 暂停透射背景捕获 | 59.95 | 17.0 ms | 0.05 ms | **3.88 ms** | **406** | 939,039 |
| 恢复桌面基线 | 59.95 | 17.0 ms | 0.05 ms | **5.09 ms** | **537** | 1,225,865 |
| 窄屏布局、桌面 GPU | 59.96 | 17.0 ms | 0.06 ms | **1.60 ms** | **68** | 138,019 |

暂停捕获使玻璃使用旧背景，仅用于隔离成本，不是可直接交付的优化。结果说明背景捕获约增加 **131 次绘制、28.7 万三角形和约 1.1 ms CPU 提交**。动态物体 / 屏幕 / 镜头变化时，最终实现仍需保持折射内容更新。

第一轮 AO 旁路触发新管线准备，仅获得 1 帧有效采样，未将其 FPS / CPU 耗时作为结论。

第二轮补充足够的稳态采样后：

| 场景 | FPS | 帧间隔 P95 | CPU render submit | Draw calls |
| --- | ---: | ---: | ---: | ---: |
| 桌面基线 | 59.95 | 16.9 ms | 8.03 ms | 537 |
| 暂停透射背景捕获 | 59.95 | 16.9 ms | 6.97 ms | 406 |
| 恢复背景，旁路完整 AO 管线 | 59.75 | 16.9 ms | 6.25 ms | 402 |
| 恢复桌面基线 | 59.95 | 16.9 ms | 7.97 ms | 537 |
| 窄屏布局、桌面 GPU | 59.95 | 16.9 ms | 2.23 ms | 68 |

第二轮完整 AO 管线旁路减少 135 次绘制、约 1.7–1.8 ms CPU 提交；这包含法线几何预通道、降噪、合成及管线差异，不能等同于仅降低 AO 样本数的收益。两轮 CPU 绝对值存在约 3 ms 差异，原因未单独归因；各轮恢复基线分别接近原值，透射捕获的同轮差值都约 1.1 ms，采用同轮比较更可靠。

5 秒 CPU profile 中约 3.34 秒是 idle；热点主要在 Three.js `_renderObjectDirect`、节点 / uniform 更新与 GPU binding 提交。`ShadowUpdateTracker.casterChanged` 自耗时约 32 ms / 5 秒，优先级低于整场重复提交。

### Needle GPU timer query

30 帧 GPU 定时：平均约 **4.1 ms**，范围约 4.1–4.2 ms；约占 60 FPS 的 16.7 ms 预算的 25%。

| Pass | GPU 时间 |
| --- | ---: |
| Scene with GTAO | 2.31 ms |
| Scene，结合渲染图对应透射背景捕获 | 1.08 ms |
| RTT，结合源码对应 AO 降噪输出 | 0.51 ms |
| GTAO geometry | 0.12 ms |
| Shadow Map | 0.08 ms |
| AO | 0.03 ms |
| Render Pipeline | 0.03 ms |

该设备当前没有 GPU 饱和证据。降低 GTAO 样本只影响其中部分成本，不应因为使用了 AO 就优先砍掉它。DPR 上限目前为 2，后续可针对高 DPR / 低档设备设计质量档位，再做视觉验收。

### 统计差异

Needle 汇总报告显示 2,141 draw calls / 4,869,702 triangles，但其 GPU 采样又报告最后一次 render 后计数 543；独立浏览器的原生整帧计数为 537 / 1,225,865。

项目在 `Renderer.js:33` 设置 `info.autoReset=false`，并在每帧 `update()` 开始只 reset 一次。r186 的 `info.render.drawCalls` 是当前帧累积值，不能把各子 render 返回后的累积值再次相加。优化预算优先采用原生帧末计数，Needle 的 70/100 评分与“超过 1000 draw calls 即 CPU-bound”提示不作为瓶颈结论。

第二轮对单帧嵌套 `renderer.render()` 入口 / 出口做运行时记录，剔除子调用后得到：

| 通道 | 本通道绘制次数，不重复计入子通道 |
| --- | ---: |
| 透射背景 Scene | 131 |
| Shadow Map | 126 |
| GTAO geometry | 136 |
| AO | 1 |
| RTT | 1 |
| Scene with GTAO | 141 |
| Render Pipeline | 1 |
| 合计 | **537** |

该帧若错误相加各次 render 出口的累计计数，会得到 2,643 而不是 537，证明嵌套统计很容易重复计数；此数值不等于 Needle 的 2,141，故尚未证明 Needle 内部具体如何产生差异。537 已由两轮稳态采样和单帧嵌套调用独立核实。此表仅计主渲染器；触控笔有独立按需渲染器。

## 4. 内存与纹理

Needle 估算纹理和几何约 **248.7 MiB**，不是整个进程的完整显存统计。本轮多次采样中该估值稳定，不能据此证明不存在生命周期泄漏。

| 纹理 | 尺寸 | Needle GPU 估值 |
| --- | --- | ---: |
| Controller_Shell_Lightmap | 2048×2048 | 32.0 MiB |
| PartsLegend_Labels | 2048×2082 | 21.7 MiB |
| ProductPlaqueLabel_Labels | 2048×932 | 9.7 MiB |
| 另四张短展品标签，合计 | 各 2048×256 | 10.7 MiB |

六张标签合计约 **42.1 MiB**。`ExhibitLabel.js:4–8` 默认宽度 2048；若长宽均减半，理论纹理内存可减少约 **31.5 MiB**，需按近景文字清晰度分别确定分辨率。

标签是运行时 CanvasTexture，且只在内容变化时上传；不能直接把它们当静态 KTX2 图片批量转换。更合适的是按投影尺寸分配分辨率、裁去空白、必要时做图集。短标签的最低高度也有优化空间。

当前 JS heap：独立浏览器第一轮基线约 122 MiB；Needle 会话约 238–267 MiB。会话和工具状态不同，不将差值认定为泄漏或 Inspector 固定开销。

## 5. 已存在的优化与下一轮验收

已实现：调试面板按需加载、主循环隐藏时跳过更新、世界矩阵跨 pass 复用、透射捕获禁止重复更新阴影、卡带触点 InstancedMesh、触控笔停稳复用画布、静态标签按需上传、NDS WASM / ROM 按需加载。

桌面配色样品和内部元件持续悬浮，第一轮阴影更新请求每帧触发；窄屏隐藏展品后阴影请求被跳过。不要把它误判为阴影缓存未实现；计数是更新请求，不等同实际 GPU shadow pass 数。

建议后续验证矩阵：

1. 生产 preview 冷 / 热缓存，分别记录下载、解码、场景创建、首次实际管线准备、首个可见动画帧。
2. 固定镜头与 DPR 下，至少 240 帧的 FPS / P95 / CPU 提交 / GPU timer / 原生 draw calls；变化前后恢复基线复测。
3. Intro、Orbit、换配色、进入 / 退出 NDS 分开采样；本轮未测 NDS 游戏运行和音频负载。
4. 真实手机 / 集显、高 DPR，不能以桌面窄视口代替。
5. 标签和贴图优化须检查近景、倾斜观看、屏幕文字、Lightmap 亮度以及折叠装配视觉。

## 采样材料

- 临时可重复执行探针：`C:/Users/f1686533/AppData/Local/Temp/opencode/duo-performance-probe.mjs`。
- 第一轮 JSON 与 CPU profile：`C:/Users/f1686533/AppData/Local/Temp/opencode/duo-perf-JJtPFp/`。
- 第二轮 JSON、单帧嵌套计数与 CPU profile：`C:/Users/f1686533/AppData/Local/Temp/opencode/duo-perf-db2wLZ/`。
- 执行：`node C:/Users/f1686533/AppData/Local/Temp/opencode/duo-performance-probe.mjs`，依赖本机 Chrome 与已运行的 5173 开发服务，不增加 npm 依赖。
- 两轮独立浏览器均未捕获 JS 未处理异常，实验结束关闭独立 Chrome；未改动用户正在查看的场景属性。
- 本次是性能分析，未实施业务代码优化；不以构建通过代替性能和 GPU 验证。
