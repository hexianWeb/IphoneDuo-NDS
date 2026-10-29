import * as THREE from 'three/webgpu'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import ExhibitSample from './ExhibitSample.js'
import ExhibitLabel from './ExhibitLabel.js'
import GlassPhysicalNodeMaterial from '../../Materials/Transmission/GlassPhysicalNodeMaterial.js'
import { exhibitLabelLayout } from './exhibitLabelLayout.js'

export default class PartsDisplay {
  constructor({ sources, debug, transmissionBackdrop, labelTexture }) {
    this.transmissionBackdrop = transmissionBackdrop
    this.group = new THREE.Group()
    this.group.name = 'PartsDisplay'
    this.params = {
      boardColor: '#ffffff',
      // 亚克力保留实体厚度与现有折射通道；降低雾化和色散，边缘轮廓交给面光源塑形。
      glassTransmission: 0.96,
      glassRoughness: 0.06,
      glassIor: 1.49,
      glassThickness: 0.025,
      glassDispersion: 0.06,
      glassBlur: 0.035,
      glassSamples: 4,
      shellColor: sources.plasticParams.color,
      roughness: sources.plasticParams.roughness,
      bumpStrength: sources.plasticParams.bumpStrength,
    }
    this.baseMaterial = new THREE.MeshStandardNodeMaterial({ color: '#e8eaec', roughness: 0.65 })
    this.boardMaterial = new GlassPhysicalNodeMaterial(transmissionBackdrop.getTextureNode(), this.params)
    this.base = new THREE.Mesh(new RoundedBoxGeometry(0.72, 0.07, 0.26, 3, 0.012), this.baseMaterial)
    this.base.position.y = 0.035
    this.board = new THREE.Mesh(new RoundedBoxGeometry(0.65, 0.66, 0.025, 3, 0.008), this.boardMaterial)
    this.board.position.set(0, 0.4, -0.025)
    for (const mesh of [this.base, this.board]) {
      // 透射玻璃不投不透明矩形阴影；transparent 同时让 GTAO 预通道跳过整块背板。
      mesh.castShadow = mesh === this.base
      mesh.receiveShadow = true
      this.group.add(mesh)
    }
    this.label = new ExhibitLabel({ ...exhibitLabelLayout.parts, texture: labelTexture })
    // 标签嵌在实体背板前方，保留 0.002 的深度间距，避免贴着圆角边缘或形成 Z-fighting。
    this.label.mesh.position.set(0, 0.4, -0.0105)
    this.group.add(this.label.mesh)
    this.shell = new ExhibitSample({ sources: [sources.shell], width: 0.37, height: 0.28, plasticParams: sources.plasticParams, name: 'ExhibitShell' })
    this.dpad = new ExhibitSample({ sources: [sources.buttons.dpad], width: 0.11, height: 0.11, name: 'ExhibitDpad' })
    this.buttons = new ExhibitSample({ sources: ['a', 'b', 'x', 'y'].map(key => sources.buttons[key]), width: 0.13, height: 0.13, buttonPrint: sources.buttonPrint, name: 'ExhibitButtons' })
    this.shell.group.position.set(-0.1, 0.46, 0.002)
    this.dpad.group.position.set(0.2, 0.54, 0.002)
    this.buttons.group.position.set(0.2, 0.29, 0.002)
    this.group.add(this.shell.group, this.dpad.group, this.buttons.group)
    this.unregisterGlass = transmissionBackdrop.register(this.board, [this.label.mesh, this.shell.group, this.dpad.group, this.buttons.group])
    this.debugInit(debug)
  }

  debugInit(debug) {
    if (!debug?.ui) return
    this.folder = debug.ui.addFolder({ title: 'Parts Display / S2', expanded: false })
    this.folder.addBinding(this.params, 'boardColor').on('change', ({ value }) => {
      this.boardMaterial.color.set(value)
    })
    const glass = this.folder.addFolder({ title: 'WebGPU transmission' })
    for (const [key, min, max, step] of [
      ['glassTransmission', 0, 1, 0.01], ['glassRoughness', 0, 0.6, 0.01],
      ['glassIor', 1, 2, 0.01], ['glassThickness', 0.001, 0.15, 0.001],
      ['glassDispersion', 0, 10, 0.1], ['glassBlur', 0, 1, 0.01],
    ]) glass.addBinding(this.params, key, { min, max, step }).on('change', () => this.boardMaterial.setOptics(this.params))
    glass.addBinding(this.params, 'glassSamples', { options: { Low: 2, Medium: 4, High: 8 } })
      .on('change', ({ value }) => this.boardMaterial.setSamples(value))
    glass.addBinding(this.transmissionBackdrop.params, 'resolutionScale', { min: 0.25, max: 1, step: 0.25, label: 'Backdrop scale' })
      .on('change', () => this.transmissionBackdrop.resize())
    glass.addBinding(this.transmissionBackdrop.params, 'backside', { label: 'Backside pass' })
    glass.addBinding(this.transmissionBackdrop.params, 'backsideThickness', { min: 0.001, max: 0.1, step: 0.001 })
    this.folder.addBinding(this.params, 'shellColor').on('change', ({ value }) => this.shell.setColors({ shell: value }))
    for (const [key, min, max] of [['roughness', 0.2, 0.8], ['bumpStrength', 0, 0.3]]) {
      this.folder.addBinding(this.params, key, { min, max, step: 0.01 }).on('change', () => this.shell.setFinish(this.params))
    }
  }

  destroy() {
    this.unregisterGlass()
    this.folder?.dispose()
    for (const sample of [this.shell, this.dpad, this.buttons]) sample.destroy()
    this.label.destroy()
    this.base.geometry.dispose()
    this.board.geometry.dispose()
    this.boardMaterial.dispose()
    this.baseMaterial.dispose()
    this.group.removeFromParent()
  }
}
