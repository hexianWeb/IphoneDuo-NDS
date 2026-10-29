import { float, modelWorldMatrix, positionLocal, uniform } from 'three/tsl'
import * as THREE from 'three/webgpu'
import { filteredPlasticNoise, plasticSurfaceNormal } from '../../../shaders/controllerPlastic.js'

// 每次调用创建独立 uniform 和材质；配色样品不能浅复制主机的 NodeMaterial 节点图。
export function createControllerPlasticMaterial(shell, overrides = {}) {
  const params = {
    color: '#3e5f7c',
    colorVariation: 0.025,
    colorFrequency: 1500,
    roughness: 0.45,
    roughnessVariation: 0.035,
    grainFrequency: 320,
    bumpStrength: 0.16,
    printLayers: false,
    printAxis: 'y',
    printFrequency: 160,
    printStrength: 0.015,
    ...overrides,
  }
  const uniforms = {
    color: uniform(new THREE.Color(params.color)),
    printAxis: uniform(new THREE.Vector3().setComponent({ x: 0, y: 1, z: 2 }[params.printAxis], 1)),
    printStrength: uniform(params.printLayers ? params.printStrength : 0),
  }
  for (const key of ['colorVariation', 'colorFrequency', 'roughness', 'roughnessVariation', 'grainFrequency', 'bumpStrength', 'printFrequency']) {
    uniforms[key] = uniform(params[key])
  }
  shell.geometry.computeBoundingBox()
  const bounds = shell.geometry.boundingBox
  const size = bounds.getSize(new THREE.Vector3())
  const center = bounds.getCenter(new THREE.Vector3())
  shell.updateWorldMatrix(true, false)
  const scale = shell.getWorldScale(new THREE.Vector3())
  scale.set(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z))
  const width = Math.max(size.x * scale.x, size.y * scale.y, size.z * scale.z)
  if (!Number.isFinite(width) || width <= 0 || Math.min(scale.x, scale.y, scale.z) <= 0) {
    throw new Error(`${shell.name} 无有效尺寸，无法建立程序化材质坐标。`)
  }
  // 保留局部轴并补偿导出缩放；摆放和后续整组缩放不改变颗粒数量。
  const coordinate = positionLocal.sub(center).mul(scale.clone().divideScalar(width))
  const u = uniforms
  const colorNoise = filteredPlasticNoise(coordinate.mul(u.colorFrequency)).toVar()
  const grain = filteredPlasticNoise(coordinate.mul(u.grainFrequency)).toVar()
  const layerPhase = coordinate.dot(u.printAxis).mul(u.printFrequency)
  const layerFootprint = layerPhase.fwidth()
  const layerVisibility = float(1).sub(layerFootprint.smoothstep(0.25, 0.75))
  const layers = layerPhase.mul(Math.PI * 2).sin().mul(layerVisibility)
  // 高度与视空间位置同量纲；每个实例的模型矩阵补偿尺度，层纹和微法线随实例转动。
  const worldWidth = modelWorldMatrix.element(0).xyz.length().mul(width / scale.x)
  const height = grain.mul(u.bumpStrength).div(u.grainFrequency).add(layers.mul(u.printStrength).div(u.printFrequency.mul(Math.PI * 2))).mul(worldWidth)
  const original = Array.isArray(shell.material) ? shell.material[0] : shell.material
  const material = new THREE.MeshStandardNodeMaterial({
    metalness: 0,
    roughness: params.roughness,
    side: overrides.side ?? original?.side ?? THREE.FrontSide,
    name: 'Controller_Shell_Procedural_Plastic',
  })
  material.colorNode = u.color.mul(float(1).add(colorNoise.mul(u.colorVariation)))
  material.roughnessNode = u.roughness.add(grain.mul(u.roughnessVariation)).clamp(0.08, 1)
  material.normalNode = plasticSurfaceNormal(height)
  return { params, uniforms, material }
}
