import { gsap } from 'gsap'
import * as THREE from 'three/webgpu'

const THEME_STORAGE_KEY = 'iphone-duo.controller-theme'

export default class ControllerThemes {
  constructor({ product, colorDock, state, events }) {
    this.product = product
    this.colorDock = colorDock
    this.state = state
    this.events = events
    this.classic = product.getControllerColors()
    // 在 Intro 首帧前恢复配色，先保存 GLB 原色，避免把恢复后的颜色误当成 Classic。
    const savedTheme = this.readSavedTheme()
    this.state.controllerTheme = savedTheme.key
    this.product.setControllerColors(this.getTargetColors(savedTheme))
    this.product.controllerShellMaterial.refreshColor()
    this.removeListeners = [
      events.on('controller:theme-request', ({ key }) => this.select(key)),
      events.on('controller:themes-updated', () => this.select(state.controllerTheme, { force: true })),
      events.on('product:mode', () => this.finishTransition()),
    ]
    colorDock.setSelectedTheme(state.controllerTheme)
  }

  select(key, { force = false } = {}) {
    const theme = this.colorDock.themes.find(item => item.key === key)
    if (!theme || this.state.productMode !== 'game-home' || this.state.introState !== 'ready'
      || this.state.ndsStatus === 'loading') {
      return
    }
    if (!force && key === this.state.controllerTheme)
      return

    this.timeline?.kill()
    const from = this.product.getControllerColors()
    const target = this.getTargetColors(theme, { force })
    this.targetColors = target
    const progress = { value: 0 }
    const colors = this.product.getControllerColors()
    const apply = () => {
      // Three.Color 在线性色彩空间插值，避免用十六进制字符串插值造成中间帧亮度跳变。
      colors.shell.lerpColors(from.shell, target.shell, progress.value)
      Object.entries(colors.buttons).forEach(([part, values]) => {
        values.forEach((color, index) => color.lerpColors(from.buttons[part][index], target.buttons[part][index], progress.value))
      })
      this.product.setControllerColors(colors)
    }
    this.state.controllerTheme = key
    this.rememberTheme(key)
    this.colorDock.setSelectedTheme(key)
    this.events.emit('controller:theme', { key, label: theme.label })
    this.timeline = gsap.to(progress, {
      value: 1,
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 0.4,
      ease: 'power2.out',
      onUpdate: apply,
      onComplete: () => this.finishTransition(),
    })
  }

  getTargetColors(theme, { force = false } = {}) {
    const target = {
      shell: new THREE.Color(theme.shell),
      buttons: Object.fromEntries(Object.entries(this.classic.buttons).map(([part, colors]) => [
        part,
        colors.map(() => new THREE.Color(part === 'dpad' ? theme.dpad : theme.buttons)),
      ])),
    }
    // Classic 精确恢复各按键的初始底色，不把多材质或不同 ABXY 原色合并成一枚色值。
    if (theme.key === 'classic' && !force)
      target.buttons = this.classic.buttons
    return target
  }

  readSavedTheme() {
    try {
      const key = window.localStorage.getItem(THEME_STORAGE_KEY)
      return this.colorDock.themes.find(theme => theme.key === key) ?? this.colorDock.themes[0]
    }
    catch {
      // 隐私模式或存储被禁用时使用默认配色，仍允许当前会话正常切换。
      return this.colorDock.themes[0]
    }
  }

  rememberTheme(key) {
    try { window.localStorage.setItem(THEME_STORAGE_KEY, key) }
    catch { /* 存储不可用不影响材质切换。 */ }
  }

  finishTransition() {
    if (!this.targetColors)
      return
    this.timeline?.kill()
    this.timeline = null
    // 精确写入终点，消除插值末帧的浮点余差；重播或进入游戏时也在已选配色收束。
    this.product.setControllerColors(this.targetColors)
    this.product.controllerShellMaterial.refreshColor()
    this.targetColors = null
  }

  destroy() {
    this.timeline?.kill()
    this.targetColors = null
    this.removeListeners.forEach(remove => remove())
  }
}
