import { uniform } from 'three/tsl'
import * as THREE from 'three/webgpu'
import { plinthSurfaceNodes } from '../../../shaders/plinthSurface.js'
import { createPlinthGeometry } from './exhibitionGeometry.js'

export default class ProductPlinth {
  constructor({ debug } = {}) {
    this.group = new THREE.Group()
    this.group.name = 'ProductPlinth'
    this.surfaceParams = {
      grainFrequency: 95,
      roughnessFrequency: 32,
      roughnessVariation: 0.025,
      bumpStrength: 0.045,
    }
    this.surfaceUniforms = {}
    for (const [key, value] of Object.entries(this.surfaceParams)) this.surfaceUniforms[key] = uniform(value)
    const surface = plinthSurfaceNodes(this.surfaceUniforms)
    this.material = new THREE.MeshStandardNodeMaterial({ color: '#f0f1f2', roughness: 0.42, metalness: 0 })
    this.material.normalNode = surface.normal
    this.material.roughnessNode = surface.roughness
    this.trimMaterial = new THREE.MeshStandardNodeMaterial({
      color: '#f9e2bc',
      emissive: '#ffe2ac',
      emissiveIntensity: 0.8,
      roughness: 0.5,
    })
    this.body = new THREE.Mesh(new THREE.BufferGeometry(), this.material)
    this.body.name = 'PlinthBody'
    this.body.castShadow = true
    this.body.receiveShadow = true
    this.trim = new THREE.Mesh(new THREE.BufferGeometry(), this.trimMaterial)
    this.trim.name = 'PlinthEdgeLight'
    this.group.add(this.body, this.trim)
    this.edgeGlow = this.trimMaterial.emissiveIntensity
    this.spillParams = { enabled: true, strength: 4, color: '#ffe2ac' }
    // 这是灯带直接照向地面的窄面光源，不模拟间接反弹；LTC 由 Environment 统一初始化。
    this.spillLights = ['Front', 'Back', 'Left', 'Right'].map((side) => {
      const light = new THREE.RectAreaLight(this.spillParams.color, 0, 1, 0.01)
      light.name = `PlinthWarmSpill${side}`
      this.group.add(light)
      return light
    })
    this.setWarmSpill()
    this.debugInit(debug)
  }

  setLayout({ width, depth, height, radius, bevel, centerX, centerZ, supportY }) {
    const trimHeight = height * 0.07
    this.body.geometry.dispose()
    this.trim.geometry.dispose()
    this.body.geometry = createPlinthGeometry(width, depth, height - trimHeight, radius, bevel)
    this.trim.geometry = createPlinthGeometry(width - bevel, depth - bevel, trimHeight, radius, trimHeight * 0.2)
    this.group.position.set(centerX, supportY, centerZ)
    // 顶面固定为局部 Y=0；厚度变化只向下扩张，细灯带落在底部的独立高度区间。
    this.body.position.y = -(height - trimHeight) / 2
    this.trim.position.y = -height + trimHeight / 2
    this.setWarmSpillLayout({ width, depth, height, radius, trimHeight })
  }

  setAppearance({ color, roughness, edgeGlow }) {
    this.material.color.set(color)
    this.material.roughness = roughness
    this.trimMaterial.emissiveIntensity = edgeGlow
    this.edgeGlow = edgeGlow
    this.setWarmSpill()
  }

  setSurfaceAppearance(params = {}) {
    Object.assign(this.surfaceParams, params)
    for (const [key, value] of Object.entries(this.surfaceParams)) this.surfaceUniforms[key].value = value
  }

  setWarmSpill(params = {}) {
    Object.assign(this.spillParams, params)
    for (const light of this.spillLights) {
      light.color.set(this.spillParams.color)
      light.intensity = this.spillParams.enabled ? this.edgeGlow * this.spillParams.strength : 0
    }
  }

  setWarmSpillLayout({ width, depth, height, radius, trimHeight }) {
    const outwardOffset = Math.min(width, depth) * 0.001
    const edges = [
      { x: 0, z: depth / 2 + outwardOffset, length: width, outward: [0, 0, 1], tangent: [1, 0, 0] },
      { x: 0, z: -depth / 2 - outwardOffset, length: width, outward: [0, 0, -1], tangent: [1, 0, 0] },
      { x: -width / 2 - outwardOffset, z: 0, length: depth, outward: [-1, 0, 0], tangent: [0, 0, 1] },
      { x: width / 2 + outwardOffset, z: 0, length: depth, outward: [1, 0, 0], tangent: [0, 0, 1] },
    ]
    edges.forEach((edge, index) => {
      const light = this.spillLights[index]
      light.width = Math.max(edge.length - radius * 2, edge.length * 0.1)
      light.height = trimHeight * 0.7
      light.position.set(edge.x, -height + trimHeight / 2, edge.z)
      // RectAreaLight 沿局部 -Z 发光；用局部正交基让长边沿底缘，法向只朝下/外，避免照亮主机。
      const axisX = new THREE.Vector3(...edge.tangent)
      const axisZ = new THREE.Vector3(...edge.outward).setY(-0.45).normalize().negate()
      const axisY = axisZ.clone().cross(axisX).normalize()
      light.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(axisX, axisY, axisZ))
    })
  }

  debugInit(debug) {
    if (!debug?.ui)
      return
    this.folder = debug.ui.addFolder({ title: 'Plinth Surface / Warm Spill', expanded: false })
    const surface = this.folder.addFolder({ title: 'Matte micro surface', expanded: false })
    const ranges = {
      grainFrequency: [20, 250, 5],
      roughnessFrequency: [8, 120, 1],
      roughnessVariation: [0, 0.08, 0.005],
      bumpStrength: [0, 0.12, 0.005],
    }
    for (const [key, [min, max, step]] of Object.entries(ranges)) {
      surface.addBinding(this.surfaceParams, key, { min, max, step })
        .on('change', () => this.setSurfaceAppearance())
    }
    const spill = this.folder.addFolder({ title: 'Direct warm light', expanded: false })
    spill.addBinding(this.spillParams, 'enabled').on('change', () => this.setWarmSpill())
    spill.addBinding(this.spillParams, 'strength', { min: 0, max: 20, step: 0.1 })
      .on('change', () => this.setWarmSpill())
    spill.addBinding(this.spillParams, 'color').on('change', () => this.setWarmSpill())
  }

  destroy() {
    this.folder?.dispose()
    this.group.removeFromParent()
    this.body.geometry.dispose()
    this.trim.geometry.dispose()
    this.material.dispose()
    this.trimMaterial.dispose()
    for (const light of this.spillLights) light.removeFromParent()
    this.spillLights.length = 0
  }
}
