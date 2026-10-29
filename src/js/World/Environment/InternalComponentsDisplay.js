import * as THREE from 'three/webgpu'
import ExhibitLabel from './ExhibitLabel.js'
import { createPlinthGeometry } from './exhibitionGeometry.js'
import { exhibitLabelLayout, internalComponents as COMPONENTS } from './exhibitLabelLayout.js'

// detail.glb 的三个根节点共用原点；语义映射集中在展品组件，独立摆放不影响产品 Rig。
export default class InternalComponentsDisplay {
  constructor({ gltf, debug, onLayout, labelTextures }) {
    if (!gltf?.scene) throw new Error('controllerDetailModel 未返回有效的 GLTF Scene')
    for (const { node } of COMPONENTS) {
      if (!gltf.scene.getObjectByName(node)) throw new Error(`内部元件模型缺少节点：${node}`)
    }
    this.onLayout = onLayout
    this.params = {
      visible: true,
      x: -1.5,
      z: 0.24,
      yaw: 16,
      scale: 1.21,
      inclination: 30,
      floatHeight: 0.028,
      bobAmplitude: 0.0045,
      bobSpeed: 0.9,
    }
    this.group = new THREE.Group()
    this.group.name = 'InternalComponentsDisplay'
    this.geometries = new Set()
    this.materials = new Set()
    this.textures = new Set()
    this.materialCopies = new Map()
    this.labels = []
    this.components = []
    gltf.scene.traverse(mesh => {
      if (!mesh.isMesh) return
      this.geometries.add(mesh.geometry)
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        this.materials.add(material)
        for (const value of Object.values(material)) {
          if (value?.isTexture) this.textures.add(value)
        }
      }
    })
    const white = new THREE.MeshStandardNodeMaterial({ color: '#e8eaec', roughness: 0.6, metalness: 0 })
    const seat = new THREE.MeshStandardNodeMaterial({ color: '#dce1e5', roughness: 0.68, metalness: 0 })
    this.materials.add(white)
    this.materials.add(seat)
    this.addMesh(this.group, 'InternalComponentsBase', createPlinthGeometry(0.94, 0.36, 0.025, 0.028, 0.003), white, [0, 0.0125, 0])
    this.support = this.addMesh(this.group, 'InternalComponentsSupport', new THREE.BufferGeometry(), white)
    this.deck = new THREE.Group()
    this.deck.name = 'InternalComponentsDeck'
    this.group.add(this.deck)
    this.addMesh(this.deck, 'InternalComponentsTop', createPlinthGeometry(0.91, 0.32, 0.012, 0.02, 0.002), white)

    gltf.scene.updateMatrixWorld(true)
    for (const component of COMPONENTS) {
      const display = this.createComponent(gltf.scene.getObjectByName(component.node), component)
      const depth = Math.max(0.24, display.size.z + 0.016)
      const width = Math.max(0.17, display.size.x + 0.022)
      // 承托面固定在倾斜展板上，元件只沿父级局部 +Y 法线悬浮，保留与展板平行的姿态。
      this.addMesh(this.deck, `${component.node}_Seat`, createPlinthGeometry(width, depth, 0.004, 0.009, 0.0007), seat, [component.x, 0.008, -0.026])
      display.group.position.set(component.x, 0.011, -0.026)
      this.deck.add(display.group)
      this.components.push(display.group)
    }
    this.createLabels(labelTextures)
    this.update(0)
    this.applyInclination()
    this.debugInit(debug)
  }

  addMesh(parent, name, geometry, material, position = [0, 0, 0]) {
    this.geometries.add(geometry)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = name
    mesh.position.set(...position)
    mesh.castShadow = true
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }

  createComponent(source, { node, width, depth }) {
    const group = new THREE.Group()
    group.name = `InternalComponent_${node}`
    const model = source.clone(true)
    // 保留 GLB 根节点及子 Mesh 的导出矩阵，包括非均匀缩放；归一化只在外层做等比变换。
    model.matrix.copy(source.matrixWorld)
    model.matrixAutoUpdate = false
    const normalization = new THREE.Group()
    normalization.add(model)
    const bounds = new THREE.Box3().setFromObject(model, true)
    const size = bounds.getSize(new THREE.Vector3())
    const fit = Math.min(width / size.x, depth / size.z)
    if (!Number.isFinite(fit) || fit <= 0) throw new Error(`内部元件 ${node} 缺少有效展示尺寸`)
    const center = bounds.getCenter(new THREE.Vector3())
    normalization.scale.setScalar(fit)
    normalization.position.set(-center.x * fit, -bounds.min.y * fit, -center.z * fit)
    group.add(normalization)
    model.traverse(mesh => {
      if (!mesh.isMesh) return
      mesh.castShadow = true
      mesh.receiveShadow = true
      const convert = material => {
        if (!this.materialCopies.has(material)) {
          const copy = material.isMeshPhysicalMaterial
            ? new THREE.MeshPhysicalNodeMaterial().copy(material)
            : new THREE.MeshStandardNodeMaterial().copy(material)
          copy.name = `${material.name}_InternalComponent`
          // 场景没有 IBL；CPU 导出金属度为 1 时顶盖只反射直接光而近乎发黑。
          // 展示副本保留原底色/ORM/法线，保留一部分漫反射让银色顶盖和丝印在现有灯光下可读。
          if (node === 'cpu' && material.name === 'material') copy.metalness = 0.45
          this.materialCopies.set(material, copy)
          this.materials.add(copy)
        }
        return this.materialCopies.get(material)
      }
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(convert) : convert(mesh.material)
    })
    return { group, size: size.multiplyScalar(fit) }
  }

  createLabels(labelTextures) {
    this.legend = new ExhibitLabel({ ...exhibitLabelLayout.internalLegend, texture: labelTextures.legend })
    this.group.add(this.legend.mesh)
    this.labels.push(this.legend)
    const names = new ExhibitLabel({ ...exhibitLabelLayout.internalNames, texture: labelTextures.names })
    // alphaTest 的硬阈值会把 PNG 字形的半透明抗锯齿边缘切掉；此静态文字保留平滑 Alpha。
    // 关闭深度写入，仍做深度测试，并沿法线留间距，避免薄标签挡住元件或与顶板争用深度。
    names.material.alphaTest = 0
    names.material.transparent = true
    names.material.depthWrite = false
    names.mesh.rotation.x = -Math.PI / 2
    names.mesh.position.set(0, 0.007, 0.126)
    this.deck.add(names.mesh)
    this.labels.push(names)
  }

  applyInclination() {
    const angle = THREE.MathUtils.degToRad(this.params.inclination)
    const frontHeight = 0.06
    const halfDepth = 0.16
    // +X 倾斜令后缘（-Z）升高、法线朝向访客（+Z）；楔形支座顶面和顶板下表面共用同一平面。
    const centerY = frontHeight + halfDepth * Math.sin(angle)
    this.deck.rotation.x = angle
    this.deck.position.y = centerY
    const shape = new THREE.Shape()
    // 支座前后范围随顶板的水平投影收缩，给圆角与厚度留余量，最大倾角时也不从板边穿出。
    const supportDepth = 0.15 * Math.cos(angle) - 0.006 * Math.sin(angle)
    const undersideY = centerY - 0.006 / Math.cos(angle)
    shape.moveTo(-supportDepth, 0.022)
    shape.lineTo(supportDepth, 0.022)
    shape.lineTo(supportDepth, undersideY + supportDepth * Math.tan(angle))
    shape.lineTo(-supportDepth, undersideY - supportDepth * Math.tan(angle))
    shape.closePath()
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.87, bevelEnabled: false, steps: 1 })
    // Shape 的 X 用作前后距离，Extrude 的 Z 用作展台宽度；转到世界 XZ 后支座底面仍为常量 Y。
    geometry.translate(0, 0, -0.435)
    geometry.rotateY(Math.PI / 2)
    this.geometries.delete(this.support.geometry)
    this.support.geometry.dispose()
    this.support.geometry = geometry
    this.geometries.add(geometry)
    const supportFrontY = undersideY - supportDepth * Math.tan(angle)
    this.legend.mesh.position.set(0, (0.025 + supportFrontY) / 2, supportDepth + 0.001)
    this.onLayout?.()
  }

  setLayout({ width, depth, centerX, centerZ, floorY }) {
    this.layout = { width, depth, centerX, centerZ, floorY }
    this.applyLayout()
  }

  applyLayout() {
    if (!this.layout) return
    const { width, depth, centerX, centerZ, floorY } = this.layout
    this.group.scale.setScalar(width * this.params.scale)
    this.group.position.set(centerX + width * this.params.x, floorY, centerZ + depth * this.params.z)
    this.group.rotation.y = THREE.MathUtils.degToRad(this.params.yaw)
    this.setCompact(this.compact)
    this.onLayout?.()
  }

  setCompact(compact) {
    this.compact = compact
    this.group.visible = this.params.visible && !compact
  }

  update(elapsed) {
    const { floatHeight, bobAmplitude, bobSpeed } = this.params
    // 用绝对秒数计算约 7 秒一次的轻微起伏；错开相位，帧率变化或隐藏后恢复都不会积累漂移。
    // 0.011 是原承托高度，最低点仍留出法向间隙；只动外层组，不改 GLB 的固定导出矩阵。
    for (let index = 0; index < this.components.length; index++) {
      const phase = elapsed * bobSpeed + index * 1.7
      this.components[index].position.y = 0.011 + floatHeight + Math.sin(phase) * bobAmplitude
    }
  }

  debugInit(debug) {
    if (!debug?.ui) return
    this.folder = debug.ui.addFolder({ title: 'Internal Components', expanded: false })
    this.folder.addBinding(this.params, 'visible', { label: 'Visible' }).on('change', () => this.setCompact(this.compact))
    for (const [key, min, max, step] of [['x', -3, -0.8, 0.01], ['z', -1, 1, 0.01], ['yaw', -90, 90, 1], ['scale', 0.5, 1.5, 0.01]]) {
      this.folder.addBinding(this.params, key, { min, max, step }).on('change', () => this.applyLayout())
    }
    this.folder.addBinding(this.params, 'inclination', { label: 'Deck angle', min: 5, max: 30, step: 1 })
      .on('change', () => this.applyInclination())
  }

  destroy() {
    this.folder?.dispose()
    this.group.removeFromParent()
    for (const label of this.labels) label.destroy()
    // 三件展品保留原几何/贴图并共享转换材质；模型和程序化支座资源在直接父级销毁时去重回收。
    for (const geometry of this.geometries) geometry.dispose()
    for (const material of this.materials) material.dispose()
    for (const texture of this.textures) texture.dispose()
    this.materialCopies.clear()
    this.components.length = 0
    this.onLayout = null
  }
}
