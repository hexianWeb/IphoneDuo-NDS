export default class Sizes {
  constructor(canvas) {
    this.canvas = canvas
    this.resizeCallbacks = new Set()
    this.handleResize = this.handleResize.bind(this)

    this.updateValues()
    // 页头在文档流内占位；观察画布本身，使显隐与响应式高度变化也走同一 resize 路径。
    this.observer = new ResizeObserver(this.handleResize)
    this.observer.observe(this.canvas)
    window.addEventListener('resize', this.handleResize)
  }

  updateValues() {
    const bounds = this.canvas.getBoundingClientRect()
    this.width = Math.max(1, bounds.width)
    this.height = Math.max(1, bounds.height)
    this.pixelRatio = Math.min(window.devicePixelRatio, 2)
  }

  handleResize() {
    const { width, height, pixelRatio } = this
    this.updateValues()
    if (width === this.width && height === this.height && pixelRatio === this.pixelRatio)
      return
    this.resizeCallbacks.forEach(callback => callback(this))
  }

  onResize(callback) {
    this.resizeCallbacks.add(callback)
    return () => this.resizeCallbacks.delete(callback)
  }

  destroy() {
    this.observer.disconnect()
    window.removeEventListener('resize', this.handleResize)
    this.resizeCallbacks.clear()
  }
}
