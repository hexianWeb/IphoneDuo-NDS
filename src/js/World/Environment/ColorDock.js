import * as THREE from 'three/webgpu'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import ExhibitSample from './ExhibitSample.js'
import ThemeLabel from './ThemeLabel.js'
import { themeLabelLayout, themeLabelPresets } from './exhibitLabelLayout.js'

export default class ColorDock {
  constructor({ sources, debug, events, labelTextures }) {
    this.events = events
    this.selectedTheme = 'classic'
    this.seats = []
    this.themeMeshes = new Map()
    this.group = new THREE.Group()
    this.group.name = 'ColorDock'
    const glbButton = `#${sources.buttons.a.materials[0].color.getHexString()}`
    const glbDpad = `#${sources.buttons.dpad.materials[0].color.getHexString()}`
    // Classic 与主机初始配色一致；其余主题的外壳、ABXY、D-Pad 各自成套。
    this.themes = [
      { key: 'classic', label: 'Classic', shell: sources.plasticParams.color, buttons: glbButton, dpad: glbDpad },
      ...themeLabelPresets.slice(1).map(theme => ({ ...theme })),
    ]
    this.params = {
      roughness: sources.plasticParams.roughness,
      bumpStrength: sources.plasticParams.bumpStrength,
      floatHeight: 0.04,
      bobAmplitude: 0.007,
      bobSpeed: 1.1,
      swayYaw: 6,
      swayRoll: 2.5,
    }
    this.material = new THREE.MeshStandardNodeMaterial({ color: '#e8eaec', roughness: 0.6, metalness: 0 })
    this.base = new THREE.Mesh(new RoundedBoxGeometry(0.68, 0.11, 0.33, 3, 0.012), this.material)
    this.base.position.y = 0.055
    this.base.castShadow = true
    this.base.receiveShadow = true
    this.group.add(this.base)
    this.seatGeometry = new RoundedBoxGeometry(0.185, 0.012, 0.09, 2, 0.003)
    const parts = [sources.shell, ...['a', 'b', 'x', 'y', 'dpad'].map(key => sources.buttons[key])]
    this.samples = this.themes.map((theme, index) => {
      // 外壳与按键作为一个展品整体适配尺寸，按键保持 GLB 中的安装相对位置。
      // 展示坐标 rotation = 0 时 D-Pad 在左、ABXY 在右，即横握朝向；宽度受相邻样品间距约束。
      const sample = new ExhibitSample({
        sources: parts, width: 0.19, height: 0.2,
        buttonPrint: sources.buttonPrint,
        plasticParams: { ...sources.plasticParams, color: theme.shell }, name: `Dock_${theme.key}`,
      })
      const seat = new THREE.Mesh(this.seatGeometry, this.material.clone())
      seat.position.set((index - 1) * 0.205, 0.116, 0)
      seat.castShadow = true
      seat.receiveShadow = true
      this.group.add(sample.group, seat)
      this.seats.push(seat)
      for (const mesh of [...sample.meshes, seat]) this.themeMeshes.set(mesh, theme.key)
      return sample
    })
    this.label = new ThemeLabel({ textures: labelTextures, themes: this.themes })
    this.label.mesh.position.set(0, 0.057, 0.167)
    this.group.add(this.label.mesh)
    this.label.setSelectedTheme(this.selectedTheme)
    this.applyColors()
    this.updateSelection()
    this.update(0)
    this.debugInit(debug)
  }

  // 由绝对时间直接求位姿，不累积 delta，暂停或掉帧后也不会漂移；各样品相位错开避免同步起伏。
  update(elapsed) {
    const p = this.params
    const seatTop = 0.122
    this.samples.forEach((sample, index) => {
      const phase = elapsed * p.bobSpeed + index * 2.1
      const bob = Math.sin(phase) * p.bobAmplitude
      // 样品根节点 XY 为中心、Z=0 为后表面，因此 Z 取 -深度/2 使整件居中于承托面上方。
      sample.group.position.set((index - 1) * 0.205, seatTop + p.floatHeight + sample.size.y / 2 + bob, -sample.size.z / 2)
      sample.group.rotation.set(
        0,
        THREE.MathUtils.degToRad(Math.sin(phase * 0.6) * p.swayYaw),
        THREE.MathUtils.degToRad(Math.sin(phase * 0.8 + 1) * p.swayRoll),
      )
    })
  }

  applyColors() {
    this.samples.forEach((sample, index) => sample.setColors(this.themes[index]))
    this.label.setPalette(this.themes)
    this.events?.emit('controller:themes-updated')
  }

  getInteractionSurfaces() {
    return [...this.themeMeshes.keys(), this.label.mesh]
  }

  getThemeAtHit({ object, uv }) {
    if (object !== this.label.mesh) return this.themeMeshes.get(object) ?? null
    // 标签画布使用 1000 宽的逻辑坐标；与绘制的三列主题中心共用同一分区。
    const x = uv.x * 1000
    if (x < themeLabelLayout.hitMin || x > themeLabelLayout.hitMax) return null
    return this.themes[Math.min(2, Math.floor((x - themeLabelLayout.hitMin) / themeLabelLayout.gap))].key
  }

  setSelectedTheme(key) {
    this.selectedTheme = key
    this.updateSelection()
    this.label.setSelectedTheme(key)
  }

  setHoveredTheme(key) {
    if (this.hoveredTheme === key) return
    this.hoveredTheme = key
    this.updateSelection()
  }

  updateSelection() {
    this.seats.forEach((seat, index) => {
      const key = this.themes[index].key
      seat.material.color.set(key === this.hoveredTheme ? '#b7ccdb' : key === this.selectedTheme ? '#a7c2d5' : '#dedbd4')
    })
  }

  debugInit(debug) {
    if (!debug?.ui) return
    this.folder = debug.ui.addFolder({ title: 'Controller Themes / S2', expanded: false })
    for (const theme of this.themes) {
      const folder = this.folder.addFolder({ title: theme.label, expanded: false })
      for (const key of ['shell', 'buttons', 'dpad']) folder.addBinding(theme, key).on('change', () => this.applyColors())
    }
    for (const [key, min, max] of [['roughness', 0.2, 0.8], ['bumpStrength', 0, 0.3]]) {
      this.folder.addBinding(this.params, key, { min, max, step: 0.01 })
        .on('change', () => this.samples.forEach(sample => sample.setFinish(this.params)))
    }
    const motion = this.folder.addFolder({ title: 'Float', expanded: false })
    const ranges = {
      floatHeight: [0, 0.12, 0.001],
      bobAmplitude: [0, 0.03, 0.0005],
      bobSpeed: [0, 4, 0.05],
      swayYaw: [0, 20, 0.5],
      swayRoll: [0, 10, 0.5],
    }
    for (const [key, [min, max, step]] of Object.entries(ranges)) {
      motion.addBinding(this.params, key, { min, max, step })
    }
  }

  destroy() {
    this.folder?.dispose()
    this.samples.forEach(sample => sample.destroy())
    this.seats.forEach(seat => seat.material.dispose())
    this.themeMeshes.clear()
    this.label.destroy()
    this.base.geometry.dispose()
    this.seatGeometry.dispose()
    this.material.dispose()
    this.group.removeFromParent()
  }
}
