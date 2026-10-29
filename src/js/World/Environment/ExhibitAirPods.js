import * as THREE from 'three/webgpu'

// 用户 GLB 的语义映射集中在这里；不改资源文件，也不把附件挂进手机折叠或装配层级。
const PARTS = {
  body: 'case',
  lid: 'cover',
  leftBud: 'left_earphones',
  rightBud: 'right_earphones',
}

export default class ExhibitAirPods {
  constructor({ gltf, debug, onLayout }) {
    if (!gltf?.scene)
      throw new Error('airpodsModel 未返回有效的 GLTF Scene')
    this.onLayout = onLayout
    this.params = {
      visible: true,
      scale: 2.5,
      closedX: -1.23,
      closedZ: 0.86,
      closedYaw: -14,
      openX: 1.32,
      openZ: 0.907,
      openYaw: -18,
      openAngle: 115,
    }
    this.group = new THREE.Group()
    this.group.name = 'ExhibitAirPods'
    this.geometries = new Set()
    this.materials = new Set()
    this.textures = new Set()
    this.materialCopies = new Map()
    gltf.scene.traverse((mesh) => {
      if (!mesh.isMesh)
        return
      this.geometries.add(mesh.geometry)
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        this.materials.add(material)
        for (const value of Object.values(material)) {
          if (value?.isTexture)
            this.textures.add(value)
        }
      }
    })
    this.closed = this.createDisplay(gltf.scene, false)
    this.open = this.createDisplay(gltf.scene, true)
    this.group.add(this.closed, this.open)
    this.debugInit(debug)
  }

  getPart(model, key) {
    const part = model.getObjectByName(PARTS[key])
    if (!part)
      throw new Error(`AirPods 模型缺少 ${key} 节点：${PARTS[key]}`)
    return part
  }

  createDisplay(source, open) {
    const display = new THREE.Group()
    display.name = open ? 'AirPodsOpenDisplay' : 'AirPodsClosedDisplay'
    const model = source.clone(true)
    // 新 GLB 已在 Y=0 上方平躺并封紧；闭盒保留导出姿态，只有右侧开盒整机立起。
    if (open)
      model.rotation.x = Math.PI / 2
    const body = this.getPart(model, 'body')
    const lid = this.getPart(model, 'lid')
    const leftBud = this.getPart(model, 'leftBud')
    const rightBud = this.getPart(model, 'rightBud')
    model.updateMatrixWorld(true)
    const bodyBounds = new THREE.Box3().setFromObject(body, true)
    const caseWidth = bodyBounds.getSize(new THREE.Vector3()).x
    if (caseWidth <= 0)
      throw new Error('AirPods 盒身宽度无效')

    if (open) {
      this.openCover = lid
      this.coverRestQuaternion = lid.quaternion.clone()
      this.applyCoverAngle()
      // 左耳机保留用户的盒内安装位置；另一枚作为盒旁道具，仍按可见几何接地。
      const loose = new THREE.Group()
      loose.name = 'AirPodsLooseEarbud'
      loose.attach(rightBud)
      const center = new THREE.Box3().setFromObject(rightBud, true).getCenter(new THREE.Vector3())
      rightBud.position.sub(center)
      loose.rotation.set(Math.PI / 5, 0, -Math.PI * 0.42)
      const bounds = new THREE.Box3().setFromObject(loose, true)
      const looseCenter = bounds.getCenter(new THREE.Vector3())
      // 按盒身最前表面与耳机最后表面留出 0.45 个盒宽，同时避开 Hero 斜视下的轮廓遮挡。
      loose.position.set(
        caseWidth * 0.12 - looseCenter.x,
        bodyBounds.min.y - bounds.min.y,
        bodyBounds.max.z + caseWidth * 0.45 - bounds.min.z,
      )
      // model 已做坐标系适配，attach 保留耳机的世界位姿，避免再叠加一次 90° 旋转。
      model.attach(loose)
    }
    else {
      leftBud.visible = false
      rightBud.visible = false
    }

    model.traverse((mesh) => {
      if (!mesh.isMesh)
        return
      mesh.castShadow = true
      mesh.receiveShadow = true
      const convert = (material) => {
        if (!this.materialCopies.has(material)) {
          const copy = new THREE.MeshStandardNodeMaterial().copy(material)
          this.materialCopies.set(material, copy)
          this.materials.add(copy)
        }
        return this.materialCopies.get(material)
      }
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(convert) : convert(mesh.material)
    })
    // 保留用户导出的尺寸基准；包围盒仅用于平移接地，不按盒宽归一化。
    const bounds = this.visibleBounds(model)
    const center = bounds.getCenter(new THREE.Vector3())
    model.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z))
    display.add(model)
    return display
  }

  applyCoverAngle() {
    // cover 原点已经是用户设置的铰链点，局部 X 沿盒宽；负角向后开盖，不改位置或重建 Pivot。
    this.openCover.quaternion.copy(this.coverRestQuaternion)
    this.openCover.rotateX(-THREE.MathUtils.degToRad(this.params.openAngle))
  }

  visibleBounds(model) {
    model.updateMatrixWorld(true)
    const bounds = new THREE.Box3()
    const point = new THREE.Vector3()
    model.traverseVisible((mesh) => {
      if (!mesh.isMesh)
        return
      // 只在静态摆放时测量精确顶点，避免旋转后的保守 AABB 把最低点算低、让耳机悬空。
      const positions = mesh.geometry.attributes.position
      for (let i = 0; i < positions.count; i++) {
        bounds.expandByPoint(point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld))
      }
    })
    return bounds
  }

  setLayout({ width, depth, centerX, centerZ, floorY }) {
    this.layout = { width, depth, centerX, centerZ, floorY }
    this.applyLayout()
  }

  applyLayout() {
    if (!this.layout)
      return
    const { width: w, depth: d, centerX, centerZ, floorY } = this.layout
    this.group.visible = this.params.visible && !this.compact
    for (const [prefix, group] of [['closed', this.closed], ['open', this.open]]) {
      // 用户要求统一放大 2.5 倍；两组只用同一个倍率，W / D 只用于圈外摆放坐标。
      group.scale.setScalar(this.params.scale)
      group.position.set(centerX + w * this.params[`${prefix}X`], floorY, centerZ + d * this.params[`${prefix}Z`])
      group.rotation.y = THREE.MathUtils.degToRad(this.params[`${prefix}Yaw`])
    }
    this.onLayout?.()
  }

  setCompact(compact) {
    this.compact = compact
    this.group.visible = this.params.visible && !compact
  }

  debugInit(debug) {
    if (!debug?.ui)
      return
    this.folder = debug.ui.addFolder({ title: 'Exhibit AirPods', expanded: false })
    this.folder.addBinding(this.params, 'visible', { label: 'Visible' }).on('change', () => this.applyLayout())
    this.folder.addBinding(this.params, 'scale', { label: 'Shared scale', min: 1, max: 4, step: 0.1 }).on('change', () => this.applyLayout())
    this.folder.addBinding(this.params, 'openAngle', { label: 'Lid angle', min: 0, max: 130, step: 1 }).on('change', () => {
      this.applyCoverAngle()
      this.onLayout?.()
    })
    for (const prefix of ['closed', 'open']) {
      const folder = this.folder.addFolder({ title: prefix === 'closed' ? 'Left / closed case' : 'Right / open case' })
      for (const [suffix, min, max, step] of [['X', -2, 2, 0.01], ['Z', -1, 2, 0.01], ['Yaw', -180, 180, 1]]) {
        folder.addBinding(this.params, `${prefix}${suffix}`, { min, max, step }).on('change', () => this.applyLayout())
      }
    }
  }

  destroy() {
    this.folder?.dispose()
    this.group.removeFromParent()
    // 两组副本共享 GLB 几何与贴图，只由此组件统一回收一次。
    for (const geometry of this.geometries) geometry.dispose()
    for (const material of this.materials) material.dispose()
    for (const texture of this.textures) texture.dispose()
    this.materialCopies.clear()
    this.onLayout = null
  }
}
