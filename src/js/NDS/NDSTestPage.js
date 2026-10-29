import { ndsSources } from '../sources.js'
import NDSAudio from './NDSAudio.js'
import NDSRuntime from './NDSRuntime.js'
import NDSScreenBridge from './NDSScreenBridge.js'

const KEY_ACTIONS = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyX: 'a',
  KeyZ: 'b',
  KeyS: 'x',
  KeyA: 'y',
  KeyQ: 'l',
  KeyW: 'r',
  Enter: 'start',
  ShiftLeft: 'select',
  ShiftRight: 'select',
}

class NDSTestPage {
  constructor() {
    this.elements = Object.fromEntries([
      'status',
      'load-default',
      'rom-file',
      'pause',
      'audio',
      'audio-status',
      'top-screen',
      'bottom-screen',
      'speed',
      'fps',
      'frame-ms',
      'heap',
      'load-time',
    ].map(id => [id, document.getElementById(id)]))
    this.listeners = new AbortController()
    this.keys = new Set()
    this.bridge = new NDSScreenBridge(this.elements['top-screen'], this.elements['bottom-screen'])
    this.runtime = new NDSRuntime({
      onFrame: pixels => this.bridge.draw(pixels),
      onStatus: text => this.setStatus(text),
      onStats: stats => this.showStats(stats),
    })
    this.runtime.audio = new NDSAudio(ndsSources.audioWorklet)
    this.elements['load-default'].disabled = !ndsSources.testRom
    if (!ndsSources.testRom)
      this.setStatus('构建预览：请选择本地 .nds 文件')
    this.bindEvents()
    this.lastTime = performance.now()
    this.tick = this.tick.bind(this)
    this.frameId = requestAnimationFrame(this.tick)
  }

  listen(target, type, callback) {
    target.addEventListener(type, callback, { signal: this.listeners.signal })
  }

  bindEvents() {
    this.listen(this.elements['load-default'], 'click', () => this.load())
    this.listen(this.elements['rom-file'], 'change', (event) => {
      const file = event.target.files[0]
      if (file)
        this.load(file)
    })
    this.listen(this.elements.pause, 'click', () => this.togglePause())
    this.listen(this.elements.audio, 'click', async () => {
      this.elements.audio.disabled = true
      try {
        const audio = this.runtime.audio
        if (audio.enabled)
          audio.disable()
        else await audio.enable()
        if (this.destroyed)
          return
        this.elements.audio.textContent = audio.enabled ? '静音' : '启用声音'
        this.elements['audio-status'].textContent = audio.enabled ? 'AudioWorklet · 48 kHz · stereo' : '声音已关闭'
      }
      catch (error) {
        this.elements['audio-status'].textContent = `音频未启用：${error.message}`
      }
      finally {
        if (!this.destroyed)
          this.elements.audio.disabled = false
      }
    })
    this.listen(window, 'keydown', (event) => {
      if (event.code === 'Escape' && !event.repeat)
        this.togglePause()
      if (event.target.matches('input, button, select, textarea, a'))
        return
      if (!KEY_ACTIONS[event.code] || !this.runtime.running)
        return
      event.preventDefault()
      this.keys.add(event.code)
      this.applyKeys()
    })
    this.listen(window, 'keyup', (event) => {
      if (!KEY_ACTIONS[event.code])
        return
      this.keys.delete(event.code)
      this.applyKeys()
    })
    this.listen(window, 'blur', () => this.pause())
    this.listen(document, 'visibilitychange', () => {
      if (document.hidden)
        this.pause()
    })
    this.listen(window, 'pagehide', () => this.pause())
    const canvas = this.elements['bottom-screen']
    this.listen(canvas, 'pointerdown', (event) => {
      if (!this.runtime.running || this.pointerId != null || event.button !== 0)
        return
      event.preventDefault()
      canvas.focus({ preventScroll: true })
      this.pointerId = event.pointerId
      canvas.setPointerCapture(event.pointerId)
      this.touch(event)
    })
    this.listen(canvas, 'pointermove', (event) => {
      if (event.pointerId === this.pointerId)
        this.touch(event)
    })
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.listen(canvas, type, (event) => {
        if (event.pointerId === this.pointerId)
          this.releaseTouch()
      })
    }
  }

  applyKeys() {
    this.runtime.setButtons([...this.keys].map(code => KEY_ACTIONS[code]))
  }

  touch(event) {
    const bounds = this.elements['bottom-screen'].getBoundingClientRect()
    // 独立页保持 4:3，无 letterbox；这里使用 Canvas 左上角坐标，后续 3D 桥接需另做 UV 变换。
    const x = (event.clientX - bounds.left) / bounds.width * 256
    const y = (event.clientY - bounds.top) / bounds.height * 192
    this.runtime.touch(x, y, x >= 0 && x < 256 && y >= 0 && y < 192)
  }

  releaseTouch() {
    const canvas = this.elements['bottom-screen']
    const pointerId = this.pointerId
    this.pointerId = null
    if (pointerId != null && canvas.hasPointerCapture(pointerId))
      canvas.releasePointerCapture(pointerId)
    this.runtime.touch(0, 0, false)
  }

  async load(file) {
    if (this.loading || this.destroyed)
      return
    this.loading = true
    this.pause()
    document.body.dataset.error = 'false'
    this.elements['load-default'].disabled = true
    this.elements['rom-file'].disabled = true
    this.elements.pause.disabled = true
    const start = performance.now()
    try {
      await this.runtime.init(ndsSources)
      if (this.destroyed)
        return
      if (file) {
        const bytes = new Uint8Array(await file.arrayBuffer())
        if (this.destroyed)
          return
        this.runtime.loadBytes(bytes, file.name)
      }
      else {
        await this.runtime.loadUrl(ndsSources.testRom)
      }
      if (this.destroyed)
        return
      this.elements['load-time'].textContent = `核心 + ROM 载入：${((performance.now() - start) / 1000).toFixed(2)} s；首帧与游戏内表现请实测。`
      this.elements.pause.disabled = false
      this.elements.audio.disabled = false
      this.failed = false
      if (!document.hidden && document.hasFocus())
        this.resume()
      else this.setStatus('载入完成，点击「继续」开始')
    }
    catch (error) {
      if (!this.destroyed)
        this.fail(error)
    }
    finally {
      this.loading = false
      if (!this.destroyed) {
        this.elements['load-default'].disabled = !ndsSources.testRom
        this.elements['rom-file'].disabled = false
      }
    }
  }

  setStatus(text) {
    this.elements.status.textContent = text
  }

  showStats(stats) {
    this.elements.speed.textContent = stats.speed.toFixed(1)
    this.elements.fps.textContent = stats.fps.toFixed(1)
    this.elements['frame-ms'].textContent = stats.frameMs.toFixed(2)
    this.elements.heap.textContent = stats.heapMiB.toFixed(0)
  }

  pause() {
    this.keys.clear()
    this.releaseTouch()
    this.runtime.pause()
    this.elements.pause.textContent = '继续'
    if (this.runtime.loaded)
      this.setStatus('已暂停 · 点击继续恢复')
  }

  resume() {
    this.runtime.resume()
    this.lastTime = performance.now()
    this.elements.pause.textContent = '暂停'
    this.elements['bottom-screen'].focus({ preventScroll: true })
    this.setStatus('运行中 · 点击下屏后可使用键盘操作')
  }

  togglePause() {
    if (!this.runtime.loaded || this.loading || this.failed)
      return
    if (this.runtime.running)
      this.pause()
    else this.resume()
  }

  fail(error) {
    this.pause()
    this.failed = true
    document.body.dataset.error = 'true'
    this.setStatus(`运行失败：${error.message}`)
    console.error(error)
  }

  tick(now) {
    if (this.destroyed)
      return
    try {
      this.runtime.update(now - this.lastTime)
    }
    catch (error) {
      this.fail(error)
    }
    this.lastTime = now
    this.frameId = requestAnimationFrame(this.tick)
  }

  destroy() {
    this.destroyed = true
    cancelAnimationFrame(this.frameId)
    this.listeners.abort()
    this.releaseTouch()
    this.runtime.destroy()
    this.bridge.destroy()
  }
}

const page = new NDSTestPage()
if (import.meta.hot)
  import.meta.hot.dispose(() => page.destroy())
