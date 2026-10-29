// 不依赖音效素材：每次点击由带通噪声（塑料撞击的“咔”）和下滑三角波（键帽触底的“咚”）合成。
const VOICES = {
  face: { noiseFrequency: 3400, q: 1.6, toneStart: 280, toneEnd: 130, decay: 0.012, gain: 1 },
  dpad: { noiseFrequency: 2100, q: 1.1, toneStart: 200, toneEnd: 100, decay: 0.016, gain: 0.9 },
  small: { noiseFrequency: 4300, q: 1.8, toneStart: 360, toneEnd: 180, decay: 0.009, gain: 0.6 },
}

export default class ButtonClickSound {
  constructor({ enabled, volume }) {
    this.enabled = enabled
    this.volume = volume
  }

  getContext() {
    if (this.context)
      return this.context
    this.context = new AudioContext({ latencyHint: 'interactive' })
    this.output = this.context.createGain()
    this.output.gain.value = this.volume
    this.output.connect(this.context.destination)
    // 噪声缓冲只生成一次，热路径每次只建轻量节点；长度需覆盖最长衰减尾巴，否则会被截断出爆音。
    const length = Math.ceil(this.context.sampleRate * 0.15)
    this.noise = this.context.createBuffer(1, length, this.context.sampleRate)
    const data = this.noise.getChannelData(0)
    for (let index = 0; index < length; index++) data[index] = Math.random() * 2 - 1
    return this.context
  }

  setVolume(volume) {
    this.volume = volume
    if (this.output)
      this.output.gain.value = volume
  }

  play(kind, pressed) {
    if (!this.enabled || this.volume <= 0 || this.destroyed)
      return
    const context = this.getContext()
    if (context.state !== 'running') {
      // 键盘按下处于用户激活栈中，resume 会立即生效；手柄输入没有激活权限，
      // 此时排队的节点会在之后一次性爆发，宁可丢弃这一声。
      const canStart = navigator.userActivation?.isActive
      context.resume().catch(() => {})
      if (!canStart)
        return
    }

    const voice = VOICES[kind]
    const variation = 1 + (Math.random() - 0.5) * 0.1
    // 松开是穹顶回弹，比按下更轻、更高。
    const pitch = (pressed ? 1 : 1.3) * variation
    const level = voice.gain * (pressed ? 1 : 0.45)
    const decay = voice.decay * (pressed ? 1 : 0.75)
    const start = context.currentTime

    const noise = context.createBufferSource()
    noise.buffer = this.noise
    noise.playbackRate.value = variation
    const filter = context.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = voice.noiseFrequency * pitch
    filter.Q.value = voice.q
    const noiseGain = context.createGain()
    this.envelope(noiseGain.gain, start, level, decay)
    noise.connect(filter).connect(noiseGain).connect(this.output)
    noise.start(start)
    noise.stop(start + decay * 8)

    const tone = context.createOscillator()
    tone.type = 'triangle'
    tone.frequency.setValueAtTime(voice.toneStart * pitch, start)
    tone.frequency.exponentialRampToValueAtTime(voice.toneEnd * pitch, start + decay * 3)
    const toneGain = context.createGain()
    this.envelope(toneGain.gain, start, level * 0.55, decay * 1.6)
    tone.connect(toneGain).connect(this.output)
    tone.start(start)
    tone.stop(start + decay * 12)
  }

  envelope(param, start, peak, timeConstant) {
    // 1 ms 起音避免直流阶跃爆音，之后按时间常数指数衰减，模拟塑料撞击的快速阻尼。
    param.setValueAtTime(0, start)
    param.linearRampToValueAtTime(peak, start + 0.001)
    param.setTargetAtTime(0, start + 0.001, timeConstant)
  }

  destroy() {
    this.destroyed = true
    this.context?.close().catch(() => {})
    this.context = null
  }
}
