# 按键材质节点复用 · 2026-10-29

## 结果

在已完成异步管线准备的基础上，复用主机和展示样品的按键算法节点，保留独立材质、配色、印花坐标、清漆与颗粒。**不改动 GLB、UV、几何、Lightmap、AO 或玻璃效果。**

同机 Chrome 156 / WebGPU，1920×1080 视口、Canvas 1920×1031、DPR 1，独立 profile 顺序运行：

| 指标，首次 warmup-phone | 改动前 | 改动后 |
| --- | ---: | ---: |
| 按键 NodeBuilder 构建数 | 62 | **12，-80.6%** |
| 按键 CPU 构建累计时间 | 1.23–1.27 s | **0.29–0.33 s** |
| 全部 NodeBuilder 构建数 | 225 | **175** |
| 全部 CPU 构建累计时间 | 3.07–3.10 s | **2.29–2.33 s** |
| 按键新 GPU 管线 | 30 | **12** |
| 全部新材质 GPU 管线 | 154 | **129，-16.2%** |
| 首次 warmup | 5.50–5.57 s | **4.52–4.57 s** |
| 初始化，PerformanceMonitor 口径 | 7.10–7.36 s | **6.18–6.26 s** |

两组旧版与两组新版交错运行，旧版通过临时 Vite 响应读取改动前的两个文件快照，**没有回退工作区**。NodeBuilder CPU 时间、异步等待和队列等待不相加推算 GPU 帧耗时；新 profile 也不等于已清空系统/驱动缓存。这里是本机对照，不是线上网络冷启动承诺。

## Needle / Blender 的判断依据

- Needle 的实时场景定位到了主机 ABXY、D-Pad、三套 Dock 和左侧按键样品。旧 `Dock_classic_Button_A` 的重建 TSL 显示投影中心、右/上协向量、宽度和字母格子编号是每枚键的编译常量；复测节点图已变为当前 Mesh 的 8 项 `ReferenceNode`。
- 当前页面存在主渲染器与鼠标伴随笔渲染器。本轮 Needle GPU 采样/帧图落在小型次级渲染器，只报告约 0.0 ms，**不把它当成整个展区 GPU 时间或新的瓶颈证据**。主画面计数由独立浏览器的原生整帧统计复核。
- Blender MCP 在临时场景导入原始 GLB 审计：`iphone.glb` 为 17 个 Mesh / 66,429 三角形；ABXY 各 4,608 三角形且都只有一个材质槽，D-Pad 5,184 三角形、一个材质槽，Controller Shell 1,112 三角形、两个 UV 层。`airpods_pro.glb` 为 4 个 Mesh / 70,198 三角形。
- 因此，不能把 ABXY 的运行时材质变体归因于 Blender 中重复拆分的材质槽；本轮先处理代码侧节点构建。审计没有执行减面、烘焙或导出，没有保存 .blend；结束清理全部临时导入内容并恢复原场景（0 个对象）。

## 实现

- `ButtonPrint` 共享印花投影、遮罩、油墨和表面响应节点；按基础 roughness / clearcoat / specular 输入节点区分缓存，不把不同基础表面误合并。
- 字母、中心、协向量、宽度、顶面区间和法线仍属于每个 Mesh 的独立投影数据；GLB Geometry 不变，数据不随动画重测。协向量继续用 Mᵀ 推导，保留非均匀缩放与文字方向语义。同一 Mesh 的多个材质槽使用同一投影，材质颜色仍分别持有。
- `ControllerButtonMaterial` 将颗粒与清漆算法只构建一次，按当前材质读取中心与尺度，保留主机自身的调参 uniform 和每枚键的底色。D-Pad 不读取字母图集，也不强行与 ABXY 合并为相同算法。
- `ExhibitSample` 只补充对应 Mesh 给印花投影；仍拥有和释放自己的材质，几何与字母图集所有权不变。
- 实际主机四枚 ABXY 的算法缓存键由 4 → 1，三套 Dock 的十二枚 ABXY 由 12 → 1，但仍是十二个独立展示材质，不会互相串色。

### 阴影覆写约束

初版直接用 `MaterialReferenceNode` 读取印花数据，真实阴影 pass 出现 `Cannot read properties of undefined (reading 'center')`：Three 会把印花颜色节点用于阴影 alpha 的构建，而当前材质已被替换为 `ShadowMaterial`。定向记录确认错误发生于主机/Dock/展板按键的阴影构建，不是模块加载或 GPU 编译失败。

修正为标准 TSL `reference()` 从当前 Mesh 读取投影数据，阴影覆写不会改变 Mesh；**没有增加 renderer 私有接口、修改 Three 或关掉投影来绕过问题**。回归测试先复现该错误，再验证同一节点在四个不同 Mesh 与临时阴影材质间切换时编号和投影均正确。临时调试记录代码已移除。

## 验收

- `node scripts/verify-button-materials.mjs`：共享节点/缓存键、独立颜色与投影、非均匀缩放、不同基础表面、D-Pad、阴影覆写与跨 Mesh 更新、资源所有权。
- `verify-startup.mjs materials`：Folded 首帧、三套主题的 Hero/Play 近景、主机换色不改样品、完整重绘前后同为 411 draws、Replay/Skip、取消进入游戏，无捕获 JS/GPU 错误。
- 六组固定主题/镜头截图相对旧版的平均绝对通道差为 **0.021–0.033**（8-bit 的 0–255 标度），未发现印花错位/串字或明显外观变化；并非声称 shader 数值逐像素完全相同，最终视觉仍由用户验收。
- 稳态 Game Home 约 **59.95 FPS / 537 draws**，旧版约 59.96 FPS / 537 draws。本轮优化目标是准备成本，**不是减少每帧绘制次数或承诺更高 FPS**。
- 编译中 resize 到 1200×900、最终 Canvas 1200×851，通过延迟 resize 与完整重绘；编译中销毁并在旧任务未完成时同 Canvas 立即重建通过。
- 最新生产 dist 黑盒 preview 启动通过，导航至 Loading 完成约 7.10 s，未捕获 JS/GPU 错误。该起点不同于开发 PerformanceMonitor，且没有同轮旧版 dist 对照，不单凭此数值声称生产提速。
- 个别独立开发服务仍出现初始化前 `PerformanceMonitor.js` 动态导入被取消（网络事件为 `net::ERR_ABORTED`）；该失败未进入 GPU 准备，已留档且不纳入性能样本。重跑销毁测试成功，不宣称解决了此前独立服务的偶发请求问题。

## 重现与材料

```powershell
node scripts/verify-button-materials.mjs
node scripts/verify-pipeline-preparation.mjs
node scripts/verify-nds-mapping.mjs
npm run build
node scripts/verify-textures.mjs --dist
node scripts/profile-preparation.mjs '<Chrome>' '<已有临时目录>' baseline
node scripts/verify-startup.mjs '<Chrome>' '<已有临时目录>' materials
node scripts/verify-startup.mjs '<Chrome>' '<已有临时目录>' resize
node scripts/verify-startup.mjs '<Chrome>' '<已有临时目录>' destroy
node scripts/verify-startup.mjs '<Chrome>' '<已有临时目录>' production
```

可选环境变量 `DUO_BUTTON_SNAPSHOT` 指向包含改动前 `ButtonPrint.js` / `ControllerButtonMaterial.js` 的已有目录，只替换临时开发服务响应。生产检查禁止这种替换；`baseline` 不设变量时始终测当前应用。

材料位于 `C:/Users/f1686533/AppData/Local/Temp/opencode/`：

- 旧版准备：`duo-prep-baseline-Nl2TUS/`、`duo-prep-baseline-hv8WQL/`。
- 新版准备：`duo-prep-baseline-ABbRoO/`、`duo-prep-baseline-CokpiX/`。
- 三主题旧版截图：`duo-startup-materials-V9PnoW/`；新版：`duo-startup-materials-vywzBO/`。
- resize：`duo-startup-resize-81upBx/`；销毁立即重建：`duo-startup-destroy-9ESPWx/`。
- 生产：`duo-startup-production-n6IQi1/`。
- 响应对照快照：`duo-button-original-uz428g/`，只用于本地复测，不是运行资源。

没有新增依赖、提交或推送；原始素材与此前派生副本均保留。

## 后续缺陷修正：桌面比例与材质预览

用户报告 1166×982 Canvas 中仅剩主产品。Needle 确认五组配件被旧 `Exhibition.resize()` 的宽高比规则主动隐藏；新增 `verify-startup.mjs layout` 在旧逻辑下失败，不是几何删除或按键编译失败。现改为 **宽度 ≤720 CSS px 且宽高比 <1.35** 才精简展品；较高的桌面窗口不再隐藏，390px 手机精简后能恢复桌面。原宽屏测试不能代表此窗口比例，新增 720/721px 边界和真实重绘检查。

另一个 `ReferenceNode ... center` 报错经临时记录定位为 `Needle Preview sphere` 缺少按键 Mesh 投影数据。印花材质现在保留对应的静止投影数据，节点优先读取实景 Mesh，预览球入口才读取材质副本数据；阴影覆写与独立配色语义不变。`verify-button-materials` 新增同材质/无投影球体回归，先失败后通过；临时调试记录已清理。

材料仍在同一临时根目录：旧比例规则失败 `duo-startup-layout-Fg1mWR/`；初轮修复截图与桌面/手机/桌面状态 `duo-startup-layout-GENz5o/`；同时修复预览后复测 `duo-startup-layout-z3OzcN/`。开发模块请求取消样本 `duo-startup-layout-hMOt4a/` 尚未进入预热，不作为缺陷修复成功或性能数据。

最终验收 `duo-startup-layout-LVkQpq/` 覆盖 1166→390→720→721→1166 的实际绘制与断点切换；三主题复测 `duo-startup-materials-fzIKy9/` 和最新 dist 的 `duo-startup-production-DmE4NJ/` 均通过。构建、按键/管线逻辑测试、语法与 diff 检查通过，Needle 当前页面五组展品均可见且没有捕获错误；保留原来的 129 个首次新材质管线，不撤销节点复用优化。
