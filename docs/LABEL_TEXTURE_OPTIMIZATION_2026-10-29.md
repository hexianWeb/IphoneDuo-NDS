# ExhibitLabel 离线纹理（2026-10-29）

## 范围与最终实现

用户确认将标签从运行时 Canvas 绘制改为本地生成的图片。本轮只处理标签，不修改玻璃、背景捕获、GTAO、模型、镜头、布局、折叠/装配或 NDS。无需 Blender 烘焙或模型重导出；Needle 用于确认实时标签和纹理，而不是仅从源码推断。

- `scripts/labels/artwork.js` 保留五个静态标签的原绘图定义，只在离线生成时执行，不进入产品 bundle。
- `exhibitLabelLayout.js` 集中原物理尺寸、内部元件名称/位置、预设配色与 Dock 命中分区，离线绘图和运行时几何共用同一份数据。
- `public/labels/` 有八张 PNG：`parts`、`plaque`、`internalLegend`、`internalNames`、`library`，以及 Dock 三个选中状态 `dock`、`dockRetro`、`dockMidnight`。总大小 **257,760 B（约 252 KiB）**。
- URL 在 `sources.js` 声明，交给既有 Resources / Loading 进度与失败路径；组件不自行加载 URL。ExhibitLabel 直接借用注入纹理，仍是 Standard Node 实体表面。
- 保持 1024 宽与短标签至少 128 高、sRGB、flipY、8/16 各向异性、alphaTest、名称文字的透明混合与关闭 depthWrite，不改 Mesh 的变换、命中或材质光照类型。

## Dock：普通状态离线，自定义按需

正常启动及 Classic / Retro / Midnight 切换均不创建标签 Canvas。选中下划线已在三张图片内，切换只更换相同格式的 `material.map`，不设置材质 needsUpdate、不重绘图片。图片第一次使用仍需要常规上传，不能把「不重画」说成「完全不做 GPU 上传」。

任意调色能力不能被冻结成三张图片：

1. ThemeLabel 将收到的色值规范为 sRGB Hex，比较完整三套配色与名称。
2. 只有配色/文字偏离离线预设，或无有效选中项时，才创建一个 CanvasTexture，并在变化时绘制；连续调色和选中切换复用该画布。
3. 回到预设后切回 PNG 并释放临时 CanvasTexture/画布；销毁也会释放。模型初始色变化时同样走动态路径，不显示过期色点。
4. `themeLabelArtwork.js` 是离线与动态 Dock 共用的唯一绘图定义。生产不是永远禁止 Canvas：自定义调色是保留功能所需的明确例外。

八张加载纹理由 Exhibition 持有并去重释放；子标签只释放自有 Geometry/Material。ThemeLabel 另外拥有并释放临时自定义纹理。

## 为什么没有保留遮罩 shader 方案

先实验了「离线底图 + RGB 遮罩 + 九组颜色/选中 uniform」，实际 GPU 读回确认功能正确、没有新增 draw calls，但 Needle 实时图包含 70 个 TSL 节点，首轮准备材质管线从 **129 增为 132**。交错样本旧版为 **7.24 / 7.47 s**，遮罩版为 **7.48 / 7.88 s**，没有证据值得用新增 shader 工作替代少量 Canvas 绘图。

因此撤掉遮罩 shader/图片，最终使用普通 map 的三张离线状态图。不是为了达成「零 Canvas」口号而增加准备成本，也不删除自定义调色能力。最终首轮准备重新保持 129 个新材质管线，完整 Play 重绘仍为 411 draws。此前按键节点共享优化保持。

实验留档：临时根目录 `C:/Users/f1686533/AppData/Local/Temp/opencode/` 下的 `duo-label-mask-experiment-WNAu96/`，以及 `duo-startup-labels-ZBPc1C/`、`duo-startup-labels-YDfSVI/`。工作区没有保留遮罩路径，也没有回退其它修改。

## 收益和代价

- 确定消除正常路径的六个标签 Canvas 及其文字绘图，预设切换不再重绘/重上传同一画布；成品图片可以利用 HTTP 缓存，字体外观跨设备固定。
- **没有减少标签 draw calls、shader 光照成本或同尺寸 RGBA 的 GPU 内存。** 稳态仍约 60 FPS / 537 draws；离线化不是稳定帧耗时优化。
- 增加八张小图的请求/解码，约 252 KiB 网络成品。Dock 三状态都上传后，比原一张图多约 **1.33 MiB** 含 mipmap 的纹理估值；初始只使用第一张，不能把 Inspector 的全部存活纹理估值当成已经分配的 GPU 内存。
- 绘制时间原本主要发生在构造/内容改变，不是每帧。本轮不据此宣称大幅提高 FPS 或整体初始化；初始化还主要受原有资源与真实 GPU 管线准备影响。

最终同机交错对照（1920×1031 Canvas，独立浏览器/服务，单次 Loading 的 monitor 口径）：

| 指标 | 旧运行时标签 | 最终离线标签 |
|---|---:|---:|
| 初始化 | 6.52 / 7.31 s | 6.97 / 7.37 s |
| 初始标签 Canvas | 6 | 0 |
| 初始标签绘图调用 | 7 | 0 |
| 绘图同步提交累计 | 19.8 / 23.5 ms | 0 |
| 首轮新材质管线 | 129 | 129 |
| 稳态 FPS | 59.96 / 59.96 | 59.96 / 59.95 |
| 完整 Play 重绘 draws | 411 | 411 |

绘图计时仅包围旧 redraw 同步调用，不包含可能延后的栅格化/上传，也不是独立 GPU 帧耗时。新旧启动范围重叠，新版样本并未更快，资源加载阶段还增加了小图请求/解码；**本轮交付的是离线化与可缓存/字体一致性，不宣称整体启动提速**。样本为旧 `duo-startup-labels-p3MUtg/`、`duo-startup-labels-JbZXJU/`，新 `duo-startup-labels-JKOn35/`、`duo-startup-labels-4YIAqe/`。

## 生成与维护

```powershell
node scripts/generate-labels.mjs 'C:/Program Files/Google/Chrome/Application/chrome.exe' 'C:/Users/f1686533/AppData/Local/Temp/opencode'
node scripts/generate-labels.mjs 'C:/Program Files/Google/Chrome/Application/chrome.exe' 'C:/Users/f1686533/AppData/Local/Temp/opencode' --check
node scripts/verify-labels.mjs
npm run build
node scripts/verify-labels.mjs --dist
```

第二个参数必须为已有临时目录。脚本只启动独立无头 Chrome 和只提供绘图模块的本地临时 HTTP 服务，不连接或修改用户页面，不安装依赖，不复制/分发系统字体。参考生成使用 Windows 的 Segoe UI / Arial，缺少参考字体会停止；manifest 记录绘图/布局源哈希、PNG 尺寸/哈希与字体文件指纹。Chrome 或系统字体变化后若 `--check` 失败，需复核外观，而不是直接更新哈希绕过。

修改五个静态标签文案/绘制用 `scripts/labels/artwork.js`，Dock 文案/样式用 `themeLabelArtwork.js`，尺寸/预设用 `exhibitLabelLayout.js`，之后重新生成。日常 build 仅复制成品，不自动启动 Chrome。原模型和上一轮优化素材未修改，也未新增 npm 依赖。

## 验证与证据

`verify-labels.mjs` 检查八张 PNG 的尺寸/哈希、绘图源一致性、无需 DOM 的预设构造、借用纹理所有权、sRGB/过滤设置、预设 map 切换、懒创建/复用/释放自定义画布、原 UV 命中分区和无定制 shader。`verify-textures.mjs` 的旧 Canvas 构造断言同步改为离线纹理，原始素材/几何/EXR 约束保留。

`verify-startup.mjs labels` 使用真实 WebGPU：

- 首帧 Folded、常规启动六标签全为图片；三套预设均无 Canvas。
- 无光照离屏材质使用同一实际 map，GPU 读回九枚色点和选中下划线；额外自定义三色也检查，不只断言 JS 对象值。
- 预设纹理与材质版本不变，自定义后还原并释放；三主题 Hero/Play、Replay/Skip、游戏预热取消与完整重绘继续检查。
- Loading/准备阶段与 GPU 读回的额外验证材质阶段分开，后者不计入首轮管线数量。

旧响应仅从临时快照 `duo-label-original-xr6wn8/` 提供，未回退工作区。旧 `duo-startup-labels-VeKDJV/` 对最终 `duo-startup-labels-RKhnS3/`：五张静态图及四套 Dock（含自定义）的实际 GPU 读回均逐像素一致；六套整场截图平均绝对通道差 **0.016–0.027 / 255**，不是整场逐像素相同。对比报告为 `duo-label-diff-byUyIB/`。最终视觉仍由用户验收。

开发模块偶发请求取消仍单独保留：`duo-startup-labels-UseYQX/`、`duo-startup-labels-GHIU96/` 发生于 PerformanceMonitor 动态导入，未进入标签绘制/正式准备，不计作本轮性能收益或成功验收，也未宣称修复根因。

本轮未提交或推送。最终宽高/销毁/生产复测材料见进度文档最新追加记录。

最终 `JbZXJU → 4YIAqe` 对比另存 `duo-label-diff-feIY9O/`，九张标签/读回图继续逐像素相同；六套场景图平均差 0.016–0.026 / 255。生成/--check、build、两项 --dist、按键/管线/NDS 映射、语法与 diff 检查均通过，Needle 当前六标签均为 IMG 且没有捕获错误。
