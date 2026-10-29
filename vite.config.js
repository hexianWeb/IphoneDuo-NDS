import { cp, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: 'src',
  // 源码根目录为 src，但部署与本地 ROM 地址配置统一从仓库根目录的 .env 文件读取。
  envDir: projectRoot,
  publicDir: '../public',
  plugins: [{
    name: 'public-assets-without-local-roms',
    apply: 'build',
    async writeBundle() {
      const publicRoot = resolve(projectRoot, 'public')
      const { assets } = JSON.parse(await readFile(resolve(publicRoot, 'optimized/manifest.json'), 'utf8'))
      const replacedSources = new Set(assets.map(asset => resolve(publicRoot, asset.input)))
      // 原始大图留在仓库供重生成，生产只复制派生副本；本地 ROM 继续排除。
      await cp(publicRoot, resolve(projectRoot, 'dist'), {
        recursive: true,
        filter: source => source !== resolve(publicRoot, 'nds') && !replacedSources.has(source),
      })
    },
  }],
  server: {
    host: true,
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    copyPublicDir: false,
    rolldownOptions: {
      input: {
        main: resolve(projectRoot, 'src/index.html'),
        ndsTest: resolve(projectRoot, 'src/nds-test.html'),
      },
    },
  },
})
