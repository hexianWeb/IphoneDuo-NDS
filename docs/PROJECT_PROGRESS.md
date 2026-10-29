# iPhone Duo WebGPU 项目进度

> 最后更新：2026-10-05
> 当前阶段：Phase 6 已完成验收；Phase 7 的 S3、页面操作栏、配色、Loading、进入转场、像素印花与触控笔已实现
> 当前状态：程序化触控笔、图片卡带封面、game0 试玩限制、配色记忆、AirPods 陈列与内部元件展台已实现；工程验证记录见第 11–16 节，最终外观等待用户在 WebGPU 浏览器中视觉验收

## 1. 进度摘要

Phase 2 Runtime Rig、折叠方向、阴影和 Controller Lightmap 已完成视觉校准。当前已实现角度驱动的 Fold Phone UI、可重播的 Controller 装配、装配期间的透明镂空，以及 Lock 后 Phone UI -> Game Home 转场和最小 Continue / 返回交互。

本轮补充了场景环境：灯光从 `World` 拆出为 `Environment` 组件并收紧了主光阴影相机，新增程序化展台桌板 `Stage`。HDR 环境贴图经实测否决，场景不设置 `scene.environment`。

2026-09-24 补充：场景细节 S1 已将 `Stage` 升级为连续地面/弧墙，新增固定顶面的小底座、TSL 网格与 Halo、左右展组灰盒，并校准 Hero / Play 取景及窄屏策略。当前实现与验证详见 [场景细节实施方案第 12 节](Scene_Detail_Implementation_Plan.md#12-s1-实现记录2026-09-24)。下文早期环境记录保留为历史基线。

实施里程碑统计：

```text
Phase 1 / 7：完成
Phase 2 / 7：完成
Phase 3 / 7：完成
Phase 4 / 7：完成（用户确认视觉校验通过）
Phase 5 / 7：完成（用户确认 NDS 综合验收通过）
Phase 6 / 7：完成（用户确认按键反馈验收通过）
功能验证：完成
装配视觉校验：通过
Git 提交：本轮已执行
```

这里不使用主观的总体百分比。后续 NDS 技术验证和视觉精修的工作量仍有不确定性，以七个实施阶段逐项统计更可靠。

## 2. 阶段状态

| 阶段 | 内容 | 状态 | 说明 |
|---|---|---|---|
| Phase 0 | PRD、GLB 调研、代码规则 | 已完成 | PRD 已扩充，项目规则已固化 |
| Phase 1 | Experience 架构、资源加载、模型适配 | 已完成 | 用户已确认模型在场景中显示正确 |
| Phase 1.5 | 模型坐标轴与 Transform 检查器 | 已完成 | 为任务二的铰链轴向校准提供基建 |
| Phase 2 | BottomRig、HingePivot、折叠原型 | 已完成 | 折叠方向、阴影和 Lightmap 已完成视觉校准 |
| Phase 3 | Controller Reveal / Assembly | 已完成 | 精密吸合时间线已通过用户视觉校验 |
| Phase 4 | Intro、Camera Shot、Ready / Play | 已完成 | 用户已确认浏览器视觉校验完成；进入 Phase 5 前增加 Controller Shell 材质 LookDev |
| Phase 5 | NDS 模拟器技术验证与双屏桥接 | 已完成 | 独立页及主产品 3D 双屏桥接、连续游玩、音画同步、触控与真实 Gamepad 均已通过验收 |
| Phase 6 | Keyboard / Gamepad 与 3D 按键反馈 | 已完成 | 键盘、标准 Gamepad、3D 下屏触控、输入释放、ABXY 下沉 / D-Pad 倾斜弹簧、点击音与手柄轻震均已通过验收 |
| Phase 7 | 性能、兼容性、Loading 与视觉精修 | 进行中 | S3、操作栏、配色、Loading、进入转场、像素印花与触控笔已实现，待视觉验收；性能与兼容性待收尾 |

## 3. 已完成内容

### 3.1 项目与产品文档

- 整理真实 Blender / GLB 节点层级。
- 确认不再回 Blender 增加 Pivot、Anchor 或 Camera。
- 确认 GLB 为 `180°` 的竖屏完全展开 Bind Pose。
- 确认目标展示夹角暂定 `110°`，上半屏相对 Bind Pose 旋转 `70°`。
- 确认下半屏固定、上半屏旋转、Controller 跟随下半屏。
- 确认 Controller 当前 GLB 相对变换就是最终安装终点。
- 保留 NDS Web 模拟器与合法 Homebrew ROM 路线。
- 明确 GSAP 与按键弹簧的职责边界。
- 确认三块屏幕节点与模式职责：`Top_Screen_Plane` 为手机上屏，`Bottom_Screen_Plane` 为手机原生下屏，`Bottom_Display_Plane` 为 Controller 镂空上方、仅在 Lock 后激活的显示层。
- 确认三块屏幕 UV 均覆盖完整 `0–1`；比例差异由运行时 fit、letterbox 或 crop 处理，不扭曲 UV。

### 3.2 项目规则

- 新增 `.cursor/rules/iphone-duo-webgpu.mdc`。
- 新增根目录 `AGENTS.md`，让 Codex 自动读取项目规则。
- 固化 `Experience` 单例、Class 生命周期、Tweakpane、资源与模型约定。
- 明确当前工程是纯 JavaScript，不使用 Vue 或 Pinia。
- 明确 `public/` 是公共资源目录，`static/` 不作为当前资源目录。

### 3.3 工程架构

- 建立 `Experience` 单例入口。
- 拆分 `Camera`、`Renderer` 与 `Debug`。
- 拆分 `Sizes`、`Time`、`State`、`EventBus` 与 `Resources`。
- 建立 `World` 与 `ModelAdapter`。
- 建立统一 `sources.js` 资源声明。
- 建立 `update()`、`resize()` 与 `destroy()` 生命周期。
- 保留 Vite HMR 销毁路径。

当前源码统计：

| 项目 | 数量 |
|---|---:|
| JavaScript 文件 | 39 |
| `src/js` 架构模块 | 36 |
| `src` 内全部文件 | 44 |

### 3.4 模型加载与适配

- 从 `/iphone.glb` 加载真实产品模型。
- `Controller_Shell` 现由程序生成磨砂塑料；ABXY / DPad 使用保留原底色的独立 Physical 清漆塑料。
- `Controller_Shell` 已接入独立 EXR Lightmap，并保留在程序化塑料材质上。
- 启动时集中校验 10 个必要节点。
- 自动计算模型整体包围盒、中心与基础缩放。
- 使用外层 `PresentationRoot` 承担展示变换。
- 为模型 Mesh 启用基础投射与接收阴影。
- Tweakpane 支持位置、旋转、缩放、线框和节点状态检查。
- 加入 OrbitControls，便于用户进行视觉校验。

当前代码启动时校验的 10 个节点：

```text
PHONE_ROOT
BottomHalf_NO_CAM
TopHalf_CAM
Hinge
CONTROLLER_ASSEMBLY_ROOT
Controller_ROOT
Controller_Shell
Top_Screen_Plane
Bottom_Screen_Plane
Bottom_Display_Plane
```

补充屏幕语义确认：`Bottom_Screen_Plane` 用于 Phone Mode 的手机原生下屏。Controller 装配期间隐藏 `Bottom_Display_Plane`，用户透过镂空继续看到手机 UI；Lock 后转场才由 Controller 显示层接管，Game Home / Playing 再将上下内容映射到 `Top_Screen_Plane` / `Bottom_Display_Plane`。

### 3.5 页面状态与错误处理

- WebGPU 不支持时显示明确提示。
- WebGPU 初始化阶段显示状态面板。
- GLB 加载过程显示资源进度。
- 资源或场景初始化失败时显示错误原因。
- 销毁时停止 AnimationLoop、移除事件并释放模型 GPU 资源。

### 3.6 坐标检查基建

- 新增 `ModelInspector` Class，并接入 World 更新与销毁生命周期。
- 坐标轴遵循 Three.js 约定：红色 X、绿色 Y、蓝色 Z。
- 支持显示世界原点坐标轴与 XZ 网格。
- 支持从 PresentationRoot 和 10 个关键 GLB 节点中选择检查对象。
- 支持显示所选节点的局部坐标轴和世界包围盒。
- 支持一次显示全部关键部件的坐标轴。
- Tweakpane 实时显示所选节点的局部 / 世界 Position 与 Rotation。
- Transform 读数以 10 Hz 刷新，3D Helper 继续逐帧跟随，避免面板无意义高频刷新。

### 3.7 Runtime Rig 与折叠

- 新增 `ProductRig`，建立 `ProductRoot`、`BottomRig`、`HingePivot`、`HingeVisualRig` 与 `RuntimeAnchors`。
- 使用 `Object3D.attach()` 保持世界变换，将下半屏和 Controller 挂到 `BottomRig`，上半屏挂到 `HingePivot`。
- 从 `Hinge` 的局部包围盒动态推导中心与最长轴；当前模型运行时结果为 Z 轴，代码未硬编码 Blender 世界轴。
- 用户视觉校验已确认 `hingeAxisSign = +1`，并保留 Tweakpane 手动切换用于排查。
- GLB 的 `180°` Bind Pose 映射为产品角度，首次加入场景前应用 `8°`；Tweakpane 提供 `8°`、`110°`、`180°` 快速检查。
- 铰链视觉网格默认使用上半屏折叠量的 `0.5`，Controller 安装终点矩阵已相对 `BottomRig` 保存，供 Phase 3 使用。
- Coordinate Inspector 可检查新增的运行时 Rig 节点。
- 可实时调节 DirectionalLight 的 `shadow.radius`、`shadowBias` 与 `shadowNormalBias`。`radius` 是 PCF 软边宽度（阴影贴图像素），`Key shadow` 面板范围 `0–20`，当前源码值为 `10`；bias 用于处理模型细碎自阴影（面板后来从 `Lighting` 改名为 `Environment`，见 3.13）。
- 用户视觉校验已确认 `shadowNormalBias = 0.006`；`shadowBias` 暂时保持 `0`。
- 场景默认显示 Key DirectionalLight Helper，并可在面板中切换。

### 3.8 Controller Shell Lightmap

- `Resources` 使用 `EXRLoader` 加载 `/lightmaps/Controller_Shell_lightmap.exr`。
- 贴图为 2048 × 2048 Half Float 线性 HDR，运行时文件大小为 50,364,752 bytes。
- `Controller_Shell` 已包含独立 `TEXCOORD_1` (`uv1`)；Lightmap 使用 `channel = 1` 和 `flipY = true`。
- Lightmap UV 错位问题已由更新后的 GLB 与采样配置修复，并通过用户视觉校验。
- Lightmap 只绑定到 `Controller_Shell` 的独立材质，不影响按键、D-Pad 或显示面。
- Product Model 面板提供 `Controller Lightmap` 启用开关和 `0-5` 强度调节。
- 新增 `ControllerShellMaterial` 和 `controllerPlastic.js`：尺寸归一化局部噪声、粗糙度变化、表面梯度微法线与高频衰减；可选层纹默认关闭。
- `Controller Shell Plastic` 面板提供颜色、频率、粗糙度、坡度强度和打印层纹轴调节；方案校正详见 `Controller_TSL_Material_Implementation.md` 首节。
- 用户已确认外壳材质效果；新增 `ControllerButtonMaterial` 覆盖 ABXY / DPad，`Controller Button Plastic` 面板可调清漆强度、清漆粗糙度、底层 IOR 与微颗粒。按键不使用外壳 Lightmap。

### 3.9 Controller 装配

- 安装 GSAP，并新增 `ControllerAssembly` 管理独立、可重播和可销毁的装配 Timeline。
- Replay 自动将产品切到 `110°`，再执行 Reveal、Align、Slide 与 Lock。
- Controller 最新模型的纵向滑轨轴自动推导为 Z、对准旋转轴为 Y；用户视觉校验确认滑入方向为 `-Z`，XYZ 方向与偏移仍可在 Tweakpane 覆盖。
- Entry 从滑轨负方向进入；Reveal 用浅弧线和 `power3.out` 送进画面，Align 与 Reveal 后半重叠并消除默认 `3°` 偏角。
- Slide 用 `power3.in` 吸入滑轨并连续压过安装点约 `5%`，避免与 Reveal 一样在滑轨上匀速走；Lock 用 `back.out` 单次回弹后保留 Hold。
- 默认时间线总长约 `1.85s`：Reveal `0-0.8s`、Align `0.42-0.87s`、Slide `0.75-1.3s`、Lock `1.3-1.5s`、Hold `1.5-1.85s`。
- 动画只修改 Controller 的 Position 与 Quaternion，不修改 Scale；完成和 Skip 都恢复保存的精确安装矩阵。
- Controller Assembly 面板提供 Entry、Replay、Skip / Installed、阶段状态和全部距离、偏移、时长参数。

### 3.10 IntroDirector 基础状态流

- 新增 `IntroDirector`，由 `World.start()` 在渲染循环建立后自动播放。
- Intro 编排状态链为 `intro-folded → intro-unfold → screen-wake → controller-assembly → game-changer → hero → ready`；产品模式独立为 `phone → attaching → game-home → playing`。
- Folded 阶段保持 `8°` 并隐藏 Controller；Unfold 用 GSAP 动画到 `110°`，随后调用已完成的装配 Timeline。
- Unfold 先以 `power3.in` 在 `0.45s` 内从 `8°` 撕开到 `24°`，再以 `power3.out` 在 `1.55s` 内连续落到 `110°`，中间不停车。
- Hero 阶段进入 Game Home；Continue 会先终止 Hero Delay、收束 Intro 并进入 Playing，避免后续 Ready 事件把镜头拉回 Hero。
- Replay 会终止旧的 Intro、Hero Delay 与 Controller Timeline 后重建初始姿态；Skip 直接恢复 `110°` 和精确安装矩阵。
- Intro 与产品模式分别写入 `State.introState`、`State.productMode`，并发布 `intro:state`、`product:mode` 事件。

### 3.11 CameraDirector 基础镜头流

- 新增 `CameraDirector`，监听 `intro:state` 驱动 Folded、Assembly、Hero，并监听 `product:mode` 驱动 Game Home / Playing 的 Hero、Play 镜头。
- Folded 立即落位；Unfold 与 Assembly 镜头并行过渡；Hero 与 Ready 共用 Hero 镜头；Play 使用独立镜头。
- 镜头 Timeline 同步动画 Camera Position、OrbitControls Target 与 FOV，过渡期间禁用手动 Orbit。
- Tweakpane 支持单镜头预览、临时开启自由 OrbitControls 取景，以及将当前 Position、Target、FOV 回写到镜头参数。
- Game Home 与 Playing 在镜头落位后开放小范围 Orbit：默认方位 ±16°、极角 ±10°、距离 ±10%，禁止平移。锚点取自镜头本身，松手不会把范围向外扩。拖动上下屏时暂停旋转，把指针留给点击和 NDS 触控。

### 3.12 ScreenManager 与 InputRouter

- `ScreenManager` 只协调 `phone`、`attaching`、`game-home`、`playing` 模式、三屏可见性和 Game Changer Timeline。
- `PhoneScreenSurface` 保留原生 Phone UI 与 Fold TSL，并采样动态 Game Home 上屏纹理；`ControllerDisplay` 绘制 Game Home 上下屏的 Apple 风格游戏中心、栏目、游戏状态和焦点。
- Controller Game Home 的上屏静态图片已替换为运行时 `CanvasTexture`；Controller 下屏首页按 `public/bottom_Screen.png` 绘制四宫格，包含继续冒险、收藏库、地图和控制器，仍支持 Continue、选取本地 ROM 与主题切换。
- Pointer 通过 Three.js Raycaster 命中 `Top_Screen_Plane` 或 `Bottom_Display_Plane`，点击与显示复用各自的纹理 UV 变换。
- Game Home 使用方向键在四宫格中移动焦点、Enter 确认、Escape 返回主菜单；标准 Gamepad D-Pad 和底部面键也可导航。Playing 时保留原有 NDS 键盘映射与 Escape 返回。
- Phone Mode 与 Controller 装配、Game Changer 转场阶段不响应产品导航动作；只有转场完成进入 Game Home 后才激活 Continue。
- Controller CanvasTexture 已统一应用水平镜像与逆时针 `90°` 旋转，Continue 命中测试复用同一纹理 UV 变换。
- `ScreenManager.update()` 只在 Canvas 内容变化时上传纹理；销毁时只释放本模块创建的纹理和材质，并恢复 GLB 原始屏幕状态。
- `docs/img/主页面.png` 已通过 Vite 资源管线作为 Phone UI 加载；原图为 `1484 × 1060` 双联桌面，运行时按左右两个 `742 × 1060` 面板分别映射到手机上下屏。
- Phone UI 从 Fold 第一帧开始显示。Top Screen 使用 9-tap TSL 方向模糊、UV 位移与折痕阴影，默认从 `24°` 开始恢复并在 `85°` 清晰；Bottom Screen 在 `45°` 前完成轻度模糊和亮度恢复。
- Screen Wake 不再从黑场点亮，而是在 Unfold 完成后以默认 `1.5s` 稳定曝光与焦点，并额外停留 `4s` 供观察。
- Controller 装配期间 `Bottom_Display_Plane` 完全不可见，使镂空区域显示 `Bottom_Screen_Plane` 的 Phone UI。
- Lock 完成后停顿 `0.15s`，再以 `0.75s` Blur / Scale / Crossfade 将 Top Screen 切换到动态 Game Home Canvas、激活 Controller UI，并在结束时隐藏手机下屏。
- Phone UI 使用受 ACES 色调映射管理的 `MeshStandardNodeMaterial`，由独立 `Phone Screens` 面板调节自发光亮度、漫反射细节和粗糙度；默认亮度已从无色调映射的全亮状态降至 `0.38`。
- Phone UI 先裁成两张独立半幅 `CanvasTexture`，再执行镜像和旋转；当前校准基线为 `180°` 与上下屏面板对调，面板仍可切换 X / Y 镜像和四档旋转。
- Intro 面板新增 `screenWakeHold`、`Pause at Screen Wake`、`Inspect Screen Wake` 与 `Continue Assembly`；可无限期停留在完整点亮状态调试，再恢复装配流程。
- 新增 `Fold Screen Effect` 与 `Game Changer Transition` 面板，可检查角度、模糊、位移、折痕方向、镂空、转场进度、Game UI 朝向和亮度。

### 3.13 场景环境与展台

- 新增 `World/Environment/Environment.js`，把原先散在 `World.setEnvironment()` 的背景色、`HemisphereLight`、主光、补光与 Helper 收进独立组件，Tweakpane folder 从 `Lighting` 改名为 `Environment`，并补上了原先缺失的 folder dispose。
- 新增可调参数：背景色、曝光、三盏灯强度、主光 X / Y / Z 位置。曝光经 `Renderer.setExposure()` 修改，`Environment` 不直接写 Renderer 内部字段。
- 主光阴影相机不再使用 three 默认的 ±5 / near 0.5 / far 500，改为以光源到原点的距离为中心推导 near/far，正交范围由 `shadowExtent`（默认 3.6）控制。
- 新增 `World/Environment/Stage.js` 程序化展台：`RoundedBoxGeometry` + 非金属 `MeshStandardNodeMaterial`，调定 20 × 20 × 0.12，倒角 0.02。`receiveShadow = true`、`castShadow = false`，直接挂 Scene，不进入 `fitModel()` 包围盒。表面使用 `public/texture/` 下的 Plastic010 1K JPG（颜色 / OpenGL 法线 / 粗糙度），颜色乘色默认白，粗糙度默认按贴图原值（scale 1），`tileSize` 默认 2。
- 桌面高度经 `ModelAdapter.getStageSurfaceWorldY()` 运行时换算（Blender `Z = -0.035` → GLB 局部 Y → 世界 Y），未写死坐标。实测返回 `-0.09726002`，与文档推导一致。
- **HDR 环境贴图已否决。** `studio_small_03_1k.hdr` 接入 `scene.environment` 后实测观感更差——外壳 EXR Lightmap 本身是一次天光烘焙，叠加 studio HDR 后重复计光，画面被抬平。文件保留在 `public/hdr/` 但不进入 `sources.js`。
- 取消 HDR 的连带结果：场景**间接镜面为零**，清漆高光只来自两盏 DirectionalLight；间接漫反射只剩无方向的半球光。因此 GTAO 的优先级上升，详见 `docs/Scene_Lighting_Stage_Plan.md`。

### 3.14 GTAO 管线

- 新增 `Core/ScenePipeline.js`，由 `Renderer` 创建、逐帧调用、resize 与销毁。
- 使用 r186 `RenderPipeline`、几何法线 / 深度预通道、`GTAONode` 与 `DenoiseNode`；通过 `builtinAOContext` 影响间接光照，不直接乘最终颜色，保留屏幕自发光与直射高光。
- 预通道排除透明对象；默认半分辨率 AO、16 samples、radius 0.12、thickness 0.08、strength 1，全分辨率边缘保持降噪。不启用时间累积，避免引入历史帧拖影。
- `GTAO` 面板提供完全旁路开关、Scene / Raw AO / Denoised AO 预览及采样、分辨率、半径、厚度、强度和降噪半径。正常输出仅执行一次色调映射 / 色彩转换。
- `npm run build` 与 `git diff --check` 通过；CPU 检查覆盖目标尺寸、分辨率切换、旁路、预览、uniform 与目标释放。GPU 编译、视觉和合并运行性能已通过浏览器验收。

### 3.15 NDS 3D 双屏与游戏输入

- `World` 持有 `NDSPlayer`，后者管理 `NDSRuntime`、音频、加载状态与 `NDSControls`。由 Experience 的唯一渲染循环驱动，`Time.delta` 从秒换算为毫秒传给模拟器。
- WASM 与 ROM 仅在首次 Continue 时加载；开发环境可使用预置测试 ROM，生产构建使用本地文件选择器。加载失败可见，取消、Replay、模式切换和销毁会使旧异步启动失效。
- `ScreenManager` 持有 `NDSScreenBridge` 和两块 `NDSGameSurface`，将真实帧映射到 `Top_Screen_Plane` / `Bottom_Display_Plane`，Playing 隐藏 `Bottom_Screen_Plane`。
- NDS 显示映射明确使用上屏 `1.4:1`、下屏 `1:1`。4:3 主画面保持清晰等比显示；空余区域以当前帧的整数倍最近邻像素 cover 铺满并略微压暗，取代低分辨率模糊和纯黑硬切。模型 UV 物理比例推导保留为诊断回退；触控复用同一纹理矩阵并只响应清晰主画面区域。
- 键盘、标准 Gamepad 和 3D 下屏 Pointer 输入经 `InputRouter` 转成语义动作；NDS 键码仅在 Runtime 内部转换。Continue 的 Enter / 手柄按键不会穿透成游戏输入。
- Escape、返回按钮和窗口失焦/隐藏暂停并返回 Game Home，释放按键/触控；再次 Continue 恢复同一会话。拖动上下屏时 Orbit 让路，空白处和机身仍可在小范围内环视。
- NDS DOM 控制面板保持隐藏。Continue、返回和声音仍走 3D Game Home 与用户激活；隐藏节点只负责程序化打开本地 ROM 选择器。
- Chrome headless 合并负载短测观察到模拟与场景均约 60 fps、模拟速度约 100%、核心约 5.35 ms/帧（单次采样），WASM 约 309 MiB；默认 GTAO 开启。完整验证记录见 `NDS_Integration_Spike.md`。

### 3.16 Controller 3D 按键反馈与点击音

- 新增 `World/Product/ControllerFeedback.js`：`InputRouter.onGameButtons` 的同一组语义 Action 驱动 3D 反馈。Controller 锁上进入 Game Home 后键盘和手柄就会压按键；NDS 只在 Playing 接收这些 Action。失焦、模式切换、手柄断开时的清空也会同步让按键回弹。
- 按压轴取每个按键最薄的局部轴（当前 GLB 为 Y），并令其指向 `Controller_Shell` 中心；行程为按键厚度的比例（默认 `0.22`）。D-Pad 的上 / 右由 ABXY 菱形位置推导（X 在上、A 在右），倾斜轴为面外法线 × 方向，未硬编码世界轴；斜向按住保持单方向最大倾角（默认 `5°`）。
- 弹簧按 PRD 28.5 的指数阻尼形式，以 `1/240 s` 固定子步积分；按下与松开分别使用刚度 `3200` / `900`，阻尼比 `0.45`。按到底是硬限位（约 42 ms，无穿模），松开约 79 ms 回位并越过静止位约 19% 行程形成回弹。
- 新增 `World/Product/ButtonClickSound.js`：独立 AudioContext，以带通噪声 + 下滑三角波实时合成，无音频素材；按下 / 松开、面键 / D-Pad / Start·Select·L·R 音色不同，每次 ±5% 随机音高。声音跟随输入边沿，不等弹簧触底。手柄输入缺少用户激活且 AudioContext 未运行时直接丢弃该声，避免之后集中爆发。
- `ModelAdapter` 以语义键（`a`/`b`/`x`/`y`/`dpad`）导出按键 Mesh，节点名仍只在此集中。销毁时恢复按键静止位姿并关闭 AudioContext。
- 点击音与 NDS 面板的静音开关保持独立（用户确认）。
- 手柄轻震：按下边沿由 `ControllerFeedback` 决定强度（面键 1、D-Pad 0.7、Start / Select / L / R 0.6，乘以默认强度 `0.35`），`InputRouter.rumble()` 以 `dual-rumble` 下发，weak 马达为主、strong 马达仅 25%，默认 `24 ms`；松开不震。只震当前正在提供输入的手柄，纯键盘操作不震；不支持 `vibrationActuator` 的浏览器静默跳过。
- `Controller Feedback` 面板可调行程、D-Pad 倾角、按下 / 松开刚度、阻尼比、点击音开关与音量、手柄震动开关 / 强度 / 时长，并可在任意模式下 Tap 测试单个按键（Tap 测试不触发震动）。

### 3.17 场景细节 S1

- 新增 `Exhibition`、`ProductPlinth`、连续几何生成与 `exhibitionFloor.js`，以 110° 安装态尺寸组织中央底座和左右灰盒；没有加载新模型或贴图。
- 底座顶面保持原支撑高度，地面随底座厚度下移；运行时测量后恢复近闭合姿态和 Controller 矩阵。
- `Stage` 现为连续地面—弧墙，使用原 Plastic010 纹理；地面网格/Halo 进入 TSL，调试 Grid 默认关闭，背景改为暖灰白。
- Hero 调整为 `(0, 2.8, 6.8)` / Target `(0, 0.35, 0.4)` / FOV 31；Play 调整为 `(0, 4.3, 4.9)` / Target `(0, 0.3, 0.35)` / FOV 36，为展组与 Orbit 边界留出空间。
- 宽高比低于 1.35 时隐藏左右灰盒；CameraDirector 以 1.4:1 水平取景作窄屏 FOV 补偿，已接通 World resize。
- `npm run build` 通过；新增 Chrome CDP 验证脚本，覆盖 GPU 编译、241 个装配采样、折叠、高度与矩阵恢复、四机位、16 个 Orbit 边界、窄屏、Replay / Skip 与销毁。
- 用户已调整并确认 S1：底座深 1.61D、高 0.06W，左右灰盒采用新的位置、朝向和比例；复验通过。当前左右展组仍是灰盒，真实配件和标签属于 S2；合并负载性能测量待完成。

### 3.18 场景细节 S2

- S1 已按用户确认布局提交为 `39511cb`。S2 保留该布局、底座参数与镜头，替换左右灰盒内容。
- 新增 `PartsDisplay`：真实完整外壳、D-Pad、ABXY 和静态标签；新增 `ColorDock`：Classic、Retro、Midnight 三套完整 Controller 主题样品（外壳、ABXY、D-Pad 各自配色）及色点铭牌。
- `ModelAdapter.getExhibitSources()` 提供静止坐标快照；`ExhibitSample` 共享只读 GLB Geometry，使用独立变换与材质，不加入输入或装配。
- 抽取独立 uniform 的塑料材质工厂，主机外观参数和 EXR 保持原用途；展示外壳使用实时光照/GTAO，展示按键保留原底色。
- 两张 `ExhibitLabel` CanvasTexture 仅在内容改变时上传；样件改色同步更新 Dock 色点。
- 构建通过（75 modules）；Chrome 检查覆盖原 S1 回归、材质/输入隔离、静态标签、共享几何所有权与销毁。
- S2 最终视觉待用户验收；具体模块、调参入口与验证记录见 [场景细节实施方案第 13 节](Scene_Detail_Implementation_Plan.md#13-s2-实现记录2026-09-24)。

### 3.19 场景细节 S3

- 用户最新灯光/曝光、屏幕粗糙度、背景宽度和 Orbit 参数已提交为 `a5d0f78`。
- 新增 `ExhibitProps`：前左侧实体铭牌、前右侧原创卡带；两张静态标签、自有几何/材质和 Tweakpane 面板进入 Exhibition 销毁路径。
- 两件道具位于底座外并跟随地面高度，避开装配与 Hero 立起路径；窄屏隐藏卡带、保留铭牌。
- 背景墙补高至 16，展区阴影按布局自动扩展，沿用用户灯位、灯强、曝光、网格与光环参数。
- Parts 竖板接入 ektogamat WebGPU transmission 玻璃：`GlassPhysicalNodeMaterial` + Renderer 持有的 `TransmissionBackdrop` 离屏背景；已修复与 GLB 镜头内建透射共享视口纹理冲突的 WebGPU 校验错误。上游无 LICENSE，发布前需授权；玻璃视觉待用户验收。
- 构建（76 modules）、241 个装配与 121 个立起采样、Orbit 屏幕九点遮挡、接地、阴影覆盖、Replay / Skip、纹理静态更新及资源释放检查通过。
- 当前用户扩大后的 Orbit 最近距离会裁切部分机身，既有展组 AABB 与底座有交叠，已单独记录；不声称旧 S1 的全范围不裁切/灰盒互斥结论继续成立。详见场景细节实施方案第 14 节。

## 4. 验证记录

| 检查 | 结果 |
|---|---|
| `npm run build` | 通过 |
| Vite 模块转换 | 65 modules，通过 |
| `git diff --check` | 通过 |
| Controller 塑料 TSL | WGSLNodeBuilder 已生成含噪声、法线梯度与 uv1 Lightmap 的代码；层纹开关、GPU 编译与视觉验收通过 |
| Controller 材质生命周期 | Uniform 调参、原材质恢复、独立面板/材质释放及共享 Lightmap 保留检查通过 |
| 按键清漆塑料 | WGSL 代码生成、清漆 Uniform 开关、5 个按键颜色保留、资源恢复/释放及浏览器视觉验收通过 |
| 本地首页请求 | HTTP 200 |
| 本地 `main.js` 请求 | HTTP 200 |
| 本地 `iphone.glb` 请求 | HTTP 200 |
| GLB Content-Type | `model/gltf-binary` |
| GLB 文件大小 | 1,969,972 bytes |
| GLB 节点 | 40 |
| GLB Mesh | 28 |
| GLB 材质 | 11 |
| 必要节点校验 | 10 / 10 通过 |
| 坐标检查基建构建 | 通过 |
| Runtime Rig 父级与折叠数学检查 | 通过 |
| EXR 解码 | 2048 × 2048、Half Float、Linear sRGB 通过 |
| Controller 装配轴向推导 | Rail Z、Align Y 通过 |
| Controller 装配阶段时序 | 约 1.85s、Reveal/Slide 异向缓动与 Hold 已通过视觉复核 |
| Controller 动画终点矩阵 | 最大元素误差 0 |
| Intro / 产品状态流 | Folded → Unfold → Screen Wake → Assembly → Game Changer → Hero → Ready 已接入 |
| Camera Shot 状态映射 | Intro 与产品模式事件已分离；Folded / Assembly / Hero / Play 已接入 |
| Continue / 返回输入 | Pointer、Enter、标准 Gamepad A → Continue；Escape → Game Home 已接入 |
| Phone UI 资源构建 | `主页面.png` 已输出为独立 Vite Asset，通过 |
| Fold / Screen Wake 状态流 | Fold 第一帧显示 UI；Unfold 驱动模糊翻页；Screen Wake 稳定曝光与焦点，已接入 |
| Phone 屏幕材质控制 | Brightness / Diffuse detail / Roughness 与镜像、旋转、面板对调已接入 |
| Screen Wake 调试 | 时长、停留、自动暂停、独立检查与继续装配已接入 |
| Controller 镂空 | Attaching 隐藏显示层并暴露手机下屏，已接入 |
| Game Changer | Lock 后 Top / Bottom 双屏 Blur、Scale、Crossfade 转场，已接入 |

构建存在一个非阻塞警告：Three.js WebGPU 相关入口打包后主 JavaScript Chunk 超过 Vite 默认 500 kB 提示阈值。当前阶段不做过早拆包，等 NDS Runtime 选型后统一规划按需加载。

## 5. Phase 3 视觉校验结果

以下项目已通过用户视觉校验：

- 点击 `Replay Assembly` 后，产品是否先稳定在 `110°`，Controller 再从画面下方向上进入。
- Reveal 浅弧线、Align 与 Slide 的重叠是否自然，阶段之间不应出现明显停顿。
- 默认 `3°` 对准旋转是否自然；Controller 是否在进入滑轨前已完全对正。
- Slide 是否沿真实纵向滑轨连续压入，没有横向漂移、穿插手机或在安装点二次启动。
- Lock 过冲从不可见的 `0.3%–0.5%` 调整为约 `5%`，回弹幅度已通过视觉确认。
- 动画过程中 Lightmap 是否稳定跟随，阴影没有闪烁。
- 连续 Replay、Entry Pose、Skip / Installed 是否不会累计位移或破坏最终姿态。

当前装配参数作为 Phase 4 Intro 串联的默认基线。

## 6. 已知问题与未决项

### 非阻塞问题

- `@antfu/eslint-config` 已安装，但 `package.json` 仍未提供 lint script；当前基础检查仍是 `npm run build`。
- 当前未配置测试脚本或测试框架。
- 主 JavaScript Chunk 有体积警告，但构建成功。
- Controller Shell EXR 未压缩且约 50.4 MB，会显著增加首次加载时间；视觉确认后再决定是否压缩或降级。
- 当前 Camera Shot 参数已由用户完成视觉校准，并已用于 Screen Wake 与 Phone UI 构图基线。

- Bind Pose `180°` 时整机最低点落到桌面下方 `-0.04463`，即上半屏摊平后穿过桌板。`180°` 只是 Tweakpane 调试姿态，Intro 与 Hero 都不会到达，暂不处理。
- S1 的 Stage 已改为连续地面/弧墙，`width` / `depth` 滑杆上限分别为 40 / 32；新的尺寸、曲率和镜头取景仍需用户视觉确认。

### 尚未决定

- Hinge 自动推导轴向与铰链视觉中间姿态的最终确认。
- 最终 Hero / Play Camera 参数。
- 外部展台模型是否替换当前程序化桌板占位。
- 若清漆高光在验收中显得单薄，是否引入低强度 `RectAreaLight`（取消 HDR 后这是唯一能造出面光源高光的路径）。
- 最终可公开演示的 Homebrew ROM 选型；当前使用用户提供的本地 Platinum ROM 做技术验证。
- pilas-melonds 预编译产物与完整 C++ 构建源码的对应关系。

### 已确认、后续实现

- 三块屏幕 UV 均已确认覆盖完整 `0–1`。
- `ScreenManager` 已实现 Phone Mode、Controller 装配、Game Home 与 Playing 的三屏材质和可见性规则。
- Screen Wake 与 Phone UI 已接入 `docs/img/主页面.png`，不再沿用 GLB 原始屏幕材质。
- `NDSRuntime` 已同时接入独立验证页与主产品 Playing；两块真实 NDS Canvas 已绑定到 3D 屏幕。
- 运行时已使用等比 letterbox 适配屏幕，并接入对应的 3D 触控坐标换算。
- Phase 4、Controller Shell 与按键清漆材质均已由用户确认。

## 7. 当前工作区状态

本轮 Phase 4 主要改动为：

- 新增 `src/js/World/Directors/IntroDirector.js`。
- `World.start()` 自动启动 Intro，`Experience` 不再提前把模式写成 Ready。
- `ControllerAssembly` 增加供 Intro 使用的可见性、跳过和完成回调边界。
- 新增 `CameraDirector`，接入四组镜头、状态映射、Orbit 锁定与 Tweakpane 取景工具。
- 新增 `ScreenManager` 与 `InputRouter`，接入独立产品模式、Controller Game Home、Continue 和 Escape 返回流。
- `State` 已将 Intro 编排与产品模式拆分为 `introState`、`productMode`。
- `ScreenManager` 已接入双联 Phone UI 分屏采样，`IntroDirector` 已接入可重播的 Screen Wake 时间线。
- 新增 `src/shaders/screenEffects.js`，通过 TSL 实现角度驱动 Fold 效果和 Game Changer 双屏转场。
- 原先的 `游戏模式主页面.png` 已由动态 Game Home 上屏 Canvas 替代；Controller 下屏 UI 与上屏共享栏目状态。
- 将原 812 行 `ScreenManager` 拆分为模式协调器、`PhoneScreenSurface` 与 `ControllerDisplay`，保持 `World` / `IntroDirector` 公开调用不变。
- `src/js/World/` 已按 `Product/`、`Directors/`、`Screens/`、`Input/` 分层，根级只保留 `World.js` 作为装配入口。

本轮场景环境改动为：

- 新增 `src/js/World/Environment/Environment.js` 与 `src/js/World/Environment/Stage.js`，`World` 只负责装配与销毁。
- `Renderer` 新增 `setExposure()`；`ModelAdapter` 新增 `getStageSurfaceWorldY()` 与 `STAGE_SURFACE_MODEL_Y` 常量。
- HDR 实验已完整撤回：`sources.js`、`Resources.js` 恢复原状，`Environment.js` 中的 `environment*` 死参数已移除。`public/hdr/studio_small_03_1k.hdr` 保留在磁盘上但不被加载。
- 同步更新 `docs/Scene_Lighting_Stage_Plan.md` 与 PRD 第 29 节。

## 8. 下一步

2026-09-23 用户确认：此前全部待验收项目通过。上文待验收描述保留为当时的验证记录，以本次确认及文档顶部状态为准。

Phase 5 验收结论：

2026-09-23 用户确认：NDS 上下屏映射、整数像素延展背景、连续十分钟游玩、声音与音画同步、触控、真实 Gamepad、暂停恢复及最终画面呈现均符合预期，Phase 5 完成。

Phase 6 验收结论：

2026-09-23 用户确认：ABXY 下沉 / D-Pad 倾斜弹簧、合成点击音与手柄轻震验收通过，默认参数即为当前基线，Phase 6 完成。点击音与 NDS 静音开关保持独立。

后续：

1. 进入 Phase 7：性能、兼容性、Loading 与视觉精修。
2. IndexedDB 持久存档仍为演示增强项，按演示需要再实现。
3. 2026-09-24 用户要求提交当前改动并推进 S3：用户参数已提交为 `a5d0f78`，S3 已实现并通过工程验证。下一步验收铭牌、原创卡带与阴影效果，再进行性能/Loading 收尾；S4 动态说明保持可选。默认参数、调试入口和验证边界见 [场景细节实施方案](Scene_Detail_Implementation_Plan.md) 第 14 节。

本轮实现、测试结果和使用方法见 `docs/NDS_Integration_Spike.md`。固定上游版本为 `7adc554ce1dc5318fef3797e8f00a6e9286dac3b`；ROM 仅本地验证，不进入生产构建。

## 9. 页面操作栏与交互配色（2026-10-04）

- `ProductToolbar` 提供开始/继续试玩、重播装配、操作说明；Intro 显示跳过动画，Playing 收起配色与重播，仅保留说明、声音与返回展区。游戏加载期间提供取消启动，并禁用配色。
- 右侧三个 Controller 样品、承托面与主题标签可点击换色；底栏提供同一套配色按钮，窄屏隐藏展组时仍可操作。悬停承托面高亮，选中主题带下划线，DOM 使用 aria-pressed 同步状态。
- `ControllerThemes` 只更新主机外壳和按键已有材质的颜色，保留安装态 EXR、uv1、微表面、清漆及按键反馈。0.4 秒过渡可中断，Classic 恢复各按键初始底色；模式变化时精确收束，减少动态效果时立即换色。
- 页面 UI 通过 EventBus 发出操作意图，World 路由到既有 Intro / NDS / 输入组件；NDSPlayer 发布 `nds:state` 供底栏展示启动、暂停与音频状态。说明弹窗暂停游戏或取消启动，释放并暂时屏蔽键盘/手柄/触控，关闭后由访客显式继续。
- 已通过 `npm run build`、当前 WebGPU 页面中的三色切换、真实样品点击、说明关闭/焦点恢复、试玩启动与暂停返回，以及手机竖/横屏按钮边界检查。独立模块检查覆盖快速换色、精确 Classic 恢复、减少动态效果、加载取消/Replay/销毁后的迟到结果隔离及监听清理。
- 本轮未重新验收长时间 NDS 音画同步和真实手柄；用户现有调试、灯光、资源与屏幕 UI 改动保留，未自动提交。最终布局与颜色请在支持 WebGPU 的最新版浏览器中视觉验收。

## 10. 页面视觉、Loading、NDS 进入转场与像素印花（2026-10-04）

- DOM 页面采用苹果官网风格的系统字体、黑白灰层级、半透明白色面板和蓝色胶囊按钮；操作说明同步精修，保留原有响应式和键盘焦点逻辑。
- `LoadingScreen` 提供双屏品牌图形、真实资源进度、图形引擎/模型与材质/展区三个阶段、完成淡出和失败重试。资源进度综合各请求的传输与完成状态；Loading 覆盖场景管线预编译与首帧渲染，随后启动 Intro。计时器与监听随入口 HMR 清理。
- `GameEntryTransition` 在上屏用 TSL 圆形遮罩收拢（默认 0.48 秒）、保持黑屏等待首帧，再展开（默认 0.62 秒）。UV 物理比例由 Mesh 推导，Home 与 NDS 材质共享遮罩。首次加载和暂停恢复均经过转场；预编译期间的旧启动请求也会失效。
- NDS 启动期间仍保持 Game Home 模式并屏蔽游戏输入；Esc、取消、失焦、Replay、错误和销毁会停止时间线/音效并恢复对应画面。展开结束后才切入 Playing。减少动态效果时使用 0.08 秒收拢/展开。
- `GameEntrySound` 合成下滑音和上行双音，跟随 NDS 声音偏好；首次解锁需要有效用户点击/按键，手柄不能自行解锁音频。音频不可用不阻止游戏，停止和销毁会回收声音节点与 AudioContext。
- `ButtonPrint` 生成共享 5×7 点阵 ABXY 图集，将印花投影到键帽顶面；局部坐标和协向量换算保留非均匀缩放及按压跟随，限制侧壁/底面不显示字母。主机、Parts 和 Dock 共用字形，浅键帽深字、深键帽浅字，保留清漆和原材质底色。Tweakpane 提供印花大小/不透明度和进入转场时长。
- 用户反馈 Classic 奶白键帽的印花偏淡后，浅键帽改用更深墨色并提高缩小点阵的覆盖率；只在深色印花像素内提高粗糙度、降低清漆与镜面反射。键帽其余表面与 Retro / Midnight 的浅字保留原响应，主机与展示件同步改善。构建及三套配色的 WebGPU 检查通过，最终清晰度仍由用户视觉验收。
- `npm run build` 通过；浏览器中验证了 Loading、像素字形、深浅配色、真实 NDS 启动、取消与继续，以及 291 CSS 像素宽度下按钮无横向溢出。模块检查覆盖收拢/初始化/ROM 读取/展开各阶段的取消、Replay、销毁，展开时失焦、会话恢复和 GSAP Promise 收束。音效听感、转场节奏及字形大小仍需用户在支持 WebGPU 的最新版浏览器中验收；未重测真实手柄与长时间音画同步。

## 11. 分模块提交与程序化 NDS 触控笔（2026-10-04）

- 触控笔实现前，现有未暂存功能按像素印花（`5bb6408`）、操作栏与配色（`5118a00`）、NDS 进入转场（`cca45a9`）、Loading（`4aeca6a`）、本地游戏配置（`fbfc08e`）、文档（`4f9f0f4`）分开提交。用户原先暂存的 Debug / Environment 内容保持原状，未引用的 AirPods 模型与 worktree 文件保留。
- 按用户修正，`NDSStylus` 改为常驻鼠标伴随模型，参考迷你 Apple Pencil 生成连续白色笔身、锥形笔尖与圆润尾盖，无外部模型或贴图。在 Intro、展区、游戏及操作栏中跟随鼠标，不再绑定下屏。点击保留轻微落笔和蓝色波纹。
- 笔尖严格对准鼠标 CSS 坐标，笔杆使用速度驱动的阻尼弹簧：移动时稍有惯性倾斜，急停后小幅度回摆并收敛。固定子步长、速度限幅和角度限位防止低帧率或重新聚焦时剧烈晃动；减少动态效果偏好关闭惯性摆动。
- 小型透明画布与主渲染器共享 WebGPU Device；独立正交镜头和灯光保持固定像素尺寸与白色材质。仍由 Experience 唯一循环驱动，画布不拦截点击，鼠标可继续操作 DOM、展区和 NDS。原 InputRouter 完整保留，不新增任何下屏映射。失焦后模型停留、释放落笔并恢复系统光标，销毁清理监听、DOM、GPU 资源和共享 Device 的次级渲染器。
- 用户继续校准：笔身长度和粗细整体放大三倍，默认 `324px / 17.4px`，姿态改为竖直向右倾斜 `12°`；放大后同步收紧惯性摆幅，保留轻微急停回摆。Tweakpane 的 `NDS Stylus` 提供开关、长度/粗细、倾角、晃动强度和阻尼。模块检查通过：常驻与像素对齐、移动惯性、急停过冲与收敛、长帧稳定、快速点击、手指输入隔离、失焦/重入/缩放、减少动态效果和监听/DOM/GPU 释放。本轮触控笔作为独立功能提交（`f38751d`）。
- 用户反馈横向急停回摆反向后，修正水平速度到绕 Z 轴角度的符号：向左移动时笔杆稍向右滞后，停止后先向左摆回；向右移动时对称处理，再轻微回弹归位。尺寸、静止倾角和晃动幅度沿用当前基线。
- `npm run build`（91 modules）与 `git diff --check` 通过。当前 WebGPU 页面确认了常驻外观、下屏以外跟随、三倍尺寸和接近竖直姿态，操作栏/菜单点击穿透及原生说明弹窗中的跟随显示；无新增浏览器错误。最终大小、白色材质与急停回摆手感请用户在支持 WebGPU 的最新版浏览器中视觉验收。

## 12. 地面卡带封面（2026-10-04）

- 按用户最新要求，卡带封面直接使用 `public/img/cover.png`。在 `sources.js` 注册 `gameCardCover` 纹理，Exhibition 传给 ExhibitProps，以 sRGB、各向异性采样和等比贴图展示完整封面；保持卡壳、触点与布局，贴图进入道具销毁路径。
- 已删除 `marioKartCardCover` 程序绘图模块，卡带不再创建 CanvasTexture；铭牌及其他展板标签仍沿用现有实现。
- `npm run build`（91 modules）及 `git diff --check` 通过；生产目录 `dist/img/cover.png` 与源图 SHA-256 一致。当前 WebGPU 页面已显示图片封面，无浏览器错误；最终显示效果请用户在支持 WebGPU 的最新版浏览器中视觉验收。

## 13. 试玩范围、配色记忆与 AirPods（2026-10-04）

- 六张封面仅 game0 可玩。ControllerDisplay 集中检查封面、收藏库、下屏、键盘/手柄和底栏试玩请求；其他游戏显示短暂可访问提示“暂不可玩，目前仅开放第一款游戏。”，不触发文件选择、转场或模拟器。
- ControllerThemes 在 Intro 首帧前恢复 `iphone-duo.controller-theme`，接受 Classic / Retro / Midnight，并在用户切换后保存。精确保留 Classic 多材质按键底色；无效存储值和存储权限异常不阻断展示或切换。
- 按用户最新修正接入 `/glb/airpods_pro.glb`，ExhibitAirPods 使用 `case / cover / left_earphones / right_earphones` 清晰节点。新版模型已闭合平躺，左组保留导出姿态，右组立起并让盖子直接绕用户原点沿局部 X 打开 115°，不重定位盖子；盒内耳机保留原安装位置。删除盒宽归一化和分组倍率，两组按用户最终要求共用 2.5 倍缩放，按箭头移至光圈外左下 `(-1.23W, +0.86D)` 与右下 `(+1.32W, +0.907D)`。窄屏隐藏附件，盖角/摆放调参与去重资源回收由 Exhibition 协调。
- 模块检查通过六张封面的试玩限制、通用启动/键盘确认/加载状态，以及三套配色恢复、Classic 精确还原、无效值和存储异常。新 GLB 检查通过两组接地、避开底座/卡带、窄屏隐藏及 23 个几何、22 个材质、7 个纹理对象各释放一次。
- `npm run build`（92 modules）与 `git diff --check` 通过；生产目录使用原样复制的 AirPods Pro 资源，旧模型路径与节点映射已移除。WebGPU 页面验证了非开放游戏提示、刷新恢复 Retro 配色、game0 真实双屏输出与暂停继续，以及 1262×711 陈列和 390×844 附件隐藏，无浏览器错误。最终模型比例、材质与摆放请用户在支持 WebGPU 的最新版浏览器中视觉验收。
- 最新闭合模型与箭头布局再次通过 `npm run build`（92 modules）和差异检查。CPU 检查确认闭盒节点姿态保留、两组原始尺寸基准与统一 2.5 倍倍率、盖角 0–130° 时原点不动、几何接地、可见 Mesh 均在光圈外，以及 52 个资源各释放一次。1920×911 WebGPU 画面检查确认圈外左下/右下摆放与完整盒旁耳机，未出现浏览器错误；最终位置和观感仍由用户验收。
- 用户要求将未暂存改动分模块提交：触控笔 `f38751d`、图片卡带封面 `011376a`、game0 试玩限制与封面排序 `f5c690b`、配色记忆 `73ea59f`、AirPods Pro 陈列/盖角/统一比例与圈外位置 `5ca6fe6`，文档单独提交。共用文件按功能拆分；原先暂存的 Debug / Environment 差异经逐次校验保持原状，`.worktrees/` 不纳入产品提交。
- 用户反馈散放耳机与盒身重叠后，摆放改为按盒身最前表面与耳机最后表面留出 0.45 个盒宽，并向前右方微调。接地测量改用可见几何的精确顶点，避免旋转后的保守包围盒让耳机悬空；统一倍率与展组布局坐标沿用当前值。
- 此修正通过 `npm run build`（92 modules）与差异检查；缩放 1 / 2.5 / 4、朝向 -43° / -18° / 7°、盖角 0° / 115° / 130° 的组合检查确认散放耳机接地、与盒身及盖子无交叠。1920×911 WebGPU 画面确认耳机与盒身间有可见留白，无浏览器错误；最终间距请用户在支持 WebGPU 的最新版浏览器中视觉验收。

## 14. 材质与灯光首轮（2026-10-05）

- 按用户最新范围，只优化材质和灯光；保持镜头、构图、展品布局、底座几何与支撑高度，以及产品模型和 Controller 安装矩阵。
- Environment 增加宽幅主面光与弱中性 RectAreaLight，降低原冷蓝补光占比，保留原主光、2048² 投影和 GTAO。按用户“偏暗、泛黄”反馈，背景改为 `#f3f5f7`、曝光 1.03，主面光改为白色、强度 5，半球填光 1.9。地面、底座和展示支座同步改中性底色，局部暖色仅保留在底缘灯带。没有重新接入 HDR / scene.environment；LTC 纹理按实例保存和释放，面光源不投影。
- ProductPlinth 增加独立 TSL 微法线与小幅粗糙度变化，使用局部坐标补偿世界缩放和导数过滤。原灯带下/外方补四条窄面光源，与 edgeGlow 联动提供直接暖光；没有引入 GI、Bloom 或地面反射。Tweakpane 的 `Plinth Surface / Warm Spill` 可独立开关和调整微表面、暖光。
- 地面继续使用已有 Plastic010 PBR，粗糙度乘数 0.55、法线强度 0.07；用户确认中性亮白与亮度合适后，将网格不透明度从 0.1 上调为 0.21，Halo/细环保持首轮强度。Parts 玻璃改为中性白、透射 0.96、粗糙度 0.06、IOR 1.49，并降低模糊和色散，保持现有透射管线及几何厚度。
- `npm run build`（94 modules）与 `git diff --check` 通过；当前 WebGPU 页面完成面光源和微表面首次编译、HMR 后重新进入展区及三套配色检查，没有新增浏览器警告或错误。独立源码核查与 CPU 检查通过 LTC 归属清理、暖光朝向/地面以上高度、edgeGlow 联动和微表面尺度。最终磨砂细节、暖光强度与亚克力观感由用户在支持 WebGPU 的最新版浏览器中验收；未自动提交，无关工作区内容保留。

## 15. HTML 产品页头与画布分区（2026-10-05）

- `ProductHeader` 提供轻薄半透明导航、双屏品牌图形和蓝色试玩按钮，产品、装配演示、操作指南均接入既有流程；主按钮随 Intro / 启动 / Playing 切换为跳过、取消或返回。装配重播在 Intro、启动和 Playing 禁用，原生按钮保留键盘和音频用户激活边界。
- 操作指南经 `product:help-request` 共用底栏的模态说明。打开时暂停游戏或取消启动、暂时屏蔽游戏输入，关闭后将焦点还给本次实际触发按钮。页头、文案和说明的 DOM / 监听由 World 统一销毁。
- 按用户后续反馈，页头内容行压缩为桌面 48px、小屏 44px；品牌与导航间距收紧，横向容器取消固定宽度上限，两侧采用 3vw、20–64px 的流式边距（小屏另行收紧）。调试面板位于页头下方。
- 页面改为纵向 Flex 分区，页头在文档流中占位，主 Canvas 从页头下方直接填满剩余动态视口高度。Sizes 通过 ResizeObserver 取得画布实际尺寸，保留窗口 resize 更新 DPR；Renderer 使用 `setSize(width, height, false)`，只更新像素缓冲。镜头、后处理、透射目标沿既有 resize 链路同步，触控仍取画布实际边界，鼠标伴随笔保持全页面坐标。没有修改展台几何、展品布局或灯光。
- 宽屏左侧加入 `ProductIntroCopy` 的短标题与说明，无卡片背景、无额外按钮、不拦截交互；仅 Ready / Game Home 且未加载游戏时显示。视窗至少 1600×650、宽高比至少 2:1 时出现，避免较窄画幅里的左展板被文字覆盖。
- `npm run build`（98 modules）与 `git diff --check` 通过。WebGPU 页面确认页头重播/跳过、指南关闭焦点恢复、启动取消与暂停，以及 1920 CSS 像素宽度下页头铺满、宽屏文案出现；355 / 291 CSS 像素宽度下按钮无横向溢出，画布顶缘与页头底缘一致、底缘与视口一致。没有浏览器错误；既有模拟器运行日志与 Vite 大 chunk 提示不作为渲染失败。本轮未重测长时间游玩与真实手柄，最终版式请用户在支持 WebGPU 的最新版浏览器中视觉验收；未自动提交。

## 16. 手柄内部元件展台（2026-10-05）

- 接入用户新增的 `/glb/detail.glb`，`InternalComponentsDisplay` 在左展板前、闭合 AirPods 后的红框区域生成白色矮台，三件元件按参考图从左到右为 Memory / Mainboard / Processor。原 GLB 保留，三个重叠的节点分别按包围盒居中、等比适配并落在独立承托面上。
- 默认位置按用户最新截图校准为 `(-1.5W, +0.24D)`、Yaw 16°、整体 Scale 1.21；整体倍率应用前的顶板为 `0.91W × 0.32W`、前缘高 `0.06W`、倾角 30°。实体楔形支座跟随倾角收缩前后投影，正面标签贴在实际支座表面。Tweakpane 的 `Internal Components` 提供开关、X / Z / Yaw、Scale 和 Deck angle；Exhibition 统一协调窄屏隐藏、阴影边界与销毁。首次实现为静态展品，不参与输入命中；后续悬浮调整见第 21 节。
- 按用户最新要求，统一提高全部展区标签的纹理分辨率并恢复原字号：`ExhibitLabel` 默认画布宽度由 1024 提升至 2048 像素，薄标签最小高度由 128 提升至 256 像素，覆盖 Parts、ColorDock、产品铭牌与内部展台的两张标签。内部标题 / 副标题 / 元件名恢复为 24 / 12 / 26，铭牌恢复原两行排版，元件名标签高度恢复为 `0.031W`；两张内部标签各向异性保持 16，元件名继续使用透明混合、关闭 alphaTest 与深度写入以平滑文字边缘。本次调整另通过 `npm run build`（99 modules）与 `git diff --check`，WebGPU 页面确认全部五张标签及内部原字号，无浏览器错误；以下记录保留为此前展台实现的验证结果。
- 原纹理与材质类型保留为 Standard / Physical Node Material，包括 Memory 的清漆。CPU 正面原金属度为 1，在既有无 IBL 环境中近乎发黑，仅将展示副本金属度调为 0.45，让银色顶盖与丝印可读。固定局部矩阵的展品在阴影测量前强制更新世界矩阵。
- 真实 GLB 的 CPU 检查通过三个元件居中/接地、5–30° 全范围支座与顶板贴合且不穿边、铭牌面间距、窄屏和可见性开关，以及包含调角旧几何在内的 57 个受监测资源各释放一次。
- `npm run build`（99 modules）与 `git diff --check` 通过，生产目录 GLB 与源资产 SHA-256 一致。1920×855 WebGPU 画面确认三件元件、白色支座、标签与银色 CPU；390×844 确认窄屏隐藏并恢复桌面画幅，无新增浏览器错误。最终比例、位置、材质与标签清晰度请用户在支持 WebGPU 的最新版浏览器中视觉验收；未自动提交。

## 17. 分模块提交与左侧文案放大（2026-10-05）

- 按用户要求，先将现有改动拆为六个提交：材质与灯光 `63c3522`、页头与画布分区 `4c973b3`、左侧介绍文案 `2704afa`、内部元件展台 `45345c6`、标签清晰度 `31902c0`、文档 `9ef2a94`。共用文件按功能分开暂存，`.worktrees/` 未纳入提交；提交过程中新增的 `cover2.png`–`cover5.png` 当时保留为未跟踪资源。
- 提交后，将左侧 HTML 文案整体放大 1.5 倍：宽度 220 → 330px，品牌小字 10 → 15px，标题 34 → 51px，正文 13 → 19.5px，段间距 18 → 27px。文字内容、字重及显示条件沿用现有值；低矮宽屏根据视口高度上移，防止正文覆盖前景元件展台。本次放大当时作为后续改动保留，现已独立提交为 `01e1fca`。
- `npm run build`（99 modules）与 `git diff --check` 通过。1920×911 / 1920×855 与 1600×650 WebGPU 画面检查确认字号和布局；1600×650 下文案底缘约为 343px，与前景元件展台留出间隔。浏览器无新增错误，临时视口覆盖已恢复；最终版式仍请用户在支持 WebGPU 的最新版浏览器中视觉验收。

## 18. 卡带展台与性能收尾（2026-10-05）

- 新增右侧 `GameLibraryDisplay`，cover2–4 为白色斜台上的三张竖卡，cover5 散放在台前；原 cover 卡带保留。封面资源按实际小写文件名声明，模型/图片原文件未修改。展台窄屏隐藏并参与阴影边界；51 个自有资源/实例对象各回收一次。真实 GLB 的 CPU 检查确认接地、50–75° 支撑与展板贴合、图片完整等比、散卡与原卡/盒身/盒盖有间距。
- 提取共享卡带工厂，每卡八个触点改为一组 InstancedMesh；五张卡的绘制对象总数减少 35 个，每个场景/阴影通道均受益。
- 按用户最终阶段要求，Debug 默认关闭，GUI、ModelInspector 的坐标轴/网格/包围盒以及灯光辅助对象不再构造。开发仅 `?debug` 按需加载 Tweakpane；主包由上轮 1,746.21 kB 降至 1,611.75 kB，148.25 kB 的 GUI 独立 chunk 不随正常首屏请求。显式调试时，隐藏辅助对象也不再做包围盒或变换计算，面板收起停止读数刷新。
- Loading 内覆盖真实屏幕模式和实际离屏管线预热；临时关闭 Mesh 视锥剔除，防止 Hero 新露出的展品首次编译，结束后还原 Folded 位姿/镜头。仅编译一个有光照的阴影接收物作为 seed；GPU 阴影附件先初始化再刷新 seed 绑定，以稳定首次深度纹理 generation，其余材质直接由实际管线预热，避免整场额外编译默认 ACES 变体。加载进度覆盖准备过程。NDS 进入时复用已准备材质，保留取消、Replay、失焦和销毁的 generation 检查。
- 每帧统一世界矩阵，透射/GTAO/主通道复用；玻璃捕获不再重复提交阴影，真实主通道负责更新。阴影缓存跟踪可见投影物、材质、实例/几何、灯光/层/投影变化；桌面 Dock 保留浮动，因此仍逐帧更新阴影，窄屏隐藏 Dock 后静止帧可复用。鼠标伴随笔保留惯性、落笔和波纹，停稳后复用透明画布；窗口隐藏停止提交渲染，静止折叠参数不再重复计算。
- 原有高分辨率标签、DPR、GTAO 32 样本/全分辨率、2048² 阴影、材质和产品动画保持。`?performance` 仅开发按需启用，记录加载阶段、帧间隔 P95、CPU 更新/渲染提交耗时和 draw calls；CPU 提交耗时不作为 GPU 执行耗时，也不把缓存请求计数当作实际阴影 pass 数。
- `npm run build`（102 modules）与 `git diff --check` 通过。1920×806 / DPR 1 的本地 WebGPU 采样中，Folded、Unfold、Wake、Assembly、Game Changer、Hero 与静止 Game Home 约 60 FPS，帧间隔 P95 16.8–17.0 ms；试玩最近采样约 59 FPS。最小阴影 seed 版本一次加载为 28.30 s，首次实际 GPU 管线准备仍占约 26.68 s，不能把此结果当成网络冷缓存或所有设备的启动承诺。390×844 下无横向溢出，展品隐藏后 Game Home 为 68 draw calls，静止阴影复用并能恢复桌面展区。
- 浏览器验证首次试玩、Esc 暂停、恢复、启动中取消、工具栏返回、重播与跳过通过，未出现新增 JS / WebGPU 错误。关闭调试后的初始化、销毁、资源 ownership 与取消链只读复核通过。最终展台比例、封面清晰度与动画观感仍请用户在支持 WebGPU 的最新版浏览器中视觉验收；功能提交记录见第 19 节。
- 用户后续调整右侧卡带展台：整体 Scale 1.1 → 0.825（原尺寸 75%），Yaw -12° → -27°（从 +Y 俯视顺时针再转 15°）。中心与板角保留，竖卡、底座、标签及台前新增散卡共用父级变换，接地与阴影边界继续由现有布局流程协调。`npm run build` 和 `git diff --check` 通过；1920×806 WebGPU Hero 画面已确认缩放与旋转，无新增浏览器错误，最终观感由用户验收。
- 用户再次微调后移：展台中心 Z 从 `+0.05D` 改为 `-0.10D`，沿世界 Z 负轴移动 `0.15D`；三张竖卡、底座、标签与新增散卡一起移动，大小、Yaw 和板角沿用当前值。PRD 默认中心同步，构建与差异检查通过；1920×855 WebGPU 画面确认后移及与配色展台的间距，无新增浏览器错误。最终间距请用户在支持 WebGPU 的最新版浏览器中视觉验收，本轮未提交。

## 19. 本轮按功能提交（2026-10-05）

- 左侧文案 1.5 倍字号和布局：`01e1fca`。
- 默认关闭调试面板、辅助几何与隐藏读数计算：`8f0b587`。
- 卡带展台、共享卡带工厂与四张新增封面，包含最终 75% 比例和顺时针 15° 调整：`b1a34dc`。
- Loading 内实际管线预热、阴影缓存、统一矩阵更新与按需性能采样：`a38f22b`。
- 触控笔停稳后复用画布、静止屏幕折叠/Wake 参数去重：`6dc71db`。
- PRD 与进度文档单独同步。共用源码按改动块拆分暂存，保留各模块依赖完整；`.worktrees/` 不纳入提交，未推送远端。

## 20. 左侧介绍区参考图调整（2026-10-05）

- `ProductIntroCopy` 保留原品牌和正文；标题首行加重为黑色，第二行“更多可能。”使用深蓝至亮蓝渐变。下方新增双屏扩展 / 更大的游戏视野、模块化设计 / 自由装配组合、丰富主题 / 打造专属风格三列介绍，采用圆底线条 SVG 图标及淡竖分隔线。图标为装饰，特点是静态语义列表，不新增按钮、资源请求或事件监听。
- 常规宽屏保持 330px 宽和 51px 标题，整体上移并收紧段间距；720px 以下低矮画幅用 282px 宽、42px 标题及更小图标，给下方元件展台留出空间。沿用 Ready / Game Home 的显示条件、窄屏隐藏及 `pointer-events: none`，整体 DOM 与监听仍随 World 销毁。
- `npm run build`（102 modules）和 `git diff --check` 通过。1920×855 视窗下文案底缘约 432px；1600×650 下约 335px，三列文本均无溢出，并在 WebGPU Hero 画面中确认与元件展台分开。390×844 下文案隐藏、无横向溢出，临时画幅覆盖已恢复。浏览器无新增错误，最终排版仍请用户在支持 WebGPU 的最新版浏览器中视觉验收；本轮未提交。
- 按用户后续要求放大图标并将底部三列各自左对齐，首列与正文左缘一致：桌面圆底 40 → 52px、SVG 22 → 30px；低矮画幅圆底 32 → 42px、SVG 19 → 26px。收紧功能区上方间距并将低矮画幅再上移 6px，文案底缘分别约为 438px / 333px；三列无溢出，构建和浏览器检查通过，无新增错误，临时画幅已恢复。

## 21. 内部元件轻微悬浮（2026-10-05）

- Memory / Mainboard / Processor 改为悬浮在各自承托面上方，展台、承托面和标签固定。整体倍率应用前，沿倾斜展板局部 +Y 抬升 0.028，起伏幅度 0.0045、角速度 0.9 rad/s（周期约 7 秒），相邻元件错开 1.7 rad；姿态和 GLB 固定导出矩阵保持。
- Exhibition 使用现有唯一循环传入绝对秒数，仅在展组与元件可见时更新三个外层组的位置。没有新增时间线、事件监听或 GPU 资源；既有阴影 tracker 捕捉世界矩阵变化，包围盒余量覆盖完整浮动范围，不逐帧通知布局。销毁时清空元件引用。
- 真实 GLB 的 CPU 检查覆盖完整周期，最小承托面法向间隙为局部 0.0245，当前世界倍率下约 0.0753，无穿台且模型原矩阵保持。`npm run build`（102 modules）与 `git diff --check` 通过；1920×855 WebGPU 页面确认悬浮展品、固定展台和标签，无新增浏览器错误。最终高度、起伏幅度与观感请用户在支持 WebGPU 的最新版浏览器中视觉验收；本轮未提交。

## 22. 首屏纹理与素材减重（2026-10-28）

- 用户明确要求减小 Lightmap、标签及离屏纹理占用。原始素材保留，新增 `public/optimized/` 派生副本和带 SHA-256 的清单；Lightmap 在线性浮点域面积降采样为 1024² HALF / ZIP EXR，保留 uv1、flipY、色彩空间及强度。内部元件与植物仅缩小内嵌图片到长边上限 512，非图片 bufferView 字节、节点、变换和材质定义保持。
- 手机 UI 与 Game Home 参考图保持尺寸、改无损 WebP；六张封面等比长边上限 1024、WebP quality 90。11 项处理素材从 74.83 MB 降至 7.83 MB，全部 21 项首屏静态资源从 83.31 MB 降至 16.31 MB，不含 JS / CSS / 后续 WASM / ROM。sources 统一引用新副本；构建排除这 11 项原件，仍排除本地 ROM，其它公共文件维持原行为。
- ExhibitLabel 默认 2048 → 1024、短标签最低 256 → 128，逻辑字号和几何不变。AO 全分辨率降噪目标改为 R8 单通道，保留原样本数、法线与深度预通道；玻璃捕获比例 0.75 → 0.5，仍为 HDR + mipmap。主画面的 HDR、4× MSAA 与其深度附件、2048² 阴影保持，不把运行时 depth 当可压缩图片处理。
- `node scripts/verify-textures.mjs`、`npm run build`、`node scripts/verify-textures.mjs --dist`、`node scripts/verify-nds-mapping.mjs` 通过；生产 preview 已确认 11 项副本均按清单哈希正确提供。重生成仅需本机 ImageMagick 和现有 Three.js，不增加 npm 依赖。浏览器复测及原始对照材料见 `docs/TEXTURE_OPTIMIZATION_2026-10-28.md`，最终标签清晰度、元件丝印、Lightmap 与玻璃观感由用户验收。本轮未提交。
- 同尺寸 WebGPU 浏览器复测：Needle 44 项纹理列表约 239.5 → 129.6 MiB（-45.9%）；Three.js 59 项纹理跟踪约 357.0 → 231.6 MiB（-35.1%，口径不同不混用）。GPU 降噪目标确认为 R8，主画面 4× MSAA / depth24plus 保持，稳态仍约 60 FPS / 537 draws；Hero / Play 对照及生产首屏渲染通过，未捕获新增 JS / GPU 错误。本机初始化前后均约 38.8 s，首次 warmup 仍占约 36 s；本次已确认内存与下载收益，但不能宣称解决首次管线准备等待，后者需单独优化。

## 23. 首次材质与渲染通道准备定位（2026-10-28）

- 新增独立 `scripts/profile-preparation.mjs`，通过临时 Vite 的内存转换挂接真实 NodeBuilder / GPU 管线 / 队列完成标记；仅在独立 Chrome 中注入，不修改应用或 node_modules。报告与生成的 WGSL 保存在指定临时目录，完整方法、口径和材料见 `docs/PREPARATION_PROFILE_2026-10-28.md`。
- 两次同步基线初始化 38.22 / 35.09 s，首次 warmup 36.34 / 33.35 s；三大通道分别新增背景捕获 44、GTAO geometry 39、带 GTAO 主画面 45 个 GPU 管线，另有 24 个阴影管线。法线预通道虽只输出几何法线，实际 WGSL 仍包含完整物理光照；约 55.8 KB 的外壳法线 shader 与主画面接近，是已确认的冗余。
- 配色样品按键的 NodeBuilder 重复最多，主机清漆按键约 70–72 KB / 片元变体，玻璃约 71 KB；但不把源码大小或并行 Promise 延迟当成单材质驱动编译耗时。只关闭背景捕获初始化约 17.68 s，旁路完整 AO 管线约 21.82 s，仅简化按键约 34.24 s；支持先改跨通道准备，而不是优先砍按键画质。
- 实际管线异步请求、等待收敛后跨帧完整重绘的独立诊断初始化约 6.44 s、首次 warmup 5.14 s；之后恢复同步基线仍需 35.09 s。最终 warmup 绘制计数与基线相符，无捕获的 JS / WebGPU 错误。这个 backend 私有钩子实验不是正式修复，应用当前启动流程未改；正式异步准备仍需覆盖 MRT / AO context、阴影附件、透明通道、首帧完整性及取消 / HMR 销毁验收。本轮未提交。
- 补充逐条串行创建管线并排除自身排队的服务计时：首次主画面约 15.65 s、背景捕获 13.58 s、法线预通道 5.30 s；主机按键族累计约 7.59 s、展示按键族 6.61 s、AirPods 3.44 s，玻璃本体单管线约 0.68 s。该时间为驱动完成墙钟，不是稳态 GPU 帧耗时。轻量法线 override 虽将该通道 39 → 12 个管线、2.05 MB → 45 KB 片元源码，总初始化约 35.76 s，未明显改善；因此不夸大这项的单独首屏收益，仍优先正式异步准备与背景变体控制。

## 24. 真实管线异步准备正式接入（2026-10-28）

- 按用户确认实施收益最高的 P0，不继续叠加未经验证的背景裁剪或材质降级。Renderer 持有新增 `PipelinePreparation`，仅在真实帧同步提交栈内适配 Three 原生异步材质管线入口，立即恢复原属性；并行等待、检查错误状态、跨帧强制重绘阴影/透射/GTAO，零新管线且 GPU 队列完成才放行，保留阴影 seed 与深度 generation 稳定步骤。显式校验 Three.js r186 / WebGPU，升级须重新验证私有接口。
- `World.preparePresentation()` 保留 Phone / Game Home / Playing / Folded 顺序、剔除恢复与 8° 首帧；Experience 和 ScreenManager 检查完成结果及游戏进入 generation。预热期间正常循环不抢先同步创建新管线，resize 延后队列完成再应用并重绘；销毁取消帧/等待并消费迟到拒绝，正式动画不残留 hook。
- 同机独立 Chrome profile 初始化由同步 35.09–38.22 s 降至正式实现 6.67–7.47 s（按 35.09→7.47 s，约 -79%）；首次 warmup 33.35–36.34→5.13–5.64 s，约 154 个新材质管线、3 轮收敛。稳态约 59.95–59.97 FPS / 537 draws，保留清漆、印花、Lightmap、实时玻璃、32 样本 GTAO、4× MSAA 和阴影分辨率，不把异步等待或本机加载当成通用 GPU 帧耗时/网络冷启动承诺。
- 新增 `scripts/verify-pipeline-preparation.mjs`（无需 GPU 的收敛、精确还原、错误/队列拒绝、销毁与迟到结果测试）和 `scripts/verify-startup.mjs`（独立 Chrome + Vite/preview 的普通启动、编译中 resize、销毁重建与生产检查）。Folded 首帧、完整重绘计数、Replay/Skip、取消进入游戏、1200×851 Canvas 重绘和同 Canvas 重建通过；生产 preview 连续三轮约 6.77–6.85 s 到 Loading 完成，未加载 WASM / ROM，成功样本无捕获 JS / GPU 错误。早期 preview 资源请求失败已留档，HTTP 字节/MIME 正常但根因未定，未将失败样本计入预热收益。
- 具体实现、时间口径、图片对照与材料目录见 `docs/PREPARATION_PROFILE_2026-10-28.md` 第 6 节。应用无新依赖、未改 node_modules；最终视觉验收交用户。本轮未提交或推送。
- 最终构建、语法检查、新增逻辑测试、NDS 映射、派生纹理/生产排除及 diff 空白检查通过；构建只有既有大 chunk 警告。加强测试另确认旧 Native 编译未结束即在同一 Canvas 重建的 HMR 生命周期安全，不依赖先等旧任务结束或整页刷新。

## 25. 按键材质节点复用（2026-10-29）

- 按用户要求实际使用 Needle MCP 的场景/实时 TSL 节点检查，以及 Blender MCP 的临时 GLB 审计。ABXY 原模型各只有一个材质槽，确认主要机会是运行时印花/颗粒算法的重复构建，而非先回 Blender 拆改资源。Blender 审计结束清理临时内容、恢复原空场景，未保存或导出，GLB/UV/Lightmap 不变。
- `ButtonPrint` 缓存投影/油墨/表面响应节点，每个 Mesh 独立持有投影参数；主机颗粒/清漆算法也共享节点，通过当前材质读取各键尺度。D-Pad 仍无字母，三套 Dock 材质、配色、底色、调参和资源所有权保持独立；只在 `ExhibitSample` 补充对应 Mesh，不合并几何或 draw calls。
- 实际阴影覆写会用临时 `ShadowMaterial`，印花数据不能直接读当前材质；初版浏览器错误已用定向记录和测试复现，改用标准对象 `reference()` 后通过，没有增加 renderer 私有适配或关闭阴影。新增 `scripts/verify-button-materials.mjs` 覆盖共享算法、独立参数、非均匀缩放、阴影覆写/跨 Mesh 编号和释放。
- 同机交错对照：首次按键 NodeBuilder 62→12、CPU 构建累计 1.23–1.27→0.29–0.33 s；全部 NodeBuilder 225→175、新材质 GPU 管线 154→129。初始化 7.10–7.36→6.18–6.26 s，首次 warmup 5.50–5.57→4.52–4.57 s；旧源码仅替换临时服务响应，没有回退工作区。稳态仍约 60 FPS / 537 draws，不把构建累计时间当 GPU 帧耗时。
- `verify-startup.mjs` 新增 materials 模式与可选 `DUO_BUTTON_SNAPSHOT` 响应对照：三主题 Hero/Play、独立配色、Folded、完整重绘、Replay/Skip/取消、resize 和编译中销毁立即重建通过；六组截图平均通道差 0.021–0.033 / 255 标度，最终视觉验收交用户。最新生产 dist 启动通过，无捕获 JS/GPU 错误；偶发开发动态模块请求取消样本单独留档，未计入收益，也未宣称根因已解决。
- 详见 `docs/BUTTON_MATERIAL_OPTIMIZATION_2026-10-29.md`。本轮没有新增依赖或修改素材，没有提交或推送。

## 26. 桌面展品消失与 Needle 材质预览修复（2026-10-29）

- 根据用户 1166×982 截图，Needle 确认 PartsDisplay、ColorDock、AirPods、内部元件和卡带展台仍存在，但父组 visible=false；同尺寸新增 `verify-startup.mjs layout` 检查在旧逻辑下稳定失败，输出 compact=true、五组全隐藏。根因为旧布局只看 Canvas 宽高比 <1.35，将较高的桌面窗口也当成窄屏，不是模型删除或按键管线复用导致整场漏绘。
- Exhibition 现仅在 Canvas 宽度 ≤720 CSS px 且宽高比 <1.35 时精简展品，与现有页头/画布宽度断点一致，保留手机窄屏行为和原独立显示开关；1166×982 等桌面窗口显示完整展区。不改镜头、场景坐标、资源或按键优化；PRD 第 29.3 节同步修正。此前只测宽屏和较横向的 resize，遗漏了用户这类窗口比例。
- 同时通过临时定向记录确认控制台 center 缺值发生在 `Needle Preview sphere`：预览球复用按键材质但没有产品 Mesh 的投影参数。`ButtonPrint` 让材质保留同一份投影参数供预览读取；正式场景/阴影仍优先用当前 Mesh，既不串键也不绑定临时阴影材质。先加入预览球回归复现错误，再修复；临时诊断代码已移除。
- 用户连接页面的五组展品经 Needle 复核均恢复 visible=true；1166×982 启动及 390×799 精简后恢复桌面的浏览器检查通过，无捕获 JS/GPU 错误。回归脚本另覆盖 720/721px 边界和实际预热/重绘，不只检查可见性属性。最终视觉仍交用户验收，本轮未提交。
- 最终 layout 模式的 1166→390→720→721→1166 宽度序列、三配色 materials 模式、生产 preview、构建、按键/管线逻辑检查、语法和 diff 检查全部通过；五组布局恢复及 Needle 错误日志为空再次确认。材料：`duo-startup-layout-LVkQpq/`、`duo-startup-materials-fzIKy9/`、`duo-startup-production-DmE4NJ/`（同前临时根目录）。

## 27. ExhibitLabel 离线 PNG（2026-10-29）

- 用户确认将实体标签改成离线生成图片。本轮仅处理标签，不改玻璃、背景捕获、GTAO、模型、镜头、布局或模拟器。Needle 实际复查六标签均可见，材质 map 的 image.tagName 均为 IMG，不是仅从源码推断。
- 新增 `generate-labels.mjs`，复用原 Canvas 排版，使用本机 Chrome / Windows Segoe UI、Arial 生成八张 `public/labels/*.png`（257,760 B）及源/图片/字体哈希清单。五静态标签与 Dock 三种选中状态均经 sources / Resources 加载，保持原物理尺寸、分辨率、光照、遮挡、透明边缘和过滤。日常 build 不启动 Chrome，脚本支持 --check 重生成一致性检查，原模型及上一轮派生素材不变。
- Dock 预设只切换同格式 map，不新增 shader 或 Canvas；自定义颜色/文字才按需创建并复用单个 CanvasTexture，回到预设或销毁时释放，模型默认色变化也不会冻结成旧色点。加载纹理由 Exhibition 统一去重释放，标签只拥有材质/几何，动态纹理由 ThemeLabel 管理。
- 实验的纹理遮罩/uniform 版本实际增加 3 个新准备管线（129→132），交错样本没有证明收益，已撤掉该 shader 和遮罩文件并留档。最终普通 map 方案恢复 129 个首轮新材质管线，不撤销此前按键节点复用。
- 同机最终交错：初始六个标签 Canvas→0、七次绘图→0；旧绘图同步提交累计 19.8–23.5 ms→0。整体初始化旧 6.52/7.31 s，新 6.97/7.37 s，范围重叠且新版未更快，不宣称整体启动/FPS 提升；稳态仍约 60 FPS / 537 draws，Play 完整重绘仍为 411 draws。新增图片可缓存，但 Dock 全部状态上传后相对原单图最多增加约 1.33 MiB 的含 mipmap 纹理估值。
- `verify-labels` 覆盖 PNG 哈希/尺寸、预设无 DOM/Canvas、借用资源、懒自定义画布的复用/释放、色彩空间、UV 命中与无新增 shader；旧纹理回归脚本已适配离线注入。实际 WebGPU 离屏读回确认三套预设与自定义三色/下划线；五张静态 PNG 和四套 Dock 读回图与旧版逐像素一致，六套整场截图平均差 0.016–0.027 / 255，最终视觉仍交用户。
- 最终 labels 两组新旧交错、1166→390→720→721→1166 布局、编译中 resize、销毁立即重建（八张标签纹理各 dispose 一次）、生产 preview 均通过，无捕获 JS/GPU 错误。材料仍在前述临时根目录：旧 `duo-startup-labels-p3MUtg/`、`duo-startup-labels-JbZXJU/`；新 `duo-startup-labels-JKOn35/`、`duo-startup-labels-4YIAqe/`；布局 `duo-startup-layout-Fga6zj/`、resize `duo-startup-resize-Z9uNzp/`、销毁 `duo-startup-destroy-4bVt9I/`、生产 `duo-startup-production-ErX9zc/`。早期开发模块取消失败另行留档，不计作成功或性能收益。
- 生成说明加入 readme，PRD 第 29.4/29.5/29.9 节同步，细节见 `docs/LABEL_TEXTURE_OPTIMIZATION_2026-10-29.md`。没有新增依赖、提交或推送。
- 最终生成/--check、build、`verify-labels --dist`、`verify-textures --dist`、按键/管线/NDS 映射、语法与 diff 检查通过；Needle 六个实际标签均为 IMG 且错误日志为空。最新原版/最终版像素对比 `duo-label-diff-feIY9O/` 再次确认五静态图、三预设及自定义 Dock 读回完全一致，整场六套截图平均通道差 0.016–0.026 / 255。

## 28. 展台基础灯光强度调整（2026-10-29）

- 按用户指定目标值，将 Environment 主光强度 2.4 → 1.5、副光 0.3 → 0.5、半球环境光 1.9 → 1.0；副光以明确数值为准上调。两盏柔光箱、底座灯带、曝光、灯色、灯位与阴影设置不变，PRD 第 29.1 节同步。
- `npm run build`（105 modules）与 `git diff --check` 通过，构建仅有既有大 chunk 警告。Needle 实时读取确认当前页面主光 1.5、副光 0.5、半球光 1.0，柔光箱仍为 5 / 1.4；最终亮度与层次由用户视觉验收。本轮未提交或推送。

## 29. 左上产品文案恢复与 ease-in 渐显（2026-10-29）

- 实际 WebGPU 启动回归连续复现：1920×1080 下 Intro Ready / Game Home、文案 DOM 存在且 hidden=false，但计算样式为 display:none。只在浏览器中放宽旧 2:1 媒体查询即可恢复，确认不是 DOM 删除或状态事件丢失。
- `product-intro-copy.css` 将显示宽高比下限放宽至 16:9，保留至少 1600×650 与高窄/小屏隐藏条件。16:9 至 2:1、视窗高度至少 721px 使用 220px 宽、34px 标题和纵向特点，减少与左侧展品重叠；原超宽屏与低矮宽屏样式保留。16:10 / 4:3 画幅仍因左侧留白不足隐藏，不移动 3D 展区或镜头。
- 每次恢复可见播放 650ms CSS `ease-in`：透明度 0 → 1、向上回位 12px；重复同状态事件不重播，重播/加载/Playing 立即隐藏，减少动态效果偏好禁用动画。不新增 JS 监听、Timer 或时间线，前一轮灯光参数不变；PRD 第 23 节同步。
- `verify-startup.mjs` 新增 `intro-copy` 模式，先在旧规则下断言失败，再通过最终规则的十种画幅、重播/跳过、加载取消、Playing 返回、同状态事件、动画起点/中点/终点和 reduced-motion 检查；中点透明度约 0.315，确认确实 ease-in 而非瞬间显示。截图前等待 Hero 镜头归位，避免把过渡帧当成布局结果。
- 最终 WebGPU 回归、`npm run build`（105 modules）、脚本语法与 diff 检查通过，无捕获 JS / GPU 错误，构建仅有既有大 chunk 警告。原始失败材料 `duo-startup-intro-copy-UJE9fA/`、`duo-startup-intro-copy-ZXHYFI/`，最终材料 `duo-startup-intro-copy-WY0vR2/`（同前临时根目录）。最终版式与动效观感由用户验收；本轮未提交或推送。

## 30. 灰蒙感改善：背景、主辅光与接触遮蔽（2026-10-29）

- 按用户确认实施背景提纯与灯光层次调整：Stage 地面/弧墙底色 `#e2e4e6` → `#f0f1f2`，颜色贴图混合 0.35 → 0.12；新增 `colorMapStrength` uniform 与 `Stage / Cyclorama > Color texture` 调节项。法线、粗糙度和网格/Halo 沿用原设置。
- Environment 主光 1.5 → 2.2、副光 0.5 → 0.3、半球光 1.0 → 0.6。曝光仍为 1.03，面光源、灯位、ACES、屏幕和 Lightmap 沿用原路线。
- 独立 Chrome WebGPU 固定镜头对照旧参数、只改背景、背景+灯光、AO 强度归零及候选 AO。截图中背景提纯对大面积灰感改善最明显；采用 GTAO 半径 0.15 → 0.10、强度 1.5 → 1.1，收敛底座附近灰晕并保留接触层次。仍仅遮蔽间接光，32 样本、厚度、降噪和色彩转换路径不变。
- 对照通过临时脚本复用现有 materials 验收，在独立页面切换旧/新参数，未向应用加入诊断入口。三套配色各有 Hero / Play 镜头对照（Play 为取景检查，未启动 ROM）；材料在 `C:\Users\f1686533\AppData\Local\Temp\opencode\duo-startup-materials-ebN2lc/`。
- 最终源码的 `npm run build`（105 modules）、`git diff --check`、现有 `verify-startup.mjs ... materials` 通过，覆盖 Folded 首帧、三配色、完整重绘、Replay/Skip 和进入取消，无捕获 JS / GPU 错误。最终截图与报告在同临时根目录 `duo-startup-materials-Xl1Y56/`。最终亮度与层次由用户视觉验收；本轮未提交或推送。
