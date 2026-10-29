import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'

// 通过 Chrome DevTools Protocol 验证真实 WebGPU，不引入浏览器测试依赖。
// 用法：node scripts/verify-exhibition.mjs <Chrome 路径> <已存在的临时目录>
const [chromePath, tempRoot] = process.argv.slice(2)
if (!chromePath || !tempRoot)
  throw new Error('需要 Chrome 可执行文件路径与已存在的临时输出目录')
const output = await mkdtemp(join(tempRoot, 'exhibition-'))
const server = await createServer({ server: { host: '127.0.0.1', port: 5183, strictPort: true } })
await server.listen()
const chrome = spawn(chromePath, [
  '--headless=new',
  '--enable-unsafe-webgpu',
  '--ignore-gpu-blocklist',
  '--no-first-run',
  '--no-default-browser-check',
  '--remote-debugging-port=0',
  `--user-data-dir=${join(output, 'profile')}`,
  'about:blank',
], { stdio: 'ignore', windowsHide: true })
let socket
const pending = new Map()
const errors = []
let requestId = 0
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++requestId
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 90000)
    pending.set(id, { resolve, reject, timeout })
    socket.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails)
    throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}
async function screenshot(name) {
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile(join(output, `${name}.png`), Buffer.from(data, 'base64'))
}

try {
  let target
  for (let i = 0; i < 60; i++) {
    try {
      // 只连接本次独立 profile 的端口，避免重复运行时连到上一次或用户的浏览器。
      const port = (await readFile(join(output, 'profile', 'DevToolsActivePort'), 'utf8')).split('\n')[0].trim()
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      target = targets.find(item => item.type === 'page')
      if (target)
        break
    }
    catch {}
    await delay(500)
  }
  assert.ok(target, 'Chrome CDP 未启动')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    if (message.id) {
      const item = pending.get(message.id)
      if (!item)
        return
      clearTimeout(item.timeout)
      pending.delete(message.id)
      if (message.error)
        item.reject(new Error(JSON.stringify(message.error)))
      else item.resolve(message.result)
    }
    else if (message.method === 'Runtime.exceptionThrown') {
      errors.push(message.params.exceptionDetails)
    }
    else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      errors.push(message.params.args)
    }
    else if (message.method === 'Network.loadingFailed' && !message.params.canceled) {
      console.log('Network failure:', message.params)
    }
  })
  socket.addEventListener('close', () => {
    for (const item of pending.values()) {
      clearTimeout(item.timeout)
      item.reject(new Error('Chrome CDP 已关闭'))
    }
    pending.clear()
  })
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Network.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: 'http://127.0.0.1:5183/' })
  await delay(1000)
  let ready = false
  for (let i = 0; i < 120; i++) {
    ready = await evaluate(`(async () => {
      if (document.readyState !== 'complete' || location.origin !== 'http://127.0.0.1:5183') return false
      // Vite 初次依赖预构建可能重载页面；先等主入口初始化完成，再导入已加载的同一模块。
      if (!document.querySelector('.status-panel')?.hidden) return false
      const E = (await import('/js/Experience.js')).default
      if (!E.instance?.initialized) return false
      window.experience = E.instance
      return true
    })()`)
    if (ready || errors.length)
      break
    await delay(500)
  }
  if (!ready) {
    console.log('Startup diagnostics:', await evaluate(`({
      url: location.href, readyState: document.readyState,
      status: document.querySelector('.status-panel')?.textContent,
      gpu: !!navigator.gpu,
      requests: performance.getEntriesByType('resource').map(item => ({ url: item.name, status: item.responseStatus })),
    })`))
  }
  assert.ok(ready, `场景初始化失败：${JSON.stringify(errors)}`)
  await delay(1500)
  const report = await evaluate(`(async () => {
    const e = window.experience
    const w = e.world
    const THREE = { Box3: w.exhibition.metrics.bounds.constructor }
    const product = w.product
    const rig = product.productRig
    const assembly = rig.controllerAssembly
    w.intro.skip()
    rig.setAssemblyPose()
    w.cameraDirector.transitionTo('hero', { force: true, immediate: true })
    document.querySelector('.debug-panel').style.display = 'none'
    w.environment.keyLightHelper.visible = false
    const snapshot = () => [rig.params.productAngle, ...rig.hingePivot.quaternion.toArray(), ...product.nodes.controllerAssembly.matrix.elements]
    const before = snapshot()
    const metrics = product.getExhibitionMetrics()
    const restored = JSON.stringify(before) === JSON.stringify(snapshot())
    e.scene.updateMatrixWorld(true)
    const plinthBounds = new THREE.Box3().setFromObject(w.exhibition.plinth.group, true)
    const sides = [w.exhibition.parts, w.exhibition.dock].map(group => new THREE.Box3().setFromObject(group, true))
    const displaySnapshot = () => {
      w.exhibition.group.updateMatrixWorld(true)
      const matrices = []
      for (const group of [w.exhibition.parts, w.exhibition.dock]) group.traverseVisible(mesh => {
        if (mesh.isMesh) matrices.push(mesh.matrixWorld.toArray())
      })
      return JSON.stringify(matrices)
    }
    const initialDisplay = displaySnapshot()
    rig.setAssemblyPose()
    const props = [w.exhibition.props.plaque, w.exhibition.props.card].map(group => new THREE.Box3().setFromObject(group, true))
    let propIntersections = 0
    let foldMinimum = Infinity
    for (let angle = 8; angle <= 110; angle += 2) {
      rig.setProductAngle(angle)
      product.presentationRoot.updateMatrixWorld(true)
      for (const node of [product.nodes.bottomHalf, product.nodes.topHalf]) {
        const bounds = new THREE.Box3().setFromObject(node, true)
        foldMinimum = Math.min(foldMinimum, bounds.min.y)
        if (props.some(prop => prop.intersectsBox(bounds))) propIntersections++
      }
    }
    rig.setProductAngle(110)
    assembly.play()
    const timeline = assembly.timeline
    timeline.pause()
    const duration = timeline.duration()
    let minimumY = Infinity
    let sideIntersections = 0
    let plinthIntersections = 0
    const sweep = new THREE.Box3()
    for (let step = 0; step <= 240; step++) {
      timeline.seek(duration * step / 240, false)
      product.presentationRoot.updateMatrixWorld(true)
      const bounds = new THREE.Box3().setFromObject(product.nodes.controllerAssembly, true)
      minimumY = Math.min(minimumY, bounds.min.y)
      sweep.union(bounds)
      if (sides.some(side => side.intersectsBox(bounds))) sideIntersections++
      if (plinthBounds.intersectsBox(bounds)) plinthIntersections++
      if (props.some(prop => prop.intersectsBox(bounds))) propIntersections++
    }
    assembly.setInstalledPose()
    for (let step = 0; step <= 120; step++) {
      rig.setProductAngle(110 + 10 * step / 120)
      rig.setDisplayTilt(30 * step / 120)
      product.presentationRoot.updateMatrixWorld(true)
      for (const node of [product.nodes.bottomHalf, product.nodes.topHalf, product.nodes.controllerAssembly]) {
        const bounds = new THREE.Box3().setFromObject(node, true)
        if (props.some(prop => prop.intersectsBox(bounds))) propIntersections++
      }
    }
    const displayStaticDuringAssembly = initialDisplay === displaySnapshot()
    const matrixError = Math.max(...product.nodes.controllerAssembly.matrix.elements.map((value, i) => Math.abs(value - rig.controllerInstalledMatrix.elements[i])))
    const initialHeight = w.exhibition.params.heightRatio
    const initialProduct = product.presentationRoot.matrixWorld.toArray()
    w.exhibition.params.heightRatio = 0.1
    w.exhibition.applyLayout()
    e.scene.updateMatrixWorld(true)
    const tallerTop = new THREE.Box3().setFromObject(w.exhibition.plinth.group, true).max.y
    const productUnmoved = JSON.stringify(initialProduct) === JSON.stringify(product.presentationRoot.matrixWorld.toArray())
    w.exhibition.params.heightRatio = initialHeight
    w.exhibition.applyLayout()
    const framing = []
    const projectBounds = (bounds) => {
      const limits = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        const point = bounds.min.clone().set(x, y, z).project(e.camera.instance)
        limits.minX = Math.min(limits.minX, point.x)
        limits.maxX = Math.max(limits.maxX, point.x)
        limits.minY = Math.min(limits.minY, point.y)
        limits.maxY = Math.max(limits.maxY, point.y)
      }
      return limits
    }
    for (const shot of ['folded', 'assembly', 'hero', 'play']) {
      if (shot === 'hero' || shot === 'play') rig.setHeroPose()
      else rig.setAssemblyPose()
      if (shot === 'folded') rig.setProductAngle(8)
      product.presentationRoot.updateMatrixWorld(true)
      const bounds = new THREE.Box3().setFromObject(product.nodes.bottomHalf, true)
      bounds.union(new THREE.Box3().setFromObject(product.nodes.topHalf, true))
      if (shot !== 'folded') bounds.union(new THREE.Box3().setFromObject(product.nodes.controllerAssembly, true))
      w.cameraDirector.transitionTo(shot, { force: true, immediate: true })
      e.camera.instance.updateMatrixWorld(true)
      framing.push({ shot, ...projectBounds(bounds) })
    }
    w.cameraDirector.transitionTo('hero', { force: true, immediate: true })
    e.camera.instance.updateMatrixWorld(true)
    const heroExhibits = [plinthBounds, ...sides].map(projectBounds)
    const orbitChecks = []
    const point = metrics.center.clone()
    const spherical = w.cameraDirector.orbitSpherical.clone()
    const raycaster = new w.inputRouter.raycaster.constructor()
    for (const shot of ['hero', 'play']) {
      w.cameraDirector.transitionTo(shot, { force: true, immediate: true })
      const controls = e.camera.controls
      for (const theta of [controls.minAzimuthAngle, controls.maxAzimuthAngle]) {
        for (const phi of [controls.minPolarAngle, controls.maxPolarAngle]) {
          for (const radius of [controls.minDistance, controls.maxDistance]) {
            spherical.set(radius, phi, theta)
            e.camera.instance.position.copy(controls.target).add(point.setFromSpherical(spherical))
            e.camera.instance.lookAt(controls.target)
            e.camera.instance.updateMatrixWorld(true)
            let extent = 0
            product.presentationRoot.traverseVisible(mesh => {
              const positions = mesh.geometry?.attributes.position
              if (!positions) return
              for (let i = 0; i < positions.count; i++) {
                point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld).project(e.camera.instance)
                extent = Math.max(extent, Math.abs(point.x), Math.abs(point.y))
              }
            })
            let obscured = false
            for (const screen of [product.nodes.topScreen, product.nodes.bottomDisplay]) {
              screen.geometry.computeBoundingBox()
              const bounds = screen.geometry.boundingBox
              const axes = ['x', 'y', 'z'].sort((a, b) => (bounds.max[b] - bounds.min[b]) - (bounds.max[a] - bounds.min[a])).slice(0, 2)
              for (const u of [0.1, 0.5, 0.9]) for (const v of [0.1, 0.5, 0.9]) {
                bounds.getCenter(point)
                point[axes[0]] = bounds.min[axes[0]] + (bounds.max[axes[0]] - bounds.min[axes[0]]) * u
                point[axes[1]] = bounds.min[axes[1]] + (bounds.max[axes[1]] - bounds.min[axes[1]]) * v
                point.applyMatrix4(screen.matrixWorld)
                const distance = e.camera.instance.position.distanceTo(point)
                raycaster.set(e.camera.instance.position, point.sub(e.camera.instance.position).normalize())
                const hit = raycaster.intersectObjects([w.exhibition.parts, w.exhibition.dock, w.exhibition.plinth.group, w.exhibition.props.group], true)[0]
                if (hit && hit.distance < distance - 0.001) obscured = true
              }
            }
            orbitChecks.push({ shot, extent, obscured })
          }
        }
      }
    }
    w.cameraDirector.transitionTo('hero', { force: true, immediate: true })
    return {
      restored, matrixError, productUnmoved, tallerTop, foldMinimum, framing, heroExhibits, orbitChecks, displayStaticDuringAssembly,
      sidesIntersectPlinth: sides.some(side => side.intersectsBox(plinthBounds)),
      metrics: { width: metrics.width, depth: metrics.depth, supportY: metrics.supportY, center: metrics.center.toArray() },
      plinth: { min: plinthBounds.min.toArray(), max: plinthBounds.max.toArray() },
      assembly: { minimumY, sideIntersections, plinthIntersections, propIntersections, sweep: { min: sweep.min.toArray(), max: sweep.max.toArray() } },
    }
  })()`)
  console.log(JSON.stringify(report, null, 2))
  assert.equal(report.restored, true, '布局测量改变了产品姿态')
  assert.equal(report.productUnmoved, true, '底座厚度改变了产品世界矩阵')
  assert.equal(report.displayStaticDuringAssembly, true, '主机装配带动了展示件')
  assert.ok(Math.abs(report.tallerTop - report.metrics.supportY) < 1e-5, '底座顶面高度漂移')
  assert.ok(report.matrixError < 1e-12, '装配终点矩阵偏离 GLB')
  assert.equal(report.assembly.sideIntersections, 0, '装配扫掠碰到左右展组')
  if (report.sidesIntersectPlinth)
    console.log('Existing side display AABBs overlap plinth; inspect actual meshes visually.')
  assert.equal(report.assembly.plinthIntersections, 0, '装配扫掠碰到底座')
  assert.equal(report.assembly.propIntersections, 0, '装配扫掠碰到 S3 道具')
  assert.ok(report.foldMinimum >= report.metrics.supportY, '折叠时手机穿底座')
  for (const frame of report.framing) {
    assert.ok(frame.minX >= -1 && frame.maxX <= 1 && frame.minY >= -1 && frame.maxY <= 1, `产品保守包围盒超出机位：${frame.shot}`)
  }
  for (const check of report.orbitChecks) {
    // 用户已扩大 Orbit 到 ±25° / ±15° / ±35%；记录当前近距离裁切，不擅自收回取景参数。
    if (check.extent > 1)
      console.log('Current Orbit crop:', JSON.stringify(check))
    assert.equal(check.obscured, false, `展品遮挡屏幕：${check.shot}`)
  }
  const s2 = await evaluate(`(() => {
    const w = experience.world
    const exhibit = w.exhibition
    const dock = exhibit.colorDock
    const parts = exhibit.partsDisplay
    const main = w.product.controllerShellMaterial
    const samples = [parts.shell, parts.dpad, parts.buttons, ...dock.samples]
    const meshes = samples.flatMap(sample => sample.meshes)
    const plastics = [parts.shell.plastics[0], ...dock.samples.map(sample => sample.plastics[0])]
    const originalMainColor = main.uniforms.color.value.getHexString()
    const originalMainRoughness = main.uniforms.roughness.value
    const originalColors = plastics.map(plastic => plastic.uniforms.color.value.getHexString())
    const originalBlue = dock.themes[0].shell
    dock.themes[0].shell = '#b947ac'
    dock.applyColors()
    const changedColors = plastics.map(plastic => plastic.uniforms.color.value.getHexString())
    dock.samples[0].setFinish({ roughness: 0.68, bumpStrength: 0.07 })
    const independent = main.uniforms.color.value.getHexString() === originalMainColor
      && main.uniforms.roughness.value === originalMainRoughness
      && changedColors[1] !== originalColors[1]
      && [0, 2, 3].every(i => changedColors[i] === originalColors[i])
      && plastics[0].uniforms.roughness.value === 0.45
      && plastics[2].uniforms.roughness.value === 0.45
      && plastics[3].uniforms.roughness.value === 0.45
    dock.themes[0].shell = originalBlue
    dock.applyColors()
    dock.samples[0].setFinish(dock.params)
    const capture = () => {
      exhibit.group.updateMatrixWorld(true)
      // Dock 根节点按设计悬浮；主机输入不得改变样件内部安装矩阵。
      return JSON.stringify(meshes.map(mesh => mesh.matrix.toArray()))
    }
    const originalDisplay = capture()
    const buttonBefore = w.product.buttons.a.position.clone()
    w.controllerFeedback.setActions(['a', 'up'])
    for (let i = 0; i < 8; i++) w.controllerFeedback.update(1 / 60)
    const mainButtonMoved = buttonBefore.distanceTo(w.product.buttons.a.position) > 1e-6
    const displayStaticOnInput = capture() === originalDisplay
    w.controllerFeedback.setActions([])
    for (let i = 0; i < 120; i++) w.controllerFeedback.update(1 / 60)
    const geometrySet = new Set([w.product.nodes.controllerShell.geometry, ...Object.values(w.product.buttons).map(mesh => mesh.geometry)])
    window.exhibitVerification = {
      capture, snapshot: originalDisplay,
      labelVersions: [parts.label, dock.label, exhibit.props.plaqueLabel, exhibit.props.cardLabel].map(label => label.texture.version),
    }
    return {
      independent, mainButtonMoved, displayStaticOnInput,
      sourceGeometryShared: meshes.every(mesh => geometrySet.has(mesh.geometry)),
      uniqueUniforms: new Set([main.uniforms.color, ...plastics.map(plastic => plastic.uniforms.color)]).size,
      noExhibitLightmaps: plastics.every(plastic => plastic.material.lightMap === null),
      mainLightmapPreserved: main.material.lightMap === experience.resources.items.controllerShellLightmap
        && main.material.lightMap.channel === 1 && main.material.lightMap.flipY,
      inputSurfaces: w.inputRouter.interactionSurfaces?.length,
      sampleMeshCount: meshes.length,
      labelSizes: [parts.label.canvas, dock.label.canvas].map(canvas => [canvas.width, canvas.height]),
      layout: { parts: [exhibit.params.partsX, exhibit.params.partsZ, exhibit.params.partsYaw, exhibit.params.partsScale],
        dock: [exhibit.params.dockX, exhibit.params.dockZ, exhibit.params.dockYaw, exhibit.params.dockScale] },
    }
  })()`)
  console.log('S2 isolation:', JSON.stringify(s2, null, 2))
  assert.equal(s2.independent, true, '样件颜色/粗糙度污染了其他样件或主机')
  assert.equal(s2.mainButtonMoved, true, '未真正触发主机按压')
  assert.equal(s2.displayStaticOnInput, true, '展示件响应了主机按键')
  assert.equal(s2.sourceGeometryShared, true)
  assert.equal(s2.uniqueUniforms, 5)
  assert.equal(s2.sampleMeshCount, 24)
  assert.equal(s2.inputSurfaces, 2)
  assert.equal(s2.noExhibitLightmaps, true)
  assert.equal(s2.mainLightmapPreserved, true)
  assert.deepEqual(s2.layout.parts, [-1.26, -1.15, 45, 1.6], '改变了用户确认的左展组布局')
  assert.deepEqual(s2.layout.dock, [1.76, -1.95, -31, 2.86], '改变了用户确认的右展组布局')
  const s3 = await evaluate(`(() => {
    const w = experience.world
    const exhibit = w.exhibition
    const props = exhibit.props
    const Box3 = exhibit.metrics.bounds.constructor
    const plaque = new Box3().setFromObject(props.plaque, true)
    const card = new Box3().setFromObject(props.card, true)
    const plinth = new Box3().setFromObject(exhibit.plinth.group, true)
    const camera = w.environment.keyLight.shadow.camera
    const shadowBounds = w.environment.shadowBounds
    let shadowExtent = 0
    for (const x of [shadowBounds.min.x, shadowBounds.max.x]) for (const y of [shadowBounds.min.y, shadowBounds.max.y]) for (const z of [shadowBounds.min.z, shadowBounds.max.z]) {
      const p = shadowBounds.min.clone().set(x, y, z).project(camera)
      shadowExtent = Math.max(shadowExtent, Math.abs(p.x), Math.abs(p.y), Math.abs(p.z))
    }
    return {
      plaqueGroundError: Math.abs(plaque.min.y - w.stage.surfaceY),
      cardGroundError: Math.abs(card.min.y - w.stage.surfaceY),
      plaqueOutsidePlinth: !plaque.intersectsBox(plinth),
      cardOutsidePlinth: !card.intersectsBox(plinth), shadowExtent,
      shadowFrustum: [camera.left, camera.right, camera.bottom, camera.top, camera.near, camera.far],
      textures: [props.plaqueLabel, props.cardLabel].map(label => [label.canvas.width, label.canvas.height]),
    }
  })()`)
  console.log('S3 props and shadows:', JSON.stringify(s3, null, 2))
  assert.ok(s3.plaqueGroundError < 1e-5 && s3.cardGroundError < 1e-5, 'S3 道具未接地')
  assert.equal(s3.plaqueOutsidePlinth, true)
  assert.equal(s3.cardOutsidePlinth, true)
  assert.ok(s3.shadowExtent <= 1.00001, '展区超出阴影投影范围')
  await screenshot('hero')
  for (const shot of ['folded', 'assembly', 'play']) {
    await evaluate(`(() => {
      const w = experience.world
      w.product.productRig.${shot === 'play' ? 'setHeroPose' : 'setAssemblyPose'}()
      ${shot === 'folded' ? 'w.product.productRig.setProductAngle(8)' : ''}
      w.product.productRig.controllerAssembly.setVisible(${shot !== 'folded'})
      w.cameraDirector.transitionTo('${shot}', { force: true, immediate: true })
    })()`)
    await screenshot(shot)
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
  await delay(300)
  const narrow = await evaluate(`(() => {
    const w = experience.world
    w.product.productRig.setHeroPose()
    w.cameraDirector.transitionTo('hero', { force: true, immediate: true })
    return { parts: w.exhibition.parts.visible, dock: w.exhibition.dock.visible, card: w.exhibition.props.card.visible, plaque: w.exhibition.props.plaque.visible, fov: experience.camera.instance.fov }
  })()`)
  assert.equal(narrow.parts, false)
  assert.equal(narrow.dock, false)
  assert.equal(narrow.card, false)
  assert.equal(narrow.plaque, true)
  await screenshot('narrow-hero')
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })
  await delay(300)
  assert.equal(await evaluate('experience.world.exhibition.parts.visible'), true)
  assert.ok(await evaluate('Math.abs(experience.camera.instance.fov - experience.world.cameraDirector.shots.hero.fov) < 1e-8'), 'resize 累积了 FOV')
  await evaluate('experience.world.intro.play()')
  let introFinished = false
  for (let i = 0; i < 30; i++) {
    await delay(500)
    introFinished = await evaluate('experience.state.introState === \'ready\' && !experience.world.cameraDirector.timeline')
    if (introFinished)
      break
  }
  assert.equal(introFinished, true, '完整 Replay 未回到 Ready')
  assert.equal(await evaluate('experience.world.exhibition.params.enabled'), true)
  await evaluate('experience.world.intro.play(); experience.world.intro.skip()')
  await delay(1600)
  const afterReplay = await evaluate(`(() => {
    const verification = window.exhibitVerification
    const e = experience.world.exhibition
    return {
      static: verification.capture() === verification.snapshot,
      labelsUnchanged: JSON.stringify(verification.labelVersions) === JSON.stringify([e.partsDisplay.label, e.colorDock.label, e.props.plaqueLabel, e.props.cardLabel].map(label => label.texture.version)),
    }
  })()`)
  assert.equal(afterReplay.static, true, 'Replay 改变了展示件矩阵')
  assert.equal(afterReplay.labelsUnchanged, true, '静态标签在逐帧重复上传')
  const cleanup = await evaluate(`(() => {
    const w = experience.world
    const exhibit = w.exhibition
    const sharedGeometry = new Set([w.product.nodes.controllerShell.geometry, ...Object.values(w.product.buttons).map(mesh => mesh.geometry)])
    const sharedDisposals = new Map([...sharedGeometry].map(geometry => [geometry, 0]))
    for (const geometry of sharedGeometry) geometry.addEventListener('dispose', () => sharedDisposals.set(geometry, sharedDisposals.get(geometry) + 1))
    const resources = new Set([w.stage.mesh.geometry, w.stage.material, ...Object.values(w.stage.textures)])
    exhibit.group.traverse(child => {
      if (child.geometry && !sharedGeometry.has(child.geometry)) resources.add(child.geometry)
      const materials = child.material ? (Array.isArray(child.material) ? child.material : [child.material]) : []
      for (const material of materials) {
        resources.add(material)
        for (const value of Object.values(material)) if (value?.isTexture) resources.add(value)
      }
    })
    const disposed = new Set()
    for (const resource of resources) resource.addEventListener('dispose', () => disposed.add(resource))
    exhibit.destroy()
    const sharedAlive = [...sharedDisposals.values()].every(count => count === 0)
    w.exhibition = null
    experience.destroy()
    return { expected: resources.size, disposed: disposed.size, detached: exhibit.group.parent === null,
      sharedAlive, sharedReleasedOnce: [...sharedDisposals.values()].every(count => count === 1) }
  })()`)
  assert.equal(cleanup.disposed, cleanup.expected)
  assert.equal(cleanup.detached, true)
  assert.equal(cleanup.sharedAlive, true, '展示组件提前释放了主机几何')
  assert.equal(cleanup.sharedReleasedOnce, true, '共享几何未由主机恰好回收一次')
  assert.equal(errors.length, 0, `浏览器错误：${JSON.stringify(errors)}`)
  console.log(`WebGPU、241 帧装配与 121 帧立起避让、四机位、Orbit 屏幕九点遮挡、S2 隔离、S3 接地/阴影、静态标签、窄屏及资源释放检查通过（Orbit 裁切和既有展组 AABB 交叠单独报告）。截图：${output}`)
}
finally {
  if (socket?.readyState === WebSocket.OPEN) {
    try { await send('Browser.close') }
    catch {}
  }
  for (const item of pending.values()) clearTimeout(item.timeout)
  socket?.close()
  chrome.kill()
  await server.close()
}
