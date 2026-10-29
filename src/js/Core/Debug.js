export default class Debug {
  constructor(container) {
    this.container = container
    // 最终展示默认不构造 GUI、辅助几何或调试读数；开发时显式 ?debug 才载入 Tweakpane。
    this.enabled = import.meta.env.DEV && new URLSearchParams(window.location.search).has('debug')
    this.container.hidden = !this.enabled
    this.ui = null
  }

  async init() {
    if (!this.enabled)
      return
    const { Pane } = await import('tweakpane')
    if (this.destroyed)
      return
    this.ui = new Pane({ container: this.container, title: 'iPhone Duo · WebGPU', expanded: false })
  }

  destroy() {
    this.destroyed = true
    this.ui?.dispose()
    this.ui = null
  }
}
