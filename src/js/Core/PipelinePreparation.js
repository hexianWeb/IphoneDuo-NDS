import { REVISION } from 'three/webgpu'

// r186 的 compileAsync 逐对象等待；这里仅在 Loading 的同步提交栈内适配 backend，
// 用真实 MRT / AO / 透射上下文收集异步管线，等待期间和正常动画不保留任何覆盖。
export default class PipelinePreparation {
  constructor(renderer, {
    requestFrame = callback => requestAnimationFrame(callback),
    cancelFrame = id => cancelAnimationFrame(id),
    maxPasses = 8,
  } = {}) {
    const backend = renderer.backend
    if (REVISION !== '186' || !backend.isWebGPUBackend || typeof backend.createRenderPipeline !== 'function'
      || typeof backend.get !== 'function') {
      throw new Error('异步管线预热适配需要 Three.js r186 WebGPU；升级后须重新验证 backend 接口。')
    }
    this.backend = backend
    this.requestFrame = requestFrame
    this.cancelFrame = cancelFrame
    this.maxPasses = maxPasses
    this.abortController = new AbortController()
  }

  nextFrame() {
    const signal = this.abortController.signal
    if (signal.aborted) return Promise.resolve(false)
    return new Promise((resolve) => {
      let id
      const abort = () => {
        this.cancelFrame(id)
        resolve(false)
      }
      signal.addEventListener('abort', abort, { once: true })
      id = this.requestFrame(() => {
        signal.removeEventListener('abort', abort)
        resolve(!signal.aborted)
      })
    })
  }

  wait(work) {
    const signal = this.abortController.signal
    // GPU 编译不能取消；销毁后仍消费迟到拒绝，但不再读 backend 或提交下一帧。
    if (signal.aborted) {
      Promise.resolve(work).catch(() => {})
      return Promise.resolve(false)
    }
    return new Promise((resolve, reject) => {
      const abort = () => resolve(false)
      signal.addEventListener('abort', abort, { once: true })
      Promise.resolve(work).then(() => {
        signal.removeEventListener('abort', abort)
        resolve(!signal.aborted)
      }, (error) => {
        signal.removeEventListener('abort', abort)
        if (signal.aborted) resolve(false)
        else reject(error)
      })
    })
  }

  collect(renderFrame) {
    const backend = this.backend
    const descriptor = Object.getOwnPropertyDescriptor(backend, 'createRenderPipeline')
    const original = backend.createRenderPipeline
    const pending = []
    const created = []
    Object.defineProperty(backend, 'createRenderPipeline', {
      configurable: true,
      writable: true,
      value(object, promises) {
        if (promises != null) return original.call(this, object, promises)
        created.push({ pipeline: object.pipeline, material: object.material?.name || object.material?.type || '未命名材质' })
        // 描述符、错误域及 ready 状态仍完全由 Three 持有，不重写 GPUDevice 或复制其实现。
        return original.call(this, object, pending)
      },
    })
    try { renderFrame() }
    catch (error) {
      Promise.all(pending).catch(() => {})
      throw error
    }
    finally {
      if (descriptor) Object.defineProperty(backend, 'createRenderPipeline', descriptor)
      else delete backend.createRenderPipeline
    }
    return { pending, created }
  }

  async run(renderFrame) {
    if (this.running) throw new Error('管线预热不能并行执行。')
    const result = { completed: false, passes: 0, pipelines: 0, renderSubmitMs: 0, pipelineWaitMs: 0, queueWaitMs: 0 }
    this.running = true
    try {
      for (let pass = 0; pass < this.maxPasses; pass++) {
        if (!await this.nextFrame()) return result
        const submittedAt = performance.now()
        const { pending, created } = this.collect(renderFrame)
        result.renderSubmitMs += performance.now() - submittedAt
        result.passes++
        result.pipelines += created.length
        const compileStartedAt = performance.now()
        if (!await this.wait(Promise.all(pending))) return result
        result.pipelineWaitMs += performance.now() - compileStartedAt
        for (const { pipeline, material } of created) {
          const data = this.backend.get(pipeline)
          // Three 的创建 Promise 在验证失败时也会 resolve，不能把 resolve 当成管线成功。
          if (data.error || !data.pipeline) throw new Error(`渲染管线准备失败：${material}`)
        }
        if (created.length) continue
        // 前几轮未 ready 的物体会被 Three 跳过；只有零新管线的完整重绘及 GPU 完成才可显示。
        const queueStartedAt = performance.now()
        if (!await this.wait(this.backend.device.queue.onSubmittedWorkDone())) return result
        result.queueWaitMs += performance.now() - queueStartedAt
        result.completed = true
        return result
      }
      throw new Error(`渲染管线预热在 ${this.maxPasses} 轮后仍未收敛。`)
    }
    finally {
      this.running = false
    }
  }

  destroy() {
    this.abortController.abort()
  }
}
