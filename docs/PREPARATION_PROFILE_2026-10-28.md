# 首次材质与渲染通道准备定位 · 2026-10-28

> 第 1–5 节记录优化前的诊断与消融；后续正式实施见第 6 节。当前运行代码已不再采用原来的同步准备路径。

> 2026-10-29 后续已完成按键节点复用，进一步将首次新材质管线由 154 减至 129；最新对照与验收见 [按键材质节点复用](BUTTON_MATERIAL_OPTIMIZATION_2026-10-29.md)。本报告历史测量保持原口径，不覆盖更新。

## 结论

目前不是某一张贴图或某一个材质单独阻塞约 30 秒，而是 **三个场景通道为大量物理材质生成不同变体，再在首次绘制路径同步请求 GPU 管线**。最值得处理的是准备方式，其次是背景捕获和按键 / 样品的变体量。GTAO 法线预通道存在完整材质冗余，但单独替换该通道的实验没有明显缩短总初始化，不把它夸大为已确认的最大收益项。

诊断阶段只增加独立诊断脚本与报告，不更改应用渲染效果。所有消融 / 异步实验在临时 Vite 服务和独立 Chrome 中进行，不修改 `src/`、`node_modules/` 或用户正在查看的场景。第 6 节另记录用户确认后的正式源码改动。

## 测量方法

- Chrome 156 / WebGPU / NVIDIA Lovelace，1920×1080 视口、Canvas 1920×1031、DPR 1。
- 在 Renderer 初始化后挂接 Three.js 的 `debug.onNodeBuilderCreated`，记录每个真实 NodeBuilder 的构建、材质 / 对象名称及生成的 WGSL。
- 记录实际 `GPUDevice.createRenderPipeline` / `createRenderPipelineAsync` 请求，区分 CPU API 调用耗时与异步完成延迟。
- 另做 **serial** 实验：把真实描述符快照后逐条发起异步管线创建，从前一条完成后开始计下一条 `serviceMs`，排除该项前面的排队等待。用于比较材质族和通道累计成本；仍是浏览器 / 驱动完成墙钟时间，不是纯 GPU 执行时间。
- 在实际嵌套 render 返回后插入队列完成标记，记录不同通道的冷准备推进顺序；不把它称为稳态 GPU 执行耗时。
- 每次独立 profile；依次运行各实验，避免多个测试 GPU 任务互相争用。系统 / 驱动缓存没有宣称完全清空；异步对照之后又重跑同步基线，仍然很慢。
- 临时服务使用独立 Vite cache。若模块图在 Experience 启动前停住，最多重载独立标签页一次；这一等待不计入本报告的 `loadMs`，没有把未启动的样本算成渲染准备时间。

## 1. 通道排名

两次有效同步基线：初始化 **38.22 s / 35.09 s**；首次 warmup **36.34 s / 33.35 s**。第二次同步基线发生在异步实验之后，排除了“只是后一轮缓存热了”的简单解释。

首次 warmup 中的实际创建量：

| 通道 | 新 NodeBuilder 数 | 新 GPU 管线数 | 基线 CPU 构建耗时范围 | 新管线片元源码合计 |
| --- | ---: | ---: | ---: | ---: |
| 玻璃干净背景 Scene | 54 | **44** | **0.51–0.53 s** | 2.14 MB |
| GTAO geometry 法线 / 深度 | 57 | **39** | **0.46–0.57 s** | 2.05 MB |
| Scene with GTAO 主画面 | 63 | **45** | **0.47–0.53 s** | 2.39 MB |
| Shadow Map | 45 | 24 | 0.04–0.05 s | 0.062 MB |
| AO 内核 | 1 | 1 | 0.003–0.004 s | 0.009 MB |
| AO 降噪 RTT | 1 | 1 | 0.005–0.006 s | 0.006 MB |
| 最终合成 Render Pipeline | 1 | 1 | 0.001–0.002 s | 0.002 MB |

NodeBuilder 数与 GPU 管线数不是同一指标；不同材质对象可能生成相同源码并命中管线缓存。源码体积也不等同编译时间，表中用于说明变体规模。

第一轮同步基线的队列标记推进增量，包含首次管线就绪等待：

| 队列推进至该通道完成 | 相对前一标记的新增等待 |
| --- | ---: |
| 玻璃背景首轮完成 | 约 13.3 s，从该通道提交后计 |
| Shadow Map | 约 0.42 s |
| GTAO geometry | 约 5.53 s |
| AO 内核 | 约 0.06 s |
| AO 降噪 RTT | 约 0.40 s |
| 主画面 Scene with GTAO | **约 15.65 s** |
| 最终合成 | 小于 1 ms |

这些是队列关键路径的推进标记，不是每个 pass 的独立纯编译时间，不能与 CPU 构建列相加。后台编译和前序排队可能重叠。明确结论是：**主场景、背景捕获、法线预通道占大头；AO 采样滤波本身与阴影不是本轮首屏等待的主要来源。**

## 2. 材质定位

### CPU 构建与重复次数

| 材质 / 材质族 | 构建次数 | 两次同步基线合计 CPU 构建耗时 | 解释 |
| --- | ---: | ---: | --- |
| `Dock_midnight_Button_Plastic` | 13 | 120–158 ms | 深色配色样品的多个按键及多通道变体 |
| `Dock_retro_Button_Plastic` | 12 | 109–138 ms | Retro 样品 |
| `Dock_classic_Button_Plastic` | 12 | 104–137 ms | Classic 样品 |
| `ExhibitButtons_Button_Plastic` | 8 | 76–83 ms | 左展板按键样件 |
| AirPods `FJixwyYXpYmTghW` | 9 | 67–80 ms | 同材质的不同几何属性布局、三通道 |
| AirPods `cEVcwrpGKjNUrED` | 6 | 43–44 ms | 多几何 / 多通道重复 |
| 主机 `Button_A/B/X/Y_Coated_Plastic`、`DPad_Coated_Plastic` | 每种 3 | 单种约 29–46 ms | 微颗粒、清漆、印花，每种跨三个场景通道 |
| `Controller_Shell_Procedural_Plastic` | 3 | 约 27–30 ms | 外壳程序化塑料并非单独耗时数十秒 |

`MeshStandardNodeMaterial` 这个未命名组总计 24 次、168–183 ms，但包含多个不同材质 / 道具，不能当成一个慢材质。

### 逐管线串行计时：材质族排名

串行诊断初始化 38.78 s，首次 warmup 37.12 s。仅统计 `warmup-phone` 中排除自身排队后的管线服务耗时：

| 材质族 | 新 GPU 管线数 | 累计服务时间 |
| --- | ---: | ---: |
| **主机 ABXY + D-Pad 清漆塑料** | **15** | **7.59 s** |
| **配色 Dock / 展板样品按键** | **15** | **6.61 s** |
| AirPods 材质族 | 27 | 3.44 s |
| 内部元件材质族 | 9 | 2.85 s |
| 主机 / 展示外壳塑料 | 6 | 2.63 s |
| 底座实体 / 灯带材质 | 6 | 2.21 s |
| Phone 双屏材质 | 7 | 2.20 s |
| 展品标签材质 | 7 | 1.84 s |
| 卡带触点 / 凹槽等普通材质 | 18 | 1.80 s |
| 地面 / 弧墙 | 3 | 0.83 s |
| **Parts 玻璃本体** | **1** | **0.68 s** |

共享 GPU 管线归给第一次创建它的材质，缓存命中的其它配色不重复计费。因此 `Dock_midnight_Button_Plastic` 名下约 4.42 s / 9 个新管线，**不意味着 Midnight 配色独有这么多成本或应被删除**。

单个最慢管线集中在主机 `Button_Y_Coated_Plastic` 主画面约 **685 ms**、`Parts_Transmission_Glass` 主画面约 **680 ms**、`Button_B_Coated_Plastic` 背景变体约 **680 ms**。主机 A / B / X / Y 每种三个变体累计约 **1.54–1.61 s**，D-Pad 约 **1.32 s**，主机外壳约 **1.24 s**。

AirPods 的 `FJixwyYXpYmTghW` 分布于 case / cover / 左右耳机，`cEVcwrpGKjNUrED` 同样被多个部件复用；`DrEQLAPBkLNlpSM` 在左右耳机。源码适配位于 `ExhibitAirPods.js`，不需要改动原始 GLB 节点名。

### 逐管线串行计时：通道排名

| 首次 warmup 通道 | 累计服务时间 |
| --- | ---: |
| **Scene with GTAO 主画面** | **15.65 s** |
| **玻璃干净背景 Scene** | **13.58 s** |
| GTAO geometry | 5.30 s |
| Shadow Map | 0.35 s |
| AO 内核，含重绘中重建 | 0.079 s |
| AO 降噪，含重绘中重建 | 0.054 s |
| 最终合成 | 0.024 s |

这份计时与同步基线队列推进的方向相符：玻璃本体约 0.68 s，但为它额外准备的整场背景约 13.58 s，二者必须区分。累计服务时间不能直接当成并行方案的总时长。

### 复杂 shader 与源码位置

- **主机清漆按键**：`src/js/World/Product/ControllerButtonMaterial.js:49–77`，每个变体的片元源码约 **70–72 KB**。包含微颗粒法线、clearcoat、IOR 和印花。
- **样品按键**：`src/js/World/Environment/ExhibitSample.js:49–55`，每个变体约 **64 KB**，样品按键多，且每个实例创建材质与印花节点。NodeBuilder 重复较多，但其中一些 GPU 管线已复用，不能把 37 次构建全部说成 37 个独立驱动编译。
- **亚克力玻璃**：`src/js/Materials/Transmission/GlassPhysicalNodeMaterial.js`，主画面变体约 **71 KB**。其自身只有一个主要新管线，额外成本更来自 `TransmissionBackdrop.capture()` 为背景重新准备的 **44 个管线**。
- **主机外壳**：`src/js/World/Product/createControllerPlasticMaterial.js:43–63`，三个变体分别约 **55.3 / 55.8 / 55.8 KB**，含程序化颗粒和导数法线。它有成本，但不支持“外壳一项造成约 30 秒”的判断。
- **地面 / 弧墙**：`Exhibition_Floor_And_Cyclorama`，三个变体约 **50 KB**；普通 Standard 材质在当前灯光下也有约 46–50 KB 的片元程序，问题不局限于自定义材质。

### GTAO 预通道已确认的冗余

`src/js/Core/ScenePipeline.js:24–28` 用 MRT 输出 `normalViewGeometry`，但没有替换实际材质。

从真实生成的 `Controller_Shell` 法线通道 WGSL 中确认：在最终

```wgsl
output.m0 = vec4<f32>( normalViewGeometry, 1.0 );
```

之前，仍存在完整 `directDiffuse` / `indirectDiffuse` / `SpecularColor` / `Roughness` / `outgoingLight` 等计算及物理 BRDF。片元源码 **55.8 KB**，与主画面的 **55.8 KB** 几乎一样。当前几何法线不需要这些照明与塑料微法线，但驱动仍需处理生成的程序。

**建议与验证边界**：轻量几何法线 / 深度路径可以减少源码与 CPU 构建，但还不能据此承诺首屏收益。单独换成 Basic override 的诊断中，法线通道从 39 → 12 个管线、片元源码合计约 2.05 MB → 45 KB，但初始化约 35.76 s，对比基线 35.09 s **没有明显改善**；其余主画面与背景仍占大头。后续应在异步准备流程成立后再评估这项 CPU / 变体优化。

该 override 诊断忽略了原材质的 alpha cutout / 双面等语义，不是可交付画面。正式实现必须保留标签镂空、植物轮廓、实例变换和透明对象排除。

## 3. 同步 / 异步准备对照

诊断版把首次真实路径中同步创建的 GPU 管线改为异步请求；等 Promise 收敛后跨帧重新完整绘制，再等待队列。画面通道与材质不删减，最终首次 warmup 的完整绘制计数回到基线 **545 次**（背景 134 + 其余 411，含嵌套通道；Loading 临时关闭剔除，因此不同于稳态 537 次）。

| 路径 | 初始化 | 首次 warmup | warmup 末尾队列等待 |
| --- | ---: | ---: | ---: |
| 同步基线 1 | 38.22 s | 36.34 s | 34.05 s |
| 异步诊断 + 等待与完整重绘 | **6.44 s** | **5.14 s** | **0.10 s** |
| 恢复同步基线 2 | 35.09 s | 33.35 s | 31.24 s |

这是强证据：**最大的可优化点是实际渲染变体的准备 / 编译调度，而非直接删材质、降低阴影分辨率或减少 AO 样本。** 异步诊断的 `renderSubmitMs` 包含显式 await 的准备时间，不再代表纯 CPU 提交，不与基线该字段直接比较。

并行异步管线的单项 `readyMs` 包含等待、调度与主线程回调延迟，且大量 Promise 同时完成；**不能把它们相加，也不能按该延迟简单判定某个 AirPods 材质独占 3 秒编译**。第 2 节补充的串行 `serviceMs` 专门排除了自身前面的排队，用于更可靠的逐项排名，但仍没有声称拿到了驱动内部的纯编译 CPU / GPU 分解。

此诊断使用 Three.js r186 的私有 backend 钩子和跨帧重绘，不是已交付的修复。正式实现需保证真实 MRT / AO context、阴影深度 generation、透明前后通道、预热后的 Folded 还原、取消 / HMR 销毁和首帧完整性，不能直接照搬 monkey patch。

### 单变量消融

| 独立诊断模式 | 初始化 | 首次 warmup | 说明 |
| --- | ---: | ---: | --- |
| 恢复后的同步基线 | 35.09 s | 33.35 s | 完整效果 |
| 只关闭玻璃背景捕获 | **17.68 s** | **16.16 s** | 玻璃仍绘制但折射源不更新，不可直接交付 |
| 旁路完整 AO 管线 | **21.82 s** | **20.20 s** | 同时去掉法线预通道、AO、降噪、合成并改变主画面管线；不是仅降低 AO 样本 |
| 只简化按键清漆 / 微法线 | 34.24 s | 31.95 s | 按键 shader 简化后仍然很慢，收益小于通道 / 调度调整 |
| 只将法线预通道改为轻量 override | 35.76 s | 33.55 s | 大幅减少该通道源码 / 管线数，但本轮总时长未改善，不直接交付 |

这些单轮差值存在硬件与编译调度波动，**不能相加**，也不作为所有设备的启动承诺。它们支持“跨通道重复准备和创建方式优先于削减某一种材质”的结论。

## 4. 优先级

1. **P0：真实通道的异步准备与完整性验证**，保留画质；当前单机诊断已有明显收益，但需实现为受生命周期管理的正式准备流程。
2. **P1：玻璃背景捕获减小准备范围 / 变体量**，不是仅把玻璃材质本身粗糙度调低。须保持实时折射内容。
3. **P2：主机 / 样品按键等材质结构复用**，这是累计准备时间最大的材质族；保留独立配色 uniform、印花坐标和资源所有权。只砍清漆没有显著改善启动，优先复用结构与准备调度，注意已有 GPU 管线缓存。
4. **P2：GTAO 几何预通道轻量化**，去掉不参与最终法线输出的完整光照 / 物理材质变体；结构冗余确认，但单项首屏收益尚未证实，放在异步流程后评估。

## 5. 重现

```powershell
node scripts/profile-preparation.mjs '<Chrome 可执行文件>' '<已有临时目录>' baseline
node scripts/profile-preparation.mjs '<Chrome 可执行文件>' '<已有临时目录>' async
node scripts/profile-preparation.mjs '<Chrome 可执行文件>' '<已有临时目录>' serial
node scripts/profile-preparation.mjs '<Chrome 可执行文件>' '<已有临时目录>' no-backdrop
node scripts/profile-preparation.mjs '<Chrome 可执行文件>' '<已有临时目录>' no-ao
node scripts/profile-preparation.mjs '<Chrome 可执行文件>' '<已有临时目录>' simple-buttons
node scripts/profile-preparation.mjs '<Chrome 可执行文件>' '<已有临时目录>' normal-only
```

脚本自行启动 / 关闭临时 Vite 和 Chrome，输出 `report.json`、`summary.json` 与实际 WGSL；不安装依赖，不改应用。依赖当前 Three.js 内部实现，升级后必须重新检查钩子。消融模式画面不完整，仅用于归因。

`baseline` 表示不额外变更当前应用：第 6 节实施后，它测到的是正式异步路径，并不会自动恢复历史同步基线。上述历史数字对应下列保存的原始报告，不能把当前消融直接与历史单轮结果混用。

有效材料：

- 同步基线 1：`C:/Users/f1686533/AppData/Local/Temp/opencode/duo-prep-baseline-D55Bo4/`。
- 同步基线 2：`C:/Users/f1686533/AppData/Local/Temp/opencode/duo-prep-baseline-jp1cHw/`。
- 有效异步诊断：`C:/Users/f1686533/AppData/Local/Temp/opencode/duo-prep-async-VUVR9p/`。
- 关闭背景捕获：`C:/Users/f1686533/AppData/Local/Temp/opencode/duo-prep-no-backdrop-CMf6cK/`。
- 旁路完整 AO：`C:/Users/f1686533/AppData/Local/Temp/opencode/duo-prep-no-ao-HE4xfy/`。
- 按键材质简化：`C:/Users/f1686533/AppData/Local/Temp/opencode/duo-prep-simple-buttons-6zBQEi/`。
- 逐管线串行排名：`C:/Users/f1686533/AppData/Local/Temp/opencode/duo-prep-serial-6g3XBJ/`。
- 法线预通道轻量 override：`C:/Users/f1686533/AppData/Local/Temp/opencode/duo-prep-normal-only-WK3ksY/`。
- 早期 `async-qxgtcG` 没有注入等待 / 完整重绘，不作为异步收益结论；模块图未启动的失败样本也排除。

## 6. P0 正式实施（2026-10-28）

### 实现范围

- 新增 `src/js/Core/PipelinePreparation.js`：只在真实帧同步提交栈内，把 backend 的材质管线创建切到 Three 原生异步入口；描述符、缓存、错误域和 ready 状态仍由 Three 管理。不重写 GPUDevice，不复制 Three 的管线实现，不修改 node_modules，等待期间与正常动画没有常驻 hook。
- 每轮等待所有实际创建任务并检查 backend 成功状态；Three 的 Promise 可能在验证失败时仍 resolve，必须拒绝错误管线。跨 rAF 再次绘制，强制刷新阴影，直到零新管线且队列完成；最多 8 轮，未收敛进入现有可见失败提示，不用固定延迟掩盖不完整首帧。
- Renderer 仍保留一次最小阴影 seed 与深度附件 generation 稳定步骤；真实 MRT / AO context、透明和透射变体通过实际通道发现。Phone → Game Home → Playing → Folded 顺序、剔除恢复和 8° 首帧均保留。
- 预热时正常动画循环不抢先同步创建管线；窗口尺寸变化延后到队列完成后应用，再次验证完整帧。销毁取消待执行帧和等待，消费迟到拒绝但不再访问 backend 或发布就绪。
- `World` / `Experience` / 游戏进入路径显式检查预热是否完成；取消、Replay 或销毁后的旧游戏进入 Promise 不会把材质标记为就绪或重新展开遮罩。
- 明确校验 Three.js r186 / WebGPU 私有接口；没有引入 WebGL 降级或新依赖。Three 内部少数 mipmap 小管线仍同步创建，不能声称 GPUDevice 的所有请求都已异步化。

### 实测收益

同机、独立 Chrome profile，1920×1080 / DPR 1，不把本地或驱动缓存条件等同所有设备的网络冷启动：

| 指标 | 优化前同步基线 | 正式异步实现 |
| --- | ---: | ---: |
| 初始化（PerformanceMonitor 口径） | 35.09–38.22 s | **6.67–7.47 s** |
| 首次 warmup | 33.35–36.34 s | **5.13–5.64 s** |
| 首次 warmup 末尾队列等待 | 31.24–34.05 s | **0.10–0.15 s** |
| 稳态 Game Home | 约 60 FPS / 537 draws | **59.95–59.97 FPS / 537 draws** |

按 35.09 → 7.47 s 比较，本机初始化减少约 **79%**。正式路径首次收集约 154 个新材质管线，3 轮收敛；后续 Home 约 0.1 s、Playing 约 0.1 s、Folded 约 0.06 s。首次准备的 CPU 提交和异步等待分别记录为 `renderSubmitMs` / `pipelineWaitMs`，不把后者称为 GPU 帧耗时。

本轮**没有**削减背景捕获范围、清漆/印花、GTAO 法线语义、AO 样本、MSAA 或阴影分辨率。P1/P2 暂不叠加：P0 已去掉主要等待，背景裁剪需证明所有折射采样仍正确，直接复用按键节点也需保留独立 uniform / 印花坐标；仅凭历史串行累计时间不能再承诺同等收益。

### 验证入口

```powershell
node scripts/verify-pipeline-preparation.mjs
npm run build
node scripts/verify-startup.mjs '<Chrome 可执行文件>' '<已有临时目录>' normal
node scripts/verify-startup.mjs '<Chrome 可执行文件>' '<已有临时目录>' resize
node scripts/verify-startup.mjs '<Chrome 可执行文件>' '<已有临时目录>' destroy
node scripts/verify-startup.mjs '<Chrome 可执行文件>' '<已有临时目录>' production
```

纯逻辑检查覆盖异步并发请求、多轮收敛、完整重绘、已有 hook 的精确恢复、验证错误、原生拒绝、队列丢失、编译/帧/队列等待中的销毁、迟到拒绝和非重入。浏览器脚本使用独立 Vite/preview，只在开发响应副本中暴露实例及观测 Intro 启动前状态；不替换正式准备实现或 shader。生产模式黑盒检查实际 dist。

### 已完成验收与边界

- 正式代码普通启动通过：Intro 启动前夹角 8°、倾角 0°、Controller 隐藏、Phone 上下屏可见而 Controller 屏隐藏；四阶段预热完整，正常渲染不残留 backend 覆盖，预热中的实际材质管线没有同步请求。
- Play 近景再次强制完整预热前后 draw count 同为 411，截图平均绝对通道差约 `3.2e-7`（8-bit、0–255 标度）；Hero / Play 与旧同步版也做了截图对照，未发现材质、阴影或 AO 缺失。浮动展品与时间节点会造成跨轮截图差异，最终观感仍交用户验收。
- 真实多通道编译中从 1920×1080 改为 1200×900，通过延迟 resize 与重新绘制；最终 Canvas 为 1200×851，未捕获 JS / GPU 错误。
- 真实多通道编译中销毁，旧实例不发布初始化完成、不启动 Intro、不残留 hook；在同一 Canvas 上重新初始化通过。纯逻辑测试另外覆盖迟到 Promise 拒绝后不再访问 backend。
- 加强重建检查：不等待旧 Native 编译完成，立即在同一 Canvas 上新建 Experience；旧实例保持未初始化，新实例完成四阶段准备及首帧检查，同样无捕获 JS / GPU 错误。
- 生产 preview 连续三轮通过：从导航到 Loading 完成约 6.77 / 6.79 / 6.85 s。此时间包含模块加载，起点不同于开发 `PerformanceMonitor.loadMs`，不混作同一列。生产首屏未加载 WASM / ROM；未捕获 JS / GPU 错误。
- 早期两轮 preview 分别发生图片 / GLB 请求失败，均在资源阶段、尚未进入预热；HTTP 排查为 200、正确 MIME、响应逐字节匹配 dist，未据此修改应用。启用网络事件留档后连续三轮成功，早期失败保留在临时目录，不计入准备耗时样本，也不声称已找到其根因。自动请求的缺失 `favicon.ico` 单独归入测试报告 warnings，不忽略实际应用或 GPU 错误。
- 最终 `npm run build`、两个新脚本的语法检查、`verify-pipeline-preparation`、`verify-nds-mapping`、`verify-textures --dist` 和 `git diff --check` 均通过；构建仅保留既有大 chunk 警告。未接入新测试框架，浏览器脚本在本机 Node 22 / Chrome 156 运行。

有效材料：

- 正式实现首次复测：`C:/Users/f1686533/AppData/Local/Temp/opencode/duo-textures-wzj9h9/`。
- 正式独立启动：`C:/Users/f1686533/AppData/Local/Temp/opencode/duo-startup-normal-Ize07C/`，以及先前的 `duo-startup-normal-mGsrvW/`。
- 编译中 resize：`C:/Users/f1686533/AppData/Local/Temp/opencode/duo-startup-resize-hhNijk/`（先前同样通过的样本 `duo-startup-resize-rhUdm7/`）。
- 编译中销毁并立即重建：`C:/Users/f1686533/AppData/Local/Temp/opencode/duo-startup-destroy-U0JsOG/`。
- 生产连续复测：`C:/Users/f1686533/AppData/Local/Temp/opencode/duo-startup-production-F2waUH/`、`duo-startup-production-8JglAs/`、`duo-startup-production-0yoiCW/`。
