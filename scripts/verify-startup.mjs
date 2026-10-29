import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createServer, preview } from 'vite'

// 独立服务/浏览器验收正式代码；只暴露实例和观测首帧，不改 shader 或管线准备逻辑。
// node scripts/verify-startup.mjs <Chrome> <已有临时目录> [normal|materials|labels|layout|intro-copy|resize|destroy|production]
const [chromePath, tempRoot, mode = 'normal'] = process.argv.slice(2)
assert.ok(chromePath && tempRoot, '需要 Chrome 路径及已有临时目录')
assert.ok(['normal', 'materials', 'labels', 'layout', 'intro-copy', 'resize', 'destroy', 'production'].includes(mode))
const output = await mkdtemp(join(tempRoot, `duo-startup-${mode}-`))
const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const production = mode === 'production'
const configFile = join(projectRoot, 'vite.config.js')
const snapshotRoot = process.env.DUO_BUTTON_SNAPSHOT
const labelSnapshotRoot = process.env.DUO_LABEL_SNAPSHOT
assert.ok(!production || (!snapshotRoot && !labelSnapshotRoot), '生产检查不允许响应替换')
const snapshots = snapshotRoot
  ? await Promise.all(['ButtonPrint.js', 'ControllerButtonMaterial.js']
      .map(async name => [`/src/js/World/Product/${name}`, await readFile(join(snapshotRoot, name), 'utf8')]))
  : []
if (labelSnapshotRoot) {
  const paths = ['src/js/sources.js', ...['ExhibitLabel', 'Exhibition', 'PartsDisplay', 'ColorDock', 'ExhibitProps', 'InternalComponentsDisplay', 'GameLibraryDisplay'].map(name => `src/js/World/Environment/${name}.js`)]
  snapshots.push(...await Promise.all(paths.map(async path => [`/${path}`, await readFile(join(labelSnapshotRoot, path), 'utf8')])))
}
const server = production
  ? await preview({ configFile, preview: { host: '127.0.0.1', port: 0, strictPort: true, open: false } })
  : await createServer({ configFile, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 0, strictPort: true, open: false, hmr: false }, plugins: [{
      name: 'startup-verification-observers',
      transform(code, id) {
        const path = id.split('?')[0].replaceAll('\\', '/')
        const snapshot = snapshots.find(([suffix]) => path.endsWith(suffix))
        if (path.endsWith('/src/js/World/Environment/ExhibitLabel.js')) {
          return `${snapshot?.[1] ?? code}
window.__DUO_STARTUP__.THREE = THREE
const observedRedraw = ExhibitLabel.prototype.redraw
if (observedRedraw) ExhibitLabel.prototype.redraw = function (...args) {
  const start = performance.now()
  const result = observedRedraw.apply(this, args)
  window.__DUO_STARTUP__.labelRedraws.push({ name:this.mesh.name, ms:performance.now()-start })
  return result
}
`
        }
        if (snapshot)
          return snapshot[1]
        if (path.endsWith('/src/js/Experience.js'))
          return `${code}\nwindow.__DUO_STARTUP__.Experience = Experience\n`
        if (path.endsWith('/src/js/World/World.js')) {
          assert.ok(code.includes('start() {'), '未找到首帧观测入口')
          return code.replace('start() {', 'start() { window.__DUO_STARTUP__.onStart(this)')
        }
      },
    }] })
if (!production) {
  await server.listen()
  // 在导航前启动模块图，避免把开发依赖扫描的首次动态导入竞争误计为渲染耗时。
  await server.transformRequest('/main.js')
  await server.transformRequest('/js/Core/PerformanceMonitor.js')
}
const port = server.httpServer.address().port
const site = `http://127.0.0.1:${port}`
function installObservers() {
  const probe = { pipelines: [], gpuErrors: [], firstFrames: [], phasesAtDestroy: [], labelRedraws: [] }
  probe.onStart = (world) => {
    const rig = world.product.productRig
    const screens = world.screenManager
    probe.firstFrames.push({ angle: rig.params.productAngle, tilt: rig.params.displayTilt, controllerVisible: rig.controllerAssembly.controller.visible, mode: screens.mode, screens: Object.fromEntries(Object.entries(screens.screens).map(([key, mesh]) => [key, mesh.visible])) })
    probe.initialLabelRedraws = probe.labelRedraws.map(record => ({ ...record }))
  }
  for (const method of ['createRenderPipeline', 'createRenderPipelineAsync']) {
    const original = GPUDevice.prototype[method]
    GPUDevice.prototype[method] = function (descriptor) {
      const e = probe.Experience?.instance
      const record = { method, label: descriptor.label, phase: e?.performanceMonitor?.phase, preparing: e?.renderer?.preparing === true }
      probe.pipelines.push(record)
      const result = original.call(this, descriptor)
      if (method.endsWith('Async')) {
        record.pending = true
        result.then(() => { record.pending = false }, () => { record.pending = false })
      }
      return result
    }
  }
  const original = GPUAdapter.prototype.requestDevice
  GPUAdapter.prototype.requestDevice = async function (...args) {
    const device = await original.apply(this, args)
    device.addEventListener('uncapturederror', event => probe.gpuErrors.push(event.error.message))
    return device
  }
  new MutationObserver(() => {
    const state = document.querySelector('.status-panel')?.dataset.state
    if (state === 'complete' && probe.completedAt === undefined)
      probe.completedAt = performance.now()
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-state'] })
  window.__DUO_STARTUP__ = probe
}
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
let nextId = 0
const pending = new Map()
const errors = []
const warnings = []
const networkFailures = []
const requests = new Map()
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 120000)
    pending.set(id, { resolve, reject, timer })
    socket.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (response.exceptionDetails)
    throw new Error(JSON.stringify(response.exceptionDetails))
  return response.result.value
}
async function waitFor(expression, label) {
  const until = Date.now() + 120000
  do {
    if (await evaluate(expression))
      return
    if (errors.length)
      throw new Error(JSON.stringify(errors))
    const detail = await evaluate(`document.querySelector('.status-panel')?.dataset.state === 'error' && document.querySelector('.status-detail')?.textContent`)
    if (detail)
      throw new Error(detail)
    await delay(100)
  } while (Date.now() < until)
  throw new Error(`等待超时：${label}`)
}
async function screenshot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile(join(output, `${name}.png`), Buffer.from(data, 'base64'))
}
async function verifyIntroCopy() {
  const desktop = await evaluate(`(() => {
    const element = document.querySelector('.product-intro-copy'), style = getComputedStyle(element)
    return { width:innerWidth, height:innerHeight, hidden:element.hidden, display:style.display,
      opacity:style.opacity, intro:experience.state.introState, mode:experience.state.productMode }
  })()`)
  console.log('INTRO_COPY', JSON.stringify(desktop))
  assert.equal(desktop.hidden, false, 'Ready / Game Home 产品文案不应被状态隐藏')
  assert.notEqual(desktop.display, 'none', `常规桌面左上角产品文案不应消失：${JSON.stringify(desktop)}`)
  const motion = await evaluate(`(() => {
    const w = experience.world, element = w.introCopy.element, events = experience.events
    const hidden = () => element.hidden && getComputedStyle(element).display === 'none'
    const sampleEntry = (source) => {
      const animation = element.getAnimations()[0]
      if (!animation) return { source, missing:true }
      const duration = animation.effect.getTiming().duration
      animation.pause()
      const sample = time => {
        animation.currentTime = time
        const style = getComputedStyle(element)
        return { opacity:Number(style.opacity), offset:new DOMMatrixReadOnly(style.transform).m42 }
      }
      const result = { source, duration, easing:getComputedStyle(element).animationTimingFunction,
        start:sample(0), middle:sample(duration / 2), end:sample(duration) }
      events.emit('nds:state', { ...w.toolbar.nds, loading:false })
      result.stable = element.getAnimations()[0] === animation && animation.currentTime === duration
      animation.finish()
      return result
    }
    w.intro.play()
    const replayHidden = hidden()
    w.intro.skip()
    const replay = sampleEntry('replay-skip')
    const nds = { ...w.toolbar.nds }
    events.emit('nds:state', { ...nds, loading:true })
    const loadingHidden = hidden()
    events.emit('nds:state', { ...nds, loading:false })
    const cancelled = sampleEntry('launch-cancelled')
    w.setProductMode('playing')
    const playingHidden = hidden()
    w.setProductMode('game-home')
    const returned = sampleEntry('return-home')
    w.ndsPlayer.render()
    return { replayHidden, loadingHidden, playingHidden, entries:[replay, cancelled, returned] }
  })()`)
  assert.ok(motion.replayHidden && motion.loadingHidden && motion.playingHidden, '重播、加载与 Playing 应隐藏文案')
  for (const entry of motion.entries) {
    assert.equal(entry.missing, undefined, `${entry.source} 必须播放渐显动画`)
    assert.equal(entry.easing, 'ease-in')
    assert.ok(entry.duration >= 400 && entry.duration <= 900)
    assert.equal(entry.start.opacity, 0)
    assert.ok(entry.start.offset > 0 && entry.start.offset <= 16)
    assert.ok(entry.middle.opacity > 0 && entry.middle.opacity < 0.5, 'ease-in 中点应仍在渐显，而非瞬间出现')
    assert.ok(entry.middle.offset > 0 && entry.middle.offset < entry.start.offset)
    assert.equal(entry.end.opacity, 1)
    assert.equal(entry.end.offset, 0)
    assert.equal(entry.stable, true, '同一可见状态的重复事件不应重启动画')
  }
  await waitFor('experience.world.cameraDirector.timeline === null', '文案恢复后的 Hero 镜头归位')
  const layouts = []
  for (const size of [
    { width:1920, height:1039, visible:true, name:'current-desktop', copyWidth:220, titleSize:'34px' },
    { width:1920, height:1200, visible:false, name:'desktop-16-10' },
    { width:1600, height:900, visible:true, name:'desktop-16-9', copyWidth:220, titleSize:'34px' },
    { width:1920, height:855, visible:true, name:'ultrawide', copyWidth:330, titleSize:'51px' },
    { width:1600, height:650, visible:true, name:'short-desktop', copyWidth:282, titleSize:'42px' },
    { width:1599, height:900, visible:false, name:'narrow-desktop' },
    { width:1600, height:649, visible:false, name:'too-short' },
    { width:1600, height:1200, visible:false, name:'tall-desktop' },
    { width:390, height:844, visible:false, name:'mobile' },
    { width:1920, height:1080, visible:true, name:'desktop-restored' },
  ]) {
    await send('Emulation.setDeviceMetricsOverride', { width:size.width, height:size.height, deviceScaleFactor:1, mobile:false })
    await waitFor(`experience.sizes.width === ${size.width} && innerHeight === ${size.height}`, size.name)
    const layout = await evaluate(`(() => {
      const element = document.querySelector('.product-intro-copy')
      element.getAnimations().forEach(animation => animation.finish())
      const style = getComputedStyle(element), rect = element.getBoundingClientRect()
      return { display:style.display, opacity:Number(style.opacity), pointerEvents:style.pointerEvents,
        copyWidth:rect.width, titleSize:getComputedStyle(element.querySelector('h1')).fontSize,
        left:rect.left, top:rect.top, right:rect.right, bottom:rect.bottom,
        headerBottom:document.querySelector('.product-header').getBoundingClientRect().bottom }
    })()`)
    layouts.push({ ...size, ...layout })
    assert.equal(layout.display !== 'none', size.visible, `${size.name} 文案显示条件不符`)
    if (size.visible) {
      assert.equal(layout.opacity, 1)
      assert.equal(layout.pointerEvents, 'none', '文案不能阻挡画布输入')
      if (size.copyWidth) {
        assert.equal(layout.copyWidth, size.copyWidth, `${size.name} 文案宽度不符`)
        assert.equal(layout.titleSize, size.titleSize, `${size.name} 字号不符`)
      }
      assert.ok(layout.left >= 0 && layout.right <= size.width)
      assert.ok(layout.top >= layout.headerBottom && layout.bottom < size.height)
    }
    if (['current-desktop', 'desktop-16-10', 'desktop-16-9', 'ultrawide', 'short-desktop', 'mobile'].includes(size.name))
      await screenshot(`intro-copy-${size.name}`)
  }
  await send('Emulation.setEmulatedMedia', { features:[{ name:'prefers-reduced-motion', value:'reduce' }] })
  const reducedMotion = await evaluate(`(() => {
    const w = experience.world, element = w.introCopy.element
    w.intro.play()
    getComputedStyle(element).display
    w.intro.skip()
    const style = getComputedStyle(element)
    return { display:style.display, opacity:style.opacity, animation:style.animationName, count:element.getAnimations().length }
  })()`)
  assert.deepEqual(reducedMotion, { display:'block', opacity:'1', animation:'none', count:0 })
  await send('Emulation.setEmulatedMedia', { features:[] })
  return { desktop, motion, layouts, reducedMotion }
}
try {
  let target
  for (let i = 0; i < 60; i++) {
    try {
      const port = (await readFile(join(output, 'profile/DevToolsActivePort'), 'utf8')).split('\n')[0].trim()
      target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(page => page.type === 'page')
      if (target)
        break
    }
    catch {}
    await delay(300)
  }
  assert.ok(target, 'Chrome CDP 未启动')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  socket.addEventListener('message', ({ data }) => {
    const event = JSON.parse(data)
    if (event.id) {
      const item = pending.get(event.id)
      if (!item)
        return
      clearTimeout(item.timer)
      pending.delete(event.id)
      if (event.error)
        item.reject(new Error(JSON.stringify(event.error)))
      else item.resolve(event.result)
    }
    else if (event.method === 'Network.requestWillBeSent') {
      requests.set(event.params.requestId, event.params.request.url)
    }
    else if (event.method === 'Network.loadingFailed') {
      networkFailures.push({ ...event.params, url: requests.get(event.params.requestId) })
    }
    else if (event.method === 'Runtime.exceptionThrown') {
      errors.push(event.params.exceptionDetails)
    }
    else if (event.method === 'Runtime.consoleAPICalled') {
      const text = event.params.args.map(arg => arg.value || arg.description).join(' ')
      if (event.params.type === 'error')
        errors.push(text)
      else if (event.params.type === 'warning')
        warnings.push(text)
    }
    else if (event.method === 'Log.entryAdded' && event.params.entry.level === 'error') {
      const entry = event.params.entry
      // 浏览器自动请求的站点图标与渲染无关；保留记录，但不把它归为应用或 GPU 错误。
      if (entry.source === 'network' && entry.url === `${site}/favicon.ico`)
        warnings.push(entry)
      else errors.push(entry)
    }
  })
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Log.enable')
  await send('Network.enable')
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(${installObservers.toString()})()` })
  await send('Emulation.setDeviceMetricsOverride', { width: mode === 'layout' ? 1166 : 1920, height: mode === 'layout' ? 1031 : 1080, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: `${site}/${production ? '' : '?performance'}` })
  if (mode === 'resize' || mode === 'destroy') {
    await waitFor(`__DUO_STARTUP__.Experience?.instance?.renderer?.preparation?.running
      && __DUO_STARTUP__.pipelines.filter(p => p.phase === 'warmup-phone' && p.preparing).length > 50
      && __DUO_STARTUP__.pipelines.some(p => p.phase === 'warmup-phone' && p.preparing && p.pending)`, '真实多通道异步编译')
    if (mode === 'resize') {
      await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false })
    }
    else {
      const destroyed = await evaluate(`(() => {
         const p = __DUO_STARTUP__, e = p.Experience.instance
         p.old = e
         p.phasesAtDestroy = e.performanceMonitor.warmups.map(w => w.phase)
        p.labelDisposals = Object.values(e.world.exhibition.labelTextures ?? {}).map(texture => {
          const record={name:texture.name,count:0}
          texture.addEventListener('dispose',()=>record.count++)
          return record
        })
         e.destroy()
        const snapshot = { initialized:e.initialized, starts:p.firstFrames.length,
          hooked:Object.hasOwn(e.renderer.instance.backend, 'createRenderPipeline') }
        // 不等待旧 Native 编译任务，直接在同一 Canvas 上执行 HMR 的销毁/重建生命周期。
        p.restart = (async () => {
          const next = new p.Experience({ canvas:document.querySelector('.webgl'), debugPanel:document.querySelector('.debug-panel') })
          await next.init()
          document.querySelector('.status-panel').hidden = true
        })()
        p.restart.catch(() => {})
        return snapshot
      })()`)
      assert.deepEqual(destroyed, { initialized: false, starts: 0, hooked: false })
      if (!labelSnapshotRoot) {
        assert.ok(await evaluate('__DUO_STARTUP__.labelDisposals.length === 8 && __DUO_STARTUP__.labelDisposals.every(t=>t.count===1)'), '编译中销毁必须将八张离线标签纹理各释放一次')
      }
      await evaluate('__DUO_STARTUP__.restart.then(() => true)')
      await waitFor(`__DUO_STARTUP__.old.renderer.preparing === false && __DUO_STARTUP__.pipelines.every(p => !p.pending)`, '销毁后迟到任务收束')
      assert.equal(await evaluate('__DUO_STARTUP__.old.initialized'), false, '旧实例不能迟到发布就绪')
    }
  }
  await waitFor(production
    ? `document.querySelector('.status-panel')?.hidden === true`
    : `__DUO_STARTUP__.Experience?.instance?.initialized === true`, '产品启动')
  if (production) {
    await screenshot('production')
  }
  else {
    const first = await evaluate('__DUO_STARTUP__.firstFrames.at(-1)')
    assert.equal(first.angle, 8, '首帧必须回到 Folded，不闪现装配态')
    assert.equal(first.tilt, 0)
    assert.equal(first.controllerVisible, false)
    assert.equal(first.mode, 'phone')
    assert.deepEqual(first.screens, { topScreen: true, bottomScreen: true, bottomDisplay: false })
    const startup = await evaluate(`(() => {
      const e = __DUO_STARTUP__.Experience.instance
      window.experience = e
      return { loadMs:e.performanceMonitor.loadMs, warmups:e.performanceMonitor.warmups }
    })()`)
    if (mode === 'layout') {
      const layout = await evaluate(`(() => {
        const e = experience, x = e.world.exhibition
        return { width:e.sizes.width, height:e.sizes.height, compact:x.params.compact,
          parts:x.parts.visible, dock:x.dock.visible, airpods:x.airpods.group.visible,
          internal:x.internalComponents.group.visible, library:x.gameLibrary.group.visible }
      })()`)
      assert.ok(['parts', 'dock', 'airpods', 'internal', 'library'].every(key => layout[key]), `桌面画布不能整组隐藏展品：${JSON.stringify(layout)}`)
    }
    assert.deepEqual(startup.warmups.map(w => w.phase), ['warmup-phone', 'warmup-game-home', 'warmup-playing', 'warmup-folded'])
    assert.ok(startup.warmups[0].preparedPipelines > 100)
    if (mode === 'resize')
      assert.ok(startup.warmups.some(w => w.resizeRestarts > 0), '必须验证预热内延迟 resize')
    await waitFor(`document.querySelector('.status-panel').hidden === true`, 'Loading 遮罩退出')
    await evaluate('experience.world.intro.skip()')
    await delay(1200)
    if (mode === 'intro-copy') {
      const introCopy = await verifyIntroCopy()
      await evaluate(`__DUO_STARTUP__.introCopy = ${JSON.stringify(introCopy)}`)
    }
    await evaluate('experience.performanceMonitor.samples.clear()')
    await delay(4000)
    await evaluate(`experience.renderer.instance.setAnimationLoop(null); experience.world.exhibition.update(0);
      experience.world.stylus.canvas.hidden=true; experience.renderer.shadowTracker.invalidated=true; experience.renderer.update()`)
    await screenshot('hero')
    await evaluate(`experience.world.cameraDirector.transitionTo('play', {immediate:true}); experience.renderer.update()`)
    await screenshot('play')
    const redraw = await evaluate(`(async () => {
      const r = experience.renderer
      r.shadowTracker.invalidated = true
      r.update()
      const before = r.instance.info.render.drawCalls
      const complete = await r.warmup()
      return __DUO_STARTUP__.redraw = { complete, before, after:r.instance.info.render.drawCalls }
    })()`)
    assert.equal(redraw.complete, true)
    assert.equal(redraw.before, redraw.after, '稳定后的完整重绘不能补出缺失物体')
    await screenshot('play-redraw')
    if (mode === 'labels') {
      const labels = await evaluate(`(() => {
        const x = experience.world.exhibition
        const list = [x.partsDisplay.label, x.colorDock.label, x.props.plaqueLabel, ...x.internalComponents.labels, x.gameLibrary.label]
        return __DUO_STARTUP__.labels = list.map(label => ({name:label.mesh.name,
          canvas:label.texture.image instanceof HTMLCanvasElement, width:label.texture.image.width,
          height:label.texture.image.height, textureVersion:label.texture.version, alphaTest:label.material.alphaTest,
          transparent:label.material.transparent, depthWrite:label.material.depthWrite, anisotropy:label.texture.anisotropy}))
      })()`)
      assert.equal(labels.length, 6)
      if (!labelSnapshotRoot)
        assert.ok(labels.every(label => !label.canvas), '离线标签不应创建 CanvasTexture')
      // 仅验收工具创建导出 Canvas，产品路径不执行此代码；保留可逐像素比较的源图。
      const images = await evaluate(`(() => {
        const x = experience.world.exhibition
        return [x.partsDisplay.label, x.colorDock.label, x.props.plaqueLabel, ...x.internalComponents.labels, x.gameLibrary.label].map(label => {
          const image=label.texture.image, canvas=document.createElement('canvas')
          canvas.width=image.width; canvas.height=image.height
          canvas.getContext('2d').drawImage(image,0,0)
          return {name:label.mesh.name,png:canvas.toDataURL('image/png').split(',')[1]}
        })
      })()`)
      for (const image of images) await writeFile(join(output, `label-${image.name}.png`), Buffer.from(image.png, 'base64'))
      // 用无光照离屏材质实际执行同一贴图/颜色节点，读回色点/下划线，不只断言属性。
      const validation = await evaluate(`(async () => {
        const p=__DUO_STARTUP__, T=p.THREE, e=experience, dock=e.world.exhibition.colorDock, label=dock.label
        const r=e.renderer.instance, savedTarget=r.getRenderTarget(), savedTheme=dock.selectedTheme
        const palette=dock.themes.map(t => ({...t})), versions=label.textures?.map(t=>t.version), materialVersion=label.material.version
        const target=new T.RenderTarget(1024,128,{type:T.UnsignedByteType,depthBuffer:false})
        target.texture.colorSpace=T.SRGBColorSpace
        const scene=new T.Scene(), camera=new T.OrthographicCamera(-0.5,0.5,0.5,-0.5,0.1,10)
        camera.position.z=1
        const material=new T.MeshBasicNodeMaterial({map:label.texture,colorNode:label.material.colorNode,toneMapped:false})
        const mesh=new T.Mesh(new T.PlaneGeometry(1,1),material)
        scene.add(mesh)
        const logicalHeight=1000*0.065/0.57, checks=[], images=[], presetCanvases=[]
        const color=hex => [parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)]
        const capture=async name => {
          material.map=label.texture
          r.setRenderTarget(target); r.render(scene,camera)
          const data=await r.readRenderTargetPixelsAsync(target,0,0,1024,128)
          const sample=(x,y) => [...data.slice((Math.floor(y/logicalHeight*128)*1024+Math.floor(x/1000*1024))*4,
            (Math.floor(y/logicalHeight*128)*1024+Math.floor(x/1000*1024))*4+3)]
          for (const [index,theme] of dock.themes.entries()) {
            const x=622+index*145
            for (const [dot,key] of ['shell','buttons','dpad'].entries()) checks.push({name,kind:key,theme:theme.key,actual:sample(x+(dot-1)*26,42),expected:color(theme[key])})
            checks.push({name,kind:'underline',theme:theme.key,actual:sample(x,105),expected:color(theme.key===dock.selectedTheme?'#32668b':'#e7e3dc')})
          }
          const canvas=document.createElement('canvas'); canvas.width=1024; canvas.height=128
          canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data),1024,128),0,0)
          images.push({name,png:canvas.toDataURL('image/png').split(',')[1]})
        }
        try {
          for (const theme of dock.themes) {
            dock.setSelectedTheme(theme.key)
            await capture(theme.key)
            presetCanvases.push(label.texture.image instanceof HTMLCanvasElement)
          }
          Object.assign(dock.themes[1],{shell:'#14a375',buttons:'#c629a4',dpad:'#3769c8'})
          dock.applyColors()
          dock.setSelectedTheme('retro')
          await capture('custom')
          return {checks,images,versions,after:label.textures?.map(t=>t.version),materialVersion,afterMaterialVersion:label.material.version,
            presetCanvases,customCanvas:label.texture.image instanceof HTMLCanvasElement}
        } finally {
          dock.themes.forEach((theme,index) => Object.assign(theme,palette[index]))
          dock.applyColors(); dock.setSelectedTheme(savedTheme)
          r.setRenderTarget(savedTarget)
          target.dispose(); mesh.geometry.dispose(); material.dispose()
          e.renderer.update()
          if (label.textures && label.canvas) throw new Error('恢复预设后应释放自定义标签 Canvas')
        }
      })()`)
      for (const check of validation.checks) {
        assert.ok(check.actual.every((value, channel) => Math.abs(value - check.expected[channel]) <= 2), `实际 GPU 标签颜色/下划线不符：${JSON.stringify(check)}`)
      }
      if (!labelSnapshotRoot) {
        assert.deepEqual(validation.after, validation.versions, '预设切换不得更新离线贴图版本')
        assert.deepEqual(validation.presetCanvases, [false, false, false])
        assert.equal(validation.customCanvas, true, '自定义配色保留按需画布')
        assert.equal(validation.afterMaterialVersion, validation.materialVersion, '换色不得重编译标签材质')
      }
      for (const image of validation.images) await writeFile(join(output, `label-dock-${image.name}.png`), Buffer.from(image.png, 'base64'))
      delete validation.images
      await evaluate(`__DUO_STARTUP__.labelValidation=${JSON.stringify(validation)}`)
    }
    if (mode === 'layout') {
      const state = `(() => {
        const e = experience, x = e.world.exhibition
        return {width:e.sizes.width, height:e.sizes.height, compact:x.params.compact,
          parts:x.parts.visible, dock:x.dock.visible, airpods:x.airpods.group.visible,
          internal:x.internalComponents.group.visible, library:x.gameLibrary.group.visible}
      })()`
      const states = [await evaluate(state)]
      for (const size of [
        { width: 390, height: 844, compact: true, name: 'mobile' },
        { width: 720, height: 1031, compact: true, name: 'breakpoint-720' },
        { width: 721, height: 1031, compact: false, name: 'breakpoint-721' },
        { width: 1166, height: 1031, compact: false, name: 'desktop-restored' },
      ]) {
        await send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: false })
        await waitFor(`experience.sizes.width === ${size.width} && experience.world.exhibition.params.compact === ${size.compact}`, size.name)
        // 前面已暂停主循环，resize 后显式走正式预热/重绘路径，不只断言属性而保存空白截图。
        assert.equal(await evaluate('experience.renderer.warmup()'), true)
        const current = await evaluate(state)
        states.push(current)
        assert.ok(['parts', 'dock', 'airpods', 'internal', 'library'].every(key => current[key] === !size.compact))
        await screenshot(`layout-${size.name}`)
      }
      await evaluate(`__DUO_STARTUP__.layouts = ${JSON.stringify(states)}`)
    }
    if (mode === 'materials' || mode === 'labels') {
      const details = await evaluate(`(() => {
        const w = experience.world, buttons = Object.values(w.product.buttons).map(mesh => mesh.material)
        const samples = w.exhibition.colorDock.samples.map(s => s.buttonMaterials.filter(b => b.part !== 'dpad').map(b => b.material))
        const count = list => new Set(list.map(m => m.customProgramCacheKey())).size
        return {mainGraphs:count(buttons.slice(0,4)), sampleGraphs:count(samples.flat()),
          mainColors:buttons.map(m => m.color.getHexString()), sampleColors:samples.map(list => list.map(m => m.color.getHexString())),
          independentMaterials:new Set(samples.flat()).size, hasProjection:Object.values(w.product.buttons).slice(0,4).every(mesh => !!mesh._buttonPrint)}
      })()`)
      if (!snapshotRoot) {
        assert.equal(details.mainGraphs, 1)
        assert.equal(details.sampleGraphs, 1)
        assert.equal(details.hasProjection, true)
      }
      assert.equal(details.independentMaterials, 12)
      await evaluate(`__DUO_STARTUP__.buttonMaterials = ${JSON.stringify(details)}`)
      for (const theme of ['classic', 'retro', 'midnight']) {
        const colors = await evaluate(`(() => {
          const w = experience.world
          w.controllerThemes.select('${theme}')
          w.controllerThemes.finishTransition()
          w.exhibition.update(0)
          w.screenManager.update()
          return { main:w.product.buttons.a.material.color.getHexString(),
            samples:w.exhibition.colorDock.samples.map(s => s.buttonMaterials.filter(b => b.part === 'a').map(b => b.material.color.getHexString())) }
        })()`)
        assert.equal(colors.main, details.sampleColors[['classic', 'retro', 'midnight'].indexOf(theme)][0])
        assert.deepEqual(colors.samples.flat(), details.sampleColors.map(list => list[0]), '主机换色不得改动独立样品')
        for (const view of ['hero', 'play']) {
          await evaluate(`experience.world.cameraDirector.transitionTo('${view}', {immediate:true});
            experience.renderer.shadowTracker.invalidated=true; experience.renderer.update()`)
          await screenshot(`${theme}-${view}`)
        }
      }
    }
    await evaluate(`experience.world.intro.play(); experience.world.intro.skip();
      experience.world.cameraDirector.transitionTo('hero', {immediate:true}); experience.renderer.update()`)
    // 触发游戏进入的按需预热，然后取消；不启动 WASM / ROM / 音频。
    const cancelled = await evaluate(`(async () => {
      const s = experience.world.screenManager
      s.gameMaterialsPrepared = false
      const pending = s.revealGameEntry()
      s.cancelGameEntry()
      return __DUO_STARTUP__.cancelled = { result:await pending, mode:s.mode, prepared:s.gameMaterialsPrepared }
    })()`)
    assert.deepEqual(cancelled, { result: false, mode: 'game-home', prepared: false })
  }
  await delay(200)
  const report = await evaluate(`(() => {
    const p = __DUO_STARTUP__, e = p.Experience?.instance
    return { completedAt:p.completedAt, firstFrames:p.firstFrames, gpuErrors:p.gpuErrors, redraw:p.redraw, cancelled:p.cancelled, buttonMaterials:p.buttonMaterials, layouts:p.layouts, introCopy:p.introCopy, labels:p.labels, labelRedraws:p.labelRedraws, initialLabelRedraws:p.initialLabelRedraws, labelValidation:p.labelValidation, labelDisposals:p.labelDisposals,
      pipelines:p.pipelines, engine:document.querySelector('.webgl')?.dataset.engine,
      monitor:e ? {loadMs:e.performanceMonitor.loadMs, warmups:e.performanceMonitor.warmups,
        steady:JSON.parse(e.canvas.dataset.performance)} : null,
      hooked:e ? Object.hasOwn(e.renderer.instance.backend, 'createRenderPipeline') : null,
      viewport:e ? {width:e.renderer.instance.domElement.width, height:e.renderer.instance.domElement.height} : null,
      resources:performance.getEntriesByType('resource').map(r => new URL(r.name).pathname) }
  })()`)
  Object.assign(report, { mode, output, snapshotRoot, labelSnapshotRoot, errors, warnings, networkFailures })
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ mode, output, loadMs: report.monitor?.loadMs, completedAt: report.completedAt, warmups: report.monitor?.warmups, viewport: report.viewport, errors, gpuErrors: report.gpuErrors }, null, 2))
  assert.match(report.engine, /\bwebgpu$/)
  assert.equal(report.gpuErrors.length, 0)
  assert.equal(errors.length, 0)
  assert.ok(!report.resources.some(path => /\.(nds|wasm)$/.test(path)), '首屏不得启动模拟器')
  if (!production) {
    assert.equal(report.hooked, false, '正常渲染不保留 backend hook')
    if (mode === 'resize') {
      assert.equal(report.viewport.width, 1200)
      assert.ok(report.viewport.height > 0 && report.viewport.height < 900)
    }
    // Three 内置的少数 mipmap 小管线仍由纹理工具同步创建；本项检查实际材质/通道管线。
    assert.equal(report.pipelines.filter(p => p.preparing && p.method === 'createRenderPipeline' && p.label?.startsWith('renderPipeline_')).length, 0)
  }
}
catch (error) {
  let diagnostic
  try {
    diagnostic = await evaluate(`({state:document.querySelector('.status-panel')?.outerHTML,
      gpuErrors:__DUO_STARTUP__?.gpuErrors, pipelines:__DUO_STARTUP__?.pipelines})`)
    await screenshot('failure')
  }
  catch {}
  await writeFile(join(output, 'failure.json'), JSON.stringify({ message: error.message, diagnostic, errors, warnings, networkFailures }, null, 2))
  console.error('STARTUP_FAILURE', output)
  throw error
}
finally {
  if (socket?.readyState === 1) {
    try { await send('Browser.close') }
    catch {}
    socket.close()
  }
  chrome.kill()
  for (const item of pending.values()) clearTimeout(item.timer)
  if (production)
    await new Promise(resolve => server.httpServer.close(resolve))
  else await server.close()
}
