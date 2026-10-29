import { uniform } from 'three/tsl'
import * as THREE from 'three/webgpu'
import { exhibitionFloorNodes } from '../../../shaders/exhibitionFloor.js'
import Experience from '../../Experience.js'
import { createCycloramaGeometry } from './exhibitionGeometry.js'

// 地面与弧墙共用材质和连续剖面。此节点独立挂 Scene，不参与产品缩放、折叠或装配。
export default class Stage {
  constructor({ surfaceY, textures }) {
    const experience = new Experience()
    this.scene = experience.scene
    this.debug = experience.debug
    this.surfaceY = surfaceY
    this.textures = this.configureTextures(textures)
    this.params = {
      visible: true,
      width: 40,
      depth: 20,
      wallRadius: 3,
      wallHeight: 16,
      tint: '#f0f1f2',
      colorMapStrength: 0.12,
      // 沿用现有 PBR 贴图，减弱大尺度凹凸，让宽面光的柔和高光保留在半哑光地面上。
      roughness: 0.55,
      normalScale: 0.07,
      tileSize: 2,
      gridOpacity: 0.21,
      gridSpacing: 0.75,
      gridFade: 7,
      haloStrength: 0.22,
      haloColor: '#f4f4f0',
      haloScaleX: 0.85,
      haloScaleZ: 0.85,
      haloOffsetX: 0,
      haloOffsetZ: 0,
      ringStrength: 0.35,
      ringWidth: 0.004,
      ringColor: '#ffe4b5',
    }
    this.layout = { centerX: 0, centerZ: 0, width: 3, depth: 3, enabled: true }
    this.uniforms = {
      center: uniform(new THREE.Vector2()),
      haloAxes: uniform(new THREE.Vector2()),
    }
    for (const key of ['tint', 'haloColor', 'ringColor']) this.uniforms[key] = uniform(new THREE.Color(this.params[key]))
    for (const key of ['colorMapStrength', 'gridOpacity', 'gridSpacing', 'gridFade', 'haloStrength', 'ringStrength', 'ringWidth']) {
      this.uniforms[key] = uniform(this.params[key])
    }
    const nodes = exhibitionFloorNodes(this.textures.color, this.uniforms)
    this.material = new THREE.MeshStandardNodeMaterial({
      colorNode: nodes.color,
      emissiveNode: nodes.emissive,
      normalMap: this.textures.normal,
      roughnessMap: this.textures.roughness,
      roughness: this.params.roughness,
      metalness: 0,
      name: 'Exhibition_Floor_And_Cyclorama',
    })
    this.material.normalScale.setScalar(this.params.normalScale)
    this.applyRepeat()
    this.mesh = new THREE.Mesh(this.createGeometry(), this.material)
    this.mesh.name = 'ExhibitionCyclorama'
    this.mesh.receiveShadow = true
    this.mesh.position.y = surfaceY
    this.scene.add(this.mesh)
    this.applyUniforms()
    this.debugInit()
  }

  configureTextures(textures) {
    for (const key of ['color', 'normal', 'roughness']) {
      if (!textures?.[key]?.isTexture)
        throw new Error(`Stage 缺少塑料贴图：${key}`)
    }
    textures.color.colorSpace = THREE.SRGBColorSpace
    textures.normal.colorSpace = THREE.NoColorSpace
    textures.roughness.colorSpace = THREE.NoColorSpace
    for (const texture of Object.values(textures)) {
      texture.wrapS = THREE.RepeatWrapping
      texture.wrapT = THREE.RepeatWrapping
      texture.anisotropy = 8
    }
    return textures
  }

  applyRepeat() {
    // 剖面 UV 已以世界长度计量，repeat 只表达每块纹理覆盖的物理尺度。
    for (const texture of Object.values(this.textures)) texture.repeat.setScalar(1 / this.params.tileSize)
  }

  createGeometry() {
    const p = this.params
    return createCycloramaGeometry(p.width, p.depth, p.wallRadius, p.wallHeight)
  }

  rebuildGeometry() {
    this.mesh.geometry.dispose()
    this.mesh.geometry = this.createGeometry()
  }

  setExhibitionLayout({ floorY, ...layout }) {
    this.surfaceY = floorY
    Object.assign(this.layout, layout)
    this.mesh.position.y = floorY
    this.applyUniforms()
  }

  applyUniforms() {
    const p = this.params
    const u = this.uniforms
    for (const key of ['tint', 'haloColor', 'ringColor']) u[key].value.set(p[key])
    for (const key of ['colorMapStrength', 'gridOpacity', 'gridSpacing', 'gridFade', 'haloStrength', 'ringStrength', 'ringWidth']) u[key].value = p[key]
    u.center.value.set(this.layout.centerX + p.haloOffsetX, this.layout.centerZ + p.haloOffsetZ)
    u.haloAxes.value.set(this.layout.width * p.haloScaleX, this.layout.depth * p.haloScaleZ)
    if (!this.layout.enabled) {
      u.haloStrength.value = 0
      u.ringStrength.value = 0
    }
  }

  debugInit() {
    if (!this.debug.ui)
      return
    this.folder = this.debug.ui.addFolder({ title: 'Stage / Cyclorama', expanded: false })
    this.folder.addBinding(this.params, 'visible', { label: 'Visible' })
      .on('change', ({ value }) => { this.mesh.visible = value })
    this.folder.addBinding(this.params, 'tint', { label: 'Floor color' }).on('change', () => this.applyUniforms())
    this.folder.addBinding(this.params, 'colorMapStrength', { label: 'Color texture', min: 0, max: 1, step: 0.01 })
      .on('change', () => this.applyUniforms())
    this.folder.addBinding(this.params, 'roughness', { min: 0.2, max: 1.5, step: 0.01 })
      .on('change', ({ value }) => { this.material.roughness = value })
    this.folder.addBinding(this.params, 'normalScale', { min: 0, max: 1, step: 0.01 })
      .on('change', ({ value }) => this.material.normalScale.setScalar(value))
    this.folder.addBinding(this.params, 'tileSize', { min: 0.25, max: 8, step: 0.05 })
      .on('change', () => this.applyRepeat())
    const shape = this.folder.addFolder({ title: 'Continuous backdrop' })
    for (const [key, min, max] of [['width', 12, 40], ['depth', 12, 32], ['wallRadius', 1, 5], ['wallHeight', 6, 16]]) {
      shape.addBinding(this.params, key, { min, max, step: 0.1 }).on('change', () => this.rebuildGeometry())
    }
    const effects = this.folder.addFolder({ title: 'Grid / Halo' })
    const ranges = {
      gridOpacity: [0, 0.25, 0.005],
      gridSpacing: [0.1, 2, 0.05],
      gridFade: [1, 12, 0.1],
      haloStrength: [0, 0.8, 0.01],
      haloScaleX: [0.5, 1.3, 0.01],
      haloScaleZ: [0.5, 1.3, 0.01],
      haloOffsetX: [-2, 2, 0.01],
      haloOffsetZ: [-2, 2, 0.01],
      ringStrength: [0, 3, 0.05],
      ringWidth: [0.001, 0.03, 0.001],
    }
    for (const [key, [min, max, step]] of Object.entries(ranges)) {
      effects.addBinding(this.params, key, { min, max, step }).on('change', () => this.applyUniforms())
    }
    for (const key of ['haloColor', 'ringColor']) effects.addBinding(this.params, key).on('change', () => this.applyUniforms())
  }

  destroy() {
    this.folder?.dispose()
    this.scene.remove(this.mesh)
    this.mesh.geometry.dispose()
    this.material.dispose()
    Object.values(this.textures).forEach(texture => texture.dispose())
  }
}
