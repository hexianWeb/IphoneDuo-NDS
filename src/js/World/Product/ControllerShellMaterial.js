import { createControllerPlasticMaterial } from './createControllerPlasticMaterial.js'

export default class ControllerShellMaterial {
  constructor({ shell, debug }) {
    this.shell = shell
    this.originalMaterial = shell.material
    const plastic = createControllerPlasticMaterial(shell)
    this.params = plastic.params
    this.uniforms = plastic.uniforms
    this.material = plastic.material
    shell.material = this.material
    this.debugInit(debug)
  }

  debugInit(debug) {
    if (!debug?.ui)
      return
    this.folder = debug.ui.addFolder({ title: 'Controller Shell Plastic', expanded: false })
    this.colorBinding = this.folder.addBinding(this.params, 'color', { label: 'Base color' })
      .on('change', ({ value }) => this.uniforms.color.value.set(value))
    const ranges = {
      colorVariation: [0, 0.1, 0.001],
      colorFrequency: [1, 10000, 1],
      roughness: [0.15, 0.9, 0.01],
      roughnessVariation: [0, 0.12, 0.001],
      grainFrequency: [20, 1200, 1],
      bumpStrength: [0, 0.4, 0.005],
      printFrequency: [10, 800, 1],
    }
    Object.entries(ranges).forEach(([key, [min, max, step]]) => {
      this.folder.addBinding(this.params, key, { min, max, step })
        .on('change', ({ value }) => { this.uniforms[key].value = value })
    })
    this.folder.addBinding(this.params, 'printLayers', { label: 'Print layers' })
      .on('change', () => this.updatePrintStrength())
    this.folder.addBinding(this.params, 'printStrength', { min: 0, max: 0.1, step: 0.001 })
      .on('change', () => this.updatePrintStrength())
    this.folder.addBinding(this.params, 'printAxis', { options: { X: 'x', Y: 'y', Z: 'z' } })
      .on('change', ({ value }) => {
        this.uniforms.printAxis.value.set(0, 0, 0)
        this.uniforms.printAxis.value[value] = 1
      })
  }

  updatePrintStrength() {
    this.uniforms.printStrength.value = this.params.printLayers ? this.params.printStrength : 0
  }

  setColor(color) {
    this.uniforms.color.value.copy(color)
    this.params.color = `#${color.getHexString()}`
  }

  refreshColor() {
    this.colorBinding?.refresh()
  }

  destroy() {
    this.folder?.dispose()
    this.shell.material = this.originalMaterial
    this.material.dispose()
  }
}
