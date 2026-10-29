import * as THREE from 'three/webgpu'
import { materialReference, modelWorldMatrix, normalView, positionLocal, uniform } from 'three/tsl'
import { filteredPlasticNoise, plasticSurfaceNormal } from '../../../shaders/controllerPlastic.js'
import { getButtonFrame } from './ButtonPrint.js'

export default class ControllerButtonMaterial {
  constructor({ buttons, debug, buttonPrint }) {
    this.buttonPrint = buttonPrint
    this.printFrame = getButtonFrame(buttons)
    this.originalMaterials = new Map()
    this.materials = new Set()
    this.params = {
      roughness: 0.28,
      roughnessVariation: 0.012,
      grainFrequency: 90,
      bumpStrength: 0.05,
      clearcoat: 0.85,
      clearcoatRoughness: 0.12,
      ior: 1.47,
    }
    this.uniforms = Object.fromEntries(
      Object.entries(this.params).map(([key, value]) => [key, uniform(value)]),
    )
    // 同一套表面算法只建一次；每枚按键的中心/尺度从当前材质读取，调参 uniform 仍由主机持有。
    const coordinate = positionLocal.sub(materialReference('_buttonSurface.center', 'vec3'))
      .mul(materialReference('_buttonSurface.scale', 'vec3'))
    const u = this.uniforms
    const grain = filteredPlasticNoise(coordinate.mul(u.grainFrequency)).toVar()
    const worldWidth = modelWorldMatrix.element(0).xyz.length().mul(materialReference('_buttonSurface.width', 'float'))
    const height = grain.mul(u.bumpStrength).div(u.grainFrequency).mul(worldWidth)
    this.surfaceNodes = {
      roughnessNode: u.roughness.add(grain.mul(u.roughnessVariation)).clamp(0.08, 1),
      normalNode: plasticSurfaceNormal(height),
      clearcoatNode: u.clearcoat,
      clearcoatRoughnessNode: u.clearcoatRoughness,
      iorNode: u.ior,
      // 底层有颗粒，清漆保持平滑几何法线，高光与外壳形成对比。
      clearcoatNormalNode: normalView,
    }
    Object.entries(buttons).forEach(([part, button]) => {
      this.originalMaterials.set(button, button.material)
      const original = button.material
      button.material = Array.isArray(original)
        ? original.map(material => this.createMaterial(button, material, part))
        : this.createMaterial(button, original, part)
    })
    this.debugInit(debug)
  }

  createMaterial(button, original, part) {
    button.geometry.computeBoundingBox()
    const bounds = button.geometry.boundingBox
    const size = bounds.getSize(new THREE.Vector3())
    const center = bounds.getCenter(new THREE.Vector3())
    button.updateWorldMatrix(true, false)
    const scale = button.getWorldScale(new THREE.Vector3())
    scale.set(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z))
    const width = Math.max(size.x * scale.x, size.y * scale.y, size.z * scale.z)
    if (!Number.isFinite(width) || width <= 0 || Math.min(scale.x, scale.y, scale.z) <= 0) {
      throw new Error(`${button.name} 无有效尺寸，无法建立按键材质坐标。`)
    }

    // 各按键以自身最长边为颗粒尺度基准，局部坐标随按键移动，不受装配位移影响。
    const material = new THREE.MeshPhysicalNodeMaterial({
      name: `${button.name}_Coated_Plastic`,
      color: original.color,
      map: original.map,
      vertexColors: original.vertexColors,
      side: original.side,
      transparent: original.transparent,
      opacity: original.opacity,
      alphaTest: original.alphaTest,
      alphaMap: original.alphaMap,
      depthWrite: original.depthWrite,
      metalness: 0,
      roughness: this.params.roughness,
      clearcoat: this.params.clearcoat,
      clearcoatRoughness: this.params.clearcoatRoughness,
      ior: this.params.ior,
    })
    material._buttonSurface = { center, scale: scale.clone().divideScalar(width), width: width / scale.x }
    Object.assign(material, this.surfaceNodes)
    this.buttonPrint.applyTo(material, { geometry: button.geometry, matrix: button.matrixWorld, part, frame: this.printFrame }, button)
    this.materials.add(material)
    return material
  }

  debugInit(debug) {
    if (!debug?.ui) return
    this.folder = debug.ui.addFolder({ title: 'Controller Button Plastic', expanded: false })
    const ranges = {
      roughness: [0.08, 0.6, 0.01],
      roughnessVariation: [0, 0.06, 0.001],
      grainFrequency: [10, 300, 1],
      bumpStrength: [0, 0.12, 0.001],
      clearcoat: [0, 1, 0.01],
      clearcoatRoughness: [0.03, 0.5, 0.01],
      ior: [1.3, 1.6, 0.01],
    }
    Object.entries(ranges).forEach(([key, [min, max, step]]) => {
      this.folder.addBinding(this.params, key, { min, max, step })
        .on('change', ({ value }) => { this.uniforms[key].value = value })
    })
  }

  getColors(button) {
    const materials = Array.isArray(button.material) ? button.material : [button.material]
    return materials.map(material => material.color.clone())
  }

  setColors(button, colors) {
    const materials = Array.isArray(button.material) ? button.material : [button.material]
    materials.forEach((material, index) => material.color.copy(colors[index]))
  }

  destroy() {
    this.folder?.dispose()
    this.originalMaterials.forEach((material, button) => { button.material = material })
    this.materials.forEach(material => material.dispose())
    this.originalMaterials.clear()
    this.materials.clear()
  }
}
