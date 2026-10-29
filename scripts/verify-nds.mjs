import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import factory from '../public/vendor/pilas-melonds/pilas-melonds-core.js'
import NDSRuntime from '../src/js/NDS/NDSRuntime.js'

const romPath = process.argv[2]
if (!romPath)
  throw new Error('用法：node scripts/verify-nds.mjs "public/nds/game.nds"')
let lastFrame
let presented = 0
const runtime = new NDSRuntime({
  onFrame: (pixels) => { lastFrame = pixels.slice(); presented++ },
  onStatus: text => console.log(text),
})
try {
  await runtime.init({
    factory,
    wasm: pathToFileURL(resolve('public/vendor/pilas-melonds/pilas-melonds-core.wasm')).href,
  })
  const bytes = new Uint8Array(await readFile(romPath))
  runtime.loadBytes(bytes, 'local-validation.nds')
  assert.equal(runtime.loaded, true)
  runtime.resume()
  runtime.setButtons(['a', 'start'])
  assert.equal(runtime.inputMask, 0xFFF & ~1 & ~(1 << 3))
  runtime.releaseInputs()
  assert.equal(runtime.inputMask, 0xFFF)

  const start = performance.now()
  for (let frame = 0; frame < 360; frame++) {
    runtime.runFrame()
    if (frame % 60 === 59)
      runtime.present()
  }
  const elapsed = performance.now() - start
  assert.equal(lastFrame.length, 256 * 192 * 4 * 2)
  const firstFrame = lastFrame
  const topColors = new Set()
  const bottomColors = new Set()
  const words = new Uint32Array(firstFrame.buffer)
  words.forEach((pixel, index) => (index < 256 * 192 ? topColors : bottomColors).add(pixel))
  assert.ok(topColors.size > 1 || bottomColors.size > 1, '启动后双屏仍为纯色，需调查核心/ROM')
  runtime.touch(128, 96, true)
  runtime.pause()
  assert.equal(runtime.inputMask, 0xFFF)
  const count = runtime.frameCount
  runtime.update(1000)
  assert.equal(runtime.frameCount, count, '暂停后不应推进模拟')
  runtime.resume()
  runtime.update(10000)
  assert.equal(runtime.frameCount, count + 2, '追帧应受预算限制')
  console.log(JSON.stringify({
    frames: count,
    presented,
    elapsedMs: Math.round(elapsed),
    coreAverageMs: +(elapsed / count).toFixed(2),
    heapMiB: runtime.module.HEAPU8.byteLength / 1048576,
    topColors: topColors.size,
    bottomColors: bottomColors.size,
    alphaValues: [...new Set(firstFrame.filter((_, index) => index % 4 === 3))],
    maxChannel: firstFrame.reduce((max, value, index) => index % 4 === 3 ? max : Math.max(max, value), 0),
    note: 'Node 核心验证，不代表目标浏览器帧率、音频或实际游玩验收',
  }, null, 2))
}
finally {
  runtime.destroy()
  runtime.destroy()
  assert.equal(runtime.instance, 0)
  assert.equal(runtime.module, null)
}
