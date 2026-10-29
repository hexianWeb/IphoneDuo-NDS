import * as THREE from 'three/webgpu'
import ExhibitLabel from './ExhibitLabel.js'
import { createPlinthGeometry } from './exhibitionGeometry.js'
import { createGameCard } from './gameCard.js'
import { exhibitLabelLayout } from './exhibitLabelLayout.js'

// 道具以产品宽 W 为局部单位，挂在展区而非产品 Rig；标签不参与屏幕命中或模拟器更新。
export default class ExhibitProps {
  constructor({ coverTexture, debug, onLayout, labelTexture }) {
    this.onLayout = onLayout
    this.cardCoverTexture = coverTexture
    this.cardCoverTexture.colorSpace = THREE.SRGBColorSpace
    this.cardCoverTexture.anisotropy = 8
    this.params = {
      showPlaque: true, showCard: true,
      plaqueX: -0.96, plaqueZ: 0.66, plaqueYaw: 8,
      cardX: 0.94, cardZ: 0.64, cardYaw: -18,
    }
    this.group = new THREE.Group()
    this.group.name = 'ExhibitProps'
    this.geometries = new Set()
    this.materials = new Set()
    this.plaque = this.createPlaque(labelTexture)
    this.card = this.createCard()
    this.group.add(this.plaque, this.card)
    this.debugInit(debug)
  }

  material(color, roughness = 0.6, metalness = 0) {
    const material = new THREE.MeshStandardNodeMaterial({ color, roughness, metalness })
    this.materials.add(material)
    return material
  }

  mesh(parent, name, geometry, material, position = [0, 0, 0]) {
    this.geometries.add(geometry)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = name
    mesh.position.set(...position)
    mesh.castShadow = true
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }

  createPlaque(labelTexture) {
    const group = new THREE.Group()
    group.name = 'ProductPlaque'
    const shell = this.material('#c8c8c1', 0.48)
    // 60° 指铭牌面与水平地面的夹角；保持面板长度，用正弦/余弦同步推导支架，避免板面悬空。
    const inclination = THREE.MathUtils.degToRad(60)
    const faceHeight = 0.145
    const depth = faceHeight * Math.cos(inclination)
    const height = faceHeight * Math.sin(inclination)
    const shape = new THREE.Shape()
    shape.moveTo(-depth / 2, 0)
    shape.lineTo(depth / 2, 0)
    shape.lineTo(depth / 2, height)
    shape.closePath()
    const support = new THREE.ExtrudeGeometry(shape, { depth: 0.26, bevelEnabled: false, steps: 1 })
    support.translate(0, 0, -0.13)
    support.rotateY(Math.PI / 2)
    this.mesh(group, 'PlaqueSupport', support, shell)
    const face = new THREE.Group()
    face.rotation.x = inclination - Math.PI / 2
    face.position.y = height / 2 + 0.004
    group.add(face)
    const plate = createPlinthGeometry(0.29, Math.hypot(depth, height), 0.007, 0.008, 0.001)
    plate.rotateX(Math.PI / 2)
    this.mesh(face, 'PlaquePlate', plate, shell)
    this.plaqueLabel = new ExhibitLabel({ ...exhibitLabelLayout.plaque, texture: labelTexture })
    // 沿面板法线留出 0.002W 实体间距，避免斜视角下标签与底板争用深度。
    this.plaqueLabel.mesh.position.z = 0.0035 + 0.002
    face.add(this.plaqueLabel.mesh)
    // 旋转后的薄板可能低于支架底面，以真实几何最低点接地，避免调角度时悬浮。
    this.ground(group)
    return group
  }

  createCard() {
    return createGameCard({ coverTexture: this.cardCoverTexture, geometries: this.geometries, materials: this.materials })
  }

  ground(group) {
    const bounds = new THREE.Box3().setFromObject(group, true)
    for (const child of group.children) child.position.y -= bounds.min.y
  }

  setLayout({ width, depth, centerX, centerZ, floorY }) {
    this.layout = { width, depth, centerX, centerZ, floorY }
    this.applyLayout()
  }

  applyLayout() {
    if (!this.layout) return
    const { width: w, depth: d, centerX, centerZ, floorY } = this.layout
    for (const [prefix, group] of [['plaque', this.plaque], ['card', this.card]]) {
      group.scale.setScalar(w)
      group.position.set(centerX + this.params[`${prefix}X`] * w, floorY, centerZ + this.params[`${prefix}Z`] * d)
      group.rotation.y = THREE.MathUtils.degToRad(this.params[`${prefix}Yaw`])
    }
    this.onLayout?.()
  }

  setCompact(compact) {
    this.plaque.visible = this.params.showPlaque
    this.card.visible = this.params.showCard && !compact
    this.compact = compact
  }

  debugInit(debug) {
    if (!debug?.ui) return
    this.folder = debug.ui.addFolder({ title: 'Exhibit Props / S3', expanded: false })
    for (const key of ['showPlaque', 'showCard']) {
      this.folder.addBinding(this.params, key).on('change', () => this.setCompact(this.compact))
    }
    for (const prefix of ['plaque', 'card']) {
      const folder = this.folder.addFolder({ title: prefix === 'plaque' ? 'Product plaque' : 'Original game card' })
      for (const [suffix, min, max, step] of [['X', -1.5, 1.5, 0.01], ['Z', -1, 1.5, 0.01], ['Yaw', -90, 90, 1]]) {
        folder.addBinding(this.params, `${prefix}${suffix}`, { min, max, step }).on('change', () => this.applyLayout())
      }
    }
  }

  destroy() {
    this.folder?.dispose()
    this.plaqueLabel.destroy()
    for (const geometry of this.geometries) geometry.dispose()
    for (const material of this.materials) material.dispose()
    // 此贴图仅供卡带使用，跟随道具销毁；资源加载器不重复回收纹理。
    this.cardCoverTexture.dispose()
    this.group.removeFromParent()
    this.onLayout = null
  }
}
