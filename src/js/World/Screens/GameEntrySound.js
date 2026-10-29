// 用短促下滑音和上行双音合成进入游戏的反馈，不依赖额外音频文件。
export default class GameEntrySound {
  constructor() {
    this.voices = new Set()
  }

  unlock({ userGesture, enabled }) {
    this.enabled = enabled
    if (!enabled || this.destroyed)
      return
    if (!this.context && userGesture && navigator.userActivation?.isActive) {
      // 音频不可用时保留视觉进入流程，不能让可选反馈阻止游戏启动。
      try { this.context = new AudioContext({ latencyHint: 'interactive' }) }
      catch { return }
    }
    if (this.context?.state === 'suspended' && userGesture && navigator.userActivation?.isActive) {
      this.context.resume().catch(() => {})
    }
  }

  play(opening, duration) {
    const context = this.context
    if (!this.enabled || this.destroyed || !context || context.state !== 'running')
      return
    const start = context.currentTime
    const tones = opening ? [[440, 660, 0], [660, 880, 0.07]] : [[520, 140, 0]]
    for (const [from, to, delay] of tones) {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(from, start + delay)
      oscillator.frequency.exponentialRampToValueAtTime(to, start + delay + duration * 0.65)
      gain.gain.setValueAtTime(0, start + delay)
      gain.gain.linearRampToValueAtTime(0.065, start + delay + 0.018)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + delay + duration)
      oscillator.connect(gain).connect(context.destination)
      this.voices.add(oscillator)
      oscillator.onended = () => {
        oscillator.disconnect()
        gain.disconnect()
        this.voices.delete(oscillator)
      }
      oscillator.start(start + delay)
      oscillator.stop(start + delay + duration + 0.02)
    }
  }

  stop() {
    for (const voice of this.voices) {
      try { voice.stop() }
      catch { /* 已结束的节点无需再次停止。 */ }
    }
    this.voices.clear()
  }

  destroy() {
    this.destroyed = true
    this.stop()
    this.context?.close().catch(() => {})
    this.context = null
  }
}
