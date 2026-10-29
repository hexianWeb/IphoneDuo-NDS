// PCM / AudioWorklet 协议沿用 pilas-melonds (José Pilas, MPL-2.0)。
// This Source Code Form is subject to the Mozilla Public License, v. 2.0.
// https://mozilla.org/MPL/2.0/
export default class NDSAudio {
  constructor(workletUrl) {
    this.workletUrl = workletUrl
    this.enabled = false
    this.destroyed = false
  }

  async enable() {
    if (this.destroyed)
      return
    if (!this.context) {
      this.context = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' })
      this.workletReady = this.context.audioWorklet.addModule(this.workletUrl)
    }
    // resume 在用户点击的同步调用栈发起，不能等 ROM 下载完才尝试解锁。
    const resumed = this.context.resume()
    await Promise.all([resumed, this.workletReady])
    if (this.destroyed)
      return
    if (this.context.sampleRate !== 48000)
      throw new Error('当前音频设备不支持 48 kHz 输出')
    this.enabled = true
    this.clearQueue()
  }

  disable() {
    this.enabled = false
    this.clearQueue()
  }

  clearQueue() {
    this.node?.disconnect()
    this.node?.port.close()
    this.node = null
    if (!this.enabled || this.destroyed)
      return
    // 上游 Worklet 没有 flush 消息；重建轻量节点清掉暂停前残留 PCM。
    this.node = new AudioWorkletNode(this.context, 'pilas-audio-worklet', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    })
    this.node.connect(this.context.destination)
  }

  push(pcm) {
    if (!this.enabled || !this.node || this.context.state !== 'running')
      return
    const samples = new Float32Array(pcm.length)
    for (let index = 0; index < pcm.length; index++) samples[index] = pcm[index] / 32768
    this.node.port.postMessage({ type: 'samples', samples }, [samples.buffer])
  }

  destroy() {
    if (this.destroyed)
      return
    this.destroyed = true
    this.disable()
    this.context?.close().catch(() => {})
    this.context = null
  }
}
