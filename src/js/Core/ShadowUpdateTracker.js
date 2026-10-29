// 阴影只依赖投影物和灯光的世界状态；相机 Orbit 与屏幕后的离屏捕获不应反复重绘同一张阴影图。
const SHADOW_TEXTURES = ['map', 'alphaMap', 'displacementMap']

function write(record, value) {
  const index = record.cursor++
  if (record.values[index] !== value) {
    record.values[index] = value
    record.changed = true
  }
}

function matrix(record, value) {
  for (const element of value.elements) write(record, element)
}

function begin(record) {
  record.cursor = 0
  record.changed = false
}

function finish(record) {
  if (record.values.length !== record.cursor) {
    record.values.length = record.cursor
    record.changed = true
  }
  return record.changed
}

export default class ShadowUpdateTracker {
  constructor({ renderer, scene, camera, debug }) {
    this.renderer = renderer
    this.scene = scene
    this.camera = camera
    this.params = { enabled: true }
    this.stats = { frames: 0, updates: 0, skipped: 0, frameUpdates: 0, casters: 0, lights: 0 }
    this.casters = new Map()
    this.lights = new Map()
    this.visibleCasters = new Set()
    this.visibleLights = new Set()
    this.invalidated = true
    this.debugInit(debug)
  }

  casterChanged(object) {
    let record = this.casters.get(object)
    if (!record) {
      record = { values: [] }
      this.casters.set(object, record)
    }
    begin(record)
    matrix(record, object.matrixWorld)
    write(record, object.layers.mask)
    const geometry = object.geometry
    write(record, geometry)
    write(record, geometry.version)
    write(record, geometry.attributes.position)
    write(record, geometry.attributes.position?.version)
    write(record, geometry.index)
    write(record, geometry.index?.version)
    write(record, geometry.drawRange.start)
    write(record, geometry.drawRange.count)
    write(record, object.instanceMatrix?.version)
    write(record, object.count)
    for (const influence of object.morphTargetInfluences ?? []) write(record, influence)
    for (const group of geometry.groups) {
      write(record, group.start)
      write(record, group.count)
      write(record, group.materialIndex)
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) {
      write(record, material)
      for (const key of ['version', 'visible', 'side', 'shadowSide', 'transparent', 'opacity', 'alphaTest', 'alphaHash', 'alphaToCoverage', 'displacementScale', 'displacementBias']) {
        write(record, material[key])
      }
      write(record, material.opacityNode)
      write(record, material.opacityNode?.value)
      write(record, material.shadowNode)
      write(record, material.castShadowNode)
      for (const key of SHADOW_TEXTURES) {
        const texture = material[key]
        write(record, texture)
        write(record, texture?.version)
        if (!texture)
          continue
        write(record, texture.channel)
        write(record, texture.flipY)
        for (const element of texture.matrix.elements) write(record, element)
      }
    }
    // 当前展品是静态 Mesh；若后来接入骨骼或自定义投影节点，保持逐帧更新以免缓存遗漏变形。
    return finish(record) || object.isSkinnedMesh === true || materials.some(material => material.shadowNode || material.castShadowNode)
  }

  lightChanged(light, record) {
    begin(record)
    matrix(record, light.matrixWorld)
    if (light.target) {
      light.target.updateWorldMatrix(true, false)
      matrix(record, light.target.matrixWorld)
    }
    const { shadow } = light
    const camera = shadow.camera
    matrix(record, camera.projectionMatrix)
    for (const key of ['near', 'far', 'left', 'right', 'top', 'bottom', 'fov', 'aspect', 'zoom']) write(record, camera[key])
    write(record, light.layers.mask)
    write(record, camera.layers.mask)
    write(record, this.camera?.layers.mask)
    write(record, shadow.mapSize.x)
    write(record, shadow.mapSize.y)
    write(record, shadow.mapType)
    write(record, this.renderer.shadowMap.enabled)
    write(record, this.renderer.shadowMap.type)
    write(record, this.renderer.shadowMap.transmitted)
    return finish(record)
  }

  beginFrame() {
    // World 已完成 Intro、浮动样品和按键更新；只在最终位姿下测量，避免透射临时隐藏污染缓存。
    this.scene.updateMatrixWorld(true)
    this.visibleCasters.clear()
    this.visibleLights.clear()
    let castersChanged = this.invalidated
    this.scene.traverseVisible((object) => {
      if (object.isMesh && object.castShadow) {
        this.visibleCasters.add(object)
        if (this.casterChanged(object))
          castersChanged = true
      }
      if (object.isLight && object.castShadow && object.shadow)
        this.visibleLights.add(object)
    })
    for (const object of this.casters.keys()) {
      if (!this.visibleCasters.has(object)) {
        this.casters.delete(object)
        castersChanged = true
      }
    }
    for (const [light, record] of this.lights) {
      if (!this.visibleLights.has(light)) {
        light.shadow.autoUpdate = record.originalAutoUpdate
        this.lights.delete(light)
      }
    }
    let updates = 0
    for (const light of this.visibleLights) {
      let record = this.lights.get(light)
      if (!record) {
        record = { values: [], originalAutoUpdate: light.shadow.autoUpdate }
        this.lights.set(light, record)
      }
      const changed = this.lightChanged(light, record)
      const needsUpdate = !this.params.enabled || castersChanged || changed || !light.shadow.map || light.shadow.needsUpdate
      light.shadow.autoUpdate = this.params.enabled ? false : record.originalAutoUpdate
      light.shadow.needsUpdate = needsUpdate
      if (needsUpdate)
        updates++
    }
    this.invalidated = false
    this.stats.frames++
    this.stats.frameUpdates = updates
    this.stats.updates += updates
    this.stats.skipped += this.visibleLights.size - updates
    this.stats.casters = this.visibleCasters.size
    this.stats.lights = this.visibleLights.size
  }

  withoutShadowUpdates(callback) {
    const states = []
    for (const light of this.visibleLights) {
      const { shadow } = light
      states.push([shadow, shadow.autoUpdate, shadow.needsUpdate])
      shadow.autoUpdate = false
      shadow.needsUpdate = false
    }
    try {
      return callback()
    }
    finally {
      for (const [shadow, autoUpdate, needsUpdate] of states) {
        shadow.autoUpdate = autoUpdate
        shadow.needsUpdate = needsUpdate
      }
    }
  }

  debugInit(debug) {
    if (!debug?.ui)
      return
    this.folder = debug.ui.addFolder({ title: 'Shadow cache', expanded: false })
    this.folder.addBinding(this.params, 'enabled', { label: 'Enabled' }).on('change', () => { this.invalidated = true })
    for (const key of ['updates', 'skipped', 'casters']) this.folder.addBinding(this.stats, key, { readonly: true })
  }

  destroy() {
    this.folder?.dispose()
    for (const [light, record] of this.lights) light.shadow.autoUpdate = record.originalAutoUpdate
    this.casters.clear()
    this.lights.clear()
    this.visibleCasters.clear()
    this.visibleLights.clear()
  }
}
