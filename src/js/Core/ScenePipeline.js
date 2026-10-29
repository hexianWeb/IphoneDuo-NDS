import { denoise } from 'three/addons/tsl/display/DenoiseNode.js'
import { ao } from 'three/addons/tsl/display/GTAONode.js'
import { builtinAOContext, mrt, normalViewGeometry, pass, rtt, screenUV, vec4 } from 'three/tsl'
import { RedFormat, RenderPipeline, UnsignedByteType, Vector2 } from 'three/webgpu'

export default class ScenePipeline {
  constructor(renderer, scene, camera, debug) {
    this.renderer = renderer
    this.scene = scene
    this.camera = camera
    this.size = new Vector2()
    this.params = {
      enabled: true,
      view: 'scene',
      // 遮蔽集中在接触与缝隙附近，减少白色展台上的大面积灰晕。
      radius: 0.10,
      thickness: 0.40,
      strength: 1.1,
      samples: 32,
      resolutionScale: 1,
      denoiseRadius: 3,
    }

    // 几何法线不含塑料微凹凸；透明转场层不写入遮蔽源，避免淡入时出现黑色轮廓。
    this.prePass = pass(scene, camera, { samples: 0 })
    this.prePass.name = 'GTAO geometry'
    this.prePass.transparent = false
    // PassNode.lighting 是光照管理对象的覆盖入口，不是开关；保留 null 以复用 Renderer。
    this.prePass.setMRT(mrt({ output: normalViewGeometry }))
    const depth = this.prePass.getTextureNode('depth')
    const normal = this.prePass.getTextureNode()

    this.aoPass = ao(depth, normal, camera)
    this.aoPass.useTemporalFiltering = false
    this.rawAO = this.aoPass.getTextureNode()
    this.denoiseNode = denoise(this.rawAO, depth, normal, camera)
    // 全分辨率边缘保持降噪用于半分辨率 AO 上采样；尺度为归一化场景的世界单位。
    this.denoiseNode.depthPhi.value = 0.05
    this.denoiseNode.normalPhi.value = 8
    // 遮蔽结果只读取 r 且范围为 0–1；R8 保留全分辨率，避免用 RGBA16F 存四份灰度。
    this.filteredAO = rtt(this.denoiseNode, null, null, { depthBuffer: false, format: RedFormat, type: UnsignedByteType })
    this.filteredAO.value.name = 'GTAO_Filtered_R8'

    this.scenePass = pass(scene, camera)
    this.scenePass.name = 'Scene with GTAO'
    // 只注入材质的间接光遮蔽，不把 AO 乘到屏幕自发光、背景或直射高光上。
    this.scenePass.contextNode = builtinAOContext(this.filteredAO.sample(screenUV).r)
    this.pipeline = new RenderPipeline(renderer)
    this.applySettings()
    this.setOutput()
    this.debugInit(debug)
  }

  applySettings() {
    this.aoPass.radius.value = this.params.radius
    this.aoPass.thickness.value = this.params.thickness
    this.aoPass.scale.value = this.params.strength
    this.aoPass.samples.value = this.params.samples
    this.aoPass.resolutionScale = this.params.resolutionScale
    this.denoiseNode.radius.value = this.params.denoiseRadius
    this.resize()
  }

  setOutput() {
    const preview = this.params.view !== 'scene'
    const texture = this.params.view === 'raw' ? this.rawAO : this.filteredAO
    this.pipeline.outputNode = preview ? vec4(texture.r, texture.r, texture.r, 1) : this.scenePass
    // 正常画面仅由 RenderPipeline 做一次 ACES / 色彩转换；AO 诊断显示原始遮蔽值。
    this.pipeline.outputColorTransform = !preview
    this.pipeline.needsUpdate = true
  }

  update() {
    if (this.params.enabled)
      this.pipeline.render()
    // 完全旁路预通道与 AO，关闭时也能比较真实 GPU 开销。
    else this.renderer.render(this.scene, this.camera)
  }

  resize() {
    this.renderer.getDrawingBufferSize(this.size)
    const width = Math.max(2, this.size.x)
    const height = Math.max(2, this.size.y)
    // 输入已包含 DPR，不能再次乘 pixelRatio；节点逐帧还会自动同步实际绘图尺寸。
    this.prePass.setSize(width, height)
    this.scenePass.setSize(width, height)
    this.aoPass.setSize(width, height)
    this.filteredAO.setSize(width, height)
  }

  debugInit(debug) {
    if (!debug?.ui)
      return
    this.folder = debug.ui.addFolder({ title: 'GTAO', expanded: false })
    this.folder.addBinding(this.params, 'enabled', { label: 'Enabled' })
    this.folder.addBinding(this.params, 'view', {
      label: 'View',
      options: { 'Scene': 'scene', 'Raw AO': 'raw', 'Denoised AO': 'filtered' },
    }).on('change', () => this.setOutput())
    const ranges = {
      radius: { min: 0.01, max: 0.5, step: 0.005 },
      thickness: { min: 0.005, max: 0.5, step: 0.005 },
      strength: { min: 0, max: 3, step: 0.05 },
      samples: { options: { Low: 8, Medium: 16, High: 32 } },
      resolutionScale: { options: { Half: 0.5, Full: 1 } },
      denoiseRadius: { min: 1, max: 8, step: 0.5 },
    }
    for (const [key, options] of Object.entries(ranges)) {
      this.folder.addBinding(this.params, key, options).on('change', () => this.applySettings())
    }
  }

  destroy() {
    this.folder?.dispose()
    // RenderPipeline 不递归释放节点，必须逐个释放本组件拥有的目标、噪声纹理和材质。
    this.pipeline.dispose()
    this.scenePass.dispose()
    this.filteredAO.dispose()
    this.denoiseNode.dispose()
    this.aoPass.dispose()
    this.prePass.dispose()
  }
}
