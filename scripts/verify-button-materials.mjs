import assert from 'node:assert/strict'
import * as THREE from 'three/webgpu'
import { uniform } from 'three/tsl'
import ButtonPrint from '../src/js/World/Product/ButtonPrint.js'
import ControllerButtonMaterial from '../src/js/World/Product/ControllerButtonMaterial.js'
import ExhibitSample from '../src/js/World/Environment/ExhibitSample.js'

const document = globalThis.document
globalThis.document = { createElement: () => ({ getContext: () => ({ fillRect() {} }) }) }
try {
  const print = new ButtonPrint()
  const geometry = new THREE.BoxGeometry(2, 1, 0.5).translate(1, -2, 3)
  const matrix = new THREE.Matrix4().makeScale(2, 3, 4)
  const printedMeshes = []
  const materials = ['a', 'b', 'x', 'y'].map((part) => {
    const material = new THREE.MeshPhysicalNodeMaterial({ clearcoat: 0.85 })
    const object = new THREE.Mesh(geometry, material)
    printedMeshes.push(object)
    print.applyTo(material, { geometry, matrix, part }, object)
    return material
  })
  // 模拟实际阴影的覆写材质，读取必须仍落在原 Mesh；只比较节点 hash 捕捉不到这一错误。
  const shadowMaterial = new THREE.NodeMaterial()
  const projectionReferences = new Set()
  materials[0].colorNode.traverse(node => {
    if (node.property?.startsWith('_buttonPrint.')) projectionReferences.add(node)
  })
  assert.equal(projectionReferences.size, 8)
  for (const object of printedMeshes) {
    for (const node of projectionReferences) {
      node.updateReference({ material:shadowMaterial, object })
      node.updateValue()
    }
    const indexNode = [...projectionReferences].find(node => node.property === '_buttonPrint.index')
    assert.equal(indexNode.node.value, printedMeshes.indexOf(object), '跨 Mesh 重绘时必须更新字母编号')
  }
  // Inspector 使用同一材质在独立球体上预览，球体没有产品 Mesh 的投影数据。
  const previewGeometry = new THREE.SphereGeometry(1, 8, 6)
  const preview = new THREE.Mesh(previewGeometry, materials[0])
  preview.name = 'Needle Preview sphere'
  for (const node of projectionReferences) {
    node.updateReference({ material:preview.material, object:preview })
    node.updateValue()
  }
  assert.equal([...projectionReferences].find(node => node.property === '_buttonPrint.index').node.value, 0)
  previewGeometry.dispose()
  assert.equal(new Set(materials.map(m => m.customProgramCacheKey())).size, 1, '字母与投影数据不应拆成四份节点图')
  for (const [index, material] of materials.entries()) {
    const data = printedMeshes[index]._buttonPrint
    assert.equal(data.index, index)
    assert.deepEqual(data.center.toArray(), [1, -2, 3])
    assert.deepEqual(data.right.toArray(), [2, 0, 0])
    assert.deepEqual(data.up.toArray(), [0, 3, 0])
    assert.deepEqual(data.depth.toArray(), [0, 0, 4])
    assert.deepEqual(data.normal.toArray(), [0, 0, 1])
    assert.equal(data.width, 3, '非均匀缩放必须用协向量投影')
    assert.ok(Math.abs(data.topRange.x - 0.64) < 1e-6)
    assert.ok(Math.abs(data.topRange.y - 0.96) < 1e-6)
  }
  materials[0].color.set('#e8743b')
  assert.equal(materials[1].color.getHexString(), 'ffffff')
  assert.notEqual(printedMeshes[0]._buttonPrint, printedMeshes[1]._buttonPrint)
  assert.notEqual(printedMeshes[0]._buttonPrint.right, printedMeshes[1]._buttonPrint.right)
  const dpad = new THREE.MeshPhysicalNodeMaterial()
  print.applyTo(dpad, { geometry, matrix, part: 'dpad' })
  assert.equal(dpad.colorNode, null, 'D-Pad 不参与字母图集')
  assert.throws(() => print.applyTo(dpad, { geometry, matrix, part: 'a' }), /Mesh/)
  const altered = new THREE.MeshPhysicalNodeMaterial()
  altered.roughnessNode = uniform(0.4)
  print.applyTo(altered, { geometry, matrix, part: 'a' }, new THREE.Mesh(geometry, altered))
  assert.notEqual(altered.roughnessNode, materials[0].roughnessNode, '不同基础表面不能误复用节点')

  const original = new THREE.MeshStandardNodeMaterial({ color: '#d2d0c1' })
  const group = new THREE.Group()
  const buttons = Object.fromEntries(['a', 'b', 'x', 'y', 'dpad'].map((part, index) => {
    const mesh = new THREE.Mesh(geometry, original)
    mesh.name = `Button_${part}`
    mesh.position.fromArray([[1, 0, 0], [0, -1, 0], [0, 1, 0], [-1, 0, 0], [-3, 0, 0]][index])
    group.add(mesh)
    return [part, mesh]
  }))
  const controller = new ControllerButtonMaterial({ buttons, buttonPrint: print })
  const abxy = ['a', 'b', 'x', 'y'].map(part => buttons[part].material)
  assert.equal(new Set(abxy.map(m => m.normalNode)).size, 1, '主机颗粒节点应共享')
  assert.equal(new Set(abxy.map(m => m.customProgramCacheKey())).size, 1)
  assert.notEqual(buttons.dpad.material.colorNode, buttons.a.material.colorNode)
  const colors = controller.getColors(buttons.a)
  colors[0].set('#6c4f9e')
  controller.setColors(buttons.a, colors)
  assert.equal(buttons.a.material.color.getHexString(), '6c4f9e')
  assert.equal(buttons.b.material.color.getHexString(), 'd2d0c1')

  const sources = ['a', 'b', 'x', 'y', 'dpad'].map((part, index) => ({
    name: part, part, geometry, matrix: new THREE.Matrix4().makeTranslation(index * 3, 0, 0),
    materials: [{ color: new THREE.Color('#ffffff'), side: THREE.FrontSide }],
  }))
  const classic = new ExhibitSample({ sources, width: 1, height: 1, buttonPrint: print, name: 'ClassicCheck' })
  const retro = new ExhibitSample({ sources, width: 1, height: 1, buttonPrint: print, name: 'RetroCheck' })
  retro.setColors({ buttons: '#6c4f9e', dpad: '#34373c' })
  for (let i = 0; i < 4; i++) {
    assert.notEqual(classic.meshes[i].material, retro.meshes[i].material)
    assert.equal(classic.meshes[i].material.colorNode, retro.meshes[i].material.colorNode)
    assert.equal(classic.meshes[i].material.color.getHexString(), 'ffffff')
    assert.equal(retro.meshes[i].material.color.getHexString(), '6c4f9e')
    assert.equal(classic.meshes[i].geometry, geometry, '不得为了复用节点复制或修改 GLB Geometry')
  }
  let geometryDisposals = 0
  let retroDisposals = 0
  geometry.addEventListener('dispose', () => geometryDisposals++)
  retro.meshes[0].material.addEventListener('dispose', () => retroDisposals++)
  classic.destroy()
  assert.equal(geometryDisposals, 0)
  assert.equal(retroDisposals, 0)
  retro.destroy()
  assert.equal(retroDisposals, 1)
  controller.destroy()
  assert.ok(Object.values(buttons).every(button => button.material === original))
  print.destroy()
  geometry.dispose()
  original.dispose()
  materials.forEach(material => material.dispose())
  dpad.dispose()
  altered.dispose()
  shadowMaterial.dispose()
} finally {
  if (document === undefined) delete globalThis.document
  else globalThis.document = document
}
console.log('Button materials passed: shared graphs, independent projection/colors, nonuniform scale, D-Pad, distinct surfaces and resource ownership')
