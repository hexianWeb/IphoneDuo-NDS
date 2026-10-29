import { materialColor } from 'three/tsl'
import * as THREE from 'three/webgpu'
import { screenIrisMask } from '../../../shaders/screenEffects.js'
import { canvasUvToTouch, getContainRect, getPixelCoverRect } from '../../NDS/screenMapping.js'

const FILL_BRIGHTNESS = 0.4

export function getScreenUvAspect(screen) {
  screen.updateWorldMatrix(true, false)
  const { position, uv } = screen.geometry.attributes
  const indices = screen.geometry.index
  const count = indices?.count ?? position.count
  for (let offset = 0; offset + 2 < count; offset += 3) {
    const ids = [0, 1, 2].map(index => indices ? indices.getX(offset + index) : offset + index)
    const points = ids.map(index => new THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(screen.matrixWorld))
    const coords = ids.map(index => new THREE.Vector2().fromBufferAttribute(uv, index))
    const first = coords[1].sub(coords[0])
    const second = coords[2].sub(coords[0])
    const determinant = first.x * second.y - second.x * first.y
    if (Math.abs(determinant) < 1e-10)
      continue
    const edge1 = points[1].sub(points[0])
    const edge2 = points[2].sub(points[0])
    // 用 UV 对世界位置的导数求物理宽高，避开折叠后的世界包围盒与非均匀缩放误差。
    const tangentU = edge1.clone().multiplyScalar(second.y).addScaledVector(edge2, -first.y)
    const tangentV = edge2.clone().multiplyScalar(first.x).addScaledVector(edge1, -second.x)
    const aspect = tangentU.length() / tangentV.length()
    if (Number.isFinite(aspect) && aspect > 0)
      return aspect
  }
  throw new Error(`${screen.name} 无法推导屏幕 UV 物理比例`)
}

export default class NDSGameSurface {
  constructor(screen, { flipY, mirrorX, aspect, entryUniforms }) {
    // 显示比例是产品 UI 的明确映射约束；模型物理比例只用于未配置时的诊断回退。
    this.aspect = aspect ?? 1 / getScreenUvAspect(screen)
    this.canvas = document.createElement('canvas')
    this.canvas.width = Math.max(1, Math.round(512 * Math.min(this.aspect, 1)))
    this.canvas.height = Math.max(1, Math.round(512 / Math.max(this.aspect, 1)))
    this.context = this.canvas.getContext('2d', { alpha: false })
    if (!this.context)
      throw new Error('无法创建 NDS 屏幕适配 Canvas')
    this.rect = getContainRect(this.canvas.width, this.canvas.height)
    this.pixelRect = getPixelCoverRect(this.canvas.width, this.canvas.height)

    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.name = `${screen.name}_NDS_Texture`
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.flipY = flipY
    this.texture.minFilter = THREE.LinearFilter
    this.texture.magFilter = THREE.NearestFilter
    this.texture.generateMipmaps = false
    this.texture.center.set(0.5, 0.5)
    this.texture.repeat.set(mirrorX ? -1 : 1, 1)
    this.texture.rotation = -Math.PI / 2
    this.texture.updateMatrix()
    const original = Array.isArray(screen.material) ? screen.material[0] : screen.material
    this.material = new THREE.MeshBasicNodeMaterial({
      map: this.texture,
      color: new THREE.Color().setScalar(0.75),
      side: original?.side ?? THREE.FrontSide,
      toneMapped: true,
    })
    this.material.name = `${screen.name}_NDS_Material`
    if (entryUniforms)
      this.material.colorNode = materialColor.rgb.mul(screenIrisMask(entryUniforms))
    this.interactionUv = new THREE.Vector2()
  }

  draw(source) {
    const { width, height } = this.canvas
    const cover = this.pixelRect
    this.context.save()
    this.context.imageSmoothingEnabled = false
    this.context.fillStyle = '#080b10'
    this.context.fillRect(0, 0, width, height)
    // brightness 只降低明度，不引入 blur；关插值后空白区保持方块像素。
    this.context.filter = `brightness(${FILL_BRIGHTNESS})`
    this.context.drawImage(source, cover.x, cover.y, cover.width, cover.height)
    this.context.restore()

    const { x, y, width: contentWidth, height: contentHeight } = this.rect
    this.context.save()
    this.context.imageSmoothingEnabled = false
    this.context.drawImage(source, x, y, contentWidth, contentHeight)
    this.context.restore()
    this.texture.needsUpdate = true
  }

  getTouchAtUv(uv) {
    if (!uv)
      return null
    // 与实际纹理共用 transformUv（含 flipY），再扣除 Canvas 黑边，避免双重旋转。
    const canvasUv = this.texture.transformUv(this.interactionUv.copy(uv))
    return canvasUvToTouch(canvasUv, this.canvas.width, this.canvas.height, this.rect)
  }

  destroy() {
    this.material.dispose()
    this.texture.dispose()
    this.context = null
    this.canvas = null
  }
}
