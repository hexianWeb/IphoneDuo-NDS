# iPhone Duo WebGPU Agent Guide

## 先读

- 修改 JS、TSL、场景、输入、动画或资源前，完整阅读 `.cursor/rules/iphone-duo-webgpu.mdc`。
- 产品结构、折叠、装配和屏幕修改读 `docs/iPhone_Duo_NDS_PRD.md` 第 17–22、28 节；展区和灯光读第 29 节。实现与验收状态查 `docs/PROJECT_PROGRESS.md` 的最新追加记录，顶部摘要和早期章节可能滞后；推荐目录和规划依赖不等于已实现。冲突时以源码、`package.json`、`vite.config.js` 为准。

## 开发与验证

- 在仓库根目录运行 `npm install`、`npm run dev`；代码基础检查为 `npm run build`，产物用 `npm run preview`。Vite 8 要求 Node `^20.19.0 || >=22.12.0`。
- 两个锁文件均被跟踪，但当前 `package-lock.json` 缺少 manifest 中的 `@antfu/eslint-config`；不要假定 `npm ci` 可直接使用，也不要顺手删除或重生成另一份锁文件。
- Vite root 是 `src/`，公共目录是根目录 `public/`，输出到根目录 `dist/`；`.env*` 从仓库根目录读取。构建同时包含首页和 `/nds-test.html`。
- 开发地址加 `?debug` 才加载 Tweakpane、创建模型检查器和灯光 Helper；`?performance` 启用性能采样。两者生产构建均禁用。
- 没有 test、lint、format、typecheck script 或测试框架；ESLint / commitlint 配置不代表已接入自动检查。NDS 定向检查：`node scripts/verify-nds-mapping.mjs`（无需 ROM）、`node scripts/verify-nds.mjs "<本地 .nds 路径>"`（真实 WASM / ROM 核心检查）。
- `scripts/verify-exhibition.mjs` 是历史 Chrome CDP 检查，需要 Chrome 路径、已有临时目录和空闲端口 5183；仍引用默认不创建的 `keyLightHelper` 和已移除的 `cardLabel`，使用前先适配当前对象结构，勿为旧断言回改产品。
- 构建不覆盖 GPU 编译、声音、手柄或视觉验收；交互 / 视觉修改需在支持 WebGPU 的最新版浏览器检查，并交由用户最终视觉验收。Three.js 主 chunk 超过 500 kB 的警告本身不是构建失败。

## 生命周期与路由

- 入口为 `src/index.html` → `src/main.js` → `Experience.init()`。`Experience` 是单例，首次必须传 Canvas，组件用 `new Experience()` 取实例；初始化顺序为 WebGPU → `Resources.load()` → `World` → `preparePresentation()` 预热真实渲染管线 → 唯一 `setAnimationLoop()` → `World.start()` 播放 Intro。预热结束须恢复 Folded 位姿和镜头，避免首帧闪现安装态。
- `World` 装配并路由组件，直接父级显式调用 `update` / `resize` / `destroy`；监听、Timeline、面板和 GPU / DOM 资源接入同一 HMR 销毁链。NDS 和鼠标伴随笔也使用该循环；`Time.delta` 为秒，传给 NDS 时乘 1000。
- DOM UI 通过 EventBus 表达意图，`InputRouter` 输出语义 Action，不直接改 Mesh 或模拟器键码；模拟器 API 留在 `src/js/NDS/`，三屏材质 / 可见性由 `ScreenManager` 协调。`intro:state` 与 `product:mode` 独立；Replay / Skip / Continue 收束和销毁须停止 Intro、装配和屏幕转场时间线。
- Canvas 只占页头下方区域：`Sizes` 观察 Canvas 实际边界，Renderer 用 `setSize(width, height, false)` 只改像素缓冲；射线输入取 Canvas 边界，鼠标伴随笔仍用全页 CSS 坐标，不新增下屏 UV 映射。

## 产品与渲染不变量

- 保持 JavaScript ESM、2 空格、单引号、无分号；坐标 / 矩阵 / 四元数 / TSL / 阻尼注释用中文解释约束。渲染类型从 `three/webgpu`、节点从 `three/tsl` 导入；保持 WebGPU / Node Material / Tweakpane 路线，不默认增加 TypeScript、WebGL 或 GLSL 回退。
- `public/iphone.glb` 的节点和按键名称只在 `ModelAdapter` 集中映射；Pivot、Anchor、Camera 在运行时生成。未经明确要求，不回 Blender 补节点，也不迁移、重命名、压缩或替换用户模型资源。
- GLB Bind Pose 是 180°，首次可见前折到 8°；Unfold / 装配为 110° 平放，Hero / Game Home / Playing 为 120° 并经 `ProductRig.standRoot` 立起 30°。下半屏固定，铰链 Pivot / 长轴从 Hinge 局部包围盒推导；重新挂接须保留世界变换并检查非均匀缩放，展示变换与折叠计算分离。
- Controller 跟随下半屏，GLB 相对矩阵是唯一安装终点；装配滑入已校准为 `-Z`，Replay 先回 110°，结束 / Skip / 销毁保留精确安装矩阵。GSAP 用于离散时间线，ABXY / D-Pad 实时反馈用循环中的阻尼弹簧。
- Phone UI 从 Fold 首帧显示，模糊 / 位移 / 折痕由角度驱动，Screen Wake 不是黑屏点亮。装配期间 `Bottom_Display_Plane` 完全隐藏以露出手机下屏；Lock 后才转场到 Controller UI，结束时隐藏 `Bottom_Screen_Plane`。
- 主机外壳 EXR Lightmap 必须保留 `uv1` / `channel = 1`、`flipY = true`、`LinearSRGBColorSpace`；PNG 仅预览，按键和展示外壳不共用安装态 Lightmap。换配色只更新已有材质颜色，保留磨砂、清漆和按键底色；Controller 样件共享的 GLB Geometry 由 `ModelAdapter` 释放，展示组件只回收自有资源。
- HDR / `scene.environment` 已实测否决（与外壳烘焙重复计光）。`Renderer` 管理透射背景与 GTAO 管线；AO 只通过 `builtinAOContext` 影响间接光，不乘最终屏幕颜色，正常输出只做一次色调映射 / 色彩转换。

## NDS 与资源陷阱

- 资源 URL 统一在 `src/js/sources.js` 声明，以站点根路径引用，组件用 `resources.items` 稳定名称读取。模拟器 JS / WASM 是本地固定上游产物，升级前读 `public/vendor/pilas-melonds/NOTICE.md`，不要把它当 npm 依赖或自行生成的源码。
- 首次 Continue 按需加载 WASM / ROM，保持 Game Home 直到首帧就绪且进入遮罩展开完毕才切 Playing；取消、Replay、失焦和销毁必须使迟到 Promise 失效。Escape / 失焦 / 隐藏暂停并释放输入，Continue 恢复同一会话；音频解锁依赖有效用户激活，手柄不能自行解锁，保留独立启用按钮。
- NDS 上屏映射 `1.4:1`、下屏 `1:1`，4:3 主画面等比显示，余区用同帧整数倍最近邻像素压暗延展。触控复用纹理矩阵且仅响应清晰主画面；上下屏手势让 Orbit 让路。六张封面仅 `game0` 可试玩，持久存档尚未实现。
- `public/nds/` 被生产构建插件排除，生产 / preview 通过文件选择器加载 ROM；但该目录当前有 ROM 被 Git 跟踪，并非忽略项，发布前须核查许可，保持构建排除。`.env.example` 的 `VITE_NDS_ROM_URL` 当前没有源码读取；实际开发测试地址由 `ndsSources.testRom` 决定，不要假定填环境变量即可换游戏。

## Agent skills

### Issue tracker

规格与任务使用 `.scratch/` 中的本地 Markdown 文件。操作约定见 `docs/agents/issue-tracker.md`。

### Triage labels

使用五个默认分类状态，写入任务的 `Status:` 字段。角色映射见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文：根目录 `GLOSSARY.md` 与 `docs/adr/`，按需创建。阅读约定见 `docs/agents/domain.md`。
