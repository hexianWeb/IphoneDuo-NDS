# iPhone Duo → NDS Web 交互原型 PRD

## 1. 项目概述

本项目旨在制作一个基于 **Blender + Three.js** 的网页端 3D 交互原型，用于展示：

> 将 iPhone Duo 与一体式外置 Controller 组合后，转变为类似 NDS / 3DS 的双屏掌机形态。

用户进入网页后，会先观看一段产品级 3D 入场动画，了解 iPhone Duo 的折叠形态、展开过程以及 Controller 的滑轨式安装方式；随后进入可交互的 Playable Demo，通过键盘或实体手柄操作游戏，并实时看到 3D Controller 按键反馈以及上下双屏的不同显示内容。

本项目重点不是从零开发完整 NDS 模拟器，而是验证和展示：

- iPhone Duo 作为双屏设备的游戏形态
- 外置 Controller 的产品设计概念
- 浏览器实时 3D 产品展示
- 双屏游戏交互体验
- Gamepad / Keyboard 与 3D 按键的实时映射

---

## 2. 产品目标

### 2.1 核心目标

```text
加载网页
→ 展示折叠状态的 iPhone Duo
→ Duo 自动展开
→ 手机上下屏点亮并显示 Phone UI
→ Controller 出场
→ Controller 沿滑轨安装到底部机身
→ 形成 NDS 风格双屏掌机
→ Hero Shot
→ 用户进入 Playable Demo
```

用户最终应清楚理解：

> iPhone Duo 可以通过一个整体式 Controller 配件，转换为类似 NDS 的双屏掌机。

### 2.2 非目标

V1 暂不实现：

- 自研完整 NDS 模拟器（允许集成现有 WebAssembly NDS 模拟器）
- 真实柔性 OLED 折叠形变
- 复杂物理滑轨
- L / R 肩键
- L2 / R2
- 大型完整游戏
- 多种 Controller 外观
- Controller 安装后的再次折叠
- 完整手机系统模拟
- 高复杂度装配编辑器

---

## 3. 产品形态

### 3.1 iPhone Duo

- `TopHalf_CAM`
  - 有 Camera 的一侧
  - 作为最终 NDS 上屏

- `BottomHalf_NO_CAM`
  - 无 Camera 的一侧
  - `Bottom_Screen_Plane` 承载 Phone Mode 的手机原生下屏 UI
  - Controller 安装后仍作为固定机身基准；进入 Game Mode 时该屏隐藏、关闭或由结构遮挡

- `Hinge`
  - 用于入场动画中的折叠 / 展开

### 3.2 Controller

Controller 为一个整体式外置底座，不采用左右分离结构。

主要包含：

- 蓝色 Controller 外壳
- 左侧 D-Pad
- 右侧 ABXY
- 中央镂空上方的可激活显示层 `Bottom_Display_Plane`
- 内部滑轨结构

V1 暂不设计肩键。

Controller 与 Duo Bottom 采用：

> 纵向滑轨式安装。

安装完成后，Controller 外壳会覆盖 iPhone Duo 下半机身的大部分区域。Controller 中央为镂空结构：装配期间隐藏 `Bottom_Display_Plane`，让用户看到下方手机的 `Bottom_Screen_Plane`；Lock 完成后才激活该显示层并过渡到 Controller UI。

---

## 4. 双屏设计

### 4.1 上屏

对应节点：

```text
Top_Screen_Plane
```

主要承担：

- 游戏主画面
- 游戏世界
- 角色与主要 Gameplay
- 主视觉内容

### 4.2 Controller 下屏

Controller 内部的下屏显示面为一个 PlaneGeometry。

对应节点：

```text
Bottom_Display_Plane
```

后续 Three.js 只需要将动态 Texture / RenderTarget 映射到该 Plane。

主要承担：

- 地图
- 背包
- Radar
- 状态信息
- Touch UI
- Secondary Gameplay

原则：

> 上下屏必须承担不同职责，不能简单复制同一游戏画面。

### 4.3 模式映射

| 产品状态 | `Top_Screen_Plane` | `Bottom_Screen_Plane` | `Bottom_Display_Plane` |
|---|---|---|---|
| Phone Mode | 手机上屏 UI | 手机原生下屏 UI | 不可见 |
| Controller 装配中 | 延续 Phone UI | 透过 Controller 镂空保持可见 | 完全透明 / 不可见 |
| Game Home | Game Home 主界面 | 隐藏、关闭或由结构遮挡 | Game Home 辅助界面 |
| Playing | NDS Top 输出 | 隐藏、关闭或由结构遮挡 | NDS Bottom 输出 |

`Bottom_Screen_Plane` 与 `Bottom_Display_Plane` 是两块不同的显示面，但 Controller 的结构语义是镂空上方叠加可激活显示层：装配阶段暴露手机下屏，Game Changer 转场后由 Controller 显示层接管。

---

## 5. 屏幕实现方式

Duo 不实现真实柔性屏幕。运行时共有三块职责明确的显示面：

```text
Top_Screen_Plane       # 手机上屏；Phone Mode 与 Game Mode 共用
Bottom_Screen_Plane    # 手机原生下屏；仅用于 Phone Mode
Bottom_Display_Plane   # 镂空上方的 Controller 显示层；用于 Game Home / Playing
```

三块屏幕的 UV 均已确认覆盖完整 `0–1`。内容宽高比与显示面比例不一致时，由运行时采用 fit、letterbox 或 crop 策略处理，不拉伸或改写 UV。

Phone UI 从 Fold 第一帧就在 `Top_Screen_Plane` 与 `Bottom_Screen_Plane` 显示。Top Screen 的方向模糊、轻微位移与折痕阴影随产品角度恢复，Bottom Screen 只做轻度模糊和亮度恢复。Controller 装配期间 `Bottom_Display_Plane` 完全不可见，Lock 完成后的 Game Changer 转场才激活。

---

## 6. 网页主要流程

### 6.1 Loading

- 加载 GLB
- 加载 Texture
- 初始化 WebGPU / WebGL Renderer
- 初始化 RenderTarget
- 初始化游戏资源
- Shader / Pipeline 预热

### 6.2 Intro

#### Shot 01 — Folded Duo
展示折叠状态 iPhone Duo，低亮度 Phone UI 已显示，Controller 暂不出现。

#### Shot 02 — Unfold
iPhone Duo 自动展开；Top Screen 根据产品角度执行 Blur、Parallax 与 Fold Shade，Bottom Screen 逐步恢复亮度和清晰度。

#### Shot 03 — Screen Wake
展开完成后，Screen Wake 负责 Phone UI 的曝光、焦点和亮度稳定，不再从黑场点亮。

#### Shot 04 — Controller Reveal
Controller 从画面外进入，展示 Controller、Duo Bottom 与滑轨安装关系。

#### Shot 05 — Controller Assembly
Controller 沿滑轨方向完成：

```text
Align
→ Slide
→ Lock
```

安装完成时可加入：

- 微小机械回弹
- Click 音效
- Lock 完成后停顿，再激活 Controller 显示层并播放 Game Changer 转场

#### Shot 06 — Hero Shot
展示完整 `iPhone Duo + Controller`，形成 NDS / 3DS 风格双屏掌机。

此时 Game Home 使用 `Top_Screen_Plane` 与 `Bottom_Display_Plane`；手机原生 `Bottom_Screen_Plane` 隐藏、关闭或由结构遮挡。

#### Ready
Intro 暂停，显示 `PLAY` 或 `Press Any Key`，等待用户主动进入 Playable Demo。

---

## 7. Playable Demo

进入 Play 状态后：

- Hinge 锁定
- Controller 锁定
- Camera 切换到游戏体验机位
- 产品装配动画停止

核心体验：

```text
Game
+
Dual Screen
+
Input
+
3D Controller Feedback
```

---

## 8. 输入系统

统一使用 InputManager。

支持：

- Keyboard
- Gamepad API
- 后续可扩展 Touch

统一 Action：

```text
MOVE_UP
MOVE_DOWN
MOVE_LEFT
MOVE_RIGHT

ACTION_A
ACTION_B
ACTION_X
ACTION_Y

START
SELECT
```

---

## 9. 3D Controller 反馈

### ABXY
- 按下时按钮轻微下沉
- 松开后回弹

### D-Pad
D-Pad 为整体 Mesh，根据方向产生轻微倾斜。

目标反馈链路：

```text
实体 / 键盘输入
→ 浏览器输入系统
→ 游戏响应
→ 3D Controller 动画
```

---

## 10. 推荐状态机

```text
LOADING
↓
INTRO_FOLDED
↓
INTRO_UNFOLD
↓
SCREEN_WAKE
↓
CONTROLLER_REVEAL
↓
CONTROLLER_ASSEMBLY
↓
HERO
↓
READY
↓
ENTER_PLAY
↓
PLAY
```

---

## 11. 推荐 Intro 时间

| 时间 | 状态 |
|---|---|
| 0–2s | Folded Duo |
| 2–4.5s | Unfold |
| 4.5–5.5s | Screen Wake |
| 5.5–7s | Controller Reveal |
| 7–9s | Controller Assembly |
| 9–11s | Hero Shot |
| 11s+ | Ready |

提供 `Skip Intro`，便于开发调试和重复访问。

---

## 12. Three.js 主要模块

本节保留产品层面的模块概览；具体实现边界以第 23 节为准。

```text
App
│
├─ SceneManager
├─ ModelManager
├─ CameraManager
├─ MaterialManager
├─ IntroDirector
├─ AssemblyController
├─ ScreenManager
├─ InputManager
├─ ControllerAnimator
└─ Game
```

---

## 13. 运行时目标结构（原 Blender 规划）

以下结构最初计划在 Blender 中完成。当前决定是不再修改模型，因此它只作为运行时逻辑结构参考，不代表 `iphone.glb` 的真实节点树。真实节点树见第 17 节，代码生成的 Rig 见第 18 节。

```text
DUO_NDS_ROOT
│
├─ PHONE_ROOT
│  ├─ BottomHalf_NO_CAM
│  │  ├─ Bottom_Frame
│  │  ├─ Bottom_Screen_Back
│  │  └─ Bottom_Screen_Plane
│  │
│  ├─ Hinge_Mesh
│  │
│  └─ Hinge_Pivot
│     └─ TopHalf_CAM
│        ├─ Top_Frame
│        ├─ Top_Screen_Back
│        ├─ Top_Screen_Plane
│        └─ Camera_Module
│
├─ CONTROLLER_ASSEMBLY_ROOT
│  └─ Controller_ROOT
│     ├─ Controller_Shell
│     ├─ Bottom_Display_Plane
│     ├─ DPad
│     └─ Button_Group
│        ├─ Button_A
│        ├─ Button_B
│        ├─ Button_X
│        └─ Button_Y
│
├─ ANCHORS
│  ├─ Controller_Entry
│  ├─ Controller_Installed
│  ├─ NDS_Center
│  └─ Assembly_Target
│
└─ CAMERAS
   ├─ CAM_Folded
   ├─ CAM_Unfold
   ├─ CAM_Assembly
   ├─ CAM_Hero
   └─ CAM_Play
```

---

## 14. 技术栈

- Blender
- Three.js
- WebGL / WebGPU
- glTF / GLB
- GSAP（仅用于 Intro、装配和镜头时间线）
- Keyboard Events
- Gamepad API
- CanvasTexture / RenderTarget
- HTML / CSS / JavaScript

---

## 15. V1 验收标准

```text
打开网页
→ Loading
→ 折叠状态 Duo 出场
→ Duo 展开
→ Top_Screen_Plane 与 Bottom_Screen_Plane 点亮 Phone UI
→ Controller 出场
→ Controller 滑轨安装
→ 形成完整 NDS 形态
→ Hero Shot
→ 点击 Play
→ 进入可玩模式
→ Keyboard / Gamepad 控制游戏
→ 3D ABXY / D-Pad 同步响应
→ Top_Screen_Plane 实时显示游戏 / NDS Top 输出
→ Bottom_Display_Plane 实时显示游戏 / NDS Bottom 输出
→ Bottom_Screen_Plane 在 Game Mode 中隐藏、关闭或由结构遮挡
```

完成上述链路，即可认为本项目核心概念验证完成。

---

## 16. 当前开发阶段

目前已完成：

- iPhone Duo 基础模型
- Controller 白模
- Controller + Duo 基础组合结构
- 基础材质方向确定
- Controller 滑轨式安装方案确定
- 双屏结构确定
- Intro / Playable Demo 主流程确定
- `Experience` 单例与 Class 组件基础架构
- `Resources` 集中资源声明和 GLB 加载流程
- `ModelAdapter` 必需节点校验、包围盒居中和基础缩放
- WebGPU 初始化、资源加载和失败状态提示
- Camera OrbitControls 与 Tweakpane 基础模型调试
- GLB 中 10 个必需运行时节点的实际存在性校验
- Runtime Rig、`8° / 110° / 180°` 折叠控制和 Controller EXR Lightmap
- Controller Reveal、Align、Slide、Lock 可重播时间线
- Controller 装配采用约 1.85 秒的阶段重叠吸合节奏，并在锁定后保留 Hero 留白
- IntroDirector 基础状态流、Replay Intro、Skip Intro、Ready 与 Play 调试入口
- CameraDirector 四组运行时镜头、Intro 状态映射、Orbit 锁定与 Tweakpane 取景工具
- Fold 第一帧 Phone UI、角度驱动的模糊翻页和 Screen Wake 曝光 / 焦点稳定
- Controller 装配镂空与 Lock 后 Phone UI -> Game Home 双屏转场
- Phone、Attaching、Game Home、Playing 四种屏幕模式和最小 Continue / 返回交互

当前下一步：

> Phase 4、LookDev 与 Phase 5 NDS 综合验收均已通过；pilas-melonds 已接入独立验证页与主产品真实 3D 双屏，键盘、标准 Gamepad、3D 触控与暂停恢复已实现。下一步完成 Phase 6 的 3D 按键反馈，再按演示需要补充持久存档。

---

## 17. 已确认的 GLB 现状

当前 `public/iphone.glb` 对应的 Blender 源文件已经包含完整的手机与控制器视觉资源。模型导出时，手机处于竖屏完全展开状态，控制器与手机的相对位置已经是安装完成后的目标位置。

实际主要层级为：

```text
PHONE_ROOT
├─ BottomHalf_NO_CAM
│  ├─ Bottom_Frame
│  ├─ Bottom_Screen_Back
│  ├─ Bottom_Screen_Plane
│  └─ 平面
├─ Hinge
└─ TopHalf_CAM
   ├─ Camera_Module
   ├─ Top_Frame
   │  └─ apple-logo
   ├─ Top_Screen_Back
   └─ Top_Screen_Plane

CONTROLLER_ASSEMBLY_ROOT
└─ Controller_ROOT
   ├─ Bottom_Display_Plane
   ├─ Button_A
   ├─ Button_B
   ├─ Button_X
   ├─ Button_Y
   ├─ buttons
   ├─ Controller_Shell
   └─ DPad
```

模型当前没有：

- 独立的 `Hinge_Pivot`
- 安装与镜头 Anchor
- 动画 Action
- 可直接使用的产品镜头

这些内容不再回到 Blender 中补建，统一在 Three.js 中生成。

Controller 程序化磨砂塑料与按键清漆材质已实现。当前主机 `Controller_Shell` 使用 `TEXCOORD_1` 烘焙的 EXR 提供运行时 GI；原始 `public/lightmaps/Controller_Shell_lightmap.exr` 保留，2026-10-28 按用户纹理减重要求，运行时改用其 1024²、HALF / ZIP 线性浮点派生图 `public/optimized/lightmaps/controller-shell-1024.exr`，保留 uv1、flipY 与 Lightmap 强度。PNG 文件只用于预览。S2 展示外壳共享材质算法，但使用独立 uniform，不绑定主机安装态 Lightmap。

---

## 18. 运行时产品层级

GLB 加载完成后，创建一层不污染原始模型的运行时 Rig：

```text
PresentationRoot                 # 整机位置、旋转、缩放与 Hero 构图
└─ ProductRoot                   # 产品逻辑根节点
   ├─ BottomRig                  # 固定基准
   │  ├─ BottomHalf_NO_CAM
   │  └─ ControllerAssemblyRig
   │     └─ CONTROLLER_ASSEMBLY_ROOT
   ├─ HingePivot                 # 代码根据 Hinge 包围盒创建
   │  └─ TopHalf_CAM
   ├─ HingeVisualRig
   │  └─ Hinge
   └─ RuntimeAnchors
      ├─ ControllerEntry
      ├─ ControllerInstalled
      ├─ ProductCenter
      ├─ CameraHero
      └─ CameraPlay
```

层级原则：

- `BottomRig` 是折叠运动的固定参考系。
- 只旋转 `HingePivot` 下的 `TopHalf_CAM`。
- Controller 安装完成后跟随 `BottomRig`，不跟随上半屏。
- `PresentationRoot` 只负责整机在镜头中的构图，不参与铰链角度计算。
- 重新挂接节点时必须保持世界变换，避免模型跳位。

---

## 19. 折叠与铰链规则

### 19.1 角度定义

使用上下两块屏幕内侧平面的夹角作为产品角度：

```text
0°    = 理论完全闭合
8°    = 入场初始近闭合态，避免模型穿插与 Z-Fighting
90°   = 直角形态
110°  = Unfold 终点与 Controller 装配态（下半屏平放）
120°  = Hero / Game Home / Play 展示态（整机再立起 30°，上屏竖直）
180°  = GLB 当前竖屏完全展开 Bind Pose
```

GLB 的 Bind Pose 为 `180°`，所以代码中的上半屏折叠旋转量为：

```text
foldRotation = 180° - productAngle
```

示例：

| 产品夹角 | 上半屏相对 Bind Pose 的旋转量 |
|---:|---:|
| 8° | 172° |
| 90° | 90° |
| 110° | 70° |
| 180° | 0° |

入场动画建议从 `8°` 动画到 `110°`。GLB 加载后、首次可见渲染之前就应用 `8°`，避免页面短暂闪现完全展开状态。

2026-09-24 决定：进入 Hero 时由 IntroDirector 把夹角从 `110°` 开到 `120°`，同时整机绕 Controller 下半部前下边缘立起 `30°`（`ProductRig.standRoot`，位于 PresentationRoot 与 ProductRoot 之间，不参与折叠计算）。结果为下屏与展台成 `30°`、上屏竖直。转轴平行铰链、方向取使铰链升高的一侧；逐帧用下半部投影凸包求真实最低点，保证圆角前沿贴住展台。底座仍按 `110°` 平放占地测量。Skip / Continue 直接落到该姿态，Replay 与装配调试回到平放。

### 19.2 Pivot 与旋转轴

- `HingePivot` 的位置由 `Hinge` 网格包围盒中心计算。
- 铰链长轴由 `Hinge` 局部包围盒最长方向推导，不在代码里硬编码 Blender 轴向。
- 旋转正负方向根据上屏法线与下屏法线在首次适配时校准。
- 上半屏重新挂到 `HingePivot` 时保持原世界变换。

### 19.3 铰链外观

铰链不是本项目的重点，不模拟内部机械结构。视觉网格只需要位于上下机身姿态的中间方向：

```text
hingeOrientation = midpoint(bottomOrientation, topOrientation)
```

实现上可使用上下姿态四元数的 `slerp(0.5)`。下半屏固定时，也可理解为铰链视觉旋转量取上半屏折叠量的一半。

入场完成后：

- 产品夹角锁定在目标值。
- 铰链不再逐帧执行复杂求解。
- 后续镜头运动只操作 `PresentationRoot` 或 Camera。

---

## 20. Controller 装配姿态与入场

### 20.1 最终安装位置

Controller 的最终位置已经存在于 GLB 中，不再人工测量或重新设计。

加载模型后应立即记录：

```text
ControllerInstalled = Controller 相对于 BottomRig 的当前变换
```

该变换是装配动画唯一权威终点。即使手机从 `180°` 折到 `110°`，下半屏和 Controller 的相对关系也保持不变。

### 20.2 入场动画

Controller Reveal / Assembly 可以使用以下流程：

```text
读取并保存 ControllerInstalled
→ 将 Controller 临时放到 ControllerEntry
→ Reveal
→ Align
→ Slide
→ 到达 ControllerInstalled
→ 小幅过冲回弹
→ Lock
```

`ControllerEntry` 可以由最终变换沿滑轨方向反推，不需要 Blender Anchor。首版只需在 Tweakpane 暴露：

- 滑轨方向
- 起点距离
- Reveal 时长
- Slide 时长
- Lock 回弹幅度

这些参数视觉确认后固化为默认值。

---

## 21. NDS 游戏方案

### 21.1 当前方向

Playable Demo 优先考虑真正的 NDS 双屏内容，而不是 NES 单屏游戏，也不优先做 3DS 模拟。

原因：

- NDS 原生输出两块 `256 × 192` 画面，与产品双屏概念天然一致。
- D-Pad、ABXY、Start、Select 可以直接映射现有 Controller。
- 下屏触控可以在后续阶段补充，不阻塞首版键盘与手柄操作。
- 浏览器中的 NDS WebAssembly 模拟方案比 3DS 更轻、更成熟。

3DS 模拟暂不作为 V1 目标，主要风险是浏览器性能、启动资源、兼容性和集成复杂度。

### 21.2 模拟器候选

首选验证候选：

- 2026-09-23 决定：优先验证 [pilas-melonds](https://github.com/josepilas/pilas-melonds) 现成 WASM 与浏览器桥接，目标为 i7-14700 + RTX 4060 桌面浏览器上的简短可玩演示。先在独立页面验证用户提供的本地 `.nds`，再接入 3D 屏幕。测试 ROM 不纳入生产构建。

备选：

- [Desmond](https://github.com/js-emulators/desmond)：原首选，可嵌入网页的 DeSmuME WebAssembly 封装。
- [dust](https://github.com/kelpsyberry/dust)：Rust 编写、包含 Web 前端的 NDS 模拟器，许可为 GPL-3.0，现代但嵌入改造成本可能更高。
- [EmulatorJS 的 Nintendo DS 支持](https://emulatorjs.org/docs/systems/nintendo-ds/)：可使用 melonDS Core，集成完整，但 UI 和内部输出管线可能需要较多裁剪。

正式选型前必须完成一个最小技术验证：

1. 在本地加载可合法分发的 Homebrew `.nds`。
2. 确认模拟器能稳定运行并响应键盘输入。
3. 找到上下屏画面的 Canvas 或帧缓冲输出。
4. 将上下屏分别复制到两个独立 Canvas。
5. 把两个 Canvas 转成 Three.js `CanvasTexture`。
6. 分别映射到 `Top_Screen_Plane` 与 `Bottom_Display_Plane`。
7. 验证音频必须由用户点击 `Play` 后启动，满足浏览器自动播放策略。

该桥接只处理 Game Home / Playing 的游戏双屏输出。Phone Mode 由屏幕状态管理逻辑将手机 UI 分别映射到 `Top_Screen_Plane` 与 `Bottom_Screen_Plane`；Controller 装配期间 `Bottom_Display_Plane` 完全不可见，使镂空区域继续显示手机下屏。

### 21.3 屏幕桥接

建议由 `NDSScreenBridge` 隔离模拟器与 Three.js：

```text
NDS Emulator
├─ Top Frame 256 × 192
└─ Bottom Frame 256 × 192
        ↓
NDSScreenBridge
├─ topCanvas    → topTexture    → Top_Screen_Plane
└─ bottomCanvas → bottomTexture → Bottom_Display_Plane
```

如果模拟器只提供一张纵向拼接画布，则每帧分别裁切上半区和下半区；如果提供两张画布，则直接作为两个纹理源。该差异只允许存在于 `NDSScreenBridge` 内，不能扩散到场景代码。

三块屏幕 UV 已确认覆盖完整 `0–1`。`NDSScreenBridge` 或 `ScreenManager` 必须按目标显示面的宽高比执行 fit、letterbox 或 crop；不得为填满显示面而非等比拉伸画面或扭曲 UV。

当前 Playing 映射固定为上屏 `1.4:1`、下屏 `1:1`。NDS 的 4:3 主画面保持等比清晰显示；剩余区域不使用纯黑硬切，而是由同一帧按整数倍最近邻 cover 成离散像素并略微压暗。该延展只承担视觉填充，触控仍限定在清晰主画面范围。

2026-10-04 补充，按用户修正：`NDSStylus` 是常驻的鼠标伴随模型，外形参考迷你 Apple Pencil，程序化生成连续白色笔杆、锥形笔尖与圆润尾盖。它不绑定下屏 UV 或产品模式，Intro、展区、游戏与操作栏中均跟随鼠标。笔尖保持 CSS 像素对齐，笔杆由速度驱动阻尼弹簧，模拟惯性倾斜和急停回摆；点击保留轻微落笔及蓝色波纹。透明小画布与主渲染器共享 WebGPU Device 和 Experience 更新循环。NDS 下屏射线与触控映射使用既有 InputRouter，不增加触控笔专用映射，也不改变游戏输入。

### 21.4 开源游戏选择原则

优先使用：

- 原创 IP 的 NDS Homebrew。
- 明确包含开源许可证和可分发构建产物的项目。
- 双屏分工明显、无需触控也可完成基本操作的游戏。
- 画面具有辨识度，进入后数秒内能看出可玩性。

候选方向：

- `Trail Mix`：NDS 原生的 auto-chess / roguelike shooter，内容和画面更适合作为展示，已声明 MIT；仍需核实正式源码地址、资源许可和 ROM 再分发条款。
- [Pong-NDS](https://github.com/Chi-Iroh/Pong-NDS)：MIT，结构简单、适合最早完成模拟器与双屏管线验证，但视觉表现较弱。
- `Traffic Escape DS`：双屏益智方向，需进一步核实源码、许可证和浏览器模拟器兼容性。

不建议直接用于公开产品展示：

- 商业 NDS ROM。
- 使用任天堂角色或其他商业影视、游戏 IP 的复刻项目。
- 只有代码开源、但美术与音乐没有明确再分发许可的 Homebrew。

模拟器开源不代表游戏 ROM 可以分发。最终上线前必须分别确认模拟器许可证、游戏源码许可证、游戏资源许可证和预编译 ROM 的再分发权限。

---

### 21.5 展示游戏的试玩范围（2026-10-04）

- 六张封面中仅 `game0` 开放试玩；其他封面仍可浏览，点击后显示“暂不可玩，目前仅开放第一款游戏。”，不打开文件选择器或启动转场与模拟器。
- ControllerDisplay 统一检查封面点击、收藏库选择、下屏确认、键盘/手柄确认和底栏试玩请求，避免非开放封面从另一入口启动。
- game0 沿用当前 NDS 配置、取消、暂停与继续机制；生产环境仍不打包本地 ROM。

## 22. 动画技术选择

### 22.1 使用 GSAP

GSAP 只负责离散且有明确起止时间的展示动画：

- Intro 时间线
- 手机从近闭合态展开到目标夹角
- Controller Reveal / Align / Slide / Lock
- Camera Shot 切换
- UI 淡入淡出

### 22.2 不使用 GSAP

ABXY 与 D-Pad 的实时反馈不使用 GSAP Timeline，改为渲染循环中的阻尼弹簧：

```text
Input Target
→ Spring / Damping
→ Button Position 或 DPad Tilt
```

这样可以自然处理中途松开、快速连按、同时按键和 Gamepad 高频输入，避免多个 Tween 相互覆盖。

---

## 23. 推荐代码模块

2026-10-04 实现补充：`World` 另行装配 `ProductToolbar`（DOM 展示操作与模态说明）和 `ControllerThemes`（主机配色过渡）。UI 通过 EventBus 表达试玩、重播、跳过、声音及主题意图；主机颜色写入经 ModelAdapter 的公开接口，保留既有 TSL、EXR Lightmap 和按键反馈。右侧配色样品在 Game Home 可点击，底栏保留窄屏替代入口；Playing 收起展示控件。详细实现见 `PROJECT_PROGRESS.md` 第 9 节。

2026-10-05 增加 `ProductHeader`：采用轻薄半透明的 HTML 产品页头，包含品牌、产品展区、装配演示、操作指南和随 Intro / 加载 / Playing 切换的试玩入口。页头位于 DOM 和键盘顺序首部，动作继续经 EventBus 路由；操作指南使用 `product:help-request` 共用 Toolbar 的同一弹窗，关闭后恢复实际触发按钮。小屏保留品牌、指南和主按钮，重播在 Intro / 加载 / Playing 禁用。按用户后续反馈，页头内容行压缩为桌面 48px / 小屏 44px（另含安全区和分隔线），横向容器随视窗铺开、两侧保留流式边距。页头在文档流中占位，Canvas 填满其下方剩余高度；`Sizes` 观察实际 Canvas 边界，Renderer 仅调整像素缓冲，保持原镜头参数和 3D 布局。调试面板移至页头下方，所有 DOM / 监听由 World 销毁。

配色选择保存在当前站点的 localStorage（`iphone-duo.controller-theme`），在 Intro 首帧前恢复主机、展台选中态与底栏。仅接受 Classic / Retro / Midnight；无效值或存储不可用时回退 Classic，当前会话仍可正常切换。

宽屏左侧另由 `ProductIntroCopy` 提供简短产品标题和说明，只在 Intro Ready、Game Home 且未启动游戏时显示；为避开固定 Hero 镜头下的左展板，限制视窗至少 1600×650、宽高比至少 2:1。2026-10-05 先按用户要求放大 1.5 倍，后根据新参考图调整为黑色首行标题和深蓝至亮蓝渐变的“更多可能。”，下方提供三列静态特点：双屏扩展 / 更大的游戏视野、模块化设计 / 自由装配组合、丰富主题 / 打造专属风格。特点使用圆底线条 SVG 图标和淡分隔线，保留原正文；常规宽屏容器宽 330px、标题 51px，720px 以下低矮画幅压缩为 282px / 42px 并收紧间距，整体上移避开元件展台。小屏和较窄画幅隐藏文案，特点不增加按钮或监听，文案不拦截画布交互，监听与 DOM 随 World 销毁。

同日视觉精修：入口由 `LoadingScreen` 展示品牌、真实进度与首帧准备状态；`ScreenManager` 持有 `GameEntryTransition` / `GameEntrySound`，NDS 首次启动与恢复在 Game Home 中先收拢上屏，首帧就绪后展开，再进入 Playing。`ModelAdapter` 持有 `ButtonPrint` 共享点阵字形，主机和展品各自在键帽材质上投影 ABXY 印花。取消/Replay/失焦/销毁均收束转场；见 `PROJECT_PROGRESS.md` 第 10 节。

```text
App
├─ Renderer
├─ Environment                  # 背景、三盏灯、主光阴影、曝光；不设置 scene.environment
├─ Stage                        # 连续地面/弧墙、TSL 网格与 Halo，不进入 fitModel() 包围盒
├─ Exhibition                   # 产品小底座、左右展组布局与画幅策略
├─ ProductRig
│  ├─ ModelAdapter              # 校验节点、建立运行时层级
│  ├─ HingeController           # 产品夹角、Pivot、铰链视觉
│  └─ ControllerAssembly        # 保存安装终点、执行装配动画
├─ IntroDirector                # 状态机和 GSAP 时间线
├─ CameraDirector               # Hero / Play 等镜头
├─ ScreenManager
│  ├─ PhoneScreenSurface        # Phone / Top Game 材质、Fold TSL 与屏幕参数
│  ├─ ControllerDisplay         # Controller Canvas、材质与命中测试
│  └─ NDSScreenBridge           # NDS 输出映射到 Top_Screen_Plane / Bottom_Display_Plane
├─ InputManager                 # Keyboard / Gamepad / Touch Action
├─ ControllerFeedback           # 按键弹簧与 D-Pad 倾斜
├─ NDSRuntime                   # 模拟器生命周期、ROM、音频、存档
└─ DebugPane                    # Tweakpane
```

关键边界：

- 场景代码不能依赖具体模拟器 DOM 结构。
- `Stage` 不参与 `fitModel()` 包围盒，也不挂在折叠 Pivot 或 Controller 装配节点下。
- 曝光只通过 `Renderer.setExposure()` 修改，`Environment` 不直接写 Renderer 内部字段。
- 输入系统只输出语义 Action，不直接操作按钮 Mesh 或模拟器键码。
- GLB 节点名只允许集中在 `ModelAdapter` 中解析。
- Intro 与 Play 的状态切换不能直接散落在渲染循环中。
- `ScreenManager` 负责三块屏幕的模式映射；`NDSScreenBridge` 不得把 NDS Bottom 输出路由到手机的 `Bottom_Screen_Plane`。

---

## 24. 当前已确认与待确认事项

### 已确认

- Blender / GLB 不再继续修改。
- 手机 Bind Pose 是 `180°` 的竖屏完全展开态。
- 下半屏固定，上半屏围绕代码生成的 Pivot 旋转。
- 装配夹角 `110°`（上半屏旋转 `70°`）；Hero / Play 展示为 `120°` 并整机立起 `30°`，上屏竖直（见 19.1）。
- 铰链外观采用上下姿态中间值，不制作复杂机械动画。
- Controller 当前 GLB 相对位置就是最终装配位置。
- Controller 跟随下半屏，折叠时不单独重新定位。
- GSAP 用于 Intro 与镜头，不用于按键回弹。
- Playable Demo 方向是 NDS 双屏内容，不是 NES。
- 不需要用户在开发阶段逐项验收，由用户最后进行视觉验收。
- 后续静态资源由用户自行补充，工程保持 `public` 为公共资源目录。
- Controller Shell 的运行时 GI 使用 2048 × 2048 Half Float EXR Lightmap，并通过 `TEXCOORD_1` 采样。
- 已确认三块屏幕节点及职责：`Top_Screen_Plane` 为手机上屏，`Bottom_Screen_Plane` 为手机原生下屏，`Bottom_Display_Plane` 为 Controller 镂空上方、仅在 Lock 后激活的显示层。
- 已确认三块屏幕 UV 均覆盖完整 `0–1`；比例差异由运行时 fit、letterbox 或 crop 处理。
- **不使用 HDR 环境贴图**，`scene.environment` 恒为 null。已实测否决，详见第 29 节与 `docs/Scene_Lighting_Stage_Plan.md`。
- 场景细节 S1 使用程序化连续地面/弧墙和独立产品小底座；S2 已将左右灰盒替换为真实零件展板和三配色 Dock，复用当前 GLB 几何与独立展示材质。

### 待技术验证

- pilas-melonds 预编译产物与完整 C++ 源码的对应关系。
- 选定 Homebrew 游戏及其完整许可证链路。
- IndexedDB 持久存档及其目标浏览器兼容性。
- Phase 7 中更广泛设备与浏览器组合的性能预算和降级策略。

### 待视觉微调

- Hero / Play 最终镜头。
- 产品夹角是否从 `110°` 微调。
- Controller 入场方向、距离和回弹幅度。
- 按键下沉深度与 D-Pad 最大倾角。

---

## 25. 分阶段实施顺序

### Phase 1 — Model Adapter

目标：让代码稳定识别现有 GLB，不做展示动画。

- 加载 `public/iphone.glb`。
- 校验所有必需节点名。
- 输出缺失节点的明确错误，而不是静默失败。
- 记录原始父子关系、局部变换和世界变换。
- 计算模型整体包围盒与产品中心。
- 将材质、阴影、色彩空间调整到基础可用状态。

完成条件：模型首次渲染时位置正确，没有跳位、缩放异常或材质丢失。

### Phase 2 — Runtime Rig 与折叠

目标：不修改 Blender 的前提下完成折叠控制。

- 创建 `PresentationRoot`、`BottomRig`、`HingePivot` 和 `HingeVisualRig`。
- 从 `Hinge` 包围盒推导 Pivot 与长轴。
- 保持世界变换地重新挂接上半屏。
- 用 Tweakpane 实时调节产品夹角。
- 验证 `8° → 110° → 180°` 全范围没有穿插、翻转或漂移。

完成条件：角度公式稳定，页面首次显示时不会闪现 Bind Pose。

### Phase 3 — Controller 装配

目标：使用 GLB 当前相对姿态作为唯一装配终点。

- 保存 `ControllerInstalled`。
- 从终点沿可调滑轨方向生成 `ControllerEntry`。
- 实现 Reveal、Align、Slide、Lock。
- Lock 后将 Controller 固定到 `BottomRig`。

完成条件：动画结束后的变换与 GLB 原始装配姿态一致。

### Phase 4 — Intro 与镜头

当前状态：用户已于 2026-09-22 确认该阶段视觉校验完成。进入 Phase 5 前先完成 Controller Shell 程序化塑料 LookDev，实施细节与草案修正见 `Controller_TSL_Material_Implementation.md` 首节。

目标：完成从产品介绍到可玩状态的整条时间线。

- 接入 GSAP。
- 实现 Intro 状态机与 Skip Intro。
- 建立 Folded、Assembly、Hero、Play 镜头。
- Phone UI 从 Fold 第一帧显示，折叠效果由产品角度驱动；Screen Wake 只做展开后的曝光与焦点稳定。
- `READY` 状态等待用户操作，用户点击后再启动音频与游戏。
- Controller 装配期间隐藏 `Bottom_Display_Plane` 以暴露镂空下方的手机 UI；Lock 后通过 Game Changer 转场激活。

完成条件：Intro 可重复播放、可跳过，状态切换无竞态。

### Phase 5 — NDS 技术验证

当前状态（2026-09-23）：已完成。独立页与主产品已接入 pilas-melonds，真实 3D 双屏、语义输入、下屏触控及异步启动取消已通过自动化检查；连续十分钟游玩、声音与音画同步、触控、真实 Gamepad、暂停恢复和最终画面均通过用户验收，详见 `NDS_Integration_Spike.md`。

目标：先证明模拟器能够作为纹理源，再决定正式依赖。

- 在隔离页面运行模拟器与 Homebrew ROM。
- 测量首屏加载时间、帧率、内存和音频稳定性。
- 完成上下屏 Canvas 提取。
- 将 NDS Top / Bottom 真实画面分别显示到 `Top_Screen_Plane` / `Bottom_Display_Plane`。
- 验证 Game Mode 中 `Bottom_Screen_Plane` 保持隐藏、关闭或由结构遮挡。
- 验证不同宽高比通过 fit、letterbox 或 crop 等比适配，不扭曲 UV。
- 验证页面隐藏、恢复、失焦和窗口尺寸变化。

完成条件：连续运行十分钟无明显音画漂移、崩溃或输入卡死。

### Phase 6 — 输入与产品反馈

目标：让同一份 Action 同时驱动游戏和 3D 控制器。

- Keyboard 与 Gamepad 归一化。
- Action 转换为模拟器按键。
- Action 同时驱动 ABXY 弹簧和 D-Pad 倾斜。
- 处理连按、组合键、失焦后卡键和手柄断开。

完成条件：画面响应和 3D 按键反馈在主观上同步。

### Phase 7 — 产品化收尾

2026-10-05 已开始性能收尾：默认关闭开发 GUI 和辅助几何，开发时仅显式 `?debug` 按需载入 Tweakpane；`?performance` 独立开启开发采样，不进入正常展示。Loading 预热真实 Phone / Controller / NDS 材质与透射、GTAO、阴影通道，临时覆盖视锥剔除以准备 Hero 才露出的配件，随后恢复近闭合态与 Folded 镜头。每帧仅统一更新一次场景矩阵，玻璃背景捕获复用阴影，阴影按投影物/灯光变化更新；鼠标伴随笔停稳后复用画布。保留现有 DPR、GTAO、投影分辨率、材质和动画节奏。

2026-10-28 管线准备优化：由 Renderer 持有 `PipelinePreparation`，在真实通道提交的同步调用栈内启用 Three.js r186 的异步管线创建，退出调用栈即还原适配；等待后跨帧强制完整重绘阴影、透射、GTAO 和屏幕，直到没有新管线且 GPU 队列完成才退出 Loading。不削减材质、AO 或折射内容，不只等待一个普通 `compileAsync`。尺寸变更在预热队列完成后应用并重新验证，销毁使迟到结果失效；Folded 还原与唯一动画循环的启动顺序不变。该适配显式校验 r186 / WebGPU，升级 Three.js 后须重新验证内部接口。

- Loading 与错误提示。
- 移动端降级策略。
- 首次访问音频授权提示。
- ROM、模拟器与第三方资源许可展示。
- 性能档位与低性能设备降级。
- 最终由用户完成视觉验收。

---

## 26. 风险与降级方案

| 风险 | 影响 | 首选处理 | 降级方案 |
|---|---|---|---|
| 模拟器无法暴露上下屏像素 | 无法映射到 3D 屏幕 | 在模拟器渲染层增加输出适配 | 读取合并 Canvas 后裁切 |
| 模拟器与 WebGPU 同时运行负载过高 | 掉帧、发热 | 降低 3D DPR、阴影和后处理 | 3D 30 FPS，模拟器保持原帧率 |
| CanvasTexture 每帧上传成本过高 | GPU 带宽压力 | 仅在新模拟器帧到达时标记更新 | 降低纹理过滤或更新频率 |
| 三块屏幕在模式切换时路由错误 | Phone UI 或 NDS Bottom 出现在错误显示面 | 由 `ScreenManager` 集中定义模式映射与可见性 | 切换时先将非目标显示面置黑再绑定内容源 |
| NDS 画面与显示面宽高比不同 | 画面拉伸、裁切主体或出现非预期空白 | 运行时提供 fit / letterbox / crop 策略 | 默认使用 letterbox 保证画面不变形 |
| Homebrew ROM 许可不完整 | 无法公开部署 | 更换为许可链完整的原创 Homebrew | 自制最小 NDS Homebrew 验证 ROM |
| 模拟器 GPL 等许可与发布方式冲突 | 影响分发方案 | 在选型 Spike 阶段完成许可证审核 | 更换兼容许可的模拟器或隔离部署 |
| GLB 节点名发生变化 | 运行时 Rig 失效 | `ModelAdapter` 启动时完整校验 | 提供集中式节点映射表 |
| 自动播放策略阻止音频 | 首次进入无声 | 用户点击 Play 后创建 / 恢复 AudioContext | 显示明确的启用声音按钮 |
| Gamepad 映射差异 | 不同手柄按键错位 | 采用标准映射并提供调试视图 | Tweakpane 中允许临时重映射 |
| 3DS 路线性能不足 | 延期且体验不稳定 | V1 明确使用 NDS | 3DS 仅作为后续独立技术研究 |

如果 NDS 模拟器路线在技术验证阶段失败，产品结构和输入模块仍可复用。届时只替换 `NDSRuntime + NDSScreenBridge`，接入一个 NDS 视觉风格的 Web 双屏小游戏；该方案是降级路径，不是当前首选。

---

## 27. Tweakpane 调试项

Tweakpane 只用于开发调试，生产构建默认隐藏。

### Product

- `productAngle`
- `foldedAngle`
- `playAngle`
- `hingeAxisSign`
- `hingeVisualMix`
- `productScale`
- `productRotation`

### Controller Assembly

- `entryDistance`
- `slideDirectionX/Y/Z`
- `revealDuration`
- `alignDuration`
- `slideDuration`
- `lockOvershoot`

### Button Feedback

- `buttonTravel`
- `buttonStiffness`
- `buttonDamping`
- `dpadMaxTilt`
- `dpadStiffness`
- `dpadDamping`

### Environment

- 背景色、曝光
- Hemisphere / Key / Fill 强度
- 主光 X / Y / Z 位置
- 主光 Helper 显示开关
- 阴影正交范围 Extent、深度区间 Depth range、Bias、Normal bias

### Stage

- 显示开关、颜色、粗糙度
- 宽 / 深 / 厚度 / 倒角（改动后重建 geometry）
- Surface offset 微调桌面高度

### Camera

- Hero Camera position / target / FOV
- Play Camera position / target / FOV
- Dolly duration
- Orbit debug enable

### Screen / Performance

- Phone 屏幕亮度、自发光强度、漫反射细节与粗糙度
- Phone UI 的 X / Y 镜像、四档旋转与上下屏面板对调
- CanvasTexture 更新频率
- Renderer DPR
- Shadow enable
- Debug screen source preview

### State Debug

- 当前 Intro State
- Skip Intro
- Replay Intro
- Screen Wake Duration / Hold
- Pause / Inspect Screen Wake / Continue Assembly
- Enter Play
- Pause / Resume NDS Runtime
- 模拟 Keyboard / Gamepad Action

### Coordinate Inspector

- 世界原点坐标轴与 XZ 网格
- 红 X、绿 Y、蓝 Z 轴向图例
- PresentationRoot 与关键 GLB 节点选择
- 所选节点局部坐标轴与世界包围盒
- 全部关键部件坐标轴开关
- 局部 / 世界 Position 与 Rotation 实时只读值

---

## 28. 核心计算参考

### 28.1 产品角度

```ts
const bindAngle = Math.PI
const productAngle = THREE.MathUtils.degToRad(params.productAngle)
const foldRotation = bindAngle - productAngle

hingePivot.quaternion.setFromAxisAngle(hingeAxis, hingeAxisSign * foldRotation)
```

这里的 `hingeAxis` 必须来自模型适配结果，不能假定永远是世界坐标的 X、Y 或 Z。

### 28.2 保持世界变换重新挂接

```ts
scene.updateMatrixWorld(true)
hingePivot.attach(topHalf)
bottomRig.attach(bottomHalf)
bottomRig.attach(controllerAssembly)
scene.updateMatrixWorld(true)
```

`Object3D.attach()` 用于在更换父节点时保持对象世界变换。建立 Rig 前后仍需检查对象是否包含非均匀缩放；若存在，应该先在适配层消除或单独处理。

### 28.3 保存 Controller 安装终点

```ts
bottomRig.updateWorldMatrix(true, false)
controllerAssembly.updateWorldMatrix(true, false)

const controllerInstalledMatrix = bottomRig.matrixWorld
  .clone()
  .invert()
  .multiply(controllerAssembly.matrixWorld)
```

装配动画结束时使用该矩阵分解出的 Position、Quaternion、Scale 作为终点，不通过肉眼重新填写一套坐标。

### 28.4 铰链视觉中间姿态

```ts
hingeVisual.quaternion.slerpQuaternions(
  bottomWorldQuaternion,
  topWorldQuaternion,
  params.hingeVisualMix, // 默认 0.5
)
```

如果铰链网格自身局部轴与机身法线不一致，需要在 `ModelAdapter` 中保存一个固定的 Bind Pose 修正四元数。

### 28.5 按键弹簧

每个按钮只保存当前位置、速度和目标值：

```ts
velocity += (target - value) * stiffness * dt
velocity *= Math.exp(-damping * dt)
value += velocity * dt
```

`target` 在按下时为 `1`，松开时为 `0`。最终位移为 `-pressAxis * buttonTravel * value`。D-Pad 使用同一套弹簧值驱动两个倾斜轴。

---

## 29. 场景环境与展台

详细实施计划、取舍过程与验收清单在 `docs/Scene_Lighting_Stage_Plan.md`。本节只固化对其它模块有约束力的产品决定。

2026-09-24 场景细节 S1–S3 已实现，产品铭牌、原创卡带和环境覆盖修正待用户视觉验收。详见 [Scene_Detail_Implementation_Plan.md](Scene_Detail_Implementation_Plan.md) 第 12–14 节。

### 29.1 照明方案

场景保留三盏基础灯，并增加两盏面光源塑形，**不使用 HDR 环境贴图**：

| 光源 | 参数 | 职责 |
|---|---|---|
| `HemisphereLight` | `#f7f9fc` / `#25282e`，强度 1.9 | 场景级间接漫反射填光 |
| 主 `DirectionalLight` | `#ffffff`，强度 2.4，位置 `(2.9, 6, 6.8)` | 主要投影与高光 |
| 补 `DirectionalLight` | `#dbe6ee`，强度 0.3，位置 `(-4, 1.5, 3)` | 弱中性补光 |
| 主 `RectAreaLight` | `#ffffff`，强度 5，尺寸 5 × 3 | 宽幅直接高光与中性塑形 |
| 补 `RectAreaLight` | `#f7f9fc`，强度 1.4，尺寸 4 × 2.5 | 较弱的侧面塑形 |

2026-10-05 材质与灯光首轮：底座另有四条窄面光源沿原底缘向下/外照明，与灯带亮度联动。所有面光源均不投影，也不代表实时 GI；LTC 纹理由 Environment 初始化并按实例释放。首轮不改构图、展区布局或任何几何尺寸。

Renderer 保持 ACES；2026-10-05 按用户“偏暗、泛黄”反馈，将背景改为 `#f3f5f7`、曝光改为 1.03，主面光与展台底色回到中性白，只在底缘灯带保留局部暖色。主光投 2048² 阴影，固定范围以光源到原点的距离为中心推导；S3 默认再按展区与落地投影扩展边界，保持灯位与方向。面板可关闭 `Fit exhibition` 对比固定范围。

### 29.2 HDR 环境贴图已否决

`studio_small_03_1k.hdr` 曾接入 `scene.environment` 并实测，结论是整体观感更差：`Controller_Shell` 的 EXR Lightmap 本身就是一次天光烘焙，叠加 studio HDR 后重复计光，画面被抬平、层次减少。该方案取消，HDR 文件保留在 `public/hdr/` 但不进入 `sources.js`。

三条连带约束：

- **没有 IBL 镜面反射。** `HemisphereLight` 在 three 中只贡献 irradiance；面光源提供直接镜面与清漆高光轮廓，不需要重新启用 `scene.environment`，也不会自动产生地面物体倒影。
- **半球光只有朝向渐变。** 天空/地面色随法线朝向变化，但不包含局部遮挡或物体间反弹；现有 GTAO 继续调制间接光遮蔽，不通过提高填光或曝光掩盖结构。
- **Controller Shell Lightmap 保留。** 原先"HDR 到位后重估这张图去留"的决策点前提已消失，`lightMapIntensity` 保持 1。

### 29.3 展台

展台为程序化 S1 实现，用户已完成布局调整并确认可提交：

- `Stage` 是宽 40、深 20、转角半径 3、墙高 16 的连续地面/弧墙。使用 Plastic010 1K JPG、非金属 Node Material 与 TSL 网格/Halo，不设置额外透明地面叠层。
- 2026-10-05 表面调整：保留原 PBR 贴图，地面粗糙度乘数 0.55、法线强度 0.07；用户确认亮度合适后将网格不透明度设为 0.21，Halo/细环保持首轮强度，不改位置和形状。ProductPlinth 用独立 TSL 微法线和粗糙度变化生成细磨砂，颗粒以世界长度计量并进行导数过滤，不增加贴图。
- `Exhibition` 独立挂 Scene，持有 `ProductPlinth`、`PartsDisplay` 和 `ColorDock`。产品在 110° 安装态测量宽 W、深 D；底座默认 1.5W × 1.61D × 0.06W，Z 偏移 +0.02D，平面圆角 0.05W 与竖向倒角 0.002W 独立。
- 小底座顶面对应 Blender `Z = -0.035` 的原支撑基准。世界高度必须经 `ModelAdapter.getStageSurfaceWorldY()` 换算，**不能写死**；地面高度等于该值减去底座总厚度。
- 增加底座不移动产品或改变 Controller 安装终点。S1 的装配路径采样中，Controller 最低点高于底座顶面约 `+0.00658`。Bind Pose 180° 是调试姿态，原有穿支撑面问题不属于 Intro / Hero 范围。
- 2026-10-29 根据桌面展品消失反馈修正：只有 Canvas 宽度不大于 720 CSS px **且**宽高比小于 1.35 时，左右展组才默认隐藏。较高/接近正方形的桌面窗口（如 1166×982）仍展示全套展品，不仅按宽高比精简。所有布景均不进入 `fitModel()` 包围盒，不挂接到折叠或装配节点。
- 后续外部展台/配件资产可替换对应组件的几何来源，支撑高度换算与布局约束保持一致。

### 29.4 零件展示与配色 Dock

- 用户要求将 Parts 竖板改为半透明玻璃：使用接入 ektogamat/webgpu-mesh-transmission-material 的 Physical Node 透射材质，折射源为 Renderer 持有的离屏干净背景（不走 Three 内建视口拷贝），底脚仍为实体材质；标签仅纸签区域不透明，其余画布镂空。玻璃不投不透明矩形阴影，并从 GTAO 透明对象预通道排除。
- 左展板使用当前模型已识别的完整外壳、D-Pad 与 ABXY；右 Dock 使用三套悬浮横握 Controller 主题样品（独立外壳、ABXY、D-Pad 配色），沿用用户最新布局。
- 展品面内右/上由静止 ABXY 布局推导；GLB 节点名称仍集中在 ModelAdapter，展示模块仅接收语义化几何/矩阵/颜色快照。
- 共享 Geometry 只读，展示材质和 uniform 独立；主机装配、可见性和按键动作不驱动展示副本，展示件不进入屏幕命中列表。
- 2026-10-29 按键准备优化：共享印花与表面算法节点，不共享可变配色或几何。印花坐标/字母由当前 Mesh 的独立数据驱动，兼容阴影覆写材质；主机颗粒参数仍由主机持有，各按键尺寸按材质读取。主题切换不再生成独立印花算法，材质与资源所有权不变。
- 标签统一使用 `3D Printed`，不宣称未核实的材料、独立上下壳或滑轨。2026-10-29 改为离线 PNG，Dock 预设的三种选中状态直接切换预加载纹理；只有自定义配色/文字偏离预设时才按需绘制一个 Canvas，返回预设后释放。详见第 29.9 节。
- 展示组件先销毁自有材质、标签与背板/Dock 几何，共享 GLB 几何最后由 ModelAdapter 回收。

### 29.5 产品铭牌与原创卡带

- `ExhibitProps` 由 Exhibition 持有，在底座前左/前右侧地面分别放置实体铭牌和原创卡带，布局相对产品 W / D，支撑高度跟随 Stage。
- 铭牌标注 `iPhone Duo / 3D Printed Controller / GAME CHANGER`；2026-10-04 按用户要求，卡带封面直接使用 `/img/cover.png`，通过 `sources.js` 与 Resources 加载，保持图片比例并完整展示。卡壳与触点仍为程序化几何，已删除卡带封面的程序绘图模块。
- 铭牌和卡带均使用静态图片纹理；两者不加入屏幕输入、产品折叠、装配和模拟器更新。离线标签纹理由 Exhibition 统一回收，卡带贴图仍由道具组件回收；窄屏默认隐藏卡带，保留铭牌。
- 场景总开关、调参和销毁由直接父级协调；初始布局必须通过装配扫掠、Hero 立起和屏幕遮挡检查。

### 29.6 AirPods 附件陈列（2026-10-04）

- 用户提供的 `/glb/airpods_pro.glb` 通过 sources / Resources 加载，由 Exhibition 持有的 ExhibitAirPods 适配，保留原始资产文件；已替换旧 AirPods 模型的加载路径与混乱节点映射。
- 新模型根节点为 `air_pods`，四个部件为 `case / cover / left_earphones / right_earphones`。最新 GLB 已在 Y=0 上方闭合平躺，左侧保留导出姿态；右侧整机立起 90°，盖子直接绕用户设置好的原点沿局部 X 轴向后打开，默认 115°。不再生成盖子 Pivot 或按包围盒重定位盖子，盒内耳机保留用户安装位置。
- 参考图中的左侧为闭合平放充电盒，右前侧为开盒、盒内耳机与盒旁耳机。两组共享原模型几何、纹理和转换后的 Node Material；节点映射集中在附件组件内。
- 保留用户导出的尺寸基准，不做盒宽归一化；按用户最终要求，两组共用 2.5 倍缩放。按箭头参考移到光圈外左下与右下：闭盒中心 `(-1.23W, +0.86D)`、Yaw -14°，开盒组中心 `(+1.32W, +0.907D)`、Yaw -18°。W / D 仅用于相对底座中心的摆放坐标；按可见几何的精确顶点接地，盒旁耳机放在前右方，按盒身前表面与耳机后表面留出 0.45 个盒宽，避免相交与 Hero 斜视下的遮挡。
- 附件不参与产品 Rig、屏幕或输入命中；窄屏随左右展组隐藏，阴影范围随 Exhibition 更新。Tweakpane 的 Exhibit AirPods 提供开关、统一 Scale、Lid angle 与两组 X / Z / Yaw；共享资源统一回收一次。

### 29.7 手柄内部元件展台（2026-10-05）

- 用户提供的 `/glb/detail.glb` 保留；2026-10-28 起通过 sources / Resources 加载其 `/optimized/glb/detail.glb` 派生副本，由 Exhibition 持有的 `InternalComponentsDisplay` 陈列。副本只将内嵌贴图长边限制为 512，节点、变换、几何字节和材质语义不变；植物模型采用相同派生策略。
- 三个根节点 `memory / bash / cpu` 在导出时重叠于原点，正面朝 +Y、平面为 XZ。运行时分别按包围盒等比适配，依参考图从左到右展示 Memory、Mainboard、Processor，保留原纹理与各自形状比例，不添加未经核实的硬件规格。
- 展台放在左侧 Parts 竖板前方、闭合 AirPods 后方，按用户最新截图校准为默认中心 `(-1.5W, +0.24D)`、Yaw 16°、整体 Scale 1.21；白色矮台在整体倍率应用前的顶板为 `0.91W × 0.32W`，前缘高 `0.06W`、倾角 30°，楔形支座随顶板角度变化。展台及元件不参与产品 Rig、屏幕输入或模拟器更新。
- 三件元件悬浮在各自承托面上方，沿展板局部 +Y 法线保持平行姿态；整体倍率应用前，在原承托高度上抬升 `0.028W`，起伏幅度 `0.0045W`，周期约 7 秒，各件相位错开。只更新展示外层组，保留 GLB 导出矩阵；展台、承托面与标签固定，隐藏展组不做动画更新。动画复用 Experience 的唯一循环和既有阴影变化检测，不逐帧重测展区包围盒。
- 原材质转为对应 Standard / Physical Node 材质，保留贴图、法线及 Memory 的清漆；CPU 正面完全金属化的导出材质在没有 IBL 的现有环境中偏黑，仅将其展示副本金属度设为 0.45，以保留银色顶盖与丝印的可读性。
- 2026-10-28 按用户纹理减重要求，静态展品标签默认改为 1024 像素宽，薄标签最小高度 128 像素，替代先前统一 2048 / 256 的物理分辨率；逻辑字号、两行铭牌排版和元件名标签几何高度不变，两张内部标签各向异性保持 16，元件名称继续使用透明混合而非硬阈值裁切以改善文字边缘。静态标签、阴影布局、窄屏隐藏和销毁由 Exhibition 协调；Tweakpane 的 `Internal Components` 提供开关、X / Z / Yaw、整体 Scale 与 Deck angle。模型原始资源、共享纹理、材质副本与程序化几何去重回收。

### 29.8 卡带 Game Library 展台（2026-10-05）

- `GameLibraryDisplay` 在 ColorDock 前方、开盒 AirPods 后方放置白色斜板展台，默认中心 `(+1.48W, -0.10D)`、Yaw -27°、整体 Scale 0.825、板角 68°；按用户后续调整，整体缩为原 1.1 比例的 0.75 倍，并从 +Y 俯视顺时针转 15°，再沿世界 Z 负轴后移 `0.15D`。三张竖卡使用用户实际文件 `/img/cover2.png`–`cover4.png`，前签标注 `Game Library / DUO COMPATIBLE`。不以参考图上的游戏名替换用户封面。
- `/img/cover5.png` 用于展台前方散放卡，局部位置 `(-0.1, 0, +0.38)`、Yaw 17°；原 `/img/cover.png` 地面卡保留尺寸、姿态与布局。卡壳和触点使用共享 `gameCard.js` 工厂，图片等比完整展示；每张卡的八个相同触点用一次实例绘制。
- 新展台不加入产品 Rig、输入命中或模拟器更新；窄屏随左右展组隐藏，阴影边界由 Exhibition 协调，自有标签、几何、材质、封面纹理和实例对象进入直接父级销毁路径。标签分辨率沿用第 29.7 节最新策略；开发调参仅显式开启 Debug 时构造。

### 29.9 标签离线图片（2026-10-29）

- 六个实体标签保留原 Mesh、物理尺寸、UV、光照/遮挡、透明边缘和 1024 宽分辨率；PNG 位于 `public/labels/`，通过 `sources.js` 和 `Resources` 加载，不引入 CSS3D。五个静态标签不再创建 Canvas；Dock 的 Classic / Retro / Midnight 选中状态共三张 PNG，正常启动与切换也不创建 Canvas。
- 任意调色能力仍保留：Dock 配色/文字与离线预设不一致时，才创建一个可复用 CanvasTexture；回到预设或销毁时释放。模型的默认色发生变化也会进入此路径，不显示过期的色点。预设切换只换 `map`，不更换材质类型或引入定制 shader；自定义状态与离线状态共用绘图定义，避免维护两套排版。
- `scripts/generate-labels.mjs` 使用本地 Chrome / Windows Segoe UI、Arial 离线生成；`public/labels/manifest.json` 记录源代码与图片 SHA-256、尺寸和参考字体指纹。修改文案、排版或预设后须重新生成并检查；日常 build 不依赖 Chrome。用户设备只加载 PNG，自定义 Dock 是唯一按需绘图例外。
- 图片仍为普通 RGBA 纹理，不能把离线化称为 GPU 压缩或绘制次数减少；八张 PNG 合计 257,760 B，Dock 三状态都上传后相对单图多约 1.33 MiB 的含 mipmap 纹理估值。主要收益是去掉常规路径的字体栅格化和画布管理，并可缓存成品，不承诺整体启动或 FPS 大幅提升。
- `ExhibitLabel` 只拥有材质/几何，借用注入纹理；八张加载纹理由直接所有者 Exhibition 去重释放。Dock 的临时自定义 CanvasTexture 由 ThemeLabel 自行释放。玻璃、GTAO、镜头、布局与模型不在本轮变更范围内。
