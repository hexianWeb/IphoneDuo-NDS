import * as THREE from 'three/webgpu'
import ExhibitLabel from './ExhibitLabel.js'
import { createPlinthGeometry } from './exhibitionGeometry.js'
import { createGameCard } from './gameCard.js'
import { exhibitLabelLayout } from './exhibitLabelLayout.js'

export default class GameLibraryDisplay {
  constructor({ coverTextures, debug, onLayout, labelTexture }) {
    if (coverTextures.length !== 4 || coverTextures.some(texture => !texture?.image)) throw new Error('Game Library 缺少四张卡带封面')
    this.onLayout = onLayout
    // 原整体比例 1.1 缩至 75%；从 +Y 俯视，绕 Y 的负角度表示顺时针，再转 15°。
    this.params = { visible: true, x: 1.48, z: -0.1, yaw: -27, scale: 0.825, inclination: 68, looseX: -0.1, looseZ: 0.38, looseYaw: 17 }
    this.group = new THREE.Group()
    this.group.name = 'GameLibraryDisplay'
    this.geometries = new Set()
    this.materials = new Set()
    this.textures = new Set(coverTextures)
    const white = new THREE.MeshStandardNodeMaterial({ color: '#e8eaec', roughness: 0.6, metalness: 0 })
    this.materials.add(white)
    this.addMesh(this.group, 'GameLibraryBase', createPlinthGeometry(0.78, 0.32, 0.055, 0.022, 0.002), white, [0, 0.0275, 0])
    this.support = this.addMesh(this.group, 'GameLibrarySupport', new THREE.BufferGeometry(), white)
    this.deck = new THREE.Group()
    this.deck.name = 'GameLibraryDeck'
    this.group.add(this.deck)
    this.addMesh(this.deck, 'GameLibraryBackboard', createPlinthGeometry(0.74, 0.29, 0.012, 0.01, 0.001), white)
    this.cards = coverTextures.slice(0, 3).map((coverTexture, index) => {
      const card = createGameCard({ coverTexture, name: `LibraryCard${index + 1}`, width: 0.19, depth: 0.255, geometries: this.geometries, materials: this.materials })
      // 卡带底面为局部 Y=0，背板上表面为 +0.006；同一倾斜父级保持贴合并让正面朝访客。
      card.position.set((index - 1) * 0.235, 0.007, 0)
      this.deck.add(card)
      return card
    })
    this.looseCard = createGameCard({ coverTexture: coverTextures[3], name: 'LibraryLooseCard', geometries: this.geometries, materials: this.materials })
    this.group.add(this.looseCard)
    this.label = new ExhibitLabel({ ...exhibitLabelLayout.library, texture: labelTexture })
    this.label.mesh.position.set(0, 0.0275, 0.1615)
    this.group.add(this.label.mesh)
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

  applyInclination() {
    const angle = THREE.MathUtils.degToRad(this.params.inclination)
    const halfDepth = 0.145
    const centerY = 0.067 + halfDepth * Math.sin(angle)
    this.deck.rotation.x = angle
    this.deck.position.set(0, centerY, -0.055)
    // 展板 +X 倾斜：后缘 -Z 升高，+Y 法线朝前 +Z。楔形上沿与展板下表面共用平面。
    const supportDepth = 0.135 * Math.cos(angle) - 0.006 * Math.sin(angle)
    const undersideY = centerY - 0.006 / Math.cos(angle)
    const shape = new THREE.Shape()
    shape.moveTo(-supportDepth, 0.054)
    shape.lineTo(supportDepth, 0.054)
    shape.lineTo(supportDepth, undersideY + supportDepth * Math.tan(angle))
    shape.lineTo(-supportDepth, undersideY - supportDepth * Math.tan(angle))
    shape.closePath()
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.7, bevelEnabled: false, steps: 1 })
    geometry.translate(0, 0, -0.35)
    geometry.rotateY(Math.PI / 2)
    this.geometries.delete(this.support.geometry)
    this.support.geometry.dispose()
    this.support.geometry = geometry
    this.geometries.add(geometry)
    this.support.position.z = -0.055
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
    // 散卡沿地面 +Y 放置，局部最低点为零；Yaw 只绕 Y，不改变接地高度。
    this.looseCard.position.set(this.params.looseX, 0, this.params.looseZ)
    this.looseCard.rotation.y = THREE.MathUtils.degToRad(this.params.looseYaw)
    this.setCompact(this.compact)
    this.onLayout?.()
  }

  setCompact(compact) {
    this.compact = compact
    this.group.visible = this.params.visible && !compact
  }

  debugInit(debug) {
    if (!debug?.ui) return
    this.folder = debug.ui.addFolder({ title: 'Game Library', expanded: false })
    this.folder.addBinding(this.params, 'visible', { label: 'Visible' }).on('change', () => this.setCompact(this.compact))
    for (const [key, min, max, step] of [['x', 0.8, 3, 0.01], ['z', -1, 1.2, 0.01], ['yaw', -90, 90, 1], ['scale', 0.6, 1.8, 0.01]]) {
      this.folder.addBinding(this.params, key, { min, max, step }).on('change', () => this.applyLayout())
    }
    this.folder.addBinding(this.params, 'inclination', { label: 'Card angle', min: 50, max: 75, step: 1 }).on('change', () => this.applyInclination())
    const loose = this.folder.addFolder({ title: 'Loose card', expanded: false })
    for (const [key, min, max, step] of [['looseX', -0.6, 0.6, 0.01], ['looseZ', 0.2, 0.8, 0.01], ['looseYaw', -90, 90, 1]]) {
      loose.addBinding(this.params, key, { min, max, step }).on('change', () => this.applyLayout())
    }
  }

  destroy() {
    this.folder?.dispose()
    this.group.removeFromParent()
    this.label.destroy()
    for (const geometry of this.geometries) geometry.dispose()
    for (const material of this.materials) material.dispose()
    for (const texture of this.textures) texture.dispose()
    this.onLayout = null
  }
}
