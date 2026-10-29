import { ndsSources } from '../sources.js'
import NDSAudio from './NDSAudio.js'
import NDSControls from './NDSControls.js'
import NDSRuntime from './NDSRuntime.js'

export default class NDSPlayer {
  constructor({ state, events, onFrame, onEnter, onExit, onGameInfo, onFocus, onLaunchStart, onLaunchReady, onLaunchCancel }) {
    this.state = state
    this.events = events
    this.onEnter = onEnter
    this.onExit = onExit
    this.onGameInfo = onGameInfo
    this.onFocus = onFocus
    this.onLaunchStart = onLaunchStart
    this.onLaunchReady = onLaunchReady
    this.onLaunchCancel = onLaunchCancel
    this.requestId = 0
    this.loading = false
    this.audioWanted = true
    this.message = ndsSources.testRom ? 'Continue 将载入本地测试游戏' : '请选择本地 .nds 文件'
    this.audioMessage = '点击 Continue 可启用声音；手柄进入后可单独点击启用声音。'
    this.runtime = new NDSRuntime({
      onFrame,
      onStatus: (message) => {
        if (this.loading && this.activeRequest === this.requestId && !this.destroyed) {
          this.message = message
          this.render()
        }
      },
      onStats: stats => this.showStats(stats),
    })
    this.runtime.audio = new NDSAudio(ndsSources.audioWorklet)
    this.controls = new NDSControls({
      onPlay: () => this.play(null, { userGesture: true }),
      onBack: () => this.back(),
      onFile: file => this.play(file, { userGesture: true }),
      onAudio: () => this.toggleAudio(),
    })
    this.render()
  }

  setStatus(status, message) {
    this.state.ndsStatus = status
    this.message = message
    this.events.emit('nds:status', { status, message })
    this.render()
  }

  render() {
    if (this.destroyed)
      return
    const info = {
      mode: this.mode,
      status: this.state.ndsStatus,
      message: this.message,
      loading: this.loading,
      loaded: this.runtime.loaded,
      audioEnabled: this.runtime.audio.enabled,
      audioBusy: this.audioBusy,
      audioMessage: this.audioMessage,
    }
    this.controls?.render(info)
    this.events.emit('nds:state', info)
  }

  setMode(mode) {
    this.mode = mode
    if (mode === 'playing' && this.runtime.loaded) {
      this.runtime.resume()
      this.sceneFrames = 0
      this.statsAt = performance.now()
      this.setStatus('running', this.state.ndsRomName)
      this.onFocus()
    }
    else {
      this.cancelPending()
      this.runtime.pause()
      this.setStatus(this.runtime.loaded ? 'paused' : 'idle', this.runtime.loaded ? `${this.state.ndsRomName} · 已暂停` : this.message)
    }
  }

  cancelPending() {
    // 模式变化、Replay、取消和销毁都会使异步载入失效，旧 Promise 不得再次切入 Playing。
    this.requestId++
    this.loadAbort?.abort()
    this.onLaunchCancel?.()
  }

  back() {
    if (this.mode === 'playing') {
      this.onExit()
    }
    else if (this.loading) {
      this.cancelPending()
      this.setStatus('idle', '启动已取消，等待当前加载收束后可重试')
    }
  }

  async play(file = null, { userGesture = false } = {}) {
    if (this.destroyed || this.loading || this.mode !== 'game-home')
      return
    if (!file && !this.runtime.loaded && !ndsSources.testRom) {
      this.setStatus('idle', '请选择本地 .nds 文件')
      if (userGesture)
        this.controls.chooseFile()
      return
    }
    // 在真实点击/按键栈中启动 WebAudio，不等待 WASM 或 ROM 下载。
    // 文件选择器停留较久时 change 事件可能已失去激活权限，不能让 resume 永久挂起并锁死按钮。
    if (userGesture && this.audioWanted && navigator.userActivation?.isActive)
      this.enableAudio()
    const request = ++this.requestId
    this.activeRequest = request
    this.loadAbort = new AbortController()
    this.loading = true
    this.setStatus('loading', '正在进入游戏…')
    const isCurrent = () => !this.destroyed && request === this.requestId && this.mode === 'game-home'
    try {
      if (await this.onLaunchStart?.({ userGesture, enabled: this.audioWanted }) === false || !isCurrent())
        return
      if (file || !this.runtime.loaded) {
        await this.runtime.init(ndsSources)
        if (!isCurrent())
          return
        let name
        if (file) {
          const bytes = new Uint8Array(await file.arrayBuffer())
          if (!isCurrent())
            return
          this.runtime.loadBytes(bytes, file.name)
          name = file.name
        }
        else {
          await this.runtime.loadUrl(ndsSources.testRom, { signal: this.loadAbort.signal })
          name = decodeURIComponent(ndsSources.testRom.split('/').pop())
        }
        if (!isCurrent())
          return
        this.state.ndsRomName = name.replace(/\.(nds|srl)$/i, '')
        this.onGameInfo({ title: this.state.ndsRomName.replace(/\s*\([^)]*\)/g, ''), detail: 'NDS · Continue session' })
        this.runtime.runFrame()
      }
      this.runtime.present()
      if (document.hidden || !document.hasFocus()) {
        this.setStatus('paused', '载入完成 · 点击 Continue 开始')
        return
      }
      this.setStatus('loading', '准备就绪，开始游戏。')
      if (await this.onLaunchReady?.() === false || !isCurrent())
        return
      if (document.hidden || !document.hasFocus()) {
        this.setStatus('paused', '游戏已暂停 · 点击 Continue 开始')
        return
      }
      this.onEnter()
    }
    catch (error) {
      if (isCurrent())
        this.fail(error)
    }
    finally {
      if (!this.destroyed && this.mode !== 'playing')
        this.onLaunchCancel?.()
      this.loading = false
      this.loadAbort = null
      this.render()
    }
  }

  async enableAudio() {
    if (this.audioBusy || this.destroyed)
      return
    this.audioBusy = true
    this.render()
    try {
      await this.runtime.audio.enable()
      if (!this.destroyed)
        this.audioMessage = 'AudioWorklet · 48 kHz · stereo'
    }
    catch (error) {
      if (!this.destroyed)
        this.audioMessage = `声音未启用：${error.message}；可点击「启用声音」重试。`
    }
    finally {
      this.audioBusy = false
      this.render()
    }
  }

  toggleAudio() {
    if (this.runtime.audio.enabled) {
      this.audioWanted = false
      this.runtime.audio.disable()
      this.audioMessage = '已静音'
      this.render()
    }
    else {
      this.audioWanted = true
      this.enableAudio()
    }
    if (this.mode === 'playing')
      this.onFocus()
  }

  chooseFile() {
    if (this.mode === 'game-home' && !this.loading)
      this.controls.chooseFile()
  }

  setButtons(actions) {
    this.runtime.setButtons(actions)
  }

  touch(point) {
    this.runtime.touch(point?.x ?? 0, point?.y ?? 0, Boolean(point))
  }

  showStats(stats) {
    const now = performance.now()
    this.stats = { ...stats, sceneFps: this.sceneFrames * 1000 / Math.max(1, now - this.statsAt) }
    this.controls.setStats(this.stats)
    this.sceneFrames = 0
    this.statsAt = now
  }

  update(deltaMs) {
    if (this.mode !== 'playing')
      return
    this.sceneFrames++
    try {
      this.runtime.update(deltaMs)
    }
    catch (error) {
      this.fail(error)
    }
  }

  fail(error) {
    this.runtime.pause()
    if (this.mode === 'playing')
      this.onExit()
    this.setStatus('error', `NDS 运行失败：${error.message}`)
    console.error(error)
  }

  destroy() {
    this.destroyed = true
    this.cancelPending()
    this.runtime.destroy()
    this.controls.destroy()
  }
}
