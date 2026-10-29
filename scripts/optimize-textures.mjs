import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { DataTexture, FloatType, HalfFloatType, RGBAFormat } from 'three/webgpu'
import { EXRExporter } from 'three/addons/exporters/EXRExporter.js'
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js'

const run = promisify(execFile)
const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const arrayBuffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)

export function imageSize(bytes, mimeType) {
  if (mimeType === 'image/png') {
    assert.equal(bytes.toString('hex', 0, 8), '89504e470d0a1a0a')
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  }
  assert.equal(mimeType, 'image/jpeg')
  assert.equal(bytes.readUInt16BE(0), 0xFFD8)
  let offset = 2
  while (offset + 9 < bytes.length) {
    assert.equal(bytes[offset++], 0xFF)
    while (bytes[offset] === 0xFF) offset++
    const marker = bytes[offset++]
    const length = bytes.readUInt16BE(offset)
    assert.ok(length >= 2)
    if ([0xC0, 0xC1, 0xC2].includes(marker)) {
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) }
    }
    offset += length
  }
  throw new Error('未找到 JPEG 尺寸')
}

// 只在线性浮点域求面积平均，不能经普通 8/16 位图片工具裁掉 HDR 高光或负值。
export function downsampleLightmap({ data, width, height }, factor = 2) {
  assert.ok(Number.isInteger(factor) && factor > 0)
  assert.equal(width % factor, 0)
  assert.equal(height % factor, 0)
  assert.equal(data.length, width * height * 4)
  const outputWidth = width / factor
  const outputHeight = height / factor
  const output = new Float32Array(outputWidth * outputHeight * 4)
  for (let y = 0; y < outputHeight; y++) {
    for (let x = 0; x < outputWidth; x++) {
      for (let c = 0; c < 4; c++) {
        let sum = 0
        for (let dy = 0; dy < factor; dy++) {
          for (let dx = 0; dx < factor; dx++) {
            const value = data[((y * factor + dy) * width + x * factor + dx) * 4 + c]
            assert.ok(Number.isFinite(value) && Math.abs(value) <= 65504, 'Lightmap 超出有限 HALF 范围')
            sum += value
          }
        }
        output[(y * outputWidth + x) * 4 + c] = sum / (factor * factor)
      }
    }
  }
  return { data: output, width: outputWidth, height: outputHeight }
}

export function parseGlb(bytes) {
  assert.equal(bytes.readUInt32LE(0), 0x46546C67)
  assert.equal(bytes.readUInt32LE(4), 2)
  assert.equal(bytes.readUInt32LE(8), bytes.length)
  assert.equal(bytes.readUInt32LE(16), 0x4E4F534A)
  const jsonLength = bytes.readUInt32LE(12)
  const binaryHeader = 20 + jsonLength
  assert.equal(bytes.readUInt32LE(binaryHeader + 4), 0x004E4942)
  const gltf = JSON.parse(bytes.toString('utf8', 20, binaryHeader))
  assert.equal(gltf.buffers.length, 1)
  assert.ok(!gltf.buffers[0].uri)
  return { gltf, binary: bytes.subarray(binaryHeader + 8, binaryHeader + 8 + bytes.readUInt32LE(binaryHeader)) }
}

// bufferView 索引及其它 JSON 保持；只重排字节区以去掉已被替换的内嵌大图。
export function repackGlb({ gltf, binary }, replacements) {
  const output = structuredClone(gltf)
  const chunks = []
  let length = 0
  output.bufferViews = gltf.bufferViews.map((view, index) => {
    assert.equal(view.buffer, 0)
    const bytes = replacements.get(index) ?? binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)
    const result = { ...view, byteOffset: length, byteLength: bytes.length }
    chunks.push(bytes)
    length += bytes.length
    const padding = (4 - length % 4) % 4
    if (padding) chunks.push(Buffer.alloc(padding))
    length += padding
    return result
  })
  output.buffers[0].byteLength = length
  const json = Buffer.from(JSON.stringify(output))
  const paddedJson = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)])
  const header = Buffer.alloc(20)
  header.writeUInt32LE(0x46546C67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(28 + paddedJson.length + length, 8)
  header.writeUInt32LE(paddedJson.length, 12)
  header.writeUInt32LE(0x4E4F534A, 16)
  const binaryHeader = Buffer.alloc(8)
  binaryHeader.writeUInt32LE(length, 0)
  binaryHeader.writeUInt32LE(0x004E4942, 4)
  return Buffer.concat([header, paddedJson, binaryHeader, ...chunks])
}

async function optimizeTextures() {
  // 仅离线生成时需要 ImageMagick，不增加浏览器或 npm 依赖；原始文件始终只读。
  const magick = process.env.MAGICK_PATH || 'magick'
  await run(magick, ['-version'])
  const convert = async (args, input) => {
    const task = run(magick, args, { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 })
    if (input) task.child.stdin.end(input)
    return (await task).stdout
  }
  const manifest = { version: 1, assets: [] }
  const read = path => readFile(resolve(projectRoot, 'public', path))
  const save = async (input, output, bytes, metadata) => {
    const original = await read(input)
    const destination = resolve(projectRoot, 'public', output)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, bytes)
    manifest.assets.push({ input, output, inputBytes: original.length, outputBytes: bytes.length,
      inputSha256: hash(original), outputSha256: hash(bytes), ...metadata })
    console.log(`${input}: ${original.length} -> ${bytes.length} bytes`)
  }
  const lightmapInput = 'lightmaps/Controller_Shell_lightmap.exr'
  const original = new EXRLoader().setDataType(FloatType).parse(arrayBuffer(await read(lightmapInput)))
  assert.equal(original.width, 2048)
  assert.equal(original.height, 2048)
  const smaller = downsampleLightmap(original)
  const texture = new DataTexture(smaller.data, smaller.width, smaller.height, RGBAFormat, FloatType)
  const encoded = await new EXRExporter().parse(texture, { type: HalfFloatType })
  // 验证读回方向与线性像素，防止 EXR 导出/读取的行序改变烘焙 UV 对齐。
  const decoded = new EXRLoader().setDataType(FloatType).parse(arrayBuffer(encoded))
  assert.equal(decoded.header.compression, 'ZIP_COMPRESSION')
  assert.equal(decoded.width, smaller.width)
  assert.equal(decoded.height, smaller.height)
  for (let i = 0; i < smaller.data.length; i++) {
    assert.ok(Math.abs(decoded.data[i] - smaller.data[i]) <= Math.max(0.000001, Math.abs(smaller.data[i]) * 0.0011), `EXR 像素或行序不匹配: ${i}`)
  }
  texture.dispose()
  await save(lightmapInput, 'optimized/lightmaps/controller-shell-1024.exr', encoded,
    { width: 1024, height: 1024, encoding: 'linear HALF / ZIP, 2x2 area average' })

  for (const name of ['detail', 'rhyzome_plant']) {
    const input = `glb/${name}.glb`
    const parsed = parseGlb(await read(input))
    const replacements = new Map()
    const images = []
    for (const image of parsed.gltf.images ?? []) {
      assert.ok(['image/png', 'image/jpeg'].includes(image.mimeType))
      assert.ok(Number.isInteger(image.bufferView) && !image.uri)
      const view = parsed.gltf.bufferViews[image.bufferView]
      const source = parsed.binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)
      const format = image.mimeType === 'image/png' ? 'png' : 'jpeg'
      const stdout = await convert([`${format}:-`, '-filter', 'Triangle', '-resize', '512x512>', '-strip', '-quality', '95', `${format}:-`], source)
      replacements.set(image.bufferView, stdout)
      images.push({ name: image.name, ...imageSize(stdout, image.mimeType) })
    }
    await save(input, `optimized/glb/${name}.glb`, repackGlb(parsed, replacements), { maxTextureSize: 512, images })
  }

  const pictures = [
    { input: 'img/主页面.png', output: 'phone-home', lossless: true },
    { input: '12.png', output: 'game-home-reference', lossless: true },
    ...Array.from({ length: 6 }, (_, index) => ({ input: `img/game${index}.png`, output: `game${index}`, lossless: false })),
  ]
  for (const picture of pictures) {
    // 参考图包含固定坐标裁切，必须保持原始尺寸；封面只以等比 fit 绘入 Canvas，可限到 1024。
    const options = picture.lossless
      ? ['-define', 'webp:lossless=true', '-quality', '100']
      : ['-filter', 'Triangle', '-resize', '1024x1024>', '-quality', '90']
    const stdout = await convert([resolve(projectRoot, 'public', picture.input), ...options, '-strip', 'webp:-'])
    await save(picture.input, `optimized/img/${picture.output}.webp`, stdout, { lossless: picture.lossless })
  }
  await writeFile(resolve(projectRoot, 'public/optimized/manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await optimizeTextures()
}
