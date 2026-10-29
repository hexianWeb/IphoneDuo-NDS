import { color, float, materialClearcoat, materialColor, materialRoughness, materialSpecularIntensity, mix, normalLocal, positionLocal, reference, smoothstep, step, texture, uniform, vec2, vec3 } from 'three/tsl'
import * as THREE from 'three/webgpu'

const LETTERS = ['a', 'b', 'x', 'y']
const PIXEL_GLYPHS = {
  a: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  b: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  x: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
}
const EXHIBIT_FRAME = {
  right: new THREE.Vector3(1, 0, 0),
  up: new THREE.Vector3(0, 1, 0),
  normal: new THREE.Vector3(0, 0, 1),
}

export function getButtonFrame(buttons) {
  const centerOf = (mesh) => {
    mesh.updateWorldMatrix(true, false)
    mesh.geometry.computeBoundingBox()
    return mesh.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(mesh.matrixWorld)
  }
  const right = centerOf(buttons.a).sub(centerOf(buttons.y)).normalize()
  const up = centerOf(buttons.x).sub(centerOf(buttons.b))
  up.addScaledVector(right, -up.dot(right)).normalize()
  const normal = new THREE.Vector3().crossVectors(right, up).normalize()
  if (right.lengthSq() < 0.99 || up.lengthSq() < 0.99 || normal.lengthSq() < 0.99) {
    throw new Error('无法从 ABXY 布局建立按键印花坐标。')
  }
  return { right, up, normal }
}

export default class ButtonPrint {
  constructor(debug) {
    const canvas = document.createElement('canvas')
    canvas.width = 1024
    canvas.height = 256
    const context = canvas.getContext('2d')
    if (!context)
      throw new Error('无法创建按键字母纹理')
    context.fillStyle = '#fff'
    // 5×7 点阵按整数像素绘制，不依赖系统字体；每个字形在自己的 256² 图集格子中居中。
    const pixel = 24
    LETTERS.forEach((letter, index) => {
      PIXEL_GLYPHS[letter].forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          if (row[x] === '1')
            context.fillRect(index * 256 + 68 + x * pixel, 44 + y * pixel, pixel, pixel)
        }
      })
    })
    this.texture = new THREE.CanvasTexture(canvas)
    this.texture.name = 'Controller_ABXY_Print_Atlas'
    this.texture.colorSpace = THREE.NoColorSpace
    this.texture.minFilter = THREE.LinearMipmapLinearFilter
    this.texture.magFilter = THREE.NearestFilter
    this.params = { size: 0.85, opacity: 1 }
    this.size = uniform(this.params.size)
    this.opacity = uniform(this.params.opacity)
    this.surfaceNodes = new Map()
    if (!debug?.ui)
      return
    this.folder = debug.ui.addFolder({ title: 'Controller Button Print', expanded: false })
    this.folder.addBinding(this.params, 'size', { min: 0.45, max: 0.95, step: 0.01 })
      .on('change', ({ value }) => { this.size.value = value })
    this.folder.addBinding(this.params, 'opacity', { min: 0, max: 1, step: 0.01 })
      .on('change', ({ value }) => { this.opacity.value = value })
  }

  applyTo(material, { geometry, matrix, part, frame = EXHIBIT_FRAME }, object) {
    const index = LETTERS.indexOf(part)
    if (index < 0)
      return
    if (object?.geometry !== geometry)
      throw new Error(`${part} 印花缺少对应的按键 Mesh`)
    geometry.computeBoundingBox()
    const center = geometry.boundingBox.getCenter(new THREE.Vector3())
    // 投影方向作为协向量用 Mᵀ 换回 Mesh 局部坐标；逆矩阵的方向变换在非均匀缩放下会扭曲文字。
    const columns = [0, 1, 2].map(axis => new THREE.Vector3().setFromMatrixColumn(matrix, axis))
    const project = direction => new THREE.Vector3(...columns.map(column => column.dot(direction)))
    const right = project(frame.right)
    const up = project(frame.up)
    const depth = project(frame.normal)
    const min = new THREE.Vector3(Infinity, Infinity, Infinity)
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity)
    const point = new THREE.Vector3()
    const projected = new THREE.Vector3()
    const positions = geometry.attributes.position
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).sub(center)
      projected.set(point.dot(right), point.dot(up), point.dot(depth))
      min.min(projected)
      max.max(projected)
    }
    const width = Math.min(max.x - min.x, max.y - min.y)
    const thickness = max.z - min.z
    if (width <= 0 || thickness <= 0)
      throw new Error(`${part} 无有效的印花表面`)
    // 投影只依赖 Mesh 的几何/静止坐标，多材质也用同一表面；配色仍归各材质独立所有。
    object._buttonPrint = {
      center,
      right,
      up,
      depth,
      width,
      index,
      normal: depth.clone().normalize(),
      topRange: new THREE.Vector2(max.z - thickness * 0.18, max.z - thickness * 0.02),
    }
    // Inspector 的预览球复用材质而不是原 Mesh；保留同一份静止投影数据供独立材质预览读取。
    material._buttonPrint = object._buttonPrint
    if (!this.projectionNodes)
      this.projectionNodes = this.createProjectionNodes()
    const roughness = material.roughnessNode ?? materialRoughness
    const clearcoat = material.clearcoatNode ?? materialClearcoat
    const specular = material.specularIntensityNode ?? materialSpecularIntensity
    const key = `${roughness.id}/${clearcoat.id}/${specular.id}`
    let nodes = this.surfaceNodes.get(key)
    if (!nodes) {
      const { colorNode, matteInk } = this.projectionNodes
      nodes = {
        colorNode,
        roughnessNode: mix(roughness, float(0.7), matteInk),
        clearcoatNode: clearcoat.mul(float(1).sub(matteInk.mul(0.95))),
        specularIntensityNode: specular.mul(float(1).sub(matteInk.mul(0.75))),
      }
      this.surfaceNodes.set(key, nodes)
    }
    Object.assign(material, nodes)
  }

  createProjectionNodes() {
    // 阴影 pass 会覆写当前材质但保留 Mesh；从当前对象取投影，不能引用临时 ShadowMaterial。
    const data = (name, type) => {
      const node = reference(`_buttonPrint.${name}`, type)
      node.onReference(function ({ object, material }) {
        // 实景/阴影优先用实际 Mesh；只有预览等无投影 Mesh 的入口才读取当前材质上的参数。
        this.reference = object?._buttonPrint ? object : material
        return this.reference
      })
      return node
    }
    const local = positionLocal.sub(data('center', 'vec3'))
    const printUv = vec2(local.dot(data('right', 'vec3')), local.dot(data('up', 'vec3')))
      .div(data('width', 'float').mul(this.size))
      .add(0.5)
    const atlasUv = vec2(printUv.x.add(data('index', 'float')).div(4), printUv.y)
    const alpha = texture(this.texture, atlasUv).a
    const inBounds = step(0, printUv.x).mul(step(printUv.x, 1)).mul(step(0, printUv.y)).mul(step(printUv.y, 1))
    const luminance = materialColor.rgb.dot(vec3(0.2126, 0.7152, 0.0722))
    const lightKeycap = smoothstep(0.32, 0.45, luminance)
    // 深度与几何法线双重限制：只印在朝外的键帽顶面，不把字母投到侧壁和底面。
    const topRange = data('topRange', 'vec2')
    const top = smoothstep(topRange.x, topRange.y, local.dot(data('depth', 'vec3')))
    const face = smoothstep(0.6, 0.95, normalLocal.dot(data('normal', 'vec3')))
    // 缩小时 mipmap 会把细点阵平均成半透明灰，浅键帽的深字单独提高覆盖率，保留像素边缘的可读性。
    const inkAlpha = mix(alpha, smoothstep(0.05, 0.45, alpha), lightKeycap)
    const mask = inkAlpha.mul(inBounds).mul(top).mul(face).mul(this.opacity)
    const ink = mix(color('#f5f5f7'), color('#101014'), lightKeycap)
    // 浅键帽的深色油墨单独采用哑光表面，避免清漆高光把字母冲成与奶白底色相近的灰。
    // 只在对应印花像素生效；深色键帽的浅字、键帽其余表面和已有颗粒节点保持原来的材质响应。
    return { colorNode: mix(materialColor.rgb, ink, mask), matteInk: mask.mul(lightKeycap) }
  }

  destroy() {
    this.folder?.dispose()
    this.surfaceNodes.clear()
    this.projectionNodes = null
    this.texture.dispose()
  }
}
