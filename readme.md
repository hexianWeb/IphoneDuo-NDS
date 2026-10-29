# iPhone Duo · WebGPU

基于 Three.js WebGPU 的 iPhone Duo 双屏掌机交互原型。

当前阶段已经建立 `Experience` 单例与 Class 组件架构，并通过统一资源系统加载 `public/iphone.glb`。模型节点、基础变换和线框模式可在 Tweakpane 中检查。

无需构建处理的公共资源请放在 `public/` 目录中。

## 开发

``` bash
npm install
npm run dev
npm run build
```

请使用支持 WebGPU 的最新版浏览器访问开发地址。

### 离线展品标签

标签 PNG 已生成在 `public/labels/`，日常 `dev/build` 不需要 Chrome。修改标签文案/排版后，在 Windows 参考字体环境中重新生成：

```powershell
node scripts/generate-labels.mjs 'C:/Program Files/Google/Chrome/Application/chrome.exe' 'C:/Users/f1686533/AppData/Local/Temp/opencode'
node scripts/verify-labels.mjs
```

第二个参数可换成其它**已有**临时目录。追加 `--check` 可检查重新生成是否一致。常规标签与三套 Dock 选中状态直接加载图片，只有自定义调色才按需创建 Canvas。绘图源、验收与性能边界见 [标签离线化记录](docs/LABEL_TEXTURE_OPTIMIZATION_2026-10-29.md)。

## 在 3D 产品中游玩 NDS

运行 `npm run dev`，打开首页，等待 Intro 完成（或在 Tweakpane 中点击 `Skip Intro`）。

1. 点击 Controller 屏幕中的 Continue、左下角 Continue 按钮，或按 `Enter`。开发环境首次进入会按需载入 `public/nds` 的测试 ROM；也可以选择本地 `.nds` 文件。
2. 游戏上下屏显示在产品的 Top Screen 与 Controller Display 上，保持 4:3 等比留黑；手机原生下屏隐藏。
3. `X / Z` 对应 A / B，方向键移动，`S / A` 对应 X / Y，`Q / W` 对应 L / R，`Enter / Shift` 对应 Start / Select；点击或拖动 3D 下屏进行触控。
4. 支持标准 Gamepad：方向键/左摇杆移动，右/下/上/左面键对应 DS 的 A/B/X/Y，肩键对应 L/R，菜单键对应 Start/Select。
5. `Escape` 或「暂停 / 返回」回到 Game Home 并暂停；再次 Continue 恢复同一会话。窗口失焦/隐藏也会自动返回并释放输入。

点击或键盘 Continue 会尝试启用音频；手柄进入或文件选择后若未启用，可点击「启用声音」。左下角显示模拟帧率、速度、核心耗时与场景帧率。

当前会话保留到页面刷新或重新选择 ROM 为止，尚未接入持久存档与 3D 按键弹簧反馈。

## 独立 NDS 最小接入验证

运行 `npm run dev`，打开开发地址下的 **`/nds-test.html`**。

1. 点击「载入 public/nds 测试游戏」，读取本地提供的《Pokemon Platinum》ROM；也可使用文件选择器载入 `.nds`。
2. 点击「启用声音」，再点击下屏进行游戏操作。
3. 方向键移动；`X / Z` 对应 A / B；`S / A` 对应 X / Y；`Q / W` 对应 L / R；`Enter` 为 Start；`Shift` 为 Select；`Escape` 暂停 / 继续。
4. 下屏支持点击和拖动；切换窗口自动暂停，点击「继续」恢复。

此页面保留独立双屏 Canvas 输出，方便与首页的 3D 合并负载做对照，不持久保存游戏存档。

`public/nds/` 仅用于本地验证，已从 Git 和生产构建中排除；`npm run preview` 下可通过文件选择器测试。模拟器文件固定到上游 commit，并从本地 `public/vendor/pilas-melonds/` 加载。

可选的真实 WASM / ROM 核心检查（不替代浏览器实测）：

```bash
node scripts/verify-nds.mjs "public/nds/Pokemon - Platinum Version (USA) (Rev 1).nds"
node scripts/verify-nds-mapping.mjs
```

接入边界与验证记录见 [NDS 最小验证记录](docs/NDS_Integration_Spike.md)。
