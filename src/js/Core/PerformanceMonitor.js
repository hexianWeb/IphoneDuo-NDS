const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
const percentile = (values, fraction) => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1] : 0
const rounded = value => Math.round(value * 100) / 100

// 仅开发时显式 ?performance 开启。帧间隔含 CPU/GPU/浏览器等待，提交耗时不是 GPU 执行时间。
export default class PerformanceMonitor {
  constructor({ canvas, events, state }) {
    this.canvas = canvas
    this.state = state
    this.startedAt = performance.now()
    this.phases = {}
    this.samples = new Map()
    this.warmups = []
    this.removePhaseListener = events.on('experience:phase', ({ phase }) => this.setPhase(phase))
    this.lastReport = 0
  }

  setPhase(phase) {
    const now = performance.now()
    if (this.phase)
      this.phases[this.phase] = rounded(now - this.phaseStartedAt)
    this.phase = phase
    this.phaseStartedAt = now
    this.canvas.dataset.performance = JSON.stringify({ phase, loadingPhasesMs: this.phases })
  }

  loaded() {
    this.setPhase('intro')
    this.loadMs = rounded(performance.now() - this.startedAt)
  }

  recordWarmup(timing) {
    this.warmups.push({ phase: this.phase, ...timing })
  }

  beginFrame() {
    this.frameStartedAt = performance.now()
  }

  updated() {
    this.updatedAt = performance.now()
  }

  endFrame(renderer) {
    const now = performance.now()
    const key = this.state.introState === 'ready' ? this.state.productMode : this.state.introState
    const interval = this.previousFrame ? this.frameStartedAt - this.previousFrame : 0
    this.previousFrame = document.hidden ? null : this.frameStartedAt
    if (document.hidden || interval <= 0 || interval > 1000)
      return
    if (!this.samples.has(key))
      this.samples.set(key, [])
    const samples = this.samples.get(key)
    samples.push({ interval, update: this.updatedAt - this.frameStartedAt, render: now - this.updatedAt, draws: renderer.instance.info.render.drawCalls, triangles: renderer.instance.info.render.triangles })
    if (samples.length > 240)
      samples.shift()
    if (now - this.lastReport < 1000)
      return
    this.lastReport = now
    const phases = Object.fromEntries([...this.samples].map(([name, frames]) => [name, {
      frames: frames.length,
      fps: rounded(1000 / mean(frames.map(frame => frame.interval))),
      frameP95Ms: rounded(percentile(frames.map(frame => frame.interval), 0.95)),
      updateMs: rounded(mean(frames.map(frame => frame.update))),
      renderSubmitMs: rounded(mean(frames.map(frame => frame.render))),
      drawCalls: rounded(mean(frames.map(frame => frame.draws))),
      triangles: rounded(mean(frames.map(frame => frame.triangles))),
    }]))
    this.canvas.dataset.performance = JSON.stringify({ loadMs: this.loadMs, loadingPhasesMs: this.phases, viewport: { width: renderer.sizes.width, height: renderer.sizes.height, dpr: renderer.instance.getPixelRatio() }, phases, warmups: this.warmups, shadows: renderer.shadowTracker?.stats })
  }

  destroy() {
    this.removePhaseListener()
    delete this.canvas.dataset.performance
    this.samples.clear()
  }
}
