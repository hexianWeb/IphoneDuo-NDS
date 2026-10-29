import * as THREE from 'three/webgpu'
import Camera from './Core/Camera.js'
import Debug from './Core/Debug.js'
import Renderer from './Core/Renderer.js'
import EventBus from './Utils/EventBus.js'
import Resources from './Utils/Resources.js'
import Sizes from './Utils/Sizes.js'
import State from './Utils/State.js'
import Time from './Utils/Time.js'
import World from './World/World.js'
import sources from './sources.js'

export default class Experience {
  static instance

  constructor(options = {}) {
    if (Experience.instance) return Experience.instance

    if (!options.canvas) {
      throw new Error('首次创建 Experience 时必须提供 Canvas。')
    }

    Experience.instance = this
    this.canvas = options.canvas
    this.debugPanel = options.debugPanel
    this.events = new EventBus()
    this.state = new State()
    this.sizes = new Sizes(this.canvas)
    this.time = new Time()
    this.scene = new THREE.Scene()
    this.debug = new Debug(this.debugPanel)
    this.update = this.update.bind(this)
    this.resize = this.resize.bind(this)
    this.removeResizeListener = this.sizes.onResize(this.resize)
    this.initialized = false
    this.destroyed = false
  }

  async init() {
    if (this.initialized) return this

    await this.debug.init()
    if (this.destroyed) return this
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('performance')) {
      const { default: PerformanceMonitor } = await import('./Core/PerformanceMonitor.js')
      if (this.destroyed) return this
      this.performanceMonitor = new PerformanceMonitor({ canvas: this.canvas, events: this.events, state: this.state })
    }
    this.camera = new Camera()
    this.renderer = new Renderer()
    this.events.emit('experience:phase', { phase: 'renderer' })
    await this.renderer.init()
    if (this.destroyed) return this

    this.resources = new Resources(sources)
    this.events.emit('experience:phase', { phase: 'resources' })
    await this.resources.load()
    if (this.destroyed) return this

    this.events.emit('experience:phase', { phase: 'scene' })
    this.world = new World()
    await this.renderer.initPointerOverlay(this.world.stylus)
    if (this.destroyed) return this
    // 在 Loading 内预热真实 Phone / Controller / NDS 与离屏通道，不把首次管线编译留到动画切换。
    const prepared = await this.world.preparePresentation()
    if (this.destroyed) return this
    if (!prepared) throw new Error('产品渲染管线准备未完成。')
    this.performanceMonitor?.loaded()
    this.renderer.instance.setAnimationLoop(this.update)
    this.world.start()
    this.initialized = true
    return this
  }

  update() {
    if (document.hidden || this.destroyed) return
    this.performanceMonitor?.beginFrame()
    this.time.update()
    this.world.update()
    this.camera.update()
    this.performanceMonitor?.updated()
    this.renderer.update()
    this.performanceMonitor?.endFrame(this.renderer)
  }

  resize() {
    this.camera?.resize()
    this.world?.resize()
    this.renderer?.resize()
  }

  destroy() {
    if (this.destroyed) return

    this.destroyed = true
    this.removeResizeListener?.()
    this.renderer?.instance?.setAnimationLoop(null)
    this.world?.destroy()
    this.performanceMonitor?.destroy()
    this.camera?.destroy()
    this.renderer?.destroy()
    this.debug?.destroy()
    this.time.destroy()
    this.sizes.destroy()
    this.events.destroy()
    this.scene.clear()
    Experience.instance = null
  }
}
