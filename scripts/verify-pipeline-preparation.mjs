import assert from 'node:assert/strict'
import PipelinePreparation from '../src/js/Core/PipelinePreparation.js'

const tick = () => new Promise(resolve => setImmediate(resolve))
const scheduler = { requestFrame: callback => setTimeout(callback, 0), cancelFrame: clearTimeout }
function fixture({ immediate = false, queue = () => Promise.resolve(), maxPasses = 8 } = {}) {
  const records = new WeakMap()
  const requests = []
  let queueCalls = 0
  class Backend {
    isWebGPUBackend = true
    device = { queue: { onSubmittedWorkDone: () => { queueCalls++; return queue() } } }
    get(pipeline) {
      if (!records.has(pipeline)) records.set(pipeline, {})
      return records.get(pipeline)
    }
    createRenderPipeline(object, promises) {
      assert.equal(this, backend, '保留 backend 的 this')
      assert.ok(Array.isArray(promises), '真实路径必须请求异步管线')
      let resolve
      let reject
      const promise = new Promise((yes, no) => { resolve = yes; reject = no })
      const record = this.get(object.pipeline)
      requests.push({ object, resolve: () => { record.pipeline = {}; resolve() }, reject,
        fail: () => { record.error = true; resolve() } })
      promises.push(promise)
      if (immediate) requests.at(-1).resolve()
    }
  }
  const backend = new Backend()
  const renderer = { backend }
  const preparation = new PipelinePreparation(renderer, { ...scheduler, maxPasses })
  const object = name => ({ pipeline: {}, material: { name } })
  const discover = object => {
    const state = backend.get(object.pipeline)
    if (!state.requested) {
      state.requested = true
      backend.createRenderPipeline(object, null)
    }
    return Boolean(state.pipeline)
  }
  return { backend, preparation, requests, object, discover, queueCalls: () => queueCalls }
}
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 1))
  }
  throw new Error('测试等待超时')
}

// 第一轮不可绘制，第二轮发现依赖，第三轮完整重绘；不能只等 Promise 就宣称首帧就绪。
{
  const f = fixture()
  const original = f.backend.createRenderPipeline
  const first = f.object('first')
  const second = f.object('second')
  const dependent = f.object('dependent')
  const frames = []
  const running = f.preparation.run(() => {
    const a = f.discover(first)
    const b = f.discover(second)
    const c = a && b ? f.discover(dependent) : false
    frames.push([a, b, c])
  })
  await until(() => f.requests.length === 2)
  assert.equal(f.backend.createRenderPipeline, original, '等待期间必须立即恢复 hook')
  assert.equal(Object.hasOwn(f.backend, 'createRenderPipeline'), false, '不能遗留实例方法覆盖')
  assert.equal(f.queueCalls(), 0)
  f.requests[0].resolve()
  f.requests[1].resolve()
  await until(() => f.requests.length === 3)
  f.requests[2].resolve()
  const result = await running
  assert.equal(result.completed, true)
  assert.equal(result.passes, 3)
  assert.equal(result.pipelines, 3)
  assert.deepEqual(frames.at(-1), [true, true, true])
  assert.equal(f.queueCalls(), 1)
}

// 捕获同步提交异常也要还原已有的实例 hook，不能污染正常渲染路径。
{
  const f = fixture()
  const original = f.backend.createRenderPipeline.bind(f.backend)
  Object.defineProperty(f.backend, 'createRenderPipeline', { value: original, writable: true, configurable: true, enumerable: true })
  const descriptor = Object.getOwnPropertyDescriptor(f.backend, 'createRenderPipeline')
  await assert.rejects(f.preparation.run(() => { throw new Error('submit failed') }), /submit failed/)
  assert.deepEqual(Object.getOwnPropertyDescriptor(f.backend, 'createRenderPipeline'), descriptor)
}

// Three 会把验证错误转成已 resolve 的 Promise；必须额外检查管线错误/就绪状态。
{
  const f = fixture()
  const object = f.object('partially-submitted')
  await assert.rejects(f.preparation.run(() => { f.discover(object); throw new Error('partial submit failed') }), /partial submit failed/)
  f.requests[0].reject(new Error('late failure after submit exception'))
  await tick()
  assert.equal(Object.hasOwn(f.backend, 'createRenderPipeline'), false)
}
{
  const f = fixture()
  const object = f.object('failed-material')
  const running = f.preparation.run(() => f.discover(object))
  const rejected = assert.rejects(running, /failed-material/)
  await until(() => f.requests.length === 1)
  f.requests[0].fail()
  await rejected
  assert.equal(f.queueCalls(), 0)
}

{
  const f = fixture()
  const object = f.object('rejected-material')
  const running = f.preparation.run(() => f.discover(object))
  const rejected = assert.rejects(running, /native rejection/)
  await until(() => f.requests.length === 1)
  f.requests[0].reject(new Error('native rejection'))
  await rejected
  assert.equal(Object.hasOwn(f.backend, 'createRenderPipeline'), false)
}
{
  const f = fixture({ queue: () => Promise.reject(new Error('queue lost')) })
  await assert.rejects(f.preparation.run(() => {}), /queue lost/)
  assert.equal(f.preparation.running, false)
}

// 等待编译、排队帧或 GPU 队列时销毁：立即退出，迟到 Promise 不得再访问 GPU 或发布就绪。
for (const stage of ['frame', 'compile', 'queue']) {
  let releaseQueue
  const f = fixture({ queue: () => new Promise(resolve => { releaseQueue = resolve }) })
  const object = f.object('cancelled')
  let frames = 0
  const running = f.preparation.run(() => { frames++; if (stage === 'compile') f.discover(object) })
  if (stage === 'compile') await until(() => f.requests.length === 1)
  if (stage === 'queue') await until(() => f.queueCalls() === 1)
  f.preparation.destroy()
  const result = await running
  assert.equal(result.completed, false)
  const stoppedAt = frames
  f.backend.get = () => { throw new Error('late GPU access') }
  if (stage === 'compile') f.requests[0].reject(new Error('late compile rejection'))
  releaseQueue?.()
  await tick()
  assert.equal(frames, stoppedAt)
  if (stage === 'frame') assert.equal(frames, 0)
}

{
  const f = fixture({ immediate: true, maxPasses: 2 })
  await assert.rejects(f.preparation.run(() => f.discover(f.object('never-converges'))), /未收敛/)
  assert.equal(Object.hasOwn(f.backend, 'createRenderPipeline'), false)
}
{
  const f = fixture({ immediate: true })
  const object = f.object('single-run')
  const running = f.preparation.run(() => f.discover(object))
  await assert.rejects(f.preparation.run(() => {}), /并行/)
  assert.equal((await running).completed, true)
}
{
  const f = fixture()
  f.preparation.destroy()
  assert.equal((await f.preparation.run(() => { throw new Error('destroyed submission') })).completed, false)
  assert.equal(f.queueCalls(), 0)
}
console.log('Pipeline preparation checks passed: real async requests, redraw convergence, hook restoration, validation errors, cancellation and non-reentrancy')
