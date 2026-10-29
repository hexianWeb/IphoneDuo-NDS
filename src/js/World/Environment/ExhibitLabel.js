import * as THREE from 'three/webgpu'
import { getLabelImageSize } from './exhibitLabelLayout.js'

export default class ExhibitLabel {
  constructor({ width, height, name, texture, cutout = false, resolution = 1024, anisotropy = 8 }) {
    const size = getLabelImageSize({ width, height, resolution })
    if (!texture?.isTexture || texture.image?.width !== size.width || texture.image?.height !== size.height) {
      throw new Error(`展品标签 ${name} 缺少 ${size.width}×${size.height} 离线纹理，请运行 generate-labels`)
    }
    // 只借用 Resources 已加载的纹理；Exhibition 统一持有/释放，标签只拥有几何和材质。
    this.texture = texture
    this.texture.name = `${name}_Labels`
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.flipY = true
    this.texture.anisotropy = anisotropy
    this.material = new THREE.MeshStandardNodeMaterial({
      name: `${name}_Label_Surface`, map: this.texture, roughness: 0.65, metalness: 0,
      // 镂空标签仍走不透明深度通道，只保留纸签/文字像素，避免整张画布盖住玻璃。
      alphaTest: cutout ? 0.5 : 0,
    })
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), this.material)
    this.mesh.name = name
    this.mesh.receiveShadow = true
  }

  destroy() {
    this.mesh.removeFromParent()
    this.mesh.geometry.dispose()
    this.material.dispose()
  }
}
