import * as THREE from 'three/webgpu'
import Experience from '../Experience.js'
import PipelinePreparation from './PipelinePreparation.js'
import ScenePipeline from './ScenePipeline.js'
import ShadowUpdateTracker from './ShadowUpdateTracker.js'
import TransmissionBackdrop from './TransmissionBackdrop.js'

export default class Renderer {
  constructor() {
    this.experience = new Experience()
    this.canvas = this.experience.canvas
    this.scene = this.experience.scene
    this.camera = this.experience.camera
    this.sizes = this.experience.sizes
  }

  async init() {
    this.instance = new THREE.WebGPURenderer({
      antialias: true,
      canvas: this.canvas,
      forceWebGL: false,
    })
    this.instance.toneMapping = THREE.ACESFilmicToneMapping
    this.instance.toneMappingExposure = 1.03
    this.instance.shadowMap.enabled = true
    // r186 起 WebGPURenderer 已移除 PCFSoftShadowMap，PCFShadowMap 现在就是软阴影
    this.instance.shadowMap.type = THREE.PCFShadowMap
    this.resize()
    await this.instance.init()
    if (this.destroyed || this.experience.destroyed) {
      this.instance.dispose()
      return
    }
    this.instance.info.autoReset = false
    this.pipeline = new ScenePipeline(this.instance, this.scene, this.camera.instance, this.experience.debug)
    this.transmissionBackdrop = new TransmissionBackdrop(this.instance, this.scene, this.camera.instance)
    this.shadowTracker = new ShadowUpdateTracker({ renderer: this.instance, scene: this.scene, camera: this.camera.instance, debug: this.experience.debug })
    this.preparation = new PipelinePreparation(this.instance)
  }

  setExposure(value) {
    this.instance.toneMappingExposure = value
  }

  async initPointerOverlay({ canvas, scene, camera, surfaceWidth, surfaceHeight }) {
    // 小型透明画布和主渲染器共享 GPUDevice，独立灯光让白色笔身不受展区镜头/后处理影响。
    const instance = new THREE.WebGPURenderer({
      canvas,
      alpha: true,
      antialias: true,
      forceWebGL: false,
      device: this.instance.backend.device,
    })
    const overlay = { instance, scene, camera, canvas, ready: false, surfaceWidth, surfaceHeight }
    this.pointerOverlay = overlay
    instance.toneMapping = THREE.ACESFilmicToneMapping
    instance.toneMappingExposure = 0.95
    instance.setClearColor(0x000000, 0)
    instance.setPixelRatio(this.sizes.pixelRatio)
    instance.setSize(surfaceWidth, surfaceHeight, false)
    await instance.init()
    if (this.destroyed) {
      instance.dispose()
      return
    }
    await instance.compileAsync(scene, camera)
    if (this.destroyed) {
      instance.dispose()
      return
    }
    overlay.ready = true
    instance.render(scene, camera)
  }

  update() {
    // 游戏进入时的兜底预热也复用此流程；唯一循环继续更新输入，但不抢先同步创建 GPU 管线。
    if (this.preparing)
      return
    this.renderFrame()
  }

  renderFrame() {
    this.instance.info.reset()
    this.shadowTracker.beginFrame()
    const matrixWorldAutoUpdate = this.scene.matrixWorldAutoUpdate
    // 阴影、透射和 GTAO 共用上方已更新的世界矩阵，避免每个 pass 再遍历整棵展区层级。
    this.scene.matrixWorldAutoUpdate = false
    try {
      if (!this.pipeline.params.enabled || this.pipeline.params.view === 'scene') {
        this.shadowTracker.withoutShadowUpdates(() => this.transmissionBackdrop.capture())
      }
      this.pipeline.update()
    }
    finally {
      this.scene.matrixWorldAutoUpdate = matrixWorldAutoUpdate
    }
    // 与主场景共用 Experience 循环，不另起 rAF；透明小画布只绘制鼠标伴随模型。
    if (this.pointerOverlay?.ready && !this.pointerOverlay.canvas.hidden) {
      const { instance, scene, camera } = this.pointerOverlay
      const stylus = this.experience.world?.stylus
      if (!stylus?.consumeRenderRequest || stylus.consumeRenderRequest())
        instance.render(scene, camera)
    }
  }

  async warmup() {
    const stopped = () => this.destroyed || this.experience.destroyed
    if (stopped())
      return false
    if (this.preparing)
      throw new Error('渲染预热不能并行执行。')
    this.preparing = true
    const monitor = this.experience.performanceMonitor
    const now = () => monitor ? performance.now() : 0
    const startedAt = now()
    const timings = { phase: monitor?.phase, compileMs: 0, stabilizationCompileMs: 0, renderSubmitMs: 0, pipelineWaitMs: 0, queueWaitMs: 0, preparationPasses: 0, preparedPipelines: 0, resizeRestarts: 0 }
    try {
      let needsShadowSeed = false
      this.scene.traverseVisible((object) => {
        if (object.isLight && object.castShadow && object.shadow && !object.shadow.map)
          needsShadowSeed = true
      })
      let seed = null
      if (needsShadowSeed) {
        this.scene.traverseVisible((object) => {
          if (seed || !object.isMesh || !object.receiveShadow || !object.layers.test(this.camera.instance.layers))
            return
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          if (materials.some(material => material.visible && (material.lights === true || material.isMeshStandardMaterial || material.isMeshPhysicalMaterial || material.isMeshLambertMaterial || material.isMeshPhongMaterial || material.isMeshToonMaterial)))
            seed = object
        })
      }
      const frustumCulled = seed?.frustumCulled
      if (seed)
        seed.frustumCulled = false
      try {
        if (seed) {
          // 仅借一个有光照的接收物创建 ShadowNode；其余材质直接预热实际 MRT/AO/透射管线，
          // 避免先编译整场不会使用的默认 ACES 主画面变体及每个物体的异步阶段等待。
          await this.instance.compileAsync(seed, this.camera.instance, this.scene)
          if (stopped())
            return false
          timings.compileMs = now() - startedAt
        }
        const shadowBindingsChanged = this.initShadowRenderTargets()
        if (seed && shadowBindingsChanged) {
          const stabilizeStartedAt = now()
          await this.instance.compileAsync(seed, this.camera.instance, this.scene)
          if (stopped())
            return false
          timings.stabilizationCompileMs = now() - stabilizeStartedAt
        }
      }
      finally {
        if (seed)
          seed.frustumCulled = frustumCulled
      }
      do {
        // 收集真实离屏/MRT/AO/透明管线，异步并行准备；普通 scene compile 不覆盖这些上下文。
        const prepared = await this.preparation.run(() => {
          // 第一轮尚未 ready 的投影物可能被跳过；跨帧重绘必须强制刷新阴影，不能复用空图。
          this.shadowTracker.invalidated = true
          this.renderFrame()
        })
        if (!prepared.completed || stopped())
          return false
        timings.renderSubmitMs += prepared.renderSubmitMs
        timings.pipelineWaitMs += prepared.pipelineWaitMs
        timings.queueWaitMs += prepared.queueWaitMs
        timings.preparationPasses += prepared.passes
        timings.preparedPipelines += prepared.pipelines
        if (!this.resizeRequested)
          break
        // 尺寸变更只在队列已完成后应用，避免销毁当前编码/编译引用的透射或深度附件。
        this.resizeRequested = false
        this.applySize()
        timings.resizeRestarts++
      } while (!stopped())
      if (stopped())
        return false
      timings.totalMs = now() - startedAt
      monitor?.recordWarmup?.(timings)
      return true
    }
    catch (error) {
      if (stopped())
        return false
      throw error
    }
    finally {
      this.preparing = false
    }
  }

  initShadowRenderTargets() {
    let bindingsChanged = false
    this.scene.traverseVisible((object) => {
      if (!object.isLight || !object.castShadow || !object.shadow?.map)
        return
      const target = object.shadow.map
      const version = target.depthTexture?.version
      // compileAsync 只上传采样纹理；首次作为附件初始化会改变 depth generation。
      // 必须在透射捕获编码之前完成，防止 binding 继续引用被重建的 ShadowDepthTexture。
      target.setSize(object.shadow.mapSize.x, object.shadow.mapSize.y, target.depth)
      this.instance.initRenderTarget(target)
      if (target.depthTexture?.version !== version)
        bindingsChanged = true
    })
    return bindingsChanged
  }

  resize() {
    if (this.preparing) {
      this.resizeRequested = true
      return
    }
    this.applySize()
  }

  applySize() {
    this.instance.setPixelRatio(this.sizes.pixelRatio)
    // CSS 决定页头下方的可用区域，渲染器仅更新像素缓冲，避免反过来撑大 Flex 画布。
    this.instance.setSize(this.sizes.width, this.sizes.height, false)
    this.pipeline?.resize()
    this.transmissionBackdrop?.resize()
    if (this.pointerOverlay?.ready) {
      const { instance, surfaceWidth, surfaceHeight } = this.pointerOverlay
      instance.setPixelRatio(this.sizes.pixelRatio)
      instance.setSize(surfaceWidth, surfaceHeight, false)
      if (this.experience.world?.stylus)
        this.experience.world.stylus.renderRequested = true
    }
  }

  destroy() {
    this.destroyed = true
    this.preparation?.destroy()
    // 共享 Device 的次级渲染器先释放；只有主渲染器负责最终销毁 Device。
    if (this.pointerOverlay?.ready)
      this.pointerOverlay.instance.dispose()
    if (!this.instance)
      return

    this.instance.setAnimationLoop(null)
    this.pipeline?.destroy()
    this.shadowTracker?.destroy()
    this.transmissionBackdrop?.destroy()
    this.instance.dispose()
  }
}
