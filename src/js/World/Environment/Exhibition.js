import * as THREE from 'three/webgpu'
import Experience from '../../Experience.js'
import ColorDock from './ColorDock.js'
import ExhibitAirPods from './ExhibitAirPods.js'
import ExhibitPlant from './ExhibitPlant.js'
import ExhibitProps from './ExhibitProps.js'
import GameLibraryDisplay from './GameLibraryDisplay.js'
import InternalComponentsDisplay from './InternalComponentsDisplay.js'
import PartsDisplay from './PartsDisplay.js'
import ProductPlinth from './ProductPlinth.js'
import { labelAssetKeys, themeLabelVariantKeys } from './exhibitLabelLayout.js'

export default class Exhibition {
  constructor({ metrics, stage, sources, plantGltf, onLayout }) {
    const experience = new Experience()
    this.scene = experience.scene
    this.debug = experience.debug
    this.sizes = experience.sizes
    this.metrics = metrics
    this.stage = stage
    this.onLayout = onLayout
    this.params = {
      enabled: true,
      showParts: true,
      showDock: true,
      compact: false,
      hideOnNarrow: true,
      narrowWidth: 720,
      narrowAspect: 1.35,
      widthRatio: 1.5,
      depthRatio: 1.61,
      heightRatio: 0.06,
      cornerRatio: 0.05,
      bevelRatio: 0.002,
      offsetX: 0,
      offsetZ: 0.02,
      color: '#f0f1f2',
      roughness: 0.42,
      edgeGlow: 1.7,
      partsX: -1.26,
      partsZ: -1.15,
      partsYaw: 45,
      partsScale: 1.6,
      dockX: 1.76,
      dockZ: -1.95,
      dockYaw: -31,
      dockScale: 2.86,
    }
    this.group = new THREE.Group()
    this.group.name = 'Exhibition'
    this.labelTextures = Object.fromEntries(labelAssetKeys
      .map(key => [key, experience.resources.items[`${key}LabelTexture`]]))
    this.plinth = new ProductPlinth({ debug: this.debug })
    this.group.add(this.plinth.group)
    this.partsDisplay = new PartsDisplay({ sources, debug: this.debug, transmissionBackdrop: experience.renderer.transmissionBackdrop,
      labelTexture: this.labelTextures.parts })
    this.colorDock = new ColorDock({ sources, debug: this.debug, events: experience.events,
      labelTextures: themeLabelVariantKeys.map(key => this.labelTextures[key]) })
    this.parts = this.partsDisplay.group
    this.dock = this.colorDock.group
    this.group.add(this.parts, this.dock)
    this.props = new ExhibitProps({
      coverTexture: experience.resources.items.gameCardCover,
      labelTexture: this.labelTextures.plaque,
      debug: this.debug,
      onLayout: () => this.notifyLayout(),
    })
    this.plant = new ExhibitPlant({ gltf: plantGltf, debug: this.debug, onLayout: () => this.notifyLayout() })
    this.airpods = new ExhibitAirPods({
      gltf: experience.resources.items.airpodsModel,
      debug: this.debug,
      onLayout: () => this.notifyLayout(),
    })
    this.internalComponents = new InternalComponentsDisplay({
      gltf: experience.resources.items.controllerDetailModel,
      labelTextures: { legend: this.labelTextures.internalLegend, names: this.labelTextures.internalNames },
      debug: this.debug,
      onLayout: () => this.notifyLayout(),
    })
    this.gameLibrary = new GameLibraryDisplay({
      coverTextures: [2, 3, 4, 5].map(index => experience.resources.items[`gameCardCover${index}`]),
      labelTexture: this.labelTextures.library,
      debug: this.debug,
      onLayout: () => this.notifyLayout(),
    })
    this.group.add(this.props.group, this.plant.group, this.airpods.group, this.internalComponents.group, this.gameLibrary.group)
    this.scene.add(this.group)
    this.applyLayout()
    this.debugInit()
  }

  applyLayout() {
    const { width: w, depth: d, center, supportY } = this.metrics
    const p = this.params
    const height = w * p.heightRatio
    const width = w * p.widthRatio
    const depth = d * p.depthRatio
    const centerX = center.x + p.offsetX * w
    const centerZ = center.z + p.offsetZ * d
    this.plinth.setLayout({
      width,
      depth,
      height,
      centerX,
      centerZ,
      supportY,
      radius: w * p.cornerRatio,
      bevel: w * p.bevelRatio,
    })
    this.plinth.setAppearance(p)
    const floorY = p.enabled ? supportY - height : supportY
    this.stage.setExhibitionLayout({ floorY, centerX, centerZ, width, depth, enabled: p.enabled })
    this.parts.position.set(center.x + p.partsX * w, floorY, center.z + p.partsZ * d)
    this.parts.rotation.y = THREE.MathUtils.degToRad(p.partsYaw)
    this.parts.scale.setScalar(w * p.partsScale)
    this.dock.position.set(center.x + p.dockX * w, floorY, center.z + p.dockZ * d)
    this.dock.rotation.y = THREE.MathUtils.degToRad(p.dockYaw)
    this.dock.scale.setScalar(w * p.dockScale)
    this.props.setLayout({ width: w, depth: d, centerX, centerZ, floorY })
    this.plant.setLayout({ width: w, depth: d, centerX, centerZ, floorY })
    this.airpods.setLayout({ width: w, depth: d, centerX, centerZ, floorY })
    this.internalComponents.setLayout({ width: w, depth: d, centerX, centerZ, floorY })
    this.gameLibrary.setLayout({ width: w, depth: d, centerX, centerZ, floorY })
    this.resize()
  }

  notifyLayout() {
    // 包含隐藏展组，避免 resize 让阴影投影跳变；为 Dock 与内部元件悬浮预留世界空间余量。
    // 元件保留 GLB 的固定局部矩阵；调布局后强制更新整棵树，阴影包围盒不能等待下一次渲染。
    this.group.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(this.group, true)
    bounds.union(this.metrics.bounds).expandByScalar(this.metrics.width * 0.15)
    this.onLayout?.(bounds)
  }

  update(elapsed) {
    if (this.group.visible && this.dock.visible)
      this.colorDock.update(elapsed)
    if (this.group.visible && this.internalComponents.group.visible)
      this.internalComponents.update(elapsed)
  }

  resize() {
    const p = this.params
    // 桌面窗口较高或打开 Inspector 时也可能接近正方形；不能仅按宽高比隐藏整个展区。
    // 宽度断点与页头/画布的 720px 响应式规则一致，只有真正窄且不够横向的画布才精简展品。
    p.compact = this.sizes.width <= p.narrowWidth && this.sizes.width / this.sizes.height < p.narrowAspect
    const showSides = !p.hideOnNarrow || !p.compact
    this.group.visible = p.enabled
    this.parts.visible = p.showParts && showSides
    this.dock.visible = p.showDock && showSides
    this.props.setCompact(!showSides)
    this.plant.setCompact(!showSides)
    this.airpods.setCompact(!showSides)
    this.internalComponents.setCompact(!showSides)
    this.gameLibrary.setCompact(!showSides)
    this.compactBinding?.refresh()
  }

  debugInit() {
    if (!this.debug?.ui) return
    this.folder = this.debug.ui.addFolder({ title: 'Exhibition', expanded: false })
    this.folder.addBinding(this.params, 'enabled', { label: 'Enabled' }).on('change', () => this.applyLayout())
    for (const key of ['showParts', 'showDock', 'hideOnNarrow']) {
      this.folder.addBinding(this.params, key).on('change', () => this.resize())
    }
    this.compactBinding = this.folder.addBinding(this.params, 'compact', { readonly: true, label: 'Narrow viewport' })
    this.folder.addBinding(this.params, 'narrowWidth', { min: 320, max: 1024, step: 1 }).on('change', () => this.resize())
    this.folder.addBinding(this.params, 'narrowAspect', { min: 1, max: 1.6, step: 0.05 }).on('change', () => this.resize())
    const plinth = this.folder.addFolder({ title: 'Plinth / product units' })
    const ranges = {
      widthRatio: [1.1, 2, 0.01],
      depthRatio: [1.05, 1.9, 0.01],
      heightRatio: [0.025, 0.12, 0.001],
      cornerRatio: [0.05, 0.24, 0.005],
      bevelRatio: [0.002, 0.025, 0.001],
      offsetX: [-0.3, 0.3, 0.01],
      offsetZ: [-0.3, 0.3, 0.01],
    }
    for (const [key, [min, max, step]] of Object.entries(ranges)) {
      plinth.addBinding(this.params, key, { min, max, step }).on('change', () => this.applyLayout())
    }
    plinth.addBinding(this.params, 'color').on('change', () => this.plinth.setAppearance(this.params))
    for (const [key, min, max] of [['roughness', 0.2, 0.8], ['edgeGlow', 0, 3]]) {
      plinth.addBinding(this.params, key, { min, max, step: 0.01 }).on('change', () => this.plinth.setAppearance(this.params))
    }
    const sides = this.folder.addFolder({ title: 'Display layout' })
    for (const prefix of ['parts', 'dock']) {
      for (const [suffix, min, max, step] of [['X', -3, 3, 0.01], ['Z', -2, 2, 0.01], ['Yaw', -90, 90, 1], ['Scale', 0.5, 4, 0.01]]) {
        sides.addBinding(this.params, `${prefix}${suffix}`, { min, max, step }).on('change', () => this.applyLayout())
      }
    }
  }

  destroy() {
    this.folder?.dispose()
    this.plinth.destroy()
    this.partsDisplay.destroy()
    this.colorDock.destroy()
    this.props.destroy()
    this.plant.destroy()
    this.airpods.destroy()
    this.internalComponents.destroy()
    this.gameLibrary.destroy()
    // 子标签只释放自有材质/几何，加载的共享纹理（含 Dock 预设变体）在直接所有者中各释放一次。
    for (const texture of new Set(Object.values(this.labelTextures))) texture.dispose()
    this.onLayout = null
    this.group.removeFromParent()
  }
}
