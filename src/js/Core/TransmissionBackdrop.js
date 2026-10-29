import { texture } from 'three/tsl'
import * as THREE from 'three/webgpu'

// 适配上游 transmissionBackdrop.js：由 Renderer 显式持有，背景沿用场景，关闭时不做离屏绘制。
export default class TransmissionBackdrop {
  constructor(renderer, scene, camera) {
    this.renderer = renderer
    this.scene = scene
    this.camera = camera
    this.entries = new Set()
    this.size = new THREE.Vector2()
    // 玻璃只占局部展板；半分辨率配合 mipmap 折射，主画面仍保留原始 HDR 与抗锯齿。
    this.params = { resolutionScale: 0.5, backside: false, backsideThickness: 0.0125 }
  }

  createTarget(name) {
    const target = new THREE.RenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: true,
    })
    target.texture.name = name
    return target
  }

  getTextureNode() {
    if (!this.cleanTarget) {
      this.cleanTarget = this.createTarget('Glass_Clean_Backdrop')
      this.textureNode = texture(this.cleanTarget.texture)
      this.textureNode.updateBeforeType = THREE.NodeUpdateType.NONE
      this.resize()
    }
    return this.textureNode
  }

  register(mesh, excludedObjects = []) {
    const entry = { mesh, excludedObjects }
    this.entries.add(entry)
    return () => {
      this.entries.delete(entry)
      if (!this.entries.size)
        this.disposeTargets()
    }
  }

  resize() {
    this.renderer.getDrawingBufferSize(this.size)
    const width = Math.max(2, Math.round(this.size.x * this.params.resolutionScale))
    const height = Math.max(2, Math.round(this.size.y * this.params.resolutionScale))
    this.cleanTarget?.setSize(width, height)
    this.backsideTarget?.setSize(width, height)
  }

  capture() {
    const visible = [...this.entries].filter(({ mesh }) => {
      for (let node = mesh; node; node = node.parent) {
        if (!node.visible)
          return false
      }
      return true
    })
    if (!visible.length)
      return
    this.getTextureNode()
    if (this.params.backside && !this.backsideTarget)
      this.backsideTarget = this.createTarget('Glass_Backside_Backdrop')
    if (!this.params.backside && this.backsideTarget) {
      this.textureNode.value = this.cleanTarget.texture
      this.backsideTarget.dispose()
      this.backsideTarget = null
    }
    this.resize()
    const renderer = this.renderer
    const previous = {
      target: renderer.getRenderTarget(),
      autoClear: renderer.autoClear,
      toneMapping: renderer.toneMapping,
      exposure: renderer.toneMappingExposure,
    }
    const objects = new Map()
    const materials = new Map()
    const hide = (object) => {
      if (!objects.has(object))
        objects.set(object, object.visible)
      object.visible = false
    }
    try {
      for (const { mesh, excludedObjects } of visible) {
        hide(mesh)
        // 贴在玻璃前方的纸签与样件只参加主通道，避免它们再次折射到自己身后。
        for (const object of excludedObjects) hide(object)
      }
      // Three 内建透射（如 GLB 镜头玻璃）共享一张全局视口拷贝；若在缩放后的离屏目标里也绘制，
      // 同帧会按两种尺寸重建该纹理，已编码命令引用的旧纹理被销毁并触发 WebGPU 校验错误。
      this.scene.traverseVisible((object) => {
        const material = object.material
        if (material && !material.isTransmissionGlassMaterial && (material.transmission > 0 || material.transmissionNode))
          hide(object)
      })
      renderer.toneMapping = THREE.NoToneMapping
      renderer.toneMappingExposure = 1
      renderer.autoClear = true
      renderer.setRenderTarget(this.cleanTarget)
      renderer.render(this.scene, this.camera)
      this.textureNode.value = this.cleanTarget.texture
      if (this.params.backside) {
        for (const { mesh } of visible) {
          mesh.visible = true
          const material = mesh.material
          if (!materials.has(material)) {
            materials.set(material, { side: material.side, thickness: material.transmissionUniforms.thickness.value })
            material.side = THREE.BackSide
            material.transmissionUniforms.thickness.value = this.params.backsideThickness
          }
        }
        renderer.setRenderTarget(this.backsideTarget)
        renderer.render(this.scene, this.camera)
        this.textureNode.value = this.backsideTarget.texture
      }
    }
    finally {
      // 包括背面通道失败的路径：恢复所有材质/可见性及线性色彩设置，避免污染主渲染与 HMR。
      for (const [material, state] of materials) {
        material.side = state.side
        material.transmissionUniforms.thickness.value = state.thickness
      }
      for (const [object, value] of objects) object.visible = value
      renderer.setRenderTarget(previous.target)
      renderer.autoClear = previous.autoClear
      renderer.toneMapping = previous.toneMapping
      renderer.toneMappingExposure = previous.exposure
    }
  }

  disposeTargets() {
    this.cleanTarget?.dispose()
    this.backsideTarget?.dispose()
    this.cleanTarget = null
    this.backsideTarget = null
    this.textureNode = null
  }

  destroy() {
    this.disposeTargets()
    this.entries.clear()
  }
}
