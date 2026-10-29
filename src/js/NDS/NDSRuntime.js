// API 调用约定改编自 pilas-melonds src/app.js (José Pilas, MPL-2.0)。
// https://github.com/josepilas/pilas-melonds/tree/7adc554ce1dc5318fef3797e8f00a6e9286dac3b
// This Source Code Form is subject to the Mozilla Public License, v. 2.0.
// https://mozilla.org/MPL/2.0/

export const NDS_WIDTH = 256
export const NDS_HEIGHT = 192
export const NDS_FPS = 59.8261
const FRAME_INTERVAL = 1000 / NDS_FPS
const FRAME_BYTES = NDS_WIDTH * NDS_HEIGHT * 4 * 2
const BUTTONS = ['a', 'b', 'select', 'start', 'right', 'left', 'up', 'down', 'r', 'l', 'x', 'y']

export default class NDSRuntime {
  constructor({ onFrame = () => {}, onStatus = () => {}, onStats = () => {} } = {}) {
    this.onFrame = onFrame
    this.onStatus = onStatus
    this.onStats = onStats
    this.instance = 0
    this.running = false
    this.loaded = false
    this.destroyed = false
    this.accumulator = 0
    this.inputMask = 0xFFF
    this.frameCount = 0
    this.statFrames = 0
    this.statCost = 0
    this.statStart = performance.now()
    this.audioFrames = 2048
    this.abortController = new AbortController()
  }

  async init({ core, wasm, factory }) {
    if (this.destroyed)
      throw new Error('NDSRuntime 已销毁')
    if (this.initPromise)
      return this.initPromise
    if (this.module)
      return
    this.onStatus('正在初始化 WASM…')
    this.initPromise = (async () => {
      // 绝对 URL 避免 Vite 将 public 下的原样 ESM 当作源码追加 ?import 并拒绝加载。
      const createModule = factory ?? (await import(/* @vite-ignore */ new URL(core, location.href).href)).default
      const module = await createModule({
        locateFile: path => path.endsWith('.wasm') ? wasm : new URL(path, new URL(core, location.href)).href,
        print: () => {},
        printErr: text => console.warn('[melonDS]', text),
      })
      if (this.destroyed)
        return
      this.module = module
      this.instance = module._pilas_create(48000)
      if (!this.instance)
        throw new Error('无法创建 melonDS 实例')
      module._pilas_set_console_mode(this.instance, 0, 0)
      module._pilas_set_direct_boot(this.instance, 1)
      this.audioPtr = this.allocate(new Uint8Array(this.audioFrames * 2 * 2))
      this.onStatus('核心已就绪，等待载入 ROM')
    })().catch((error) => {
      if (this.audioPtr)
        this.module._free(this.audioPtr)
      if (this.instance)
        this.module._pilas_destroy(this.instance)
      this.audioPtr = 0
      this.instance = 0
      this.module = null
      this.initPromise = null
      throw error
    })
    return this.initPromise
  }

  allocate(bytes) {
    const pointer = this.module._malloc(bytes.byteLength)
    if (!pointer)
      throw new Error('WASM 内存分配失败')
    this.module.HEAPU8.set(bytes, pointer)
    return pointer
  }

  async loadUrl(url, { signal } = {}) {
    this.onStatus('正在读取本地测试 ROM…')
    const requestSignal = signal
      ? AbortSignal.any([signal, this.abortController.signal])
      : this.abortController.signal
    const response = await fetch(url, { signal: requestSignal })
    if (!response.ok)
      throw new Error(`ROM 读取失败：HTTP ${response.status}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    requestSignal.throwIfAborted()
    if (this.destroyed)
      return
    this.loadBytes(bytes, decodeURIComponent(new URL(url, location.href).pathname.split('/').pop()))
  }

  loadBytes(bytes, name = 'game.nds') {
    if (!this.instance || this.destroyed)
      throw new Error('NDS 核心尚未就绪')
    this.pause()
    this.loaded = false
    if (bytes.byteLength < 512)
      throw new Error('ROM 太小，不是有效的 NDS 文件')
    const module = this.module
    let romPtr = 0
    let namePtr = 0
    try {
      romPtr = this.allocate(bytes)
      namePtr = this.allocate(new TextEncoder().encode(`${name}\0`))
      const ok = module._pilas_load_rom(this.instance, romPtr, bytes.byteLength, 0, 0, namePtr)
      if (!ok)
        throw new Error(this.lastError() || 'ROM 启动失败')
    }
    finally {
      if (romPtr)
        module._free(romPtr)
      if (namePtr)
        module._free(namePtr)
    }
    const now = new Date()
    module._pilas_set_rtc(this.instance, now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds())
    this.loaded = true
    this.frameCount = 0
    this.onStatus(`已载入：${name}`)
  }

  lastError() {
    const pointer = this.module._pilas_last_error(this.instance)
    if (!pointer)
      return ''
    const heap = this.module.HEAPU8
    const end = heap.indexOf(0, pointer)
    return new TextDecoder().decode(heap.subarray(pointer, end < 0 ? heap.length : end))
  }

  resume() {
    if (!this.loaded || this.destroyed)
      return
    this.running = true
    this.accumulator = 0
    this.statFrames = 0
    this.statCost = 0
    this.statStart = performance.now()
    this.audio?.clearQueue()
  }

  pause() {
    this.running = false
    this.accumulator = 0
    this.releaseInputs()
    this.audio?.clearQueue()
  }

  setButtons(actions) {
    if (!this.running)
      return
    // melonDS 按键是低电平有效：0 表示按下，不能按常见的 active-high 掩码处理。
    this.inputMask = 0xFFF
    for (const action of actions) {
      const bit = BUTTONS.indexOf(action)
      if (bit !== -1)
        this.inputMask &= ~(1 << bit)
    }
    this.module._pilas_set_key_mask(this.instance, this.inputMask)
  }

  touch(x, y, pressed) {
    if (!this.instance || (pressed && !this.running))
      return
    this.module._pilas_set_touch(this.instance, Math.max(0, Math.min(255, Math.floor(x))), Math.max(0, Math.min(191, Math.floor(y))), pressed ? 1 : 0)
  }

  releaseInputs() {
    this.inputMask = 0xFFF
    if (!this.instance)
      return
    this.module._pilas_set_key_mask(this.instance, this.inputMask)
    this.touch(0, 0, false)
  }

  runFrame() {
    if (!this.loaded || this.destroyed)
      return
    const start = performance.now()
    this.module._pilas_run_frame(this.instance)
    this.statCost += performance.now() - start
    this.frameCount++
    this.statFrames++
    // 即使静音也取走音频，避免核心队列积累；WASM grow 后每次重新读取 HEAP 视图。
    const count = this.module._pilas_pull_audio(this.instance, this.audioPtr, this.audioFrames)
    if (count > 0) {
      const begin = this.audioPtr >> 1
      this.audio?.push(this.module.HEAP16.subarray(begin, begin + count * 2))
    }
  }

  present() {
    const module = this.module
    const pointer = module._pilas_get_framebuffer_ptr(this.instance)
    const size = module._pilas_get_framebuffer_size(this.instance)
    if (!pointer || size < FRAME_BYTES || pointer + FRAME_BYTES > module.HEAPU8.length) {
      throw new Error('模拟器返回无效双屏帧缓冲')
    }
    // 回调必须同步消费或复制数据，不能跨帧保留可能失效的 WASM 内存视图。
    this.onFrame(module.HEAPU8.subarray(pointer, pointer + FRAME_BYTES))
  }

  update(deltaMs) {
    if (!this.running)
      return
    // 独立于显示器刷新率，限制追帧预算，失焦后不补跑几秒钟的历史帧。
    this.accumulator = Math.min(this.accumulator + Math.max(0, deltaMs), FRAME_INTERVAL * 3)
    let frames = 0
    while (this.accumulator >= FRAME_INTERVAL && frames < 2) {
      this.runFrame()
      this.accumulator -= FRAME_INTERVAL
      frames++
    }
    if (frames)
      this.present()
    const now = performance.now()
    const elapsed = now - this.statStart
    if (elapsed >= 1000) {
      const fps = this.statFrames * 1000 / elapsed
      this.onStats({ fps, speed: fps / NDS_FPS * 100, frameMs: this.statFrames ? this.statCost / this.statFrames : 0, heapMiB: this.module.HEAPU8.byteLength / 1048576, frames: this.frameCount })
      this.statStart = now
      this.statFrames = 0
      this.statCost = 0
    }
  }

  destroy() {
    if (this.destroyed)
      return
    this.pause()
    this.destroyed = true
    this.abortController.abort()
    this.audio?.destroy()
    this.audio = null
    if (this.audioPtr)
      this.module._free(this.audioPtr)
    if (this.instance)
      this.module._pilas_destroy(this.instance)
    this.instance = 0
    this.audioPtr = 0
    this.module = null
    this.onFrame = this.onStatus = this.onStats = () => {}
  }
}
