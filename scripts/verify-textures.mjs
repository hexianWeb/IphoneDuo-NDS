import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js'
import { FloatType, LinearSRGBColorSpace, Texture } from 'three/webgpu'
import ExhibitLabel from '../src/js/World/Environment/ExhibitLabel.js'
import { downsampleLightmap, imageSize, parseGlb } from './optimize-textures.mjs'

const root = new URL('../public/', import.meta.url)
const hash = data => createHash('sha256').update(data).digest('hex')
const read = path => readFile(new URL(path, root))

const pixels = Float32Array.from({ length: 4 * 4 * 4 }, (_, i) => i % 4 === 3 ? 1 : (Math.floor(i / 4) - 4) * 0.5)
const smaller = downsampleLightmap({ data: pixels, width: 4, height: 4 })
assert.deepEqual([smaller.width, smaller.height], [2, 2])
assert.deepEqual([...smaller.data], [-0.75, -0.75, -0.75, 1, 0.25, 0.25, 0.25, 1, 3.25, 3.25, 3.25, 1, 4.25, 4.25, 4.25, 1])
assert.throws(() => downsampleLightmap({ data: pixels, width: 3, height: 4 }))

// 标签改为借用离线纹理；仍保留上一轮 1024×1041 分辨率与原物理排版，不依赖浏览器 Canvas。
const labelTexture = new Texture({ width: 1024, height: 1041 })
const label = new ExhibitLabel({ width: 0.61, height: 0.62, name: 'PartsLegend', cutout: true, texture: labelTexture })
assert.equal(label.texture.image.width, 1024)
assert.equal(label.texture.image.height, 1041)
assert.equal(label.material.alphaTest, 0.5)
assert.equal(label.mesh.geometry.parameters.width, 0.61)
assert.equal(label.mesh.geometry.parameters.height, 0.62)
label.destroy()
labelTexture.dispose()

const manifest = JSON.parse(await read('optimized/manifest.json'))
let before = 0
let after = 0
for (const asset of manifest.assets) {
  const [input, output] = await Promise.all([read(asset.input), read(asset.output)])
  assert.equal(hash(input), asset.inputSha256, `原始素材发生变化: ${asset.input}`)
  assert.equal(hash(output), asset.outputSha256, `派生素材需要重新生成: ${asset.output}`)
  assert.ok(output.length < input.length, `素材未减小: ${asset.output}`)
  if (process.argv.includes('--dist')) {
    const built = await readFile(new URL(`../dist/${asset.output}`, import.meta.url))
    assert.equal(hash(built), asset.outputSha256, `构建副本不匹配: ${asset.output}`)
    const originalInBuild = await access(new URL(`../dist/${asset.input}`, import.meta.url)).then(() => true, () => false)
    assert.equal(originalInBuild, false, `生产不能重复携带原始大图: ${asset.input}`)
  }
  before += input.length
  after += output.length
  if (asset.output.endsWith('.glb')) {
    const original = parseGlb(input)
    const optimized = parseGlb(output)
    const omitBinaryLayout = (gltf) => {
      const copy = structuredClone(gltf)
      delete copy.buffers
      copy.bufferViews.forEach((view) => { delete view.byteOffset; delete view.byteLength })
      return copy
    }
    assert.deepEqual(omitBinaryLayout(optimized.gltf), omitBinaryLayout(original.gltf), '不可改动节点、材质语义、UV 或几何定义')
    const imageViews = new Set(original.gltf.images.map(image => image.bufferView))
    original.gltf.bufferViews.forEach((view, index) => {
      const outputView = optimized.gltf.bufferViews[index]
      const bytes = optimized.binary.subarray(outputView.byteOffset, outputView.byteOffset + outputView.byteLength)
      if (imageViews.has(index)) {
        const image = optimized.gltf.images.find(image => image.bufferView === index)
        const size = imageSize(bytes, image.mimeType)
        assert.ok(size.width <= 512 && size.height <= 512)
      }
      else {
        assert.deepEqual(bytes, original.binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength), '几何字节不可改变')
      }
    })
  }
  if (asset.output.endsWith('.exr')) {
    const parsed = new EXRLoader().setDataType(FloatType).parse(output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength))
    assert.deepEqual([parsed.width, parsed.height], [1024, 1024])
    assert.equal(parsed.header.compression, 'ZIP_COMPRESSION')
    assert.equal(parsed.colorSpace, LinearSRGBColorSpace)
    assert.ok(parsed.data.some(value => value > 1), '不能裁掉 HDR 值')
  }
}
if (process.argv.includes('--dist')) {
  assert.equal(await access(new URL('../dist/nds', import.meta.url)).then(() => true, () => false), false, '构建不能包含本地 ROM')
}
console.log(`Texture verification passed: ${manifest.assets.length} derived assets, ${(before / 1e6).toFixed(2)} -> ${(after / 1e6).toFixed(2)} MB; original hashes, geometry bytes, labels and HDR checked`)
