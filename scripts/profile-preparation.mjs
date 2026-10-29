import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'

// 只在独立 Chrome 的响应副本中注入，不修改应用、node_modules 或用户正在查看的页面。
// node scripts/profile-preparation.mjs <Chrome> <已有临时目录> [baseline|async|serial|normal-only|no-backdrop|no-ao|simple-plastic|simple-buttons]
const [chromePath, tempRoot, mode = 'baseline'] = process.argv.slice(2)
assert.ok(chromePath && tempRoot, '需要 Chrome 路径及已有临时目录')
assert.ok(['baseline', 'async', 'serial', 'normal-only', 'no-backdrop', 'no-ao', 'simple-plastic', 'simple-buttons'].includes(mode))
const output = await mkdtemp(join(tempRoot, `duo-prep-${mode}-`))
const projectRoot = fileURLToPath(new URL('../', import.meta.url))
// 可选旧源码快照只替换临时服务响应，用于同轮 A/B，不回退工作区的任何修改。
const snapshotRoot = process.env.DUO_BUTTON_SNAPSHOT
const snapshots = snapshotRoot ? await Promise.all(['ButtonPrint.js', 'ControllerButtonMaterial.js']
  .map(async name => [name, await readFile(join(snapshotRoot, name), 'utf8')])) : []
const server = await createServer({
  configFile: join(projectRoot, 'vite.config.js'),
  cacheDir: join(output, 'vite-cache'),
  server: { host: '127.0.0.1', port: 0, strictPort: true, hmr: false, fs: { allow: [projectRoot, output] } },
  plugins: [{ name: 'preparation-probe-only', enforce: 'pre', transform(code, id) {
    const path = id.split('?')[0].replaceAll('\\', '/')
    const snapshot = snapshots.find(([name]) => path.endsWith(`/src/js/World/Product/${name}`))
    if (snapshot) return snapshot[1]
    if (path.endsWith('/src/js/Core/Renderer.js')) {
      const normalized = code.replaceAll('\r\n', '\n')
      const legacy = normalized.includes('this.update()\n      timings.renderSubmitMs')
      assert.ok(legacy || normalized.includes('this.preparation.run('), '未找到实际预热入口')
      let text = normalized.replace('await this.instance.init()', 'await this.instance.init(); window.__DUO_PREP__.attach(this.instance)')
      if (legacy) text = text.replace('this.update()\n      timings.renderSubmitMs', 'this.update()\n      await window.__DUO_PREP__.drain(this)\n      timings.renderSubmitMs')
      assert.notEqual(text, code, '未找到 Renderer 诊断注入位置')
      return text
    }
    if (path.endsWith('/src/js/World/World.js')) {
      const text = code.replace('async preparePresentation() {', 'async preparePresentation() { window.__DUO_PREP__.configure(this.experience.renderer)')
      assert.notEqual(text, code, '未找到 World 诊断注入位置')
      return text
    }
    if (mode === 'normal-only' && path.endsWith('/src/js/Core/ScenePipeline.js')) {
      return code.replace('import { RedFormat,', 'import { MeshBasicNodeMaterial, RedFormat,')
        .replace('this.prePass.transparent = false', "this.prePass.transparent = false; this.prePass.overrideMaterial = new MeshBasicNodeMaterial({name:'NormalOnlyDiagnostic'})")
    }
  } }],
})
await server.listen()
await server.transformRequest('/main.js')
await server.transformRequest('/js/Core/PerformanceMonitor.js')
const site = `http://127.0.0.1:${server.httpServer.address().port}`

function installProbe(mode) {
  const probe = { mode, enabled: true, builders: [], programs: [], pipelines: [], renders: [], errors: [], pending: [], current: null, pass: null, serialTail: Promise.resolve() }
  const now = () => performance.now()
  const phase = () => {
    try { return JSON.parse(document.querySelector('.webgl')?.dataset.performance || '{}').phase || probe.lastPhase || 'scene' }
    catch { return 'scene' }
  }
  const describe = ro => ({ material: ro?.material?.name || ro?.material?.type || '(unnamed)',
    materialId: ro?.material?.id, object: ro?.object?.name || ro?.object?.type,
    originalMaterial: ro?.object?.material?.name, pass: probe.pass?.name || 'compileAsync', phase: phase() })
  const copyDescriptor = value => {
    if (Array.isArray(value)) return value.map(copyDescriptor)
    if (!value || Object.prototype.toString.call(value) !== '[object Object]') return value
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyDescriptor(item)]))
  }
  probe.attach = renderer => {
    probe.renderer = renderer
    const backend = renderer.backend
    const device = backend.device
    const modules = new WeakMap()
    const createModule = device.createShaderModule
    device.createShaderModule = function (descriptor) {
      const result = createModule.call(this, descriptor)
      modules.set(result, descriptor.code)
      return result
    }
    for (const name of ['createRenderPipeline', 'createRenderPipelineAsync']) {
      const original = device[name]
      device[name] = function (descriptor) {
        if (!probe.enabled) return original.call(this, descriptor)
        const record = { ...describe(probe.current), label: descriptor.label, method: name, start: now(),
          samples: descriptor.multisample?.count || 1, formats: descriptor.fragment?.targets?.map(t => t.format),
          vertexCode: modules.get(descriptor.vertex?.module), fragmentCode: modules.get(descriptor.fragment?.module) }
        probe.pipelines.push(record)
        let result
        if (mode === 'serial' && name.endsWith('Async')) {
          // 原生描述符会被 Three 在返回后 reset，排队前只复制描述符，保留 GPU 句柄。
          const snapshot = copyDescriptor(descriptor)
          result = probe.serialTail.then(async () => {
            record.serviceStart = now()
            try { return await original.call(this, snapshot) }
            finally { record.serviceMs = now() - record.serviceStart }
          })
          probe.serialTail = result.catch(() => {})
        } else result = original.call(this, descriptor)
        record.callMs = now() - record.start
        if (name.endsWith('Async')) result.then(() => { record.readyMs = now() - record.start }, error => { record.error = String(error) })
        return result
      }
    }
    const getPipeline = renderer._pipelines.getForRender
    renderer._pipelines.getForRender = function (ro, promises) {
      const previous = probe.current
      probe.current = ro
      try { return getPipeline.call(this, ro, promises) }
      finally { probe.current = previous }
    }
    const backendPipeline = backend.createRenderPipeline
    backend.createRenderPipeline = function (ro, promises) {
      if ((mode === 'async' || mode === 'serial') && promises === null && probe.enabled) {
        const tasks = []
        const result = backendPipeline.call(this, ro, tasks)
        probe.pending.push(...tasks)
        return result
      }
      return backendPipeline.call(this, ro, promises)
    }
    const previousBuilderCallback = renderer.debug.onNodeBuilderCreated
    renderer.debug.onNodeBuilderCreated = (builder, ro) => {
      previousBuilderCallback?.(builder, ro)
      for (const name of ['build', 'buildAsync']) {
        const original = builder[name]
        builder[name] = function (...args) {
          if (!probe.enabled) return original.apply(this, args)
          const record = { ...describe(ro), method: name, start: now() }
          probe.builders.push(record)
          const complete = () => {
            record.ms = now() - record.start
            record.vertexBytes = this.vertexShader?.length || 0
            record.fragmentBytes = this.fragmentShader?.length || 0
          }
          const result = original.apply(this, args)
          if (result?.then) return result.finally(complete)
          complete()
          return result
        }
      }
    }
    const createProgram = backend.createProgram
    backend.createProgram = function (program) {
      const start = now()
      const result = createProgram.call(this, program)
      if (probe.enabled) probe.programs.push({ ...describe(probe.current), name: program.name, stage: program.stage,
        start, ms: now() - start, bytes: program.code?.length || 0 })
      return result
    }
    const render = renderer.render
    renderer.render = function (scene, camera) {
      if (!probe.enabled) return render.call(this, scene, camera)
      const previous = probe.pass
      const record = { name: scene.name || scene.type, target: this.getRenderTarget()?.texture?.name || 'Canvas', phase: phase(),
        start: now(), childMs: 0, childDraws: 0, depth: previous ? previous.depth + 1 : 0 }
      const before = this.info.render.drawCalls
      probe.pass = record
      try { return render.call(this, scene, camera) }
      finally {
        record.ms = now() - record.start
        record.selfMs = record.ms - record.childMs
        record.draws = this.info.render.drawCalls - before
        record.selfDraws = record.draws - record.childDraws
        if (previous) { previous.childMs += record.ms; previous.childDraws += record.draws }
        probe.pass = previous
        probe.renders.push(record)
        if (record.phase.startsWith('warmup')) {
          record.fenceStart = now()
          device.queue.onSubmittedWorkDone().then(() => { record.fenceReady = now(); record.fenceMs = record.fenceReady - record.fenceStart }, error => { record.error = String(error) })
        }
      }
    }
    device.addEventListener('uncapturederror', event => probe.errors.push(String(event.error)))
  }
  probe.configure = wrapper => {
    if (probe.configured) return
    probe.configured = true
    if (mode === 'no-backdrop') wrapper.transmissionBackdrop.capture = () => {}
    if (mode === 'no-ao') wrapper.pipeline.params.enabled = false
    if (mode === 'simple-plastic') wrapper.scene.traverse(object => {
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (material?.name !== 'Controller_Shell_Procedural_Plastic') continue
        material.normalNode = null
        material.colorNode = null
        material.roughnessNode = null
        material.needsUpdate = true
      }
    })
    if (mode === 'simple-buttons') wrapper.scene.traverse(object => {
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!material || !/Button_Plastic|Coated_Plastic/.test(material.name)) continue
        material.clearcoat = 0
        material.clearcoatNode = null
        material.clearcoatNormalNode = null
        material.clearcoatRoughnessNode = null
        material.normalNode = null
        material.roughnessNode = null
        material.needsUpdate = true
      }
    })
  }
  probe.drain = async wrapper => {
    if (mode !== 'async' && mode !== 'serial') return
    for (let i = 0; probe.pending.length && i < 8; i++) {
      await Promise.all(probe.pending.splice(0))
      await new Promise(resolve => requestAnimationFrame(resolve))
      wrapper.shadowTracker.invalidated = true
      wrapper.update()
    }
    if (probe.pending.length) throw new Error('异步诊断管线未收敛')
  }
  window.__DUO_PREP__ = probe
}

const chrome = spawn(chromePath, [
  '--headless=new', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${join(output, 'profile')}`, 'about:blank',
], { stdio: 'ignore', windowsHide: true })
let socket
let nextId = 0
const pending = new Map()
const errors = []
const networkErrors = []
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId
  const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 120000)
  pending.set(id, { resolve, reject, timeout })
  socket.send(JSON.stringify({ id, method, params }))
})
const evaluate = async expression => {
  const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails))
  return response.result.value
}
try {
  let target
  for (let i = 0; i < 60; i++) {
    try {
      const port = (await readFile(join(output, 'profile/DevToolsActivePort'), 'utf8')).split('\n')[0].trim()
      target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(page => page.type === 'page')
      if (target) break
    } catch {}
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
      if (!item) return
      clearTimeout(item.timeout)
      pending.delete(event.id)
      if (event.error) item.reject(new Error(JSON.stringify(event.error)))
      else item.resolve(event.result)
    } else if (event.method === 'Runtime.exceptionThrown') errors.push(event.params.exceptionDetails)
    else if (event.method === 'Log.entryAdded' && event.params.entry.level === 'error') {
      const entry = event.params.entry
      if (entry.source === 'network') networkErrors.push({ text: entry.text, url: entry.url })
      else errors.push(entry.text)
    }
    else if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') errors.push(event.params.args.map(a => a.value || a.description))
  })
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Log.enable')
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(${installProbe.toString()})(${JSON.stringify(mode)})` })
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: `${site}/?performance` })
  let ready = false
  let reloadedBeforeInit = false
  const attempts = Number(process.env.DUO_PROFILE_ATTEMPTS || 240)
  for (let i = 0; i < attempts; i++) {
    const status = await evaluate(`({ state:document.querySelector('.status-panel')?.dataset.state, ready:document.querySelector('.status-panel')?.hidden, detail:document.querySelector('.status-detail')?.textContent })`)
    if (status.ready) { ready = true; break }
    if (!reloadedBeforeInit && /Failed to fetch dynamically imported module/.test(status.detail || '') && await evaluate(`!document.querySelector('.webgl')?.dataset.performance`)) {
      reloadedBeforeInit = true
      errors.length = 0
      await send('Page.reload', { ignoreCache: true })
      continue
    }
    if (status.state === 'error' || errors.length) throw new Error(JSON.stringify({ status, errors }))
    if (i >= 25 && !reloadedBeforeInit && await evaluate(`!document.querySelector('.webgl')?.dataset.performance && (window.__DUO_PREP__?.builders.length ?? 0) === 0`)) {
      reloadedBeforeInit = true
      await send('Page.reload', { ignoreCache: true })
    }
    await delay(500)
  }
  if (!ready) {
    const diagnostic = await evaluate(`({url:location.href,readyState:document.readyState,status:document.querySelector('.status-panel')?.outerHTML,
      performance:document.querySelector('.webgl')?.dataset.performance,
      probe:window.__DUO_PREP__ ? {builders:__DUO_PREP__.builders.length,pipelines:__DUO_PREP__.pipelines.length,renders:__DUO_PREP__.renders.length,errors:__DUO_PREP__.errors} : null,
      resources:performance.getEntriesByType('resource').map(r=>r.name)})`)
    await writeFile(join(output, 'failure.json'), JSON.stringify({ diagnostic, errors, networkErrors }, null, 2))
    console.log('STARTUP_DIAGNOSTICS', JSON.stringify({ output, diagnostic, errors, networkErrors }))
  }
  assert.ok(ready, '初始化诊断超时')
  const report = await evaluate(`(() => {
    const p = window.__DUO_PREP__
    p.enabled = false
    p.renderer.setAnimationLoop(null)
    return {mode:p.mode, builders:p.builders, programs:p.programs, pipelines:p.pipelines, renders:p.renders,
      gpuErrors:p.errors, monitor:JSON.parse(document.querySelector('.webgl').dataset.performance)}
  })()`)
  await mkdir(join(output, 'shaders'))
  for (let i = 0; i < report.pipelines.length; i++) {
    const p = report.pipelines[i]
    for (const stage of ['vertex', 'fragment']) {
      const code = p[`${stage}Code`]
      p[`${stage}Bytes`] = code?.length || 0
      if (code) await writeFile(join(output, 'shaders', `${i}-${stage}.wgsl`), code)
      delete p[`${stage}Code`]
    }
  }
  report.errors = errors
  report.networkErrors = networkErrors
  report.reloadedBeforeInit = reloadedBeforeInit
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
  const group = (items, key, value) => {
    const groups = new Map()
    for (const item of items) {
      const name = key(item)
      if (!groups.has(name)) groups.set(name, { name, count: 0, totalMs: 0, maxMs: 0, fragmentBytes: 0 })
      const g = groups.get(name), ms = value(item) || 0
      g.count++; g.totalMs += ms; g.maxMs = Math.max(g.maxMs, ms); g.fragmentBytes += item.fragmentBytes || 0
    }
    return [...groups.values()].sort((a, b) => b.totalMs - a.totalMs)
  }
  const summary = { mode, output, snapshotRoot, monitor: report.monitor,
    buildByMaterial: group(report.builders, b => b.material, b => b.ms).slice(0, 20),
    buildByPass: group(report.builders, b => `${b.phase} / ${b.pass}`, b => b.ms),
    pipelineByPass: group(report.pipelines, b => `${b.phase} / ${b.pass}`, b => b.callMs),
    serialByMaterial: group(report.pipelines.filter(p => p.serviceMs !== undefined), b => b.material, b => b.serviceMs),
    serialByPass: group(report.pipelines.filter(p => p.serviceMs !== undefined), b => `${b.phase} / ${b.pass}`, b => b.serviceMs),
    slowPipelines: [...report.pipelines].sort((a, b) => (b.readyMs || b.callMs) - (a.readyMs || a.callMs)).slice(0, 20),
    warmupPasses: report.renders.filter(r => r.phase === 'warmup-phone'), errors, gpuErrors:report.gpuErrors }
  await writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2))
  console.log(JSON.stringify({ mode, output, loadMs:report.monitor.loadMs, warmups:report.monitor.warmups,
    coldPasses:summary.pipelineByPass.filter(p => p.name.startsWith('warmup-phone')).map(p => ({name:p.name,pipelines:p.count,fragmentKB:Math.round(p.fragmentBytes / 1000)})),
    serialByMaterial:summary.serialByMaterial.slice(0, 12), serialByPass:summary.serialByPass,
    errors, gpuErrors:report.gpuErrors }, null, 2))
  assert.equal(report.gpuErrors.length, 0)
  assert.equal(errors.length, 0)
} finally {
  if (socket?.readyState === 1) {
    try { await send('Browser.close') } catch {}
    socket.close()
  }
  chrome.kill()
  for (const item of pending.values()) clearTimeout(item.timeout)
  await server.close()
}
