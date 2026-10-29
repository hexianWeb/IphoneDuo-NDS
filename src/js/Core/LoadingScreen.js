import '../../loading-screen.css'

const PHASES = {
  renderer: { title: '正在准备图形引擎', detail: '为双屏体验准备就绪。', progress: 4, step: 0 },
  resources: { title: '正在准备模型与材质', detail: '每一个细节，逐渐到位。', progress: 8, step: 1 },
  scene: { title: '正在准备展区', detail: '即将展开。', progress: 94, step: 2 },
}

export default class LoadingScreen {
  constructor(element) {
    this.element = element
    this.title = element.querySelector('.status-title')
    this.detail = element.querySelector('.status-detail')
    this.progress = element.querySelector('.loading-progress')
    this.fill = this.progress.firstElementChild
    this.steps = [...element.querySelectorAll('.loading-steps li')]
    this.retry = element.querySelector('.loading-retry')
    this.startedAt = performance.now()
    this.listeners = new AbortController()
    this.retry.addEventListener('click', () => location.reload(), { signal: this.listeners.signal })
    element.hidden = false
    element.dataset.state = 'loading'
    element.setAttribute('aria-busy', 'true')
    this.retry.hidden = true
    this.setPhase('renderer')
  }

  setProgress(value) {
    this.value = Math.max(this.value ?? 0, Math.min(100, value))
    this.fill.style.width = `${this.value}%`
    this.progress.setAttribute('aria-valuenow', String(Math.round(this.value)))
  }

  setPhase(phase) {
    if (this.destroyed || this.element.dataset.state !== 'loading')
      return
    const info = PHASES[phase]
    if (!info)
      return
    this.title.textContent = info.title
    this.detail.textContent = info.detail
    this.setProgress(info.progress)
    this.steps.forEach((step, index) => { step.dataset.state = index < info.step ? 'done' : index === info.step ? 'active' : 'waiting' })
  }

  setResources({ loaded, total, progress }) {
    if (this.destroyed || this.element.dataset.state !== 'loading')
      return
    this.setProgress(8 + (progress ?? loaded / Math.max(1, total)) * 82)
    this.detail.textContent = `${loaded} / ${total} 项资源已就绪`
  }

  complete() {
    if (this.destroyed)
      return
    this.setProgress(100)
    this.title.textContent = '准备就绪'
    this.detail.textContent = '欢迎来到 iPhone Duo。'
    this.steps.forEach((step) => { step.dataset.state = 'done' })
    this.element.setAttribute('aria-busy', 'false')
    this.element.dataset.state = 'complete'
    // 短加载也保留一次可读的品牌呈现；过渡计时器跟随入口的 HMR 销毁。
    this.completeTimer = setTimeout(() => {
      this.element.dataset.state = 'ready'
      this.hideTimer = setTimeout(() => { this.element.hidden = true }, 450)
    }, Math.max(200, 650 - (performance.now() - this.startedAt)))
  }

  fail(title, detail) {
    if (this.destroyed)
      return
    clearTimeout(this.completeTimer)
    clearTimeout(this.hideTimer)
    this.element.hidden = false
    this.element.dataset.state = 'error'
    this.element.setAttribute('aria-busy', 'false')
    this.title.textContent = title
    this.detail.textContent = detail
    this.retry.hidden = false
  }

  destroy() {
    this.destroyed = true
    clearTimeout(this.completeTimer)
    clearTimeout(this.hideTimer)
    this.listeners.abort()
  }
}
