import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import * as THREE from 'three/webgpu'
import ColorDock from '../src/js/World/Environment/ColorDock.js'
import ExhibitLabel from '../src/js/World/Environment/ExhibitLabel.js'
import { exhibitLabelLayout, getLabelImageSize, getLabelLayout, labelAssetKeys, themeLabelPresets } from '../src/js/World/Environment/exhibitLabelLayout.js'
import ThemeLabel from '../src/js/World/Environment/ThemeLabel.js'

const publicRoot = new URL(process.argv.includes('--dist') ? '../dist/labels/' : '../public/labels/', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('manifest.json', publicRoot), 'utf8'))
const hash = value => createHash('sha256').update(value).digest('hex')
const sources = await Promise.all(['labels/artwork.js', '../src/js/World/Environment/exhibitLabelLayout.js', '../src/js/World/Environment/themeLabelArtwork.js'].map(path => readFile(new URL(path, import.meta.url))))
assert.equal(manifest.sourceHash, hash(Buffer.concat(sources)), '标签绘图或尺寸改变后必须重生成')
assert.deepEqual(manifest.assets.map(asset => asset.key), labelAssetKeys)
for (const asset of manifest.assets) {
  const png = await readFile(new URL(asset.file, publicRoot))
  assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a')
  assert.equal(png.length, asset.bytes)
  assert.equal(hash(png), asset.sha256)
  const size = getLabelImageSize(getLabelLayout(asset.key))
  assert.equal(png.readUInt32BE(16), size.width)
  assert.equal(png.readUInt32BE(20), size.height)
}

function makeTexture(layout) {
  const size = getLabelImageSize(layout)
  return new THREE.Texture({ width: size.width, height: size.height })
}
const textures = []
for (const layout of Object.values(exhibitLabelLayout)) {
  const texture = makeTexture(layout)
  textures.push(texture)
  const label = new ExhibitLabel({ ...layout, texture })
  assert.equal(label.texture, texture)
  assert.equal(texture.isCanvasTexture, undefined)
  assert.equal(texture.colorSpace, THREE.SRGBColorSpace)
  assert.equal(texture.flipY, true)
  assert.equal(texture.anisotropy, layout.anisotropy ?? 8)
  assert.equal(label.material.map, texture)
  assert.equal(label.material.alphaTest, layout.cutout ? 0.5 : 0)
  assert.equal(label.material.transparent, false)
  assert.equal(label.mesh.receiveShadow, true)
  assert.equal(label.mesh.geometry.parameters.width, layout.width)
  assert.equal(label.mesh.geometry.parameters.height, layout.height)
  const disposed = { texture: 0, material: 0, geometry: 0 }
  for (const [key, value] of Object.entries({ texture, material: label.material, geometry: label.mesh.geometry })) {
    value.addEventListener('dispose', () => disposed[key]++)
  }
  label.destroy()
  assert.deepEqual(disposed, { texture: 0, material: 1, geometry: 1 }, '纹理由展区所有者释放，避免子标签双重释放')
}
assert.throws(() => new ExhibitLabel(exhibitLabelLayout.parts), /离线纹理/)
assert.throws(() => new ExhibitLabel({ ...exhibitLabelLayout.parts, texture: makeTexture(exhibitLabelLayout.dock) }), /离线纹理/)

const variants = Array.from({ length: 3 }, () => makeTexture(exhibitLabelLayout.dock))
textures.push(...variants)
const themes = themeLabelPresets.map(theme => ({ ...theme }))
const label = new ThemeLabel({ textures: variants, themes })
assert.equal(label.material.colorNode, null, '不得为离线标签引入定制 shader')
assert.equal(label.canvas, null)
const versions = [...variants.map(texture => texture.version), label.material.version]
for (const [index, theme] of themes.entries()) {
  label.setSelectedTheme(theme.key)
  assert.equal(label.texture, variants[index])
  assert.equal(label.material.map, variants[index])
  assert.equal(label.canvas, null)
}
assert.deepEqual([...variants.map(texture => texture.version), label.material.version], versions, '预设切换不得重上传纹理或重编材质')
const originalDocument = globalThis.document
let allocations = 0
try {
  globalThis.document = { createElement: (name) => {
    assert.equal(name, 'canvas')
    allocations++
    const context = new Proxy({}, { get: (object, key) => object[key] ?? (() => {}) })
    return { getContext: () => context }
  } }
  themes[1].buttons = '#ff0088'
  label.setPalette(themes)
  const canvas = label.canvas; const custom = label.dynamicTexture
  let disposed = 0
  custom.addEventListener('dispose', () => disposed++)
  assert.equal(label.texture, custom)
  assert.equal(custom.isCanvasTexture, true)
  label.setSelectedTheme('retro')
  label.setPalette(themes)
  assert.equal(label.canvas, canvas, '自定义调色复用单个画布')
  assert.equal(allocations, 1)
  label.setPalette(themeLabelPresets)
  assert.equal(label.texture, variants[1])
  assert.equal(label.canvas, null)
  assert.equal(canvas.width, 1)
  assert.equal(disposed, 1, '回到预设后释放临时自定义纹理')
  label.setSelectedTheme(null)
  assert.equal(label.texture.isCanvasTexture, true, '没有选中项时也必须保留无下划线语义')
  label.setSelectedTheme('classic')
  assert.equal(label.canvas, null)
}
finally {
  if (originalDocument === undefined)
    delete globalThis.document
  else globalThis.document = originalDocument
}
assert.throws(() => label.setPalette(themes.toReversed()), /原顺序/)
const dock = { label, themes, themeMeshes: new Map() }
const hit = x => ColorDock.prototype.getThemeAtHit.call(dock, { object: label.mesh, uv: new THREE.Vector2(x, 0.5) })
assert.equal(hit(0.549), null)
assert.equal(hit(0.622), 'classic')
assert.equal(hit(0.767), 'retro')
assert.equal(hit(0.912), 'midnight')
assert.equal(hit(0.985), 'midnight')
assert.equal(hit(0.986), null)
label.destroy()
for (const texture of textures) texture.dispose()

for (const name of ['ExhibitLabel', 'ColorDock', 'PartsDisplay', 'ExhibitProps', 'InternalComponentsDisplay', 'GameLibraryDisplay']) {
  const source = await readFile(new URL(`../src/js/World/Environment/${name}.js`, import.meta.url), 'utf8')
  assert.doesNotMatch(source, /new THREE\.CanvasTexture|\.getContext\(|\.fillText\(/, `${name} 不应保留运行时标签绘图`)
}
console.log('Offline labels passed: PNG hashes/sizes, Canvas-free presets, borrowed resources, lazy custom palette/cleanup, hit regions and no new shader')
