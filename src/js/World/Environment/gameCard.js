import * as THREE from 'three/webgpu'
import { createPlinthGeometry } from './exhibitionGeometry.js'

// 所有卡带共用同一壳体/触点规则，默认尺寸保留原地面卡带；纹理由调用方持有并回收。
export function createGameCard({ coverTexture, name = 'OriginalGameCard', width = 0.2, depth = 0.218, geometries, materials }) {
  if (!coverTexture?.image?.width || !coverTexture.image.height)
    throw new Error(`${name} 缺少有效的封面图片`)
  coverTexture.colorSpace = THREE.SRGBColorSpace
  coverTexture.anisotropy = 8
  const group = new THREE.Group()
  group.name = name
  const material = (color, roughness = 0.6, metalness = 0) => {
    const result = new THREE.MeshStandardNodeMaterial({ color, roughness, metalness })
    materials.add(result)
    return result
  }
  const mesh = (part, geometry, surface, position) => {
    geometries.add(geometry)
    const result = new THREE.Mesh(geometry, surface)
    result.name = name === 'OriginalGameCard' ? part : `${name}_${part}`
    result.position.set(...position)
    result.castShadow = true
    result.receiveShadow = true
    group.add(result)
    return result
  }
  const shell = material('#303c48', 0.52)
  const edge = material('#1e2831', 0.72)
  const contact = material('#b99a58', 0.36, 0.35)
  mesh('CardLowerShell', createPlinthGeometry(width, depth, 0.01, 0.012, 0.0015), edge, [0, 0.005, 0])
  mesh('CardUpperShell', createPlinthGeometry(width - 0.002, depth - 0.004, 0.016, 0.011, 0.002), shell, [0, 0.018, -0.001])
  const contactZ = depth / 2 - 0.026
  mesh('CardContactRecess', createPlinthGeometry(width * 0.775, 0.028, 0.001, 0.002, 0.0002), edge, [0, 0.0266, contactZ])
  const contactGeometry = new THREE.BoxGeometry(width * 0.05, 0.0007, 0.02)
  geometries.add(contactGeometry)
  const contacts = new THREE.InstancedMesh(contactGeometry, contact, 8)
  contacts.name = name === 'OriginalGameCard' ? 'CardContacts' : `${name}_CardContacts`
  contacts.castShadow = true
  contacts.receiveShadow = true
  const contactMatrix = new THREE.Matrix4()
  for (let i = 0; i < 8; i++) {
    contactMatrix.makeTranslation((i - 3.5) * width * 0.09, 0.0275, contactZ)
    contacts.setMatrixAt(i, contactMatrix)
  }
  // 固定触点共用一次实例绘制；标记矩阵版本供 WebGPU 上传与静态阴影脏检查读取。
  contacts.instanceMatrix.needsUpdate = true
  contacts.computeBoundingBox()
  contacts.computeBoundingSphere()
  group.add(contacts)
  // 每张卡独占触点几何；调用方回收几何时同步释放实例对象，保持原有资源所有权接口。
  const disposeContacts = () => {
    contacts.dispose()
    contactGeometry.removeEventListener('dispose', disposeContacts)
  }
  contactGeometry.addEventListener('dispose', disposeContacts)
  const coverMaterial = material('#ffffff', 0.65)
  coverMaterial.map = coverTexture
  // 图片在标签区域内 contain，完整保留原封面及角标；改变卡壳长度也不拉伸图片。
  const aspect = coverTexture.image.width / coverTexture.image.height
  const coverHeight = Math.min(depth - 0.062, (width - 0.035) / aspect)
  const cover = mesh('OriginalGameCardLabel', new THREE.PlaneGeometry(coverHeight * aspect, coverHeight), coverMaterial, [0, 0.028, -0.017])
  cover.name = `${name}Label`
  cover.rotation.x = -Math.PI / 2
  cover.castShadow = false
  return group
}
