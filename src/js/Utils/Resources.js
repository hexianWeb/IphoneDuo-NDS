import { EXRLoader } from 'three/addons/loaders/EXRLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import * as THREE from 'three/webgpu'
import Experience from '../Experience.js'

export default class Resources {
  constructor(sources) {
    this.experience = new Experience()
    this.events = this.experience.events
    this.sources = sources
    this.items = {}
    this.loaders = {
      exrTexture: new EXRLoader(),
      gltfModel: new GLTFLoader(),
      texture: new THREE.TextureLoader(),
    }
  }

  async load() {
    const total = this.sources.length
    let loaded = 0
    const fractions = new Map(this.sources.map(source => [source.name, 0]))
    const report = name => this.events.emit('resources:progress', {
      loaded,
      total,
      name,
      progress: [...fractions.values()].reduce((sum, value) => sum + value, 0) / Math.max(1, total),
    })

    this.events.emit('resources:progress', {
      loaded,
      total,
      name: this.sources[0]?.name ?? 'resources',
    })

    await Promise.all(this.sources.map(async (source) => {
      const loader = this.loaders[source.type]

      if (!loader) {
        throw new Error(`资源 ${source.name} 使用了未知类型：${source.type}`)
      }

      try {
        this.items[source.name] = await loader.loadAsync(source.path, (event) => {
          // 有 Content-Length 才显示传输进度；预留解码阶段，不把下载完成当成资源可用。
          if (!event.total)
            return
          fractions.set(source.name, Math.max(fractions.get(source.name), Math.min(0.95, event.loaded / event.total * 0.95)))
          report(source.name)
        })
        loaded += 1
        fractions.set(source.name, 1)
        report(source.name)
      }
      catch (error) {
        throw new Error(`资源 ${source.name} 加载失败：${error instanceof Error ? error.message : source.path}`)
      }
    }))

    this.events.emit('resources:ready', this.items)
    return this.items
  }
}
