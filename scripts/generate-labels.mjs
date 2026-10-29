import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withChromePage } from './lib/chrome-page.mjs'

// node scripts/generate-labels.mjs <Chrome> <已有临时目录> [--check]
// 用浏览器原生 Canvas 保留字体栅格化，不安装新依赖；产品预设不绘图，仅自定义 Dock 保留按需绘图。
const [chromePath, tempRoot, flag] = process.argv.slice(2)
assert.ok(flag === undefined || flag === '--check', '仅支持 --check')
const root = fileURLToPath(new URL('../', import.meta.url))
const sourcePaths = ['scripts/labels/artwork.js', 'src/js/World/Environment/exhibitLabelLayout.js', 'src/js/World/Environment/themeLabelArtwork.js']
const contents = await Promise.all(sourcePaths.map(path => readFile(join(root, path))))
const routes = new Map(sourcePaths.map((path, index) => [`/${path}`, contents[index]]))
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname
  if (path === '/') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end('<!doctype html><title>Offline exhibit labels</title>')
  }
  else if (routes.has(path)) {
    response.setHeader('Content-Type', 'text/javascript; charset=utf-8')
    response.end(routes.get(path))
  }
  else { response.statusCode = path === '/favicon.ico' ? 204 : 404; response.end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
try {
  await withChromePage({ chromePath, tempRoot }, async ({ evaluate, send, errors }) => {
    await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` })
    const images = await evaluate(`import('/scripts/labels/artwork.js').then(m => m.generateLabelImages())`)
    assert.deepEqual(errors, [])
    const hash = value => createHash('sha256').update(value).digest('hex')
    const assets = images.map(({ png, ...image }) => {
      const buffer = Buffer.from(png, 'base64')
      return { ...image, file: `${image.key}.png`, bytes: buffer.length, sha256: hash(buffer), buffer }
    })
    const fonts = {}
    // 记录生成机字体指纹，不复制/分发系统字体文件；其它机器的成品外观由 PNG 固定。
    const fontFiles = ['segoeui.ttf', 'segoeuib.ttf', 'seguisb.ttf', 'arial.ttf', 'arialbd.ttf']
    for (const file of fontFiles) {
      try { fonts[file] = hash(await readFile(join(process.env.WINDIR || 'C:/Windows', 'Fonts', file))) }
      catch {}
    }
    assert.equal(Object.keys(fonts).length, fontFiles.length, '生成参考使用 Windows Segoe UI / Arial；缺少字体时不能悄悄用替代字体覆盖成品')
    const manifest = { version: 1, sourceHash: hash(Buffer.concat(contents)), fonts, assets: assets.map(({ buffer, ...asset }) => asset) }
    const destination = join(root, 'public/labels')
    if (flag === '--check') {
      const saved = JSON.parse(await readFile(join(destination, 'manifest.json'), 'utf8'))
      assert.equal(saved.sourceHash, manifest.sourceHash, '标签绘图/尺寸已变化，请重新生成 PNG')
      assert.deepEqual(saved.assets, manifest.assets, '标签 manifest 与重新生成的图片不一致')
      for (const asset of assets) assert.equal(hash(await readFile(join(destination, asset.file))), asset.sha256, `离线图片过期：${asset.file}（核对字体/Chrome 后重新生成）`)
    }
    else {
      await mkdir(destination, { recursive: true })
      for (const asset of assets) await writeFile(join(destination, asset.file), asset.buffer)
      await writeFile(join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    }
    console.log(JSON.stringify({ check: flag === '--check', assets: manifest.assets, totalBytes: assets.reduce((sum, asset) => sum + asset.bytes, 0) }, null, 2))
  })
}
finally { await new Promise(resolve => server.close(resolve)) }
