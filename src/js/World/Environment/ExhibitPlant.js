import * as THREE from 'three/webgpu'

// 展台装饰植物：以产品宽 W 为布局单位，归一化模型高度后按 W 缩放，不参与产品 Rig 或屏幕命中。
export default class ExhibitPlant {
  constructor({ gltf, debug, onLayout }) {
    this.onLayout = onLayout
    this.params = {
      showPlant: true,
      plantX: 3.0,
      plantZ: -1.85,
      plantYaw: -28,
      plantScale: 1.0,
    }
    this.group = new THREE.Group()
    this.group.name = 'ExhibitPlant'

    if (!gltf?.scene)
      throw new Error('rhyzomePlant 未返回有效的 GLTF Scene')

    this.model = gltf.scene.clone(true)
    this.model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true
        child.receiveShadow = true
      }
    })
    this.normalizeHeight(this.model)
    this.ground(this.model)
    this.group.add(this.model)
    this.debugInit(debug)
  }

  normalizeHeight(group) {
    const bounds = new THREE.Box3().setFromObject(group, true)
    const size = bounds.getSize(new THREE.Vector3())
    if (size.y > 0)
      group.scale.multiplyScalar(1 / size.y)
  }

  ground(group) {
    const bounds = new THREE.Box3().setFromObject(group, true)
    group.position.y -= bounds.min.y
  }

  setLayout({ width, depth, centerX, centerZ, floorY }) {
    this.layout = { width, depth, centerX, centerZ, floorY }
    this.applyLayout()
  }

  applyLayout() {
    if (!this.layout)
      return
    const { width: w, depth: d, centerX, centerZ, floorY } = this.layout
    const p = this.params
    this.group.visible = p.showPlant
    this.group.scale.setScalar(w * p.plantScale)
    this.group.position.set(centerX + p.plantX * w, floorY, centerZ + p.plantZ * d)
    this.group.rotation.y = THREE.MathUtils.degToRad(p.plantYaw)
    this.onLayout?.()
  }

  setCompact(compact) {
    this.compact = compact
  }

  debugInit(debug) {
    if (!debug?.ui)
      return
    this.folder = debug.ui.addFolder({ title: 'Exhibit Plant', expanded: false })
    this.folder.addBinding(this.params, 'showPlant', { label: 'Visible' }).on('change', () => this.applyLayout())
    for (const [suffix, min, max, step, label] of [
      ['X', -5, 5, 0.01, 'X'],
      ['Z', -5, 5, 0.01, 'Z'],
      ['Yaw', -180, 180, 1, 'Yaw'],
      ['Scale', 0.5, 6, 0.01, 'Height × W'],
    ]) {
      this.folder.addBinding(this.params, `plant${suffix}`, { label, min, max, step }).on('change', () => this.applyLayout())
    }
  }

  destroy() {
    this.folder?.dispose()
    this.model.traverse((child) => {
      if (!child.isMesh)
        return
      child.geometry?.dispose()
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      for (const material of materials) material?.dispose()
    })
    this.group.removeFromParent()
    this.onLayout = null
  }
}
