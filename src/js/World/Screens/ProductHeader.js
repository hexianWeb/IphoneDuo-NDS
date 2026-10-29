import '../../../product-header.css'

const LOGO = `<svg class="product-header__logo" viewBox="0 0 32 32" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <rect x="8" y="3.5" width="16" height="12" rx="3"/>
  <path d="M10 18h12"/>
  <rect x="5" y="20" width="22" height="8.5" rx="3"/>
  <path d="M9 24.25h3m-1.5-1.5v3M22 23.5h.01M24 25h.01"/>
</svg>`

export default class ProductHeader {
  constructor({ state, events, canvas }) {
    this.state = state
    this.events = events
    this.canvas = canvas
    this.nds = {
      loading: state.ndsStatus === 'loading',
      loaded: state.ndsStatus === 'running' || state.ndsStatus === 'paused',
    }
    this.listeners = new AbortController()
    this.element = document.createElement('header')
    this.element.className = 'product-header'
    this.element.innerHTML = `
      <div class="product-header__inner">
        <button class="product-header__brand" type="button" data-action="overview" aria-label="iPhone Duo，返回产品展区">
          ${LOGO}<span class="product-header__wordmark">iPhone Duo</span>
        </button>
        <nav class="product-header__nav" aria-label="iPhone Duo 产品导航">
          <button class="product-header__nav-link product-header__overview" type="button" data-action="overview">产品</button>
          <button class="product-header__nav-link product-header__replay" type="button" data-action="replay-intro">装配演示</button>
          <button class="product-header__nav-link product-header__help" type="button" data-action="help">操作指南</button>
        </nav>
        <button class="product-header__cta" type="button" data-action="primary"><span data-field="primary-label">开始试玩</span></button>
      </div>`
    this.buttons = [...this.element.querySelectorAll('[data-action]')]
    this.overview = this.element.querySelector('.product-header__overview')
    this.replay = this.element.querySelector('.product-header__replay')
    this.primary = this.element.querySelector('.product-header__cta')
    this.primaryLabel = this.element.querySelector('[data-field="primary-label"]')
    for (const button of this.buttons) {
      button.addEventListener('click', () => this.handleAction(button.dataset.action, button), { signal: this.listeners.signal })
    }
    this.removeListeners = [
      ...['intro:state', 'product:mode'].map(event => events.on(event, () => this.render())),
      events.on('nds:state', (info) => { this.nds = info; this.render() }),
    ]
    document.body.prepend(this.element)
    this.render()
  }

  handleAction(action, trigger) {
    if (this.destroyed || !this.state.productMode)
      return
    const playing = this.state.productMode === 'playing'
    const intro = this.state.introState !== 'ready' && !playing
    if (action === 'help') {
      // 说明弹窗与关闭后的焦点恢复仍由 Toolbar 持有，页头只传递真实触发按钮。
      this.events.emit('product:help-request', { trigger })
      return
    }
    if (action === 'overview') {
      if (this.nds.loading || playing)
        this.emitAction('back')
      else if (intro)
        this.emitAction('skip-intro')
      this.canvas.focus({ preventScroll: true })
      return
    }
    if (action === 'replay-intro' && (intro || this.nds.loading || playing))
      return
    if (action === 'primary') {
      action = this.nds.loading || playing ? 'back' : intro ? 'skip-intro' : 'continue'
    }
    this.emitAction(action)
    if (action === 'replay-intro')
      this.canvas.focus({ preventScroll: true })
  }

  emitAction(action) {
    this.events.emit('product:action', { action, options: { userGesture: true } })
  }

  render() {
    const playing = this.state.productMode === 'playing'
    const intro = this.state.introState !== 'ready' && !playing
    this.element.hidden = !this.state.productMode
    this.element.dataset.mode = this.nds.loading ? 'loading' : playing ? 'playing' : intro ? 'intro' : 'home'
    for (const button of this.buttons) button.disabled = !this.state.productMode
    this.replay.disabled = !this.state.productMode || intro || this.nds.loading || playing
    for (const [button, active] of [[this.overview, !intro], [this.replay, intro]]) {
      button.classList.toggle('is-active', active)
      if (active)
        button.setAttribute('aria-current', 'page')
      else button.removeAttribute('aria-current')
    }
    const label = this.nds.loading ? '取消启动' : playing ? '返回展区' : intro ? '跳过动画' : this.nds.loaded ? '继续试玩' : '开始试玩'
    this.primaryLabel.textContent = label
    this.primary.setAttribute('aria-label', label)
  }

  destroy() {
    this.destroyed = true
    this.listeners.abort()
    this.removeListeners.forEach(remove => remove())
    this.element.remove()
  }
}
